// Analyse d'un journal d'événements (process mining), menu Expert : on dépose le tableau
// exporté d'un ERP, d'un CRM ou d'un outil de tickets (CSV ou XES), on associe ses colonnes
// puis ses étapes aux éléments du diagramme, et le canevas montre ce qui se passe vraiment :
// passages et part de chaque branche, durées et goulets, écarts au schéma. Sans diagramme,
// le journal sert à en dessiner un. Le fichier est lu dans la page et n'est envoyé nulle part.

import NavigatedViewer from 'bpmn-js/lib/NavigatedViewer'
import { layoutProcess } from 'bpmn-auto-layout'
import { getBusinessObject } from 'bpmn-js/lib/util/ModelUtil'
import { T, num, lang } from '../i18n/lang.js'
import { heatColor } from '../heatmap.js'
import { addDialogClose } from '../dialog-close.js'
import { fitView } from '../fit-view.js'
import { EXPERT_EVENT, setExpert } from '../expert-mode.js'
import { isModuleOn, MODULES_EVENT } from '../expert-modules.js'
import { track, range } from '../analytics.js'
import { parseCsv, guessColumns } from './table.js'
import { buildLog, fromRecords, parseXes } from './event-log.js'
import { matchActivities } from './match.js'
import { analyzeLog, aggregateOnly } from './analyze.js'
import { filterGraph, graphToBpmn } from './discover.js'
import { readSaved, savedUpdates, miningFingerprint } from './saved.js'
import { formatDuration, formatDate, formatShare as pct, deviationText as describe } from './texts.js'

const SVG_NS = 'http://www.w3.org/2000/svg'
const MAX_BYTES = 200 * 1024 * 1024
const PREVIEW_ROWS = 5
const OUTSIDE = ''
const EXAMPLE = () => T('order-example', 'exemple-commandes')

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

// Lecture d'un fichier : CSV, XES ou XES compressé (.xes.gz).
async function readFile(file) {
  if (file.size > MAX_BYTES) throw new Error(T('the file is over 200 MB', 'le fichier dépasse 200 Mo'))
  if (/\.gz$/i.test(file.name)) {
    if (typeof DecompressionStream === 'undefined') throw new Error(T('this browser cannot read .gz files', 'ce navigateur ne sait pas lire les fichiers .gz'))
    return new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text()
  }
  return file.text()
}

const looksXes = (name, text) => /\.xes(\.gz)?$/i.test(name) || /^\s*(<\?xml[^>]*>\s*)?<log[\s>]/i.test(text.slice(0, 500))

// Journal tiré d'un texte. columns (CSV) : index, ou noms d'en-têtes, ou rien pour deviner.
export function logFromText(text, { name = '', format = '', columns = null } = {}) {
  if (format === 'xes' || (!format && looksXes(name, text))) {
    const { records, skipped } = parseXes(text, new DOMParser())
    return { log: fromRecords(records, { name, skipped }), table: null, columns: null, format: 'xes' }
  }
  const table = parseCsv(text)
  let cols = guessColumns(table.headers)
  if (columns) {
    const index = (v) => (typeof v === 'number' ? v : v ? table.headers.findIndex((h) => h.toLowerCase() === String(v).toLowerCase()) : -1)
    cols = { ...cols, ...Object.fromEntries(Object.entries(columns).map(([k, v]) => [k, index(v)])) }
  }
  return { log: buildLog(table, cols, { name }), table, columns: cols, format: 'csv' }
}

export function setupMining(modeler, { menuButton, isSimulating = () => false } = {}) {
  const canvas = modeler.get('canvas')
  const elementRegistry = modeler.get('elementRegistry')
  const overlays = modeler.get('overlays')
  const eventBus = modeler.get('eventBus')
  const modeling = modeler.get('modeling')
  const commandStack = modeler.get('commandStack')
  const selection = modeler.get('selection')
  const container = canvas.getContainer()

  // Une action de l'analyse (pourcentages, totaux enregistrés) = une seule annulation.
  commandStack.register('bpmnPilot.mining', {
    preExecute(context) { context.run() },
    execute: () => [],
    revert: () => [],
  })
  const atomic = (run) => commandStack.execute('bpmnPilot.mining', { run })

  const state = {
    log: null, // journal complet : en mémoire seulement, jamais enregistré ni envoyé
    table: null,
    columns: null,
    format: '',
    mapping: null,
    result: null, // analyse complète (identifiants de cas compris, pour l'affichage local)
    fingerprint: '',
    saved: null, // totaux lus dans le fichier
    view: 'passes',
    shown: false,
  }

  // ── Éléments du diagramme qu'une étape peut désigner ──
  const candidates = () => elementRegistry.getAll()
    .filter((el) => el.type !== 'label' && !el.type.endsWith('Gateway') && getBusinessObject(el)?.$instanceOf?.('bpmn:FlowNode'))
    .map((el) => ({ id: el.id, name: getBusinessObject(el).name || '', type: el.type }))
  const nameOf = (id) => {
    const el = id && elementRegistry.get(id)
    return el ? (getBusinessObject(el).name || id) : (id || '')
  }
  const hasShapes = () => candidates().length > 0

  function autoMapping(log) {
    const found = matchActivities(log.activities.map((a) => a.activity), candidates())
    return Object.fromEntries(Object.entries(found).map(([k, v]) => [k, v ? v.id : null]))
  }

  // ═══ Fenêtre ═══
  let dialog = null
  let viewer = null
  let discovered = null

  function buildDialog() {
    dialog = document.createElement('dialog')
    dialog.id = 'mining-dialog'
    dialog.innerHTML = `<form method="dialog"><h2>${T('Analyze an event log (process mining)', 'Analyser un journal d\'événements (process mining)')}</h2><div class="mining-body"></div><div class="mining-actions"></div></form>`
    document.body.append(dialog)
    addDialogClose(dialog)
    dialog.addEventListener('close', () => {
      viewer?.destroy()
      viewer = null
    })
  }

  function open() {
    setExpert(true)
    if (!dialog) buildDialog()
    showStep(state.log ? 'activities' : 'file')
    if (!dialog.open) dialog.showModal()
  }
  menuButton?.addEventListener('click', open)

  const body = () => dialog.querySelector('.mining-body')
  const actions = () => dialog.querySelector('.mining-actions')
  function button(label, { primary = false, onClick, title = '', disabled = false, cls = '' } = {}) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = `btn${primary ? ' primary' : ''}${cls ? ` ${cls}` : ''}`
    b.textContent = label
    if (title) b.title = title
    b.disabled = disabled
    b.addEventListener('click', onClick)
    actions().append(b)
    return b
  }
  function error(text) {
    const p = body().querySelector('.mining-error') || Object.assign(document.createElement('p'), { className: 'mining-error' })
    p.textContent = text
    body().append(p)
  }

  function showStep(name) {
    viewer?.destroy()
    viewer = null
    actions().replaceChildren()
    if (name === 'file') stepFile()
    else if (name === 'columns') stepColumns()
    else if (name === 'activities') stepActivities()
    else if (name === 'discover') stepDiscover()
  }

  // ── 1. Fichier ──
  function stepFile() {
    const saved = state.saved
    body().innerHTML = `
      <p class="hint">${T('A table exported from your ERP, CRM or ticketing tool: one row per step carried out, with the case (order, file, ticket), the step and its date. CSV or XES format (IEEE 1849).',
        'Un tableau exporté de votre ERP, CRM ou outil de tickets : une ligne par étape réalisée, avec le dossier (commande, demande, ticket), l\'étape et sa date. Format CSV ou XES (norme IEEE 1849).')}</p>
      <label class="mining-drop" tabindex="0">
        <input type="file" accept=".csv,.txt,.tsv,.xes,.gz,text/csv,application/xml" hidden>
        <span class="mining-drop-icon" data-icon="mining" aria-hidden="true"></span>
        <strong>${T('Drop the file here, or click to choose it', 'Déposez le fichier ici, ou cliquez pour le choisir')}</strong>
        <span>${T('.csv, .xes or .xes.gz', '.csv, .xes ou .xes.gz')}</span>
      </label>
      <p class="mining-privacy">${T('The file is read on your computer and sent nowhere. Only totals (step names, counts, durations) can reach the AI co-pilot, when you ask it.',
        'Le fichier est lu sur votre poste et n\'est envoyé nulle part. Seuls des totaux (noms d\'étapes, nombres, durées) peuvent partir vers le Co-pilote IA, quand vous le lui demandez.')}</p>
      ${saved ? `<p class="mining-saved">${T('This diagram holds the totals of an earlier analysis', 'Ce diagramme contient les totaux d\'une analyse précédente')} : <strong>${esc(saved.source)}</strong>, ${num(saved.data.cases)} ${T('cases', 'dossiers')}.</p>` : ''}`
    const input = body().querySelector('input')
    const drop = body().querySelector('.mining-drop')
    input.addEventListener('change', () => input.files[0] && load(input.files[0]))
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click() } })
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over') })
    drop.addEventListener('dragleave', () => drop.classList.remove('over'))
    drop.addEventListener('drop', (e) => {
      e.preventDefault()
      drop.classList.remove('over')
      const file = e.dataTransfer.files[0]
      if (file) load(file)
    })
    button(T('Try with the example (412 fictitious orders)', 'Essayer avec l\'exemple (412 commandes fictives)'), { onClick: loadExample, cls: 'mining-example' })
    if (saved) button(T('Show the saved totals', 'Afficher les totaux enregistrés'), { onClick: () => { dialog.close(); showPanel('passes') } })
  }

  async function load(file) {
    try {
      const text = await readFile(file)
      ingest(text, file.name)
    } catch (err) {
      console.warn('Event log:', err)
      error(T(`Cannot read this file: ${err.message}`, `Lecture impossible : ${err.message}`))
    }
  }

  function ingest(text, name) {
    try {
      const r = logFromText(text, { name })
      Object.assign(state, { log: r.log, table: r.table, columns: r.columns, format: r.format, mapping: autoMapping(r.log) })
      track('journal-importe', { format: r.format, tranche: range(r.log.cases.length, [1, 100, 1000, 10000, 100000]) })
      showStep(r.format === 'csv' ? 'columns' : 'activities')
    } catch (err) {
      const reason = {
        columns: T('choose at least the case, the step and a date', 'choisissez au moins le dossier, l\'étape et une date'),
        empty: T('no usable row', 'aucune ligne exploitable'),
        xml: T('invalid XES file', 'fichier XES invalide'),
      }[err.message] || err.message
      if (err.message === 'columns' && state.table) return showStep('columns')
      error(T(`Cannot read this log: ${reason}.`, `Journal illisible : ${reason}.`))
    }
  }

  async function loadExample() {
    const base = `${import.meta.env.BASE_URL || '/'}examples/${EXAMPLE()}`
    try {
      const [csv, xml] = await Promise.all([fetch(`${base}.csv`).then((r) => r.text()), fetch(`${base}.bpmn`).then((r) => r.text())])
      // Le diagramme d'exemple va avec : il remplace un canevas vide, sinon on demande.
      if (!hasShapes() || confirm(T('Open the example diagram too? It replaces the current diagram (save it first if needed).', 'Ouvrir aussi le diagramme d\'exemple ? Il remplace le diagramme actuel (enregistrez-le d\'abord si besoin).'))) {
        await modeler.importXML(xml)
        fitView(canvas)
      }
      ingest(csv, `${EXAMPLE()}.csv`)
      track('journal-exemple')
    } catch (err) {
      error(T(`Cannot load the example: ${err.message}`, `Exemple indisponible : ${err.message}`))
    }
  }

  // ── 2. Colonnes (CSV) ──
  function stepColumns() {
    const { table } = state
    const cols = { ...state.columns }
    const fields = [
      ['case', T('Case', 'Dossier'), T('order, file or ticket number (case ID)', 'numéro de commande, de demande, de ticket (case ID)'), true],
      ['activity', T('Step', 'Étape'), T('what was done (activity)', 'ce qui a été fait (activity)'), true],
      ['start', T('Start', 'Début'), T('date and time the step started', 'date et heure du début de l\'étape'), false],
      ['end', T('End', 'Fin'), T('date and time it ended (timestamp)', 'date et heure de fin (timestamp)'), false],
      ['resource', T('Who', 'Qui'), T('person, team or system (resource), optional', 'personne, équipe ou système (resource), facultatif'), false],
    ]
    const options = (sel) => `<option value="-1">${T('(none)', '(aucune)')}</option>` + table.headers.map((h, i) => `<option value="${i}"${i === sel ? ' selected' : ''}>${esc(h)}</option>`).join('')
    body().innerHTML = `
      <p class="hint">${T(`${esc(state.log?.name || '')}: ${num(table.rows.length)} rows. Tell which column holds what. A date is enough (start or end); with both, step durations are measured too.`,
        `${esc(state.log?.name || '')} : ${num(table.rows.length)} lignes. Indiquez quelle colonne contient quoi. Une date suffit (début ou fin) ; avec les deux, la durée des étapes est mesurée aussi.`)}</p>
      <div class="mining-columns">${fields.map(([k, label, help, req]) => `
        <label><span class="mining-col-name">${label}${req ? ' *' : ''}</span><select data-col="${k}">${options(cols[k])}</select><span class="mining-col-help">${help}</span></label>`).join('')}
      </div>
      <div class="mining-preview-wrap"><table class="mining-preview"><thead><tr>${table.headers.map((h, i) => `<th data-i="${i}">${esc(h)}</th>`).join('')}</tr></thead>
      <tbody>${table.rows.slice(0, PREVIEW_ROWS).map((r) => `<tr>${r.map((c, i) => `<td data-i="${i}">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
    const mark = () => {
      const used = new Map(Object.entries(cols).filter(([, v]) => v >= 0).map(([k, v]) => [v, k]))
      for (const cell of body().querySelectorAll('[data-i]')) {
        const k = used.get(Number(cell.dataset.i))
        cell.className = k ? `col-${k}` : ''
      }
    }
    for (const sel of body().querySelectorAll('select')) {
      sel.addEventListener('change', () => { cols[sel.dataset.col] = Number(sel.value); mark() })
    }
    mark()
    button(T('Back', 'Retour'), { onClick: () => showStep('file') })
    button(T('Next', 'Suivant'), {
      primary: true,
      onClick: () => {
        try {
          const log = buildLog(state.table, cols, { name: state.log?.name || '' })
          Object.assign(state, { log, columns: cols, mapping: autoMapping(log) })
          showStep('activities')
        } catch (err) {
          error(err.message === 'columns'
            ? T('Choose at least the case, the step and a date.', 'Choisissez au moins le dossier, l\'étape et une date.')
            : T('No usable row with these columns: check the dates.', 'Aucune ligne exploitable avec ces colonnes : vérifiez les dates.'))
        }
      },
    })
  }

  function summaryLine(r) {
    const parts = [
      `<strong>${num(r.cases ?? r.cases?.length)}</strong> ${T('cases', 'dossiers')}`,
      `${num(r.events)} ${T('events', 'événements')}`,
      `${formatDate(r.from)} ${T('to', 'au')} ${formatDate(r.to)}`,
    ]
    if (r.cycle) parts.push(`${T('median case', 'durée médiane d\'un dossier')} ${formatDuration(r.cycle.median)}`)
    return parts.join(' · ')
  }

  // ── 3. Étapes ──
  function stepActivities() {
    const { log } = state
    const els = candidates()
    const cycle = log.cases.map((c) => c.events[c.events.length - 1].end - c.events[0].start).sort((a, b) => a - b)
    const head = summaryLine({ cases: log.cases.length, events: log.events, from: log.from, to: log.to, cycle: { median: cycle[Math.floor(cycle.length / 2)] } })
    const skipped = log.skipped ? `<p class="hint warn">${T(`${num(log.skipped)} row(s) ignored: missing case, step or readable date.`, `${num(log.skipped)} ligne(s) ignorée(s) : dossier, étape ou date manquants ou illisibles.`)}</p>` : ''
    if (!els.length) {
      body().innerHTML = `<p class="mining-summary">${head}</p>${skipped}
        <p class="hint">${T('The diagram is empty: BPMN Pilot can draw a first version of the process from the log. You review it, then the analysis runs on it.',
          'Le diagramme est vide : BPMN Pilot peut dessiner un premier jet du processus à partir du journal. Vous le relisez, puis l\'analyse se fait dessus.')}</p>`
      button(T('Other file', 'Autre fichier'), { onClick: () => showStep('file') })
      button(T('Draw the process from the log…', 'Dessiner le processus à partir du journal…'), { primary: true, onClick: () => showStep('discover') })
      return
    }
    const opts = (sel) => `<option value="${OUTSIDE}">${T('Not in the diagram', 'Hors modèle')}</option>` +
      els.map((e) => `<option value="${esc(e.id)}"${e.id === sel ? ' selected' : ''}>${esc(e.name || `${e.type.replace('bpmn:', '')} ${e.id}`)}</option>`).join('')
    const auto = autoMapping(log)
    body().innerHTML = `<p class="mining-summary">${head}</p>${skipped}
      <p class="hint">${T('Each step of the log is matched with an element of the diagram. Check the matches; a step absent from the diagram stays “Not in the diagram” and shows up as a deviation.',
        'Chaque étape du journal est rattachée à un élément du diagramme. Vérifiez les rapprochements ; une étape absente du schéma reste « Hors modèle » et apparaît dans les écarts.')}</p>
      <div class="mining-map-wrap"><table class="mining-map"><thead><tr><th>${T('Step in the log', 'Étape du journal')}</th><th>${T('Rows', 'Lignes')}</th><th>${T('Diagram element', 'Élément du diagramme')}</th></tr></thead><tbody>
      ${log.activities.map((a) => {
        const sel = state.mapping[a.activity] || OUTSIDE
        const how = auto[a.activity] && auto[a.activity] === sel ? (getBusinessObject(elementRegistry.get(sel))?.name === a.activity ? 'exact' : 'close') : ''
        return `<tr><td>${esc(a.activity)}</td><td class="num">${num(a.count)}</td><td><select data-activity="${esc(a.activity)}">${opts(sel)}</select>${how === 'close' ? `<span class="mining-tag">${T('close name', 'nom proche')}</span>` : ''}</td></tr>`
      }).join('')}
      </tbody></table></div>`
    for (const sel of body().querySelectorAll('select')) {
      sel.addEventListener('change', () => { state.mapping[sel.dataset.activity] = sel.value || null })
    }
    const none = !Object.values(state.mapping).some(Boolean)
    if (none) error(T('No step of the log matches the diagram. Match them by hand, or draw the process from the log.', 'Aucune étape du journal ne correspond au diagramme. Associez-les à la main, ou dessinez le processus à partir du journal.'))
    button(T('Other file', 'Autre fichier'), { onClick: () => showStep('file') })
    button(T('Draw the process from the log…', 'Dessiner le processus à partir du journal…'), { onClick: () => showStep('discover') })
    button(T('Analyze', 'Analyser'), {
      primary: true,
      onClick: () => {
        if (!Object.values(state.mapping).some(Boolean)) return error(T('Match at least one step with the diagram.', 'Associez au moins une étape au diagramme.'))
        analyze()
        dialog.close()
        showPanel('passes')
      },
    })
  }

  // ── 4. Dessin à partir du journal ──
  function stepDiscover() {
    const traces = state.log.cases.map((c) => c.events.map((e) => e.activity))
    body().innerHTML = `
      <p class="hint">${T('First version of the process, drawn from who follows whom in the log (directly-follows graph). Hide rare steps and paths to keep the main flow. This calculation only creates exclusive gateways; the AI co-pilot also recognizes parallel branches.',
        'Premier jet du processus, tiré de qui suit qui dans le journal (graphe des successions). Masquez les étapes et les chemins rares pour garder l\'essentiel. Ce calcul ne crée que des passerelles exclusives ; le Co-pilote IA reconnaît aussi les branches parallèles.')}</p>
      <div class="mining-sliders">
        <label>${T('Steps shown', 'Étapes affichées')} <input type="range" min="10" max="100" step="5" value="100" data-k="activities"><output></output></label>
        <label>${T('Paths shown', 'Chemins affichés')} <input type="range" min="10" max="100" step="5" value="90" data-k="paths"><output></output></label>
      </div>
      <p class="mining-hidden hint"></p>
      <div class="mining-viewer"></div>`
    viewer = new NavigatedViewer({ container: body().querySelector('.mining-viewer') })
    const sliders = [...body().querySelectorAll('input[type=range]')]
    let pending = 0
    const refresh = async () => {
      const v = Object.fromEntries(sliders.map((s) => [s.dataset.k, Number(s.value) / 100]))
      for (const s of sliders) s.nextElementSibling.textContent = `${s.value} %`
      const g = filterGraph(traces, v)
      const ticket = ++pending
      const { xml } = await layoutProcess(graphToBpmn(g, { processName: state.log.name.replace(/\.[^.]+$/, ''), startName: T('Start', 'Début'), endName: T('End', 'Fin') }))
      if (ticket !== pending || !viewer) return
      discovered = { graph: g, xml }
      body().querySelector('.mining-hidden').textContent = T(
        `${g.activities.length} steps, ${g.edges.length} paths shown. Hidden: ${g.hidden.activities} step(s), ${g.hidden.paths} rare path(s).`,
        `${g.activities.length} étapes, ${g.edges.length} chemins affichés. Masqués : ${g.hidden.activities} étape(s), ${g.hidden.paths} chemin(s) rare(s).`)
      await viewer.importXML(xml)
      viewer.get('canvas').zoom('fit-viewport', 'auto')
    }
    for (const s of sliders) s.addEventListener('input', refresh)
    refresh()
    button(T('Back', 'Retour'), { onClick: () => showStep(hasShapes() ? 'activities' : 'activities') })
    const ready = document.documentElement.classList.contains('copilot-ready')
    button(T('Ask the AI co-pilot', 'Demander au Co-pilote IA'), {
      disabled: !ready,
      title: ready
        ? T('Sends the co-pilot the totals of this graph (step names, counts), never the rows of the log', 'Envoie au Co-pilote les totaux de ce graphe (noms d\'étapes, nombres), jamais les lignes du journal')
        : T('Connect an AI model to the co-pilot to use this function', 'Connectez un modèle d\'IA au Co-pilote pour utiliser cette fonction'),
      onClick: () => {
        if (!discovered) return
        dialog.close()
        window.dispatchEvent(new CustomEvent('bpmn-pilot-copilot-ask', { detail: { text: copilotRequest(discovered.graph, state.log) } }))
        track('decouverte', { voie: 'copilote' })
      },
    })
    button(hasShapes() ? T('Replace the diagram with this one', 'Remplacer le diagramme par celui-ci') : T('Use this diagram', 'Utiliser ce schéma'), {
      primary: true,
      onClick: async () => {
        if (!discovered) return
        if (hasShapes() && !confirm(T('Replace the current diagram? Save it first if needed (Export or My diagrams).', 'Remplacer le diagramme actuel ? Enregistrez-le d\'abord si besoin (Exporter ou Mes diagrammes).'))) return
        await modeler.importXML(discovered.xml)
        fitView(canvas)
        state.mapping = autoMapping(state.log)
        analyze()
        dialog.close()
        showPanel('deviations')
        track('decouverte', { voie: 'calcul' })
      },
    })
  }

  // ═══ Analyse ═══
  function analyze() {
    state.result = analyzeLog(state.log, state.mapping, modeler.getDefinitions())
    state.fingerprint = miningFingerprint(modeler.getDefinitions())
    if (savedToggleOn()) writeSaved(true)
    return state.result
  }

  const stale = () => !!state.result && state.fingerprint !== miningFingerprint(modeler.getDefinitions())
  // Résultat à afficher : l'analyse en cours, sinon les totaux enregistrés dans le fichier.
  function current() {
    if (state.result) return { r: state.result, live: true, stale: stale() }
    if (state.saved) return { r: state.saved.data, live: false, stale: state.saved.fingerprint !== miningFingerprint(modeler.getDefinitions()), date: state.saved.date }
    return null
  }

  // Pourcentages observés écrits sur les branches (bpmnpilot:probabilitySource="log").
  function applyProbabilities() {
    const c = current()
    if (!c || c.stale) return 0
    let n = 0
    atomic(() => {
      for (const [flowId, b] of Object.entries(c.r.branches || {})) {
        const el = elementRegistry.get(flowId)
        if (!el) continue
        modeling.updateModdleProperties(el, getBusinessObject(el), { 'bpmnpilot:probability': Math.round(b.share * 1000) / 10, 'bpmnpilot:probabilitySource': 'log' })
        n++
      }
    })
    return n
  }

  // ── Totaux dans le fichier ──
  const savedToggleOn = () => !!panel.querySelector('.mining-keep input')?.checked
  function writeSaved(on) {
    const definitions = modeler.getDefinitions()
    const data = on && state.result ? aggregateOnly(state.result) : null
    if (on && !data) return
    const updates = savedUpdates(modeler.get('moddle'), definitions, data, { source: state.result?.source || '', fingerprint: state.fingerprint })
    if (!updates.length) return
    const root = canvas.getRootElement()
    atomic(() => { for (const u of updates) modeling.updateModdleProperties(root, u.bo, { extensionElements: u.extensionElements }) })
    state.saved = data ? readSaved(definitions) : null
  }

  // ═══ Panneau et calques sur le canevas ═══
  const panel = document.createElement('section')
  panel.className = 'mining-panel'
  panel.hidden = true
  panel.setAttribute('aria-label', 'Process mining')
  container.append(panel)

  function showPanel(view = state.view) {
    state.view = view
    state.shown = true
    render()
  }
  function hidePanel() {
    state.shown = false
    render()
  }

  const layer = () => canvas.getLayer('bpmn-pilot-mining', 1)

  function render() {
    const g = layer()
    g.replaceChildren()
    overlays.remove({ type: 'mining' })
    const c = current()
    const visible = state.shown && c && !isSimulating()
    panel.hidden = !visible
    container.classList.toggle('mining-on', !!visible)
    if (!visible) return
    renderPanel(c)
    if (c.stale) return
    if (state.view === 'passes') drawPasses(g, c.r)
    else if (state.view === 'durations') drawDurations(g, c.r)
    else drawDeviations(g, c.r)
  }

  function renderPanel(c) {
    const { r } = c
    const conf = r.conformance
    const tabs = [['passes', T('Passes', 'Passages')], ['durations', T('Durations', 'Durées')], ['deviations', T('Deviations', 'Écarts')]]
    panel.innerHTML = `
      <header><strong>${T('Process mining', 'Process mining')}</strong><span class="mining-source" title="${esc(r.source)}">${esc(r.source)}</span>
        <button type="button" class="btn icon-only mining-close" aria-label="${T('Close', 'Fermer')}" title="${T('Close', 'Fermer')}">×</button></header>
      <p class="mining-summary">${summaryLine(r)}</p>
      ${c.live ? '' : `<p class="mining-note">${T('Totals saved in the file', 'Totaux enregistrés dans le fichier')}${c.date ? ` (${formatDate(Date.parse(c.date))})` : ''}.</p>`}
      ${c.stale ? `<p class="mining-note warn">${T('The diagram changed since the analysis.', 'Le diagramme a changé depuis l\'analyse.')}</p>` : ''}
      <div class="mining-tabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" data-view="${k}" aria-selected="${state.view === k}">${l}</button>`).join('')}</div>
      <div class="mining-view"></div>
      <footer>
        ${c.live ? `<label class="mining-keep"><input type="checkbox"${state.saved ? ' checked' : ''}> ${T('Keep the totals in the .bpmn file', 'Garder les totaux dans le fichier .bpmn')}</label>` : ''}
        <span class="mining-grow"></span>
        ${state.log ? `<button type="button" class="btn mining-reopen">${c.stale ? T('Analyze again', 'Relancer l\'analyse') : T('Log…', 'Journal…')}</button>` : ''}
      </footer>`
    panel.querySelector('.mining-close').addEventListener('click', hidePanel)
    for (const t of panel.querySelectorAll('[data-view]')) t.addEventListener('click', () => { state.view = t.dataset.view; render(); track('process-mining', { vue: state.view }) })
    panel.querySelector('.mining-keep input')?.addEventListener('change', (e) => writeSaved(e.target.checked))
    panel.querySelector('.mining-reopen')?.addEventListener('click', () => {
      if (stale() && state.log) { analyze(); render() } else open()
    })
    const view = panel.querySelector('.mining-view')
    if (c.stale) {
      view.innerHTML = `<p class="mining-note">${state.log ? T('Click “Analyze again” to replay the log on the new diagram.', 'Cliquez sur « Relancer l\'analyse » pour rejouer le journal sur le nouveau diagramme.') : T('Open the log again to update the analysis.', 'Rouvrez le journal pour mettre l\'analyse à jour.')}</p>`
      return
    }
    if (state.view === 'passes') {
      const max = Math.max(1, ...Object.values(r.nodes))
      const branches = Object.keys(r.branches || {}).length
      view.innerHTML = `${scale(1, num(max))}
        <p class="mining-note">${T('Real passes per element and per flow. Badge: passes · share of cases. Dashed grey: never reached.', 'Passages réels par élément et par flux. Pastille : passages · part des dossiers. Gris pointillé : jamais atteint.')}</p>
        ${branches ? `<button type="button" class="btn mining-apply" title="${T('Writes the observed shares on the gateway branches; the simulation then runs on real figures. Undo with Ctrl+Z.', 'Écrit les parts observées sur les branches des passerelles ; la simulation tourne ensuite sur des chiffres réels. Annulable par Ctrl+Z.')}">${T('Apply the log percentages to the gateways', 'Appliquer les pourcentages du journal aux passerelles')}</button>` : ''}`
      view.querySelector('.mining-apply')?.addEventListener('click', (e) => {
        const n = applyProbabilities()
        e.target.textContent = T(`${n} branch(es) updated`, `${n} branche(s) mise(s) à jour`)
        e.target.disabled = true
        track('probabilites-journal')
      })
    } else if (state.view === 'durations') {
      const waits = Object.values(r.timing).map((t) => t.wait?.median || 0)
      const max = Math.max(0, ...waits)
      view.innerHTML = `${scale(formatDuration(0), formatDuration(max))}
        <p class="mining-note">${T('Colour: median wait before the step. Badge: wait · duration of the step', 'Couleur : attente médiane avant l\'étape. Pastille : attente · durée de l\'étape')}${r.hasDuration ? '' : T(' (no duration: the log has one date per step)', ' (pas de durée : le journal n\'a qu\'une date par étape)')}.</p>
        ${r.bottlenecks.length ? `<p class="mining-sub">${T('Longest waits (bottlenecks)', 'Attentes les plus longues (goulets d\'étranglement)')}</p>
        <ol class="mining-list">${r.bottlenecks.map((id) => `<li><a href="#" data-el="${esc(id)}">${esc(nameOf(id))}</a><span>${formatDuration(r.timing[id].wait.median)}</span></li>`).join('')}</ol>` : ''}`
    } else {
      const devs = conf.deviations
      view.innerHTML = `
        <p class="mining-big"><strong>${pct(conf.total ? conf.fitting / conf.total : 1)}</strong> ${T('of cases follow the diagram', 'des dossiers suivent le schéma')}
          <span>(${num(conf.fitting)} ${T('of', 'sur')} ${num(conf.total)} · ${T('fitness', 'conformité')} ${conf.fitness.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-US', { maximumFractionDigits: 2 })})</span></p>
        ${devs.length ? `<ol class="mining-list">${devs.slice(0, 8).map((d) => `<li><a href="#" data-el="${esc(d.element || d.after || '')}" title="${esc(examplesText(d))}">${esc(deviationText(d))}</a><span>${num(d.cases)}</span></li>`).join('')}</ol>` : `<p class="mining-note">${T('No deviation: every case follows the diagram.', 'Aucun écart : tous les dossiers suivent le schéma.')}</p>`}
        ${devs.length > 8 ? `<p class="mining-note">${T(`and ${devs.length - 8} more in the process report`, `et ${devs.length - 8} autre(s) dans le rapport de processus`)}</p>` : ''}`
    }
    for (const a of view.querySelectorAll('a[data-el]')) {
      a.addEventListener('click', (e) => {
        e.preventDefault()
        const el = elementRegistry.get(a.dataset.el)
        if (!el) return
        selection.select(el)
        canvas.scrollToElement(el, { top: 120, bottom: 220, left: 120, right: 120 })
      })
    }
  }

  function scale(lo, hi) {
    const gradient = [0, 0.35, 0.7, 1].map((t) => `${heatColor(t)} ${t * 100}%`).join(', ')
    return `<span class="mining-scale" style="background: linear-gradient(90deg, ${gradient})"></span><span class="mining-ticks"><span>${lo}</span><span>${hi}</span></span>`
  }

  function examplesText(d) {
    return d.examples?.length ? T('Examples: ', 'Exemples : ') + d.examples.join(', ') + (d.cases > d.examples.length ? '…' : '') : ''
  }

  const deviationText = (d) => describe(d, nameOf)

  // ── Dessin ──
  const isFlow = (el) => el.type === 'bpmn:SequenceFlow'
  const isNode = (el) => el.type !== 'label' && getBusinessObject(el)?.$instanceOf?.('bpmn:FlowNode') && el.width

  function shapeNode(el) {
    const { x, y, width: w, height: h } = el
    let node
    if (el.type.endsWith('Gateway')) {
      node = document.createElementNS(SVG_NS, 'polygon')
      node.setAttribute('points', `${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`)
    } else if (el.type.endsWith('Event')) {
      node = document.createElementNS(SVG_NS, 'circle')
      node.setAttribute('cx', x + w / 2)
      node.setAttribute('cy', y + h / 2)
      node.setAttribute('r', w / 2)
    } else {
      node = document.createElementNS(SVG_NS, 'rect')
      for (const [k, v] of Object.entries({ x, y, width: w, height: h, rx: 10, ry: 10 })) node.setAttribute(k, v)
    }
    return node
  }

  function paintShape(g, el, t, cls = '') {
    const node = shapeNode(el)
    node.setAttribute('class', t === null ? 'heat-shape cold' : `heat-shape ${cls}`)
    if (t !== null) {
      node.style.fill = heatColor(t)
      node.style.stroke = heatColor(t)
    }
    g.append(node)
  }

  function paintFlow(g, el, t) {
    if (!el.waypoints?.length) return
    const line = document.createElementNS(SVG_NS, 'polyline')
    line.setAttribute('points', el.waypoints.map((p) => `${p.x},${p.y}`).join(' '))
    line.setAttribute('class', t === null ? 'heat-flow cold' : 'heat-flow')
    if (t !== null) {
      line.style.stroke = heatColor(t)
      line.style.strokeWidth = String(2 + 5 * t)
    }
    g.append(line)
  }

  function badge(el, text, cls = '', title = '') {
    const div = document.createElement('div')
    div.className = `mining-badge ${cls}`
    div.textContent = text
    if (title) div.title = title
    // La pastille finit à gauche de celle de la documentation (src/doc/doc-badges.js), qui
    // occupe le coin haut droit : 20 px à partir de 10 px du bord, ou 8 px au-delà sur une
    // petite forme.
    overlays.add(el, 'mining', { position: { top: -11, right: el.width > 60 ? 14 : -6 }, html: div })
  }

  function drawPasses(g, r) {
    const max = Math.max(1, ...Object.values(r.nodes))
    const flowMax = Math.max(1, ...Object.values(r.flows))
    for (const el of elementRegistry.getAll()) if (isFlow(el)) paintFlow(g, el, r.flows[el.id] ? r.flows[el.id] / flowMax : null)
    for (const el of elementRegistry.getAll()) {
      if (!isNode(el)) continue
      const n = r.nodes[el.id] || 0
      paintShape(g, el, n ? n / max : null)
      if (n && !el.type.endsWith('Gateway')) badge(el, `${num(n)} · ${pct(n / r.cases)}`)
    }
    // Part de chaque branche, au départ du flux.
    for (const [flowId, b] of Object.entries(r.branches || {})) {
      const el = elementRegistry.get(flowId)
      if (!el?.waypoints?.length) continue
      const [a, c] = el.waypoints
      const div = document.createElement('div')
      div.className = 'mining-branch'
      div.textContent = pct(b.share)
      const left = (a.x + c.x) / 2 - el.x + 6
      const top = (a.y + c.y) / 2 - el.y + 4
      overlays.add(el, 'mining', { position: { left, top }, html: div })
    }
  }

  function drawDurations(g, r) {
    const max = Math.max(1, ...Object.values(r.timing).map((t) => t.wait?.median || 0))
    for (const el of elementRegistry.getAll()) if (isFlow(el)) paintFlow(g, el, null)
    for (const el of elementRegistry.getAll()) {
      if (!isNode(el)) continue
      const t = r.timing[el.id]
      if (!t) { if (!el.type.endsWith('Gateway')) paintShape(g, el, null); continue }
      const rank = r.bottlenecks.indexOf(el.id)
      paintShape(g, el, t.wait ? t.wait.median / max : 0, rank >= 0 ? 'bottleneck' : '')
      const parts = []
      if (t.wait) parts.push(`⏱ ${formatDuration(t.wait.median)}`)
      if (t.duration && r.hasDuration && !el.type.endsWith('Event')) parts.push(formatDuration(t.duration.median))
      if (parts.length) {
        badge(el, (rank >= 0 ? `#${rank + 1} · ` : '') + parts.join(' · '), rank >= 0 ? 'warn' : '',
          [t.wait && T(`Wait before: median ${formatDuration(t.wait.median)}, 90% under ${formatDuration(t.wait.p90)}`, `Attente avant : médiane ${formatDuration(t.wait.median)}, 90 % sous ${formatDuration(t.wait.p90)}`),
            t.duration && r.hasDuration && T(`Duration: median ${formatDuration(t.duration.median)}, 90% under ${formatDuration(t.duration.p90)}`, `Durée : médiane ${formatDuration(t.duration.median)}, 90 % sous ${formatDuration(t.duration.p90)}`)].filter(Boolean).join('\n'))
      }
    }
  }

  function drawDeviations(g, r) {
    const byEl = new Map()
    for (const d of r.conformance.deviations) {
      const id = d.kind === 'outside' ? d.after : d.element
      if (!id || !elementRegistry.get(id)) continue
      if (!byEl.has(id)) byEl.set(id, [])
      byEl.get(id).push(d)
    }
    for (const el of elementRegistry.getAll()) if (isFlow(el)) paintFlow(g, el, null)
    for (const el of elementRegistry.getAll()) {
      if (!isNode(el)) continue
      const list = byEl.get(el.id)
      if (!list) continue
      const node = shapeNode(el)
      node.setAttribute('class', 'mining-deviation')
      g.append(node)
      const short = (d) => ({
        skipped: T('skipped', 'sautée'),
        order: T(`before “${nameOf(d.other)}”`, `avant « ${nameOf(d.other)} »`),
        unexpected: T('unexpected', 'imprévue'),
        unfinished: T('stopped here', 'arrêt ici'),
        outside: `+ ${d.activity}`,
      })[d.kind]
      list.forEach((d, i) => {
        const div = document.createElement('div')
        div.className = 'mining-badge bad below'
        div.textContent = `${short(d)} · ${num(d.cases)}`
        div.title = `${deviationText(d)} : ${num(d.cases)} ${T('case(s)', 'dossier(s)')}\n${examplesText(d)}`
        overlays.add(el, 'mining', { position: { bottom: -6 - i * 22, left: -4 }, html: div })
      })
    }
  }

  // ── Événements ──
  eventBus.on('commandStack.changed', () => { if (state.shown) render() })
  eventBus.on('import.done', () => {
    state.saved = readSaved(modeler.getDefinitions())
    if (state.shown) render()
  })
  eventBus.on('tokenSimulation.toggleMode', () => { if (state.shown) render() })
  addEventListener(EXPERT_EVENT, ({ detail }) => { if (!detail.on) hidePanel() })
  addEventListener(MODULES_EVENT, () => { if (!isModuleOn('process-mining')) hidePanel() })

  // ═══ Pour le rapport de processus et les outils de l'IA ═══
  function ensureAnalysis() {
    if (!state.log) throw new Error('No event log loaded. Call load_event_log first.')
    if (!state.result || stale()) analyze()
    return state.result
  }

  return {
    open,
    // Totaux pour le rapport (jamais d'identifiant de cas ni de ressource).
    getReport() {
      const c = current()
      return c ? { ...aggregateOnly(c.r), stale: c.stale, live: c.live, savedDate: c.date || '' } : null
    },
    toolApi: {
      load({ content, name = 'event-log', format = '', columns = null }) {
        const r = logFromText(content, { name, format, columns })
        Object.assign(state, { log: r.log, table: r.table, columns: r.columns, format: r.format, mapping: autoMapping(r.log), result: null })
        track('journal-importe', { format: r.format, tranche: range(r.log.cases.length, [1, 100, 1000, 10000, 100000]), voie: 'outil' })
        return { log: r.log, mapping: state.mapping, columns: r.table ? Object.fromEntries(Object.entries(r.columns).map(([k, i]) => [k, i >= 0 ? r.table.headers[i] : null])) : null }
      },
      hasLog: () => !!state.log,
      log: () => state.log,
      mapping: () => ({ ...state.mapping }),
      setMapping(map) {
        if (!state.log) throw new Error('No event log loaded. Call load_event_log first.')
        for (const [activity, id] of Object.entries(map)) {
          if (!(activity in state.mapping)) throw new Error(`Unknown step in the log: ${activity}`)
          if (id && !elementRegistry.get(id)) throw new Error(`Unknown element: ${id}`)
          state.mapping[activity] = id || null
        }
        state.result = null
        return { ...state.mapping }
      },
      analyze(view) {
        const r = ensureAnalysis()
        showPanel(view)
        return aggregateOnly(r)
      },
      applyProbabilities() {
        ensureAnalysis()
        const n = applyProbabilities()
        showPanel('passes')
        return n
      },
      nameOf,
      deviationText,
    },
  }
}

// Demande au Co-pilote : le graphe des successions filtré, en totaux seulement.
export function copilotRequest(g, log) {
  const lines = [
    T(`Draw this process in the editor, in BPMN, from the directly-follows graph of an event log (${num(log.cases.length)} cases, ${formatDate(log.from)} to ${formatDate(log.to)}). Figures are numbers of passes.`,
      `Dessine ce processus dans l'éditeur, en BPMN, à partir du graphe des successions d'un journal d'événements (${num(log.cases.length)} dossiers, du ${formatDate(log.from)} au ${formatDate(log.to)}). Les chiffres sont des nombres de passages.`),
    T('Recognize exclusive choices, parallel branches (steps that appear in both orders) and loops; name each splitting gateway with a question; set the observed share of each branch as its probability; start from a blank diagram and tidy it up at the end.',
      'Repère les choix exclusifs, les branches parallèles (étapes qui apparaissent dans les deux ordres) et les boucles ; nomme chaque passerelle qui divise par une question ; mets la part observée de chaque branche en probabilité ; pars d\'un diagramme vide et range-le à la fin.'),
    '',
    T('Steps (passes):', 'Étapes (passages) :'),
    ...g.activities.map((a) => `- ${a.name} : ${num(a.count)}`),
    '',
    T('Start with:', 'Début par :'),
    ...g.starts.map((s) => `- ${s.name} : ${num(s.count)}`),
    T('End after:', 'Fin après :'),
    ...g.ends.map((s) => `- ${s.name} : ${num(s.count)}`),
    '',
    T('Successions (A → B : passes):', 'Successions (A → B : passages) :'),
    ...g.edges.map((e) => `- ${e.from} → ${e.to} : ${num(e.count)}`),
  ]
  return lines.join('\n')
}
