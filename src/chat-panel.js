// Panneau de chat intégré : l'utilisateur décrit un processus, l'IA le dessine
// dans cet onglet.
//
// Deux modes :
//   - « server » (version docker, développement) : la boucle tourne sur le serveur
//     (dossier mcp/, route /chat), qui exécute les outils dans l'onglet par le pont.
//     Les modèles viennent du serveur (variables d'environnement) ou de la fenêtre
//     Options, dont la clé part avec chaque message et n'est pas enregistrée.
//   - « online » (site public) : la boucle tourne dans la page et appelle
//     directement le fournisseur réglé dans Options, avec la clé du visiteur.

import { describeProviderError } from './ai/errors.js'
import { listModels } from './ai/providers.js'
import { connectionFor, loadSettings, userModels } from './ai-settings.js'
import { createOptionsDialog } from './options-dialog.js'
import { lang, num, T } from './i18n/lang.js'
import { IMAGE_TYPES, MAX_ATTACHMENTS, MAX_IMAGE_BYTES, MAX_PDF_BYTES, MAX_TOTAL_BYTES, PDF_TYPE, supports } from './ai/attachments.js'
import { fileToText, textFileKind, TEXT_FILE_ACCEPT, withTextFiles } from './ai/text-files.js'
import { makeResizable } from './panel-resize.js'
import { onPageHide, range, track, trackOnce } from './analytics.js'
import { newAiRound, undoAiRound } from './ai-changes.js'
import { isLocalAddress } from './ai/local-address.js'
import { addDialogClose } from './dialog-close.js'
import { setChatModel } from './copilot-analysis.js'
import { MIC_ICON, setupVoiceInput, voiceSupported } from './voice-input.js'
import { renderMarkdownInto } from './ai/markdown.js'

const TOOL_LABELS = {
  get_shapes: T('reading the diagram', 'lecture du diagramme'),
  get_diagram_xml: T('reading the XML', 'lecture du XML'),
  get_diagram_image: T('looking at the diagram', 'coup d\'œil au diagramme'),
  get_process_report: T('process report', 'rapport de processus'),
  set_report_commentary: T('analysis for the report', 'analyse pour le rapport'),
  set_diagram_xml: T('replacing the diagram', 'remplacement du diagramme'),
  import_mermaid: T('importing Mermaid', 'import Mermaid'),
  get_diagram_mermaid: T('reading as Mermaid', 'lecture en Mermaid'),
  export_diagram: 'export',
  add_shapes: T('adding shapes', 'ajout de formes'),
  connect_shapes: T('connections', 'connexions'),
  update_elements: T('changes', 'modification'),
  style_elements: T('colors and text', 'couleurs et texte'),
  remove_elements: T('removal', 'suppression'),
  layout_diagram: T('layout', 'mise en page'),
  auto_layout: T('layout', 'mise en page'),
  move_elements: T('moving shapes', 'déplacement de formes'),
  duplicate_elements: T('copying shapes', 'copie de formes'),
  undo: T('undo', 'annulation'),
  redo: T('redo', 'rétablissement'),
  validate_diagram: 'validation',
  get_decisions: T('reading the decisions', 'lecture des décisions'),
  set_decision_table: T('decision table', 'table de décision'),
  link_decision: T('decision link', 'lien de décision'),
  test_decision: T('testing the table', 'essai de la table'),
  get_task_forms: T('reading the forms', 'lecture des formulaires'),
  set_task_form: T('task form', 'formulaire de tâche'),
  load_event_log: T('loading the event log', 'chargement du journal'),
  get_log_summary: T('reading the event log', 'lecture du journal'),
  map_log_activities: T('matching log steps', 'correspondance des étapes'),
  apply_log_frequencies: T('real frequencies', 'fréquences réelles'),
  check_conformance: T('conformance check', 'contrôle de conformité'),
}

const CSS = `
#chat-panel { width: 340px; flex-shrink: 0; display: none; flex-direction: column; background: #16213e; border-left: 1px solid #0f3460; }
#chat-panel.open { display: flex; }
#chat-panel header { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid #0f3460; font-size: 13px; font-weight: 600; }
#chat-panel header span { flex: 1; }
#chat-panel header .btn { font-size: 12px; height: 28px; padding: 0 8px; }
#chat-log { flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 10px; font-size: 13px; line-height: 1.45; }
.chat-msg { padding: 8px 10px; border-radius: 8px; white-space: pre-wrap; overflow-wrap: anywhere; }
.chat-msg.user { align-self: flex-end; max-width: 85%; background: #0f3460; }
.chat-msg.assistant { background: #1f2a4a; }
.chat-msg.notice { color: #9ca3af; font-size: 12px; background: transparent; padding: 0 2px; }
.chat-msg.error { color: #fca5a5; font-size: 12px; background: rgba(233,69,96,0.12); }
.chat-tools { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.chat-tools span { font-size: 11px; padding: 1px 7px; border-radius: 10px; border: 1px solid #0f3460; color: #9ca3af; white-space: nowrap; }
.chat-tools span.failed { color: #fca5a5; border-color: #e94560; }
.chat-status { font-size: 11px; color: #9ca3af; margin-top: 6px; }
#chat-form { display: flex; gap: 6px; padding: 8px; border-top: 1px solid #0f3460; }
#chat-input { flex: 1; resize: none; height: 60px; padding: 6px 8px; border-radius: 4px; border: 1px solid #0f3460; background: #1a1a2e; color: #e0e0e0; font: inherit; font-size: 13px; }
#chat-input:disabled { opacity: 0.5; }
`


// mode : « server » ou « online ». En mode server : chatUrl et bridge (pont MCP).
// En mode online : tools, les outils exécutés sur le bpmn-js de la page.
// Longueur maximale d'un message, la même que celle acceptée par le serveur.
const MAX_MESSAGE = 100000

const EXPAND_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9"/></svg>`

const ATTACH_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5 12.5 20a5.5 5.5 0 0 1-7.8-7.8l8.9-8.9a3.7 3.7 0 0 1 5.2 5.2l-8.9 8.9a1.8 1.8 0 0 1-2.6-2.6L15.5 6.6"/></svg>`
const PDF_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M8.5 16.5v-4h1.2a1.2 1.2 0 0 1 0 2.4H8.5M13 12.5v4h.8a2 2 0 0 0 0-4zM17.5 12.5h-1.6v4M15.9 14.5h1.3"/></svg>`
const MAX_IMAGE_SIDE = 1568 // au-delà, l'image est réduite : le modèle n'en voit pas plus

const DOC_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M8.5 12.5h7M8.5 15.5h7M8.5 18.5h4"/></svg>`
// Erreurs de lecture d'un fichier (src/ai/text-files.js), en français.
const READ_ERRORS_FR = {
  'unsupported file type': 'type de fichier non pris en charge',
  'file too large': 'fichier trop volumineux',
  'document too large once unpacked': 'document trop volumineux une fois décompressé',
  'not a valid document (zip)': 'document illisible ou abîmé',
  'unsupported compression': 'compression non prise en charge',
  'not a Word document': "ce n'est pas un document Word",
  'not a PowerPoint presentation': "ce n'est pas une présentation PowerPoint",
  'not an Excel workbook': "ce n'est pas un classeur Excel",
  'not an OpenDocument file': "ce n'est pas un fichier OpenDocument",
}
const readError = (err) => READ_ERRORS_FR[err.message] || err.message
const sizeText = (bytes) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} ${T('MB', 'Mo')}` : `${Math.max(1, Math.round(bytes / 1024))} ${T('KB', 'Ko')}`

const blobToBase64 = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })

// Réduit une grande image (côté le plus long à 1568 px), ou la convertit si son
// format n'est pas accepté par les modèles. Renvoie un Blob.
async function prepareImage(file) {
  let bitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    if (IMAGE_TYPES.includes(file.type)) return file
    throw new Error(T('this image cannot be read', 'image illisible'))
  }
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height))
  const keep = IMAGE_TYPES.includes(file.type) && scale === 1 && file.size <= MAX_IMAGE_BYTES
  if (keep || (file.type === 'image/gif' && file.size <= MAX_IMAGE_BYTES)) {
    bitmap.close?.()
    return file
  }
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close?.()
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
  const encode = (as, quality) => new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), as, quality))
  const blob = await encode(type, 0.9)
  // Une photo enregistrée en PNG peut rester trop lourde : on passe alors en JPEG.
  return blob && blob.size > MAX_IMAGE_BYTES && type === 'image/png' ? encode('image/jpeg', 0.85) : blob
}

// Événement window { detail: { text } } : une demande toute prête pour le Co-pilote.
export const COPILOT_ASK_EVENT = 'bpmn-pilot-copilot-ask'

export function createChatPanel({ mode, chatUrl, bridge, tools }) {
  const style = document.createElement('style')
  style.textContent = CSS
  document.head.append(style)

  const panel = document.createElement('aside')
  panel.id = 'chat-panel'
  panel.innerHTML = `
    <header><span class="chat-title-icon" data-icon="assistant" aria-hidden="true"></span><span class="chat-title"><span class="chat-title-name">${T('AI co-pilot', 'Co-pilote IA')}</span><span class="chat-title-model" hidden></span></span><button class="btn" type="button" id="chat-settings" title="${T('Providers, API keys and models', 'Fournisseurs, clés API et modèles')}">Options</button><button class="btn" type="button" id="chat-reset" title="${T('Start a new conversation; the diagram is kept', 'Commencer une nouvelle discussion ; le diagramme est conservé')}">${T('New chat', 'Nouvelle discussion')}</button></header>
    <div id="chat-log" aria-live="polite"></div>
    <div id="chat-attachments" hidden></div>
    <div id="chat-destination" hidden></div>
    <div id="chat-voice-meter" hidden></div>
    <div id="chat-voice-interim" aria-live="polite" hidden></div>
    <form id="chat-form">
      <div class="chat-input-wrap">
        <textarea id="chat-input" placeholder="${T('Describe the process to draw, or what to change… Documents, images and PDFs accepted.', 'Décrivez le processus à dessiner ou à modifier… Documents, images et PDF acceptés.')}"></textarea>
        <button type="button" id="chat-expand" title="${T('Expand the input', 'Agrandir la zone de saisie')}" aria-label="${T('Expand the input', 'Agrandir la zone de saisie')}">${EXPAND_ICON}</button>
        <button type="button" id="chat-attach" title="${T('Attach a file: image, PDF, Word, Excel, PowerPoint, text, CSV, JSON… (you can also paste or drop it)', 'Joindre un fichier : image, PDF, Word, Excel, PowerPoint, texte, CSV, JSON… (on peut aussi le coller ou le glisser)')}" aria-label="${T('Attach a file', 'Joindre un fichier')}">${ATTACH_ICON}</button>
        <input type="file" id="chat-attach-input" accept="image/png,image/jpeg,image/gif,image/webp,application/pdf,${TEXT_FILE_ACCEPT}" multiple hidden>
        ${voiceSupported() ? `<button type="button" id="chat-mic">${MIC_ICON}</button>` : ''}
      </div>
      <button class="btn primary" type="submit" id="chat-send" title="${T('Send (Enter; Shift+Enter for a new line)', 'Envoyer (Entrée ; Maj+Entrée pour aller à la ligne)')}">${T('Send', 'Envoyer')}</button>
    </form>
    <dialog id="chat-editor">
      <form method="dialog">
        <h2>${T('Message to the co-pilot', "Message au co-pilote")}</h2>
        <textarea id="chat-editor-text" placeholder="${T('Paste or write a long message. Ctrl+Enter to send.', 'Collez ou écrivez un long message. Ctrl+Entrée pour envoyer.')}"></textarea>
        <div class="chat-editor-actions">
          <button class="btn" type="button" id="chat-editor-file" title="${T('Insert the text of a file, to trim it before sending', 'Insérer le texte d\'un fichier, pour l\'élaguer avant l\'envoi')}">${T('Open a file…', 'Ouvrir un fichier…')}</button>
          <input type="file" id="chat-editor-input" accept="${TEXT_FILE_ACCEPT}" hidden>
          <span class="chat-editor-count" aria-live="polite"></span>
          <button class="btn" type="submit" value="close">${T('Close', 'Fermer')}</button>
          <button class="btn primary" type="submit" value="send" id="chat-editor-send" title="${T('Send (Ctrl+Enter)', 'Envoyer (Ctrl+Entrée)')}">${T('Send', 'Envoyer')}</button>
        </div>
      </form>
    </dialog>`
  document.getElementById('properties-panel').after(panel)
  makeResizable(panel, { name: 'chat', label: T('AI co-pilot width', "Largeur du co-pilote IA"), min: 300, max: 900, fallback: 360 })

  const toggle = document.createElement('button')
  toggle.className = 'btn'
  toggle.id = 'btn-chat'
  toggle.type = 'button'
  toggle.title = T('Open or close the AI co-pilot', "Ouvrir ou fermer le co-pilote IA")
  // « Co-pilote IA » en entier, ou « IA » seul quand le modèle s'affiche à côté.
  const toggleFull = document.createElement('span')
  toggleFull.className = 'chat-btn-full'
  toggleFull.textContent = T('AI co-pilot', 'Co-pilote IA')
  const toggleShort = document.createElement('span')
  toggleShort.className = 'chat-btn-short'
  toggleShort.textContent = T('AI', 'IA')
  toggleShort.setAttribute('aria-hidden', 'true')
  toggle.append(toggleFull, toggleShort)
  toggle.setAttribute('aria-label', T('AI co-pilot', 'Co-pilote IA'))
  // Le modèle choisi, en petit à côté du nom (masqué sur écran étroit).
  const toggleModel = document.createElement('span')
  toggleModel.className = 'chat-btn-model'
  toggleModel.hidden = true
  toggle.append(toggleModel)
  // À droite de la barre, juste après le badge MCP (version docker), ou en tête
  // du groupe de droite quand il n'y a pas de badge (version en ligne), puis
  // l'état de la sauvegarde.
  const badge = document.getElementById('mcp-status')
  const autosave = document.getElementById('autosave-status')
  const anchor = document.getElementById('btn-properties') || autosave
  if (badge) badge.after(toggle)
  else if (anchor) {
    anchor.before(toggle)
    toggle.classList.add('push-right')
    autosave.style.marginLeft = '8px'
  } else document.getElementById('btn-expert').after(toggle)
  // Le bouton du panneau Processus passe à gauche du Co-pilote : les deux panneaux de droite
  // s'ouvrent depuis le même groupe, le Co-pilote au bord, comme son panneau.
  const panelButton = document.getElementById('btn-properties')
  if (panelButton && toggle.previousElementSibling !== panelButton) {
    toggle.before(panelButton)
    if (toggle.classList.contains('push-right')) {
      toggle.classList.remove('push-right')
      panelButton.classList.add('push-right')
    }
  }

  const log = panel.querySelector('#chat-log')
  const form = panel.querySelector('#chat-form')
  const input = panel.querySelector('#chat-input')
  const sendButton = panel.querySelector('#chat-send')
  const titleName = panel.querySelector('.chat-title-name')
  const titleModel = panel.querySelector('.chat-title-model')
  const destination = panel.querySelector('#chat-destination')

  let controller = null // requête en cours, pour le bouton « Arrêter »
  let checked = false
  let settings = loadSettings()
  let serverModels = [] // { id, label, provider, providerLabel }, envoyés par le serveur
  let models = [] // modèles du fournisseur actif : serverModels ou ceux de la fenêtre Options
  let currentId = '' // modèle du co-pilote, choisi dans la fenêtre Options
  // Discussion en cours : sur le serveur ({ id }) ou dans la page ({ messages }).
  // kind « server:anthropic », « local:openai »… : l'historique ne passe pas d'un format à l'autre.
  let conversation = null

  const currentModel = () => models.find((m) => m.id === currentId)
  const kindOf = (m) => `${mode === 'online' ? 'local' : 'server'}:${m.source === 'user' ? m.format : m.provider}`

  const options = createOptionsDialog({
    mode,
    test: testConnection,
    // Clés effacées : la liste des modèles utilisables change aussitôt.
    onForget() {
      fillModels()
      announce()
    },
    onSave(saved) {
      settings = saved
      const before = currentModel()
      fillModels()
      const model = currentModel()
      // Un historique ne passe pas d'un format d'API à l'autre.
      if (conversation && model && before?.id !== model.id) {
        if (conversation.kind !== kindOf(model)) {
          conversation = null
          add('notice', T(`Different provider: the chat starts over with ${model.label}. The diagram does not change.`, `Autre fournisseur : la discussion repart de zéro avec ${model.label}. Le diagramme, lui, ne change pas.`))
        } else {
          add('notice', T(`The next messages will go to ${model.label}.`, `Les prochains messages iront à ${model.label}.`))
        }
      }
      announce()
      input.focus()
    },
  })

  // Bouton Tester ou Lister : directement depuis la page en ligne, par le serveur sinon.
  async function testConnection(conn) {
    if (mode === 'online') {
      try {
        return await listModels({ ...conn, browser: true, signal: AbortSignal.timeout(15000) })
      } catch (err) {
        throw new Error(describeProviderError(err, { label: conn.label, providerId: conn.provider, browser: true, origin: location.origin, lang }), { cause: err })
      }
    }
    let res
    try {
      res = await fetch(`${chatUrl}/models`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...conn, lang }),
      })
    } catch {
      throw new Error(T('Server unreachable. Start it with: cd mcp && npm start', 'Serveur injoignable. Lancez-le avec : cd mcp && npm start'))
    }
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.error) throw new Error(data.error || T(`the server answered ${res.status}`, `le serveur a répondu ${res.status}`))
    return data.models
  }

  // Modèles du fournisseur actif choisi dans Options : ceux du serveur, ou ceux du
  // fournisseur testé. Sans choix, ceux du serveur s'il en a. Le modèle du co-pilote
  // se choisit dans Options ; le panneau l'affiche.
  function fillModels() {
    const useServer = settings.active === 'server' || (!settings.active && serverModels.length > 0)
    models = useServer ? serverModels.map((m) => ({ ...m, source: 'server' })) : userModels(settings)
    const has = (id) => id && models.some((m) => m.id === id)
    currentId = has(settings.defaultModel) ? settings.defaultModel : has(serverDefault) ? serverDefault : models[0]?.id || ''
    const model = currentModel()
    toggleModel.textContent = model ? model.label : ''
    toggleModel.hidden = !model
    toggle.classList.toggle('has-model', !!model)
    // Entrées du menu Expert qui passent par le Co-pilote (.copilot-only) : grisées sans modèle.
    document.documentElement.classList.toggle('copilot-ready', !!model)
    // L'icône d'aide à côté de chacune dit pourquoi (index.html, .copilot-help).
    const simulating = document.getElementById('expert-menu')?.classList.contains('simulating')
    for (const entry of document.querySelectorAll('.copilot-only')) entry.disabled = !model || !!simulating
    // En-tête du panneau : « Co-pilote » et le modèle dessous, ou « Co-pilote IA » sans modèle.
    titleName.textContent = model ? T('Co-pilot', 'Co-pilote') : T('AI co-pilot', 'Co-pilote IA')
    titleModel.textContent = model ? model.label : ''
    titleModel.hidden = !model
    titleModel.title = toggle.title
    toggle.title = model ? T('Model: ', 'Modèle : ') + model.label + (model.providerLabel ? ` (${model.providerLabel})` : '') : T('Open or close the AI co-pilot', "Ouvrir ou fermer le co-pilote IA")
    showDestination(model)
  }

  // Bandeau au-dessus du champ : à qui partent le message, les pièces jointes et le diagramme.
  function showDestination(model) {
    destination.hidden = !model
    if (!model) return
    const provider = model.providerLabel || model.label
    const conn = model.source === 'user' ? connectionFor(model, settings) : null
    const local = conn ? isLocalAddress(conn.baseUrl) : !!model.local
    let text
    if (local) {
      text = mode === 'online' || !conn
        ? T(`Stays on your network: ${provider}, model ${model.label}`, `Reste sur votre réseau : ${provider}, modèle ${model.label}`)
        : T(`Relayed by your server to ${provider} on your network, model ${model.label}`, `Relayé par votre serveur vers ${provider} sur votre réseau, modèle ${model.label}`)
    } else if (mode === 'online') {
      text = T(`Sent from your browser to ${provider}, model ${model.label}`, `Envoyé depuis votre navigateur à ${provider}, modèle ${model.label}`)
    } else if (conn) {
      text = T(`Relayed by your server to ${provider}, model ${model.label}`, `Relayé par votre serveur vers ${provider}, modèle ${model.label}`)
    } else {
      text = T(`Sent by your server to ${provider}, model ${model.label}`, `Envoyé par votre serveur à ${provider}, modèle ${model.label}`)
    }
    destination.textContent = text
    destination.classList.toggle('local', local)
    destination.title = T(
      'With each message: your text, the attached files and the current diagram. The review and the automatic correction, when on in Options, send more requests to the same model.',
      'À chaque message : votre texte, les fichiers joints et le diagramme en cours. La critique et l\'autocorrection, si elles sont actives dans Options, envoient des requêtes en plus au même modèle.',
    )
  }
  let serverDefault = null

  // Message d'accueil, ou marche à suivre si aucun modèle n'est disponible.
  function announce() {
    if (!models.length) {
      add(
        'notice',
        mode === 'online'
          ? T('To start, open Options and choose a provider: Anthropic, OpenAI, Mistral, xAI (Grok), Ollama or an OpenAI-compatible server.', 'Pour commencer, ouvrez Options et choisissez un fournisseur : Anthropic, OpenAI, Mistral, xAI (Grok), Ollama ou un serveur compatible OpenAI.')
          : T('Chat is not set up: open Options to choose a provider, or add ANTHROPIC_API_KEY, OPENAI_MODELS or MISTRAL_API_KEY to the server variables (Docker stack or mcp/.env), then restart the server.', "Le chat n'est pas configuré : ouvrez Options pour choisir un fournisseur, ou ajoutez ANTHROPIC_API_KEY, OPENAI_MODELS ou MISTRAL_API_KEY dans les variables du serveur (pile Docker ou mcp/.env), puis relancez le serveur."),
      ).classList.add('setup-hint')
      return
    }
    // Un fournisseur est maintenant réglé : la marche à suivre n'a plus lieu d'être.
    for (const hint of log.querySelectorAll('.setup-hint')) hint.remove()
    if (!log.querySelector('.chat-msg:not(.notice)') && !log.querySelector('.welcome')) {
      add('notice', T('Describe a process and I will draw it on the canvas. Changes can be undone with Ctrl+Z.', `Décrivez un processus et je le dessine sur le canevas. Les modifications s'annulent avec Ctrl+Z.`)).classList.add('welcome')
    }
  }
  function add(kind, text = '') {
    const el = document.createElement('div')
    el.className = `chat-msg ${kind}`
    el.textContent = text
    log.append(el)
    log.scrollTop = log.scrollHeight
    return el
  }

  function setBusy(busy) {
    sendButton.textContent = busy ? T('Stop', 'Arrêter') : T('Send', 'Envoyer')
    input.disabled = busy
  }

  // À l'ouverture : en mode server, demande au serveur ses modèles.
  async function checkServer() {
    checked = true
    if (mode === 'online') {
      fillModels()
      announce()
      return
    }
    try {
      const res = await fetch(chatUrl)
      const status = await res.json()
      serverModels = Array.isArray(status.models) ? status.models : []
      serverDefault = status.model
      fillModels()
      announce()
    } catch {
      checked = false
      fillModels()
      add('notice', T('Server unreachable. Start it with: cd mcp && npm start', 'Serveur injoignable. Lancez-le avec : cd mcp && npm start'))
    }
  }

  // Dès le chargement, le bouton affiche le modèle choisi, sans attendre
  // l'ouverture du panneau (les messages d'accueil viennent à l'ouverture).
  async function showModelEarly() {
    if (mode !== 'online') {
      try {
        const status = await (await fetch(chatUrl)).json()
        if (checked) return
        serverModels = Array.isArray(status.models) ? status.models : []
        serverDefault = status.model
      } catch { return }
    }
    fillModels()
  }
  showModelEarly()

  // Demande toute prête venue d'ailleurs (menu Expert) : le panneau s'ouvre et elle part,
  // sans critique préalable, puisque ce n'est pas une description de processus.
  window.addEventListener(COPILOT_ASK_EVENT, ({ detail }) => {
    if (!panel.classList.contains('open')) toggle.click()
    if (controller) {
      add('notice', T('The co-pilot is still answering: wait for the end of the reply, or stop it.', 'Le Co-pilote répond encore : attendez la fin de la réponse, ou arrêtez-la.'))
      return
    }
    if (!currentModel()) return
    send(String(detail?.text || ''), [], { critique: false })
  })

  toggle.addEventListener('click', () => {
    const open = panel.classList.toggle('open')
    toggle.classList.toggle('active', open)
    if (open) {
      trackOnce('assistant-ouvert')
      if (!checked) checkServer()
      input.focus()
    }
  })

  panel.querySelector('#chat-settings').addEventListener('click', () => options.open(settings, { server: serverModels }))

  panel.querySelector('#chat-reset').addEventListener('click', () => {
    controller?.abort()
    conversation = null
    log.replaceChildren()
    checked = false
    checkServer()
  })

  // Zone de saisie : grandit avec le texte jusqu'à la moitié du panneau.
  const MIN_INPUT = 72
  function fitInput() {
    input.style.height = 'auto'
    const max = Math.max(MIN_INPUT, Math.round(panel.clientHeight * 0.5))
    input.style.height = `${Math.min(Math.max(input.scrollHeight + 2, MIN_INPUT), max)}px`
    input.style.overflowY = input.scrollHeight + 2 > max ? 'auto' : 'hidden'
  }
  input.addEventListener('input', fitInput)

  // Grand éditeur, pour coller ou écrire un long message, ou l'ouvrir depuis un fichier.
  const editor = panel.querySelector('#chat-editor')
  addDialogClose(editor)
  const editorText = panel.querySelector('#chat-editor-text')
  const editorFile = panel.querySelector('#chat-editor-input')
  const editorCount = panel.querySelector('.chat-editor-count')
  const countChars = () => {
    const n = editorText.value.length
    editorCount.textContent = n
      ? T(`${num(n)} character${n > 1 ? 's' : ''}`, `${num(n)} caractère${n > 1 ? 's' : ''}`) +
        (n > MAX_MESSAGE ? T(`: too long, ${num(MAX_MESSAGE)} at most`, ` : trop long, ${num(MAX_MESSAGE)} au plus`) : '')
      : ''
    editorCount.classList.toggle('too-long', n > MAX_MESSAGE)
  }
  panel.querySelector('#chat-expand').addEventListener('click', () => {
    editorText.value = input.value
    countChars()
    editor.showModal()
    editorText.focus()
    editorText.setSelectionRange(editorText.value.length, editorText.value.length)
  })
  editorText.addEventListener('input', countChars)
  editorText.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      editor.close('send')
    }
  })
  panel.querySelector('#chat-editor-file').addEventListener('click', () => editorFile.click())
  editorFile.addEventListener('change', async () => {
    const file = editorFile.files[0]
    editorFile.value = ''
    if (!file) return
    if (!textFileKind(file)) {
      editorCount.textContent = T('Unsupported file type.', 'Type de fichier non pris en charge.')
      return
    }
    if (textFileKind(file) === 'text' && file.size > MAX_MESSAGE * 4) {
      editorCount.textContent = T('File too large.', 'Fichier trop volumineux.')
      return
    }
    let text
    try {
      text = await fileToText(file)
    } catch (err) {
      editorCount.textContent = T(`${file.name}: ${err.message}`, `${file.name} : ${readError(err)}`)
      return
    }
    const { selectionStart: a, selectionEnd: b, value } = editorText
    editorText.value = value.slice(0, a) + text + value.slice(b)
    countChars()
    editorText.focus()
  })
  editor.addEventListener('close', () => {
    input.value = editorText.value
    fitInput()
    if (editor.returnValue === 'send' && !input.disabled) form.requestSubmit()
    else input.focus()
  })

  // ── Pièces jointes : images, PDF et fichiers lus comme du texte ───────────
  // { kind: 'image' | 'pdf', mediaType, name, data, size, url } ou { kind: 'text', name, text, size }
  let pending = []
  const attachBox = panel.querySelector('#chat-attachments')
  const attachInput = panel.querySelector('#chat-attach-input')

  function attachmentChip(a, onRemove) {
    const chip = document.createElement('div')
    chip.className = 'chat-file'
    chip.title = `${a.name} (${sizeText(a.size)})`
    if (a.kind === 'image') {
      const img = document.createElement('img')
      img.src = a.url
      img.alt = ''
      chip.append(img)
    } else {
      const icon = document.createElement('span')
      icon.className = 'chat-file-pdf'
      icon.innerHTML = a.kind === 'text' ? DOC_ICON : PDF_ICON
      chip.append(icon)
    }
    const label = document.createElement('span')
    label.className = 'chat-file-name'
    label.textContent = a.name
    chip.append(label)
    if (onRemove) {
      const remove = document.createElement('button')
      remove.type = 'button'
      remove.className = 'chat-file-remove'
      remove.textContent = '×'
      remove.title = T('Remove', 'Retirer')
      remove.setAttribute('aria-label', T(`Remove ${a.name}`, `Retirer ${a.name}`))
      remove.addEventListener('click', onRemove)
      chip.append(remove)
    }
    return chip
  }

  function renderAttachments() {
    attachBox.replaceChildren(
      ...pending.map((a, i) =>
        attachmentChip(a, () => {
          pending.splice(i, 1)
          renderAttachments()
          input.focus()
        }),
      ),
    )
    attachBox.hidden = !pending.length
  }

  const textLength = () => withTextFiles('', pending.filter((a) => a.kind === 'text')).length

  async function addFiles(files) {
    for (const file of files) {
      const isPdf = file.type === PDF_TYPE || /\.pdf$/i.test(file.name)
      const isImage = file.type.startsWith('image/')
      const textKind = !isPdf && !isImage ? textFileKind(file) : null
      const name = file.name || (isPdf ? 'document.pdf' : isImage ? T('pasted image', 'image collée') : 'file')
      if (!isPdf && !isImage && !textKind) {
        add('error', T(`${name}: this type of file cannot be attached. Accepted: images, PDF, Word, Excel, PowerPoint, OpenDocument, and text files (TXT, Markdown, CSV, JSON, XML, BPMN, HTML, YAML…).`,
          `${name} : ce type de fichier ne peut pas être joint. Acceptés : images, PDF, Word, Excel, PowerPoint, OpenDocument, et fichiers texte (TXT, Markdown, CSV, JSON, XML, BPMN, HTML, YAML…).`))
        continue
      }
      if (pending.length >= MAX_ATTACHMENTS) {
        add('error', T(`${MAX_ATTACHMENTS} files at most per message.`, `${MAX_ATTACHMENTS} fichiers au plus par message.`))
        break
      }
      if (textKind) {
        if (textKind === 'text' && file.size > MAX_MESSAGE * 4) {
          add('error', T(`${name} is too large: ${num(MAX_MESSAGE)} characters at most per message.`, `${name} est trop volumineux : ${num(MAX_MESSAGE)} caractères au plus par message.`))
          continue
        }
        try {
          const text = await fileToText(file)
          if (!text) {
            add('error', T(`${name}: no text found in this file.`, `${name} : aucun texte trouvé dans ce fichier.`))
            continue
          }
          if (text.length + textLength() > MAX_MESSAGE) {
            add('error', T(`${name} is too long: ${num(MAX_MESSAGE)} characters at most per message, files included.`, `${name} est trop long : ${num(MAX_MESSAGE)} caractères au plus par message, fichiers compris.`))
            continue
          }
          pending.push({ kind: 'text', name, text, size: file.size })
        } catch (err) {
          add('error', T(`${name}: ${err.message}`, `${name} : ${readError(err)}`))
        }
        continue
      }
      try {
        const blob = isPdf ? file : await prepareImage(file)
        const max = isPdf ? MAX_PDF_BYTES : MAX_IMAGE_BYTES
        if (blob.size > max) {
          add('error', T(`${name} is too large: ${sizeText(max)} at most.`, `${name} est trop volumineux : ${sizeText(max)} au plus.`))
          continue
        }
        const total = pending.reduce((n, a) => n + (a.kind === 'text' ? 0 : a.size), 0) + blob.size
        if (total > MAX_TOTAL_BYTES) {
          add('error', T(`Attached files: ${sizeText(MAX_TOTAL_BYTES)} at most per message.`, `Fichiers joints : ${sizeText(MAX_TOTAL_BYTES)} au plus par message.`))
          continue
        }
        pending.push({
          kind: isPdf ? 'pdf' : 'image',
          mediaType: isPdf ? PDF_TYPE : blob.type,
          name,
          data: await blobToBase64(blob),
          size: blob.size,
          url: isPdf ? null : URL.createObjectURL(blob),
        })
      } catch (err) {
        add('error', T(`${name}: ${err.message}`, `${name} : ${err.message}`))
      }
    }
    renderAttachments()
  }

  panel.querySelector('#chat-attach').addEventListener('click', () => attachInput.click())
  attachInput.addEventListener('change', () => {
    const files = [...attachInput.files]
    attachInput.value = ''
    addFiles(files).then(() => input.focus())
  })
  // Coller une image (capture d'écran…) ou un fichier dans la zone de saisie.
  input.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])]
    if (!files.length) return
    e.preventDefault()
    addFiles(files)
  })
  // Glisser sur le panneau : le fichier est joint au message, il n'ouvre pas de diagramme.
  const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files')
  for (const type of ['dragenter', 'dragover']) {
    panel.addEventListener(type, (e) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      e.stopPropagation()
      document.body.classList.remove('drop-target')
      panel.classList.add('drop-files')
    })
  }
  panel.addEventListener('dragleave', (e) => {
    if (!panel.contains(e.relatedTarget)) panel.classList.remove('drop-files')
  })
  panel.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.stopPropagation()
    panel.classList.remove('drop-files')
    addFiles([...e.dataTransfer.files])
  })

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault()
      form.requestSubmit()
    }
  })

  const micButton = panel.querySelector('#chat-mic')
  const voice = micButton && setupVoiceInput({
    button: micButton,
    input,
    interim: panel.querySelector('#chat-voice-interim'),
    notify: add,
    onText: fitInput,
    meter: panel.querySelector('#chat-voice-meter'),
  })
  if (micButton) panel.classList.add('has-mic')

  form.addEventListener('submit', (e) => {
    e.preventDefault()
    if (controller) {
      controller.abort()
      return
    }
    let text = input.value.trim()
    if (!text && !pending.length) return
    if (!text) text = T('Draw the process shown in the attached file.', 'Dessine le processus du fichier joint.')
    if (text.length + textLength() > MAX_MESSAGE) {
      add('error', T(`Message too long: ${num(MAX_MESSAGE)} characters at most, attached text files included.`, `Message trop long : ${num(MAX_MESSAGE)} caractères au plus, fichiers texte joints compris.`))
      return
    }
    if (!currentModel()) {
      add('error', T('No model available: open Options to set up a provider.', 'Aucun modèle disponible : ouvrez Options pour régler un fournisseur.'))
      return
    }
    if (mode !== 'online' && !bridge.tabId) {
      add('error', T('The editor is not connected to the server (MCP badge offline).', "L'éditeur n'est pas relié au serveur (badge MCP hors ligne)."))
      return
    }
    const attachments = pending.slice()
    const model = currentModel()
    const caps = model.source === 'user' ? { format: model.format, providerId: model.providerId } : { format: model.provider === 'anthropic' ? 'anthropic' : 'openai', providerId: model.providerId || model.provider }
    if (attachments.some((a) => !supports(caps, a.kind))) {
      add('error', T(`${model.providerLabel || model.label} cannot read PDF files. Use an Anthropic, OpenAI or Mistral model, or paste the text of the document.`,
        `${model.providerLabel || model.label} ne sait pas lire les PDF. Utilisez un modèle Anthropic, OpenAI ou Mistral, ou collez le texte du document.`))
      return
    }
    // xAI n'accepte que les images PNG et JPEG.
    if (caps.providerId === 'xai' && attachments.some((a) => a.kind === 'image' && a.mediaType !== 'image/png' && a.mediaType !== 'image/jpeg')) {
      add('error', T(`${model.providerLabel || model.label} only reads PNG and JPEG images. Convert the image, or take a screenshot of it.`,
        `${model.providerLabel || model.label} ne lit que les images PNG et JPEG. Convertissez l'image, ou faites-en une capture d'écran.`))
      return
    }
    voice?.stop()
    input.value = ''
    fitInput()
    pending = []
    renderAttachments()
    send(text, attachments)
  })

  // Mesure d'usage (version en ligne) : nombre de messages et d'appels d'outils de la
  // session, envoyés en une fois à la fermeture de la page. Jamais le texte ni les fichiers.
  const usage = { messages: 0, tools: 0 }
  onPageHide(() => { if (usage.messages) track('copilote-bilan', { messages: range(usage.messages), outils: range(usage.tools) }) })
  const fileType = (a) => (a.kind === 'text' ? (/\.([a-z0-9]{1,5})$/i.exec(a.name || '')?.[1] || 'texte').toLowerCase() : a.kind)

  // rewind : relance de la dernière demande, qui remplace son échange dans l'historique.
  async function send(text, attachments = [], { rewind = false, critique = true } = {}) {
    trackOnce('assistant-utilise')
    usage.messages++
    for (const type of new Set(attachments.map(fileType))) track('assistant-piece-jointe', { type })
    // Chaque réponse ne marque que ce qu'elle a changé.
    newAiRound()
    // Seule la dernière réponse se relance.
    for (const button of log.querySelectorAll('.chat-retry')) button.remove()
    const userMsg = add('user', text)
    if (attachments.length) {
      const strip = document.createElement('div')
      strip.className = 'chat-msg-files'
      for (const a of attachments) strip.append(attachmentChip(a))
      userMsg.prepend(strip)
    }
    const reply = add('assistant')
    reply.hidden = true // affichée au premier texte ou au premier outil
    let tools = null
    let replyBody = null
    let replyText = ''
    let gotText = false
    let toolSinceText = false
    let failed = false
    let errorText = ''
    let report = null
    const assist = settings.assist !== false ? { critique, autocorrect: true } : {}
    controller = new AbortController()
    setBusy(true)

    // Ligne d'état sous la réponse : ce que fait le co-pilote et depuis combien de temps.
    const status = document.createElement('div')
    status.className = 'chat-status'
    let statusText = T('sending', 'envoi')
    const started = Date.now()
    const renderStatus = () => {
      status.textContent = `⏳ ${statusText}… ${Math.round((Date.now() - started) / 1000)} s`
    }
    renderStatus()
    log.append(status)
    const timer = setInterval(renderStatus, 1000)

    const model = currentModel()
    setChatModel(model?.label)
    const handle = (event) => {
      if (event.type === 'text') statusText = T('writing', 'rédige')
      if (event.type === 'conversation') {
        conversation = { kind: kindOf(model), id: event.id }
      } else if (event.type === 'text') {
        reply.hidden = false
        // Un paragraphe par étape : le texte qui suit des appels d'outils repart à la ligne.
        replyText += (toolSinceText && replyText ? '\n\n' : '') + event.text
        gotText = true
        toolSinceText = false
        // Le texte (Markdown rendu, src/ai/markdown.js) se place avant la ligne des outils.
        if (!replyBody) {
          replyBody = document.createElement('div')
          replyBody.className = 'chat-md'
          if (tools) reply.insertBefore(replyBody, tools)
          else reply.append(replyBody)
        }
        renderMarkdownInto(replyBody, replyText)
      } else if (event.type === 'tool') {
        usage.tools++
        reply.hidden = false
        gotText = true
        if (!tools) {
          tools = document.createElement('div')
          tools.className = 'chat-tools'
          reply.append(tools)
        }
        toolSinceText = true
        const chip = document.createElement('span')
        chip.textContent = `${event.ok ? '✓' : '✗'} ${TOOL_LABELS[event.name] || event.name}`
        chip.title = event.error || event.name
        if (!event.ok) chip.classList.add('failed')
        tools.append(chip)
      } else if (event.type === 'critique') {
        reply.hidden = false
        gotText = true
        reply.prepend(critiqueBox(event))
      } else if (event.type === 'report') {
        report = event
      } else if (event.type === 'status') {
        const label = TOOL_LABELS[event.tool] || event.tool
        if (event.phase === 'critique') statusText = T('reviewing the request', 'relecture de la demande')
        else if (event.phase === 'correcting') statusText = T(`automatic correction, round ${event.round}`, `autocorrection, tour ${event.round}`)
        else if (event.phase === 'waiting')
          statusText = event.step ? T('the model is reading the tool results', 'le modèle lit le résultat des outils') : T('the model is reading the request', 'le modèle lit la demande')
        else if (event.phase === 'thinking') statusText = T('thinking', 'réflexion')
        else if (event.phase === 'preparing')
          statusText = T(`preparing: ${label}`, `prépare : ${label}`) + (event.size ? ` (${(event.size / 1024).toFixed(1)} ${T('KB', 'Ko')})` : '')
        else if (event.phase === 'running') statusText = T(`running: ${label}`, `exécute : ${label}`)
        renderStatus()
      } else if (event.type === 'error') {
        failed = true
        errorText = event.message || ''
        add('error', event.message)
      }
      log.scrollTop = log.scrollHeight
    }

    const conn = model.source === 'user' ? connectionFor(model, settings) : null
    const files = attachments.filter((a) => a.kind !== 'text')
    try {
      // Les fichiers lus comme du texte partent dans le message, les autres en pièces jointes.
      const fullText = withTextFiles(text, attachments.filter((a) => a.kind === 'text'))
      const payload = files.map(({ kind, mediaType, name, data }) => ({ kind, mediaType, name, data }))
      const request = { conn, model, text: fullText, attachments: payload, handle, signal: controller.signal, assist, rewind }
      if (mode === 'online') await sendLocal(request)
      else await sendServer(request)
    } catch (err) {
      failed = true
      errorText = err?.message || ''
      if (!controller.signal.aborted) {
        // Classe d'erreur seulement : code HTTP par centaines, ou pas de réponse du serveur.
        const status = Number(err?.status)
        const classe = status === 401 || status === 403 || status === 429 ? String(status) : status >= 500 ? '5xx' : status >= 400 ? '4xx' : 'reseau'
        track('assistant-erreur', { fournisseur: conn?.provider || 'serveur', classe })
      }
      if (controller.signal.aborted) add('notice', T('Reply stopped.', 'Réponse interrompue.'))
      // Application ouverte hors connexion : l'éditeur marche, le fournisseur est hors de portée.
      else if (navigator.onLine === false) add('error', T(
        'You are offline. The AI co-pilot needs a connection to reach its provider. The editor itself still works.',
        "Vous êtes hors connexion. Le Co-pilote IA a besoin du réseau pour joindre son fournisseur. L'éditeur, lui, reste utilisable.",
      ))
      else if (err?.streamCut) add('error', err.message)
      else if (conn && mode === 'online') add('error', describeProviderError(err, { label: conn.label, providerId: conn.provider, browser: true, origin: location.origin, lang }))
      else add('error', T(`Sending failed: ${err.message}`, `Échec de l'envoi : ${err.message}`))
    } finally {
      clearInterval(timer)
      status.remove()
      if (!gotText) reply.remove()
      else {
        if (report) reply.append(reportBox(report))
        reply.append(traceLine({ model, started, text, attachments }))
        if (!controller.signal.aborted) reply.append(retryButton({ userMsg, text, attachments }))
      }
      // Conseil général, sauf chez Claude (lit images et PDF) et quand l'erreur dit déjà la cause.
      const explained = /cannot read|ne sait pas lire|limits|limites|file format|format de fichier/i.test(errorText)
      if (failed && files.length && !controller.signal.aborted && !kindOf(model).endsWith(':anthropic') && !explained)
        add('notice', T('If the error is about the attached files, this model may not read images or PDF files: try another model.', "Si l'erreur porte sur les fichiers joints, ce modèle ne sait peut-être pas lire les images ou les PDF : essayez un autre modèle."))
      if (!gotText && !failed) add('notice', T('The model gave no answer. Check that it supports tool calls, or try another model.', "Le modèle n'a rien répondu. Vérifiez qu'il sait appeler des outils, ou essayez un autre modèle."))
      controller = null
      setChatModel('')
      setBusy(false)
      input.focus()
    }
  }

  // ── Sous chaque réponse : critique, rapport de contrôle, traçabilité, relance ──

  const SEVERITY = {
    blocking: T('Blocking', 'Bloquant'),
    major: T('Important', 'Important'),
    minor: T('Minor', 'Mineur'),
  }

  function critiqueBox({ issues, failed: unreadable }) {
    if (!issues.length) {
      const line = document.createElement('div')
      line.className = 'chat-critique none'
      line.textContent =
        unreadable === 'error'
          ? T('Review of the request unavailable: the call to the model failed.', "Critique de la demande indisponible : l'appel au modèle a échoué.")
          : unreadable
            ? T('Review of the request unavailable: the model gave no readable list.', "Critique de la demande indisponible : le modèle n'a pas rendu de liste lisible.")
            : T('Request reviewed: nothing to clarify.', 'Demande relue : rien à clarifier.')
      return line
    }
    const box = document.createElement('details')
    box.className = 'chat-critique'
    box.open = true
    const summary = document.createElement('summary')
    const blocking = issues.filter((i) => i.severity === 'blocking').length
    summary.textContent = T(`Points to clarify (${issues.length})`, `Points à clarifier (${issues.length})`) + (blocking ? T(`, ${blocking} blocking`, `, dont ${blocking} bloquant${blocking > 1 ? 's' : ''}`) : '')
    const list = document.createElement('ul')
    for (const issue of issues) {
      const li = document.createElement('li')
      const badge = document.createElement('span')
      badge.className = `chat-sev ${issue.severity}`
      badge.textContent = SEVERITY[issue.severity]
      li.append(badge, document.createTextNode(issue.question))
      if (issue.quote) {
        const quote = document.createElement('q')
        quote.textContent = issue.quote
        li.append(quote)
      }
      list.append(li)
    }
    const hint = document.createElement('p')
    hint.className = 'chat-critique-hint'
    hint.textContent = T('The diagram is drawn with assumptions, listed at the end of the reply. Answer in your next message to refine it.', 'Le diagramme est dessiné avec des hypothèses, données en fin de réponse. Répondez dans le message suivant pour l\'affiner.')
    box.append(summary, list, hint)
    return box
  }

  const CHECK_LABELS = {
    xml: T('Well-formed XML', 'XML bien formé'),
    metamodel: T('Conforms to the BPMN 2.0 metamodel', 'Conforme au métamodèle BPMN 2.0'),
    references: T('References and scopes', 'Références et portées'),
    di: T('Every element drawn (DI)', 'Chaque élément dessiné (DI)'),
    reimport: T('Reimported by bpmn-js', 'Réimport par bpmn-js'),
    lint: T('bpmnlint rules', 'Règles bpmnlint'),
  }
  const COUNT_LABELS = [
    ['pools', T('pool', 'pool'), T('pools', 'pools')],
    ['lanes', T('lane', 'couloir'), T('lanes', 'couloirs')],
    ['activities', T('activity', 'activité'), T('activities', 'activités')],
    ['gateways', T('gateway', 'passerelle'), T('gateways', 'passerelles')],
    ['events', T('event', 'événement'), T('events', 'événements')],
    ['sequenceFlows', T('sequence flow', 'flux de séquence'), T('sequence flows', 'flux de séquence')],
    ['messageFlows', T('message flow', 'flux de messages'), T('message flows', 'flux de messages')],
    ['dataObjects', T('data object', 'donnée'), T('data objects', 'données')],
    ['annotations', T('annotation', 'annotation'), T('annotations', 'annotations')],
  ]

  function reportBox({ report: r, corrections }) {
    const checks = r.checks || []
    const passed = checks.filter((c) => c.ok).length
    const box = document.createElement('details')
    box.className = 'chat-report' + (passed < checks.length ? ' fail' : '')
    const summary = document.createElement('summary')
    const parts = [
      passed === checks.length
        ? T(`${passed}/${checks.length} checks passed`, `${passed}/${checks.length} contrôles réussis`)
        : T(`${checks.length - passed} of ${checks.length} checks failed`, `${checks.length - passed} contrôle${checks.length - passed > 1 ? 's' : ''} sur ${checks.length} en échec`),
    ]
    if (corrections?.asked) {
      parts.push(T(
        `${corrections.asked} correction${corrections.asked > 1 ? 's' : ''} requested, ${corrections.kept} kept`,
        `${corrections.asked} correction${corrections.asked > 1 ? 's' : ''} demandée${corrections.asked > 1 ? 's' : ''}, ${corrections.kept} retenue${corrections.kept > 1 ? 's' : ''}`,
      ))
      // Une correction non retenue a été défaite : le texte de la réponse peut encore en parler.
      if (corrections.kept < corrections.asked) parts.push(T('the last one did not reduce the problems and was undone', "la dernière ne réduisait pas les problèmes et a été annulée"))
    }
    summary.textContent = `${passed === checks.length ? '✓' : '✗'} ${parts.join(' · ')}`
    box.append(summary)

    const counts = COUNT_LABELS.filter(([key]) => r.counts?.[key]).map(([key, one, many]) => `${num(r.counts[key])} ${r.counts[key] > 1 ? many : one}`)
    if (r.warnings) counts.push(T(`${num(r.warnings)} bpmnlint warning${r.warnings > 1 ? 's' : ''}`, `${num(r.warnings)} avertissement${r.warnings > 1 ? 's' : ''} bpmnlint`))
    if (counts.length) {
      const line = document.createElement('p')
      line.className = 'chat-report-counts'
      line.textContent = counts.join(' · ')
      box.append(line)
    }
    const names = new Map((r.issues || []).filter((i) => i.name).map((i) => [i.id, i.name]))
    const list = document.createElement('ul')
    for (const c of checks) {
      const li = document.createElement('li')
      li.className = c.ok ? 'ok' : 'fail'
      li.textContent = `${c.ok ? '✓' : '✗'} ${CHECK_LABELS[c.check] || c.check}`
      if (!c.ok) {
        const problems = document.createElement('ul')
        for (const p of (c.problems || []).slice(0, 8)) {
          const item = document.createElement('li')
          const who = p.id ? names.get(p.id) || p.id : ''
          item.textContent = who ? `${who} : ${p.message}` : p.message
          problems.append(item)
        }
        const more = (c.problems?.length || 0) - 8 + (c.more || 0)
        if (more > 0) {
          const item = document.createElement('li')
          item.textContent = T(`and ${more} more`, `et ${more} de plus`)
          problems.append(item)
        }
        li.append(problems)
      }
      list.append(li)
    }
    box.append(list)
    return box
  }

  function traceLine({ model, started, text, attachments }) {
    const line = document.createElement('div')
    line.className = 'chat-trace'
    const seconds = Math.max(1, Math.round((Date.now() - started) / 1000))
    const when = new Date(started).toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' })
    const source = [T(`message of ${num(text.length)} characters`, `message de ${num(text.length)} caractères`)]
    if (attachments.length) source.push(attachments.map((a) => a.name).join(', '))
    line.textContent = [model.providerLabel, model.label, T(`${seconds} s`, `${seconds} s`), when].filter(Boolean).join(' · ')
    const src = document.createElement('div')
    src.textContent = T('Source: ', 'Source : ') + source.join(T(', files: ', ', fichiers : '))
    line.append(src)
    return line
  }

  function retryButton({ userMsg, text, attachments }) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'btn chat-retry'
    button.textContent = T('Retry from the same source', 'Relancer depuis la même source')
    button.title = T(
      'Puts the diagram back as it was before this reply, then sends the same request again, to the model chosen now.',
      "Remet le diagramme dans l'état d'avant cette réponse, puis renvoie la même demande, au modèle choisi maintenant.",
    )
    button.addEventListener('click', async () => {
      if (controller) return
      const undone = await undoAiRound()
      if (undone === 'cancelled') return
      // L'échange relancé quitte le fil : la nouvelle réponse le remplace.
      while (userMsg.nextSibling) userMsg.nextSibling.remove()
      userMsg.remove()
      send(text, attachments, { rewind: true })
    })
    return button
  }

  // Version docker : le serveur fait la boucle et renvoie un flux SSE.
  async function sendServer({ conn, model, text, attachments, handle, signal, assist, rewind }) {
    const body = { conversationId: conversation?.id, tabId: bridge.tabId, text, lang, assist, ...(rewind ? { rewind: true } : {}), ...(attachments.length ? { attachments } : {}) }
    if (conn) body.custom = conn
    else body.model = model.id
    // Type propre au chat : le serveur le lit avec une limite assez grande pour les pièces jointes.
    const res = await fetch(chatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/vnd.bpmn-chat+json' },
      body: JSON.stringify(body),
      signal,
    })
    if (res.status === 413) throw new Error(T('the attached files are too large for the server', 'les fichiers joints sont trop volumineux pour le serveur'))
    if (!res.ok) throw new Error(T(`the server answered ${res.status}`, `le serveur a répondu ${res.status}`))
    // Flux SSE : des blocs « data: {json} » séparés par une ligne vide. Les blocs qui commencent
    // par « : » sont le signal de vie du serveur, sans contenu.
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
    const opened = Date.now()
    let buffer = ''
    let finished = false // « done » ou « error » reçu : le serveur a fermé le tour lui-même
    for (;;) {
      let chunk
      try {
        chunk = await reader.read()
      } catch (err) {
        if (signal.aborted) throw err
        throw streamCut(opened)
      }
      if (chunk.done) break
      buffer += chunk.value
      let cut
      while ((cut = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, cut)
        buffer = buffer.slice(cut + 2)
        if (block.startsWith(':')) continue
        const data = block.replace(/^data: /, '')
        let event
        try {
          event = JSON.parse(data)
        } catch (err) {
          console.warn('[chat] événement illisible :', data, err)
          continue
        }
        if (event.type === 'done' || event.type === 'error') finished = true
        handle(event)
      }
    }
    if (!finished && !signal.aborted) throw streamCut(opened)
  }

  // Connexion au serveur coupée en plein tour : un message qui dit quand et pourquoi, plutôt que
  // « network error ».
  function streamCut(opened) {
    const s = Math.round((Date.now() - opened) / 1000)
    const after = s < 120 ? `${s} s` : `${Math.round(s / 60)} min`
    const err = new Error(T(
      `The connection to the server was cut after ${after}, before the reply was complete. A proxy may have closed it, or the server stopped. If the model is slow on this machine, try a lighter one.`,
      `La connexion au serveur a été coupée au bout de ${after}, avant la fin de la réponse. Un proxy a pu la fermer, ou le serveur s'est arrêté. Si le modèle est lent sur cette machine, essayez-en un plus léger.`,
    ))
    err.streamCut = true
    return err
  }

  // Version en ligne : la boucle tourne ici, les outils agissent sur cette page.
  async function sendLocal({ conn, model, text, attachments, handle, signal, assist, rewind }) {
    const engine = await loadEngine()
    const kind = kindOf(model)
    if (!conversation || conversation.kind !== kind || !conversation.messages) conversation = { kind, messages: [] }
    const conv = conversation
    if (rewind) engine.rewindTurn(conv)
    const common = {
      model: conn.model,
      conv,
      text,
      attachments,
      toolSet: engine.toolSet,
      executeTool: async (name, args) => {
        const tool = tools[name]
        if (!tool) throw new Error(`Unknown tool: ${name}`)
        return tool(args)
      },
      emit: handle,
      signal,
      log: (...args) => console.warn(...args),
      lang,
      assist,
    }
    if (conn.format === 'anthropic') {
      // Le SDK 1.12 enverrait la clé dans « Authorization: Bearer », que l'API refuse
      // dans certains cas (« x-api-key header is required ») : on la passe en x-api-key.
      const client = new engine.Anthropic({ apiKey: null, authToken: null, baseURL: conn.baseUrl, dangerouslyAllowBrowser: true, ...(conn.apiKey ? { defaultHeaders: { 'x-api-key': conn.apiKey } } : {}) })
      await engine.runAnthropicTurn({ ...common, client, APIError: engine.Anthropic.APIError })
    } else {
      const client = new engine.OpenAICompatClient({ baseUrl: conn.baseUrl, apiKey: conn.apiKey })
      await engine.runOpenAITurn({ ...common, client, providerId: conn.provider })
    }
  }
}

// Chargé au premier message seulement : le SDK et zod ne pèsent rien avant.
let enginePromise = null
function loadEngine() {
  enginePromise ??= Promise.all([
    import('@anthropic-ai/sdk'),
    import('zod/v4'),
    import('./ai/chat-loop.js'),
    import('./ai/openai-compat.js'),
  ]).then(([{ default: Anthropic }, z, loop, { OpenAICompatClient }]) => ({
    Anthropic,
    OpenAICompatClient,
    runAnthropicTurn: loop.runAnthropicTurn,
    runOpenAITurn: loop.runOpenAITurn,
    rewindTurn: loop.rewindTurn,
    toolSet: loop.createToolSet(z),
  }))
  enginePromise.catch(() => (enginePromise = null))
  return enginePromise
}
