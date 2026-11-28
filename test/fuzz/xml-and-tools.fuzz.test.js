// Fuzzing par propriétés (fast-check) de ce qui entre de l'extérieur : le XML importé et les
// arguments des outils MCP. fast-check génère des milliers d'entrées, réduit tout contre-exemple
// au plus simple et affiche la graine pour le rejouer (FC_SEED=... npm test).
//
// Fichier en .js (et non .mjs) exprès : OpenSSF Scorecard ne cherche l'import de fast-check que
// dans les fichiers .js, .jsx, .ts et .tsx (contrôle Fuzzing). Le package.json voisin le fait
// lire comme un module ES.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fc from 'fast-check'
import * as z from 'zod/v4'
import { BpmnModdle } from 'bpmn-moddle'
import { checkXml, CHECK_IDS } from '../../src/diagram-checks.js'
import { parseDmn } from '../../src/dmn/dmn-model.js'
import { buildTools } from '../../src/ai/tools.js'
import { createToolSet, runTool } from '../../src/ai/chat-loop.js'
import { importMermaid, mermaidToDiagram } from '../../src/mermaid-import.js'

const seed = process.env.FC_SEED ? { seed: Number(process.env.FC_SEED) } : {}
const runs = (numRuns) => ({ numRuns, ...seed })
const moddle = BpmnModdle()

// ── Import XML ──

const NS = 'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI"'
const escapeXml = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c])
// Caractères permis par XML 1.0 (les autres ne peuvent pas figurer dans un document valide).
const xmlChars = (s) => s.replace(/[^\u0009\u000a\u000d -퟿-�]/gu, '')

// Processus linéaire : début, n tâches, fin, avec leurs formes et leurs flux.
function linearProcess(names) {
  const ids = ['S', ...names.map((_, i) => `T${i}`), 'E']
  const nodes = ids.map((id, i) => {
    if (id === 'S') return '<bpmn:startEvent id="S" />'
    if (id === 'E') return '<bpmn:endEvent id="E" />'
    return `<bpmn:task id="${id}" name="${escapeXml(xmlChars(names[i - 1]))}" />`
  })
  const flows = ids.slice(1).map((id, i) => `<bpmn:sequenceFlow id="F${i}" sourceRef="${ids[i]}" targetRef="${id}" />`)
  const shapes = ids.map((id, i) => `<bpmndi:BPMNShape id="${id}_di" bpmnElement="${id}"><dc:Bounds x="${100 + i * 150}" y="100" width="100" height="80" /></bpmndi:BPMNShape>`)
  const edges = ids.slice(1).map((_, i) => `<bpmndi:BPMNEdge id="F${i}_di" bpmnElement="F${i}"><di:waypoint x="${200 + i * 150}" y="140" /><di:waypoint x="${250 + i * 150}" y="140" /></bpmndi:BPMNEdge>`)
  return `<?xml version="1.0" encoding="UTF-8"?><bpmn:definitions ${NS} id="Defs" targetNamespace="http://example.com"><bpmn:process id="P">${nodes.join('')}${flows.join('')}</bpmn:process><bpmndi:BPMNDiagram id="D"><bpmndi:BPMNPlane id="PL" bpmnElement="P">${shapes.join('')}${edges.join('')}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`
}

const VALID = linearProcess(['Receive order', 'Check stock'])

// Morceaux qui cassent un analyseur XML : balises, entités, CDATA, DOCTYPE, caractères interdits.
const xmlNoise = fc.oneof(
  fc.string({ unit: 'binary', maxLength: 40 }),
  fc.constantFrom('<', '>', '&', '&amp;', '&#0;', '&#xFFFF;', '&unknown;', ']]>', '<![CDATA[', '<!--', '-->', '<?xml version="1.0"?>',
    '<!DOCTYPE x [<!ENTITY a "aaaaaaaaaa">]>', '</bpmn:process>', '<bpmn:task id="T0" />', 'id="S"', 'xmlns:bpmn=""', '\u0000', '﻿', '"', "'"),
)

// Le document valide, abîmé : un morceau coupé, du bruit inséré, ou les deux.
const damagedXml = fc
  .tuple(fc.nat(VALID.length), fc.nat(60), fc.array(xmlNoise, { maxLength: 4 }))
  .map(([at, cut, noise]) => VALID.slice(0, at) + noise.join('') + VALID.slice(at + cut))

const reportIsWellFormed = (report) => {
  assert.deepEqual(report.checks.map((c) => c.id), CHECK_IDS)
  for (const c of report.checks) {
    assert.equal(typeof c.ok, 'boolean')
    assert.ok(Array.isArray(c.problems))
  }
  const xml = report.checks[0]
  // XML illisible : les contrôles suivants sont sautés, pas lancés sur un modèle à moitié lu.
  if (!xml.ok) assert.ok(report.checks.slice(1).every((c) => c.skipped))
}

test('the XML check never throws on arbitrary text and always returns a full report', async () => {
  await fc.assert(
    fc.asyncProperty(fc.oneof(fc.string({ unit: 'binary' }), fc.array(xmlNoise, { maxLength: 12 }).map((a) => a.join(''))), async (text) => {
      reportIsWellFormed(await checkXml(text, { moddle }))
    }),
    runs(500),
  )
})

test('a damaged BPMN document is reported, never thrown', async () => {
  await fc.assert(
    fc.asyncProperty(damagedXml, async (text) => {
      reportIsWellFormed(await checkXml(text, { moddle }))
    }),
    runs(1000),
  )
})

test('any task name survives the import: the document stays valid and every task is counted', async () => {
  await fc.assert(
    fc.asyncProperty(fc.array(fc.string({ unit: 'grapheme', maxLength: 30 }), { minLength: 1, maxLength: 8 }), async (names) => {
      const xml = linearProcess(names)
      const report = await checkXml(xml, { moddle })
      assert.deepEqual(report.failed, [], JSON.stringify(report.checks.filter((c) => !c.ok)))
      assert.equal(report.counts.activities, names.length)
      assert.equal(report.counts.sequenceFlows, names.length + 1)
      // Les noms reviennent tels quels (à l'échappement XML près).
      const { rootElement } = await moddle.fromXML(xml, 'bpmn:Definitions')
      const tasks = rootElement.rootElements[0].flowElements.filter((el) => el.$type === 'bpmn:Task')
      assert.deepEqual(tasks.map((t) => t.name || ''), names.map(xmlChars))
    }),
    runs(300),
  )
})

test('the DMN import refuses bad documents with an error, never a crash or a hang', async () => {
  const DMN = '<?xml version="1.0" encoding="UTF-8"?><definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" id="D" name="D" namespace="http://example.com"><decision id="d1" name="Decide"><decisionTable id="t1"><input id="i1"><inputExpression id="e1" typeRef="string"><text>x</text></inputExpression></input><output id="o1" typeRef="string" /></decisionTable></decision></definitions>'
  const damaged = fc
    .tuple(fc.nat(DMN.length), fc.nat(40), fc.array(xmlNoise, { maxLength: 3 }))
    .map(([at, cut, noise]) => DMN.slice(0, at) + noise.join('') + DMN.slice(at + cut))
  await fc.assert(
    fc.asyncProperty(fc.oneof(damaged, fc.string({ unit: 'binary' })), async (text) => {
      try {
        const { definitions } = await parseDmn(text)
        assert.equal(definitions.$type, 'dmn:Definitions')
      } catch (err) {
        assert.ok(err instanceof Error && typeof err.message === 'string')
      }
    }),
    runs(500),
  )
})

// ── Arguments des outils MCP ──

// Les mêmes schémas que le serveur MCP (mcp/server.js : buildTools(z) avec zod/v4).
const TOOLS = buildTools(z)
const validators = TOOLS.map((t) => [t.name, z.object(t.inputSchema)])

// Valeurs JSON quelconques, et objets qui ressemblent aux vrais arguments (clés connues, valeurs piégées).
const keys = [...new Set(TOOLS.flatMap((t) => Object.keys(t.inputSchema)))]
const nasty = fc.oneof(
  fc.jsonValue(),
  fc.constantFrom('', '__proto__', 'constructor', '../../etc/passwd', 'bpmn:Task', '<x/>', -1, 0, 1e308, NaN, Infinity, null, [], {}),
)
const toolInput = fc.oneof(
  fc.jsonValue(),
  fc.dictionary(fc.constantFrom(...keys, '__proto__', 'extra'), fc.oneof(nasty, fc.array(fc.dictionary(fc.string(), nasty, { maxKeys: 5 }), { maxLength: 4 })), { maxKeys: 6 }),
)

test('every MCP tool schema rejects or accepts any input without throwing, and what it accepts survives JSON', () => {
  fc.assert(
    fc.property(fc.constantFrom(...validators), toolInput, ([name, schema], input) => {
      const parsed = schema.safeParse(input)
      assert.equal(typeof parsed.success, 'boolean', name)
      if (parsed.success) {
        // Le transport MCP envoie les arguments en JSON : ce qui est accepté doit l'être encore à l'arrivée.
        const again = schema.safeParse(JSON.parse(JSON.stringify(parsed.data)))
        assert.ok(again.success, `${name}: ${JSON.stringify(parsed.data)}`)
      }
    }),
    runs(5000),
  )
})

test('the co-pilot runs a tool only on valid arguments, and always answers', async () => {
  const toolSet = createToolSet(z)
  const names = [...toolSet.tools.map((t) => t.name), 'drop_database', '__proto__', 'constructor', 'toString', 'hasOwnProperty', '']
  await fc.assert(
    fc.asyncProperty(fc.constantFrom(...names), toolInput, async (name, input) => {
      let ran = false
      const result = await runTool({ toolSet, name, input, executeTool: () => ((ran = true), { ok: true }), emit: () => {}, log: () => {} })
      assert.equal(typeof result.isError, 'boolean')
      assert.equal(typeof result.content, 'string')
      const valid = Object.hasOwn(toolSet.validators, name) && toolSet.validators[name].safeParse(input).success
      assert.equal(ran, valid)
      assert.equal(result.isError, !valid)
    }),
    runs(3000),
  )
})

// ── Import Mermaid ──

// Morceaux de syntaxe Mermaid mêlés au hasard : le parseur ne doit jamais lever d'exception.
const mermaidBits = fc.constantFrom('A', 'B', 'id1', '-->', '---', '-.->', '==>', '~~~', '<-->', '--x', '--o', '|', '"', '[', ']', '(', ')', '{', '}',
  '[[', ']]', '((', '))', '[(', ')]', '[/', '/]', '>', '&', ';', '\n', ' ', 'subgraph', 'end', '@{', 'shape:', 'label:', ':::', '%%', '`', '#quot;', '<br>', 'classDef', 'click', 'e1@')

test('the Mermaid import never throws on arbitrary text, and answers with errors or BPMN', () => {
  fc.assert(
    fc.property(fc.oneof(fc.string(), fc.array(mermaidBits, { maxLength: 60 }).map((a) => `flowchart LR\n${a.join('')}`)), (text) => {
      const r = importMermaid(text)
      assert.ok(Array.isArray(r.errors) && Array.isArray(r.warnings))
      if (!r.errors.length) assert.match(r.xml, /<bpmn:process /)
    }),
    runs(5000),
  )
})

// Flowcharts bien formés tirés au hasard : le BPMN produit se lit sans avertissement et se range.
const SHAPES = ['[t]', '(t)', '{t}', '([t])', '((t))', '(((t)))', '[[t]]', '[(t)]', '[/t/]', '{{t}}', '@{ shape: fork }', '@{ shape: delay, label: "t" }', '@{ shape: comment, label: "t" }']
const flowchart = fc.record({
  shapes: fc.array(fc.constantFrom(...SHAPES), { minLength: 1, maxLength: 8 }),
  links: fc.array(fc.tuple(fc.nat(7), fc.nat(7), fc.constantFrom('-->', '-->|yes|', '-- no -->', '-.->', '---')), { maxLength: 12 }),
  lanes: fc.array(fc.nat(2), { maxLength: 8 }),
  mode: fc.constantFrom('lanes', 'subprocesses'),
}).map(({ shapes, links, lanes, mode }) => {
  const lines = ['flowchart LR']
  shapes.forEach((sh, i) => lines.push(`  subgraph G${lanes[i] ?? 0}`, `    n${i}${sh.replace(/t/, `Step ${i}`)}`, '  end'))
  for (const [a, b, l] of links) lines.push(`  n${a % shapes.length} ${l} n${b % shapes.length}`)
  return { text: lines.join('\n'), mode }
})

test('any well-formed flowchart gives valid BPMN that the automatic layout can draw', async () => {
  await fc.assert(
    fc.asyncProperty(flowchart, async ({ text, mode }) => {
      const r = importMermaid(text, { subgraphs: mode })
      if (!/n\d+(\[[^(/]|\(|\{|@\{ shape: (fork|delay))/.test(text)) return // seulement des données ou des notes : refusé
      assert.deepEqual(r.errors, [], text)
      const { warnings } = await moddle.fromXML(r.xml)
      assert.deepEqual(warnings.map((w) => w.message), [], text)
      const laid = await mermaidToDiagram(text, { subgraphs: mode })
      assert.deepEqual(laid.errors, [], text)
    }),
    runs(Number(process.env.FC_MERMAID_RUNS) || 150),
  )
})
