// Série de jetons de la carte de chaleur (src/simulation-stats.js), sur des modèles lus par
// bpmn-moddle avec l'extension BPMN Pilot (probabilités des branches).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BpmnModdle } from 'bpmn-moddle'
import { runBatch, branchWeights } from '../src/simulation-stats.js'

const extension = JSON.parse(readFileSync(new URL('../src/bpmn-pilot-moddle.json', import.meta.url)))
const moddle = new BpmnModdle({ bpmnpilot: extension })

const process = (body) => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmnpilot="${extension.uri}" id="D" targetNamespace="http://example.com">
  <bpmn:process id="P">${body}</bpmn:process>
</bpmn:definitions>`

const flow = (id, from, to, p) => `<bpmn:sequenceFlow id="${id}" sourceRef="${from}" targetRef="${to}"${p === undefined ? '' : ` bpmnpilot:probability="${p}"`} />`

// Générateur pseudo-aléatoire reproductible.
function seeded(seed) {
  let s = seed
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296)
}

async function load(xml) {
  const { rootElement, warnings } = await moddle.fromXML(xml)
  assert.deepEqual(warnings, [])
  return rootElement
}

test('exclusive gateway follows the probabilities, parallel gateway joins once', async () => {
  const defs = await load(process(`
    <bpmn:startEvent id="S" />
    <bpmn:exclusiveGateway id="X" />
    <bpmn:task id="A" /><bpmn:task id="B" />
    <bpmn:exclusiveGateway id="M" />
    <bpmn:parallelGateway id="F" />
    <bpmn:task id="C" /><bpmn:task id="E" />
    <bpmn:parallelGateway id="J" />
    <bpmn:endEvent id="End" />
    ${flow('s-x', 'S', 'X')}${flow('x-a', 'X', 'A', 80)}${flow('x-b', 'X', 'B', 20)}
    ${flow('a-m', 'A', 'M')}${flow('b-m', 'B', 'M')}${flow('m-f', 'M', 'F')}
    ${flow('f-c', 'F', 'C')}${flow('f-e', 'F', 'E')}${flow('c-j', 'C', 'J')}${flow('e-j', 'E', 'J')}${flow('j-end', 'J', 'End')}`))
  const r = runBatch(defs, 1000, seeded(1))
  assert.equal(r.runs, 1000)
  assert.equal(r.nodes.S, 1000)
  assert.equal(r.nodes.A + r.nodes.B, 1000)
  assert.ok(r.nodes.A > 740 && r.nodes.A < 860, `A = ${r.nodes.A}`)
  assert.equal(r.nodes.C, 1000)
  assert.equal(r.nodes.J, 1000)
  assert.equal(r.nodes.End, 1000)
  assert.equal(r.flows['x-a'], r.nodes.A)
  assert.equal(r.truncated, 0)
})

test('a rework loop counts the activity more often than instances', async () => {
  const defs = await load(process(`
    <bpmn:startEvent id="S" /><bpmn:task id="Check" />
    <bpmn:exclusiveGateway id="OK" /><bpmn:task id="Ask" /><bpmn:endEvent id="End" />
    ${flow('f1', 'S', 'Check')}${flow('f2', 'Check', 'OK')}${flow('f3', 'OK', 'End', 60)}${flow('f4', 'OK', 'Ask', 40)}${flow('f5', 'Ask', 'Check')}`))
  const r = runBatch(defs, 500, seeded(7))
  assert.ok(r.nodes.Check > 500)
  assert.equal(r.nodes.End, 500)
  assert.equal(r.nodes.Check, 500 + r.nodes.Ask)
})

test('a loop without exit stops after the step limit', async () => {
  const defs = await load(process(`
    <bpmn:startEvent id="S" /><bpmn:task id="A" /><bpmn:task id="B" />
    ${flow('f1', 'S', 'A')}${flow('f2', 'A', 'B')}${flow('f3', 'B', 'A')}`))
  const r = runBatch(defs, 3, seeded(3))
  assert.equal(r.truncated, 3)
})

test('branches without probability share the rest', () => {
  const f = (p) => ({ get: () => p })
  assert.deepEqual(branchWeights([f(50), f(undefined), f(undefined)]), [0.5, 0.25, 0.25])
  assert.deepEqual(branchWeights([f(undefined), f(undefined)]), [0.5, 0.5])
  assert.deepEqual(branchWeights([f(30), f(30)]), [0.5, 0.5])
})

test('the probability attribute survives a round trip', async () => {
  const defs = await load(process(`<bpmn:startEvent id="S" /><bpmn:endEvent id="E" />${flow('f', 'S', 'E', 42.5)}`))
  const { xml } = await moddle.toXML(defs)
  assert.match(xml, /bpmnpilot:probability="42.5"/)
})

test('a parallel merge after an exclusive split counts blocked instances', async () => {
  const defs = await load(process(`
    <bpmn:startEvent id="S" />
    <bpmn:exclusiveGateway id="X" />
    <bpmn:task id="A" /><bpmn:task id="B" />
    <bpmn:parallelGateway id="J" />
    <bpmn:endEvent id="End" />
    ${flow('s-x', 'S', 'X')}${flow('x-a', 'X', 'A', 50)}${flow('x-b', 'X', 'B', 50)}
    ${flow('a-j', 'A', 'J')}${flow('b-j', 'B', 'J')}${flow('j-end', 'J', 'End')}`))
  const r = runBatch(defs, 200, seeded(3))
  assert.equal(r.blocked, 200)
  assert.deepEqual(r.blockedAt, { J: 200 })
  assert.equal(r.nodes.End, undefined)
})

test('a well-formed process has no blocked instance, a terminate end does not block', async () => {
  const defs = await load(process(`
    <bpmn:startEvent id="S" />
    <bpmn:parallelGateway id="F" />
    <bpmn:task id="A" /><bpmn:task id="B" />
    <bpmn:parallelGateway id="J" />
    <bpmn:endEvent id="End" />
    <bpmn:endEvent id="Stop"><bpmn:terminateEventDefinition /></bpmn:endEvent>
    ${flow('s-f', 'S', 'F')}${flow('f-a', 'F', 'A')}${flow('f-b', 'F', 'B')}
    ${flow('a-j', 'A', 'J')}${flow('b-stop', 'B', 'Stop')}${flow('j-end', 'J', 'End')}`))
  const r = runBatch(defs, 50, seeded(4))
  assert.equal(r.blocked, 0)
  assert.deepEqual(r.blockedAt, {})
})
