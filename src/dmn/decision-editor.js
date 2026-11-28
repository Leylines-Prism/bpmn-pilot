// Fenêtre d'édition des décisions DMN (mode Expert, interrupteur DMN).
//
// dmn-js n'est chargé qu'à la première ouverture (import dynamique) : l'éditeur BPMN ne paie
// rien au démarrage. La fenêtre a deux usages :
//   - le modèle du diagramme ouvert (pastille d'une tâche, panneau, Ouvrir un .dmn) : à la
//     fermeture, les changements sont rangés dans le .bpmn en une seule commande (Ctrl+Z) ;
//   - un modèle de Mes diagrammes, ouvert seul : Enregistrer le met à jour, Ajouter au
//     diagramme le copie dans le diagramme ouvert.
// Le filigrane bpmn.io de dmn-js reste visible, comme le veut sa licence.

import { lang, T } from '../i18n/lang.js'
import { createBench, decisionFromXml } from './decision-bench.js'
import { createCompare } from './decision-compare.js'
import frBpmn from '../i18n/fr.js'
import { setDecisionTable } from './dmn-model.js'
import { tableToRows, rowsToSpec } from './decision-sheet.js'
import { readSheetFile, rowsToXlsx, rowsToCsv } from '../sheet-io.js'

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

let dialog = null
let current = null // { modeler, baseline, mode, onSave, onClose, ... }
let bench = null
let compare = null
const watched = new WeakSet() // vues dmn-js dont on suit les changements (guide de la table vide)

async function loadDmnJs() {
  const [{ default: DmnModeler }, { default: frDmn }] = await Promise.all([
    import('dmn-js/lib/Modeler'),
    import('./dmn-fr.js'),
    import('dmn-js/dist/assets/dmn-js-shared.css'),
    import('dmn-js/dist/assets/dmn-js-drd.css'),
    import('dmn-js/dist/assets/dmn-js-decision-table.css'),
    import('dmn-js/dist/assets/dmn-js-decision-table-controls.css'),
    import('dmn-js/dist/assets/dmn-js-literal-expression.css'),
    import('dmn-js/dist/assets/dmn-js-boxed-expression.css'),
    import('dmn-js/dist/assets/dmn-js-boxed-expression-controls.css'),
    import('dmn-js/dist/assets/dmn-font/css/dmn-embedded.css'),
  ])
  const translate = (template, replacements = {}) =>
    (lang === 'fr' ? frDmn[template] ?? frBpmn[template] ?? template : template).replace(/{([^}]+)}/g, (_, k) => (k in replacements ? replacements[k] : `{${k}}`))
  const translateModule = { translate: ['value', translate] }
  return { DmnModeler, translateModule }
}

function build() {
  dialog = document.createElement('dialog')
  dialog.id = 'dmn-dialog'
  dialog.innerHTML = `
    <div class="dmn-head">
      <button type="button" class="btn" id="dmn-back" data-icon="undo"></button>
      <div class="dmn-title"><small id="dmn-subtitle"></small><h2 id="dmn-name"></h2></div>
      <div class="dmn-tabs" role="tablist">
        <button type="button" role="tab" data-view="table">${T('Decision table', 'Table de décision')}</button>
        <button type="button" role="tab" data-view="drd">${T('Requirements (DRD)', 'Exigences (DRD)')}</button>
      </div>
      <span class="dmn-grow"></span>
      <span class="dmn-copilot-wrap"><button type="button" class="btn dmn-ai" id="dmn-copilot" data-icon="assistant">${T('Fill in with the co-pilot', 'Remplir avec le Co-pilote')}</button><span class="copilot-help" role="img" tabindex="0" aria-label="${T('Connect an AI model to the co-pilot to use this function', 'Connectez un modèle d\'IA au Co-pilote pour utiliser cette fonction')}"><span class="copilot-help-icon" data-icon="help"></span></span></span>
      <button type="button" class="btn" id="dmn-test" data-icon="play" aria-pressed="false" title="${T('Try input values on this table and see which rules apply', 'Essayer des valeurs d\'entrée sur cette table et voir les règles qui s\'appliquent')}">${T('Test', 'Tester')}</button>
      <button type="button" class="btn" id="dmn-compare" data-icon="compare" aria-pressed="false" title="${T('See what changed in the decisions since the window opened, or compared with a .dmn file', 'Voir ce qui a changé dans les décisions depuis l\'ouverture de la fenêtre, ou par rapport à un fichier .dmn')}">${T('Compare', 'Comparer')}</button>
      <button type="button" class="btn" id="dmn-add" data-icon="new" hidden></button>
      <button type="button" class="btn" id="dmn-library" data-icon="library"></button>
      <div class="dmn-sheet-wrap">
        <button type="button" class="btn" id="dmn-sheet" data-icon="table" aria-haspopup="menu" aria-expanded="false" title="${T('Export this table to Excel or CSV, or replace its rules with a sheet', 'Exporter cette table vers Excel ou CSV, ou remplacer ses règles par un tableau')}">${T('Sheet', 'Tableur')}</button>
        <div class="dmn-sheet-menu" role="menu" hidden>
          <button type="button" role="menuitem" data-sheet="xlsx">${T('Export to Excel (.xlsx)', 'Exporter vers Excel (.xlsx)')}</button>
          <button type="button" role="menuitem" data-sheet="csv">${T('Export to CSV', 'Exporter en CSV')}</button>
          <button type="button" role="menuitem" data-sheet="import">${T('Import a sheet (.xlsx, .csv)…', 'Importer un tableau (.xlsx, .csv)…')}</button>
        </div>
        <input type="file" id="dmn-sheet-file" accept=".xlsx,.csv,.tsv,.txt" hidden />
      </div>
      <button type="button" class="btn" id="dmn-export" data-icon="save" title="${T('Download these decisions as a .dmn file', 'Télécharger ces décisions en fichier .dmn')}">${T('Export .dmn', 'Exporter .dmn')}</button>
      <button type="button" class="btn icon-only dmn-close" aria-label="${T('Close', 'Fermer')}" title="${T('Close (Esc)', 'Fermer (Échap)')}">×</button>
    </div>
    <p class="dmn-status" id="dmn-status" role="status"></p>
    <div class="dmn-main"><div class="dmn-body" id="dmn-body"></div><aside class="dmn-bench" id="dmn-bench" hidden></aside><aside class="dmn-bench" id="dmn-compare-panel" hidden></aside></div>`
  document.body.append(dialog)
  dialog.querySelector('.dmn-close').addEventListener('click', () => close())
  dialog.querySelector('#dmn-back').addEventListener('click', () => close())
  dialog.addEventListener('cancel', (e) => {
    // Échap pendant une saisie dans la table ferme d'abord la saisie (dmn-js), pas la fenêtre.
    if (dialog.querySelector('.dmn-main').contains(document.activeElement) && document.activeElement.matches('[contenteditable], input, select, textarea')) {
      e.preventDefault()
      return
    }
    e.preventDefault()
    close()
  })
  for (const tab of dialog.querySelectorAll('.dmn-tabs [data-view]')) {
    tab.addEventListener('click', () => showView(tab.dataset.view))
  }
  bench = createBench(dialog.querySelector('#dmn-bench'), {
    getDecision: async () => {
      const view = current?.modeler.getActiveView()
      if (!view || view.type !== 'decisionTable') return null
      return decisionFromXml(await currentXml(), view.element.id)
    },
    onHits: markRules,
  })
  compare = createCompare(dialog.querySelector('#dmn-compare-panel'), {
    currentXml,
    baseline: () => current.baseline,
    activeDecision: () => { const v = current?.modeler.getActiveView(); return v?.type === 'decisionTable' ? v.element.id : null },
    onRules: ({ added, changed }) => markDiff(added, changed),
  })
  dialog.querySelector('#dmn-test').addEventListener('click', () => setSide(side === 'bench' ? null : 'bench'))
  dialog.querySelector('#dmn-compare').addEventListener('click', () => setSide(side === 'compare' ? null : 'compare'))
  dialog.querySelector('#dmn-export').addEventListener('click', async () => {
    if (!current) return
    const xml = await currentXml()
    current.download(xml, `${current.fileName()}.dmn`, 'application/xml')
  })
  setupSheet()
  dialog.querySelector('#dmn-copilot').addEventListener('click', () => fillWithCopilot())
  dialog.querySelector('#dmn-library').addEventListener('click', async () => {
    if (!current?.saveToLibrary) return
    say('')
    try {
      const msg = await current.saveToLibrary(await currentXml(), current.title)
      say(msg)
      if (current.mode === 'library') current.baseline = await currentXml()
    } catch (err) {
      say(T(`Save failed: ${err.message}`, `Échec de l'enregistrement : ${err.message}`), true)
    }
  })
  dialog.querySelector('#dmn-add').addEventListener('click', async () => {
    if (!current?.addToDiagram) return
    try {
      say(await current.addToDiagram(await currentXml()))
    } catch (err) {
      say(T(`Cannot add it: ${err.message}`, `Ajout impossible : ${err.message}`), true)
    }
  })
}

// Tableur : export de la table affichée, ou remplacement de ses colonnes et règles par un tableau.
function setupSheet() {
  const button = dialog.querySelector('#dmn-sheet')
  const menu = dialog.querySelector('.dmn-sheet-menu')
  const file = dialog.querySelector('#dmn-sheet-file')
  const toggle = (open) => { menu.hidden = !open; button.setAttribute('aria-expanded', String(open)) }
  button.addEventListener('click', () => toggle(menu.hidden))
  dialog.addEventListener('click', (e) => { if (!menu.hidden && !e.target.closest('.dmn-sheet-wrap')) toggle(false) })
  const shownTable = async () => {
    const view = current?.modeler.getActiveView()
    if (!view || view.type !== 'decisionTable') return null
    return decisionFromXml(await currentXml(), view.element.id)
  }
  menu.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-sheet]')?.dataset.sheet
    if (!act) return
    toggle(false)
    if (act === 'import') { file.click(); return }
    const d = await shownTable()
    if (!d) return
    const rows = tableToRows(d, lang === 'fr')
    const name = `${current.fileName()} - ${d.name || d.id}`
    if (act === 'csv') current.download(`\uFEFF${rowsToCsv(rows, lang === 'fr' ? ';' : ',')}`, `${name}.csv`, 'text/csv')
    else current.download(new Blob([await rowsToXlsx(rows, (d.name || d.id).replace(/[[\]*?/\\:]/g, ' '))], { type: XLSX_TYPE }), `${name}.xlsx`, XLSX_TYPE)
  })
  file.addEventListener('change', async () => {
    const f = file.files[0]
    file.value = ''
    if (!f || !current) return
    const d = await shownTable()
    if (!d) return
    try {
      const spec = rowsToSpec(await readSheetFile(f))
      if (!spec.hitPolicy) { spec.hitPolicy = d.hitPolicy; if (d.aggregation) spec.aggregation = d.aggregation }
      if (d.rules.length && !confirm(T(`Replace the columns and the ${d.rules.length} rule(s) of this table with the ${spec.rules.length} rule(s) of "${f.name}"? Compare shows the differences afterwards.`,
        `Remplacer les colonnes et les ${d.rules.length} règle(s) de cette table par les ${spec.rules.length} règle(s) de « ${f.name} » ? Comparer montre ensuite les différences.`))) return
      const { xml } = await setDecisionTable(await currentXml(), { ...spec, decisionId: d.id })
      await current.modeler.importXML(xml)
      current.decisionId = d.id
      await showView('table')
      syncTabs()
      say(T(`${spec.rules.length} rule(s) imported from "${f.name}".`, `${spec.rules.length} règle(s) importée(s) depuis « ${f.name} ».`))
    } catch (err) {
      say(T(`Cannot import "${f.name}": ${err.message}`, `Import de « ${f.name} » impossible : ${err.message}`), true)
    }
  })
}

// Décision de la table affichée, lue dans le XML de la fenêtre.
async function shownDecision() {
  const view = current?.modeler.getActiveView()
  if (!view || view.type !== 'decisionTable') return null
  return decisionFromXml(await currentXml(), view.element.id)
}

// Remplir avec le Co-pilote : la fenêtre se ferme (les changements vont dans le diagramme), puis
// le Co-pilote reçoit la demande, avec la décision, la tâche qui l'appelle et ses règles actuelles.
async function fillWithCopilot() {
  if (!current?.fillWithCopilot || !copilotReady()) return
  const d = await shownDecision()
  if (!d) return
  const ask = current.fillWithCopilot
  await close()
  ask(d)
}

const copilotReady = () => document.documentElement.classList.contains('copilot-ready')

// Table sans règle : un guide sous la table dit comment la lire et l'écrire, et propose le
// Co-pilote, un exemple tout fait et l'aide. Il disparaît dès la première règle.
function guideHtml() {
  const ex = (s) => `<code>${s}</code>`
  return `
    <h3>${T('This table has no rule yet', 'Cette table n\'a encore aucune règle')}</h3>
    <p>${T('A decision table reads row by row: <strong>When</strong> the inputs match the entries of a row, <strong>Then</strong> the outputs take the values of that row.',
      'Une table de décision se lit ligne par ligne : <strong>Quand</strong> les entrées correspondent aux cases d\'une ligne, <strong>Alors</strong> les sorties prennent les valeurs de cette ligne.')}</p>
    <ol>
      <li>${T('Name the columns: click the edit button of <strong>Input</strong> and <strong>Output</strong> to give them business names, such as Impact and Category, and their type.',
        'Nommez les colonnes : le bouton crayon de <strong>Entrée</strong> et de <strong>Sortie</strong> leur donne un nom métier, par exemple Impact et Catégorie, et un type.')}</li>
      <li>${T('Add a rule with the <strong>+</strong> under the table, then write each cell in FEEL: ', 'Ajoutez une règle avec le <strong>+</strong> sous la table, puis écrivez chaque case en FEEL : ')}
        ${ex(T('"High"', '"Fort"'))} ${T('text between double quotes', 'texte entre guillemets')}, ${ex('&lt; 1000')}, ${ex('[1..10]')}, ${ex('-')} ${T('for any value', 'pour « peu importe »')}.</li>
      <li>${T('Choose the hit policy above the table: Unique (default) forbids two rules that apply together.', 'Choisissez la politique de résultat au-dessus de la table : Unique, par défaut, interdit que deux règles s\'appliquent ensemble.')}</li>
      <li>${T('<strong>Test</strong> opens the test bench: enter a value per input, Evaluate highlights the rule that applies.', '<strong>Tester</strong> ouvre le banc d\'essai : saisissez une valeur par entrée, Évaluer surligne la règle retenue.')}</li>
    </ol>
    <div class="dmn-guide-actions">
      <span class="dmn-copilot-wrap"><button type="button" class="btn dmn-ai" data-guide="copilot" data-icon="assistant">${T('Fill in with the co-pilot', 'Remplir avec le Co-pilote')}</button><span class="copilot-help" role="img" tabindex="0" aria-label="${T('Connect an AI model to the co-pilot to use this function', 'Connectez un modèle d\'IA au Co-pilote pour utiliser cette fonction')}"><span class="copilot-help-icon" data-icon="help"></span></span></span>
      <button type="button" class="btn" data-guide="example" data-icon="table">${T('Open an example', 'Ouvrir un exemple')}</button>
      <a class="btn" data-icon="help" href="${T('help.html#dmn-decisions', 'aide.html#decisions-dmn')}" target="_blank" rel="noopener">${T('Help on decision tables', 'Aide sur les tables de décision')}</a>
    </div>`
}

function setupGuide(body) {
  const guide = document.createElement('section')
  guide.className = 'dmn-guide'
  guide.hidden = true
  guide.innerHTML = guideHtml()
  guide.querySelector('[data-guide="copilot"]').addEventListener('click', () => fillWithCopilot())
  guide.querySelector('[data-guide="example"]').addEventListener('click', () => current?.openExample?.(current.decisionId))
  body.append(guide)
  return guide
}

// Montre le guide quand la table affichée n'a aucune règle, et règle les boutons du Co-pilote.
function refreshGuide() {
  if (!current) return
  const view = current.modeler.getActiveView()
  const onTable = view?.type === 'decisionTable'
  let rows = -1
  if (onTable) {
    try { rows = current.modeler.getActiveViewer().get('sheet').getRoot().rows.length } catch { rows = -1 }
  }
  const guide = dialog.querySelector('.dmn-guide')
  if (guide) {
    guide.hidden = !(onTable && rows === 0)
    // Le conteneur de dmn-js occupe toute la hauteur : le guide se place sous la table, par-dessus.
    const table = !guide.hidden && dialog.querySelector('#dmn-body .tjs-table')
    if (table) {
      const body = dialog.querySelector('#dmn-body')
      guide.style.top = `${table.getBoundingClientRect().bottom - body.getBoundingClientRect().top + body.scrollTop + 16}px`
    }
    guide.querySelector('[data-guide="example"]').hidden = !current.openExample
    guide.querySelector('[data-guide="copilot"]').closest('.dmn-copilot-wrap').hidden = !current.fillWithCopilot
  }
  const button = dialog.querySelector('#dmn-copilot')
  button.closest('.dmn-copilot-wrap').hidden = !onTable || !current.fillWithCopilot
  button.title = rows > 0
    ? T('The co-pilot completes this table from the task and the process, keeping your rules; the window closes while it works', 'Le Co-pilote complète cette table d\'après la tâche et le processus, en gardant vos règles ; la fenêtre se ferme pendant qu\'il travaille')
    : T('The co-pilot writes the inputs, outputs and rules of this table from the task and the process; the window closes while it works', 'Le Co-pilote écrit les entrées, les sorties et les règles de cette table d\'après la tâche et le processus ; la fenêtre se ferme pendant qu\'il travaille')
  for (const b of dialog.querySelectorAll('#dmn-copilot, [data-guide="copilot"]')) b.disabled = !copilotReady()
}

// Surligne dans la table de dmn-js les règles retenues par le banc d'essai (n° à partir de 1).
function markRules(rules) {
  const rows = dialog.querySelectorAll('#dmn-body .tjs-table tbody tr')
  rows.forEach((tr, i) => tr.classList.toggle('dmn-hit', rules.includes(i + 1)))
}

function markDiff(added, changed) {
  const rows = dialog.querySelectorAll('#dmn-body .tjs-table tbody tr')
  rows.forEach((tr, i) => {
    tr.classList.toggle('dmn-diff-added', added.includes(i + 1))
    tr.classList.toggle('dmn-diff-changed', changed.includes(i + 1))
  })
}

// Panneau de droite : banc d'essai, comparaison, ou rien.
let side = null
function setSide(next) {
  side = next
  dialog.querySelector('#dmn-bench').hidden = next !== 'bench'
  dialog.querySelector('#dmn-compare-panel').hidden = next !== 'compare'
  dialog.querySelector('#dmn-test').setAttribute('aria-pressed', String(next === 'bench'))
  dialog.querySelector('#dmn-compare').setAttribute('aria-pressed', String(next === 'compare'))
  markRules([])
  markDiff([], [])
  if (next === 'bench') bench.refresh()
  if (next === 'compare') compare.refresh()
}

function say(msg, error = false) {
  const el = dialog.querySelector('#dmn-status')
  el.textContent = msg
  el.classList.toggle('error', error)
  el.hidden = !msg
}

async function currentXml() {
  const { xml } = await current.modeler.saveXML({ format: true })
  return xml
}

function decisionViewOf(viewId) {
  return current.modeler.getViews().find((v) => v.element?.id === viewId && v.type !== 'drd')
}

async function showView(kind) {
  const modeler = current.modeler
  const views = modeler.getViews()
  let view
  if (kind === 'drd') view = views.find((v) => v.type === 'drd')
  else view = (current.decisionId && decisionViewOf(current.decisionId)) || views.find((v) => v.type === 'decisionTable') || views.find((v) => v.type !== 'drd')
  if (view) await modeler.open(view)
}

function syncTabs() {
  const view = current?.modeler.getActiveView()
  if (!view) return
  if (view.type !== 'drd') current.decisionId = view.element?.id
  const name = view.type === 'drd' ? current.title : view.element?.name || view.element?.id
  dialog.querySelector('#dmn-name').textContent = name || ''
  for (const tab of dialog.querySelectorAll('.dmn-tabs [data-view]')) {
    const on = tab.dataset.view === (view.type === 'drd' ? 'drd' : 'table')
    tab.classList.toggle('on', on)
    tab.setAttribute('aria-selected', String(on))
  }
  const onTable = view.type === 'decisionTable'
  dialog.querySelector('#dmn-test').hidden = !onTable
  dialog.querySelector('#dmn-sheet').hidden = !onTable
  if (side === 'bench') setSide(onTable ? 'bench' : null)
  else if (side === 'compare') setSide('compare')
  // Le guide suit les règles ajoutées ou retirées dans la table affichée.
  const viewer = current.modeler.getActiveViewer()
  if (viewer && !watched.has(viewer)) {
    watched.add(viewer)
    viewer.get('eventBus').on('elements.changed', () => { refreshGuide() })
  }
  refreshGuide()
  // Pas de table à montrer : l'onglet Table de décision ne mène nulle part.
  dialog.querySelector('.dmn-tabs [data-view="table"]').disabled = !current.modeler.getViews().some((v) => v.type !== 'drd')
}

// options : { xml, decisionId?, view?: 'table'|'drd', mode: 'diagram'|'library', title, subtitle,
//   fileName(), download(content, name, type), onSave(xml)?, saveToLibrary(xml, name)?, addToDiagram(xml)?, onClose()? }
export async function openDecisionEditor(options) {
  if (!dialog) build()
  if (current) await close()
  const { DmnModeler, translateModule } = await loadDmnJs()
  const body = dialog.querySelector('#dmn-body')
  body.replaceChildren()
  const modeler = new DmnModeler({
    container: body,
    common: { additionalModules: [translateModule] },
    drd: { additionalModules: [translateModule] },
    decisionTable: { additionalModules: [translateModule] },
    literalExpression: { additionalModules: [translateModule] },
    boxedExpression: { additionalModules: [translateModule] },
  })
  setupGuide(body)
  current = { ...options, modeler }
  const back = dialog.querySelector('#dmn-back')
  back.textContent = options.mode === 'example' ? T('Close the example', 'Fermer l\'exemple') : options.mode === 'library' ? T('Close', 'Fermer') : T('Back to the process', 'Retour au processus')
  back.title = options.mode === 'example'
    ? T('Close the example and go back to your table; nothing is saved', 'Fermer l\'exemple et revenir à votre table ; rien n\'est enregistré')
    : options.mode === 'library'
    ? T('Close the decision model; unsaved changes are lost', 'Fermer le modèle de décision ; les changements non enregistrés sont perdus')
    : T('Close and keep the changes in the diagram (Ctrl+Z in the editor undoes them)', 'Fermer en gardant les changements dans le diagramme (Ctrl+Z dans l\'éditeur les annule)')
  dialog.querySelector('#dmn-subtitle').textContent = options.subtitle || ''
  const lib = dialog.querySelector('#dmn-library')
  lib.hidden = !options.saveToLibrary
  lib.textContent = options.mode === 'library' ? T('Save', 'Enregistrer') : T('Save to My diagrams', 'Enregistrer dans Mes diagrammes')
  lib.title = options.mode === 'library'
    ? T('Update this decision model in My diagrams', 'Mettre à jour ce modèle de décision dans Mes diagrammes')
    : T('Keep a copy of these decisions in My diagrams, to reuse them in other processes', 'Garder une copie de ces décisions dans Mes diagrammes, pour les reprendre dans d\'autres processus')
  const add = dialog.querySelector('#dmn-add')
  add.hidden = !options.addToDiagram
  add.textContent = T('Add to the open diagram', 'Ajouter au diagramme ouvert')
  add.title = T('Copy these decisions into the process open in the editor, to link them to its tasks', 'Copier ces décisions dans le processus ouvert dans l\'éditeur, pour les lier à ses tâches')
  say('')
  modeler.on('views.changed', syncTabs)
  if (!dialog.open) dialog.showModal()
  try {
    await modeler.importXML(options.xml)
  } catch (err) {
    say(T(`This decision model cannot be opened: ${err.message}`, `Ce modèle de décision ne s'ouvre pas : ${err.message}`), true)
    return
  }
  current.baseline = await currentXml()
  await showView(options.view || 'table')
  syncTabs()
}

export async function close() {
  if (!current) return
  const { modeler, baseline, mode, onSave, onClose } = current
  let xml = null
  try { xml = (await modeler.saveXML({ format: true })).xml } catch { /* modèle non chargé */ }
  const changed = xml && baseline && xml !== baseline
  if (changed && mode === 'library' && !confirm(T('Close without saving the changes to this decision model?', 'Fermer sans enregistrer les changements de ce modèle de décision ?'))) return
  current = null
  setSide(null)
  compare.reset()
  if (dialog.open) dialog.close()
  modeler.destroy()
  if (changed && mode === 'diagram' && onSave) await onSave(xml)
  onClose?.()
}

export const isDecisionEditorOpen = () => !!current
