// Formulaires des tâches (src/forms/) : rangement dans le .bpmn avec le lien Camunda 8,
// schéma écrit depuis une description simple, champs et variables, contrôle des données
// (src/lint/form-data.js), choix des branches pendant la simulation, et arguments des outils.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as z from 'zod'
import { BpmnModdle } from 'bpmn-moddle'
import { Linter } from 'bpmnlint'
import zeebe from 'zeebe-bpmn-moddle/resources/zeebe.json' with { type: 'json' }
import bpmnpilot from '../src/bpmn-pilot-moddle.json' with { type: 'json' }
import { formOf, formProperties, schemaFromSpec, formFields, formVariables, formsOf, checkForm, describeForm, keyFromLabel, emptySchema } from '../src/forms/form-store.js'
import { expressionVariables, gatewayVariables, decisionInputs, missingFormData, FORM_DATA_MESSAGE } from '../src/lint/form-data.js'
import { chooseFlow } from '../src/forms/form-routing.js'
import lintConfig from '../src/lint/lint-config.js'
import { createToolSet, runTool } from '../src/ai/chat-loop.js'

const NS = 'xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmnpilot="https://bpmn.leylines.fr/schema/bpmn-pilot/1.0" xmlns:zeebe="http://camunda.org/schema/zeebe/1.0"'
const moddle = new BpmnModdle({ bpmnpilot, zeebe })
const read = async (body, extra = '') =>
  (await moddle.fromXML(`<bpmn:definitions ${NS} id="D" targetNamespace="http://example.com"><bpmn:process id="P">${body}</bpmn:process>${extra}</bpmn:definitions>`)).rootElement
const byId = (defs, id) => {
  const all = []
  const walk = (c) => { for (const e of c.flowElements || []) { all.push(e); walk(e) } }
  walk(defs.rootElements[0])
  return all.find((e) => e.id === id)
}
const flows = (...pairs) => pairs.map(([s, t, extra = ''], i) => `<bpmn:sequenceFlow id="F${i}" sourceRef="${s}" targetRef="${t}"${extra}`).map((f) => (f.includes('>') ? f : `${f} />`)).join('')

const EXPENSE = {
  title: 'Note de frais',
  fields: [
    { label: 'Montant', type: 'number', required: true, min: 0 },
    { key: 'categorie', label: 'Catégorie', type: 'select', values: ['Transport', 'Repas'] },
    { label: 'Commentaire', type: 'textarea' },
  ],
}

const formXml = (schema) => `<bpmn:extensionElements><bpmnpilot:taskForm>${JSON.stringify(schema).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</bpmnpilot:taskForm></bpmn:extensionElements>`

test('a simple description becomes a form-js schema with keys, checks and values', () => {
  const schema = schemaFromSpec(EXPENSE, 'Form_T')
  assert.equal(schema.id, 'Form_T')
  assert.equal(schema.type, 'default')
  assert.equal(schema.components[0].type, 'text')
  assert.match(schema.components[0].text, /## Note de frais/)
  const amount = schema.components.find((c) => c.key === 'montant')
  assert.deepEqual(amount.validate, { required: true, min: 0 })
  assert.deepEqual(schema.components.find((c) => c.key === 'categorie').values, [{ label: 'Transport', value: 'Transport' }, { label: 'Repas', value: 'Repas' }])
  assert.deepEqual(formVariables(schema), ['montant', 'categorie', 'commentaire'])
  assert.equal(keyFromLabel('Date de départ'), 'dateDeDepart')
  assert.throws(() => schemaFromSpec({ fields: [{ label: 'A' }, { key: 'a', label: 'B' }] }, 'F'), /key "a"/)
  assert.throws(() => schemaFromSpec({ fields: [{ label: 'Choix', type: 'radio' }] }, 'F'), /needs its values/)
  assert.deepEqual(checkForm(schema), [])
  assert.deepEqual(checkForm(emptySchema({ id: 'T', name: 'Saisir' })).map((f) => f.code), ['no-field'])
  assert.equal(describeForm(schema).title, 'Note de frais')
})

test('fields inside groups and dynamic lists keep their path', () => {
  const schema = { components: [
    { type: 'text', text: 'Intro' },
    { type: 'group', path: 'client', components: [{ type: 'textfield', key: 'nom', label: 'Nom' }] },
    { type: 'group', components: [{ type: 'number', key: 'age', label: 'Âge', validate: { required: true } }] },
    { type: 'textfield', key: 'ref', label: 'Réf', readonly: true },
  ] }
  assert.deepEqual(formFields(schema).map((f) => f.path), ['client.nom', 'age', 'ref'])
  assert.deepEqual(formVariables(schema), ['client', 'age'])
  const dup = { components: [{ type: 'textfield', key: 'x' }, { type: 'number', key: 'x' }] }
  assert.ok(checkForm(dup).some((f) => f.code === 'duplicate-key'))
})

test('the form is kept in the task with the Camunda 8 link, and removed cleanly', async () => {
  const defs = await read('<bpmn:userTask id="T" name="Saisir la note" />')
  const task = byId(defs, 'T')
  const schema = schemaFromSpec(EXPENSE)
  Object.assign(task, formProperties(moddle, task, schema))
  assert.equal(formOf(task).id, 'Form_T')
  const { xml } = await moddle.toXML(defs)
  assert.match(xml, /<bpmnpilot:taskForm>\{/)
  assert.match(xml, /<zeebe:formDefinition formId="Form_T" \/>/)
  // Relu depuis le fichier : même schéma.
  const again = byId((await moddle.fromXML(xml)).rootElement, 'T')
  assert.deepEqual(formVariables(formOf(again)), ['montant', 'categorie', 'commentaire'])
  assert.equal(formsOf((await moddle.fromXML(xml)).rootElement).length, 1)
  // Retrait : plus d'extension.
  Object.assign(task, formProperties(moddle, task, null))
  assert.equal(task.extensionElements, undefined)
  assert.equal(formOf(task), null)
})

test('a Camunda form key or a broken text is left as it is', async () => {
  const defs = await read('<bpmn:userTask id="T"><bpmn:extensionElements><zeebe:formDefinition formKey="camunda-forms:bpmn:x" /><bpmnpilot:taskForm>not json</bpmnpilot:taskForm></bpmn:extensionElements></bpmn:userTask>')
  const task = byId(defs, 'T')
  assert.equal(formOf(task), null)
  Object.assign(task, formProperties(moddle, task, schemaFromSpec(EXPENSE)))
  const defsXml = (await moddle.toXML(defs)).xml
  assert.match(defsXml, /formKey="camunda-forms:bpmn:x"/)
  assert.doesNotMatch(defsXml, /formId=/)
})

test('variables are read from FEEL, JUEL and plain conditions, never from a bare answer', async () => {
  assert.deepEqual(expressionVariables('=montant > 3000 and client.type = "VIP"'), ['montant', 'client'])
  assert.deepEqual(expressionVariables('${amount >= 10 && approved}'), ['amount', 'approved'])
  assert.deepEqual(expressionVariables('= count(items) > 0 and date("2026-01-01") < today()'), ['items'])
  const defs = await read('<bpmn:exclusiveGateway id="G" name="Montant élevé ?" default="F1" /><bpmn:task id="A" /><bpmn:task id="B" /><bpmn:task id="C" />' +
    flows(['G', 'A', ' name="Montant > 3000" />'], ['G', 'B', ' name="Non" />'], ['G', 'C', '><bpmn:conditionExpression>=urgent = true</bpmn:conditionExpression></bpmn:sequenceFlow>']))
  assert.deepEqual(gatewayVariables(byId(defs, 'G')).sort(), ['montant', 'urgent'])
})

const DMN = `<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/" id="M"><decision id="Risk" name="Risque"><decisionTable>
<input id="I1"><inputExpression id="E1" typeRef="number"><text>montant</text></inputExpression></input>
<input id="I2"><inputExpression id="E2"><text>client.segment</text></inputExpression></input>
<output id="O1" name="risque" /></decisionTable></decision></definitions>`

test('the data check warns on a branch or a decision fed by no form', async () => {
  assert.deepEqual(decisionInputs(DMN).get('Risk'), ['montant', 'client'])
  const withDmn = `<bpmn:extensionElements><bpmnpilot:decisionModel>${DMN.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</bpmnpilot:decisionModel></bpmn:extensionElements>`
  const body = (form) => '<bpmn:startEvent id="S" />' +
    `<bpmn:userTask id="T" name="Saisir">${form}</bpmn:userTask>` +
    '<bpmn:businessRuleTask id="R" bpmnpilot:decisionRef="Risk" />' +
    '<bpmn:exclusiveGateway id="G" /><bpmn:endEvent id="E1" /><bpmn:endEvent id="E2" />' +
    flows(['S', 'T'], ['T', 'R'], ['R', 'G'], ['G', 'E1', ' name="Montant > 3000" />'], ['G', 'E2', ' name="Urgent = oui" />'])
  // Sans aucun formulaire : rien.
  let defs = await read(withDmn + body(''))
  assert.deepEqual(missingFormData(byId(defs, 'G')), [])
  // Le formulaire demande le montant seulement.
  const xml = `<bpmn:definitions ${NS} id="D" targetNamespace="http://example.com"><bpmn:process id="P">${withDmn}${body(formXml(schemaFromSpec(EXPENSE)))}</bpmn:process></bpmn:definitions>`
  defs = (await moddle.fromXML(xml)).rootElement
  assert.deepEqual(missingFormData(byId(defs, 'G')), ['urgent'])
  assert.deepEqual(missingFormData(byId(defs, 'R')), ['client'])
  // Branché dans la vérification de l'éditeur, en avertissement.
  const results = await new Linter(lintConfig).lint(defs)
  assert.deepEqual(results['bpmnpilot/form-data'].map((r) => [r.id, r.message, r.category]).sort(), [
    ['G', `${FORM_DATA_MESSAGE}urgent`, 'warn'],
    ['R', `${FORM_DATA_MESSAGE}client`, 'warn'],
  ])
})

test('data filled in a subprocess, a boundary path or a decision result counts', async () => {
  const form = formXml(schemaFromSpec({ fields: [{ key: 'urgent', label: 'Urgent', type: 'checkbox' }] }))
  const defs = await read('<bpmn:startEvent id="S" />' +
    `<bpmn:subProcess id="SP"><bpmn:startEvent id="S2" /><bpmn:userTask id="T">${form}</bpmn:userTask>${flows(['S2', 'T'])}</bpmn:subProcess>` +
    '<bpmn:businessRuleTask id="R"><bpmn:extensionElements><zeebe:calledDecision decisionId="Risk" resultVariable="risque" /></bpmn:extensionElements></bpmn:businessRuleTask>' +
    '<bpmn:exclusiveGateway id="G" /><bpmn:endEvent id="E1" /><bpmn:endEvent id="E2" />' +
    '<bpmn:sequenceFlow id="A1" sourceRef="S" targetRef="SP" /><bpmn:sequenceFlow id="A2" sourceRef="SP" targetRef="R" /><bpmn:sequenceFlow id="A3" sourceRef="R" targetRef="G" />' +
    '<bpmn:sequenceFlow id="A4" sourceRef="G" targetRef="E1" name="Urgent = oui" /><bpmn:sequenceFlow id="A5" sourceRef="G" targetRef="E2" name="Risque = élevé" />')
  assert.deepEqual(missingFormData(byId(defs, 'G')), [])
  // Dans le sous-processus, après la tâche : la donnée vient d'elle.
})

test('during the simulation, the entered data picks the branch', async () => {
  const defs = await read('<bpmn:exclusiveGateway id="G" name="Montant élevé ?" default="F2" /><bpmn:exclusiveGateway id="H" name="Catégorie" /><bpmn:task id="A" /><bpmn:task id="B" /><bpmn:task id="C" /><bpmn:task id="X" name="x" /><bpmn:task id="Y" />' +
    flows(['G', 'A', ' name="Montant > 3000" />'], ['G', 'B', '><bpmn:conditionExpression>=montant &gt; 1000</bpmn:conditionExpression></bpmn:sequenceFlow>'], ['G', 'C', ' name="Autre" />'],
      ['H', 'X', ' name="Transport" />'], ['H', 'Y', ' name="Repas" />']))
  const G = byId(defs, 'G')
  const out = G.outgoing?.length ? G.outgoing : defs.rootElements[0].flowElements.filter((f) => f.sourceRef === G)
  assert.equal(chooseFlow(G, out, { montant: 5000 })?.id, 'F0')
  assert.equal(chooseFlow(G, out, { montant: 2000 })?.id, 'F1')
  assert.equal(chooseFlow(G, out, { montant: 10 })?.id, 'F2') // flux par défaut
  assert.equal(chooseFlow(G, out, {}), null)
  const H = byId(defs, 'H')
  const outH = defs.rootElements[0].flowElements.filter((f) => f.sourceRef === H)
  // Passerelle à réponses nommées : la variable porte le nom de la passerelle (comme l'export Camunda).
  assert.equal(chooseFlow(H, outH, { categorie: 'Repas' })?.id, 'F4')
  assert.equal(chooseFlow(H, outH, { autre: 'Repas' }), null)
})

const toolSet = createToolSet(z)
const run = (name, input) => runTool({ toolSet, name, input, executeTool: async () => ({ ok: true }), emit: () => {}, log: () => {} })

test('form tools are offered and check their arguments', async () => {
  for (const name of ['get_task_forms', 'set_task_form']) assert.ok(toolSet.anthropic.some((t) => t.name === name), name)
  assert.equal((await run('get_task_forms', {})).isError, false)
  assert.equal((await run('set_task_form', { elementId: 'T', ...EXPENSE })).isError, false)
  assert.equal((await run('set_task_form', { elementId: 'T', fields: [] })).isError, false)
  assert.equal((await run('set_task_form', { elementId: 'T', fields: [{ label: 'X', type: 'slider' }] })).isError, true)
  assert.equal((await run('set_task_form', { fields: [] })).isError, true)
})
