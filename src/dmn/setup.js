// Branchement des tables de décision DMN dans l'éditeur (mode Expert, interrupteur DMN) :
// service, pastilles et panneau, fenêtre DMN, menus Ouvrir et Exporter, Mes diagrammes.

import { T } from '../i18n/lang.js'
import { createDecisionService } from './decision-service.js'
import { setupDecisionLinks } from './decision-links.js'
import { openDecisionEditor } from './decision-editor.js'
import { setupDmnSwitch, setDmn, isDmnShown } from './dmn-switch.js'
import { routingHint } from './decision-routing.js'
import { ruleTasks } from './decision-store.js'
import { decisionTableAsk } from '../ai/prompts.js'

export function setupDecisions({ modeler, library, download, baseName, setStatus, askCopilot }) {
  const service = createDecisionService(modeler)
  const elementRegistry = modeler.get('elementRegistry')
  const fileInput = document.getElementById('dmn-input')
  let libraryRef = null // dernier enregistrement des décisions du diagramme dans Mes diagrammes
  modeler.on('import.done', () => { libraryRef = null })

  const fileName = () => `${baseName()} - ${T('decisions', 'décisions')}`
  const nameOf = (element) => (element?.businessObject?.name || element?.id || '').trim()

  async function open({ decisionId, task, view } = {}) {
    const xml = service.getXml()
    if (!xml) return
    const summary = await service.getSummary()
    await openDecisionEditor({
      xml,
      decisionId,
      view: view || (decisionId ? 'table' : 'drd'),
      mode: 'diagram',
      title: summary.name || T('Decisions', 'Décisions'),
      subtitle: task ? T(`Decision called by “${nameOf(task)}”`, `Décision appelée par « ${nameOf(task)} »`) : T(`Decisions of “${baseName()}”`, `Décisions de « ${baseName()} »`),
      fileName,
      download,
      onSave: (next) => {
        service.saveXml(next)
        setStatus(T('Decisions saved in the diagram', 'Décisions rangées dans le diagramme'))
      },
      saveToLibrary: async (current) => {
        const saved = await library.saveDecisionModel({ ref: libraryRef, name: fileName(), xml: current })
        libraryRef = { place: saved.place, id: saved.id }
        return saved.message
      },
      fillWithCopilot: (decision) => fillWithCopilot(decision, task || callerOf(decision.id)),
      openExample: (shownId) => openExample(() => open({ decisionId: shownId || decisionId, task, view: 'table' })),
    })
  }

  // Tâche qui appelle une décision, quand la fenêtre a été ouverte sans tâche.
  const callerOf = (decisionId) => elementRegistry.filter((e) => e.type === 'bpmn:BusinessRuleTask').find((e) => service.decisionRefOf(e) === decisionId)

  function fillWithCopilot(decision, task) {
    const ask = decisionTableAsk({
      task: task ? { id: task.id, name: nameOf(task) } : null,
      decision: { id: decision.id, name: decision.name },
      rules: decision.rules?.length || 0,
    })
    askCopilot(T(ask.en, ask.fr))
  }

  // Exemple « Plat du jour » (src/dmn/example-dish.js), ouvert à part : rien n'est enregistré, et
  // la fermeture ramène à la table de l'utilisateur.
  async function openExample(back) {
    const { exampleDishXml, EXAMPLE_DECISION } = await import('./example-dish.js')
    await openDecisionEditor({
      xml: exampleDishXml(),
      decisionId: EXAMPLE_DECISION,
      view: 'table',
      mode: 'example',
      title: T('Dish of the day', 'Plat du jour'),
      subtitle: T('Example from the dmn-js examples: try it with Test, nothing is saved', 'Exemple tiré des exemples dmn-js : essayez-le avec Tester, rien n\'est enregistré'),
      fileName: () => T('Dish of the day - example', 'Plat du jour - exemple'),
      download,
      onClose: back,
    })
  }

  // Ajoute un document DMN au diagramme ; lie la tâche à sa première décision si on en donne une.
  async function addToDiagram(xml, task) {
    const merged = await service.importDmn(xml)
    if (task && merged.decisions.length) await service.link(elementRegistry.get(task.id) || task, merged.decisions[0])
    const renamed = Object.keys(merged.renamed).length
    return { merged, message: T(
      `${merged.decisions.length} decision(s) added to the diagram${renamed ? `, ${renamed} id(s) renamed to stay unique` : ''}.`,
      `${merged.decisions.length} décision(s) ajoutée(s) au diagramme${renamed ? `, ${renamed} id renommé(s) pour rester uniques` : ''}.`) }
  }

  let pendingTask = null
  function importFileFor(task) {
    pendingTask = task || null
    fileInput.click()
  }
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0]
    e.target.value = ''
    const task = pendingTask
    pendingTask = null
    if (file) await importDmnFile(file, task)
  })

  async function importDmnFile(file, task = null) {
    try {
      const { merged, message } = await addToDiagram(await file.text(), task)
      setDmn(true)
      setStatus(message)
      await open({ decisionId: task ? merged.decisions[0] : undefined, task, view: task ? 'table' : 'drd' })
    } catch (err) {
      alert(T('This .dmn file cannot be opened: ', 'Ce fichier .dmn ne s\'ouvre pas : ') + err.message)
    }
  }

  async function importFromLibrary(row, task) {
    const item = await library.getItem(row)
    if (!item) throw new Error(T('this decision model no longer exists', 'ce modèle de décision n\'existe plus'))
    const { merged, message } = await addToDiagram(item.xml, task)
    if (task && merged.decisions.length) await open({ decisionId: merged.decisions[0], task })
    return message
  }

  // Modèle ouvert depuis Mes diagrammes, seul.
  function openDecisionModel(item) {
    setDmn(true)
    let ref = { place: item.place, id: item.id }
    return openDecisionEditor({
      xml: item.xml,
      view: 'drd',
      mode: 'library',
      title: item.name,
      subtitle: T('Decision model in My diagrams', 'Modèle de décision de Mes diagrammes'),
      fileName: () => item.name,
      download,
      saveToLibrary: async (xml) => {
        const saved = await library.saveDecisionModel({ ref, name: item.name, xml })
        ref = { place: saved.place, id: saved.id }
        return saved.message
      },
      addToDiagram: async (xml) => (await addToDiagram(xml)).message,
    })
  }

  const links = setupDecisionLinks(modeler, {
    service,
    open,
    importFileFor,
    importFromLibrary,
    listLibraryModels: () => library.listDecisionModels(),
    labels: () => ({ inputLabel: T('Input', 'Entrée'), outputLabel: T('Output', 'Sortie') }),
    copilotReady: () => document.documentElement.classList.contains('copilot-ready'),
    askCopilot: (task) => {
      const ask = decisionTableAsk({ task: { id: task.id, name: nameOf(task) } })
      askCopilot(T(ask.en, ask.fr))
    },
    fillWithCopilot: (task, decision) => fillWithCopilot(decision, task),
    explainWithCopilot: (task, decision) => askCopilot(T(
      `Explain in plain words, in a few lines, the DMN decision table ${decision.id} ("${decision.name || decision.id}") called by the task ${task.id} ("${nameOf(task)}"). ` +
        'Then check it with test_decision: one case per rule, then two or three edge cases (limits of ranges, values no rule covers). ' +
        'Report the gaps, overlaps and surprising results, and propose corrections, but do not change the table unless I ask.',
      `Explique en langage courant, en quelques lignes, la table de décision DMN ${decision.id} (« ${decision.name || decision.id} ») appelée par la tâche ${task.id} (« ${nameOf(task)} »). ` +
        'Vérifie-la ensuite avec test_decision : un cas par règle, puis deux ou trois cas limites (bornes des intervalles, valeurs qu\'aucune règle ne couvre). ' +
        'Signale les trous, les chevauchements et les résultats surprenants, et propose des corrections, sans modifier la table sauf si je le demande.')),
    showPanelGroup: () => {
      const toggle = document.getElementById('btn-properties')
      if (toggle?.getAttribute('aria-expanded') === 'false') toggle.click()
    },
  })

  setupDmnSwitch()
  document.getElementById('btn-open-dmn').addEventListener('click', () => importFileFor(null))
  document.getElementById('btn-save-dmn').addEventListener('click', () => {
    const xml = service.getXml()
    if (!xml) {
      alert(T('This diagram has no decision yet: create one from a business rule task.', 'Ce diagramme n\'a pas encore de décision : créez-en une depuis une tâche de règle métier.'))
      return
    }
    download(xml, `${fileName()}.dmn`, 'application/xml')
  })
  document.getElementById('btn-dmn-drd').addEventListener('click', () => {
    if (!service.getXml()) {
      alert(T('This diagram has no decision yet: create one from a business rule task.', 'Ce diagramme n\'a pas encore de décision : créez-en une depuis une tâche de règle métier.'))
      return
    }
    open({ view: 'drd' })
  })

  // Pour le rapport de processus : décisions, tâches qui les appellent, constats. null sans décision
  // ni tâche de règle métier.
  async function report() {
    const summary = await service.getSummary()
    const findings = await service.check()
    const calls = {}
    for (const el of elementRegistry.filter((e) => e.type === 'bpmn:BusinessRuleTask')) {
      const ref = service.decisionRefOf(el)
      if (ref) (calls[ref] ||= []).push({ id: el.id, name: nameOf(el) })
    }
    if (!summary.decisions.length && !findings.length) return null
    return { summary, findings, calls }
  }

  // Simulation : poids des passerelles qui suivent une tâche liée à une table (interrupteur DMN allumé).
  function routing() {
    if (!isDmnShown()) return null
    const summary = service.cachedSummary()
    if (!summary) return null
    const links = new Map(ruleTasks(modeler.getDefinitions()).map(({ bo, decisionRef }) => [bo, decisionRef]))
    const variable = (bo) => (bo.extensionElements?.values || []).find((v) => v.$instanceOf?.('zeebe:CalledDecision'))?.resultVariable || ''
    return routingHint(summary, (bo) => links.get(bo) || '', variable)
  }

  return { service, open, openDecisionModel, openExample, importDmnFile, report, links, routing }
}
