// Formulaires pendant la simulation de jetons (mode Expert, module Formulaires).
//
// Quand un jeton arrive sur une tâche utilisateur qui a un formulaire, il s'y arrête et le
// formulaire s'ouvre à droite du canevas. Envoyer range les réponses dans les données de la
// simulation, puis le jeton repart ; Passer le fait repartir sans rien saisir. Un événement de
// début qui a un formulaire met la simulation en pause le temps de le remplir.
// Les réponses choisissent ensuite la branche des passerelles exclusives (src/forms/form-routing.js),
// comme si l'on cliquait sur la passerelle. Sans réponse utile, la passerelle garde le choix
// habituel de la simulation. Les données repartent de zéro à chaque réinitialisation.

import { getBusinessObject, is } from 'bpmn-js/lib/util/ModelUtil'
import { T } from '../i18n/lang.js'
import { formOf } from './form-store.js'
import { chooseFlow } from './form-routing.js'
import { loadFormJs } from './form-editor.js'

const TRACE_EVENT = 'tokenSimulation.simulator.trace'
const TOGGLE_MODE_EVENT = 'tokenSimulation.toggleMode'
const RESET_EVENT = 'tokenSimulation.resetSimulation'
const COLORS_ID = 'exclusive-gateway-settings'

export function setupFormSimulation(modeler, { isShown }) {
  const eventBus = modeler.get('eventBus')
  const elementRegistry = modeler.get('elementRegistry')
  let simulator = null
  let services = null
  try {
    simulator = modeler.get('simulator')
    services = { elementColors: modeler.get('elementColors'), simulationStyles: modeler.get('simulationStyles'), pause: modeler.get('pauseSimulation') }
  } catch {
    return { data: () => ({}) } // simulation absente de ce modeleur
  }

  let active = false
  let data = {}
  let waiting = [] // éléments où la simulation s'arrête
  const queue = []
  let dialog = null
  let viewer = null
  let showing = null

  const withForm = () => elementRegistry.filter((e) => e.type !== 'label' && (is(e, 'bpmn:UserTask') || is(e, 'bpmn:StartEvent')) && formOf(getBusinessObject(e)))

  function arm() {
    disarm()
    if (!isShown()) return
    waiting = withForm().filter((e) => is(e, 'bpmn:UserTask'))
    for (const e of waiting) simulator.waitAtElement(e, true)
  }
  function disarm() {
    for (const e of waiting) simulator.waitAtElement(e, false)
    waiting = []
  }

  // Branches des passerelles exclusives d'après les réponses.
  function route() {
    for (const gateway of elementRegistry.filter((e) => is(e, 'bpmn:ExclusiveGateway'))) {
      const outgoing = gateway.outgoing.filter((c) => is(c, 'bpmn:SequenceFlow'))
      if (outgoing.length < 2) continue
      const flow = chooseFlow(getBusinessObject(gateway), outgoing.map(getBusinessObject), data)
      if (!flow) continue
      const shape = outgoing.find((c) => getBusinessObject(c) === flow)
      simulator.setConfig(gateway, { activeOutgoing: shape })
      for (const c of outgoing) {
        const style = c === shape ? '--token-simulation-active-outgoing-flow-stroke-color' : '--token-simulation-inactive-outgoing-flow-stroke-color'
        services.elementColors.add(c, COLORS_ID, { stroke: services.simulationStyles.get(style) }, 2000)
      }
    }
  }

  function build() {
    dialog = document.createElement('dialog')
    dialog.id = 'form-sim-dialog'
    dialog.innerHTML = `
      <div class="fm-head">
        <div class="fm-title"><small id="fm-sim-subtitle"></small><h2 id="fm-sim-name"></h2></div>
      </div>
      <div class="fm-sim-body" id="fm-sim-body"></div>
      <p class="fm-sim-note">${T('Your answers pick the branches of the next gateways. They are kept until the simulation is reset.', 'Vos réponses choisissent les branches des passerelles suivantes. Elles restent jusqu\'à la réinitialisation de la simulation.')}</p>
      <div class="fm-sim-actions">
        <button type="button" class="btn" id="fm-sim-skip">${T('Skip', 'Passer')}</button>
        <button type="button" class="btn primary" id="fm-sim-send">${T('Submit and continue', 'Envoyer et continuer')}</button>
      </div>`
    document.body.append(dialog)
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); finish(null) })
    dialog.querySelector('#fm-sim-skip').addEventListener('click', () => finish(null))
    dialog.querySelector('#fm-sim-send').addEventListener('click', () => viewer?.submit())
  }

  async function next() {
    if (showing || !queue.length) return
    showing = queue.shift()
    const { element } = showing
    const bo = getBusinessObject(element)
    const schema = formOf(bo)
    if (!schema || !active) { showing = null; continueToken(); return next() }
    if (!dialog) build()
    dialog.querySelector('#fm-sim-name').textContent = bo.name || element.id
    dialog.querySelector('#fm-sim-subtitle').textContent = T('Token simulation: form', 'Simulation de jetons : formulaire')
    const host = dialog.querySelector('#fm-sim-body')
    host.replaceChildren()
    if (!dialog.open) dialog.show()
    try {
      const { Form, additionalModules } = await loadFormJs()
      viewer?.destroy()
      viewer = new Form({ container: host, additionalModules })
      viewer.on('submit', ({ data: answers, errors }) => {
        if (Object.keys(errors || {}).length) return
        finish(answers)
      })
      await viewer.importSchema(schema, data)
      host.querySelector('input, select, textarea')?.focus()
    } catch (err) {
      host.textContent = T(`This form cannot be shown: ${err.message}`, `Ce formulaire ne s'affiche pas : ${err.message}`)
    }
  }

  function continueToken() {
    const item = showing
    if (!item) return
    if (item.kind === 'start') {
      services.pause.unpause?.()
      return
    }
    // Le jeton qui attend sur la tâche : celui du passage montré s'il se reconnaît, sinon le plus ancien.
    const waitingTokens = simulator.findSubscriptions({ element: item.element }).filter((s) => s.event?.type === 'continue')
    const subscription = waitingTokens.find((s) => s.scope === item.scope || s.scope?.parent === item.scope) || waitingTokens[0]
    if (subscription) simulator.trigger({ event: subscription.event, scope: subscription.scope })
  }

  function finish(answers) {
    if (answers) {
      data = { ...data, ...answers }
      route()
    }
    continueToken()
    showing = null
    viewer?.destroy()
    viewer = null
    if (dialog?.open && !queue.length) dialog.close()
    next()
  }

  function clear() {
    data = {}
    queue.length = 0
    showing = null
    viewer?.destroy()
    viewer = null
    if (dialog?.open) dialog.close()
  }

  eventBus.on(TOGGLE_MODE_EVENT, ({ active: on }) => {
    active = on
    clear()
    if (on) arm()
    else disarm()
  })
  eventBus.on(RESET_EVENT, () => {
    clear()
    if (active) arm()
  })
  eventBus.on(TRACE_EVENT, ({ action, element, scope }) => {
    if (!active || !element || !isShown()) return
    // Une tâche trace « enter » ; un événement de début ne trace que « signal » puis « exit ».
    if (action === 'enter' && waiting.includes(element)) {
      queue.push({ kind: 'task', element, scope })
      next()
    } else if (action === 'signal' && is(element, 'bpmn:StartEvent') && formOf(getBusinessObject(element))) {
      // Le jeton part déjà : on met la simulation en pause juste après, le temps du formulaire.
      setTimeout(() => services.pause.pause?.(), 0)
      queue.push({ kind: 'start', element, scope })
      next()
    }
  })

  return { data: () => ({ ...data }) }
}
