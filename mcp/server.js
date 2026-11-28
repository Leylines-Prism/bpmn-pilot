// Serveur MCP de l'éditeur BPMN.
//
//   POST /mcp     point d'entrée MCP (Streamable HTTP, sans session)
//   WS   /bridge  connexion des onglets de l'éditeur
//   POST /chat    chat intégré à l'éditeur (réponse en flux SSE)
//   GET  /healthz état du serveur et nombre d'onglets connectés
//
// N'écoute que sur 127.0.0.1 : rien n'est exposé sur le réseau. Dans le conteneur docker,
// MCP_HOST=0.0.0.0 le rend joignable par nginx, et MCP_ALLOWED_HOSTS limite les noms
// d'hôte acceptés (protection contre le DNS rebinding).

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import Anthropic from '@anthropic-ai/sdk'
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js'
import * as z from 'zod/v4'

import express from 'express'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { LOCAL_HOSTS, LOCKED_MESSAGE, mcpAccess } from './auth.js'
import { EditorBridge } from './bridge.js'
import { buildMcpServer as buildMcpServerFor } from './mcp-server.js'
import { DiagramStore, KINDS, MAX_XML_BYTES } from './diagrams.js'
import { ExportStore, MAX_EXPORT_BYTES } from './exports.js'
import { ChatService } from './chat.js'
import { isForbiddenAddress, relayFetch } from './relay-guard.js'
import { HeadlessRenderer, headlessConfig } from './renderer.js'
import { OpenAICompatError } from '../src/ai/openai-compat.js'
import { buildTools } from '../src/ai/tools.js'
import { buildPrompts } from '../src/ai/prompts.js'
import { attachmentRefused, describeProviderError } from '../src/ai/errors.js'
import { checkAttachments } from '../src/ai/attachments.js'
import { PROVIDERS, apiErrorMessage, checkBaseUrl, listModels, providerBaseUrl } from '../src/ai/providers.js'

// Variables d'environnement facultatives dans mcp/.env (exclu de git).
try {
  process.loadEnvFile(new URL('.env', import.meta.url))
} catch {}

// Version annoncée aux clients MCP : celle de mcp/package.json, tenue égale à celle de
// l'application (test/version.test.mjs le vérifie).
const VERSION = JSON.parse(readFileSync(new URL('package.json', import.meta.url), 'utf8')).version

const HOST = process.env.MCP_HOST || '127.0.0.1'
const ALLOWED_HOSTS = (process.env.MCP_ALLOWED_HOSTS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
// Mode sans navigateur (MCP_HEADLESS=on, voir renderer.js), coupé par défaut.
const HEADLESS = headlessConfig()
const PORT = Number(process.env.MCP_PORT || 3333)
// Jeton facultatif demandé aux clients MCP (en-tête Authorization: Bearer …).
const MCP_TOKEN = (process.env.MCP_TOKEN || '').trim()
// Sans jeton, /mcp est fermé dès que le serveur accepte un nom non local (voir auth.js).
const MCP_ACCESS = mcpAccess({ host: HOST, allowedHosts: ALLOWED_HOSTS, token: MCP_TOKEN, auth: process.env.MCP_AUTH })
// Relais des fournisseurs réglés dans la fenêtre Options. CHAT_RELAY=off le coupe : seuls
// les modèles configurés sur le serveur restent proposés.
const RELAY = !/^(off|false|0|no)$/i.test((process.env.CHAT_RELAY || '').trim())
const ALLOWED_ORIGINS = (process.env.BPMN_EDITOR_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
// L'onglet invisible charge l'éditeur par le réseau interne (http://editor:8080 par défaut) :
// son origine et son nom d'hôte sont acceptés en plus.
if (HEADLESS.editorOrigin && !ALLOWED_ORIGINS.includes(HEADLESS.editorOrigin)) ALLOWED_ORIGINS.push(HEADLESS.editorOrigin)
const HEADLESS_HOST = HEADLESS.editorOrigin ? new URL(HEADLESS.editorOrigin).hostname : null

// Fichiers créés en 0640 et dossiers en 0750 : lisibles par le propriétaire et son groupe seulement.
process.umask(0o027)

// Journal du serveur. Les textes qu'il reçoit peuvent venir d'un modèle ou d'une requête :
// leurs caractères de contrôle (retours à la ligne, séquences ANSI…) sont écrits échappés,
// pour qu'ils ne puissent ni ajouter de fausses lignes ni agir sur le terminal.
const escapeControls = (text) =>
  text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
const log = (...args) =>
  console.error(new Date().toLocaleTimeString('fr-FR'), ...args.map((a) => (typeof a === 'string' ? escapeControls(a) : a)))
const renderer = HEADLESS.enabled
  ? new HeadlessRenderer({ cdpUrl: HEADLESS.cdpUrl, editorUrl: HEADLESS.editorUrl, idleMs: HEADLESS.idleMs, log })
  : null
const READ_ONLY_TOOLS = new Set()
const bridge = new EditorBridge({
  allowedOrigins: ALLOWED_ORIGINS,
  log,
  renderer,
  onHeadlessCall: (tool, send) => saveHeadlessDiagram(tool, send),
  // Un onglet visible a ouvert le diagramme de la série en cours : l'onglet invisible se ferme
  // (tout est déjà enregistré), et les appels suivants vont à cet onglet.
  onHeadlessTake: (id) => {
    if (headlessSession?.id !== id) return
    headlessSession = null
    renderer.close()
  },
})
const chat = new ChatService({ bridge, log })
const TOOLS = buildTools(z)
for (const tool of TOOLS) if (tool.annotations?.readOnlyHint) READ_ONLY_TOOLS.add(tool.name)
const PROMPTS = buildPrompts(z)

const buildMcpServer = () => buildMcpServerFor({ bridge, tools: TOOLS, prompts: PROMPTS, version: VERSION, log })

// Hors de 127.0.0.1, les noms d'hôte acceptés sont ceux de MCP_ALLOWED_HOSTS, ou localhost par défaut.
const app = createMcpExpressApp(
  LOCAL_HOSTS.includes(HOST)
    ? { host: HOST }
    : { host: HOST, allowedHosts: [...(ALLOWED_HOSTS.length ? ALLOWED_HOSTS : ['localhost', '127.0.0.1']), ...(HEADLESS_HOST ? [HEADLESS_HOST] : [])] },
)

function checkToken(req, res, next) {
  if (MCP_ACCESS.locked) {
    return res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: LOCKED_MESSAGE }, id: null })
  }
  if (!MCP_TOKEN) return next()
  const given = Buffer.from((req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim())
  const expected = Buffer.from(MCP_TOKEN)
  if (given.length === expected.length && timingSafeEqual(given, expected)) return next()
  res.set('WWW-Authenticate', 'Bearer')
  res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized: missing or wrong MCP token' }, id: null })
}

// Les clients MCP n'envoient pas d'en-tête Origin. Une requête qui en porte un vient d'une
// page web : seules les pages de l'éditeur sont acceptées, comme pour /chat et /bridge.
function checkMcpOrigin(req, res, next) {
  const origin = req.headers.origin
  if (origin === undefined || ALLOWED_ORIGINS.includes(origin)) return next()
  res.status(403).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Origin not allowed' }, id: null })
}

app.post('/mcp', checkMcpOrigin, checkToken, async (req, res) => {
  // À la connexion, le client MCP se présente (nom et version, rien d'autre) :
  // l'éditeur l'affiche sur son badge MCP.
  if (req.body?.method === 'initialize') bridge.noteMcpClient(req.body.params?.clientInfo)
  const server = buildMcpServer()
  try {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    res.on('close', () => {
      transport.close()
      server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  } catch (err) {
    log('[mcp] erreur de traitement :', err)
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null })
    }
  }
})

const methodNotAllowed = (req, res) =>
  res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null })
app.get('/mcp', methodNotAllowed)
app.delete('/mcp', methodNotAllowed)

app.get('/healthz', (req, res) => res.json({ ok: true, ...bridge.status(), chat: chat.status() }))
// Le navigateur sans écran répond-il ? Pour vérifier la stack après son démarrage.
app.get('/healthz/headless', async (req, res) => {
  if (!renderer) return res.json({ enabled: false })
  res.json({ enabled: true, browser: await renderer.reachable(), ...bridge.status().headless })
})

// ── Chat intégré ───────────────────────────────────────────────────────────
// Réservé aux pages de l'éditeur : chaque message consomme des crédits d'API.

const ALLOWED_ORIGIN_SET = new Set(ALLOWED_ORIGINS)

// Langue des messages renvoyés à l'éditeur : celle de son interface (« lang » du corps), anglais par défaut.
const langOf = (req) => (req.body?.lang === 'fr' ? 'fr' : 'en')
const T = (req, en, fr) => (langOf(req) === 'fr' ? fr : en)
function chatCors(req, res, next) {
  const origin = req.headers.origin
  // Image docker : l'éditeur et le serveur partagent une adresse, et le navigateur
  // n'envoie pas d'en-tête Origin pour une lecture (GET) sur le même site.
  if (!origin && req.headers['sec-fetch-site'] === 'same-origin') return next()
  if (!origin || !ALLOWED_ORIGIN_SET.has(origin)) {
    return res.status(403).json({
      error: origin
        ? T(req, `This address (${origin}) is not allowed by the server: add it to BPMN_EDITOR_ORIGINS, then restart.`,
            `Cette adresse (${origin}) n'est pas autorisée par le serveur : ajoutez-la à BPMN_EDITOR_ORIGINS, puis redémarrez.`)
        : 'Origin not allowed',
    })
  }
  res.set('Access-Control-Allow-Origin', origin)
  res.set('Vary', 'Origin')
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE')
    res.set('Access-Control-Allow-Headers', 'Content-Type')
    res.set('Access-Control-Max-Age', '600')
    return res.sendStatus(204)
  }
  next()
}
app.options('/chat', chatCors)
app.options('/chat/models', chatCors)
app.get('/chat', chatCors, (req, res) => res.json({ ...chat.status(), relay: RELAY, mcpAuth: Boolean(MCP_TOKEN), mcpLocked: MCP_ACCESS.locked }))

// Fournisseur réglé dans la fenêtre Options : { provider, format, baseUrl, apiKey, model? }.
// La clé n'est ni enregistrée ni écrite dans le journal. Renvoie null si invalide.
const PROVIDER_IDS = new Set(PROVIDERS.map((p) => p.id))
function readCustom(value, { needModel }) {
  if (!value || typeof value !== 'object') return null
  const { provider, label, format, baseUrl, apiKey, model } = value
  if (!PROVIDER_IDS.has(provider) || (format !== 'anthropic' && format !== 'openai')) return null
  const url = checkBaseUrl(providerBaseUrl(provider, baseUrl))
  if (!url || isForbiddenAddress(new URL(url).hostname)) return null
  if (apiKey !== undefined && apiKey !== null && (typeof apiKey !== 'string' || apiKey.length > 500)) return null
  if (needModel && (typeof model !== 'string' || !model.trim() || model.length > 200)) return null
  const fallbackLabel = PROVIDERS.find((p) => p.id === provider).label
  return {
    provider,
    label: typeof label === 'string' && label.trim() ? label.trim().slice(0, 60) : fallbackLabel,
    format,
    baseUrl: url,
    apiKey: apiKey || null,
    model: needModel ? model.trim() : undefined,
  }
}

const RELAY_OFF = (req) => T(req, 'Providers set in Options are turned off on this server (CHAT_RELAY=off).', 'Les fournisseurs réglés dans Options sont désactivés sur ce serveur (CHAT_RELAY=off).')

// Erreur d'un fournisseur relayé, telle qu'elle repart vers le navigateur. Le relais
// appelle une adresse choisie par la page : seul le message d'une erreur d'API en JSON
// est renvoyé, limité à 200 caractères. Le reste du corps (page HTML, réponse d'un
// service interne…) n'est jamais renvoyé, seul le statut.
function relayError(err) {
  if (!err || typeof err !== 'object' || typeof err.status !== 'number') return err
  // providerJson : erreurs de listModels et d'OpenAICompatClient. Sinon, SDK Anthropic.
  const message = err.providerJson === undefined ? apiErrorMessage(err.error) : err.providerJson ? err.message : ''
  return { name: err.name, status: err.status, message: String(message || '').slice(0, 200) }
}

// Bouton « Tester » ou « Lister » de la fenêtre Options, relayé par le serveur.
app.post('/chat/models', chatCors, async (req, res) => {
  if (!RELAY) return res.json({ error: RELAY_OFF(req) })
  const custom = readCustom(req.body, { needModel: false })
  if (!custom) return res.status(400).json({ error: T(req, 'Invalid settings', 'Réglages invalides') })
  try {
    const models = await listModels({ ...custom, signal: AbortSignal.timeout(15000), fetch: relayFetch })
    res.json({ models })
  } catch (err) {
    res.json({ error: describeProviderError(relayError(err), { label: custom.label, providerId: custom.provider, baseUrl: custom.baseUrl, lang: langOf(req) }) })
  }
})

// Les messages avec pièces jointes (images, PDF) dépassent la limite de 100 Ko du
// lecteur JSON général : ils arrivent avec leur propre type, lu ici jusqu'à 34 Mo.
const chatBody = express.json({ type: 'application/vnd.bpmn-chat+json', limit: '34mb' })
const KEEPALIVE_MS = 20000 // signal de vie du flux du chat

app.post('/chat', chatCors, chatBody, async (req, res) => {
  const { conversationId, tabId, text, model } = req.body ?? {}
  const attachments = checkAttachments(req.body?.attachments)
  if (!attachments) return res.status(400).json({ error: T(req, 'Invalid attachments (type or size)', 'Pièces jointes invalides (type ou taille)') })
  if (typeof text !== 'string' || !text.trim() || text.length > 100000 || typeof tabId !== 'string') {
    return res.status(400).json({ error: T(req, 'Invalid request', 'Requête invalide') })
  }
  if (req.body.custom !== undefined && !RELAY) return res.status(400).json({ error: RELAY_OFF(req) })
  const custom = req.body.custom === undefined ? null : readCustom(req.body.custom, { needModel: true })
  if (req.body.custom !== undefined && !custom) return res.status(400).json({ error: T(req, 'Invalid provider settings', 'Réglages du fournisseur invalides') })
  // Sinon, seuls les modèles configurés sur le serveur sont acceptés.
  if (!custom && model !== undefined && (typeof model !== 'string' || !chat.hasModel(model))) {
    return res.status(400).json({ error: T(req, 'Unknown model', 'Modèle inconnu') })
  }
  res.set({ 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' })
  res.flushHeaders()
  const emit = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`)
  // Signal de vie : un commentaire SSE à intervalle régulier, ignoré par la page. Sans lui, un
  // modèle lent qui lit la demande ou réfléchit longtemps laisse le flux muet, et un proxy coupe
  // la connexion (nginx au bout de proxy_read_timeout, 10 min dans l'image Docker).
  const alive = setInterval(() => res.write(': alive\n\n'), KEEPALIVE_MS)

  // Le bouton « Arrêter » de l'éditeur coupe la requête : on interrompt l'appel en cours.
  const abort = new AbortController()
  res.on('close', () => {
    clearInterval(alive)
    abort.abort()
  })

  try {
    await chat.send({
      conversationId: typeof conversationId === 'string' ? conversationId : undefined,
      tabId,
      model,
      custom,
      text: text.trim(),
      attachments,
      emit,
      signal: abort.signal,
      lang: langOf(req),
      assist: req.body.assist && typeof req.body.assist === 'object' ? req.body.assist : {},
      rewind: req.body.rewind === true,
    })
    emit({ type: 'done' })
  } catch (err) {
    if (!abort.signal.aborted) {
      log('[chat] erreur :', err.message)
      emit({ type: 'error', message: custom ? describeProviderError(relayError(err), { label: custom.label, providerId: custom.provider, baseUrl: custom.baseUrl, lang: langOf(req) }) : chatErrorMessage(err, langOf(req)) })
    }
  }
  clearInterval(alive)
  res.end()
})

// ── Mes diagrammes, enregistrés sur le serveur ─────────────────────────────
// Mêmes règles d'origine que le chat : seules les pages de l'éditeur y ont accès.

const diagrams = new DiagramStore()

// ── Diagrammes dessinés sans éditeur ouvert ────────────────────────────────
// Après chaque appel qui modifie le diagramme de l'onglet invisible, son XML est enregistré dans
// « Mes diagrammes » : un fichier par série d'appels, nommé d'après sa date. Les onglets visibles
// en sont prévenus et proposent de l'ouvrir. Rien ne reste seulement en mémoire.
let headlessSession = null // { targetId, id, name }
const two = (n) => String(n).padStart(2, '0')
async function saveHeadlessDiagram(tool, send) {
  if (READ_ONLY_TOOLS.has(tool) || !renderer?.target) return
  if (headlessSession?.targetId !== renderer.target.id) {
    const d = new Date()
    headlessSession = {
      targetId: renderer.target.id,
      id: randomUUID(),
      name: `Agent ${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}h${two(d.getMinutes())}`,
    }
  }
  const xml = await send('get_diagram_xml', {})
  if (typeof xml !== 'string' || !xml.includes('<')) return
  const saved = await diagrams.put(headlessSession.id, headlessSession.name, xml)
  bridge.notifyTabs({ type: 'headless-diagram', id: headlessSession.id, name: headlessSession.name, updatedAt: saved.updatedAt })
}
const xmlBody = express.text({ type: ['application/xml', 'text/xml', 'text/plain'], limit: MAX_XML_BYTES })
function checkId(req, res, next) {
  if (!DiagramStore.validId(req.params.id)) return res.status(400).json({ error: 'Invalid id' })
  next()
}
// Erreur d'écriture ou de lecture d'un dossier de données : la cause, en clair, avec le dossier
// et la marche à suivre. Le cas courant est un dossier monté créé par Docker au nom de root.
const STORAGE_CAUSES = {
  EACCES: ['the server has no right to write there', "le serveur n'a pas le droit d'y écrire"],
  EPERM: ['the server has no right to write there', "le serveur n'a pas le droit d'y écrire"],
  EROFS: ['the folder is read-only', 'le dossier est en lecture seule'],
  ENOSPC: ['the disk is full', 'le disque est plein'],
  ENOENT: ['the folder does not exist and could not be created', "le dossier n'existe pas et n'a pas pu être créé"],
  ENOTDIR: ['the folder does not exist and could not be created', "le dossier n'existe pas et n'a pas pu être créé"],
}
const RIGHTS_HINT = [
  'With Docker, the data folder must belong to the user the server runs as (PUID:PGID, 1000:1000 by default): use the latest docker-compose file, whose data-init service does it at start, or run chown -R 1000:1000 on the host folder, then restart.',
  "Avec Docker, le dossier de données doit appartenir à l'utilisateur du serveur (PUID:PGID, 1000:1000 par défaut) : reprenez le dernier fichier docker-compose, dont le service data-init le fait au démarrage, ou lancez chown -R 1000:1000 sur le dossier de l'hôte, puis redémarrez.",
]
function storageError(req, err, dir, generic) {
  const cause = STORAGE_CAUSES[err?.code]
  if (!cause) return generic
  const fr = langOf(req) === 'fr'
  const rights = err.code === 'EACCES' || err.code === 'EPERM'
  return fr
    ? `Dossier ${dir} inutilisable : ${cause[1]} (${err.code}).${rights ? ` ${RIGHTS_HINT[1]}` : ''}`
    : `Folder ${dir} unusable: ${cause[0]} (${err.code}).${rights ? ` ${RIGHTS_HINT[0]}` : ''}`
}
const failed = (req, res, err) => {
  log('[diagrams] erreur :', err.message)
  res.status(500).json({ error: storageError(req, err, diagrams.dir, T(req, 'Storage error', 'Erreur de stockage')) })
}

app.options('/diagrams', chatCors)
app.options('/diagrams/:id', chatCors)
app.get('/diagrams', chatCors, async (req, res) => {
  try { res.json({ diagrams: await diagrams.list() }) } catch (err) { failed(req, res, err) }
})
app.get('/diagrams/:id', chatCors, checkId, async (req, res) => {
  try {
    const item = await diagrams.get(req.params.id)
    if (!item) return res.status(404).json({ error: 'Not found' })
    res.json(item)
  } catch (err) { failed(req, res, err) }
})
app.put('/diagrams/:id', chatCors, checkId, xmlBody, async (req, res) => {
  const name = DiagramStore.cleanName(req.query.name)
  const kind = req.query.kind === undefined ? 'bpmn' : req.query.kind
  if (!name || !KINDS[kind] || typeof req.body !== 'string' || !req.body.includes('<')) return res.status(400).json({ error: 'Invalid diagram' })
  try { res.json(await diagrams.put(req.params.id, name, req.body, kind)) } catch (err) { failed(req, res, err) }
})
app.patch('/diagrams/:id', chatCors, checkId, async (req, res) => {
  const name = DiagramStore.cleanName(req.body?.name)
  if (!name) return res.status(400).json({ error: 'Invalid name' })
  try {
    const meta = await diagrams.rename(req.params.id, name)
    if (!meta) return res.status(404).json({ error: 'Not found' })
    res.json(meta)
  } catch (err) { failed(req, res, err) }
})
app.delete('/diagrams/:id', chatCors, checkId, async (req, res) => {
  try {
    await diagrams.remove(req.params.id)
    res.json({ ok: true })
  } catch (err) { failed(req, res, err) }
})

// ── Exports enregistrés sur le serveur ─────────────────────────────────────
// Le menu Exporter, réglé sur « Serveur » ou « Les deux », envoie ici le fichier produit.
// POST /exports?format=pdf&name=Mon%20processus → { file: "Mon processus.pdf" }

const exportsStore = new ExportStore()
const exportBody = express.raw({ type: 'application/octet-stream', limit: MAX_EXPORT_BYTES })
app.options('/exports', chatCors)
app.post('/exports', chatCors, exportBody, async (req, res) => {
  const format = req.query.format
  const name = DiagramStore.cleanName(req.query.name)
  if (!name || !ExportStore.validFormat(format)) return res.status(400).json({ error: T(req, 'Invalid name or format', 'Nom ou format invalide') })
  if (!ExportStore.validContent(format, req.body)) return res.status(400).json({ error: T(req, 'The file does not match its format', 'Le fichier ne correspond pas à son format') })
  try {
    res.json({ file: await exportsStore.save(name, format, req.body) })
  } catch (err) {
    log('[exports] erreur :', err.message)
    res.status(500).json({ error: storageError(req, err, exportsStore.dir, T(req, 'The server could not save the file', "Le serveur n'a pas pu enregistrer le fichier")) })
  }
})

// Dossier monté sans droit d'écriture pour le serveur : le dire au démarrage, avec la solution.
for (const store of [diagrams, exportsStore]) {
  store.ready.catch((err) => {
    log(`[fichiers] ${store.dir} inaccessible (${err.code || err.message}).`)
    if (err.code === 'EACCES') log('Le dossier monté doit appartenir à l\'utilisateur du conteneur : réglez PUID et PGID (voir le README).')
  })
}

function chatErrorMessage(err, lang = 'en') {
  const T = (en, fr) => (lang === 'fr' ? fr : en)
  const refused = attachmentRefused(err, lang)
  if (refused) return refused
  if (err instanceof Anthropic.AuthenticationError) return T('API key rejected. Check ANTHROPIC_API_KEY on the server.', "Clé API refusée. Vérifiez ANTHROPIC_API_KEY sur le serveur.")
  if (err instanceof Anthropic.PermissionDeniedError) return T('This API key has no access to this model.', "Cette clé API n'a pas accès à ce modèle.")
  if (err instanceof Anthropic.RateLimitError) return T('API usage limit reached, or credits used up. Try again later.', "Limite d'utilisation de l'API atteinte, ou crédits épuisés. Réessayez plus tard.")
  if (err instanceof Anthropic.BadRequestError) return T(`Request rejected by the API: ${err.message}`, `Requête refusée par l'API : ${err.message}`)
  if (err instanceof Anthropic.APIError) return T(`API error (${err.status ?? 'network'}): ${err.message}`, `Erreur de l'API (${err.status ?? 'réseau'}) : ${err.message}`)
  if (err instanceof OpenAICompatError && err.provider === 'mistral') {
    if (err.status === 401 || err.status === 403) return T('API key rejected by Mistral. Check MISTRAL_API_KEY on the server.', 'Clé API refusée par Mistral. Vérifiez MISTRAL_API_KEY sur le serveur.')
    if (err.status === 404) return T(`Model or address not found at Mistral. Check MISTRAL_BASE_URL and MISTRAL_MODELS (${err.message}).`, `Modèle ou adresse introuvable chez Mistral. Vérifiez MISTRAL_BASE_URL et MISTRAL_MODELS (${err.message}).`)
    if (err.status === 429) return T('Mistral usage limit reached, or credits used up. Try again later.', "Limite d'utilisation de Mistral atteinte, ou crédits épuisés. Réessayez plus tard.")
    if (err.status === null) return T(`Mistral unreachable. Check MISTRAL_BASE_URL (${err.message}).`, `Mistral injoignable. Vérifiez MISTRAL_BASE_URL (${err.message}).`)
    return T(`Mistral error (${err.status}): ${err.message}`, `Erreur de Mistral (${err.status}) : ${err.message}`)
  }
  if (err instanceof OpenAICompatError) {
    if (err.status === 401 || err.status === 403) return T('API key rejected by the OpenAI-compatible provider. Check OPENAI_API_KEY on the server.', 'Clé API refusée par le fournisseur compatible OpenAI. Vérifiez OPENAI_API_KEY sur le serveur.')
    if (err.status === 404) return T(`Model or address not found at the OpenAI-compatible provider. Check OPENAI_BASE_URL and OPENAI_MODELS (${err.message}).`, `Modèle ou adresse introuvable chez le fournisseur compatible OpenAI. Vérifiez OPENAI_BASE_URL et OPENAI_MODELS (${err.message}).`)
    if (err.status === 429) return T('Provider usage limit reached, or credits used up. Try again later.', "Limite d'utilisation du fournisseur atteinte, ou crédits épuisés. Réessayez plus tard.")
    if (err.status === null) return T(`OpenAI-compatible provider unreachable. Check OPENAI_BASE_URL (${err.message}).`, `Fournisseur compatible OpenAI injoignable. Vérifiez OPENAI_BASE_URL (${err.message}).`)
    return T(`OpenAI-compatible provider error (${err.status}): ${err.message}`, `Erreur du fournisseur compatible OpenAI (${err.status}) : ${err.message}`)
  }
  return err.message
}

const httpServer = app.listen(PORT, HOST, (err) => {
  if (err) {
    log('Démarrage impossible :', err.message)
    process.exit(1)
  }
  log(`Serveur MCP BPMN prêt sur http://${HOST}:${PORT}/mcp`)
  if (MCP_TOKEN) log('Les clients MCP doivent fournir le jeton MCP_TOKEN.')
  const publicHosts = MCP_ACCESS.publicHosts.join(', ')
  if (MCP_ACCESS.locked) {
    log(`ATTENTION : le serveur accepte le nom ${publicHosts} mais MCP_TOKEN est vide : /mcp est fermé (réponse 401).`)
    log('Réglez MCP_TOKEN (la fenêtre « Connecter un agent » en génère un), ou MCP_AUTH=off pour ouvrir /mcp sans jeton.')
  } else if (MCP_ACCESS.openOnPurpose) {
    log(`ATTENTION : MCP_AUTH=off, /mcp est ouvert sans jeton sous le nom ${publicHosts}.`)
    log('Quiconque atteint cette adresse peut piloter l\'éditeur, utiliser les clés d\'API du serveur et lire les diagrammes.')
  }
  if (!RELAY) log('Relais des fournisseurs de la fenêtre Options désactivé (CHAT_RELAY=off).')
  log(`Origines de l'éditeur autorisées : ${ALLOWED_ORIGINS.join(', ')}`)
  if (renderer) {
    log(`Mode sans navigateur actif : navigateur ${HEADLESS.cdpUrl}, éditeur ${HEADLESS.editorUrl}, fermeture après ${HEADLESS.idleMs / 1000} s sans appel.`)
    renderer.reachable().then((ok) => {
      if (!ok) log(`Attention : le navigateur sans écran (${HEADLESS.cdpUrl}) ne répond pas. Le service renderer est-il démarré ?`)
    })
  }
  for (const warning of chat.warnings) log(`Attention : ${warning}`)
  log(
    chat.enabled
      ? `Chat intégré actif : ${chat.models.map((m) => m.key).join(', ')} (par défaut ${chat.defaultKey})`
      : 'Chat intégré inactif : ni MISTRAL_API_KEY, ni ANTHROPIC_API_KEY, ni OPENAI_MODELS ne sont définies',
  )
})
httpServer.on('upgrade', (req, socket, head) => bridge.handleUpgrade(req, socket, head))

// Transport stdio (option --stdio, ou MCP_TRANSPORT=stdio) : le client MCP lance le serveur
// lui-même et lui parle par l'entrée et la sortie standard. Le serveur HTTP reste ouvert pour
// les onglets de l'éditeur (/bridge). Les journaux vont sur la sortie d'erreur, jamais sur la
// sortie standard qui porte le protocole.
if (process.argv.includes('--stdio') || process.env.MCP_TRANSPORT === 'stdio') {
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js')
  await buildMcpServer().connect(new StdioServerTransport())
  process.stdin.on('end', () => process.exit(0))
  log('[mcp] transport stdio actif')
}
