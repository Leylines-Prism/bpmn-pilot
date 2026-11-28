import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'

import { EditorBridge } from '../mcp/bridge.js'
import { HeadlessRenderer, headlessConfig } from '../mcp/renderer.js'
import { fileContent, isFileResult, withoutFile } from '../src/ai/file-result.js'

const WebSocket = createRequire(new URL('../mcp/package.json', import.meta.url))('ws')
const ORIGIN = 'http://editor:8080'
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// Un onglet factice : se relie au pont et répond aux appels avec son nom.
function fakeTab(port, { name, headless, ai } = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/bridge`, { origin: ORIGIN })
  const calls = []
  ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', title: name, ...(ai ? { ai } : {}), ...(headless ? { headless } : {}) })))
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString())
    if (msg.type !== 'call') return
    calls.push(msg.tool)
    const data = msg.tool === 'get_diagram_xml' ? `<xml from="${name}"/>` : { from: name }
    ws.send(JSON.stringify({ type: 'result', id: msg.id, ok: true, data }))
  })
  return { ws, calls, ready: new Promise((r) => ws.on('open', r)) }
}

async function setup({ withRenderer = true } = {}) {
  const tabs = []
  let port
  const renderer = withRenderer
    ? {
        target: null,
        opened: 0,
        closed: 0,
        touches: 0,
        async open() {
          this.opened++
          const key = 'k'.repeat(32)
          this.target = { id: `target-${this.opened}`, key }
          tabs.push(fakeTab(port, { name: 'invisible', headless: key }))
          return key
        },
        touch() { this.touches++ },
        async close() { this.closed++; this.target = null; tabs.find((t) => t.calls && t.ws.readyState === 1 && t.headless)?.ws.close() },
      }
    : null
  const saved = []
  const bridge = new EditorBridge({
    allowedOrigins: [ORIGIN],
    log: () => {},
    renderer,
    onHeadlessCall: async (tool, send) => saved.push([tool, await send('get_diagram_xml', {})]),
  })
  const server = createServer()
  server.on('upgrade', (req, socket, head) => bridge.handleUpgrade(req, socket, head))
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  port = server.address().port
  const close = async () => {
    for (const t of tabs) t.ws.close()
    await new Promise((r) => server.close(r))
  }
  return { bridge, renderer, saved, tabs, port, close }
}

test('without the headless mode, a call with no tab fails as before', async () => {
  const s = await setup({ withRenderer: false })
  await assert.rejects(s.bridge.call('get_shapes', {}), /No BPMN editor connected/)
  await s.close()
})

test('with no tab open, a call opens the invisible tab and saves the diagram', async () => {
  const s = await setup()
  const data = await s.bridge.call('add_shapes', { shapes: [] })
  assert.deepEqual(data, { from: 'invisible' })
  assert.equal(s.renderer.opened, 1)
  assert.deepEqual(s.saved, [['add_shapes', '<xml from="invisible"/>']])
  assert.ok(s.renderer.touches >= 2)
  assert.equal(s.bridge.status().tabs, 0, 'the invisible tab is not counted as a tab')
  // Deuxième appel : même onglet invisible, pas de nouvelle ouverture.
  await s.bridge.call('get_shapes', {})
  assert.equal(s.renderer.opened, 1)
  await s.close()
})

test('a series started without a tab stays there when a tab opens (sticky target)', async () => {
  const s = await setup()
  await s.bridge.call('add_shapes', {})
  const visible = fakeTab(s.port, { name: 'visible' })
  s.tabs.push(visible)
  await visible.ready
  await wait(30)
  assert.deepEqual(await s.bridge.call('get_shapes', {}), { from: 'invisible' })
  assert.equal(visible.calls.length, 0)
  assert.equal(s.bridge.status().headless.sticky, true)
  await s.close()
})

test('an open tab is used first, and the invisible tab is never opened', async () => {
  const s = await setup()
  const visible = fakeTab(s.port, { name: 'visible' })
  s.tabs.push(visible)
  await visible.ready
  await wait(30)
  assert.deepEqual(await s.bridge.call('get_shapes', {}), { from: 'visible' })
  assert.equal(s.renderer.opened, 0)
  assert.equal(s.saved.length, 0)
  await s.close()
})

test('an open tab that picked the co-pilot sends the agent to the invisible tab', async () => {
  const s = await setup()
  const visible = fakeTab(s.port, { name: 'visible', ai: 'copilot' })
  s.tabs.push(visible)
  await visible.ready
  await wait(30)
  assert.deepEqual(await s.bridge.call('get_shapes', {}, { from: 'mcp' }), { from: 'invisible' })
  assert.equal(s.renderer.opened, 1)
  assert.deepEqual(visible.calls, [])
  await s.close()
})

test('a page cannot pass itself off as the invisible tab without its key', async () => {
  const s = await setup()
  await s.bridge.call('get_shapes', {}) // ouvre l'onglet invisible, clé « kkk… »
  const fake = fakeTab(s.port, { name: 'intruder', headless: 'x'.repeat(32) })
  s.tabs.push(fake)
  await fake.ready
  await wait(30)
  assert.equal(s.bridge.status().tabs, 1, 'a wrong key leaves it an ordinary tab')
  await s.close()
})

test('a tab that opens the diagram takes over the series', async () => {
  const s = await setup()
  const taken = []
  s.bridge.onHeadlessTake = (id) => taken.push(id)
  await s.bridge.call('add_shapes', {})
  const visible = fakeTab(s.port, { name: 'visible' })
  s.tabs.push(visible)
  await visible.ready
  visible.ws.send(JSON.stringify({ type: 'headless-take', id: 'abc' }))
  await wait(30)
  assert.deepEqual(taken, ['abc'])
  await s.close()
})

test('headless mode is off by default and reads its settings', () => {
  assert.equal(headlessConfig({}).enabled, false)
  assert.equal(headlessConfig({ MCP_HEADLESS: 'off' }).enabled, false)
  const on = headlessConfig({ MCP_HEADLESS: 'on', HEADLESS_IDLE_SECONDS: '60' })
  assert.equal(on.enabled, true)
  assert.equal(on.cdpUrl, 'http://renderer:9222')
  assert.equal(on.editorOrigin, 'http://editor:8080')
  assert.equal(on.idleMs, 60_000)
  assert.equal(headlessConfig({ MCP_HEADLESS: 'on', HEADLESS_IDLE_SECONDS: '2' }).idleMs, 300_000, 'too short a delay falls back to the default')
})

test('the renderer opens and closes pages through the DevTools HTTP interface', async () => {
  const requests = []
  const fetchImpl = async (url, init = {}) => {
    requests.push([init.method || 'GET', url])
    return { ok: true, json: async () => ({ id: 'T1' }) }
  }
  const r = new HeadlessRenderer({ cdpUrl: 'http://localhost:9222', editorUrl: 'http://editor:8080', idleMs: 60_000, log: () => {}, fetchImpl })
  const key = await r.open()
  assert.match(key, /^[0-9a-f]{32}$/)
  assert.equal(requests[0][0], 'PUT')
  assert.equal(requests[0][1], `http://localhost:9222/json/new?http://editor:8080/?headless=${key}`)
  await r.close()
  assert.equal(requests[1][1], 'http://localhost:9222/json/close/T1')
  assert.equal(r.target, null)
})

test('a returned file becomes an image or an embedded resource', () => {
  const png = { format: 'png', bytes: 3, file: { name: 'a.png', mimeType: 'image/png', data: 'AAA' } }
  const pdf = { format: 'pdf', bytes: 3, file: { name: 'a.pdf', mimeType: 'application/pdf', data: 'BBB' } }
  const svg = { format: 'svg', bytes: 6, file: { name: 'a.svg', mimeType: 'image/svg+xml', text: '<svg/>' } }
  assert.ok(isFileResult(png) && isFileResult(pdf) && isFileResult(svg))
  assert.equal(isFileResult({ format: 'png' }), false)
  assert.deepEqual(fileContent(png)[0], { type: 'image', data: 'AAA', mimeType: 'image/png' })
  assert.deepEqual(fileContent(pdf)[0].resource, { uri: 'bpmn-pilot://exports/a.pdf', mimeType: 'application/pdf', blob: 'BBB' })
  assert.equal(fileContent(svg)[0].resource.text, '<svg/>')
  assert.deepEqual(withoutFile(pdf), { format: 'pdf', bytes: 3, fileName: 'a.pdf' })
  assert.doesNotMatch(fileContent(pdf)[1].text, /BBB/, 'the caption does not repeat the content')
})
