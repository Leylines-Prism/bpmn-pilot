// Documentation des éléments : lecture du Markdown (src/doc/markdown.js), modèles
// (src/doc/templates.js), extrait de recherche (src/doc/doc-search.js), rapport de
// processus et fiches de procédure (src/doc/procedure-sheets.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { BpmnModdle } from 'bpmn-moddle'
import { markdownToHtml, markdownToLine, markdownToPlain, parseInline, safeUrl, shiftHeadings } from '../src/doc/markdown.js'
import { templateFor, templateText, withoutEmptyTemplate } from '../src/doc/templates.js'

// Le rapport passe par des modules de l'éditeur qui touchent la page au chargement.
const classList = { toggle() {}, contains: () => false, add() {}, remove() {} }
globalThis.document ??= { documentElement: { classList }, body: { classList }, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] }
globalThis.window ??= globalThis
const { buildReport, reportToMarkdown } = await import('../src/process-report.js')
const { sheetsOf, sheetsToMarkdown } = await import('../src/doc/procedure-sheets.js')

const DOC = `## Purpose
Check that the claim is **complete**.
Second line

## Actors
- Claims handler
  - backup
- Policyholder, see [P-12](https://example.com/p12)

1. first
2. second
> quoted`

test('Markdown is rendered with headings, lists, emphasis and safe links', () => {
  const html = markdownToHtml(DOC)
  assert.match(html, /<h2>Purpose<\/h2>/)
  assert.match(html, /<strong>complete<\/strong>\.<br>Second line/)
  assert.match(html, /<ul><li>Claims handler<ul><li>backup<\/li><\/ul><\/li><li>Policyholder/)
  assert.match(html, /<a href="https:\/\/example\.com\/p12" target="_blank" rel="noopener noreferrer">P-12<\/a>/)
  assert.match(html, /<ol><li>first<\/li><li>second<\/li><\/ol>/)
  assert.match(html, /<blockquote>quoted<\/blockquote>/)
})

test('HTML in the documentation is escaped and unsafe links lose their address', () => {
  const html = markdownToHtml('<img src=x onerror=alert(1)> [click](javascript:alert(1)) [x](data:text/html,hi) "quote"')
  assert.doesNotMatch(html, /<img/)
  assert.doesNotMatch(html, /href="javascript|href="data/)
  assert.match(html, /&lt;img/)
  assert.match(html, /&quot;quote&quot;/)
  assert.equal(safeUrl('https://example.com/a'), 'https://example.com/a')
  assert.equal(safeUrl('mailto:someone@example.com'), 'mailto:someone@example.com')
  assert.equal(safeUrl('javascript:alert(1)'), null)
  assert.equal(safeUrl('https://example.com/"onmouseover=x'), null)
})

test('inline markup keeps snake_case words and bare https addresses', () => {
  const parts = parseInline('see snake_case_name and https://example.com/a.')
  assert.equal(parts.map((p) => p.text).join(''), 'see snake_case_name and https://example.com/a.')
  assert.equal(parts.find((p) => p.href)?.href, 'https://example.com/a')
  assert.ok(!parts.some((p) => p.italic))
})

test('one-line and plain versions keep the structure readable', () => {
  assert.equal(markdownToLine(DOC), 'Purpose : Check that the claim is complete. Second line · Actors : Claims handler, backup, Policyholder, see P-12 · first, second · quoted')
  const plain = markdownToPlain(DOC).split('\n')
  assert.deepEqual(plain.slice(0, 7), ['Purpose', 'Check that the claim is complete.', 'Second line', 'Actors', '• Claims handler', '    - backup', '• Policyholder, see P-12 (https://example.com/p12)'])
  assert.deepEqual(plain.slice(7, 9), ['1. first', '2. second'])
  assert.equal(markdownToLine('Plain text\nstays as it is.'), 'Plain text stays as it is.')
})

test('headings shift to fit inside a larger document', () => {
  assert.equal(shiftHeadings('## A\ntext #not\n###### B', 2), '#### A\ntext #not\n###### B')
})

const ext = JSON.parse(fs.readFileSync(new URL('../src/bpmn-pilot-moddle.json', import.meta.url), 'utf8'))
const moddle = new BpmnModdle({ bpmnpilot: ext })
const XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D">
  <bpmn:process id="P" name="Claims">
    <bpmn:documentation>## Purpose
Pay valid claims fast.</bpmn:documentation>
    <bpmn:startEvent id="S" name="Claim received" />
    <bpmn:task id="A" name="Check the claim"><bpmn:documentation>${DOC.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</bpmn:documentation></bpmn:task>
    <bpmn:exclusiveGateway id="G" name="Complete?"><bpmn:documentation>Is every document there?</bpmn:documentation></bpmn:exclusiveGateway>
    <bpmn:task id="B" name="Ask for documents" />
    <bpmn:endEvent id="E" name="Done" />
    <bpmn:sequenceFlow id="F0" sourceRef="S" targetRef="A" />
    <bpmn:sequenceFlow id="F1" sourceRef="A" targetRef="G" />
    <bpmn:sequenceFlow id="F2" sourceRef="G" targetRef="E" name="Yes" />
    <bpmn:sequenceFlow id="F3" sourceRef="G" targetRef="B" name="No" />
    <bpmn:sequenceFlow id="F4" sourceRef="B" targetRef="E" />
  </bpmn:process>
</bpmn:definitions>`

async function report() {
  const { rootElement: definitions } = await moddle.fromXML(XML)
  const modeler = { getDefinitions: () => definitions, get: (name) => (name === 'translate' ? (s) => s : null) }
  return buildReport(modeler, { name: 'claims', lint: {} })
}

test('templates follow the element type, and a gateway lists its branches', async () => {
  const { rootElement: d } = await moddle.fromXML(XML)
  const byId = (id) => d.rootElements[0].flowElements.find((e) => e.id === id)
  assert.equal(templateFor(byId('A')), 'activity')
  assert.equal(templateFor(byId('G')), 'gateway')
  assert.equal(templateFor(byId('S')), 'start')
  assert.equal(templateFor(byId('E')), 'end')
  assert.equal(templateFor(d.rootElements[0]), 'process')
  assert.match(templateText('gateway', byId('G')), /## Criteria of the branches\n- \*\*Yes\*\*: \n- \*\*No\*\*: /)
  assert.match(templateText('activity', byId('A')), /^## Purpose\n\n## Actors\n/)
})

test('the process report shows the documentation on one line and in full', async () => {
  const r = await report()
  const check = r.sequence.find((s) => s.id === 'A')
  assert.equal(check.docMarkdown, DOC)
  assert.match(check.documentation, /^Purpose : Check that the claim is complete/)
  assert.deepEqual(check.previous, ['1. Claim received'])
  const md = reportToMarkdown(r)
  assert.match(md, /## Documentation of the elements\n\n### Claims\n\n#### Purpose\nPay valid claims fast\./)
  assert.match(md, /### 2\. Check the claim\n\n#### Purpose/)
})

test('procedure sheets follow the flow, include documented gateways and flag missing documentation', async () => {
  const r = await report()
  const sheets = sheetsOf(r)
  // Le début, sans documentation, n'a pas de fiche ; la passerelle documentée suit l'activité.
  assert.deepEqual(sheets.map((s) => s.name), ['Check the claim', 'Complete?', 'Ask for documents'])
  assert.ok(sheets.some((s) => s.name === 'Complete?' && s.kind === 'gateway'))
  const md = sheetsToMarkdown(r)
  assert.match(md, /^# Procedure sheets: Claims/)
  assert.match(md, /## 2\. Check the claim\n\n\*\*Type\*\*: Task/)
  assert.match(md, /\*\*Before\*\*: 1\. Claim received/)
  assert.match(md, /### Purpose\nCheck that the claim/)
  assert.match(md, /## \d+\. Ask for documents[\s\S]*\*Documentation to complete\.\*/)
})

test('changing template drops the empty sections of the previous one and keeps written text', () => {
  const before = 'Check ceci est un test\n\n## Question asked\n\n## Criteria of the branches\n- **Fin**: \n\n## Trigger\n\n## Frequency\nEvery Monday\n\n## Data received\n'
  assert.equal(withoutEmptyTemplate(before), 'Check ceci est un test\n\n## Frequency\nEvery Monday')
  assert.equal(withoutEmptyTemplate(templateText('activity')), '')
  assert.equal(withoutEmptyTemplate('## My own title\n\nText'), '## My own title\n\nText')
})
