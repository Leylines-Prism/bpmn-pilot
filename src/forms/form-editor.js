// Fenêtre d'édition du formulaire d'une tâche (mode Expert, module Formulaires).
//
// form-js n'est chargé qu'à la première ouverture (import dynamique) : l'éditeur BPMN ne paie
// rien au démarrage. Deux onglets : Modifier (l'éditeur form-js, par glisser-déposer) et
// Aperçu (le formulaire tel que le verra la personne, avec les données qu'il enverrait).
// À la fermeture, les changements sont rangés dans le .bpmn en une seule commande (Ctrl+Z).
// Le filigrane bpmn.io de form-js reste visible, comme le veut sa licence.

import { lang, T } from '../i18n/lang.js'
import frBpmn from '../i18n/fr.js'
import { EXPORTER } from './form-store.js'

let loading = null

// Charge form-js une fois : { FormEditor, Form, additionalModules }.
export function loadFormJs() {
  loading ||= Promise.all([
    import('@bpmn-io/form-js-editor'),
    import('@bpmn-io/form-js-viewer'),
    import('./form-js-fr.js'),
    import('@bpmn-io/form-js-viewer/dist/assets/form-js.css'),
    import('@bpmn-io/form-js-viewer/dist/assets/flatpickr/light.css'),
    import('@bpmn-io/form-js-editor/dist/assets/form-js-editor.css'),
    import('@bpmn-io/form-js-editor/dist/assets/dragula.css'),
  ]).then(([{ FormEditor }, { Form }, { default: frForm }]) => {
    const translate = (template, replacements = {}) =>
      (lang === 'fr' ? frForm[template] ?? frBpmn[template] ?? template : template).replace(/{([^}]+)}/g, (_, k) => (k in replacements ? replacements[k] : `{${k}}`))
    return { FormEditor, Form, additionalModules: [{ translate: ['value', translate] }] }
  })
  loading.catch(() => { loading = null })
  return loading
}

let dialog = null
let current = null // { editor, viewer, baseline, onSave, download, fileName }

function build() {
  dialog = document.createElement('dialog')
  dialog.id = 'form-dialog'
  dialog.innerHTML = `
    <div class="fm-head">
      <button type="button" class="btn" id="fm-back" data-icon="undo"></button>
      <div class="fm-title"><small id="fm-subtitle"></small><h2 id="fm-name"></h2></div>
      <div class="fm-tabs" role="tablist">
        <button type="button" role="tab" data-view="edit">${T('Edit', 'Modifier')}</button>
        <button type="button" role="tab" data-view="preview">${T('Preview', 'Aperçu')}</button>
      </div>
      <span class="fm-grow"></span>
      <button type="button" class="btn" id="fm-export" data-icon="save" title="${T('This form as a .form file, for Camunda Modeler or a form-js application', 'Ce formulaire en fichier .form, pour Camunda Modeler ou une application form-js')}">${T('Export .form', 'Exporter .form')}</button>
      <button type="button" class="btn icon-only fm-close" aria-label="${T('Close', 'Fermer')}" title="${T('Close (Esc)', 'Fermer (Échap)')}">×</button>
    </div>
    <p class="fm-status" id="fm-status" role="status" hidden></p>
    <div class="fm-main">
      <div class="fm-body" id="fm-edit"></div>
      <div class="fm-preview" id="fm-preview" hidden>
        <div class="fm-preview-col">
          <div class="fm-preview-form" id="fm-preview-form"></div>
          <div class="fm-preview-actions">
            <button type="button" class="btn" id="fm-preview-reset">${T('Reset', 'Réinitialiser')}</button>
            <button type="button" class="btn primary" id="fm-preview-submit">${T('Submit', 'Envoyer')}</button>
          </div>
        </div>
        <aside class="fm-preview-data">
          <h3>${T('Data sent', 'Données envoyées')}</h3>
          <p class="hint">${T('Fill in the form and click Submit: here are the process variables it would fill in.', 'Remplissez le formulaire et cliquez sur Envoyer : voici les variables du processus qu\'il remplirait.')}</p>
          <pre id="fm-preview-out">{}</pre>
        </aside>
      </div>
    </div>`
  document.body.append(dialog)
  dialog.querySelector('.fm-close').addEventListener('click', () => close())
  dialog.querySelector('#fm-back').addEventListener('click', () => close())
  dialog.addEventListener('cancel', (e) => {
    e.preventDefault()
    // Échap pendant une saisie ferme d'abord la saisie, pas la fenêtre.
    if (dialog.querySelector('.fm-main').contains(document.activeElement) && document.activeElement.matches('input, select, textarea, [contenteditable]')) {
      document.activeElement.blur()
      return
    }
    close()
  })
  for (const tab of dialog.querySelectorAll('.fm-tabs [data-view]')) tab.addEventListener('click', () => showView(tab.dataset.view))
  dialog.querySelector('#fm-preview-submit').addEventListener('click', () => current?.viewer?.submit())
  dialog.querySelector('#fm-preview-reset').addEventListener('click', () => {
    current?.viewer?.reset()
    dialog.querySelector('#fm-preview-out').textContent = '{}'
  })
  dialog.querySelector('#fm-export').addEventListener('click', () => {
    if (!current) return
    current.download(JSON.stringify(currentSchema(), null, 2), `${current.fileName()}.form`, 'application/json')
  })
}

const currentSchema = () => ({ ...current.editor.saveSchema(), exporter: EXPORTER })

function say(text, error = false) {
  const status = dialog.querySelector('#fm-status')
  status.textContent = text
  status.hidden = !text
  status.classList.toggle('error', !!error)
}

async function showView(view) {
  for (const tab of dialog.querySelectorAll('.fm-tabs [data-view]')) {
    tab.classList.toggle('on', tab.dataset.view === view)
    tab.setAttribute('aria-selected', String(tab.dataset.view === view))
  }
  dialog.querySelector('#fm-edit').hidden = view !== 'edit'
  dialog.querySelector('#fm-preview').hidden = view !== 'preview'
  if (view !== 'preview' || !current) return
  const { Form, additionalModules } = await loadFormJs()
  current.viewer?.destroy()
  const host = dialog.querySelector('#fm-preview-form')
  host.replaceChildren()
  const out = dialog.querySelector('#fm-preview-out')
  out.textContent = '{}'
  current.viewer = new Form({ container: host, additionalModules })
  current.viewer.on('submit', ({ data, errors }) => {
    out.textContent = Object.keys(errors || {}).length ? T('The form has errors: see the fields in red.', 'Le formulaire a des erreurs : voyez les champs en rouge.') : JSON.stringify(data, null, 2)
  })
  try {
    await current.viewer.importSchema(currentSchema(), current.sampleData || {})
  } catch (err) {
    say(T(`The preview cannot show this form: ${err.message}`, `L'aperçu ne peut pas afficher ce formulaire : ${err.message}`), true)
  }
}

// options : { schema, title, subtitle, fileName(), download(content, name, type), onSave(schema) }
export async function openFormEditor(options) {
  if (!dialog) build()
  if (current) close({ save: true })
  dialog.querySelector('#fm-name').textContent = options.title
  dialog.querySelector('#fm-subtitle').textContent = options.subtitle || ''
  dialog.querySelector('#fm-back').textContent = T('Back to the diagram', 'Retour au diagramme')
  say(T('Loading the form editor…', 'Chargement de l\'éditeur de formulaires…'))
  if (!dialog.open) dialog.showModal()
  let lib
  try {
    lib = await loadFormJs()
  } catch (err) {
    say(T(`The form editor cannot load: ${err.message}`, `L'éditeur de formulaires ne se charge pas : ${err.message}`), true)
    return
  }
  const host = dialog.querySelector('#fm-edit')
  host.replaceChildren()
  const editor = new lib.FormEditor({ container: host, additionalModules: lib.additionalModules, exporter: EXPORTER })
  current = { ...options, editor, viewer: null, baseline: '' }
  try {
    await editor.importSchema(options.schema)
    current.baseline = JSON.stringify(editor.saveSchema())
    say('')
  } catch (err) {
    say(T(`This form cannot be opened: ${err.message}`, `Ce formulaire ne s'ouvre pas : ${err.message}`), true)
  }
  showView('edit')
}

export function close({ save = true } = {}) {
  if (!current) {
    dialog?.close()
    return
  }
  const { editor, viewer, baseline, onSave } = current
  if (save) {
    try {
      const schema = editor.saveSchema()
      if (JSON.stringify(schema) !== baseline) onSave?.({ ...schema, exporter: EXPORTER })
    } catch (err) {
      console.warn('Form not saved:', err)
    }
  }
  viewer?.destroy()
  editor.destroy()
  current = null
  if (dialog.open) dialog.close()
}
