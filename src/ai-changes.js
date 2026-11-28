// Marquage, sur le canevas, de ce que l'IA vient de changer.
//
// Le chat intégré et le serveur MCP passent par les mêmes outils (createTools,
// dans mcp-bridge.js). Chaque outil qui écrit est enveloppé : on relève une
// empreinte de chaque élément avant et après l'appel, sans la position, et on
// garde l'état d'avant de tout élément touché. Les retouches à la main ne sont
// donc jamais marquées, et la mise en page automatique non plus.
//
// Après chaque Ctrl+Z ou Ctrl+Y, les marques sont recalculées : un ajout
// annulé disparaît, un élément revenu à son état d'avant n'est plus marqué.
//
// Quand l'IA change beaucoup d'un coup (diagramme dessiné de zéro, par
// exemple), aucun contour n'est posé : seule la pilule résume, et un clic
// dessus montre les contours à la demande.
//
// La pilule ouvre aussi la vue Avant / après (src/compare.js), à partir du diagramme
// gardé au début du tour, et annule d'un clic tout ce que l'IA a fait depuis.
//
// Rien de tout cela n'est enregistré : ni dans le .bpmn, ni dans le navigateur.

import { getBusinessObject, is } from 'bpmn-js/lib/util/ModelUtil'
import { T, num } from './i18n/lang.js'
import { getHistory, isHistoryReload } from './history.js'
import { fontOf, textColorOf } from './label-style.js'
import { track } from './analytics.js'

// Outils qui modifient le diagramme.
const WRITE_TOOLS = ['add_shapes', 'connect_shapes', 'update_elements', 'style_elements', 'remove_elements', 'set_diagram_xml', 'layout_diagram', 'auto_layout', 'move_elements', 'duplicate_elements', 'undo', 'redo', 'link_decision', 'set_decision_table', 'set_task_form', 'apply_log_frequencies', 'set_report_commentary']

// Au-delà, mode discret : plus de 15 formes changées, ou plus de la moitié
// des formes du diagramme (à partir de 6), ou un diagramme sans forme avant l'IA.
const QUIET_MAX_SHAPES = 15
const QUIET_RATIO = 0.5
const QUIET_RATIO_MIN = 6

const MARKER_ADDED = 'ai-added'
const MARKER_CHANGED = 'ai-changed'
const OVERLAY_TYPE = 'ai-change'

let current = null

// Nouveau tour : le chat l'appelle à chaque message envoyé.
export function newAiRound() {
  current?.reset()
}

// Revient au diagramme d'avant le tour en cours (bouton « Relancer » du chat).
// Renvoie 'undone', 'none' (rien à annuler) ou 'cancelled' (refusé par l'utilisateur).
export async function undoAiRound() {
  if (!current) return 'none'
  const result = await current.undoRound()
  if (result === null) return 'none'
  return result ? 'undone' : 'cancelled'
}

// Enveloppe les outils d'écriture. Un seul suivi par éditeur.
export function trackAiChanges(modeler, tools) {
  if (!current || current.modeler !== modeler) current = createTracker(modeler)
  const tracker = current
  const wrapped = { ...tools }
  for (const name of WRITE_TOOLS) {
    const tool = tools[name]
    if (tool) wrapped[name] = (args) => tracker.run(name, () => tool(args))
  }
  return wrapped
}

function createTracker(modeler) {
  const canvas = modeler.get('canvas')
  const elementRegistry = modeler.get('elementRegistry')
  const overlays = modeler.get('overlays')
  const eventBus = modeler.get('eventBus')
  const commandStack = modeler.get('commandStack')

  // Début du tour : le diagramme d'alors, la position dans l'historique, et si le
  // diagramme a été rechargé depuis (mise en page, remplacement, Ranger).
  let start = null
  // Retouches à la main depuis le début du tour : Annuler les emporte aussi.
  let handEdits = false

  // id → état d'avant l'IA : { sig, name, type, shape }, ou null si l'élément n'existait pas.
  let baseline = new Map()
  // Formes présentes au début du tour, pour juger de l'ampleur du changement.
  let shapesAtStart = null
  let showOutlines = false
  let inTool = 0
  let marked = []

  const pill = createPill()
  canvas.getContainer().appendChild(pill.root)
  pill.button.addEventListener('click', () => {
    if (!pill.quiet) return
    showOutlines = !showOutlines
    render()
  })
  pill.close.addEventListener('click', () => reset())
  pill.compare.addEventListener('click', () => openBeforeAfter())
  pill.undo.addEventListener('click', () => undoRound())

  async function openBeforeAfter() {
    if (!start) return
    track('comparer', { source: 'ia' })
    const { openCompare } = await import('./compare.js')
    const { xml } = await modeler.saveXML({ format: true })
    await openCompare({
      before: { xml: start.xml, title: T('Before the AI', "Avant l'IA") },
      after: { xml, title: T('Now', 'Maintenant') },
      actions: [{
        id: 'undo',
        label: T("Undo the AI's changes", "Annuler les changements de l'IA"),
        title: T('Back to the diagram before the AI. Redo (Ctrl+Y) brings the changes back.', "Revient au diagramme d'avant l'IA. Rétablir (Ctrl+Y) ramène les changements."),
        run: () => undoRound(),
      }],
    })
  }

  // Revient au diagramme du début du tour. Si l'historique de bpmn-js le permet, on le
  // remonte (Ctrl+Y rétablit pas à pas). Sinon on recharge la copie du début du tour.
  async function undoRound() {
    if (!start) return null
    if (handEdits && !confirm(T(
      "Undo the AI's changes? Your own changes made since then will be undone too.",
      "Annuler les changements de l'IA ? Vos retouches faites depuis seront annulées aussi.",
    ))) return false
    if (!start.reloaded) {
      while (commandStack._stackIdx > start.stackIdx && commandStack.canUndo()) commandStack.undo()
      return true
    }
    const history = getHistory()
    if (history?.modeler === modeler) await history.restore(start.xml, start.copies)
    return true
  }

  const isTracked = (el) => el.type !== 'label' && el !== canvas.getRootElement() && el.businessObject && !el.labelTarget

  function signature(el) {
    const bo = getBusinessObject(el)
    return JSON.stringify([
      el.type,
      bo.name || '',
      bo.eventDefinitions?.[0]?.$type || '',
      bo.cancelActivity === false,
      el.host?.id || '',
      el.waypoints ? el.source?.id || '' : el.parent?.id || '',
      el.waypoints ? el.target?.id || '' : '',
      // Couleurs et police : un changement de style compte comme une modification.
      el.di?.get?.('color:background-color') || '',
      el.di?.get?.('color:border-color') || '',
      textColorOf(el) || '',
      JSON.stringify(fontOf(el) || {}),
    ])
  }

  function snapshot() {
    const map = new Map()
    elementRegistry.forEach((el) => {
      if (isTracked(el)) map.set(el.id, { sig: signature(el), name: getBusinessObject(el).name || '', type: el.type, shape: !el.waypoints })
    })
    return map
  }

  const countShapes = () => elementRegistry.filter((el) => isTracked(el) && !el.waypoints).length

  async function run(name, call) {
    if (shapesAtStart === null) shapesAtStart = countShapes()
    if (!start) {
      const { xml } = await modeler.saveXML({ format: true })
      start = { xml, stackIdx: commandStack._stackIdx, copies: getHistory()?.copies() ?? 0, reloaded: false }
      handEdits = false
    }
    const before = snapshot()
    inTool++
    let result
    try {
      result = await call()
    } finally {
      inTool--
      const after = snapshot()
      for (const id of new Set([...before.keys(), ...after.keys()])) {
        const a = before.get(id)
        const b = after.get(id)
        if (a && b && a.sig === b.sig) continue
        if (!baseline.has(id)) baseline.set(id, a || null)
      }
      // Changement de type : bpmn-js peut donner un nouvel id. C'est une modification, pas un ajout plus une suppression.
      if (name === 'update_elements' && result?.updated) {
        for (const u of result.updated) {
          if (u.previousId === u.id || !baseline.has(u.id) || baseline.get(u.id) !== null) continue
          const old = baseline.get(u.previousId)
          if (old) {
            baseline.set(u.id, { ...old, sig: old.sig + '#replaced' })
            baseline.delete(u.previousId)
          }
        }
      }
      render()
    }
    return result
  }

  function compute() {
    const added = []
    const changed = []
    const removed = []
    for (const [id, old] of baseline) {
      const el = elementRegistry.get(id)
      const now = el && isTracked(el) ? el : null
      if (!old) {
        if (now) added.push(now)
      } else if (!now) {
        removed.push(old)
      } else if (signature(now) !== old.sig) {
        changed.push(now)
      }
    }
    return { added, changed, removed }
  }

  function clearMarks() {
    for (const el of marked) {
      canvas.removeMarker(el, MARKER_ADDED)
      canvas.removeMarker(el, MARKER_CHANGED)
    }
    marked = []
    overlays.remove({ type: OVERLAY_TYPE })
  }

  // Contour : un cadre HTML posé en overlay autour de la forme (bpmn-js ne dessine
  // le contour SVG d'un élément qu'à sa sélection). Les liaisons gardent le marker CSS seul.
  function mark(el, marker) {
    canvas.addMarker(el, marker)
    marked.push(el)
    if (el.waypoints) return
    const pad = 5
    const frame = document.createElement('div')
    frame.className = `ai-change-frame ${marker}`
    if (is(el, 'bpmn:Event')) frame.classList.add('round')
    frame.style.width = `${el.width + pad * 2}px`
    frame.style.height = `${el.height + pad * 2}px`
    const dot = document.createElement('span')
    dot.className = 'ai-change-dot'
    frame.append(dot)
    overlays.add(el, OVERLAY_TYPE, { position: { top: -pad, left: -pad }, html: frame })
  }

  function render() {
    clearMarks()
    const { added, changed, removed } = compute()
    const total = added.length + changed.length + removed.length
    if (!total) {
      pill.root.hidden = true
      return
    }
    const shapesTouched = [...added, ...changed].filter((el) => !el.waypoints).length
    const quiet =
      shapesAtStart === 0 ||
      shapesTouched > QUIET_MAX_SHAPES ||
      (shapesTouched >= QUIET_RATIO_MIN && shapesTouched > QUIET_RATIO * countShapes())
    if (!quiet || showOutlines) {
      for (const el of added) mark(el, MARKER_ADDED)
      for (const el of changed) mark(el, MARKER_CHANGED)
    }
    const rec = (el) => ({ shape: !el.waypoints })
    pill.update({ added: added.map(rec), changed: changed.map(rec), removed, quiet, drawn: shapesAtStart === 0, showing: !quiet || showOutlines, canCompare: !!start })
    pill.root.hidden = false
  }

  function reset() {
    clearMarks()
    baseline = new Map()
    shapesAtStart = null
    showOutlines = false
    start = null
    handEdits = false
    pill.root.hidden = true
  }

  // Ctrl+Z, Ctrl+Y et retouches à la main : on recalcule.
  eventBus.on('commandStack.changed', ({ trigger }) => {
    if (!inTool && trigger === 'execute' && start) handEdits = true
    if (!inTool && baseline.size) render()
  })
  // Un import hors outil (nouveau diagramme, fichier ouvert) termine le tour.
  // Pendant un outil (layout_diagram, set_diagram_xml), les marques sont reposées après l'appel.
  // Annuler ou Rétablir qui recharge une copie (src/history.js) : on recalcule aussi.
  eventBus.on('import.done', () => {
    if (inTool || isHistoryReload()) {
      if (start) start.reloaded = true
      marked = []
      if (!inTool && baseline.size) render()
      return
    }
    reset()
  })

  return { modeler, run, reset, undoRound }
}

// ── Pilule de résumé, en haut du canevas ───────────────────────────────────

function createPill() {
  const root = document.createElement('div')
  root.className = 'ai-changes-pill'
  root.hidden = true
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'ai-changes-summary'
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'ai-changes-close'
  close.textContent = '×'
  close.title = T('Clear the marking', 'Effacer le marquage')
  close.setAttribute('aria-label', close.title)
  const compare = document.createElement('button')
  compare.type = 'button'
  compare.className = 'ai-changes-action'
  compare.textContent = T('Before / after', 'Avant / après')
  compare.title = T('Compare with the diagram before the AI', "Comparer avec le diagramme d'avant l'IA")
  const undo = document.createElement('button')
  undo.type = 'button'
  undo.className = 'ai-changes-action'
  undo.textContent = T('Undo', 'Annuler')
  undo.title = T("Undo all the AI's changes. Redo (Ctrl+Y) brings them back.", "Annuler tous les changements de l'IA. Rétablir (Ctrl+Y) les ramène.")
  root.append(button, compare, undo, close)

  // Les nombres comptent les formes. Les liaisons ne sont citées que si l'IA n'a changé qu'elles.
  function update({ added, changed, removed, quiet, drawn, showing, canCompare }) {
    compare.hidden = !canCompare
    undo.hidden = !canCompare
    const shapes = (list) => list.filter((e) => e.shape).length
    const a = shapes(added)
    const c = shapes(changed)
    const r = shapes(removed)
    const parts = []
    if (drawn && !c && !r) {
      parts.push(T(`diagram drawn, ${num(a)} ${a > 1 ? 'shapes' : 'shape'}`, `diagramme dessiné, ${num(a)} forme${a > 1 ? 's' : ''}`))
    } else if (a || c || r) {
      if (a) parts.push(T(`${num(a)} added`, `${num(a)} ajouté${a > 1 ? 's' : ''}`))
      if (c) parts.push(T(`${num(c)} changed`, `${num(c)} modifié${c > 1 ? 's' : ''}`))
      if (r) parts.push(T(`${num(r)} removed`, `${num(r)} supprimé${r > 1 ? 's' : ''}`))
    } else {
      const n = added.length + changed.length + removed.length
      parts.push(T(`${num(n)} ${n > 1 ? 'connections' : 'connection'} changed`, `${num(n)} liaison${n > 1 ? 's' : ''} modifiée${n > 1 ? 's' : ''}`))
    }
    button.innerHTML = ''
    const dot = document.createElement('span')
    dot.className = 'ai-changes-dot'
    const label = document.createElement('span')
    label.textContent = T('AI: ', 'IA : ') + parts.join(', ')
    button.append(dot, label)

    const lines = []
    const removedShapes = removed.filter((e) => e.shape)
    if (removedShapes.length) {
      lines.push(T('Removed:', 'Supprimés :'))
      for (const e of removedShapes) lines.push(`• ${e.name || e.type.replace('bpmn:', '')}`)
      lines.push('')
    }
    if (quiet) {
      lines.push(showing ? T('Click to hide the outlines', 'Cliquer pour masquer les contours') : T('Click to outline the changes', 'Cliquer pour entourer les changements'))
    }
    button.title = lines.join('\n').trim()
    button.classList.toggle('toggle', quiet)
    if (quiet) button.setAttribute('aria-pressed', String(showing))
    else button.removeAttribute('aria-pressed')
    pill.quiet = quiet
  }

  const pill = { root, button, close, compare, undo, update, quiet: false }
  return pill
}
