// Ouvrir > Depuis un tableau, exports Word (.docx) et BPMN pour Camunda 8 ou 7.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BpmnModdle } from 'bpmn-moddle'
import { layoutProcess } from 'bpmn-auto-layout'
import zeebe from 'zeebe-bpmn-moddle/resources/zeebe.json' with { type: 'json' }
import camunda from 'camunda-bpmn-moddle/resources/camunda.json' with { type: 'json' }
import pilot from '../src/bpmn-pilot-moddle.json' with { type: 'json' }
import { readTable, tableToXml, templateRows } from '../src/table-import.js'
import { parseDelimited, rowsToXlsx, rowsToCsv } from '../src/sheet-io.js'
import { openZip, xlsxSheets } from '../src/ai/text-files.js'
import { markdownBlocks, markdownToDocx, pngSize } from '../src/export-docx.js'
import { toCamunda, variableName, conditionFor, translateCondition } from '../src/export-camunda.js'
import { crc32 } from '../src/zip-write.js'

const FR = (en, fr) => fr
const parse = async (xml) => new BpmnModdle({ bpmnpilot: pilot }).fromXML(xml)

test('pasted Excel rows (tabs), CSV with semicolons and quoted cells are split into rows', () => {
  assert.deepEqual(parseDelimited('ID\tDescription\n1\tA\n\n2\tB'), [['ID', 'Description'], ['1', 'A'], ['2', 'B']])
  assert.deepEqual(parseDelimited('ID;Description\r\n1;"Vérifier; puis ""signer"""'), [['ID', 'Description'], ['1', 'Vérifier; puis "signer"']])
  assert.deepEqual(parseDelimited('a,b\n1,2'), [['a', 'b'], ['1', '2']])
  assert.deepEqual(parseDelimited(rowsToCsv([['a', 'b;c'], ['1', '2']], ';')), [['a', 'b;c'], ['1', '2']])
})

test('Visio Data Visualizer headings build lanes, decisions and labelled branches', async () => {
  const rows = parseDelimited([
    'Process step ID\tProcess step description\tNext step ID\tConnector label\tShape type\tFunction\tPhase',
    'P100\tOrder received\tP200\t\tStart\tSales\t',
    'P200\tOrder complete?\tP300,P400\tYes,No\tDecision\tSales\t',
    'P300\tShip\tP500\t\tProcess\tWarehouse\t',
    'P400\tAsk for missing items\tP200\t\tProcess\tSales\t',
    'P500\tShipped\t\t\tEnd\tWarehouse\t',
  ].join('\n'))
  const table = readTable(rows)
  assert.deepEqual(table.errors, [])
  assert.deepEqual(table.lanes, ['Sales', 'Warehouse'])
  assert.equal(table.steps.find((s) => s.key === 'P200').type, 'bpmn:ExclusiveGateway')
  const xml = tableToXml(table, { name: 'Orders' })
  const { rootElement, warnings } = await parse(xml)
  assert.deepEqual(warnings, [])
  const process = rootElement.rootElements.find((e) => e.$type === 'bpmn:Process')
  assert.equal(process.laneSets[0].lanes.length, 2)
  const labels = process.flowElements.filter((e) => e.$type === 'bpmn:SequenceFlow').map((f) => f.name).filter(Boolean)
  assert.deepEqual(labels.sort(), ['No', 'Yes'])
  assert.equal(process.flowElements.filter((e) => e.$type === 'bpmn:StartEvent').length, 1, 'no extra start')
  assert.equal(rootElement.rootElements.find((e) => e.$type === 'bpmn:Collaboration').participants[0].name, 'Orders')
  const laid = await layoutProcess(xml)
  assert.match(laid.xml, /bpmndi:BPMNShape/)
})

test('French headings, a plain list of steps and the co-pilot documentation column', async () => {
  const table = readTable(parseDelimited('Étape\tQui\tComment\nRecevoir la demande\tAccueil\tVérifier l\'identité\nTraiter\tService\t\nRépondre\tAccueil\t'), FR)
  assert.deepEqual(table.errors, [])
  assert.equal(table.flows.length, 2, 'rows follow one another without a next-step column')
  const xml = tableToXml(table, { T: FR })
  const { rootElement, warnings } = await parse(xml)
  assert.deepEqual(warnings, [])
  const els = rootElement.rootElements.find((e) => e.$type === 'bpmn:Process').flowElements
  assert.ok(els.some((e) => e.$type === 'bpmn:StartEvent' && e.name === 'Début'), 'start added')
  assert.ok(els.some((e) => e.$type === 'bpmn:EndEvent' && e.name === 'Fin'), 'end added')
  assert.equal(els.find((e) => e.name === 'Recevoir la demande').documentation[0].text, 'Vérifier l\'identité')
  // Un libellé qui finit par « ? » devient une décision quand le type est vide.
  assert.equal(readTable([['Description'], ['Validé ?']]).steps[0].type, 'bpmn:ExclusiveGateway')
})

test('unusable tables are explained line by line', () => {
  assert.match(readTable([['Foo', 'Bar'], ['1', '2']]).errors[0], /No column for the step names/)
  const bad = readTable([['ID', 'Description', 'Next step'], ['1', 'A', '2,9'], ['2', 'B', ''], ['2', 'C', '']], FR)
  assert.ok(bad.errors.some((e) => /Ligne 2 .*« 9 »/.test(e)))
  assert.ok(bad.errors.some((e) => /Ligne 4 .*« 2 » est déjà pris/.test(e)))
  assert.match(readTable([['Description']]).errors[0], /no step/)
})

test('the .xlsx template opens and reads back with the same rows', async () => {
  const rows = templateRows(FR)
  const sheets = await xlsxSheets(await openZip(await rowsToXlsx(rows, 'Processus')))
  assert.equal(sheets[0].name, 'Processus')
  assert.deepEqual(sheets[0].rows, rows)
  assert.deepEqual(readTable(rows, FR).errors, [])
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926)
})

// Petite image PNG de 2 × 1 pixels.
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DwHwQZGBgAPwIF+wqr0z8AAAAASUVORK5CYII='), (c) => c.charCodeAt(0))

test('Markdown tables, lists and headings become native Word blocks', async () => {
  const md = '# Report\n\nIntro **bold**.\n\n## Findings\n\n| Level | Element |\n|---|---|\n| **ERROR** | A \\| B |\n\n- one\n  - two\n\n1. first\n2. second\n\n> note\n'
  const blocks = markdownBlocks(md)
  assert.deepEqual(blocks.map((b) => b.type), ['heading', 'paragraph', 'heading', 'table', 'list', 'list', 'quote'])
  assert.deepEqual(blocks[3].rows[1], ['**ERROR**', 'A | B'])
  assert.deepEqual(pngSize(PNG), { width: 2, height: 1 })
  const zip = await openZip(await markdownToDocx(md, { title: 'Report', png: PNG, lang: 'fr' }))
  assert.ok(zip.names.includes('word/media/diagram.png'))
  const doc = await zip.read('word/document.xml')
  assert.match(doc, /<w:pStyle w:val="Title"\/>.*Report/)
  assert.match(doc, /<w:pStyle w:val="Heading1"\/>/)
  assert.match(doc, /<w:tbl>.*<w:tblHeader\/>/)
  assert.match(doc, /<w:b\/>.*ERROR/)
  assert.match(doc, /A \| B/)
  assert.ok(doc.indexOf('<w:drawing>') < doc.indexOf('Findings'), 'diagram right after the introduction')
  assert.match(await zip.read('word/numbering.xml'), /w:startOverride w:val="1"/)
  assert.match(await zip.read('word/styles.xml'), /fr-FR/)
})

const GATEWAY = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmnpilot="https://bpmn.leylines.fr/schema/bpmn-pilot/1.0" id="D" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="P" isExecutable="false">
    <bpmn:startEvent id="S"><bpmn:outgoing>F0</bpmn:outgoing></bpmn:startEvent>
    <bpmn:userTask id="U" name="Review" bpmnpilot:assignee="Jane Doe"><bpmn:incoming>F0</bpmn:incoming><bpmn:outgoing>F1</bpmn:outgoing></bpmn:userTask>
    <bpmn:exclusiveGateway id="G" name="Order complete?" default="F4"><bpmn:incoming>F1</bpmn:incoming><bpmn:outgoing>F2</bpmn:outgoing><bpmn:outgoing>F3</bpmn:outgoing><bpmn:outgoing>F4</bpmn:outgoing><bpmn:outgoing>F5</bpmn:outgoing></bpmn:exclusiveGateway>
    <bpmn:endEvent id="E"><bpmn:incoming>F2</bpmn:incoming><bpmn:incoming>F3</bpmn:incoming><bpmn:incoming>F4</bpmn:incoming><bpmn:incoming>F5</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="F0" sourceRef="S" targetRef="U" />
    <bpmn:sequenceFlow id="F1" sourceRef="U" targetRef="G" />
    <bpmn:sequenceFlow id="F2" name="Yes" sourceRef="G" targetRef="E" />
    <bpmn:sequenceFlow id="F3" name="Partly" sourceRef="G" targetRef="E"><bpmn:conditionExpression>=ratio &gt; 0.5</bpmn:conditionExpression></bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="F4" name="No" sourceRef="G" targetRef="E" />
    <bpmn:sequenceFlow id="F5" sourceRef="G" targetRef="E" />
  </bpmn:process>
</bpmn:definitions>`

test('Camunda 8 export: platform, executable, FEEL conditions from labels, Camunda user task', async () => {
  const { xml, summary } = await toCamunda(new BpmnModdle({ bpmnpilot: pilot }), GATEWAY, 8)
  assert.deepEqual(summary, { processes: 1, conditions: 1, userTasks: 1, assignees: 1, converted: 0, left: 1, forms: 0 })
  assert.match(xml, /modeler:executionPlatform="Camunda Cloud"/)
  assert.match(xml, /modeler:executionPlatformVersion="8\.\d+\.\d+"/)
  assert.match(xml, /isExecutable="true"/)
  assert.match(xml, /=orderComplete = "Yes"/)
  assert.match(xml, /=ratio &gt; 0.5/, 'a written condition is kept')
  assert.doesNotMatch(xml, /= "No"/, 'the default flow gets no condition')
  const { rootElement, warnings } = await new BpmnModdle({ zeebe }).fromXML(xml)
  assert.deepEqual(warnings, [])
  const task = rootElement.rootElements[0].flowElements.find((e) => e.id === 'U')
  assert.deepEqual(task.extensionElements.values.map((v) => v.$type).sort(), ['zeebe:AssignmentDefinition', 'zeebe:UserTask'])
  assert.equal(task.extensionElements.values.find((v) => v.assignee).assignee, 'Jane Doe')
})

test('Camunda 7 export: JUEL conditions and history time to live', async () => {
  const { xml } = await toCamunda(new BpmnModdle({ bpmnpilot: pilot }), GATEWAY, 7)
  assert.match(xml, /modeler:executionPlatform="Camunda Platform"/)
  assert.match(xml, /\$\{orderComplete == 'Yes'\}/)
  assert.match(xml, /camunda:historyTimeToLive="180"/)
  assert.doesNotMatch(xml, /zeebe/)
  const { rootElement, warnings } = await new BpmnModdle({ camunda }).fromXML(xml)
  assert.deepEqual(warnings, [])
  assert.equal(rootElement.rootElements[0].historyTimeToLive, '180')
  assert.equal(rootElement.rootElements[0].flowElements.find((e) => e.id === 'U').assignee, 'Jane Doe')
  assert.equal(variableName('Commande complète ?'), 'commandeComplete')
  assert.equal(variableName('2e passage'), 'decision2ePassage')
  assert.equal(conditionFor(8, 'x', 'Il a dit "oui"'), '=x = "Il a dit \\"oui\\""')
})

test('plain-language conditions are translated to FEEL and JUEL, or left to complete', async () => {
  assert.equal(translateCondition(8, 'Avance < 3000'), '=avance < 3000')
  assert.equal(translateCondition(7, 'Avance >= 3 000'), '${avance >= 3000}')
  assert.equal(translateCondition(8, 'Montant ≥ 500 et Client = VIP'), '=montant >= 500 and client = "VIP"')
  assert.equal(translateCondition(7, 'Client = VIP ou Urgent = oui'), "${client == 'VIP' || urgent == true}")
  assert.equal(translateCondition(8, 'si le client le demande'), null)
  const xml = GATEWAY.replace('<bpmn:sequenceFlow id="F2" name="Yes" sourceRef="G" targetRef="E" />',
    '<bpmn:sequenceFlow id="F2" name="Advance &lt; 3000" sourceRef="G" targetRef="E"><bpmn:conditionExpression>Advance &lt; 3000</bpmn:conditionExpression></bpmn:sequenceFlow>')
  const { xml: out } = await toCamunda(new BpmnModdle({ bpmnpilot: pilot }), xml, 8)
  assert.match(out, /=advance &lt; 3000/)
  // Amounts with spaces, units and thousand separators.
  assert.equal(translateCondition(8, 'Montant < 3 000 €'), '=montant < 3000')
  assert.equal(translateCondition(8, 'Amount > 1,000'), '=amount > 1000')
  assert.equal(translateCondition(8, 'Taux >= 12,5 %'), '=taux >= 12.5')
})

test('Camunda export: rules in labels are translated, unreadable rules are not written, assigned tasks become user tasks', async () => {
  const table = readTable([['ID', 'Description', 'Next step ID', 'Connector label', 'Shape type', 'Function', 'Assigned to'],
    ['1', 'Check', '2', '', '', 'Managers', 'Jane'], ['2', 'Amount?', '3,4', 'Amount < 3000;Amount >= 3000', 'Decision', 'Managers', ''],
    ['3', 'Pay', '5', '', '', 'Accounting', ''], ['4', 'CFO approval', '5', '', '', 'Finance', ''], ['5', 'Done', '', '', 'End', 'Accounting', '']])
  const { xml, summary } = await toCamunda(new BpmnModdle({ bpmnpilot: pilot }), tableToXml(table), 7)
  assert.equal(summary.conditions, 2)
  assert.equal(summary.converted, 1)
  assert.match(xml, /\$\{amount &lt; 3000\}/)
  assert.match(xml, /\$\{amount &gt;= 3000\}/)
  const { rootElement, warnings } = await new BpmnModdle({ camunda }).fromXML(xml)
  assert.deepEqual(warnings, [])
  const check = rootElement.rootElements.find((e) => e.$type === 'bpmn:Process').flowElements.find((e) => e.name === 'Check')
  assert.equal(check.$type, 'bpmn:UserTask')
  assert.equal(check.assignee, 'Jane')
  // A plain-language condition the engine could not read stays in the label only.
  const vague = GATEWAY.replace('<bpmn:sequenceFlow id="F5" sourceRef="G" targetRef="E" />',
    '<bpmn:sequenceFlow id="F5" sourceRef="G" targetRef="E"><bpmn:conditionExpression>if the customer asks</bpmn:conditionExpression></bpmn:sequenceFlow>')
  const r = await toCamunda(new BpmnModdle({ bpmnpilot: pilot }), vague, 8)
  assert.equal(r.summary.left, 1)
  assert.doesNotMatch(r.xml, />if the customer asks</)
  assert.match(r.xml, /id="F5" name="if the customer asks"/)
})

test('the Assigned to column of a table lands on the tasks', async () => {
  const table = readTable([['Description', 'Function', 'Assigned to'], ['Approve', 'Managers', 'Jane Doe']])
  const { rootElement, warnings } = await parse(tableToXml(table))
  assert.deepEqual(warnings, [])
  const task = rootElement.rootElements.find((e) => e.$type === 'bpmn:Process').flowElements.find((e) => e.name === 'Approve')
  assert.equal(task.get('bpmnpilot:assignee'), 'Jane Doe')
})

test('the RACI matrix gathers performers, accountable, consulted and informed roles', async () => {
  const { buildRaci, raciRows } = await import('../src/raci.js')
  const seq = [
    { number: 1, name: 'Start', activity: false },
    { number: 2, name: 'Approve', activity: true, lane: 'Managers', assignee: 'Jane', accountable: 'Director', consulted: 'HR, Finance', informed: 'Employee' },
    { number: 3, name: 'Pay', activity: true, lane: 'Accounting', informed: 'Employee; Jane' },
  ]
  const raci = buildRaci(seq)
  assert.deepEqual(raci.roles, ['Jane', 'Director', 'HR', 'Finance', 'Employee', 'Accounting'])
  assert.deepEqual(raciRows(raci, (en) => en)[1], ['2', 'Approve', 'R', 'A', 'C', 'C', 'I', ''])
  assert.deepEqual(raciRows(raci, (en) => en)[2], ['3', 'Pay', 'I', '', '', '', 'I', 'R'])
  assert.equal(buildRaci(seq.map((s) => ({ ...s, accountable: '', consulted: '', informed: '' }))), null)
  const table = readTable([['Description', 'Function', 'A', 'C', 'I', 'Systems'], ['Approve', 'Managers', 'Director', 'HR', 'Employee', 'ERP']])
  const { rootElement } = await parse(tableToXml(table))
  const task = rootElement.rootElements.find((e) => e.$type === 'bpmn:Process').flowElements.find((e) => e.name === 'Approve')
  assert.equal(task.get('bpmnpilot:accountable'), 'Director')
  assert.equal(task.get('bpmnpilot:systems'), 'ERP')
})

test('an encrypted .bpmn file opens only with its password', async () => {
  const { encryptText, decryptText, isEncrypted } = await import('../src/encrypted-file.js')
  const box = await encryptText('<definitions>é</definitions>', 'correct horse')
  assert.ok(isEncrypted(box))
  assert.doesNotMatch(box, /definitions/)
  assert.equal(await decryptText(box, 'correct horse'), '<definitions>é</definitions>')
  await assert.rejects(decryptText(box, 'wrong horse!'), /wrong password/)
  await assert.rejects(encryptText('x', 'short'), /too short/)
  assert.equal(isEncrypted('<?xml version="1.0"?>'), false)
})

test('connector labels keep numbers with commas and slashes, and split on semicolons', () => {
  const table = readTable([['ID', 'Description', 'Next step ID', 'Connector label', 'Shape type'],
    ['1', 'Start', '2', '', 'Start'],
    ['2', 'Amount?', '3,4', '< 1,000; >= 1,000', 'Decision'],
    ['3', 'Answer?', '5,6', 'Yes/No, Other', 'Decision'],
    ['4', 'Pay', '5', '', 'Process'],
    ['5', 'End A', '', '', 'End'],
    ['6', 'End B', '', '', 'End'],
  ])
  assert.deepEqual(table.steps.find((s) => s.key === '2').flowLabels, ['< 1,000', '>= 1,000'])
  assert.deepEqual(table.steps.find((s) => s.key === '3').flowLabels, ['Yes/No', 'Other'])
})
