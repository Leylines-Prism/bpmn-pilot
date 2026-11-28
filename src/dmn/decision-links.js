// Liens tâche → décision sur le canevas et dans le panneau (mode Expert, interrupteur DMN).
//
//   - Pastille « Table » en bas à gauche de chaque tâche de règle métier : pleine si la tâche
//     est liée à une décision (un clic ouvre la table), en pointillé sinon (un clic choisit
//     la tâche et ouvre le groupe Décision du panneau).
//   - Groupe « Table de décision (DMN) » du panneau de propriétés : décision liée, résumé de la table et
//     constats, Ouvrir la table, Délier ; sans lien : créer, lier, importer, reprendre de Mes
//     diagrammes, ou demander au Co-pilote.
// Rien en mode Présentation (sauf la pastille d'une tâche liée, qui ouvre la table) ni hors
// du mode Expert (leylines.css).

import htm from 'htm'
import { h } from '@bpmn-io/properties-panel/preact'
import { useEffect, useState } from '@bpmn-io/properties-panel/preact/hooks'
import { useService } from 'bpmn-js-properties-panel'
import { getBusinessObject, is } from 'bpmn-js/lib/util/ModelUtil'
import { T } from '../i18n/lang.js'
import { DECISIONS_CHANGED } from './decision-service.js'
import { checkDecision } from './dmn-model.js'
import { checkTexts, describeTable } from './decision-texts.js'

const html = htm.bind(h)
const TYPE = 'dmn-badge'
export const DECISION_GROUP = 'bpmn-pilot-decision'
const TABLE_ICON = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="1" y="1.5" width="10" height="9" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M1 4.5h10M4.5 4.5v6" stroke="currentColor" stroke-width="1.3"/></svg>'

// Branché par setupDecisionLinks : service, ouverture de la fenêtre, import, Mes diagrammes, Co-pilote.
let actions = null

function useSummary() {
  const eventBus = useService('eventBus')
  const [summary, setSummary] = useState(null)
  useEffect(() => {
    let alive = true
    // Un écouteur de l'eventBus ne doit rien renvoyer : une valeur arrêterait la diffusion.
    const load = () => { actions?.service.getSummary().then((s) => alive && setSummary(s)) }
    load()
    eventBus.on(DECISIONS_CHANGED, load)
    return () => { alive = false; eventBus.off(DECISIONS_CHANGED, load) }
  }, [eventBus])
  return summary
}

// Bouton du Co-pilote : grisé sans modèle d'IA, avec une ligne qui dit pourquoi.
function aiButton(busy, onClick, label) {
  const ready = actions.copilotReady()
  return html`<button type="button" class="dmn-button ai" disabled=${busy || !ready} onClick=${onClick}
      title=${ready ? '' : T('Connect an AI model to the co-pilot to use this function', 'Connectez un modèle d\'IA au Co-pilote pour utiliser cette fonction')}>${label}</button>
    ${ready ? null : html`<p class="dmn-message">${T('Needs an AI model: Co-pilot > Options.', 'Demande un modèle d\'IA : Co-pilote IA > Options.')}</p>`}`
}

function DecisionEntry({ element, id }) {
  const summary = useSummary()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [libraryModels, setLibraryModels] = useState([])
  const bo = getBusinessObject(element)
  const ref = bo.get('bpmnpilot:decisionRef') || ''
  useEffect(() => { actions?.listLibraryModels?.().then(setLibraryModels).catch(() => setLibraryModels([])) }, [element])
  if (!actions || !summary) return html`<div class="bio-properties-panel-entry dmn-entry" data-entry-id=${id}>…</div>`
  const decisions = summary.decisions
  const decision = decisions.find((d) => d.id === ref)
  const run = async (fn) => {
    setBusy(true)
    setMessage('')
    try {
      const msg = await fn()
      if (msg) setMessage(msg)
    } catch (err) {
      setMessage(T('Failed: ', 'Échec : ') + err.message)
    } finally {
      setBusy(false)
    }
  }
  const options = html`
    <option value="">${T('No decision', 'Aucune décision')}</option>
    ${decisions.map((d) => html`<option value=${d.id} selected=${d.id === ref}>${d.name || d.id} (${d.id})</option>`)}
    ${ref && !decision ? html`<option value=${ref} selected>${T('Missing: ', 'Introuvable : ')}${ref}</option>` : null}`
  const select = html`<select id=${id + '-select'} class="dmn-select" disabled=${busy}
      onChange=${(e) => run(() => actions.service.link(element, e.target.value))}>${options}</select>`

  if (ref) {
    const findings = decision ? checkTexts(checkDecision(decision)) : [{ level: 'error', text: T(`Decision ${ref} is not in this diagram. Choose another one, or unlink.`, `La décision ${ref} n'est pas dans ce diagramme. Choisissez-en une autre, ou déliez.`) }]
    return html`<div class="bio-properties-panel-entry dmn-entry" data-entry-id=${id}>
      <label class="bio-properties-panel-label" for=${id + '-select'}>${T('Linked decision', 'Décision liée')}</label>
      ${select}
      ${decision ? html`<p class="dmn-summary">${describeTable(decision)}</p>` : null}
      ${findings.length ? html`<ul class="dmn-findings">${findings.map((f) => html`<li class=${'dmn-' + f.level}>${f.text}</li>`)}</ul>` : null}
      <div class="dmn-actions">
        ${decision ? html`<button type="button" class="dmn-button primary" disabled=${busy} onClick=${() => actions.open({ decisionId: ref, task: element })}>
          <span class="dmn-ico" dangerouslySetInnerHTML=${{ __html: TABLE_ICON }}></span>${T('Open the table', 'Ouvrir la table')}</button>` : null}
        <button type="button" class="dmn-button" disabled=${busy} onClick=${() => run(() => actions.service.unlink(element))}>${T('Unlink', 'Délier')}</button>
      </div>
      ${decision && decision.kind === 'table' && !decision.rules.length
        ? aiButton(busy, () => actions.fillWithCopilot(element, decision), T('✦ Fill in with the co-pilot', '✦ Remplir avec le Co-pilote'))
        : decision ? aiButton(busy, () => actions.explainWithCopilot(element, decision), T('✦ Explain and test with the co-pilot', '✦ Expliquer et tester avec le Co-pilote')) : null}
      ${message ? html`<p class="dmn-message">${message}</p>` : null}
    </div>`
  }

  return html`<div class="bio-properties-panel-entry dmn-entry" data-entry-id=${id}>
    <p class="dmn-empty">${T('No decision linked to this task.', 'Aucune décision liée à cette tâche.')}</p>
    <div class="dmn-actions column">
      <button type="button" class="dmn-button primary" disabled=${busy}
        onClick=${() => run(async () => { const { decisionId, task } = await actions.service.createFor(element, actions.labels()); actions.open({ decisionId, task }) })}>
        ${T('+ Create a decision table', '+ Créer une table de décision')}</button>
      ${decisions.length ? html`
        <label class="bio-properties-panel-label" for=${id + '-select'}>${T('Link a decision of this diagram', 'Lier une décision de ce diagramme')}</label>
        ${select}` : null}
      <button type="button" class="dmn-button" disabled=${busy} onClick=${() => actions.importFileFor(element)}>${T('Import a .dmn file…', 'Importer un fichier .dmn…')}</button>
      ${libraryModels.length ? html`
        <label class="bio-properties-panel-label" for=${id + '-library'}>${T('Take from My diagrams', 'Reprendre de Mes diagrammes')}</label>
        <select id=${id + '-library'} class="dmn-select" disabled=${busy}
          onChange=${(e) => { const row = libraryModels.find((r) => r.key === e.target.value); e.target.value = ''; if (row) run(() => actions.importFromLibrary(row, element)) }}>
          <option value="">${T('Choose a decision model…', 'Choisir un modèle de décision…')}</option>
          ${libraryModels.map((r) => html`<option value=${r.key}>${r.name}</option>`)}
        </select>` : null}
      ${aiButton(busy, () => actions.askCopilot(element), T('✦ Draft it with the co-pilot', '✦ Rédiger avec le Co-pilote'))}
    </div>
    ${message ? html`<p class="dmn-message">${message}</p>` : null}
  </div>`
}

function DecisionPropertiesProvider(propertiesPanel) {
  propertiesPanel.registerProvider(400, this)
}
DecisionPropertiesProvider.$inject = ['propertiesPanel']
DecisionPropertiesProvider.prototype.getGroups = function (element) {
  return (groups) => {
    if (!is(element, 'bpmn:BusinessRuleTask')) return groups
    const group = {
      id: DECISION_GROUP,
      label: T('Decision table (DMN)', 'Table de décision (DMN)'),
      shouldOpen: true,
      entries: [{ id: 'bpmn-pilot-decision-link', component: DecisionEntry, isEdited: () => !!getBusinessObject(element).get('bpmnpilot:decisionRef') }],
    }
    const general = groups.findIndex((g) => g.id === 'general')
    groups.splice(general + 1, 0, group)
    return groups
  }
}

export const DecisionPanelModule = {
  __init__: ['decisionPropertiesProvider'],
  decisionPropertiesProvider: ['type', DecisionPropertiesProvider],
}

// ── Pastilles du canevas ──

export function setupDecisionLinks(modeler, wiring) {
  actions = wiring
  const overlays = modeler.get('overlays')
  const eventBus = modeler.get('eventBus')
  const elementRegistry = modeler.get('elementRegistry')
  const selection = modeler.get('selection')
  let names = new Map()

  function badgeFor(element) {
    const ref = getBusinessObject(element).get('bpmnpilot:decisionRef') || ''
    const name = names.get(ref)
    const button = document.createElement('button')
    button.type = 'button'
    button.className = ref ? (name !== undefined ? 'dmn-badge' : 'dmn-badge broken') : 'dmn-badge empty'
    button.innerHTML = ref ? `${TABLE_ICON}<span>${T('Table', 'Table')}</span>` : `<span>+ ${T('Table', 'Table')}</span>`
    const label = (getBusinessObject(element).name || element.id).trim()
    button.title = ref
      ? name !== undefined
        ? T(`Open the decision table “${name || ref}”`, `Ouvrir la table de décision « ${name || ref} »`)
        : T(`Decision ${ref} is missing from this diagram`, `La décision ${ref} manque dans ce diagramme`)
      : T(`Create or link a decision for “${label}”`, `Créer ou lier une décision pour « ${label} »`)
    button.setAttribute('aria-label', button.title)
    for (const type of ['mousedown', 'pointerdown', 'dblclick']) button.addEventListener(type, (e) => e.stopPropagation())
    button.addEventListener('click', (e) => {
      e.stopPropagation()
      if (ref && name !== undefined) actions.open({ decisionId: ref, task: element })
      else {
        selection.select(element)
        actions.showPanelGroup()
      }
    })
    return button
  }

  function refresh(element) {
    overlays.remove({ element, type: TYPE })
    if (!element || !is(element, 'bpmn:BusinessRuleTask') || element.type === 'label' || !elementRegistry.get(element.id)) return
    overlays.add(element, TYPE, { position: { bottom: -11, left: 8 }, html: badgeFor(element) })
  }

  async function refreshAll() {
    const summary = await actions.service.getSummary()
    names = new Map(summary.decisions.map((d) => [d.id, d.name]))
    overlays.remove({ type: TYPE })
    for (const element of elementRegistry.getAll()) refresh(element)
  }

  // refreshAll est asynchrone : l'écouteur ne renvoie pas sa promesse, qui arrêterait la diffusion.
  eventBus.on(['import.done', DECISIONS_CHANGED], () => { refreshAll() })
  eventBus.on('elements.changed', ({ elements }) => { for (const element of elements) refresh(element) })
  return { refreshAll }
}
