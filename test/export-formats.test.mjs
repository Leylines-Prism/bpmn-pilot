// Formats de l'outil export_diagram (src/ai/tools.js, qui n'importe rien) : les mêmes que ceux
// que l'éditeur sait produire (src/export-files.js), et que le serveur sait ranger (mcp/exports.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as z from 'zod'
import { EXPORT_FORMATS as TOOL_FORMATS, buildTools } from '../src/ai/tools.js'
import { DOCUMENT_FORMATS, EXPORT_FORMATS } from '../src/export-files.js'
import { ExportStore } from '../mcp/exports.js'

test('export_diagram offers every format of the Export menu, and only those', () => {
  assert.deepEqual(TOOL_FORMATS, [...EXPORT_FORMATS, ...DOCUMENT_FORMATS])
  const tool = buildTools(z).find((t) => t.name === 'export_diagram')
  const format = z.object(tool.inputSchema).shape.format
  for (const f of TOOL_FORMATS) assert.equal(format.safeParse(f).success, true, f)
  assert.equal(format.safeParse('bpmn.enc').success, false)
  assert.equal(format.safeParse('xml').success, false)
  for (const f of TOOL_FORMATS) assert.match(tool.description, new RegExp(f.replace(/[0-9]$/, '')), f)
})

test('the server can store the file of each format', () => {
  const ext = { forms: 'form', camunda8: 'bpmn', camunda7: 'bpmn', 'doc-html': 'html', 'stories-md': 'md', 'raci-xlsx': 'xlsx' }
  for (const f of TOOL_FORMATS) {
    const e = ext[f] || (f.includes('-') ? f.split('-')[1] : f)
    assert.ok(ExportStore.validFormat(e), `${f} → .${e}`)
  }
  // Plusieurs formulaires partent en archive zip.
  assert.ok(ExportStore.validFormat('zip'))
})
