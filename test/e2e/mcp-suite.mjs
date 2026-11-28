// Campagne MCP : appelle chaque outil, chaque prompt et chaque route HTTP du serveur, sur un
// éditeur ouvert (onglet piloté par ui-suite.mjs ou ouvert à la main) ou en mode sans navigateur.
//
//   node test/e2e/mcp-suite.mjs --url http://localhost:8080 [--token XXX] [--out dossier]
//
// Échoue si le serveur publie un outil ou un prompt que la campagne n'appelle pas : un outil
// ajouté par une PR doit recevoir son scénario ici avant la release.
// Les fichiers exportés (PNG, PDF, DOCX…) sont écrits dans --out pour une relecture à l'œil.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(new URL('../../mcp/package.json', import.meta.url))
const { Client } = require('@modelcontextprotocol/sdk/client/index.js')
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js')

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') ? true : all[i + 1] ?? true]] : acc), []),
)
const BASE = String(args.url || 'http://localhost:8080').replace(/\/$/, '')
const TOKEN = args.token && args.token !== true ? String(args.token) : process.env.MCP_TOKEN || ''
const OUT = String(args.out || 'test-results/mcp')
mkdirSync(OUT, { recursive: true })

const results = []
let failed = 0
function record(name, ok, detail = '') {
  results.push({ name, ok, detail })
  if (!ok) failed++
  console.log(`${ok ? 'OK  ' : 'ÉCHEC'} ${name}${detail ? ` : ${detail}` : ''}`)
}
async function step(name, fn) {
  try {
    const detail = await fn()
    record(name, true, typeof detail === 'string' ? detail : '')
  } catch (err) {
    record(name, false, err.message.slice(0, 400))
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg)
}

// ---------------------------------------------------------------- HTTP (API du serveur)

const auth = TOKEN ? { authorization: `Bearer ${TOKEN}` } : {}
// Les routes /chat, /diagrams et /exports servent la page : elles exigent l'origine de l'éditeur.
async function http(path, init = {}, { origin = BASE } = {}) {
  const headers = { ...(init.headers || {}) }
  if (origin && !headers.origin && !path.startsWith('/mcp')) headers.origin = origin
  const res = await fetch(BASE + path, { ...init, headers })
  const type = res.headers.get('content-type') || ''
  const body = type.includes('json') ? await res.json() : await res.text()
  return { status: res.status, body, headers: res.headers }
}

async function httpSuite(headless) {
  await step('HTTP /healthz', async () => {
    const r = await http('/healthz')
    assert(r.status === 200, `statut ${r.status}`)
    return JSON.stringify(r.body).slice(0, 200)
  })
  if (headless) {
    await step('HTTP /healthz/headless', async () => {
      const r = await http('/healthz/headless')
      assert(r.status === 200, `statut ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`)
    })
  }
  await step('HTTP GET /chat (état des fournisseurs)', async () => {
    const r = await http('/chat')
    assert(r.status === 200 && typeof r.body === 'object', `statut ${r.status}`)
    return `relay=${r.body.relay} mcpAuth=${r.body.mcpAuth}`
  })
  await step('HTTP POST /chat/models sans fournisseur : refus propre', async () => {
    const r = await http('/chat/models', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    assert(r.status >= 400 && r.status < 500, `statut ${r.status} attendu 4xx`)
  })
  await step('HTTP POST /chat/models vers une adresse interdite : refus', async () => {
    const r = await http('/chat/models', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', baseUrl: 'http://169.254.169.254/latest', apiKey: 'x' }),
    })
    assert(r.status >= 400, `statut ${r.status} : l'adresse de métadonnées doit être refusée`)
  })
  const id = `e2e-${Date.now()}`
  const xml = minimalXml('Diagramme HTTP')
  await step('HTTP PUT /diagrams/:id', async () => {
    const r = await http(`/diagrams/${id}?name=${encodeURIComponent('Diagramme HTTP')}`, { method: 'PUT', headers: { 'content-type': 'application/xml' }, body: xml })
    assert(r.status < 300, `statut ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`)
  })
  await step('HTTP GET /diagrams (liste)', async () => {
    const r = await http('/diagrams')
    assert(r.status === 200, `statut ${r.status}`)
    assert(JSON.stringify(r.body).includes(id), 'le diagramme enregistré manque dans la liste')
  })
  await step('HTTP GET /diagrams/:id', async () => {
    const r = await http(`/diagrams/${id}`)
    assert(r.status === 200 && JSON.stringify(r.body).includes('Diagramme HTTP'), `statut ${r.status}`)
  })
  await step('HTTP PATCH /diagrams/:id (renommer)', async () => {
    const r = await http(`/diagrams/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Diagramme HTTP renommé' }) })
    assert(r.status === 200, `statut ${r.status}`)
  })
  await step('HTTP GET /diagrams/:id invalide : refus', async () => {
    const r = await http('/diagrams/..%2F..%2Fetc%2Fpasswd')
    assert(r.status >= 400, `statut ${r.status}`)
  })
  await step('HTTP /diagrams depuis une autre origine : 403', async () => {
    const r = await http('/diagrams', {}, { origin: 'https://evil.example.com' })
    assert(r.status === 403, `statut ${r.status}`)
  })
  await step('HTTP DELETE /diagrams/:id', async () => {
    const r = await http(`/diagrams/${id}`, { method: 'DELETE' })
    assert(r.status < 300, `statut ${r.status}`)
    const again = await http(`/diagrams/${id}`)
    assert(again.status === 404, `toujours là après suppression (${again.status})`)
  })
  await step('HTTP POST /exports', async () => {
    const r = await http('/exports?format=bpmn&name=e2e-export', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: Buffer.from(xml) })
    assert(r.status < 300, `statut ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`)
    return JSON.stringify(r.body).slice(0, 160)
  })
  await step('HTTP POST /exports (contenu qui ne correspond pas au format) : refus', async () => {
    const r = await http('/exports?format=pdf&name=e2e-faux', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: Buffer.from('pas un pdf') })
    assert(r.status === 400, `statut ${r.status}`)
  })
  await step('HTTP GET /mcp : 405', async () => {
    const r = await http('/mcp', { headers: auth })
    assert(r.status === 405, `statut ${r.status}`)
  })
  if (TOKEN) {
    await step('HTTP POST /mcp sans jeton : 401', async () => {
      const r = await http('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' })
      assert(r.status === 401, `statut ${r.status}`)
    })
    await step('HTTP POST /mcp avec un faux jeton : 401', async () => {
      const r = await http('/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer faux' }, body: '{}' })
      assert(r.status === 401, `statut ${r.status}`)
    })
  }
  await step('HTTP POST /mcp depuis une autre origine : refus', async () => {
    const r = await http('/mcp', {
      method: 'POST',
      headers: { ...auth, origin: 'https://evil.example.com', 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    })
    assert(r.status >= 400, `statut ${r.status}`)
  })
}

// ---------------------------------------------------------------- MCP

function minimalXml(name = 'Campagne de tests') {
  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" id="Defs" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_e2e" name="${name}" isExecutable="false"><bpmn:startEvent id="Start" name="Commande reçue" /></bpmn:process>
  <bpmndi:BPMNDiagram id="D"><bpmndi:BPMNPlane id="PL" bpmnElement="Process_e2e">
    <bpmndi:BPMNShape id="Start_di" bpmnElement="Start"><dc:Bounds x="152" y="182" width="36" height="36" /></bpmndi:BPMNShape>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`
}

const text = (r) => (r.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n')
const json = (r) => {
  try {
    return JSON.parse(text(r))
  } catch {
    return null
  }
}

// Parcourt un résultat et rend la liste de tous les objets { id, name, type }.
function elementsOf(data) {
  const out = []
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk)
    else if (v && typeof v === 'object') {
      if (typeof v.id === 'string' && (v.type || v.name !== undefined)) out.push(v)
      Object.values(v).forEach(walk)
    }
  }
  walk(data)
  return out
}

const covered = new Set()
let client
// nginx limite /mcp, /diagrams et /exports à 300 requêtes par minute et par adresse (pointe de 100).
// Un agent réel attend son modèle entre deux appels ; la campagne s'espace pour rester sous ce plafond.
const PACE = Number(args.pace ?? 250)
let lastCall = 0
async function call(name, input = {}, { expectError = false } = {}) {
  covered.add(name)
  const wait = lastCall + PACE - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastCall = Date.now()
  const r = await client.callTool({ name, arguments: input }, undefined, { timeout: 120_000 })
  if (expectError) assert(r.isError, `${name} aurait dû échouer, réponse : ${text(r).slice(0, 200)}`)
  else assert(!r.isError, `${name} : ${text(r).slice(0, 300)}`)
  return r
}

async function shapes() {
  return elementsOf(json(await call('get_shapes')))
}
async function idOf(name) {
  const el = (await shapes()).find((e) => e.name === name || e.text === name)
  assert(el, `élément « ${name} » introuvable`)
  return el.id
}

const FILE_CHECKS = {
  bpmn: (b) => b.includes('bpmn:definitions') || b.includes('<definitions'),
  svg: (b) => b.includes('<svg'),
  png: (b, raw) => raw[0] === 0x89 && raw[1] === 0x50,
  pdf: (b) => b.startsWith('%PDF'),
  dmn: (b) => b.includes('definitions') && b.includes('decision'),
  forms: (b, raw) => (raw[0] === 0x50 && raw[1] === 0x4b) || b.includes('"components"'),
  camunda8: (b) => b.includes('zeebe') || b.includes('isExecutable="true"'),
  camunda7: (b) => b.includes('camunda') || b.includes('isExecutable="true"'),
  'report-pdf': (b) => b.startsWith('%PDF'),
  'report-md': (b) => b.includes('#'),
  'report-docx': (b, raw) => raw[0] === 0x50 && raw[1] === 0x4b,
  'sheets-pdf': (b) => b.startsWith('%PDF'),
  'sheets-md': (b) => b.includes('#'),
  'sheets-docx': (b, raw) => raw[0] === 0x50 && raw[1] === 0x4b,
  'doc-html': (b) => /<html/i.test(b),
  'stories-md': (b) => b.includes('#'),
  'raci-xlsx': (b, raw) => raw[0] === 0x50 && raw[1] === 0x4b,
}
const EXT = { forms: 'form', camunda8: 'bpmn', camunda7: 'bpmn', 'report-pdf': 'pdf', 'report-md': 'md', 'report-docx': 'docx', 'sheets-pdf': 'pdf', 'sheets-md': 'md', 'sheets-docx': 'docx', 'doc-html': 'html', 'stories-md': 'md', 'raci-xlsx': 'xlsx' }

function fileFrom(r) {
  for (const c of r.content || []) {
    if (c.type === 'image') return Buffer.from(c.data, 'base64')
    if (c.type === 'resource') {
      const res = c.resource
      if (res.blob) return Buffer.from(res.blob, 'base64')
      if (res.text) return Buffer.from(res.text)
    }
  }
  // Fichier texte rendu dans le texte de la réponse.
  const t = text(r)
  return t ? Buffer.from(t) : null
}

const LOG_CSV = ['case,activity,timestamp,resource']
for (let c = 1; c <= 20; c++) {
  const t0 = Date.UTC(2026, 10, 1, 8) + c * 3_600_000
  const at = (m) => new Date(t0 + m * 60_000).toISOString()
  LOG_CSV.push(`C${c},Recevoir la commande,${at(0)},Alice`, `C${c},Vérifier le stock,${at(30)},Bob`)
  LOG_CSV.push(c % 4 === 0 ? `C${c},Refuser la commande,${at(60)},Bob` : `C${c},Expédier,${at(90)},Chloé`)
}

async function mcpSuite() {
  await step('MCP initialize', async () => {
    client = new Client({ name: 'bpmn-pilot-e2e', version: '1.0.0' })
    const transport = new StreamableHTTPClientTransport(new URL(BASE + '/mcp'), { requestInit: { headers: auth } })
    await client.connect(transport)
    const v = client.getServerVersion()
    return `${v?.name} ${v?.version}`
  })
  if (!client) return

  const { tools } = await client.listTools()
  const { prompts } = await client.listPrompts()
  record('MCP tools/list', tools.length > 0, `${tools.length} outils`)
  record('MCP prompts/list', prompts.length > 0, `${prompts.length} prompts`)
  await step('MCP : chaque outil a un titre, une description et des annotations', async () => {
    const bad = tools.filter((t) => !t.description || !t.annotations || !(t.title || t.annotations?.title)).map((t) => t.name)
    assert(!bad.length, bad.join(', '))
  })

  // Diagramme de départ.
  await step('set_diagram_xml', () => call('set_diagram_xml', { xml: minimalXml() }))
  await step('set_diagram_xml (XML illisible refusé)', () => call('set_diagram_xml', { xml: '<pas du bpmn' }, { expectError: true }))
  await step('add_shapes (chaîne, passerelle, couloir de bout)', async () => {
    const start = await idOf('Commande reçue')
    const r = await call('add_shapes', {
      shapes: [
        { key: 'recv', type: 'UserTask', name: 'Recevoir la commande', after: start },
        { key: 'stock', type: 'ServiceTask', name: 'Vérifier le stock', after: 'recv' },
        { key: 'gw', type: 'ExclusiveGateway', name: 'En stock ?', after: 'stock' },
        { key: 'ship', type: 'Task', name: 'Expédier', after: 'gw' },
        { key: 'end1', type: 'EndEvent', name: 'Commande expédiée', after: 'ship' },
        { key: 'refuse', type: 'Task', name: 'Refuser la commande', x: 700, y: 380 },
        { key: 'end2', type: 'EndEvent', name: 'Commande refusée', after: 'refuse' },
        { key: 'timer', type: 'BoundaryEvent', name: '48 h', attachTo: 'ship', eventDefinition: 'TimerEventDefinition' },
        { key: 'note', type: 'TextAnnotation', name: 'Créé par la campagne de tests', x: 400, y: 80 },
      ],
    })
    return text(r).slice(0, 120)
  })
  await step('add_shapes (type inconnu refusé, rien ajouté)', async () => {
    const before = (await shapes()).length
    await call('add_shapes', { shapes: [{ type: 'Task', name: 'ok' }, { type: 'PasUnType', name: 'ko' }] }, { expectError: true })
    assert((await shapes()).length === before, 'un ajout partiel est resté')
  })
  await step('connect_shapes', async () => {
    await call('connect_shapes', { connections: [{ source: await idOf('En stock ?'), target: await idOf('Refuser la commande'), name: 'Non' }] })
  })
  await step('get_shapes', async () => {
    const all = await shapes()
    assert(all.length >= 10, `${all.length} éléments seulement`)
    return `${all.length} éléments`
  })

  // Les deux branches de la passerelle.
  const els = elementsOf(json(await call('get_shapes')))
  const gw = els.find((e) => e.name === 'En stock ?')?.id
  const flows = els.filter((e) => /SequenceFlow/.test(e.type || '') && e.source === gw)
  const toShip = flows.find((f) => f.name !== 'Non')?.id
  const toRefuse = flows.find((f) => f.name === 'Non')?.id
  const root = els.find((e) => /Process|Collaboration/.test(e.type || ''))?.id || 'Process_e2e'

  await step('update_elements (probabilités, conditions, RACI, documentation, identité)', async () => {
    const recv = await idOf('Recevoir la commande')
    const elements = [
      {
        id: recv,
        documentation: '## Rôle\nSaisir la commande **reçue**.',
        assignee: 'Service client',
        systems: 'ERP, messagerie',
        accountable: 'Responsable ventes',
        consulted: 'Logistique',
        informed: 'Client',
        aiPotential: 'assist',
        aiPotentialReason: 'Extraction des champs, relecture humaine.',
        risks: 'Commande mal saisie',
        controls: 'Double vérification',
        requirements: 'RGPD art. 30',
        userStories: 'En tant que client, je veux un accusé de réception, afin de savoir que ma commande est prise.',
        acceptanceCriteria: 'Étant donné une commande, quand elle est saisie, alors un accusé part.',
      },
      { id: root, owner: 'Direction des opérations', version: '1.0', status: 'draft', scope: 'De la réception à l’expédition.' },
    ]
    if (toShip) elements.push({ id: toShip, probability: 75, condition: 'stock > 0', name: 'Oui' })
    if (toRefuse) elements.push({ id: toRefuse, probability: 25 })
    await call('update_elements', { elements })
    assert(toShip && toRefuse, 'branches de la passerelle introuvables')
  })
  await step('style_elements', async () => {
    const r = await call('style_elements', { elements: [{ id: await idOf('Expédier'), fill: '#1E88E5', textColor: 'auto', bold: true, fontSize: 14 }] })
    return text(r).slice(0, 100)
  })
  await step('style_elements (couleur invalide refusée)', async () =>
    call('style_elements', { elements: [{ id: await idOf('Expédier'), fill: 'rouge' }] }, { expectError: true }))
  await step('move_elements', async () => call('move_elements', { elements: [{ id: await idOf('Refuser la commande'), dx: 40, dy: 20 }] }))
  await step('move_elements (id inconnu : rien ne bouge)', () => call('move_elements', { elements: [{ id: 'Nope', dx: 10, dy: 0 }] }, { expectError: true }))
  await step('duplicate_elements puis remove_elements', async () => {
    const original = await idOf('Refuser la commande')
    const r = await call('duplicate_elements', { ids: [original], dy: 200 })
    const copies = (await shapes()).filter((e) => e.name === 'Refuser la commande' && e.id !== original)
    assert(copies.length === 1, `${copies.length} copie(s) après duplication : ${text(r).slice(0, 160)}`)
    await call('remove_elements', { ids: [copies[0].id] })
    assert((await shapes()).filter((e) => e.name === 'Refuser la commande').length === 1, 'la copie est restée')
    return `copie ${copies[0].id}`
  })
  await step('remove_elements (id inconnu refusé)', () => call('remove_elements', { ids: ['Nope'] }, { expectError: true }))
  await step('undo puis redo', async () => {
    const before = (await shapes()).length
    await call('add_shapes', { shapes: [{ type: 'Task', name: 'À annuler', x: 900, y: 500 }] })
    await call('undo')
    assert((await shapes()).length === before, 'undo n’a pas retiré la tâche')
    await call('redo')
    assert((await shapes()).length === before + 1, 'redo n’a pas remis la tâche')
    await call('remove_elements', { ids: [await idOf('À annuler')] })
  })
  await step('layout_diagram', async () => text(await call('layout_diagram')).slice(0, 120))
  // « Ranger » ne change que les positions : couleurs et mise en forme du texte restent.
  await step('layout_diagram garde couleurs et mise en forme du texte', async () => {
    const xml = text(await call('get_diagram_xml'))
    assert(/bioc:fill="#1e88e5"/i.test(xml), 'couleur de fond perdue')
    assert(/isBold="true"/.test(xml), 'gras perdu (BPMNLabelStyle absent après rangement)')
  })
  await step('auto_layout (ancien nom)', async () => text(await call('auto_layout')).slice(0, 80))
  await step('validate_diagram', async () => text(await call('validate_diagram')).slice(0, 160))

  // Décisions (DMN).
  let decisionId
  await step('set_decision_table (liée à « Vérifier le stock »)', async () => {
    const r = await call('set_decision_table', {
      name: 'Choisir le transporteur',
      hitPolicy: 'FIRST',
      inputs: [{ label: 'Poids', expression: 'poids', type: 'number' }, { label: 'Pays', expression: 'pays', type: 'string', values: ['FR', 'BE', 'CH'] }],
      outputs: [{ label: 'Transporteur', name: 'transporteur', type: 'string' }],
      rules: [
        { inputs: ['< 2', '"FR"'], outputs: ['"La Poste"'] },
        { inputs: ['>= 2', '-'], outputs: ['"Transporteur lourd"'] },
        { inputs: ['-', '-'], outputs: ['"International"'], annotation: 'Par défaut' },
      ],
      linkTo: await idOf('Vérifier le stock'),
    })
    decisionId = json(r)?.decisionId || json(r)?.id || /Decision_[A-Za-z0-9_]+/.exec(text(r))?.[0]
    assert(decisionId, `id de décision introuvable dans ${text(r).slice(0, 200)}`)
    return decisionId
  })
  await step('get_decisions', async () => {
    const t = text(await call('get_decisions'))
    assert(t.includes('Choisir le transporteur'), 'décision absente')
  })
  await step('test_decision', async () => {
    const t = text(await call('test_decision', { decisionId, cases: [[1, 'FR'], { Poids: 5, Pays: 'BE' }] }))
    assert(t.includes('La Poste') && t.includes('Transporteur lourd'), t.slice(0, 300))
  })
  await step('link_decision (délier puis relier)', async () => {
    const task = await idOf('Vérifier le stock')
    await call('link_decision', { elementId: task, decisionId: '' })
    await call('link_decision', { elementId: task, decisionId })
  })

  // Formulaires des tâches (form-js).
  await step('set_task_form (tâche utilisateur)', async () => {
    const r = await call('set_task_form', {
      elementId: await idOf('Recevoir la commande'),
      title: 'Saisir la commande',
      intro: 'Remplissez **tous** les champs.',
      fields: [
        { key: 'client', label: 'Client', required: true },
        { key: 'montant', label: 'Montant', type: 'number', min: 0 },
        { key: 'pays', label: 'Pays', type: 'select', values: ['FR', 'BE', 'CH'] },
        { key: 'urgent', label: 'Urgent', type: 'checkbox' },
      ],
    })
    return text(r).slice(0, 120)
  })
  await step('set_task_form (radio sans valeurs refusé)', async () =>
    call('set_task_form', { elementId: await idOf('Recevoir la commande'), fields: [{ label: 'Choix', type: 'radio' }] }, { expectError: true }))
  await step('set_task_form (deux champs avec la même clé refusés)', async () =>
    call('set_task_form', { elementId: await idOf('Recevoir la commande'), fields: [{ key: 'a', label: 'A' }, { key: 'a', label: 'B' }] }, { expectError: true }))
  await step('set_task_form (élément inconnu refusé)', () => call('set_task_form', { elementId: 'Nope', fields: [{ label: 'A' }] }, { expectError: true }))
  await step('get_task_forms', async () => {
    const t = text(await call('get_task_forms'))
    assert(t.includes('montant') || t.includes('Montant'), t.slice(0, 200))
  })
  await step('get_task_forms (schéma complet d’un élément)', async () => {
    const t = text(await call('get_task_forms', { elementId: await idOf('Recevoir la commande') }))
    assert(t.includes('components') || t.includes('"type"'), 'schéma form-js absent')
  })

  // Rapport, analyse, journal d'événements.
  await step('get_process_report (avec 100 jetons)', async () => {
    const t = text(await call('get_process_report', { simulate: true }))
    assert(t.length > 200, 'rapport trop court')
    return `${t.length} caractères`
  })
  await step('set_report_commentary', async () =>
    call('set_report_commentary', {
      summary: 'Le processus est court. Un quart des commandes est refusé faute de stock.',
      points: [{ kind: 'bottleneck', text: 'La vérification du stock attend l’ERP.', elements: [await idOf('Vérifier le stock')] }],
    }))
  await step('load_event_log (CSV de 20 cas)', async () => text(await call('load_event_log', { content: LOG_CSV.join('\n'), name: 'commandes-e2e.csv', format: 'csv' })).slice(0, 120))
  await step('get_log_summary', async () => {
    const t = text(await call('get_log_summary', { activities: 1, paths: 0.9 }))
    assert(t.includes('Expédier'), t.slice(0, 200))
  })
  await step('map_log_activities', async () => call('map_log_activities', { mapping: { Expédier: await idOf('Expédier') } }))
  await step('apply_log_frequencies', () => call('apply_log_frequencies'))
  await step('check_conformance', async () => text(await call('check_conformance')).slice(0, 120))

  // Lecture et exports.
  await step('get_diagram_xml', async () => {
    const t = text(await call('get_diagram_xml'))
    assert(t.includes('BPMNDiagram') && t.includes('Expédier'), 'XML incomplet')
    writeFileSync(join(OUT, 'diagramme.bpmn'), t)
  })
  await step('get_diagram_image', async () => {
    const r = await call('get_diagram_image')
    const img = r.content.find((c) => c.type === 'image')
    assert(img, 'pas d’image dans la réponse')
    writeFileSync(join(OUT, 'get_diagram_image.png'), Buffer.from(img.data, 'base64'))
  })
  for (const format of Object.keys(FILE_CHECKS)) {
    await step(`export_diagram ${format}`, async () => {
      const r = await call('export_diagram', { format, name: `e2e-${format}`, returnFile: true })
      const raw = fileFrom(r)
      assert(raw && raw.length > 50, 'fichier vide')
      assert(FILE_CHECKS[format](raw.toString('latin1').slice(0, 4000), raw), 'contenu inattendu')
      writeFileSync(join(OUT, `export-${format}.${EXT[format] || format}`), raw)
      return `${raw.length} octets`
    })
  }

  // Outils publiés mais absents du scénario : échec, pour forcer la mise à jour de la campagne.
  const missing = tools.map((t) => t.name).filter((n) => !covered.has(n))
  record('Couverture des outils', missing.length === 0, missing.length ? `non appelés : ${missing.join(', ')}` : `${covered.size}/${tools.length}`)

  // Prompts : chacun se lit avec des arguments d'exemple et rend un texte.
  const SAMPLE = { decisionId: 'Decision_1', name: 'Choisir le transporteur', description: 'Un client commande, on vérifie le stock, on expédie ou on refuse.', goal: 'Qualifier la demande', after: '', framework: 'GDPR' }
  for (const p of prompts) {
    await step(`prompt ${p.name}`, async () => {
      const a = {}
      for (const arg of p.arguments || []) if (arg.required || SAMPLE[arg.name]) a[arg.name] = SAMPLE[arg.name] ?? 'exemple'
      await new Promise((r) => setTimeout(r, PACE))
      const r = await client.getPrompt({ name: p.name, arguments: a })
      const t = r.messages.map((m) => m.content?.text || '').join('')
      assert(t.length > 40, 'texte vide')
    })
  }
  await client.close()
}

const headless = Boolean(args.headless)
// --open-tab : ouvre l'éditeur dans un Chromium piloté, comme un utilisateur qui garde l'onglet
// ouvert. Sans lui, le serveur doit avoir un onglet ouvert à la main ou le mode sans navigateur.
let browser
if (args['open-tab']) {
  const { chromium } = createRequire(import.meta.url)('playwright')
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', (err) => record('onglet : erreur JavaScript', false, err.message))
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(2000)
}
await httpSuite(headless)
await mcpSuite()
writeFileSync(join(OUT, 'resultats.json'), JSON.stringify({ base: BASE, headless, date: new Date().toISOString(), results }, null, 2))
await browser?.close()
console.log(`\n${results.length - failed}/${results.length} réussis. Fichiers dans ${OUT}`)
process.exit(failed ? 1 : 0)
