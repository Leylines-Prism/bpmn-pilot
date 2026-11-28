// Éléments sans flux de séquence (src/unconnected.js), signalés par add_shapes, connect_shapes et export_diagram.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BpmnModdle } from 'bpmn-moddle'
import { unconnectedNodes, unconnectedNotice } from '../src/unconnected.js'

const moddle = BpmnModdle()
const NS = 'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"'
const read = async (semantic) =>
  (await moddle.fromXML(`<?xml version="1.0" encoding="UTF-8"?><bpmn:definitions ${NS} id="Defs" targetNamespace="http://example.com">${semantic}</bpmn:definitions>`)).rootElement

test('a fully connected process has nothing to report', async () => {
  const defs = await read(`<bpmn:process id="P"><bpmn:startEvent id="S" /><bpmn:task id="T" /><bpmn:endEvent id="E" />
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="T" /><bpmn:sequenceFlow id="F2" sourceRef="T" targetRef="E" /></bpmn:process>`)
  assert.deepEqual(unconnectedNodes(defs), [])
  assert.deepEqual(unconnectedNotice(defs), {})
})

test('each element says which flow it lacks', async () => {
  const defs = await read(`<bpmn:process id="P"><bpmn:startEvent id="S" /><bpmn:task id="T" name=" Check order " /><bpmn:exclusiveGateway id="G" /><bpmn:endEvent id="E" />
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="T" /></bpmn:process>`)
  assert.deepEqual(unconnectedNodes(defs), [
    { id: 'T', type: 'Task', missing: ['outgoing'], name: 'Check order' },
    { id: 'G', type: 'ExclusiveGateway', missing: ['incoming', 'outgoing'] },
    { id: 'E', type: 'EndEvent', missing: ['incoming'] },
  ])
  const notice = unconnectedNotice(defs)
  assert.equal(notice.unconnected.length, 3)
  assert.match(notice.hint, /connect_shapes/)
  assert.match(notice.hint, /validate_diagram/)
  assert.match(unconnectedNotice(defs, { exporting: true }).hint, /was exported/)
})

test('elements that never take sequence flows are left out', async () => {
  const defs = await read(`<bpmn:process id="P">
    <bpmn:startEvent id="S" /><bpmn:task id="T" /><bpmn:endEvent id="E" />
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="T" /><bpmn:sequenceFlow id="F2" sourceRef="T" targetRef="E" />
    <bpmn:boundaryEvent id="BC" attachedToRef="T"><bpmn:compensateEventDefinition /></bpmn:boundaryEvent>
    <bpmn:task id="Undo" isForCompensation="true" />
    <bpmn:intermediateThrowEvent id="LT"><bpmn:incoming>F3</bpmn:incoming><bpmn:linkEventDefinition name="A" /></bpmn:intermediateThrowEvent>
    <bpmn:intermediateCatchEvent id="LC"><bpmn:outgoing>F4</bpmn:outgoing><bpmn:linkEventDefinition name="A" /></bpmn:intermediateCatchEvent>
    <bpmn:task id="T2" /><bpmn:task id="T3" />
    <bpmn:sequenceFlow id="F3" sourceRef="T2" targetRef="LT" /><bpmn:sequenceFlow id="F4" sourceRef="LC" targetRef="T3" />
    <bpmn:subProcess id="ESP" triggeredByEvent="true"><bpmn:startEvent id="ES" /><bpmn:endEvent id="EE" /><bpmn:sequenceFlow id="F5" sourceRef="ES" targetRef="EE" /></bpmn:subProcess>
    <bpmn:adHocSubProcess id="AH"><bpmn:task id="Free" /></bpmn:adHocSubProcess>
  </bpmn:process>`)
  // T2 n'a pas d'entrée, T3 pas de sortie, AH n'est relié à rien : ce sont les seuls.
  assert.deepEqual(unconnectedNodes(defs).map((e) => e.id), ['T2', 'T3', 'AH'])
})

test('a boundary event needs an outgoing flow, and nested subprocesses are checked', async () => {
  const defs = await read(`<bpmn:process id="P"><bpmn:startEvent id="S" /><bpmn:subProcess id="SP"><bpmn:task id="Inner" /></bpmn:subProcess><bpmn:endEvent id="E" />
    <bpmn:boundaryEvent id="B" attachedToRef="SP"><bpmn:timerEventDefinition /></bpmn:boundaryEvent>
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="SP" /><bpmn:sequenceFlow id="F2" sourceRef="SP" targetRef="E" /></bpmn:process>`)
  assert.deepEqual(unconnectedNodes(defs).map((e) => [e.id, e.missing.join('+')]), [['Inner', 'incoming+outgoing'], ['B', 'outgoing']])
})

test('every pool of a collaboration is checked, and a long list is cut at ten', async () => {
  const tasks = Array.from({ length: 12 }, (_, i) => `<bpmn:task id="T${i}" />`).join('')
  const defs = await read(`<bpmn:collaboration id="C"><bpmn:participant id="A" processRef="P1" /><bpmn:participant id="B" processRef="P2" /></bpmn:collaboration>
    <bpmn:process id="P1">${tasks}</bpmn:process><bpmn:process id="P2"><bpmn:task id="Other" /></bpmn:process>`)
  assert.equal(unconnectedNodes(defs).length, 13)
  const notice = unconnectedNotice(defs)
  assert.equal(notice.unconnected.length, 10)
  assert.equal(notice.moreUnconnected, 3)
})
