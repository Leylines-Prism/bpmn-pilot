// Fenêtre « Connecter un agent » de la version en ligne. Un agent installé sur l'ordinateur
// (Claude Desktop, Claude Code, Cursor, VS Code…) lance le relais local bpmn-pilot-mcp, et cette
// page s'y relie par ws://127.0.0.1 quand l'utilisateur l'a autorisé ici. Sans cette
// autorisation, la page n'ouvre aucune connexion vers l'ordinateur.

import { T } from './i18n/lang.js'
import { addDialogClose } from './dialog-close.js'

export const LOCAL_MCP_KEY = 'bpmn-editor-local-mcp'
const AGENT_KEY = 'bpmn-editor-mcp-agent'
const MCPB_URL = 'https://github.com/Leylines-Prism/bpmn-pilot/releases/latest/download/bpmn-pilot.mcpb'
const NPX = ['-y', 'bpmn-pilot-mcp']

export function localMcpWanted() {
  try { return localStorage.getItem(LOCAL_MCP_KEY) === '1' } catch { return false }
}
function remember(on) {
  try { on ? localStorage.setItem(LOCAL_MCP_KEY, '1') : localStorage.removeItem(LOCAL_MCP_KEY) } catch {}
}

const compact = (value) =>
  JSON.stringify(value, null, 2)
    .replace(/\[\s+([^[\]{}]*?)\s+\]/g, (_, inner) => `[${inner.split(/,\s+/).join(', ')}]`)

// badge : bouton MCP de la barre. onChange(on) : relier ou couper le relais.
export function setupLocalMcpConnect({ badge, onChange }) {
  const dialog = document.createElement('dialog')
  dialog.id = 'mcp-connect-dialog'
  document.body.appendChild(dialog)
  const code = (id) =>
    `<div class="snippet"><pre id="${id}"><code></code></pre><button type="button" class="btn" data-copy="${id}" title="${T('Copy to the clipboard', 'Copier dans le presse-papiers')}">${T('Copy', 'Copier')}</button></div>`
  const AGENTS = [
    { id: 'desktop', label: 'Claude Desktop' },
    { id: 'code', label: 'Claude Code' },
    { id: 'vscode', label: 'VS Code (Copilot)' },
    { id: 'other', label: T('Cursor, others', 'Cursor, autres') },
  ]
  // Safari ne laisse pas une page HTTPS joindre un service local en ws:// (contenu mixte).
  const safari = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(navigator.userAgent)

  dialog.innerHTML = `
    <form method="dialog">
      <h2>${T('Connect an agent', 'Connecter un agent')}</h2>
      <p class="hint">${T(
        'An AI agent installed on this computer (Claude Desktop, Claude Code, Cursor, GitHub Copilot in VS Code…) can read and draw in the diagram open in this tab, with the same tools as the built-in AI co-pilot (MCP protocol). The agent starts a small local relay, bpmn-pilot-mcp: the diagram goes from the agent to this tab on your computer, through no other server.',
        'Un agent IA installé sur cet ordinateur (Claude Desktop, Claude Code, Cursor, GitHub Copilot dans VS Code…) peut lire et dessiner dans le diagramme ouvert dans cet onglet, avec les mêmes outils que le Co-pilote IA intégré (protocole MCP). L\'agent lance un petit relais local, bpmn-pilot-mcp : le diagramme va de l\'agent à cet onglet sur votre ordinateur, sans passer par aucun autre serveur.',
      )}</p>
      <p class="warn" ${safari ? '' : 'hidden'}>${T(
        'Safari blocks the connection from this page to a program on the computer. Use Chrome, Edge or Firefox.',
        'Safari bloque la connexion de cette page vers un programme de l\'ordinateur. Utilisez Chrome, Edge ou Firefox.',
      )}</p>

      <h3>${T('1. Your agent', '1. Votre agent')}</h3>
      <div class="agent-choice" role="radiogroup" aria-label="${T('Your agent', 'Votre agent')}">
        ${AGENTS.map((a) => `<label><input type="radio" name="mcp-agent" value="${a.id}" /><span>${a.label}</span></label>`).join('')}
      </div>
      <div class="agent-panel" data-agent="desktop">
        <ol class="steps">
          <li><p class="hint">${T('Download the BPMN Pilot extension:', 'Téléchargez l\'extension BPMN Pilot :')}</p>
            <a class="btn primary download" data-icon="save" href="${MCPB_URL}" download>${T('Download bpmn-pilot.mcpb', 'Télécharger bpmn-pilot.mcpb')}</a></li>
          <li><p class="hint">${T(
            'Double-click the downloaded file: Claude Desktop opens it. Click Install. Nothing else to install: Claude Desktop runs the relay itself.',
            'Double-cliquez sur le fichier téléchargé : Claude Desktop l\'ouvre. Cliquez sur Installer. Rien d\'autre à installer : Claude Desktop fait tourner le relais lui-même.',
          )}</p></li>
        </ol>
      </div>
      <div class="agent-panel" data-agent="code">
        <p class="hint">${T('In a terminal, paste this command and press Enter (needs Node.js 20 or later):', 'Dans un terminal, collez cette commande et appuyez sur Entrée (Node.js 20 ou plus requis) :')}</p>
        ${code('mcp-local-code')}
      </div>
      <div class="agent-panel" data-agent="vscode">
        <p class="hint">${T(
          'Open the command palette (Ctrl+Shift+P), run "MCP: Open User Configuration", paste this block (inside "servers" if it already exists) and save. Needs Node.js 20 or later.',
          'Ouvrez la palette de commandes (Ctrl+Maj+P), lancez « MCP: Open User Configuration », collez ce bloc (dans « servers » s\'il existe déjà) et enregistrez. Node.js 20 ou plus requis.',
        )}</p>
        ${code('mcp-local-vscode')}
      </div>
      <div class="agent-panel" data-agent="other">
        <p class="hint">${T(
          'Add this block to the MCP settings of the agent (Cursor: Settings, then MCP; others: their MCP configuration file). Needs Node.js 20 or later.',
          'Ajoutez ce bloc aux réglages MCP de l\'agent (Cursor : Réglages, puis MCP ; les autres : leur fichier de configuration MCP). Node.js 20 ou plus requis.',
        )}</p>
        ${code('mcp-local-generic')}
      </div>

      <h3>${T('2. Allow this page', '2. Autoriser cette page')}</h3>
      <label class="mod-row">
        <span class="mod-text"><strong>${T('Local agent', 'Agent local')}</strong><span class="mod-detail">${T(
          'This tab connects to the relay at 127.0.0.1 (this computer). Your browser may ask you to allow access to devices on your local network: accept.',
          'Cet onglet se relie au relais à l\'adresse 127.0.0.1 (cet ordinateur). Votre navigateur peut demander d\'autoriser l\'accès aux appareils de votre réseau local : acceptez.',
        )}</span></span>
        <input type="checkbox" class="mod-switch" role="switch" id="mcp-local-switch">
      </label>
      <p class="relay-state" id="mcp-relay-state" role="status"></p>

      <h3>${T('3. Check that it works', '3. Vérifier que ça marche')}</h3>
      <p class="hint">${T(
        'Ask your agent: "Describe the diagram open in BPMN Pilot." It works in the tab used last: keep it open while the agent draws.',
        'Demandez à votre agent : « Décris le diagramme ouvert dans BPMN Pilot. » Il travaille dans le dernier onglet utilisé : gardez-le ouvert pendant qu\'il dessine.',
      )}</p>

      <p class="status" id="mcp-copy-status" role="status"></p>
      <div class="actions">
        <span class="grow"></span>
        <button type="submit" class="btn" value="close">${T('Close', 'Fermer')}</button>
      </div>
    </form>`
  addDialogClose(dialog)

  const $ = (sel) => dialog.querySelector(sel)
  const set = (id, text) => { $(`#${id} code`).textContent = text }
  set('mcp-local-code', `claude mcp add bpmn-pilot -- npx ${NPX.join(' ')}`)
  set('mcp-local-vscode', compact({ servers: { 'bpmn-pilot': { command: 'npx', args: NPX } } }))
  set('mcp-local-generic', compact({ mcpServers: { 'bpmn-pilot': { command: 'npx', args: NPX } } }))

  function showAgent(id) {
    if (!AGENTS.some((a) => a.id === id)) id = 'desktop'
    for (const input of dialog.querySelectorAll('[name="mcp-agent"]')) input.checked = input.value === id
    for (const panel of dialog.querySelectorAll('.agent-panel')) panel.hidden = panel.dataset.agent !== id
    try { localStorage.setItem(AGENT_KEY, id) } catch {}
  }
  let saved = null
  try { saved = localStorage.getItem(AGENT_KEY) } catch {}
  showAgent(saved)
  dialog.addEventListener('change', (e) => {
    if (e.target.name === 'mcp-agent') showAgent(e.target.value)
  })

  const toggle = $('#mcp-local-switch')
  function refreshState() {
    const state = $('#mcp-relay-state')
    const on = toggle.checked
    state.dataset.state = on ? badge.dataset.state : 'off'
    state.textContent = !on
      ? T('Off: this page opens no connection to the computer.', 'Désactivé : cette page n\'ouvre aucune connexion vers l\'ordinateur.')
      : badge.dataset.state === 'connected'
        ? T('Connected to the local relay.', 'Relié au relais local.') + (badge.dataset.client ? ' ' + T('Agent: ', 'Agent : ') + badge.dataset.client : '')
        : T('Waiting for the relay: start your agent (it starts the relay), then wait a few seconds.', 'En attente du relais : lancez votre agent (il démarre le relais), puis patientez quelques secondes.')
  }
  new MutationObserver(refreshState).observe(badge, { attributes: true, attributeFilter: ['data-state', 'data-client'] })
  toggle.addEventListener('change', () => {
    remember(toggle.checked)
    onChange(toggle.checked)
    refreshState()
  })
  dialog.addEventListener('click', async (e) => {
    const button = e.target.closest('[data-copy]')
    if (!button) return
    const status = $('#mcp-copy-status')
    try {
      await navigator.clipboard.writeText($(`#${button.dataset.copy} code`).textContent)
      status.textContent = T('Copied to the clipboard.', 'Copié dans le presse-papiers.')
    } catch {
      const range = document.createRange()
      range.selectNodeContents($(`#${button.dataset.copy}`))
      getSelection().removeAllRanges()
      getSelection().addRange(range)
      status.textContent = T('Automatic copy failed: the text is selected, press Ctrl+C.', 'Copie automatique impossible : le texte est sélectionné, faites Ctrl+C.')
    }
  })
  badge.addEventListener('click', () => {
    $('#mcp-copy-status').textContent = ''
    toggle.checked = localMcpWanted()
    refreshState()
    dialog.showModal()
  })
  return { open: () => badge.click() }
}
