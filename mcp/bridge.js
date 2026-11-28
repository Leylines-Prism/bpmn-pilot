// Pont WebSocket entre le serveur MCP et les onglets de l'éditeur.
//
// Chaque onglet ouvert se connecte sur /bridge. Les appels d'outils sont
// relayés à l'onglet actif le plus récemment, qui les exécute sur son
// bpmn-js et renvoie le résultat.
//
// Mode sans navigateur (renderer, voir renderer.js) : si aucun onglet n'est ouvert, un appel MCP
// ouvre l'éditeur dans un onglet invisible. Une fois commencée là, la série d'appels y reste
// (cible collante) même si un onglet s'ouvre entre-temps : l'agent ne bascule pas d'un coup sur
// le diagramme affiché par quelqu'un d'autre. Elle se termine quand l'onglet invisible se ferme.

import { randomUUID } from 'node:crypto'
import { WebSocketServer } from 'ws'

const CALL_TIMEOUT_MS = 20000
// Délai pour que l'onglet invisible charge l'éditeur et se relie au pont.
const HEADLESS_START_MS = 30000

export class EditorBridge {
  constructor({ allowedOrigins, log = console.error, renderer = null, onHeadlessCall = null, onHeadlessTake = null }) {
    this.allowedOrigins = new Set(allowedOrigins)
    this.log = log
    this.renderer = renderer
    this.onHeadlessCall = onHeadlessCall // (tool, call) après chaque appel réussi dans l'onglet invisible
    this.onHeadlessTake = onHeadlessTake // (id) un onglet visible reprend le diagramme dessiné sans éditeur
    this.sticky = false // la série d'appels MCP en cours se fait dans l'onglet invisible
    this.headlessWaiters = new Map() // clé -> resolve, en attendant que l'onglet invisible se relie
    this.starting = null // ouverture en cours de l'onglet invisible
    this.clients = new Map() // ws -> { id, title, lastActive }
    this.pending = new Map() // callId -> { resolve, reject, timer }
    this.mcpClient = null // { name, version, lastCall } du dernier client MCP connecté
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 })
    this.wss.on('connection', (ws) => this.#onConnection(ws))
  }

  // À brancher sur l'événement 'upgrade' du serveur HTTP.
  handleUpgrade(req, socket, head) {
    const { pathname } = new URL(req.url, 'http://localhost')
    if (pathname !== '/bridge') {
      socket.destroy()
      return
    }
    // Seules les pages de l'éditeur ont le droit de se connecter.
    const origin = req.headers.origin
    if (!origin || !this.allowedOrigins.has(origin)) {
      this.log(`[bridge] connexion refusée, origine non autorisée : ${origin ?? '(aucune)'}`)
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      socket.destroy()
      return
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit('connection', ws, req))
  }

  #onConnection(ws) {
    const client = { id: randomUUID().slice(0, 8), title: '', lastActive: Date.now() }
    this.clients.set(ws, client)
    // L'onglet apprend son identifiant, que le chat intégré joint à ses messages
    // pour que l'IA dessine dans l'onglet où l'on discute.
    ws.send(JSON.stringify({ type: 'welcome', id: client.id }))
    if (this.mcpClient) ws.send(JSON.stringify({ type: 'mcp-client', ...this.mcpClient }))
    this.log(`[bridge] onglet ${client.id} connecté (${this.clients.size} au total)`)

    ws.on('message', (raw) => {
      let msg
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }
      if (msg.type === 'hello' || msg.type === 'active') {
        // L'onglet invisible se présente avec la clé tirée à son ouverture : il n'entre jamais
        // en compte comme « dernier onglet utilisé ».
        if (msg.type === 'hello' && typeof msg.headless === 'string' && this.renderer?.target?.key === msg.headless) {
          client.headless = true
          this.headlessWaiters.get(msg.headless)?.({ ws, client })
          this.headlessWaiters.delete(msg.headless)
          this.log(`[bridge] onglet ${client.id} : onglet invisible du mode sans navigateur`)
        }
        if (!client.headless) client.lastActive = Date.now()
        if (typeof msg.title === 'string') client.title = msg.title
      } else if (msg.type === 'headless-take' && !client.headless && typeof msg.id === 'string') {
        client.lastActive = Date.now()
        this.onHeadlessTake?.(msg.id)
      } else if (msg.type === 'result' && this.pending.get(msg.id)?.ws === ws) {
        // Seul l'onglet qui a reçu l'appel peut y répondre.
        const { resolve, reject, timer } = this.pending.get(msg.id)
        clearTimeout(timer)
        this.pending.delete(msg.id)
        if (msg.ok) resolve(msg.data)
        else reject(new Error(msg.error || 'Unknown error in the editor'))
      }
    })

    ws.on('close', () => {
      this.clients.delete(ws)
      if (client.headless) this.sticky = false
      for (const [id, call] of this.pending) {
        if (call.ws !== ws) continue
        clearTimeout(call.timer)
        this.pending.delete(id)
        call.reject(new Error('The editor tab was closed during the call.'))
      }
      this.log(`[bridge] onglet ${client.id} déconnecté (${this.clients.size} restant)`)
    })
  }

  #activeSocket() {
    let best = null
    for (const [ws, client] of this.clients) {
      if (ws.readyState !== ws.OPEN || client.headless) continue
      if (!best || client.lastActive > best.client.lastActive) best = { ws, client }
    }
    return best
  }

  #socketById(id) {
    for (const [ws, client] of this.clients) {
      if (client.id === id && ws.readyState === ws.OPEN) return { ws, client }
    }
    return null
  }

  // Nom et version annoncés par le client MCP à sa connexion (clientInfo du
  // protocole). Le protocole ne transmet ni le modèle ni l'utilisateur.
  noteMcpClient(info) {
    const clean = (value) => (typeof value === 'string' ? value.replace(/[^\w .@()+/-]/g, '').trim().slice(0, 60) : '')
    const name = clean(info?.name)
    if (!name) return
    this.mcpClient = { name, version: clean(info?.version), seenAt: Date.now(), lastCall: this.mcpClient?.name === name ? this.mcpClient.lastCall : null }
    this.log(`[mcp] client connecté : ${name} ${this.mcpClient.version}`)
    this.#broadcastMcpClient()
  }

  // Un outil vient d'être appelé par un client MCP (pas par le chat intégré).
  noteMcpCall() {
    if (!this.mcpClient) this.mcpClient = { name: '', version: '', seenAt: null, lastCall: null }
    this.mcpClient.lastCall = Date.now()
    this.#broadcastMcpClient()
  }

  #broadcastMcpClient() {
    const msg = JSON.stringify({ type: 'mcp-client', ...this.mcpClient })
    for (const ws of this.clients.keys()) if (ws.readyState === ws.OPEN) ws.send(msg)
  }

  hasTab(id) {
    return !!this.#socketById(id)
  }

  #headlessSocket() {
    for (const [ws, client] of this.clients) {
      if (client.headless && ws.readyState === ws.OPEN) return { ws, client }
    }
    return null
  }

  // Message à tous les onglets visibles (par exemple : un diagramme dessiné sans éditeur).
  notifyTabs(message) {
    const text = JSON.stringify(message)
    for (const [ws, client] of this.clients) if (!client.headless && ws.readyState === ws.OPEN) ws.send(text)
  }

  status() {
    const active = this.#activeSocket()
    const tabs = [...this.clients.values()].filter((c) => !c.headless).length
    return {
      tabs,
      activeTab: active?.client.id ?? null,
      ...(this.renderer ? { headless: { enabled: true, open: !!this.#headlessSocket(), sticky: this.sticky } } : {}),
    }
  }

  // Onglet invisible prêt à recevoir un appel : celui qui est ouvert, sinon un nouveau.
  async #ensureHeadless() {
    const open = this.#headlessSocket()
    if (open) return open
    this.starting ??= (async () => {
      let key
      try {
        key = await this.renderer.open()
      } catch (err) {
        throw new Error(`No BPMN editor is open, and the headless browser could not be reached (${err.message}). Check that the renderer service is running.`, { cause: err })
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.headlessWaiters.delete(key)
          this.renderer.close()
          reject(new Error(`The headless editor did not start within ${HEADLESS_START_MS / 1000} s.`))
        }, HEADLESS_START_MS)
        this.headlessWaiters.set(key, (target) => {
          clearTimeout(timer)
          resolve(target)
        })
      })
    })().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  // Cible d'un appel MCP (sans tabId) : la série en cours dans l'onglet invisible, sinon le
  // dernier onglet utilisé, sinon l'onglet invisible s'il est permis.
  async #mcpTarget() {
    if (this.sticky) {
      const open = this.#headlessSocket()
      if (open) return open
      this.sticky = false
    }
    const active = this.#activeSocket()
    if (active || !this.renderer) return active
    const target = await this.#ensureHeadless()
    this.sticky = true
    return target
  }

  // Exécute un outil dans un onglet et renvoie son résultat : l'onglet
  // indiqué par tabId (chat intégré), sinon l'onglet actif (clients MCP). from : « mcp »
  // pour un appel d'agent, que l'onglet refuse si le Co-pilote y est l'IA active.
  async call(tool, args, { tabId, from } = {}) {
    const target = tabId ? this.#socketById(tabId) : await this.#mcpTarget()
    if (!target) {
      return Promise.reject(
        new Error(
          tabId
            ? 'The editor tab is no longer connected to the server.'
            : 'No BPMN editor connected. Open the editor in the browser, then try again.',
        ),
      )
    }
    if (target.client.headless) {
      this.renderer.touch()
      const data = await this.#send(target, tool, args, from)
      this.renderer.touch()
      try {
        await this.onHeadlessCall?.(tool, (name, a) => this.#send(target, name, a))
      } catch (err) {
        this.log(`[headless] enregistrement impossible : ${err.message}`)
      }
      return data
    }
    return this.#send(target, tool, args, from)
  }

  #send(target, tool, args, from) {
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`The editor did not answer within ${CALL_TIMEOUT_MS / 1000} s.`))
      }, CALL_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer, ws: target.ws })
      target.ws.send(JSON.stringify({ type: 'call', id, tool, args, ...(from ? { from } : {}) }))
    })
  }
}
