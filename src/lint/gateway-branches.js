// Branches de passerelle sans nom : une passerelle exclusive ou inclusive qui se divise pose une
// question, et chaque branche qui en sort doit dire sa réponse (« Oui », « Non », « Montant >
// 3000 »). Sans nom ni condition, le lecteur ne sait pas quel chemin suit quel cas, et la
// simulation comme le moteur n'ont rien pour choisir.
//
// Règle bpmnlint bpmnpilot/gateway-branch-names, en avertissement, signalée sur le flux sans
// nom. Dès qu'une branche porte une condition ou que la passerelle a un flux par défaut, la
// règle conditional-flows de bpmnlint prend le relais (chaque branche a une condition, sauf
// le flux par défaut) : celle-ci ne dit alors rien, pour ne pas signaler deux fois.
// Ce module ne dépend de rien : il tourne dans la page et dans les tests.

const is = (el, type) => !!el?.$instanceOf?.(type)

export const GATEWAY_BRANCH_MESSAGE = 'Branch of a decision without a name: label it with the answer or the condition it stands for'

const DECIDING = ['bpmn:ExclusiveGateway', 'bpmn:InclusiveGateway']

// Flux sortants lus sur les flux eux-mêmes : certains fichiers omettent <outgoing>.
function outgoingOf(node) {
  const flows = (node.$parent?.flowElements || []).filter((f) => is(f, 'bpmn:SequenceFlow') && f.sourceRef === node)
  return flows.length ? flows : node.outgoing || []
}

// Flux sortants d'une passerelle qui se divise et ne disent pas leur réponse.
export function unnamedBranches(gateway) {
  if (!DECIDING.some((t) => is(gateway, t))) return []
  const out = outgoingOf(gateway)
  if (out.length < 2 || gateway.default || out.some((f) => f.conditionExpression)) return []
  return out.filter((f) => !(f.name || '').trim())
}

export function gatewayBranchNamesRule() {
  return {
    check(node, reporter) {
      for (const flow of unnamedBranches(node)) reporter.report(flow.id, GATEWAY_BRANCH_MESSAGE)
    },
  }
}
