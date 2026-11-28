// Service des formulaires du diagramme ouvert : lire le formulaire d'une tâche, l'écrire ou le
// retirer (une commande de bpmn-js : Ctrl+Z l'annule), et les constats. Utilisé par
// l'interface (pastilles, panneau, fenêtre form-js, simulation) et par les outils du
// Co-pilote IA et du serveur MCP (src/mcp-bridge.js).
import { getBusinessObject, is } from 'bpmn-js/lib/util/ModelUtil'
import { canHoldForm, formOf, formProperties, formsOf, checkForm, describeForm, emptySchema, formIdFor } from './form-store.js'
import { missingFormData } from '../lint/form-data.js'

export const FORMS_CHANGED = 'bpmnPilot.forms.changed'

// Un seul service par modeleur : l'interface et les outils se le partagent.
const services = new WeakMap()
export function formServiceOf(modeler) {
  if (!services.has(modeler)) services.set(modeler, createFormService(modeler))
  return services.get(modeler)
}

function createFormService(modeler) {
  const modeling = modeler.get('modeling')
  const moddle = modeler.get('moddle')
  const eventBus = modeler.get('eventBus')
  const bpmnReplace = modeler.get('bpmnReplace')
  const elementRegistry = modeler.get('elementRegistry')
  const commandStack = modeler.get('commandStack')

  const elementOf = (elementOrId) => {
    const element = typeof elementOrId === 'string' ? elementRegistry.get(elementOrId) : elementOrId
    if (!element || element.type === 'label') throw new Error(`Element not found: ${elementOrId}`)
    return element
  }

  // Élément qui peut porter le formulaire. Une tâche simple (ou d'un autre type) devient tâche
  // utilisateur, comme le ferait le menu de remplacement.
  function holderOf(elementOrId) {
    const element = elementOf(elementOrId)
    if (canHoldForm(getBusinessObject(element))) return element
    if (is(element, 'bpmn:Task')) return bpmnReplace.replaceElement(element, { type: 'bpmn:UserTask' })
    throw new Error(`Only a user task or a start event can have a form; ${element.id} is a ${element.type.replace('bpmn:', '')}.`)
  }

  const getForm = (elementOrId) => formOf(getBusinessObject(elementOf(elementOrId)))

  // Range le schéma (null : retire le formulaire). Renvoie l'élément, remplacé s'il l'a fallu.
  function setForm(elementOrId, schema) {
    let target = null
    commandStack.execute('forms.batch', {
      run: () => {
        target = schema ? holderOf(elementOrId) : elementOf(elementOrId)
        const bo = getBusinessObject(target)
        if (!schema && !formOf(bo)) return
        modeling.updateModdleProperties(target, bo, formProperties(moddle, bo, schema ? { ...schema, id: schema.id || formIdFor(bo) } : null))
      },
    })
    return target
  }
  commandStack.register('forms.batch', {
    preExecute: (ctx) => ctx.run(),
    execute: () => [],
    revert: () => [],
  })

  const createFor = (element) => setForm(element, emptySchema(getBusinessObject(element)))

  // Empreinte des formulaires : un changement prévient les pastilles et le panneau.
  let print = ''
  const fingerprint = () => formsOf(modeler.getDefinitions()).map(({ bo, schema }) => `${bo.id}:${JSON.stringify(schema)}`).join('|')
  modeler.on(['commandStack.changed', 'import.done'], () => {
    const next = fingerprint()
    if (next !== print) {
      print = next
      eventBus.fire(FORMS_CHANGED)
    }
  })

  const list = () => formsOf(modeler.getDefinitions())

  // Passerelles et tâches de règle métier qui lisent une donnée qu'aucun formulaire n'a remplie.
  function dataFindings() {
    const out = []
    for (const element of elementRegistry.getAll()) {
      if (element.type === 'label' || !element.businessObject) continue
      if (!is(element, 'bpmn:ExclusiveGateway') && !is(element, 'bpmn:InclusiveGateway') && !is(element, 'bpmn:BusinessRuleTask')) continue
      const missing = missingFormData(element.businessObject)
      if (missing.length) {
        const label = element.businessObject.name || element.id
        out.push({
          level: 'warning', code: 'missing-data', element: element.id, variables: missing,
          text: `"${label}" reads ${missing.join(', ')}, which no form before it fills in.`,
          fr: `« ${label} » lit ${missing.join(', ')}, qu'aucun formulaire placé avant ne remplit.`,
        })
      }
    }
    return out
  }

  return {
    getForm,
    setForm,
    removeForm: (element) => setForm(element, null),
    createFor,
    list,
    describe: describeForm,
    check: checkForm,
    dataFindings,
    holderTypes: ['bpmn:UserTask', 'bpmn:StartEvent'],
  }
}
