// Branches de passerelle sans nom (src/lint/gateway-branches.js) et sa règle bpmnlint.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BpmnModdle } from 'bpmn-moddle'
import { Linter } from 'bpmnlint'
import { unnamedBranches, GATEWAY_BRANCH_MESSAGE } from '../src/lint/gateway-branches.js'
import lintConfig from '../src/lint/lint-config.js'

const NS = 'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"'
const read = async (body) =>
  (await new BpmnModdle().fromXML(`<bpmn:definitions ${NS} id="D" targetNamespace="http://example.com"><bpmn:process id="P">${body}</bpmn:process></bpmn:definitions>`)).rootElement
const gateway = (defs) => defs.rootElements[0].flowElements.find((e) => e.id === 'G')

const split = (gw, a, b, extra = '') => `<bpmn:startEvent id="S" />${gw}<bpmn:task id="T1" name="One" /><bpmn:task id="T2" name="Two" />
  <bpmn:sequenceFlow id="F0" sourceRef="S" targetRef="G" />
  <bpmn:sequenceFlow id="F1" sourceRef="G" targetRef="T1"${a} />
  <bpmn:sequenceFlow id="F2" sourceRef="G" targetRef="T2"${b} />${extra}`

test('unnamed branches of an exclusive or inclusive split are found', async () => {
  const xor = await read(split('<bpmn:exclusiveGateway id="G" name="In stock?" />', '', ' name="No"'))
  assert.deepEqual(unnamedBranches(gateway(xor)).map((f) => f.id), ['F1'])
  const or = await read(split('<bpmn:inclusiveGateway id="G" />', '', ''))
  assert.deepEqual(unnamedBranches(gateway(or)).map((f) => f.id), ['F1', 'F2'])
})

test('named branches, parallel splits, merges and conditional splits are left alone', async () => {
  assert.deepEqual(unnamedBranches(gateway(await read(split('<bpmn:exclusiveGateway id="G" />', ' name="Yes"', ' name="No"')))), [])
  assert.deepEqual(unnamedBranches(gateway(await read(split('<bpmn:parallelGateway id="G" />', '', '')))), [])
  assert.deepEqual(unnamedBranches(gateway(await read(split('<bpmn:exclusiveGateway id="G" default="F2" />', '', '')))), [])
  const cond = split('<bpmn:exclusiveGateway id="G" />', '', '').replace('targetRef="T1" />', 'targetRef="T1"><bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">=x</bpmn:conditionExpression></bpmn:sequenceFlow>')
  assert.deepEqual(unnamedBranches(gateway(await read(cond))), [])
  const merge = await read('<bpmn:task id="A" /><bpmn:task id="B" /><bpmn:exclusiveGateway id="G" /><bpmn:endEvent id="E" /><bpmn:sequenceFlow id="F1" sourceRef="A" targetRef="G" /><bpmn:sequenceFlow id="F2" sourceRef="B" targetRef="G" /><bpmn:sequenceFlow id="F3" sourceRef="G" targetRef="E" />')
  assert.deepEqual(unnamedBranches(gateway(merge)), [])
})

test('the rule is part of the editor checks, as a warning on the flow', async () => {
  const defs = await read(split('<bpmn:exclusiveGateway id="G" name="In stock?" />', '', ' name="No"'))
  const results = await new Linter(lintConfig).lint(defs)
  const found = results['bpmnpilot/gateway-branch-names'] || []
  assert.deepEqual(found.map((r) => [r.id, r.message, r.category]), [['F1', GATEWAY_BRANCH_MESSAGE, 'warn']])
})
