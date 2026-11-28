// Fenêtre de documentation d'un élément : la grande fenêtre du panneau de propriétés
// (bouton « Ouvrir l'éditeur en grand » du champ Documentation), enrichie.
//
//   - Markdown, avec trois vues : Écrire, Côte à côte, Aperçu (la dernière choisie est
//     retenue). Le texte reste dans le champ Documentation standard, au format texte, pour
//     que les autres outils BPMN le lisent (src/doc/documentation.js) ;
//   - barre de mise en forme (gras, italique, titre, listes, lien) et raccourcis Ctrl+B,
//     Ctrl+I, Ctrl+K ;
//   - modèles par sorte d'élément (src/doc/templates.js) ;
//   - dictée, avec la reconnaissance vocale sur l'appareil du Co-pilote (src/voice-input.js) ;
//   - « Rédiger avec le Co-pilote » : une demande toute prête part dans le chat, et ce
//     qu'il écrit apparaît aussitôt dans la fenêtre.
//
// La fenêtre s'ouvre aussi sans passer par le panneau (pastilles du canevas, src/doc/
// doc-badges.js) : open(element) émet le même événement que le panneau, avec un
// enregistrement direct dans le modèle.

import { T } from '../i18n/lang.js'
import { markdownToHtml } from './markdown.js'
import { TEMPLATES, templateFor, templateText, withoutEmptyTemplate } from './templates.js'
import { docText, setDocText } from './documentation.js'
import { MIC_ICON, setupVoiceInput, voiceSupported } from '../voice-input.js'
// Icônes des listes : trois lignes précédées de puces, ou de 1, 2, 3.
const SVG = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`
const BULLET_ICON = SVG('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.5" cy="18" r="1.2" fill="currentColor" stroke="none"/>')
const NUMBER_ICON = SVG('<path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 4.5l1.3-.8V8M3.6 10.6a1.3 1.3 0 0 1 2.5.4c0 .9-2.5 2.2-2.5 3h2.6M3.7 16.4h2.2l-1.2 1.5a1.2 1.2 0 1 1-1.1 1.7" stroke-width="1.3"/>')

const DOC_ENTRIES = new Set(['documentation', 'processDocumentation'])
const VIEW_KEY = 'bpmn-editor-doc-view'
const VIEWS = ['write', 'split', 'preview']
// Même événement que src/chat-panel.js (chargé à part) : la demande part dans le chat.
const COPILOT_ASK_EVENT = 'bpmn-pilot-copilot-ask'

function savedView() {
  try {
    const v = localStorage.getItem(VIEW_KEY)
    if (VIEWS.includes(v)) return v
  } catch {}
  return window.innerWidth < 760 ? 'write' : 'split'
}

export function setupDocEditor(modeler) {
  const eventBus = modeler.get('eventBus')
  const bpmnFactory = modeler.get('bpmnFactory')
  const commandStack = modeler.get('commandStack')
  const selection = modeler.get('selection')
  let pending = null // dernière ouverture demandée : { element, entryId, onInput }
  let current = null // fenêtre ouverte : { element, bo, textarea, render, stop }

  // Avant la fenêtre du panneau : on retient l'élément et on agrandit la fenêtre.
  eventBus.on('propertiesPanel.openPopup', 2000, (_event, context) => {
    if (!context || !DOC_ENTRIES.has(context.entryId)) { pending = null; return }
    pending = { element: context.element, entryId: context.entryId }
    context.width = Math.max(360, Math.min(1000, window.innerWidth - 32))
    context.height = Math.max(320, Math.min(620, window.innerHeight - 32))
  })

  eventBus.on('feelPopup.opened', ({ domNode }) => {
    const popup = domNode?.querySelector('.bio-properties-panel-popup')
    const textarea = popup?.querySelector('textarea')
    if (!pending || !textarea) return
    const { element, entryId } = pending
    pending = null
    const bo = entryId === 'processDocumentation' ? element.businessObject.processRef : element.businessObject
    enhance(popup, textarea, element, bo)
  })

  eventBus.on('feelPopup.close', () => {
    current?.stop()
    current = null
  })

  // Le Co-pilote (ou Annuler) change la documentation pendant que la fenêtre est ouverte :
  // le texte suit, sauf si l'utilisateur est en train d'écrire.
  eventBus.on('elements.changed', ({ elements }) => {
    if (!current || !elements.includes(current.element)) return
    const text = docText(current.bo)
    const { textarea } = current
    if (text === textarea.value || text.trim() === textarea.value.trim()) return
    if (document.activeElement === textarea && Date.now() - current.typedAt < 1500) return
    textarea.value = text
    current.render()
  })

  function enhance(popup, textarea, element, bo) {
    popup.classList.add('doc-editor')
    const body = popup.querySelector('.bio-properties-panel-popup__body')
    const header = popup.querySelector('.bio-properties-panel-popup__header')
    textarea.placeholder = T(
      'Describe this element. Markdown is welcome: ## Heading, **bold**, *italic*, - list, [link](https://…)',
      'Décrivez cet élément. Le Markdown est accepté : ## Titre, **gras**, *italique*, - liste, [lien](https://…)')
    textarea.spellcheck = true

    // ── En-tête : les trois vues ──
    const tabs = document.createElement('div')
    tabs.className = 'doc-views'
    tabs.setAttribute('role', 'tablist')
    tabs.innerHTML = [
      ['write', T('Write', 'Écrire')],
      ['split', T('Side by side', 'Côte à côte')],
      ['preview', T('Preview', 'Aperçu')],
    ].map(([v, label]) => `<button type="button" class="doc-view" role="tab" data-view="${v}">${label}</button>`).join('')
    header.querySelector('.bio-properties-panel-popup__close')?.before(tabs)

    // ── Barre d'outils ──
    const bar = document.createElement('div')
    bar.className = 'doc-toolbar'
    bar.setAttribute('role', 'toolbar')
    bar.innerHTML = `
      <button type="button" class="btn doc-fmt" data-fmt="bold" title="${T('Bold (Ctrl+B)', 'Gras (Ctrl+B)')}" aria-label="${T('Bold', 'Gras')}"><b>${T('B', 'G')}</b></button>
      <button type="button" class="btn doc-fmt" data-fmt="italic" title="${T('Italic (Ctrl+I)', 'Italique (Ctrl+I)')}" aria-label="${T('Italic', 'Italique')}"><i>I</i></button>
      <span class="doc-template-wrap doc-heading-wrap">
        <button type="button" class="btn doc-heading-btn" aria-haspopup="menu" aria-expanded="false" title="${T('Heading level', 'Niveau de titre')}" aria-label="${T('Heading level', 'Niveau de titre')}">H ▾</button>
        <div class="doc-template-menu doc-heading-menu" role="menu" hidden>
          <button type="button" role="menuitem" data-fmt="h1" class="h1">${T('Heading 1', 'Titre 1')}</button>
          <button type="button" role="menuitem" data-fmt="h2" class="h2">${T('Heading 2', 'Titre 2')}</button>
          <button type="button" role="menuitem" data-fmt="h3" class="h3">${T('Heading 3', 'Titre 3')}</button>
          <button type="button" role="menuitem" data-fmt="h4" class="h4">${T('Heading 4', 'Titre 4')}</button>
          <button type="button" role="menuitem" data-fmt="text">${T('Plain text', 'Texte normal')}</button>
        </div>
      </span>
      <button type="button" class="btn doc-fmt" data-fmt="bullet" title="${T('Bulleted list', 'Liste à puces')}" aria-label="${T('Bulleted list', 'Liste à puces')}">${BULLET_ICON}</button>
      <button type="button" class="btn doc-fmt" data-fmt="ordered" title="${T('Numbered list', 'Liste numérotée')}" aria-label="${T('Numbered list', 'Liste numérotée')}">${NUMBER_ICON}</button>
      <button type="button" class="btn doc-fmt" data-fmt="link" title="${T('Link (Ctrl+K)', 'Lien (Ctrl+K)')}">${T('Link', 'Lien')}</button>
      <span class="doc-sep" aria-hidden="true"></span>
      <span class="doc-template-wrap">
        <button type="button" class="btn doc-template-btn" aria-haspopup="menu" aria-expanded="false" title="${T('Insert the headings of a template', 'Insérer les titres d\'un modèle')}">${T('Template', 'Modèle')} ▾</button>
        <div class="doc-template-menu" role="menu" hidden></div>
      </span>
      <button type="button" class="btn doc-mic" hidden>${MIC_ICON}<span>${T('Dictate', 'Dicter')}</span></button>
      <span class="doc-voice-meter" aria-live="polite" hidden></span>
      <span class="doc-sep" aria-hidden="true"></span>
      <button type="button" class="btn doc-ai" data-icon="assistant">${T('Write with the co-pilot', 'Rédiger avec le Co-pilote')}</button>`
    body.before(bar)

    // ── Corps : saisie et aperçu ──
    const preview = document.createElement('div')
    preview.className = 'doc-preview doc-md'
    preview.setAttribute('aria-live', 'polite')
    const interim = document.createElement('div')
    interim.className = 'doc-interim'
    interim.hidden = true
    body.classList.add('doc-body')
    body.append(preview)
    textarea.after(interim)

    // ── Pied : aide Markdown, nombre de caractères, messages ──
    const foot = document.createElement('div')
    foot.className = 'doc-foot'
    foot.innerHTML = `<span class="doc-note"></span><span class="doc-count"></span>`
    popup.append(foot)
    const note = foot.querySelector('.doc-note')
    const count = foot.querySelector('.doc-count')
    const defaultNote = T('Markdown, saved in the standard BPMN Documentation field', 'Markdown, enregistré dans le champ Documentation standard de BPMN')
    let noteTimer = null
    const say = (kind, message) => {
      clearTimeout(noteTimer)
      note.textContent = message
      note.dataset.kind = kind
      noteTimer = setTimeout(() => { note.textContent = defaultNote; delete note.dataset.kind }, kind === 'error' ? 8000 : 5000)
    }
    note.textContent = defaultNote

    function render() {
      const value = textarea.value
      preview.innerHTML = value.trim()
        ? markdownToHtml(value)
        : `<p class="doc-empty">${T('Nothing written yet. The preview appears here.', 'Rien d\'écrit pour l\'instant. L\'aperçu s\'affiche ici.')}</p>`
      const n = value.length
      count.textContent = T(`${n} character${n > 1 ? 's' : ''}`, `${n} caractère${n > 1 ? 's' : ''}`)
    }

    // Toute modification passe par l'événement input : le panneau enregistre, comme si
    // l'utilisateur avait tapé.
    const commit = () => {
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      render()
    }
    textarea.addEventListener('input', () => {
      if (current) current.typedAt = Date.now()
      render()
    })

    // ── Vues ──
    function setView(view) {
      popup.dataset.view = view
      for (const b of tabs.querySelectorAll('.doc-view')) b.setAttribute('aria-selected', String(b.dataset.view === view))
      try { localStorage.setItem(VIEW_KEY, view) } catch {}
      if (view !== 'preview') textarea.focus()
    }
    tabs.addEventListener('click', (e) => {
      const v = e.target.closest('.doc-view')?.dataset.view
      if (v) setView(v)
    })

    // ── Mise en forme ──
    function replaceSelection(make) {
      const { selectionStart: s, selectionEnd: e, value } = textarea
      const { text, cursor = [0, 0] } = make(value.slice(s, e), value, s, e)
      textarea.focus()
      textarea.setRangeText(text, s, e, 'end')
      textarea.setSelectionRange(s + cursor[0], s + (cursor[1] ?? cursor[0]))
      commit()
    }
    const wrap = (mark, placeholder) => replaceSelection((sel) => {
      const inner = sel || placeholder
      return { text: mark + inner + mark, cursor: [mark.length, mark.length + inner.length] }
    })
    // Préfixe ajouté au début de chaque ligne sélectionnée (ou de la ligne du curseur).
    function prefixLines(prefixOf) {
      const { value } = textarea
      const start = value.lastIndexOf('\n', textarea.selectionStart - 1) + 1
      let end = value.indexOf('\n', textarea.selectionEnd)
      if (end < 0) end = value.length
      const lines = value.slice(start, end).split('\n')
      const text = lines.map((l, i) => prefixOf(i) + l.replace(/^(\s*)([-*+]|\d+[.)]|#{1,6})\s+/, '$1')).join('\n')
      textarea.focus()
      textarea.setRangeText(text, start, end, 'end')
      commit()
    }
    function format(kind) {
      if (kind === 'bold') wrap('**', T('bold text', 'texte en gras'))
      else if (kind === 'italic') wrap('*', T('italic text', 'texte en italique'))
      else if (/^h[1-4]$/.test(kind)) prefixLines(() => `${'#'.repeat(Number(kind[1]))} `)
      else if (kind === 'text') prefixLines(() => '')
      else if (kind === 'bullet') prefixLines(() => '- ')
      else if (kind === 'ordered') prefixLines((i) => `${i + 1}. `)
      else if (kind === 'link') {
        replaceSelection((sel) => {
          const label = sel || T('link text', 'texte du lien')
          const text = `[${label}](https://)`
          return { text, cursor: [label.length + 3, label.length + 11] }
        })
      }
    }
    // Niveau de titre : un menu déroulant, de Titre 1 à Titre 4, ou Texte normal.
    const headingButton = bar.querySelector('.doc-heading-btn')
    const headingMenu = bar.querySelector('.doc-heading-menu')
    const showHeadings = (show) => {
      headingMenu.hidden = !show
      headingButton.setAttribute('aria-expanded', String(show))
      if (show) headingMenu.querySelector('button')?.focus()
    }
    headingButton.addEventListener('click', () => showHeadings(headingMenu.hidden))
    headingMenu.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); showHeadings(false); headingButton.focus() }
    })
    popup.addEventListener('pointerdown', (e) => {
      if (!headingMenu.hidden && !e.target.closest('.doc-heading-wrap')) showHeadings(false)
    })
    bar.addEventListener('click', (e) => {
      const kind = e.target.closest('[data-fmt]')?.dataset.fmt
      if (!kind) return
      if (!headingMenu.hidden) showHeadings(false)
      format(kind)
    })
    textarea.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
      const kind = { b: 'bold', i: 'italic', k: 'link' }[e.key.toLowerCase()]
      if (!kind) return
      e.preventDefault()
      format(kind)
    })

    // ── Modèles ──
    const templateButton = bar.querySelector('.doc-template-btn')
    const templateMenu = templateButton.nextElementSibling
    const suggested = templateFor(bo)
    const ordered = [...TEMPLATES].sort((a, b) => (a.id === suggested ? -1 : b.id === suggested ? 1 : 0))
    templateMenu.innerHTML = ordered.map((t) => `
      <button type="button" role="menuitem" data-template="${t.id}"${t.id === suggested ? ' class="suggested"' : ''}>
        <b>${t.label()}</b><small>${t.hint()}</small>
      </button>`).join('')
    const showMenu = (show) => {
      templateMenu.hidden = !show
      templateButton.setAttribute('aria-expanded', String(show))
      if (show) templateMenu.querySelector('button')?.focus()
    }
    templateButton.addEventListener('click', () => showMenu(templateMenu.hidden))
    templateMenu.addEventListener('click', (e) => {
      const id = e.target.closest('[data-template]')?.dataset.template
      if (!id) return
      showMenu(false)
      const block = templateText(id, bo)
      const value = withoutEmptyTemplate(textarea.value)
      textarea.value = value ? `${value}\n\n${block}` : block
      // Curseur à la fin du premier titre inséré, prêt à écrire.
      const at = textarea.value.indexOf('\n', value ? value.length + 2 : 0)
      textarea.focus()
      textarea.setSelectionRange(at + 1, at + 1)
      commit()
    })
    templateMenu.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); showMenu(false); templateButton.focus() }
    })
    popup.addEventListener('pointerdown', (e) => {
      if (!templateMenu.hidden && !e.target.closest('.doc-template-wrap')) showMenu(false)
    })

    // ── Dictée : le texte reconnu s'insère au curseur ──
    let voice = null
    const mic = bar.querySelector('.doc-mic')
    if (voiceSupported()) {
      mic.hidden = false
      let tail = ''
      const cursorInput = {
        get value() {
          const at = textarea.selectionEnd
          tail = textarea.value.slice(at)
          return textarea.value.slice(0, at)
        },
        set value(before) {
          textarea.value = before + tail
          textarea.setSelectionRange(before.length, before.length)
        },
      }
      voice = setupVoiceInput({ button: mic, input: cursorInput, interim, notify: say, onText: commit, meter: bar.querySelector('.doc-voice-meter') })
    }

    // ── Co-pilote ──
    const ai = bar.querySelector('.doc-ai')
    const aiReady = () => document.documentElement.classList.contains('copilot-ready')
    const syncAi = () => {
      ai.disabled = !aiReady()
      ai.title = aiReady()
        ? T('The AI co-pilot drafts this documentation from the diagram. You review it here.', 'Le Co-pilote IA rédige cette documentation d\'après le diagramme. Vous la relisez ici.')
        : T('Connect an AI model to the co-pilot (Options) to use this function', 'Connectez un modèle d\'IA au Co-pilote (Options) pour utiliser cette fonction')
    }
    syncAi()
    const aiWatch = new MutationObserver(syncAi)
    aiWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    ai.addEventListener('click', () => {
      if (!aiReady()) return
      window.dispatchEvent(new CustomEvent(COPILOT_ASK_EVENT, { detail: { text: draftRequest(element, bo, textarea.value) } }))
      say('notice', T('Request sent to the co-pilot: its text will appear here.', 'Demande envoyée au Co-pilote : son texte va s\'afficher ici.'))
    })

    current = {
      element,
      bo,
      textarea,
      render,
      typedAt: 0,
      stop() {
        clearTimeout(noteTimer)
        aiWatch.disconnect()
        if (voice?.active) voice.stop()
      },
    }
    setView(savedView())
    render()
  }

  // Ouvre la fenêtre pour un élément, sans passer par le panneau.
  let saveTimer = null
  function open(element) {
    const bo = element.businessObject
    selection.select(element)
    let latest = docText(bo)
    const save = () => setDocText({ element, bo, text: latest.trim() ? latest : '', bpmnFactory, commandStack })
    eventBus.once('propertiesPanelPopup.close', () => { clearTimeout(saveTimer); save() })
    // Après la mise à jour du panneau pour la nouvelle sélection, qui fermerait la fenêtre.
    setTimeout(() => eventBus.fire('propertiesPanel.openPopup', {
      element,
      entryId: 'documentation',
      label: T('Element documentation', 'Documentation de l\'élément'),
      value: latest,
      sourceElement: null,
      onInput: (value) => {
        latest = value
        clearTimeout(saveTimer)
        saveTimer = setTimeout(save, 400)
      },
    }), 60)
  }

  return { open, isOpen: () => !!current }
}

// Demande au Co-pilote pour la documentation d'un élément, dans la langue de l'interface.
function draftRequest(element, bo, existing) {
  const name = (bo.name || '').trim()
  const who = name ? `"${name}" (${element.id})` : element.id
  const template = templateText(templateFor(bo), bo)
  const headings = template.split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(3)).join(', ')
  const keep = existing.trim()
    ? T(' Its Documentation field already has text: keep what it says and complete it.', ' Son champ Documentation contient déjà du texte : garde ce qu\'il dit et complète-le.')
    : ''
  return T(
    `Write the documentation of the element ${who}, in Markdown, with these level 2 headings: ${headings}. ` +
      'Base it on what the diagram says (lane, previous and next elements, conditions, documentation of the other elements) and on what I told you in this conversation. ' +
      'Do not invent facts: write "to be confirmed" where you do not know.' + keep +
      ' Save it with update_elements (documentation field only, nothing else changes), then tell me in one line what remains to confirm.',
    `Rédige la documentation de l'élément ${who}, en Markdown, avec ces titres de niveau 2 : ${headings}. ` +
      'Appuie-toi sur ce que dit le diagramme (couloir, éléments précédents et suivants, conditions, documentation des autres éléments) et sur ce que je t\'ai dit dans cette discussion. ' +
      'N\'invente rien : écris « à confirmer » là où tu ne sais pas.' + keep +
      ' Enregistre-la avec update_elements (champ documentation seulement, rien d\'autre ne change), puis dis-moi en une ligne ce qui reste à confirmer.')
}
