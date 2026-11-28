// Simulation de jetons guidée par les formulaires (module Formulaires).
//
// Quand un jeton arrive sur une passerelle exclusive, les données saisies dans les
// formulaires pendant la simulation choisissent la branche : le premier flux dont la
// condition est vraie, sinon le flux par défaut. Une condition se lit comme à l'export
// Camunda 8 (src/export-camunda.js) :
//   - écrite pour le moteur en FEEL (« =montant > 3000 ») ;
//   - écrite en clair dans le champ Condition ou le libellé (« Montant > 3000 ») ;
//   - sinon le nom du flux est la valeur attendue de la variable qui porte le nom de la
//     passerelle (« Catégorie » → categorie = "Repas"). Oui et Non valent aussi vrai et faux.
// Quand une donnée manque, la passerelle garde son comportement habituel (null).
// Ce module ne dépend que de feelin et de modules sans dépendance.

import { evaluate } from 'feelin'
import { translateCondition, conditionFor, variableName } from '../export-camunda.js'
import { expressionVariables } from '../lint/form-data.js'

const HAS_OPERATOR = /<=|>=|≤|≥|!=|≠|<>|==|=|<|>/
const YES = /^(oui|yes|vrai|true|ok)$/i
const NO = /^(non|no|faux|false)$/i

// Expression FEEL (sans le « = » de tête) de la condition d'un flux, ou null.
export function flowExpression(gateway, flow) {
  const body = (flow.conditionExpression?.body || '').trim()
  if (/^\s*=/.test(body)) return body.replace(/^\s*=/, '')
  if (/[$#]\{/.test(body)) return null // JUEL (Camunda 7) : pas lu ici
  const rule = body || (flow.name || '').trim()
  if (!rule) return null
  if (HAS_OPERATOR.test(rule)) return translateCondition(8, rule)?.replace(/^=/, '') ?? null
  if (body) return null
  return conditionFor(8, variableName(gateway.name), rule).replace(/^=/, '')
}

function test(gateway, flow, data) {
  const expression = flowExpression(gateway, flow)
  if (!expression) return undefined
  const vars = expressionVariables(expression)
  if (!vars.length || vars.some((v) => data[v] === undefined || data[v] === null || data[v] === '')) return undefined
  // Réponse nommée Oui ou Non sur une case à cocher.
  if (!flow.conditionExpression?.body && !HAS_OPERATOR.test(flow.name || '') && vars.length === 1 && typeof data[vars[0]] === 'boolean') {
    if (YES.test(flow.name.trim())) return data[vars[0]] === true
    if (NO.test(flow.name.trim())) return data[vars[0]] === false
  }
  try {
    const { value } = evaluate(expression, data)
    return value === true
  } catch {
    return undefined
  }
}

// Flux que prend le jeton d'après les données, ou null (comportement habituel).
export function chooseFlow(gateway, outgoing, data) {
  if (!gateway?.$instanceOf?.('bpmn:ExclusiveGateway') || !data) return null
  let evaluated = false
  for (const flow of outgoing) {
    if (flow === gateway.default) continue
    const result = test(gateway, flow, data)
    if (result === undefined) continue
    evaluated = true
    if (result) return flow
  }
  if (evaluated && gateway.default && outgoing.includes(gateway.default)) return gateway.default
  return null
}
