// Formulaires sur le canevas et dans le panneau (mode Expert, module Formulaires).
//
//   - Pastille « Formulaire » en bas à gauche de chaque tâche utilisateur (et au-dessus d'un
//     événement de début qui en a un) : pleine si l'élément a un formulaire (un clic l'ouvre),
//     en pointillé sinon (un clic choisit la tâche et ouvre le groupe Formulaire du panneau).
//   - Groupe « Formulaire » du panneau de propriétés : champs et variables remplies, constats,
//     Modifier, Exporter .form, Retirer ; sans formulaire : créer, importer un .form, ou
//     demander au Co-pilote.

import htm from 'htm'
import { h } from '@bpmn-io/properties-panel/preact'
import { useEffect, useState } from '@bpmn-io/properties-panel/preact/hooks'
import { useService } from 'bpmn-js-properties-panel'
import { getBusinessObject, is } from 'bpmn-js/lib/util/ModelUtil'
import { T, lang } from '../i18n/lang.js'
import { FORMS_CHANGED } from './form-service.js'
import { canHoldForm, formOf, formFields, formVariables, checkForm } from './form-store.js'

const html = htm.bind(h)
const TYPE = 'form-badge'
export const FORM_GROUP = 'bpmn-pilot-form'
export const FORM_ICON = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="1.5" y="1" width="9" height="10" rx="1.2" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M3.5 3.6h3M3.5 6h5M3.5 8.4h2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>'

// Branché par setupForms : service, ouverture de la fenêtre, import, Co-pilote.
let actions = null

const text = (f) => (lang === 'fr' ? f.fr || f.text : f.text)

function useFormsVersion() {
  const eventBus = useService('eventBus')
  const [version, setVersion] = useState(0)
  useEffect(() => {
    // Un écouteur de l'eventBus ne doit rien renvoyer : une valeur arrêterait la diffusion.
    const bump = () => { setVersion((v) => v + 1) }
    eventBus.on([FORMS_CHANGED, 'elements.changed'], bump)
    return () => eventBus.off([FORMS_CHANGED, 'elements.changed'], bump)
  }, [eventBus])
  return version
}

function FormEntry({ element, id }) {
  useFormsVersion()
  const [message, setMessage] = useState('')
  if (!actions) return html`<div class="bio-properties-panel-entry form-entry" data-entry-id=${id}>…</div>`
  const bo = getBusinessObject(element)
  const schema = formOf(bo)
  const run = async (fn) => {
    setMessage('')
    try {
      const msg = await fn()
      if (msg) setMessage(msg)
    } catch (err) {
      setMessage(T('Failed: ', 'Échec : ') + err.message)
    }
  }
  const copilot = actions.copilotReady()
  if (schema) {
    const fields = formFields(schema)
    const findings = checkForm(schema)
    return html`<div class="bio-properties-panel-entry form-entry" data-entry-id=${id}>
      <p class="form-summary">${fields.length
        ? T(`${fields.length} field(s). Fills in: `, `${fields.length} champ(s). Remplit : `) + (formVariables(schema).join(', ') || '…')
        : T('No input field yet.', 'Aucun champ de saisie pour l\'instant.')}</p>
      ${fields.length ? html`<ul class="form-fields">${fields.slice(0, 12).map((f) => html`<li>${f.label || f.key} <code>${f.path}</code>${f.required ? ' *' : ''}</li>`)}${fields.length > 12 ? html`<li>…</li>` : null}</ul>` : null}
      ${findings.length ? html`<ul class="form-findings">${findings.map((f) => html`<li class=${'form-' + f.level}>${text(f)}</li>`)}</ul>` : null}
      <div class="dmn-actions">
        <button type="button" class="dmn-button primary" onClick=${() => actions.open(element)}>
          <span class="dmn-ico" dangerouslySetInnerHTML=${{ __html: FORM_ICON }}></span>${T('Edit the form', 'Modifier le formulaire')}</button>
        <button type="button" class="dmn-button" onClick=${() => actions.exportForm(element)}>${T('Export .form', 'Exporter .form')}</button>
        <button type="button" class="dmn-button" onClick=${() => run(() => { actions.service.removeForm(element); return T('Form removed. Ctrl+Z brings it back.', 'Formulaire retiré. Ctrl+Z le rétablit.') })}>${T('Remove', 'Retirer')}</button>
      </div>
      ${copilot ? html`<button type="button" class="dmn-button ai" onClick=${() => actions.reviewWithCopilot(element)}>
        ${T('✦ Review with the co-pilot', '✦ Relire avec le Co-pilote')}</button>` : null}
      ${message ? html`<p class="form-message">${message}</p>` : null}
    </div>`
  }
  return html`<div class="bio-properties-panel-entry form-entry" data-entry-id=${id}>
    <p class="form-empty">${is(element, 'bpmn:StartEvent')
      ? T('No form at the start of the process.', 'Aucun formulaire au début du processus.')
      : T('No form on this task.', 'Aucun formulaire sur cette tâche.')}</p>
    <div class="dmn-actions column">
      <button type="button" class="dmn-button primary" onClick=${() => run(() => { const target = actions.service.createFor(element); actions.open(target) })}>
        ${T('+ Create a form', '+ Créer un formulaire')}</button>
      <button type="button" class="dmn-button" onClick=${() => actions.importFileFor(element)}>${T('Import a .form file…', 'Importer un fichier .form…')}</button>
      ${copilot ? html`<button type="button" class="dmn-button ai" onClick=${() => actions.askCopilot(element)}>
        ${T('✦ Draft it with the co-pilot', '✦ Rédiger avec le Co-pilote')}</button>` : null}
    </div>
    ${message ? html`<p class="form-message">${message}</p>` : null}
  </div>`
}

function FormPropertiesProvider(propertiesPanel) {
  propertiesPanel.registerProvider(400, this)
}
FormPropertiesProvider.$inject = ['propertiesPanel']
FormPropertiesProvider.prototype.getGroups = function (element) {
  return (groups) => {
    if (!canHoldForm(getBusinessObject(element))) return groups
    const group = {
      id: FORM_GROUP,
      label: T('Form', 'Formulaire'),
      shouldOpen: true,
      entries: [{ id: 'bpmn-pilot-form-entry', component: FormEntry, isEdited: () => !!formOf(getBusinessObject(element)) }],
    }
    const general = groups.findIndex((g) => g.id === 'general')
    groups.splice(general + 1, 0, group)
    return groups
  }
}

export const FormPanelModule = {
  __init__: ['formPropertiesProvider'],
  formPropertiesProvider: ['type', FormPropertiesProvider],
}

// ── Pastilles du canevas ──

export function setupFormLinks(modeler, wiring) {
  actions = wiring
  const overlays = modeler.get('overlays')
  const eventBus = modeler.get('eventBus')
  const elementRegistry = modeler.get('elementRegistry')
  const selection = modeler.get('selection')

  function badgeFor(element) {
    const bo = getBusinessObject(element)
    const schema = formOf(bo)
    const label = (bo.name || element.id).trim()
    const button = document.createElement('button')
    button.type = 'button'
    button.className = schema ? 'form-badge' : 'form-badge empty'
    button.innerHTML = schema ? FORM_ICON : ''
    const span = document.createElement('span')
    span.textContent = schema ? T('Form', 'Formulaire') : `+ ${T('Form', 'Formulaire')}`
    button.append(span)
    button.title = schema
      ? T(`Open the form of “${label}” (${formFields(schema).length} field(s))`, `Ouvrir le formulaire de « ${label} » (${formFields(schema).length} champ(s))`)
      : T(`Create a form for “${label}”`, `Créer un formulaire pour « ${label} »`)
    button.setAttribute('aria-label', button.title)
    for (const type of ['mousedown', 'pointerdown', 'dblclick']) button.addEventListener(type, (e) => e.stopPropagation())
    button.addEventListener('click', (e) => {
      e.stopPropagation()
      if (schema) actions.open(element)
      else {
        selection.select(element)
        actions.showPanelGroup()
      }
    })
    return button
  }

  function refresh(element) {
    overlays.remove({ element, type: TYPE })
    if (!element || element.type === 'label' || !elementRegistry.get(element.id)) return
    const bo = getBusinessObject(element)
    if (!canHoldForm(bo)) return
    const start = is(element, 'bpmn:StartEvent')
    // Un événement de début sans formulaire n'a pas de pastille : ce serait trop chargé.
    if (start && !formOf(bo)) return
    overlays.add(element, TYPE, { position: start ? { top: -24, left: -22 } : { bottom: -11, left: 8 }, html: badgeFor(element) })
  }

  function refreshAll() {
    overlays.remove({ type: TYPE })
    for (const element of elementRegistry.getAll()) refresh(element)
  }

  eventBus.on(['import.done', FORMS_CHANGED], () => { refreshAll() })
  eventBus.on('elements.changed', ({ elements }) => { for (const element of elements) refresh(element) })
  return { refreshAll }
}
