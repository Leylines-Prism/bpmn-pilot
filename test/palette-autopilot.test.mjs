// Profils de palette (src/palette-profiles.js) et choix des branches du pilote automatique
// de la simulation (src/simulation-autopilot.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { BpmnModdle } from 'bpmn-moddle'
import { keepEntry } from '../src/palette-profiles.js'
import { chooseBranches } from '../src/simulation-autopilot.js'

test('the Essential profile keeps start, task, exclusive gateway and end, and the commands', () => {
  for (const id of ['create.start-event', 'create.task', 'create.exclusive-gateway', 'create.end-event', 'hand-tool', 'global-connect-tool']) assert.ok(keepEntry('essential', 'palette', id), id)
  for (const id of ['create.intermediate-event', 'create.data-object', 'create.participant-expanded', 'create.subprocess-expanded', 'create']) assert.ok(!keepEntry('essential', 'palette', id), id)
  for (const id of ['append.end-event', 'append.gateway', 'append.append-task', 'replace', 'connect', 'delete', 'set-color']) assert.ok(keepEntry('essential', 'context-pad', id), id)
  for (const id of ['append.intermediate-event', 'append.text-annotation', 'append']) assert.ok(!keepEntry('essential', 'context-pad', id), id)
  for (const id of ['create-task', 'create-exclusive-gateway', 'create-none-start-event', 'append-none-end-event', 'replace-with-task', 'replace-with-none-end', 'replace-with-default-flow']) assert.ok(keepEntry('essential', 'menu', id), id)
  for (const id of ['create-user-task', 'append-parallel-gateway', 'replace-with-service-task', 'create-message-start']) assert.ok(!keepEntry('essential', 'menu', id), id)
})

test('the Camunda 8 profile hides only what the engine does not run', () => {
  for (const id of ['create-complex-gateway', 'append-transaction', 'create-cancel-end', 'append-cancel-boundary', 'replace-with-complex-gateway']) assert.ok(!keepEntry('camunda8', 'menu', id), id)
  for (const id of ['create-inclusive-gateway', 'create-conditional-start', 'append-compensation-end', 'create-expanded-ad-hoc-subprocess', 'replace-with-call-activity']) assert.ok(keepEntry('camunda8', 'menu', id), id)
  assert.ok(keepEntry('camunda8', 'palette', 'create.participant-expanded'))
  assert.ok(keepEntry('full', 'menu', 'create-complex-gateway'))
})

const extension = JSON.parse(readFileSync(new URL('../src/bpmn-pilot-moddle.json', import.meta.url)))
const moddle = new BpmnModdle({ bpmnpilot: extension })
const seeded = (seed) => { let s = seed; return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296) }

async function gateway(type, probabilities) {
  const flows = probabilities.map((p, i) => `<bpmn:sequenceFlow id="f${i}" sourceRef="G" targetRef="T${i}"${p === undefined ? '' : ` bpmnpilot:probability="${p}"`} /><bpmn:task id="T${i}" />`).join('')
  const { rootElement } = await moddle.fromXML(`<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmnpilot="${extension.uri}" id="D" targetNamespace="http://example.com">
  <bpmn:process id="P"><bpmn:${type} id="G" />${flows}</bpmn:process>
</bpmn:definitions>`)
  const els = rootElement.rootElements[0].flowElements
  return { g: els.find((e) => e.id === 'G'), out: els.filter((e) => e.$type === 'bpmn:SequenceFlow') }
}

test('the autopilot follows the probabilities of an exclusive gateway', async () => {
  const { g, out } = await gateway('exclusiveGateway', [90, 10])
  const random = seeded(7)
  let first = 0
  for (let i = 0; i < 1000; i++) {
    const chosen = chooseBranches(g, out, [], { random })
    assert.equal(chosen.length, 1)
    if (chosen[0] === out[0]) first++
  }
  assert.ok(first > 860 && first < 940, `first = ${first}`)
})

test('the autopilot takes the weights of the decision table when given', async () => {
  const { g, out } = await gateway('exclusiveGateway', [undefined, undefined])
  const chosen = chooseBranches(g, out, [], { branchHint: () => [0, 1], random: seeded(2) })
  assert.deepEqual(chosen, [out[1]])
})

test('the autopilot takes at least one branch of an inclusive gateway', async () => {
  const { g, out } = await gateway('inclusiveGateway', [0, 0])
  assert.equal(chooseBranches(g, out, [], { random: seeded(5) }).length, 1)
  const all = await gateway('inclusiveGateway', [100, 100])
  assert.equal(chooseBranches(all.g, all.out, [], { random: seeded(5) }).length, 2)
})

test('the autopilot leaves other gateways alone', async () => {
  const { g, out } = await gateway('parallelGateway', [undefined, undefined])
  assert.equal(chooseBranches(g, out, []), null)
})
