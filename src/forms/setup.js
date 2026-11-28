// Branchement des formulaires des tâches dans l'éditeur (mode Expert, module Formulaires) :
// service, pastilles et panneau, fenêtre form-js, import d'un .form, export, simulation.

import { getBusinessObject } from 'bpmn-js/lib/util/ModelUtil'
import { T } from '../i18n/lang.js'
import { isExpert } from '../expert-mode.js'
import { isModuleOn, setModule } from '../expert-modules.js'
import { zip } from '../zip-write.js'
import { formServiceOf } from './form-service.js'
import { setupFormLinks } from './form-links.js'
import { openFormEditor } from './form-editor.js'
import { setupFormSimulation } from './form-simulation.js'
import { formOf } from './form-store.js'

export const isFormsShown = () => isModuleOn('forms') && isExpert()

export function setupForms({ modeler, download, baseName, setStatus, askCopilot }) {
  const service = formServiceOf(modeler)
  const elementRegistry = modeler.get('elementRegistry')
  const nameOf = (element) => (getBusinessObject(element)?.name || element?.id || '').trim()
  const fileName = (element) => `${baseName()} - ${nameOf(element) || T('form', 'formulaire')}`

  function open(element) {
    const live = elementRegistry.get(element.id) || element
    const schema = service.getForm(live)
    if (!schema) return
    openFormEditor({
      schema,
      title: nameOf(live) || T('Form', 'Formulaire'),
      subtitle: T(`Form of “${nameOf(live)}”`, `Formulaire de « ${nameOf(live)} »`),
      fileName: () => fileName(live),
      download,
      onSave: (next) => {
        service.setForm(elementRegistry.get(live.id) || live, next)
        setStatus(T('Form saved in the diagram', 'Formulaire rangé dans le diagramme'))
      },
    })
  }

  const exportForm = (element) => {
    const schema = service.getForm(element)
    if (schema) download(JSON.stringify(schema, null, 2), `${fileName(element)}.form`, 'application/json')
  }

  // Import d'un fichier .form sur une tâche.
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.form,.json'
  input.hidden = true
  document.body.append(input)
  let pending = null
  input.addEventListener('change', async (e) => {
    const file = e.target.files[0]
    e.target.value = ''
    const element = pending
    pending = null
    if (!file || !element) return
    try {
      const schema = JSON.parse(await file.text())
      if (!schema || typeof schema !== 'object' || !Array.isArray(schema.components)) throw new Error(T('it is not a form-js form (no components list)', 'ce n\'est pas un formulaire form-js (pas de liste de composants)'))
      const target = service.setForm(element, schema)
      setStatus(T('Form imported', 'Formulaire importé'))
      open(target)
    } catch (err) {
      alert(T('This .form file cannot be opened: ', 'Ce fichier .form ne s\'ouvre pas : ') + err.message)
    }
  })

  setupFormLinks(modeler, {
    service,
    open,
    exportForm,
    importFileFor: (element) => { pending = element; input.click() },
    copilotReady: () => !document.getElementById('btn-ai-probabilities')?.disabled,
    askCopilot: (element) => askCopilot(T(
      `Write the form of ${element.id} ("${nameOf(element)}"), from its label, its documentation, its user stories and the rest of the process. ` +
        'First read get_task_forms and the gateway conditions and decision tables that come after it. Use set_task_form: one field per piece of data the person enters, ' +
        'in business words, with the key of the variable the process reads later, the right type, the allowed values of choices, and required where it must be filled in. ' +
        'Then sum up the form in a few lines and say what I must confirm.',
      `Rédige le formulaire de ${element.id} (« ${nameOf(element)} »), d'après son libellé, sa documentation, ses récits utilisateur et le reste du processus. ` +
        'Lis d\'abord get_task_forms, ainsi que les conditions des passerelles et les tables de décision qui suivent. Utilise set_task_form : un champ par donnée que la personne saisit, ' +
        'en termes métier, avec la clé de la variable que le processus lit ensuite, le bon type, les valeurs prévues des choix, et obligatoire là où il faut une réponse. ' +
        'Résume ensuite le formulaire en quelques lignes et dis ce que je dois confirmer.')),
    reviewWithCopilot: (element) => askCopilot(T(
      `Review the form of ${element.id} ("${nameOf(element)}") with get_task_forms: is any data the process reads later missing, are the types, choices and required fields right, ` +
        'is a field useless? Report what you would change, but do not change the form unless I ask.',
      `Relis le formulaire de ${element.id} (« ${nameOf(element)} ») avec get_task_forms : manque-t-il une donnée que le processus lit plus loin, les types, les choix et les champs obligatoires sont-ils justes, ` +
        'un champ est-il inutile ? Dis ce que tu changerais, sans modifier le formulaire sauf si je le demande.')),
    showPanelGroup: () => {
      const toggle = document.getElementById('btn-properties')
      if (toggle?.getAttribute('aria-expanded') === 'false') toggle.click()
    },
  })

  setupFormSimulation(modeler, { isShown: isFormsShown })

  // Export : un .form seul, ou une archive .zip quand il y en a plusieurs.
  async function exportFile() {
    const forms = service.list()
    if (!forms.length) return null
    if (forms.length === 1) {
      const { bo, schema } = forms[0]
      return { content: JSON.stringify(schema, null, 2), name: `${baseName()} - ${bo.name || bo.id}`, ext: 'form', type: 'application/json' }
    }
    const used = new Set()
    const files = forms.map(({ bo, schema }) => {
      let name = `${(bo.name || bo.id).replace(/[\\/:*?"<>|]+/g, ' ').trim() || bo.id}.form`
      if (used.has(name)) name = `${bo.id}.form`
      used.add(name)
      return { name, data: new TextEncoder().encode(JSON.stringify(schema, null, 2)) }
    })
    const bytes = await zip(files)
    return { content: new Blob([bytes], { type: 'application/zip' }), name: `${baseName()} - ${T('forms', 'formulaires')}`, ext: 'zip', type: 'application/zip' }
  }

  return { service, open, exportFile, show: (on) => setModule('forms', on), hasForm: (element) => !!formOf(getBusinessObject(element)) }
}
