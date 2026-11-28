// Prompts MCP (src/ai/prompts.js) : noms, arguments et texte produit.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as z from 'zod'
import { EXPERT_ASKS, buildPrompts } from '../src/ai/prompts.js'

const prompts = buildPrompts(z)
const byName = Object.fromEntries(prompts.map((p) => [p.name, p]))

test('the thirteen prompts are there, with unique names', () => {
  assert.equal(prompts.length, 13)
  assert.deepEqual(Object.keys(byName).sort(), [
    'add_agent_step', 'analyze_process', 'assess_compliance', 'critique_description', 'fill_decision_table', 'model_collaboration', 'model_from_event_log',
    'model_process', 'propose_probabilities', 'rate_ai_potential', 'review_diagram', 'tidy_diagram', 'write_user_stories',
  ])
  for (const p of prompts) assert.ok(p.title && p.description, p.name)
})

test('model_process requires a description and puts it in the text', () => {
  const args = z.object(byName.model_process.argsSchema)
  assert.equal(args.safeParse({}).success, false)
  assert.equal(args.safeParse({ description: '' }).success, false)
  const text = byName.model_process.text({ description: 'Approve a holiday request' })
  assert.match(text, /Approve a holiday request/)
  assert.match(text, /validate_diagram/)
})

test('model_collaboration lists the participants only when given', () => {
  const p = byName.model_collaboration
  assert.equal(z.object(p.argsSchema).safeParse({ description: 'Order' }).success, true)
  assert.doesNotMatch(p.text({ description: 'Order' }), /Participants:/)
  assert.match(p.text({ description: 'Order', participants: 'Customer, Shop' }), /Participants: Customer, Shop/)
})

test('review_diagram asks not to change anything', () => {
  assert.match(byName.review_diagram.text(), /Do not change anything/)
})

test('critique_description requires a description and asks before drawing', () => {
  const p = byName.critique_description
  assert.equal(z.object(p.argsSchema).safeParse({}).success, false)
  const text = p.text({ description: 'Handle a refund' })
  assert.match(text, /Handle a refund/)
  assert.match(text, /Do not draw anything yet/)
  assert.match(text, /blocking/)
})

test('add_agent_step asks for the agent mark, a review and an exit', () => {
  const p = byName.add_agent_step
  assert.equal(z.object(p.argsSchema).safeParse({}).success, false)
  const text = p.text({ goal: 'Qualify the request', tools: 'CRM search, Credit score' })
  assert.match(text, /Qualify the request/)
  assert.match(text, /Tools: CRM search, Credit score/)
  assert.match(text, /agent: true/)
  assert.match(text, /UserTask/)
  assert.match(text, /boundary event/)
  assert.doesNotMatch(p.text({ goal: 'X' }), /Tools:/)
})

test('the Expert menu prompts send the same request as the co-pilot commands', () => {
  for (const [name, key] of [['propose_probabilities', 'probabilities'], ['rate_ai_potential', 'aiPotential'], ['analyze_process', 'analysis']]) {
    const text = byName[name].text()
    assert.ok(text.startsWith(EXPERT_ASKS[key].en), name)
    assert.match(text, /get_shapes/, name)
    assert.ok(EXPERT_ASKS[key].fr && EXPERT_ASKS[key].fr !== EXPERT_ASKS[key].en, name)
  }
  assert.match(byName.rate_ai_potential.text(), /aiPotentialReason/)
  assert.match(byName.analyze_process.text(), /set_report_commentary/)
})

test('assess_compliance names the frameworks only when given, and keeps what is written', () => {
  const p = byName.assess_compliance
  assert.equal(z.object(p.argsSchema).safeParse({}).success, true)
  assert.doesNotMatch(p.text({}), /Frameworks:/)
  const text = p.text({ framework: 'GDPR, ISO 9001' })
  assert.match(text, /Frameworks: GDPR, ISO 9001/)
  assert.match(text, /risks/)
  assert.match(text, /controls/)
  assert.match(text, /requirements/)
  assert.match(text, /keeping what is already written/)
})

test('model_from_event_log goes from the log summary to the conformance check', () => {
  const text = byName.model_from_event_log.text()
  for (const tool of ['load_event_log', 'get_log_summary', 'layout_diagram', 'map_log_activities', 'check_conformance', 'apply_log_frequencies']) assert.match(text, new RegExp(tool))
})

test('fill_decision_table names the task when given, and asks for set_decision_table and test_decision', () => {
  const p = byName.fill_decision_table
  assert.equal(z.object(p.argsSchema).safeParse({}).success, true)
  assert.match(p.text({ task: 'Classify the change' }), /"Classify the change"/)
  assert.match(p.text({}), /no decision, or whose decision table has no rule/)
  for (const t of [p.text({}), p.text({ task: 'X' })]) {
    assert.match(t, /set_decision_table/)
    assert.match(t, /test_decision/)
  }
})

test('decisionTableAsk adapts to an empty table and to a table with rules, in both languages', async () => {
  const { decisionTableAsk } = await import('../src/ai/prompts.js')
  const task = { id: 'Task_1', name: 'Classer le change' }
  const decision = { id: 'Decision_1', name: 'Classer le change' }
  const empty = decisionTableAsk({ task, decision, rules: 0 })
  assert.match(empty.en, /decisionId Decision_1 and linkTo Task_1/)
  assert.match(empty.fr, /decisionId Decision_1 et linkTo Task_1/)
  assert.match(empty.fr, /aucune règle/)
  const some = decisionTableAsk({ task, decision, rules: 3 })
  assert.match(some.en, /already has 3 rule/)
  assert.match(some.fr, /garde-les/)
})
