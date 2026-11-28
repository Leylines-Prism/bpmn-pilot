#!/usr/bin/env node
// Relais local de la version en ligne de BPMN Pilot.
//
// L'agent (Claude Desktop, Cursor, VS Code, Claude Code…) lance ce programme et lui parle en
// stdio. La page en ligne, ouverte dans le navigateur du même poste, s'y connecte par
// ws://127.0.0.1:3333/bridge et exécute les outils sur son diagramme. Le relais ne fait que passer
// les messages : il n'écrit rien sur le disque, n'appelle aucun service et n'ouvre aucune autre
// route que /bridge (et /healthz pour vérifier qu'il tourne).
//
// Variables facultatives :
//   MCP_PORT            port local du pont (3333 par défaut, celui qu'attend la page)
//   BPMN_EDITOR_ORIGINS adresses de l'éditeur autorisées, séparées par des virgules
//                       (https://bpmn.leylines.fr par défaut)

import { createServer } from 'node:http'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import * as z from 'zod/v4'

import { EditorBridge } from './bridge.js'
import { buildMcpServer } from './mcp-server.js'
import { buildTools } from '../src/ai/tools.js'
import { buildPrompts } from '../src/ai/prompts.js'

// Remplacée par la version de l'application lors de l'empaquetage (relay/build.mjs).
/* global __RELAY_VERSION__ */
const VERSION = typeof __RELAY_VERSION__ === 'string' ? __RELAY_VERSION__ : 'dev'
const HOST = '127.0.0.1'
const PORT = Number(process.env.MCP_PORT || 3333)
const ORIGINS = (process.env.BPMN_EDITOR_ORIGINS || 'https://bpmn.leylines.fr')
  .split(',')
  .map((s) => s.trim().replace(/\/$/, ''))
  .filter(Boolean)

// Le protocole passe par la sortie standard : les journaux vont sur la sortie d'erreur, que les
// agents affichent dans leurs journaux de serveur MCP.
const log = (...args) => console.error(new Date().toLocaleTimeString('fr-FR'), '[bpmn-pilot]', ...args)

const bridge = new EditorBridge({ allowedOrigins: ORIGINS, log })
let listenError = null

// Pont local : 127.0.0.1 seulement, nom d'hôte local exigé (protection contre le DNS rebinding),
// origine de l'éditeur contrôlée par le pont.
const LOCAL_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`])
const http = createServer((req, res) => {
  const ok = LOCAL_HOSTS.has(req.headers.host) && req.method === 'GET' && req.url === '/healthz'
  res.writeHead(ok ? 200 : 404, { 'content-type': 'application/json' })
  res.end(JSON.stringify(ok ? { ok: true, relay: VERSION, ...bridge.status() } : { error: 'Not found' }))
})
http.on('upgrade', (req, socket, head) => {
  if (!LOCAL_HOSTS.has(req.headers.host)) return socket.destroy()
  bridge.handleUpgrade(req, socket, head)
})
http.on('error', (err) => {
  listenError = err.code === 'EADDRINUSE'
    ? `Port ${PORT} is already in use on this computer, often by another BPMN Pilot relay started by another agent. Close that agent (or the program using the port), then restart this one.`
    : `The local bridge could not start: ${err.message}`
  log(listenError)
})
http.listen(PORT, HOST, () => {
  log(`relais ${VERSION} prêt : pont ws://${HOST}:${PORT}/bridge, éditeur autorisé : ${ORIGINS.join(', ')}`)
})

const server = buildMcpServer({
  bridge,
  tools: buildTools(z),
  prompts: buildPrompts(z),
  version: VERSION,
  log,
  before: () => {
    if (listenError) throw new Error(listenError)
    if (!bridge.status().tabs) {
      throw new Error(
        `No BPMN Pilot tab is connected. Open ${ORIGINS[0]} in a browser on this computer, click "Connect an agent" and turn on the local agent, then try again.`,
      )
    }
  },
})
// Le nom de l'agent s'affiche sur le badge de la page.
server.server.oninitialized = () => bridge.noteMcpClient(server.server.getClientVersion())
await server.connect(new StdioServerTransport())
process.stdin.on('end', () => process.exit(0))
