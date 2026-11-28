// Import et export Mermaid : exemples tirés de la syntaxe officielle des flowcharts
// (https://mermaid.js.org/syntax/flowchart.html), cas d'échec, aller-retour BPMN → Mermaid → BPMN.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BpmnModdle } from 'bpmn-moddle'
import { importMermaid, mermaidToDiagram, parseMermaid, extractMermaid, looksLikeMermaid, cleanText } from '../src/mermaid-import.js'
import { bpmnToMermaid } from '../src/mermaid-export.js'

const moddle = new BpmnModdle()
const FR = (en, fr) => fr

async function build(text, opts) {
  const r = importMermaid(text, opts)
  assert.deepEqual(r.errors, [], 'no error')
  const { warnings: modWarnings, rootElement } = await moddle.fromXML(r.xml)
  assert.deepEqual(modWarnings.map((w) => w.message), [], 'valid BPMN')
  const laid = await mermaidToDiagram(text, opts)
  assert.deepEqual(laid.errors, [], 'laid out')
  assert.match(laid.xml, /<bpmndi:BPMNDiagram/)
  return { ...r, defs: rootElement, laid: laid.xml, laidWarnings: laid.warnings }
}
const flowNodes = (defs) => defs.rootElements.filter((e) => e.$type === 'bpmn:Process').flatMap((p) => p.flowElements)
const byType = (defs, type) => flowNodes(defs).filter((e) => e.$type === type)
const named = (defs, name) => flowNodes(defs).find((e) => e.name === name)

test('the basic example: shapes, a decision and labelled branches, start and end added', async () => {
  const { defs, counts } = await build(`flowchart LR
    A[Hard edge] -->|Link text| B(Round edge)
    B --> C{Decision}
    C -->|One| D[Result one]
    C -->|Two| E[Result two]`)
  assert.equal(counts.tasks, 4)
  const gw = byType(defs, 'bpmn:ExclusiveGateway')
  assert.equal(gw.length, 1)
  assert.equal(gw[0].name, 'Decision')
  assert.deepEqual(gw[0].outgoing.map((f) => f.name).sort(), ['One', 'Two'])
  assert.equal(byType(defs, 'bpmn:StartEvent').length, 1)
  assert.equal(byType(defs, 'bpmn:EndEvent').length, 1)
  // Le libellé d'un lien qui ne part pas d'une passerelle reste sur le flux.
  assert.equal(named(defs, 'Hard edge').outgoing[0].name, 'Link text')
})

test('chains and the & operator expand into one flow per pair', () => {
  const g = parseMermaid('flowchart TB\n  A & B--> C & D\n  a --> b & c--> d')
  const pairs = g.edges.map((e) => `${e.from}>${e.to}`)
  assert.deepEqual(pairs, ['A>C', 'A>D', 'B>C', 'B>D', 'a>b', 'a>c', 'b>d', 'c>d'])
  assert.equal(g.direction, 'TB')
})

test('every link form of the documentation is read, with its text', () => {
  const g = parseMermaid(`graph LR
    A-- This is the text! ---B
    A---|This is the text|C
    A-->|text|D
    A-- text -->E
    A-.->F
    A-. text .-> G
    A ==> H
    A == text ==> I
    A ~~~ J
    A ---> K
    A -.-> L
    A <--> M
    A --o N
    A --x O
    A e1@--> P`)
  const e = Object.fromEntries(g.edges.map((x) => [x.to, x]))
  assert.equal(e.B.label, 'This is the text!')
  assert.equal(e.C.label, 'This is the text')
  assert.equal(e.D.label, 'text')
  assert.equal(e.E.label, 'text')
  assert.equal(e.G.label, 'text')
  assert.equal(e.I.label, 'text')
  assert.equal(e.J.kind, 'invisible')
  for (const k of ['F', 'H', 'K', 'L', 'P']) assert.equal(e[k].kind, 'flow', k)
  assert.equal(e.M.back, '<')
  assert.equal(e.N.arrow, 'o')
  assert.equal(e.O.arrow, 'x')
  assert.equal(g.warnings.length, 0)
})

test('shapes map to their documented meaning', async () => {
  const { defs, laidWarnings } = await build(`flowchart LR
    s([Order received]) --> t[Check] --> sub[[Ship]] --> w@{ shape: delay, label: "Wait 2 days" }
    w --> m@{ shape: manual-input, label: "Sign" } --> f@{ shape: fork } --> a[A] & b[B]
    a --> j@{ shape: fork } --> e(((Done)))
    b --> j
    t --> db[(CRM)]
    doc[/Invoice/] --> sub
    n@{ shape: comment, label: "Ask the customer" } -.- t
    h{{Prepare}} --> t`)
  assert.equal(named(defs, 'Order received').$type, 'bpmn:StartEvent')
  assert.equal(named(defs, 'Ship').$type, 'bpmn:CallActivity')
  const wait = named(defs, 'Wait 2 days')
  assert.equal(wait.$type, 'bpmn:IntermediateCatchEvent')
  assert.equal(wait.eventDefinitions[0].$type, 'bpmn:TimerEventDefinition')
  assert.equal(named(defs, 'Sign').$type, 'bpmn:ManualTask')
  assert.equal(byType(defs, 'bpmn:ParallelGateway').length, 2)
  assert.equal(named(defs, 'Done').$type, 'bpmn:EndEvent')
  assert.equal(named(defs, 'CRM').$type, 'bpmn:DataStoreReference')
  assert.equal(named(defs, 'Invoice').$type, 'bpmn:DataObjectReference')
  assert.equal(named(defs, 'Check').dataOutputAssociations[0].targetRef.name, 'CRM')
  assert.equal(named(defs, 'Ship').dataInputAssociations[0].sourceRef[0].name, 'Invoice')
  assert.deepEqual(laidWarnings, [], 'everything placed')
  const proc = defs.rootElements.find((r) => r.$type === 'bpmn:Process')
  assert.equal(proc.artifacts.find((a) => a.$type === 'bpmn:TextAnnotation').text, 'Ask the customer')
  assert.equal(proc.artifacts.find((a) => a.$type === 'bpmn:Association').sourceRef.name, 'Check')
  // Hexagone : pas d'équivalent BPMN, reste une tâche.
  assert.equal(named(defs, 'Prepare').$type, 'bpmn:Task')
})

test('events: a circle without incoming link starts, without outgoing link ends, else is intermediate', async () => {
  const { defs } = await build('flowchart LR\n  a((Begin)) --> b[Work] --> c((Reached)) --> d([Stop])')
  assert.equal(named(defs, 'Begin').$type, 'bpmn:StartEvent')
  assert.equal(named(defs, 'Reached').$type, 'bpmn:IntermediateThrowEvent')
  assert.equal(named(defs, 'Stop').$type, 'bpmn:EndEvent')
})

test('a task with several outgoing links gets a split gateway; branches meet in a matching join', async () => {
  const par = await build('flowchart LR\n  A[Order] --> B[Pack] & C[Invoice]\n  B --> D[Ship]\n  C --> D')
  assert.equal(byType(par.defs, 'bpmn:ParallelGateway').length, 2, 'parallel split and join')
  const xor = await build('flowchart LR\n  A[Check] -->|ok| B[Accept]\n  A -->|ko| C[Refuse]\n  B --> D[Notify]\n  C --> D')
  assert.equal(byType(xor.defs, 'bpmn:ExclusiveGateway').length, 2, 'exclusive split and merge')
  assert.equal(byType(xor.defs, 'bpmn:ParallelGateway').length, 0)
})

test('subgraphs become lanes, the explicit title wins, steps outside go to "Other"', async () => {
  const { defs, counts, warnings } = await build(`flowchart TB
    c1-->a2
    subgraph one
    a1-->a2
    end
    subgraph ide1 [two]
    b1-->b2
    end`, { T: FR, name: 'Atelier' })
  assert.equal(counts.lanes, 3)
  const lanes = defs.rootElements.find((r) => r.$type === 'bpmn:Process').laneSets[0].lanes
  assert.deepEqual(lanes.map((l) => l.name), ['one', 'two', 'Autre'])
  assert.ok(lanes[0].flowNodeRef.some((n) => n.name === 'a2'))
  assert.equal(defs.rootElements.find((r) => r.$type === 'bpmn:Collaboration').participants[0].name, 'Atelier')
  assert.ok(warnings.some((w) => w.includes('Autre')))
})

test('subgraphs as subprocesses: content inside, crossing links attached to the subprocess', async () => {
  const { defs, warnings } = await build(`flowchart TD
    Start --> one
    subgraph one [My Group]
        A --> B
        B --> C
    end
    one --> Fin
    C --> X`, { subgraphs: 'subprocesses' })
  const sp = byType(defs, 'bpmn:SubProcess')[0]
  assert.equal(sp.name, 'My Group')
  assert.deepEqual(sp.flowElements.filter((e) => e.$type === 'bpmn:Task').map((e) => e.name).sort(), ['A', 'B', 'C'])
  assert.ok(sp.flowElements.some((e) => e.$type === 'bpmn:StartEvent'))
  assert.ok(sp.outgoing.length >= 1)
  assert.ok(warnings.some((w) => w.includes('subprocess')))
})

test('a link to a subgraph, read as lanes, goes to its first steps', () => {
  const r = importMermaid('flowchart LR\n  S[Request] --> grp\n  subgraph grp [Team]\n    A --> B\n  end')
  assert.match(r.xml, /name="Request"/)
  assert.ok(/sourceRef="Activity_\d+" targetRef="Activity_\d+"/.test(r.xml))
  assert.equal(r.counts.tasks, 3)
})

test('text: quotes, markdown strings, <br>, entity codes, icons, ids as labels', () => {
  assert.equal(cleanText('"A quote #quot;here#quot;"'), 'A quote "here"')
  assert.equal(cleanText('"`**Bold** and *italic*`"'), 'Bold and italic')
  assert.equal(cleanText('Line one<br/>line two'), 'Line one\nline two')
  assert.equal(cleanText('I #9829; BPMN'), 'I ♥ BPMN')
  assert.equal(cleanText('fa:fa-car Drive'), 'Drive')
  const g = parseMermaid('flowchart LR\n  id1["This is the (text) in the box"] --> id2\n  id3["Unicode: ❤ é"]')
  assert.equal(g.nodes.get('id1').label, 'This is the (text) in the box')
  assert.equal(g.nodes.get('id2').label, 'id2')
  assert.equal(g.nodes.get('id3').label, 'Unicode: ❤ é')
})

test('styles, clicks, comments, front matter and directives are ignored, and said so', () => {
  const g = parseMermaid(`---
title: Demo
config:
  look: handDrawn
---
%%{init: {"theme": "dark"}}%%
flowchart LR
  %% a comment
  A:::red --> B
  classDef red fill:#f00
  class B red
  style A stroke:#333
  linkStyle 0 stroke:#ff3
  click A "https://example.com"
  e1@{ animate: true }`)
  assert.equal(g.errors.length, 0)
  assert.deepEqual([...g.nodes.keys()], ['A', 'B'])
  assert.equal(g.edges.length, 1)
  assert.ok(g.warnings.some((w) => w.includes('classDef')))
})

test('Markdown: the first ```mermaid block is taken', () => {
  const md = '# Notes\n\nSome text.\n\n```mermaid\ngraph TD\n  A --> B\n```\n\n```mermaid\ngraph TD\n  C --> D\n```\n'
  assert.equal(extractMermaid(md).fenced, true)
  assert.ok(looksLikeMermaid(md))
  assert.deepEqual([...parseMermaid(md).nodes.keys()], ['A', 'B'])
  assert.ok(looksLikeMermaid('flowchart LR\nA-->B'))
  assert.ok(!looksLikeMermaid('<?xml version="1.0"?><definitions/>'))
})

test('refused: other Mermaid diagrams, empty text, plain text', () => {
  assert.match(importMermaid('sequenceDiagram\n  Alice->>Bob: Hi').errors[0], /sequenceDiagram/)
  assert.match(importMermaid('stateDiagram-v2\n  [*] --> A', { T: FR }).errors[0], /stateDiagram-v2.*pas un flowchart/)
  assert.match(importMermaid('   \n\n').errors[0], /empty/)
  assert.match(importMermaid('Hello world').errors[0], /flowchart/)
  assert.match(importMermaid('flowchart LR\n').errors[0], /no node/)
})

test('a line that cannot be read is reported with its number, the rest is imported', () => {
  const r = importMermaid('flowchart LR\n  A --> B\n  C[unclosed --> D\n  B --> E\n  B ==> ==> F')
  assert.deepEqual(r.errors, [])
  assert.ok(r.warnings.some((w) => /^Line 3: a quote or a bracket is not closed/.test(w)), r.warnings.join('\n'))
  assert.ok(r.warnings.some((w) => /^Line 5: not understood/.test(w)), r.warnings.join('\n'))
  assert.deepEqual([...r.graph.nodes.keys()], ['A', 'B', 'E'])
  const quoted = parseMermaid('flowchart LR\n  A["two\nlines"] --> B')
  assert.equal(quoted.nodes.get('A').label, 'two lines')
})

test('round trip: BPMN to Mermaid and back keeps steps, gateways, lanes and conditions', async () => {
  const src = `flowchart LR
    subgraph Sales
      s([Order]) --> c{In stock?}
    end
    subgraph Warehouse
      c -->|yes| p[Pack] --> sh[[Ship]] --> e(((Delivered)))
      c -->|no| o[Order from supplier] --> p
    end
    p --> db[(ERP)]`
  const first = await build(src)
  const { rootElement } = await moddle.fromXML(first.laid)
  const mmd = bpmnToMermaid(rootElement)
  assert.match(mmd, /^flowchart LR\n/)
  assert.match(mmd, /subgraph \w+\["Sales"\]/)
  assert.match(mmd, /-->\|"yes"\|/)
  assert.match(mmd, /\[\("ERP"\)\]/)
  const second = await build(mmd)
  for (const k of ['tasks', 'events', 'data', 'lanes']) assert.equal(second.counts[k], first.counts[k], k)
  assert.equal(byType(second.defs, 'bpmn:ExclusiveGateway').length, byType(first.defs, 'bpmn:ExclusiveGateway').length)
  assert.equal(named(second.defs, 'Ship').$type, 'bpmn:CallActivity')
})

test('export: pools, message flows, annotations, expanded subprocesses, parallel gateways', async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="D" targetNamespace="x">
  <bpmn:collaboration id="C">
    <bpmn:participant id="P1" name="Customer" processRef="Pr1" />
    <bpmn:participant id="P2" name="Shop" processRef="Pr2" />
    <bpmn:messageFlow id="M1" name="order" sourceRef="T1" targetRef="T2" />
  </bpmn:collaboration>
  <bpmn:process id="Pr1"><bpmn:task id="T1" name="Send &quot;order&quot;" /></bpmn:process>
  <bpmn:process id="Pr2">
    <bpmn:task id="T2" name="Receive" />
    <bpmn:parallelGateway id="end" />
    <bpmn:subProcess id="S1" name="Prepare"><bpmn:task id="T3" name="Pick" /></bpmn:subProcess>
    <bpmn:sequenceFlow id="F1" sourceRef="T2" targetRef="end" />
    <bpmn:sequenceFlow id="F2" sourceRef="end" targetRef="S1" />
    <bpmn:textAnnotation id="A1"><bpmn:text>Line one
line two</bpmn:text></bpmn:textAnnotation>
    <bpmn:association id="As1" sourceRef="T2" targetRef="A1" />
  </bpmn:process>
</bpmn:definitions>`
  const { rootElement } = await moddle.fromXML(xml)
  const mmd = bpmnToMermaid(rootElement)
  assert.match(mmd, /subgraph P1\["Customer"\]/)
  assert.match(mmd, /T1\["Send #quot;order#quot;"\]/)
  assert.match(mmd, /T1 -\.->\|"order"\| T2/)
  assert.match(mmd, /n_end\{"\+"\}/, 'reserved id renamed, parallel gateway marked +')
  assert.match(mmd, /subgraph S1\["Prepare"\]/)
  assert.match(mmd, /A1@\{ shape: braces, label: "Line one<br>line two" \}/)
  assert.match(mmd, /T2 -\.- A1/)
  // Le texte exporté se relit sans erreur.
  const back = parseMermaid(mmd)
  assert.deepEqual(back.errors, [])
  assert.deepEqual(back.warnings, [])
  assert.equal(back.nodes.get('n_end').label, '+')
})
