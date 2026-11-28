// IA active : le Co-pilote IA (intégré à la page, clé API ou modèles du serveur) ou un
// agent MCP (l'assistant de l'utilisateur). Une seule agit à la fois : un sélecteur de la
// barre d'outils la choisit, le navigateur retient ce choix. L'autre est coupée : le
// Co-pilote est grisé, ou les appels de l'agent sont refusés avec un message clair.

import { T } from './i18n/lang.js'

const KEY = 'bpmn-editor-active-ai'
export const ACTIVE_AI_EVENT = 'bpmn-active-ai'
const VALUES = ['copilot', 'agent']

let fallback = 'copilot'
let current = null

function read() {
  try {
    const value = localStorage.getItem(KEY)
    return VALUES.includes(value) ? value : null
  } catch {
    return null
  }
}

export function getActiveAi() {
  return current || read() || fallback
}

export function setActiveAi(value) {
  if (!VALUES.includes(value) || value === getActiveAi()) return
  current = value
  try { localStorage.setItem(KEY, value) } catch { /* stockage indisponible : le choix vaut pour cette page */ }
  apply()
  window.dispatchEvent(new CustomEvent(ACTIVE_AI_EVENT, { detail: value }))
}

function apply() {
  const value = getActiveAi()
  document.documentElement.classList.toggle('ai-agent', value === 'agent')
  document.documentElement.classList.toggle('ai-copilot', value === 'copilot')
  for (const button of document.querySelectorAll('#ai-switch [data-ai]')) {
    button.setAttribute('aria-checked', String(button.dataset.ai === value))
  }
}

// Message renvoyé à un agent MCP quand le Co-pilote est l'IA active.
export const agentRefusal = () => T(
  'The AI co-pilot is the active AI in this BPMN Pilot tab, so MCP agents are turned off. Ask the user to pick "MCP agent" in the AI selector of the toolbar, then call again.',
  "Le Co-pilote IA est l'IA active dans cet onglet de BPMN Pilot : les agents MCP y sont coupés. Demandez à l'utilisateur de choisir « Agent MCP » dans le sélecteur d'IA de la barre d'outils, puis rappelez.")

// Sélecteur à deux choix, posé juste avant le badge MCP. defaultAi : choix sans réglage
// enregistré ; forced : choix imposé sans sélecteur (onglet invisible du mode sans écran).
export function setupActiveAi({ defaultAi = 'copilot', forced = null } = {}) {
  fallback = defaultAi
  if (forced) current = forced
  apply()
  if (forced) return null
  const box = document.createElement('div')
  box.id = 'ai-switch'
  box.setAttribute('role', 'radiogroup')
  box.setAttribute('aria-label', T('Active AI', 'IA active'))
  box.title = T('Active AI: the built-in AI co-pilot, or your own agent connected through MCP. Only one acts at a time.',
    "IA active : le Co-pilote IA intégré, ou votre propre agent relié par MCP. Une seule agit à la fois.")
  box.innerHTML = `
    <span class="ai-switch-label" aria-hidden="true">${T('AI', 'IA')}</span>
    <button type="button" class="btn" role="radio" data-ai="copilot" data-icon="assistant" title="${T('The AI co-pilot of this page acts; MCP agents are turned off', 'Le Co-pilote IA de la page agit ; les agents MCP sont coupés')}">${T('Co-pilot', 'Co-pilote')}</button>
    <button type="button" class="btn" role="radio" data-ai="agent" data-icon="plug" title="${T('Your MCP agent acts; the AI co-pilot is turned off', 'Votre agent MCP agit ; le Co-pilote IA est coupé')}">${T('MCP agent', 'Agent MCP')}</button>`
  box.addEventListener('click', (e) => {
    const value = e.target.closest('[data-ai]')?.dataset.ai
    if (value) setActiveAi(value)
  })
  box.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    setActiveAi(getActiveAi() === 'copilot' ? 'agent' : 'copilot')
    box.querySelector('[aria-checked="true"]')?.focus()
  })
  const badge = document.getElementById('mcp-status')
  const anchor = badge || document.getElementById('btn-properties') || document.getElementById('autosave-status')
  if (anchor) anchor.before(box)
  else document.getElementById('toolbar')?.append(box)
  // Le badge pousse le groupe de droite (margin-left:auto) : le sélecteur prend sa place.
  if (badge) {
    box.style.marginLeft = 'auto'
    badge.style.marginLeft = '0'
  }
  apply()
  return box
}
