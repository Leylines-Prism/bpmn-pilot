// Pilote automatique de la simulation de jetons : quand un jeton arrive sur une passerelle
// exclusive ou inclusive, la branche est choisie comme pour « Lancer N jetons »
// (src/simulation-stats.js) au lieu d'attendre un clic :
//   - passerelle exclusive : une branche tirée selon les probabilités des flux sortants
//     (attribut bpmnpilot:probability), ou selon la table de décision liée à la tâche de
//     règle métier qui précède (src/dmn/decision-routing.js) ;
//   - passerelle inclusive : chaque branche prise selon sa probabilité, au moins une.
// Le choix passe par la configuration du simulateur de bpmn-js-token-simulation (celle
// qu'écrivent ses propres réglages de passerelle) et colore les flux de la même façon.
// Un clic sur la passerelle change encore la branche, jusqu'au jeton suivant.
//
// L'interrupteur se place dans le cadre de la vitesse de simulation. Il est éteint par
// défaut, et le choix est retenu dans ce navigateur.
import { T } from './i18n/lang.js'
import { branchWeights, probabilityOf } from './simulation-stats.js'

const KEY = 'bpmn-editor-sim-autopilot'
const TRACE_EVENT = 'tokenSimulation.simulator.trace'
const SELECTED = '--token-simulation-active-outgoing-flow-stroke-color'
const NOT_SELECTED = '--token-simulation-inactive-outgoing-flow-stroke-color'
// Mêmes clés de couleur que les réglages de passerelle de l'extension : notre choix remplace le leur.
const COLOR_IDS = { 'bpmn:ExclusiveGateway': 'exclusive-gateway-settings', 'bpmn:InclusiveGateway': 'inclusive-gateway-settings' }

function pick(weights, random) {
  let r = random()
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]
    if (r < 0) return i
  }
  return weights.length - 1
}

// Branches à prendre (objets BPMN des flux sortants), pour une passerelle et ses flux.
// Exporté pour les tests.
export function chooseBranches(gateway, outgoing, incoming, { branchHint = null, random = Math.random } = {}) {
  if (gateway.$instanceOf('bpmn:ExclusiveGateway')) {
    const weights = (branchHint && branchHint(gateway, outgoing, incoming)) || branchWeights(outgoing)
    return [outgoing[pick(weights, random)]]
  }
  if (gateway.$instanceOf('bpmn:InclusiveGateway')) {
    const weights = branchWeights(outgoing)
    const taken = outgoing.filter((f, i) => random() < (probabilityOf(f) ?? weights[i] * 100) / 100)
    return taken.length ? taken : [outgoing[pick(weights, random)]]
  }
  return null
}

export function setupSimulationAutopilot(modeler, { branchHint = () => null } = {}) {
  const container = modeler.get('canvas').getContainer().querySelector('.bts-set-animation-speed')
  if (!container) return
  const simulator = modeler.get('simulator')
  const elementColors = modeler.get('elementColors')
  const simulationStyles = modeler.get('simulationStyles')

  let on = false
  try { on = localStorage.getItem(KEY) === '1' } catch { /* stockage indisponible */ }

  const bar = document.createElement('div')
  bar.className = 'autopilot-bar'
  bar.innerHTML = '<button type="button" class="autopilot-toggle"></button>'
  const button = bar.querySelector('button')
  button.textContent = T('Autopilot', 'Pilote auto')
  button.title = T('Gateways choose their branch by themselves, from the probabilities of their flows and the linked decision tables',
    'Les passerelles choisissent seules leur branche, selon les probabilités de leurs flux et les tables de décision liées')
  const show = () => {
    button.setAttribute('aria-pressed', String(on))
    button.classList.toggle('active', on)
  }
  show()
  button.addEventListener('click', () => {
    on = !on
    try { localStorage.setItem(KEY, on ? '1' : '0') } catch { /* le choix vaut pour cette page */ }
    show()
  })
  const heatmapBar = container.querySelector('.heatmap-bar')
  if (heatmapBar) heatmapBar.before(bar)
  else container.append(bar)

  // Le simulateur annonce chaque entrée de jeton avant de la traiter : la branche est
  // configurée avant que la passerelle ne relâche son jeton.
  modeler.on(TRACE_EVENT, ({ action, element }) => {
    if (!on || action !== 'enter' || !COLOR_IDS[element?.type]) return
    const flows = (element.outgoing || []).filter((c) => c.type === 'bpmn:SequenceFlow')
    if (flows.length < 2) return
    const incoming = (element.incoming || []).filter((c) => c.type === 'bpmn:SequenceFlow').map((c) => c.businessObject)
    const chosen = chooseBranches(element.businessObject, flows.map((f) => f.businessObject), incoming, { branchHint: branchHint() })
    if (!chosen) return
    const active = flows.filter((f) => chosen.includes(f.businessObject))
    simulator.setConfig(element, { activeOutgoing: element.type === 'bpmn:ExclusiveGateway' ? active[0] : active })
    for (const f of flows) {
      elementColors.add(f, COLOR_IDS[element.type], { stroke: simulationStyles.get(active.includes(f) ? SELECTED : NOT_SELECTED) }, 2000)
    }
  })
}
