// Compteur de validation (bpmnlint) qui mène aux constats, même sur un autre niveau.
//
// bpmn-js-bpmnlint compte les constats de tout le diagramme, sous-processus repliés compris,
// mais ne marque que ceux du niveau affiché, et un clic sur son compteur masque ou affiche les
// pastilles. Sur un sous-processus sans constat, « 1 erreur » ne menait donc nulle part.
// Ce module :
//   - dit où sont les constats quand ils ne sont pas tous sur le niveau affiché ;
//   - fait du clic un « constat suivant » : il ouvre le bon niveau, sélectionne l'élément,
//     le centre et ouvre la liste de ses constats ; les erreurs passent avant les avertissements ;
//   - garde le masquage des pastilles sur un petit bouton œil, à côté du compteur.

import { T, num } from './i18n/lang.js'

const EYE = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>'
const EYE_OFF = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>'

const rootOf = (element) => {
  let r = element
  while (r?.parent) r = r.parent
  return r
}

function LintNavigator(eventBus, canvas, linting, elementRegistry, selection, overlays) {
  const old = linting._button
  if (!old) return
  // Le compteur d'origine bascule les pastilles au clic : on le remplace par une copie sans
  // son écouteur, rangée avec le bouton œil dans une même barre.
  const button = old.cloneNode(true)
  const bar = document.createElement('div')
  bar.className = 'lint-bar'
  const eye = document.createElement('button')
  eye.type = 'button'
  eye.className = 'lint-eye'
  old.replaceWith(bar)
  bar.append(button, eye)
  linting._button = button

  let cursor = -1
  let focus = null
  let focusTimer = null
  const openFocus = () => {
    const overlayId = focus && linting._overlayIds?.[focus]
    overlays.get(overlayId)?.html?.querySelector('.bjsl-dropdown')?.classList.add('open')
  }
  const createElementIssues = linting._createElementIssues
  linting._createElementIssues = function (elementId, elementIssues) {
    createElementIssues.call(this, elementId, elementIssues)
    if (elementId === focus) openFocus()
  }
  let lastKey = ''

  // Constats rangés : niveau affiché d'abord, erreurs avant avertissements, puis dans l'ordre du registre.
  function ordered() {
    const shown = canvas.getRootElement()
    const list = []
    for (const [id, issues] of Object.entries(linting._issues || {})) {
      const element = elementRegistry.get(id)
      if (!element) continue
      const errors = issues.filter((i) => i.category === 'error').length
      const warnings = issues.filter((i) => i.category === 'warn').length
      if (!errors && !warnings) continue
      const root = rootOf(element)
      list.push({ id, element, root, errors, warnings, here: root === shown })
    }
    return list.sort((a, b) => (b.here - a.here) || (!!b.errors - !!a.errors))
  }

  const levelName = (root) => {
    const bo = root?.businessObject
    return (bo?.name || bo?.id || '').trim()
  }

  function decorate() {
    const list = ordered()
    const here = list.filter((x) => x.here)
    const elsewhere = list.filter((x) => !x.here)
    button.querySelector('.lint-where')?.remove()
    // Libellé au singulier ou au pluriel (bpmnlint écrit toujours « 1 erreurs »).
    const errors = list.reduce((n, x) => n + x.errors, 0)
    const warnings = list.reduce((n, x) => n + x.warnings, 0)
    const label = button.querySelector('span:not(.icon)')
    if (label && (errors || warnings)) {
      const parts = []
      if (errors) parts.push(`${num(errors)} ${errors > 1 ? T('errors', 'erreurs') : T('error', 'erreur')}`)
      if (warnings) parts.push(`${num(warnings)} ${warnings > 1 ? T('warnings', 'avertissements') : T('warning', 'avertissement')}`)
      label.textContent = parts.join(', ')
    }
    if (list.length && elsewhere.length) {
      const where = document.createElement('span')
      where.className = 'lint-where'
      const levels = [...new Set(elsewhere.map((x) => x.root))]
      where.textContent = here.length
        ? T(`· ${num(elsewhere.length)} on another level`, `· ${num(elsewhere.length)} sur un autre niveau`)
        : levels.length === 1
          ? T(`· level “${levelName(levels[0])}”`, `· niveau « ${levelName(levels[0])} »`)
          : T(`· on ${num(levels.length)} other levels`, `· sur ${num(levels.length)} autres niveaux`)
      button.append(where)
    }
    button.title = list.length
      ? T('Go to the next error or warning, on whatever level it is', 'Aller à l\'erreur ou à l\'avertissement suivant, sur le niveau où il se trouve')
      : T('No error or warning in the diagram', 'Aucune erreur ni aucun avertissement dans le diagramme')
    const active = linting.isActive()
    eye.innerHTML = active ? EYE : EYE_OFF
    eye.title = active ? T('Hide the validation markers', 'Masquer les pastilles de validation') : T('Show the validation markers', 'Afficher les pastilles de validation')
    eye.setAttribute('aria-label', eye.title)
    eye.setAttribute('aria-pressed', String(!active))
  }

  function next() {
    if (!linting.isActive()) linting.toggle(true)
    const list = ordered()
    if (!list.length) return
    const key = list.map((x) => x.id).join(',')
    if (key !== lastKey) { lastKey = key; cursor = -1 }
    cursor = (cursor + 1) % list.length
    const target = list[cursor]
    if (target.root !== canvas.getRootElement()) canvas.setRootElement(target.root)
    if (target.element === target.root) {
      selection.select(null)
      return
    }
    selection.select(target.element)
    try { canvas.scrollToElement(target.element, { top: 120, bottom: 160, left: 120, right: 120 }) } catch { /* hors du niveau */ }
    // Ouvre la liste des constats de l'élément, comme au survol de sa pastille, quelques
    // secondes. La validation peut redessiner ses pastilles juste après : on la rouvre alors.
    focus = target.id
    openFocus()
    clearTimeout(focusTimer)
    focusTimer = setTimeout(() => { focus = null; document.querySelectorAll('.bjsl-dropdown.open').forEach((d) => d.classList.remove('open')) }, 4000)
  }

  button.addEventListener('click', next)
  eye.addEventListener('click', () => linting.toggle())

  const update = linting._updateButton
  linting._updateButton = function () {
    update.call(this)
    decorate()
  }
  eventBus.on(['root.set', 'linting.toggle'], () => { linting._updateButton() })
  decorate()
}

LintNavigator.$inject = ['eventBus', 'canvas', 'linting', 'elementRegistry', 'selection', 'overlays']

export const LintNavigatorModule = {
  __init__: ['lintNavigator'],
  lintNavigator: ['type', LintNavigator],
}
