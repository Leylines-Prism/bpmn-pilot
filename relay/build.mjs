// Construit le relais local de la version en ligne (mcp/relay.js) en un seul fichier, pour le
// paquet npm (relay/dist) et pour l'extension Claude Desktop (relay/dist/mcpb, à empaqueter avec
// `mcpb pack`). Lancé par `npm run build:relay` à la racine.

import { build } from 'rolldown'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import * as z from 'zod/v4'
import { buildTools } from '../src/ai/tools.js'
import { buildPrompts } from '../src/ai/prompts.js'

const here = (path) => new URL(path, import.meta.url)
const read = (path) => JSON.parse(readFileSync(here(path), 'utf8'))
const version = read('./package.json').version

await build({
  input: here('../mcp/relay.js').pathname,
  platform: 'node',
  transform: { define: { __RELAY_VERSION__: JSON.stringify(version) } },
  output: { file: here('./dist/bpmn-pilot-mcp.mjs').pathname, format: 'esm' },
  logLevel: 'warn',
})

// Extension Claude Desktop : manifeste (version et liste des outils), relais, icône.
const manifest = read('./manifest.json')
manifest.version = version
manifest.tools = buildTools(z).map((t) => ({ name: t.name, description: t.title }))
manifest.prompts = buildPrompts(z).map((p) => ({ name: p.name, description: p.title, text: p.text({}) }))
mkdirSync(here('./dist/mcpb/server'), { recursive: true })
writeFileSync(here('./dist/mcpb/manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
copyFileSync(here('./dist/bpmn-pilot-mcp.mjs'), here('./dist/mcpb/server/index.mjs'))
copyFileSync(here('../public/icons/icon-512.png'), here('./dist/mcpb/icon.png'))
console.log(`relay ${version}: relay/dist/bpmn-pilot-mcp.mjs, relay/dist/mcpb/`)
