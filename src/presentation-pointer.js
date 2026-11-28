// Pointeur du mode Présentation (src/presentation.js), pour montrer le schéma à un public.
// Quatre effets qui se cumulent, chacun activé dans le menu Pointeur de la barre ou par sa touche :
//   1. pointeur laser : un point rouge orangé suivi d'une courte traînée, à la place de la flèche ;
//   2. surbrillance au survol : l'élément survolé et ses flux s'allument, le reste pâlit ;
//   3. onde au clic : un cercle s'élargit là où l'on clique ;
//   4. masquer à l'arrêt : après deux secondes sans bouger, le curseur et la barre s'effacent,
//      et reviennent au premier mouvement.
// Les choix sont retenus dans ce navigateur. Rien ne touche au diagramme ni à l'éditeur
// hors présentation.
import { T } from './i18n/lang.js'

const KEY = 'bpmn-editor-pres-pointer'
const IDLE_MS = 2000
const TRAIL_MS = 380
const COLOR = '255, 59, 31' // rouge orangé, lisible sur fond clair comme sombre
// Ce que la surbrillance ignore : le fond, les bassins et couloirs, qui couvriraient tout.
const NO_HIGHLIGHT = new Set(['bpmn:Process', 'bpmn:Collaboration', 'bpmn:Participant', 'bpmn:Lane', 'bpmn:SubProcess'])

const EFFECTS = [
  { id: 'laser', key: '1', on: true, label: () => T('Laser pointer', 'Pointeur laser') },
  { id: 'hover', key: '2', on: false, label: () => T('Highlight on hover', 'Surbrillance au survol') },
  { id: 'ripple', key: '3', on: true, label: () => T('Ripple on click', 'Onde au clic') },
  { id: 'idle', key: '4', on: true, label: () => T('Hide when still', 'Masquer à l\'arrêt') },
]

function read() {
  const state = Object.fromEntries(EFFECTS.map((e) => [e.id, e.on]))
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}')
    for (const e of EFFECTS) if (typeof saved[e.id] === 'boolean') state[e.id] = saved[e.id]
  } catch { /* valeur illisible ou stockage indisponible : réglages par défaut */ }
  return state
}

export function setupPresentationPointer({ modeler, bar, flash }) {
  const canvas = modeler.get('canvas')
  const eventBus = modeler.get('eventBus')
  const container = canvas.getContainer()
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const on = read()
  let active = false
  let idleTimer = null
  let trail = []
  let dot = null
  let frame = null
  let marked = []

  // Calque des effets, au-dessus du schéma, qui ne capte aucun geste.
  const layer = document.createElement('div')
  layer.id = 'presentation-fx'
  layer.hidden = true
  layer.setAttribute('aria-hidden', 'true')
  const laser = document.createElement('canvas')
  layer.append(laser)
  document.body.append(layer)
  const ctx = laser.getContext('2d')

  // Bouton et menu Pointeur, dans la barre de présentation, avant le zoom.
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'btn'
  button.dataset.icon = 'pointer'
  button.setAttribute('aria-haspopup', 'menu')
  button.setAttribute('aria-expanded', 'false')
  button.title = T('Pointer effects, which can be combined (keys 1 to 4)', 'Effets du pointeur, cumulables (touches 1 à 4)')
  button.textContent = T('Pointer', 'Pointeur')
  const menu = document.createElement('div')
  menu.className = 'pres-menu'
  menu.setAttribute('role', 'menu')
  menu.hidden = true
  for (const effect of EFFECTS) {
    const item = document.createElement('button')
    item.type = 'button'
    item.className = 'btn'
    item.setAttribute('role', 'menuitemcheckbox')
    item.dataset.effect = effect.id
    const name = document.createElement('span')
    name.textContent = effect.label()
    const kbd = document.createElement('kbd')
    kbd.textContent = effect.key
    item.append(name, kbd)
    menu.append(item)
  }
  const wrap = document.createElement('div')
  wrap.className = 'pres-pointer'
  wrap.append(button, menu)
  bar.querySelector('[data-act="out"]').before(wrap)

  function openMenu(open) {
    menu.hidden = !open
    button.setAttribute('aria-expanded', String(open))
    if (open) menu.querySelector('button')?.focus()
  }
  button.addEventListener('click', () => openMenu(menu.hidden))
  menu.addEventListener('click', (e) => {
    const item = e.target.closest('button')
    if (!item) return
    toggle(item.dataset.effect)
  })
  document.addEventListener('pointerdown', (e) => {
    if (!menu.hidden && !wrap.contains(e.target)) openMenu(false)
  }, true)

  function syncUi() {
    for (const item of menu.querySelectorAll('[data-effect]')) item.setAttribute('aria-checked', String(on[item.dataset.effect]))
    document.body.classList.toggle('pres-laser', active && on.laser)
  }

  function toggle(id, announce = false) {
    on[id] = !on[id]
    try { localStorage.setItem(KEY, JSON.stringify(on)) } catch { /* stockage indisponible : le choix vaut pour cette page */ }
    if (!on.laser) { trail = []; dot = null; draw() }
    if (!on.hover) clearHighlight()
    if (!on.idle) wake()
    syncUi()
    if (announce) {
      const effect = EFFECTS.find((e) => e.id === id)
      const name = effect.label()
      flash(on[id] ? T(`${name}: on`, `${name} : activé`) : T(`${name}: off`, `${name} : désactivé`))
    }
  }

  // Touches 1 à 4 : chacune bascule un effet. Échap ferme d'abord le menu. Renvoie vrai si la touche a servi.
  function onKey(e) {
    if (e.key === 'Escape' && !menu.hidden) {
      openMenu(false)
      button.focus()
      return true
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return false
    const effect = EFFECTS.find((x) => x.key === e.key)
    if (!effect) return false
    toggle(effect.id, true)
    return true
  }

  // ── Laser ──
  function resize() {
    const ratio = window.devicePixelRatio || 1
    laser.width = Math.round(window.innerWidth * ratio)
    laser.height = Math.round(window.innerHeight * ratio)
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(draw)
  }
  function draw() {
    frame = null
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
    if (!active || !on.laser) return
    const now = performance.now()
    const life = reduceMotion ? 0 : TRAIL_MS
    trail = trail.filter((p) => now - p.t < life)
    // Courbe lissée : chaque morceau va du milieu d'un segment au milieu du suivant, avec le
    // point relevé comme point de contrôle. Les morceaux se raccordent bout à bout, sans se
    // chevaucher : aucune pastille plus foncée aux points relevés, aucun angle.
    ctx.lineCap = 'butt'
    const mid = (p, q) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 })
    const last = trail.length - 1
    for (let i = 1; i <= last; i++) {
      const a = 1 - (now - trail[i].t) / life
      ctx.strokeStyle = `rgba(${COLOR}, ${a * 0.6})`
      ctx.lineWidth = 1.5 + 3 * a
      const from = i === 1 ? trail[0] : mid(trail[i - 2], trail[i - 1])
      const to = i === last ? trail[i] : mid(trail[i - 1], trail[i])
      ctx.beginPath()
      ctx.moveTo(from.x, from.y)
      ctx.quadraticCurveTo(trail[i - 1].x, trail[i - 1].y, to.x, to.y)
      ctx.stroke()
    }
    if (dot) {
      const g = ctx.createRadialGradient(dot.x, dot.y, 0, dot.x, dot.y, 9)
      g.addColorStop(0, 'rgba(255, 220, 205, 1)')
      g.addColorStop(0.45, `rgba(${COLOR}, 1)`)
      g.addColorStop(1, `rgba(${COLOR}, 0)`)
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(dot.x, dot.y, 9, 0, Math.PI * 2)
      ctx.fill()
    }
    if (trail.length) schedule()
  }

  // Le pointeur ne vaut que sur le schéma : sur la barre ou les commandes de la simulation,
  // la flèche habituelle revient.
  const svg = () => container.querySelector(':scope > svg')
  const overDiagram = (target) => !!svg()?.contains(target)

  // ── Curseur et barre qui s'effacent à l'arrêt ──
  function wake() {
    document.body.classList.remove('pres-idle')
    clearTimeout(idleTimer)
    idleTimer = setTimeout(goIdle, IDLE_MS)
  }
  function goIdle() {
    if (!active || !on.idle) return
    // Pas pendant qu'on lit la barre ou son menu.
    if (bar.matches(':hover') || !menu.hidden) return wake()
    document.body.classList.add('pres-idle')
    dot = null
    trail = []
    draw()
  }

  function onMove(e) {
    if (!active) return
    wake()
    if (!on.laser) return
    if (overDiagram(e.target)) {
      dot = { x: e.clientX, y: e.clientY }
      // Tous les points du mouvement (getCoalescedEvents), pour une courbe plus fine.
      const t = performance.now()
      const events = e.getCoalescedEvents?.()
      for (const ev of events?.length ? events : [e]) trail.push({ x: ev.clientX, y: ev.clientY, t })
    } else {
      dot = null
      trail = []
    }
    schedule()
  }
  function onDown(e) {
    if (!active) return
    wake()
    if (!on.ripple || !overDiagram(e.target)) return
    const ring = document.createElement('div')
    ring.className = 'pres-ripple'
    ring.style.left = `${e.clientX}px`
    ring.style.top = `${e.clientY}px`
    layer.append(ring)
    ring.addEventListener('animationend', () => ring.remove())
    setTimeout(() => ring.remove(), 1000)
  }
  function onLeave() {
    dot = null
    trail = []
    draw()
    clearHighlight()
  }

  // ── Surbrillance au survol ──
  function mark(element, cls) {
    if (!element || marked.some(([el]) => el === element)) return
    canvas.addMarker(element, cls)
    marked.push([element, cls])
    if (element.label) mark(element.label, cls)
  }
  function clearHighlight() {
    for (const [el, cls] of marked) canvas.removeMarker(el, cls)
    marked = []
    container.classList.remove('pres-dim')
  }
  eventBus.on('element.hover', ({ element }) => {
    if (!active || !on.hover) return
    clearHighlight()
    const target = element.labelTarget || element
    // Un sous-processus replié est une étape comme une autre : seul le sous-processus déplié,
    // qui contient d'autres éléments, reste hors de la surbrillance.
    const isContainer = NO_HIGHLIGHT.has(target.type) && !(target.type === 'bpmn:SubProcess' && target.collapsed)
    if (!target.businessObject || isContainer && !target.waypoints) return
    if (target === canvas.getRootElement()) return
    mark(target, 'pres-hot')
    if (target.waypoints) {
      mark(target.source, 'pres-near')
      mark(target.target, 'pres-near')
    } else {
      for (const c of [...(target.incoming || []), ...(target.outgoing || [])]) {
        mark(c, 'pres-hot')
        mark(c.source === target ? c.target : c.source, 'pres-near')
      }
    }
    container.classList.add('pres-dim')
  })
  eventBus.on('element.out', () => {
    if (active && on.hover) clearHighlight()
  })

  function enter() {
    active = true
    layer.hidden = false
    resize()
    syncUi()
    window.addEventListener('resize', resize)
    window.addEventListener('pointermove', onMove, true)
    window.addEventListener('pointerdown', onDown, true)
    document.documentElement.addEventListener('pointerleave', onLeave)
    wake()
  }
  function exit() {
    active = false
    clearTimeout(idleTimer)
    openMenu(false)
    onLeave()
    layer.hidden = true
    layer.querySelectorAll('.pres-ripple').forEach((r) => r.remove())
    document.body.classList.remove('pres-idle', 'pres-laser')
    window.removeEventListener('resize', resize)
    window.removeEventListener('pointermove', onMove, true)
    window.removeEventListener('pointerdown', onDown, true)
    document.documentElement.removeEventListener('pointerleave', onLeave)
  }

  syncUi()
  return { enter, exit, onKey }
}
