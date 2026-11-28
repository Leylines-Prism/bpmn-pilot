// Fenêtres Mermaid :
//   - « Ouvrir > Depuis Mermaid » : coller un flowchart ou choisir un fichier .mmd, .mermaid
//     ou .md, voir ce qui sera créé, puis créer le diagramme. La conversion se fait dans la
//     page, sans IA (src/mermaid-import.js). Un texte Mermaid collé dans « Coller du XML » ou
//     un fichier .mmd déposé sur l'éditeur arrive ici aussi.
//   - « Exporter > Code Mermaid à copier » : le diagramme ouvert en flowchart Mermaid, à copier
//     tel quel ou en bloc ```mermaid pour un README (src/mermaid-export.js).

import { T, num } from './i18n/lang.js'
import { addDialogClose } from './dialog-close.js'
import { importMermaid, mermaidToDiagram } from './mermaid-import.js'
import { bpmnToMermaid } from './mermaid-export.js'

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

const EXAMPLE = () => T(`flowchart LR
  subgraph Sales
    A([Order received]) --> B{In stock?}
  end
  subgraph Warehouse
    B -->|yes| C[Pack the order]
    B -->|no| D[[Order from the supplier]]
    D --> C
    C --> E[Ship] --> F(((Delivered)))
  end
  C -.-> DB[(Inventory)]`, `flowchart LR
  subgraph Ventes
    A([Commande reçue]) --> B{En stock ?}
  end
  subgraph Entrepôt
    B -->|oui| C[Préparer la commande]
    B -->|non| D[[Commander au fournisseur]]
    D --> C
    C --> E[Expédier] --> F(((Livrée)))
  end
  C -.-> DB[(Stock)]`)

// onCreate(xml, name) renvoie un message d'erreur, ou rien si le diagramme est ouvert.
export function setupMermaidDialog({ openButton, onCreate }) {
  const dialog = document.createElement('dialog')
  dialog.id = 'mermaid-dialog'
  dialog.innerHTML = `
    <form method="dialog">
      <h2>${T('Create a process from Mermaid', 'Créer un processus depuis Mermaid')}</h2>
      <p class="hint">${T(
        'Paste a Mermaid flowchart (<code>flowchart</code> or <code>graph</code>), or choose a .mmd, .mermaid or .md file. The conversion runs in the page, without AI, then the diagram is laid out automatically.',
        'Collez un flowchart Mermaid (<code>flowchart</code> ou <code>graph</code>), ou choisissez un fichier .mmd, .mermaid ou .md. La conversion se fait dans la page, sans IA, puis le diagramme est rangé automatiquement.')}</p>
      <p class="table-columns">${T(
        'Rectangles become tasks, <code>{ }</code> exclusive gateways, <code>(( ))</code> and <code>([ ])</code> events, <code>[[ ]]</code> call activities, <code>[( )]</code> data stores, <code>[/ /]</code> data objects, link labels conditions, subgraphs lanes. Styles, clicks and the direction are ignored.',
        'Les rectangles deviennent des tâches, <code>{ }</code> des passerelles exclusives, <code>(( ))</code> et <code>([ ])</code> des événements, <code>[[ ]]</code> des activités d\'appel, <code>[( )]</code> des magasins de données, <code>[/ /]</code> des objets de données, les libellés des liens des conditions, les sous-graphes des couloirs. Styles, clics et direction sont ignorés.')}</p>
      <p class="hint" id="mermaid-note" hidden></p>
      <textarea id="mermaid-text" spellcheck="false" placeholder="${esc(EXAMPLE().split('\n').slice(0, 4).join('\n'))}"></textarea>
      <label class="mermaid-option"><input type="checkbox" id="mermaid-subprocesses"> ${T('Subgraphs are steps (expanded subprocesses), not roles (lanes)', 'Les sous-graphes sont des étapes (sous-processus dépliés), pas des rôles (couloirs)')}</label>
      <div class="table-preview" id="mermaid-preview" aria-live="polite"></div>
      <p class="error" id="mermaid-error" role="alert"></p>
      <div class="actions">
        <button type="button" class="btn" data-icon="open" id="mermaid-file">${T('Choose a file…', 'Choisir un fichier…')}</button>
        <button type="button" class="btn" data-icon="flowchart" id="mermaid-example" title="${T('Fill in a short example', 'Remplir avec un court exemple')}">${T('Example', 'Exemple')}</button>
        <span class="grow"></span>
        <button type="button" class="btn" id="mermaid-cancel">${T('Cancel', 'Annuler')}</button>
        <button type="button" class="btn primary" id="mermaid-create" disabled>${T('Create the diagram', 'Créer le diagramme')}</button>
      </div>
      <input type="file" id="mermaid-input" accept=".mmd,.mermaid,.md,.markdown,.txt" hidden>
    </form>`
  addDialogClose(dialog)
  document.body.appendChild(dialog)

  const text = dialog.querySelector('#mermaid-text')
  const sub = dialog.querySelector('#mermaid-subprocesses')
  const preview = dialog.querySelector('#mermaid-preview')
  const error = dialog.querySelector('#mermaid-error')
  const note = dialog.querySelector('#mermaid-note')
  const create = dialog.querySelector('#mermaid-create')
  const input = dialog.querySelector('#mermaid-input')
  let fileName = ''
  let timer = 0

  const mode = () => (sub.checked ? 'subprocesses' : 'lanes')

  function show() {
    error.textContent = ''
    if (!text.value.trim()) { preview.innerHTML = ''; create.disabled = true; return null }
    const r = importMermaid(text.value, { subgraphs: mode(), T })
    const c = r.counts
    const parts = c ? [
      `<strong>${T(`${num(c.tasks)} task(s)`, `${num(c.tasks)} tâche(s)`)}</strong>`,
      T(`${num(c.gateways)} gateway(s)`, `${num(c.gateways)} passerelle(s)`),
      T(`${num(c.events)} event(s)`, `${num(c.events)} événement(s)`),
      c.data ? T(`${num(c.data)} data item(s)`, `${num(c.data)} donnée(s)`) : '',
      c.notes ? T(`${num(c.notes)} note(s)`, `${num(c.notes)} note(s)`) : '',
      c.lanes ? T(`${num(c.lanes)} lane(s)`, `${num(c.lanes)} couloir(s)`) : '',
    ].filter(Boolean) : []
    const items = [
      ...r.errors.map((e) => `<li class="err">${esc(e)}</li>`),
      ...r.warnings.map((w) => `<li class="warn">${esc(w)}</li>`),
    ]
    preview.innerHTML = parts.join(', ') + (items.length ? `<ul>${items.join('')}</ul>` : '')
    create.disabled = !!r.errors.length
    return r
  }
  const later = () => { clearTimeout(timer); timer = setTimeout(show, 200) }

  text.addEventListener('input', () => { fileName = ''; note.hidden = true; later() })
  sub.addEventListener('change', show)

  function open() {
    error.textContent = ''
    dialog.showModal()
    text.focus()
  }
  openButton.addEventListener('click', () => { note.hidden = true; show(); open() })

  // Ouverture avec un texte déjà prêt (collé dans « Coller du XML », fichier déposé).
  function openWith(content, { name = '', message = '' } = {}) {
    text.value = content
    fileName = name
    note.textContent = message
    note.hidden = !message
    show()
    open()
  }

  dialog.querySelector('#mermaid-cancel').addEventListener('click', () => dialog.close())
  dialog.querySelector('#mermaid-example').addEventListener('click', () => { text.value = EXAMPLE(); fileName = ''; show(); text.focus() })
  dialog.querySelector('#mermaid-file').addEventListener('click', () => input.click())
  input.addEventListener('change', async () => {
    const file = input.files[0]
    input.value = ''
    if (!file) return
    try {
      text.value = await file.text()
      fileName = file.name.replace(/\.(mmd|mermaid|md|markdown|txt)$/i, '')
      note.hidden = true
      show()
    } catch (err) {
      show()
      error.textContent = T('Unreadable file: ', 'Fichier illisible : ') + err.message
    }
  })
  create.addEventListener('click', async () => {
    if (!show() || create.disabled) return
    create.disabled = true
    const name = fileName || T('Process', 'Processus')
    const r = await mermaidToDiagram(text.value, { name, subgraphs: mode(), T })
    const failure = r.errors.length ? r.errors.join(' ') : await onCreate(r.xml, name, r)
    create.disabled = false
    if (failure) {
      error.textContent = T('Creation failed: ', 'Création impossible : ') + failure
    } else {
      text.value = ''
      fileName = ''
      show()
      dialog.close()
    }
  })
  return { openWith }
}

// getDefinitions() renvoie la racine moddle du diagramme ouvert, download(text) enregistre le .mmd.
export function setupMermaidExport({ openButton, getDefinitions, download }) {
  const dialog = document.createElement('dialog')
  dialog.id = 'mermaid-export-dialog'
  dialog.innerHTML = `
    <form method="dialog">
      <h2>${T('Export as Mermaid', 'Exporter en Mermaid')}</h2>
      <p class="hint">${T(
        'The diagram as a Mermaid flowchart, to paste into a README, a wiki or any page that displays Mermaid. Positions, colors and the detailed types of tasks and events have no equivalent in a flowchart.',
        'Le diagramme en flowchart Mermaid, à coller dans un README, un wiki ou toute page qui affiche Mermaid. Les positions, les couleurs et le détail des types de tâches et d\'événements n\'ont pas d\'équivalent dans un flowchart.')}</p>
      <textarea id="mermaid-export-text" spellcheck="false" readonly></textarea>
      <p class="status" id="mermaid-export-status" role="status"></p>
      <div class="actions">
        <button type="button" class="btn" data-icon="save" id="mermaid-export-download">${T('Download .mmd', 'Télécharger .mmd')}</button>
        <span class="grow"></span>
        <button type="button" class="btn" id="mermaid-export-close">${T('Close', 'Fermer')}</button>
        <button type="button" class="btn" id="mermaid-export-readme" title="${T('Copy inside a ```mermaid block, ready for a Markdown file', 'Copier dans un bloc ```mermaid, prêt pour un fichier Markdown')}">${T('Copy for a README', 'Copier pour un README')}</button>
        <button type="button" class="btn primary" id="mermaid-export-copy" title="${T('Copy the Mermaid code to the clipboard', 'Copier le code Mermaid dans le presse-papiers')}">${T('Copy', 'Copier')}</button>
      </div>
    </form>`
  addDialogClose(dialog)
  document.body.appendChild(dialog)

  const text = dialog.querySelector('#mermaid-export-text')
  const status = dialog.querySelector('#mermaid-export-status')

  openButton.addEventListener('click', () => {
    status.textContent = ''
    text.value = bpmnToMermaid(getDefinitions())
    dialog.showModal()
    text.scrollTop = 0
  })
  async function copy(value, done) {
    try {
      await navigator.clipboard.writeText(value)
      status.textContent = done
    } catch {
      text.focus()
      text.select()
      status.textContent = T('Automatic copy failed: the text is selected, press Ctrl+C.', 'Copie automatique impossible : le texte est sélectionné, faites Ctrl+C.')
    }
  }
  dialog.querySelector('#mermaid-export-close').addEventListener('click', () => dialog.close())
  dialog.querySelector('#mermaid-export-download').addEventListener('click', () => download(text.value))
  dialog.querySelector('#mermaid-export-copy').addEventListener('click', () => copy(text.value, T('Mermaid code copied to the clipboard.', 'Code Mermaid copié dans le presse-papiers.')))
  dialog.querySelector('#mermaid-export-readme').addEventListener('click', () => copy(`\`\`\`mermaid\n${text.value}\`\`\`\n`, T('Mermaid block copied, ready to paste into a README.', 'Bloc Mermaid copié, prêt à coller dans un README.')))
}
