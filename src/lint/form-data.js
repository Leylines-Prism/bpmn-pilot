// Contrôle des données (module Formulaires) : une passerelle, ou une table de décision appelée
// par une tâche de règle métier, lit une donnée du processus qu'aucun formulaire placé avant
// elle ne remplit. Exemple : la branche « Montant > 3000 » lit montant, mais aucune tâche
// en amont ne le demande.
//
// Données lues :
//   - par une passerelle exclusive ou inclusive : les variables de ses conditions, écrites
//     pour le moteur (FEEL « =montant > 3000 », JUEL « ${montant > 3000} ») ou en clair dans
//     le champ Condition ou le libellé du flux (« Montant > 3000 »). Un flux nommé d'une seule
//     réponse (« Oui ») ne compte pas : il ne dit pas quelle donnée il lit ;
//   - par une tâche de règle métier liée : les expressions d'entrée de sa table DMN.
// Données remplies avant : les champs des formulaires des éléments en amont (chemins remontés
// le long des flux, sous-processus et événements de bordure compris), la variable résultat
// d'une décision (zeebe:calledDecision) et les sorties d'un mappage Camunda (zeebe:output).
//
// La règle ne dit rien tant que le diagramme n'a aucun formulaire : sans formulaire, toutes
// les données viennent d'ailleurs, et l'avertissement n'aurait pas de sens.
// Ce module ne dépend que de modules sans dépendance : il tourne dans la page et dans les tests.

import { formsOf, formOf, formVariables, canHoldForm } from '../forms/form-store.js'
import { translateCondition } from '../export-camunda.js'
import { readDecisionXml } from '../dmn/decision-store.js'

const is = (el, type) => !!el?.$instanceOf?.(type)

export const FORM_DATA_MESSAGE = 'Reads process data that no form before it fills in: '

const FEEL_WORDS = new Set([
  'and', 'or', 'not', 'true', 'false', 'null', 'in', 'between', 'instance', 'of', 'if', 'then', 'else', 'for', 'return',
  'some', 'every', 'satisfies', 'function', 'date', 'time', 'duration', 'now', 'today', 'string', 'number', 'count',
  'sum', 'min', 'max', 'mean', 'all', 'any', 'contains', 'matches', 'upper', 'lower', 'case', 'substring', 'length',
  'abs', 'floor', 'ceiling', 'decimal', 'is', 'defined', 'list', 'context', 'get', 'value', 'years', 'months', 'days',
  'eq', 'ne', 'lt', 'gt', 'le', 'ge', 'empty', 'size',
])

// Variables (premier segment des chemins) d'une expression FEEL ou JUEL.
export function expressionVariables(text) {
  const bare = String(text ?? '')
    .replace(/"(?:[^"\\]|\\.)*"/g, ' ')
    .replace(/'(?:[^'\\]|\\.)*'/g, ' ')
    .replace(/^\s*=/, '')
    .replace(/[$#]\{|\}/g, ' ')
  const out = new Set()
  for (const m of bare.matchAll(/(?<![\w.])([A-Za-z_][\w]*)(?:\.[A-Za-z_][\w]*)*(\s*\()?/g)) {
    if (m[2]) continue // appel de fonction
    if (!FEEL_WORDS.has(m[1])) out.add(m[1])
  }
  return [...out]
}

const HAS_OPERATOR = /<=|>=|≤|≥|!=|≠|<>|==|=|<|>/

// Variables lues par les conditions des flux sortants d'une passerelle.
export function gatewayVariables(gateway) {
  if (!is(gateway, 'bpmn:ExclusiveGateway') && !is(gateway, 'bpmn:InclusiveGateway')) return []
  const out = new Set()
  for (const flow of outgoingOf(gateway)) {
    if (flow === gateway.default) continue
    const body = (flow.conditionExpression?.body || '').trim()
    let expression = null
    if (/^\s*=/.test(body) || /[$#]\{/.test(body)) expression = body
    else {
      const rule = body || (flow.name || '').trim()
      if (rule && HAS_OPERATOR.test(rule)) expression = translateCondition(8, rule)
    }
    if (expression) for (const v of expressionVariables(expression)) out.add(v)
  }
  return [...out]
}

const decode = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

// Expressions d'entrée de chaque décision d'un document DMN : Map id → [variables].
export function decisionInputs(dmnXml) {
  const out = new Map()
  for (const d of String(dmnXml || '').matchAll(/<(?:[\w-]+:)?decision\b[^>]*?\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?decision>/g)) {
    const vars = new Set()
    for (const e of d[2].matchAll(/<(?:[\w-]+:)?inputExpression\b[\s\S]*?<(?:[\w-]+:)?text>([\s\S]*?)<\/(?:[\w-]+:)?text>/g)) {
      for (const v of expressionVariables(decode(e[1]))) vars.add(v)
    }
    out.set(d[1], [...vars])
  }
  return out
}

const extensions = (bo) => bo?.extensionElements?.values || []
const decisionRefOf = (bo) => (bo.get ? bo.get('bpmnpilot:decisionRef') : '') || extensions(bo).find((v) => is(v, 'zeebe:CalledDecision'))?.decisionId || ''

// Flux lus sur le conteneur : certains fichiers omettent <incoming> et <outgoing>.
function flowsOf(node) {
  return (node.$parent?.flowElements || []).filter((f) => is(f, 'bpmn:SequenceFlow'))
}
function outgoingOf(node) {
  const flows = flowsOf(node).filter((f) => f.sourceRef === node)
  return flows.length ? flows : node.outgoing || []
}
function incomingOf(node) {
  const flows = flowsOf(node).filter((f) => f.targetRef === node)
  return flows.length ? flows : node.incoming || []
}

// Données remplies par un élément quand il se termine.
function producedBy(node) {
  const out = []
  if (canHoldForm(node)) {
    const schema = formOf(node)
    if (schema) out.push(...formVariables(schema))
  }
  for (const v of extensions(node)) {
    if (is(v, 'zeebe:CalledDecision') && v.resultVariable) out.push(v.resultVariable)
    if (is(v, 'zeebe:IoMapping')) for (const o of v.outputParameters || []) if (o.target) out.push(o.target)
  }
  // Un sous-processus terminé a rempli ce que remplissent ses formulaires.
  if (node.flowElements) {
    const inner = { rootElements: [{ $instanceOf: (t) => t === 'bpmn:Process', flowElements: node.flowElements }] }
    for (const { schema } of formsOf(inner)) out.push(...formVariables(schema))
  }
  return out
}

// Toutes les données remplies avant `node`, sur n'importe quel chemin qui y mène.
export function producedBefore(node) {
  const out = new Set()
  const seen = new Set([node])
  const queue = [node]
  while (queue.length) {
    const current = queue.shift()
    const sources = incomingOf(current).map((f) => f.sourceRef).filter(Boolean)
    if (is(current, 'bpmn:BoundaryEvent') && current.attachedToRef) sources.push(current.attachedToRef)
    // Début d'un sous-processus : on continue avant le sous-processus.
    if (!sources.length && is(current.$parent, 'bpmn:SubProcess')) sources.push(current.$parent)
    for (const s of sources) {
      if (seen.has(s)) continue
      seen.add(s)
      if (s !== node.$parent) for (const v of producedBy(s)) out.add(v)
      queue.push(s)
    }
  }
  return out
}

function definitionsOf(node) {
  let el = node
  while (el?.$parent) el = el.$parent
  return el
}

// Données lues par le nœud qu'aucun formulaire en amont ne remplit, ou [] (aussi sans formulaire).
export function missingFormData(node) {
  const definitions = definitionsOf(node)
  if (!definitions) return []
  let read = []
  if (is(node, 'bpmn:ExclusiveGateway') || is(node, 'bpmn:InclusiveGateway')) read = gatewayVariables(node)
  else if (is(node, 'bpmn:BusinessRuleTask')) read = decisionInputs(readDecisionXml(definitions)).get(decisionRefOf(node)) || []
  // Le modèle change à chaque retouche : rien n'est gardé d'un passage à l'autre.
  if (!read.length || !formsOf(definitions).length) return []
  const produced = producedBefore(node)
  return read.filter((v) => !produced.has(v))
}

// Règle bpmnlint (même forme que les règles de bpmnlint).
export function formDataRule() {
  return {
    check(node, reporter) {
      const missing = missingFormData(node)
      if (missing.length) reporter.report(node.id, FORM_DATA_MESSAGE + missing.join(', '))
    },
  }
}
