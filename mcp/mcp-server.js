// Serveur MCP commun au serveur de l'image docker (server.js) et au relais local de la version
// en ligne (relay.js) : chaque outil est relayé à l'onglet de l'éditeur par le pont.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { fileContent, isFileResult } from '../src/ai/file-result.js'
import { imageCaption, isImageResult } from '../src/ai/image-result.js'
import { INSTRUCTIONS } from '../src/ai/tools.js'

// tools, prompts : définitions de src/ai (buildTools, buildPrompts). before() : vérification
// faite avant chaque appel (le relais y signale un port déjà pris).
export function buildMcpServer({ bridge, tools, prompts, version, log, before = () => {} }) {
  const server = new McpServer({ name: 'bpmn-pilot', version }, { instructions: INSTRUCTIONS })
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations },
      async (args) => {
        try {
          before()
          bridge.noteMcpCall()
          const data = await bridge.call(tool.name, args ?? {}, { from: 'mcp' })
          if (isFileResult(data)) return { content: fileContent(data) }
          if (isImageResult(data)) {
            return {
              content: [
                { type: 'image', data: data.image.data, mimeType: data.image.mediaType },
                { type: 'text', text: imageCaption(data.image) },
              ],
            }
          }
          const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2)
          return { content: [{ type: 'text', text }] }
        } catch (err) {
          log(`[mcp] ${tool.name} : ${err.message}`)
          return { content: [{ type: 'text', text: `Erreur : ${err.message}` }], isError: true }
        }
      },
    )
  }
  for (const prompt of prompts) {
    server.registerPrompt(
      prompt.name,
      { title: prompt.title, description: prompt.description, argsSchema: prompt.argsSchema },
      (args) => ({ messages: [{ role: 'user', content: { type: 'text', text: prompt.text(args ?? {}) } }] }),
    )
  }
  return server
}
