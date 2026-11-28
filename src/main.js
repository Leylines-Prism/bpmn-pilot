// En premier : refuse de démarrer dans le cadre d'un autre site (voir frame-guard.js).
import './frame-guard.js'
import BpmnModeler from 'bpmn-js/lib/Modeler'
import { BpmnPropertiesPanelModule, BpmnPropertiesProviderModule } from 'bpmn-js-properties-panel'
import minimapModule from 'diagram-js-minimap'
import TokenSimulationModule from 'bpmn-js-token-simulation'
import { CreateAppendAnythingModule } from 'bpmn-js-create-append-anything'
import BpmnColorPickerModule from 'bpmn-js-color-picker'
import { COLORS, CustomColorModule } from './color-palette.js'
import { LabelStyleModule } from './label-style.js'
import { AppearancePanelModule } from './appearance-panel.js'
import NativeCopyPasteModule from 'bpmn-js-native-copy-paste'
import LintModule from 'bpmn-js-bpmnlint'
import GridModule from 'diagram-js-grid'
import { CopyAsImageModule } from 'bpmn-js-copy-as-image'
import lintConfig from './lint/lint-config.js'
import { LintProcessBadgeModule } from './lint-process-badge.js'
import { LintNavigatorModule } from './lint-navigator.js'
import TranslateModule from './i18n/translate.js'
import { lang, T } from './i18n/lang.js'
import { translatePanelTitles } from './i18n/panel-titles.js'
import { setupPanelPopup } from './panel-popup.js'
import { applyStaticTexts } from './i18n/static-texts.js'
import { autoLayout } from './auto-layout.js'
import { importDiagram, setupXmlDialog, setupXmlExport, setupFileDrop } from './import-xml.js'
import { DOCUMENT_FORMATS, EXPORT_FORMATS, exportSize, hasShapes, renderExport } from './export-files.js'
import { createExportOffer } from './export-offer.js'
import { setupExportDestination } from './export-destination.js'
import { printDiagram } from './print-diagram.js'
import { setupHistory } from './history.js'
import { setupZoomButtons } from './zoom-buttons.js'
import { setupDiagramPlan } from './diagram-plan.js'

import 'bpmn-js/dist/assets/bpmn-js.css'
import 'bpmn-js/dist/assets/diagram-js.css'
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn.css'
import '@bpmn-io/properties-panel/assets/properties-panel.css'
import 'diagram-js-minimap/assets/diagram-js-minimap.css'
import 'bpmn-js-token-simulation/assets/css/bpmn-js-token-simulation.css'
import 'bpmn-js-color-picker/colors/color-picker.css'
import 'bpmn-js-bpmnlint/dist/assets/css/bpmn-js-bpmnlint.css'
import '@fontsource/urbanist/400.css'
import '@fontsource/urbanist/500.css'
import '@fontsource/urbanist/600.css'
import './brand/tokens.css'
import './theme/leylines.css'
import './doc/doc.css'
import './dmn/dmn.css'
import './forms/forms.css'
import './sub-levels.css'
import { setupThemeToggle } from './theme/theme-toggle.js'
import { setupBrandLogo } from './theme/brand-logo.js'
import { setupPanelToggle } from './panel-toggle.js'
import { setupPresentation } from './presentation.js'
import { setupSimulationSpeed } from './simulation-speed.js'
import { setupSimulationAutopilot } from './simulation-autopilot.js'
import PaletteProfilesModule from './palette-profiles.js'
import { setupMining } from './mining/mining-ui.js'
import { setupHeatmap } from './heatmap.js'
import { setupExpertMode, setExpert, isExpert, EXPERT_EVENT } from './expert-mode.js'
import { setupExpertModules, isModuleOn, MODULES_EVENT } from './expert-modules.js'
import { ProbabilityPanelModule, isBranchFlow } from './probability-panel.js'
import { RulesPanelModule } from './rules-panel.js'
import { AgentStepModule } from './agent-step.js'
import { GoalPanelModule } from './goal-panel.js'
import bpmnPilotModdle from './bpmn-pilot-moddle.json'
import zeebeModdle from 'zeebe-bpmn-moddle/resources/zeebe.json'
import { DecisionPanelModule } from './dmn/decision-links.js'
import { FormPanelModule } from './forms/form-links.js'
import { setupForms } from './forms/setup.js'
import { PanelOrderModule } from './panel-order.js'
import { SubLevelPanelModule, setupSubLevels } from './sub-levels.js'
import { setupDecisions } from './dmn/setup.js'
import { buildReport, reportToMarkdown, reportToPdf } from './process-report.js'
import { setupSmallScreenNotice } from './small-screen.js'
import { setupPwa } from './pwa/register.js'
import { setupInstallButton } from './pwa/install.js'
import { makeResizable } from './panel-resize.js'
import { fitView } from './fit-view.js'
import { setupDeepLink } from './deep-link.js'
import { setupDiagramLibrary } from './diagram-library.js'
import { MAX_RETURNED_FILE_BYTES } from './ai/file-result.js'
import { createHeadlessOffer } from './headless-offer.js'
import { setupFeedback } from './feedback.js'
import { setupAnalytics, track } from './analytics.js'
import { setupUsageEvents } from './usage-events.js'
import { APP_VERSION, IS_DEV_SITE, OTHER_SITE } from './site-channel.js'
import { setupDocEditor } from './doc/doc-editor.js'
import { setupDocBadges } from './doc/doc-badges.js'
import { setupDocSearch } from './doc/doc-search.js'
import { setupTableDialog } from './table-dialog.js'
import { rowsToXlsx } from './sheet-io.js'
import { setupGridDialog } from './grid-dialog.js'
import { setupMermaidDialog, setupMermaidExport } from './mermaid-dialog.js'
import { looksLikeMermaid } from './mermaid-import.js'
import { EXPERT_ASKS } from './ai/prompts.js'

const EMPTY_DIAGRAM = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  targetNamespace="http://bpmn.io/schema/bpmn">
  <process id="Process_1" isExecutable="false">
    <startEvent id="StartEvent_1" name="${T('Start', 'Début')}">
      <outgoing>Flow_1</outgoing>
    </startEvent>
    <task id="Task_1" name="${T('Task', 'Tâche')}">
      <incoming>Flow_1</incoming>
      <outgoing>Flow_2</outgoing>
    </task>
    <endEvent id="EndEvent_1" name="${T('End', 'Fin')}">
      <incoming>Flow_2</incoming>
    </endEvent>
    <sequenceFlow id="Flow_1" sourceRef="StartEvent_1" targetRef="Task_1"/>
    <sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="EndEvent_1"/>
  </process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="StartEvent_1_di" bpmnElement="StartEvent_1">
        <dc:Bounds x="152" y="82" width="36" height="36"/>
        <bpmndi:BPMNLabel><dc:Bounds x="145" y="125" width="50" height="14"/></bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_1_di" bpmnElement="Task_1">
        <dc:Bounds x="250" y="60" width="100" height="80"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="EndEvent_1_di" bpmnElement="EndEvent_1">
        <dc:Bounds x="412" y="82" width="36" height="36"/>
        <bpmndi:BPMNLabel><dc:Bounds x="409" y="125" width="43" height="14"/></bpmndi:BPMNLabel>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="188" y="100"/><di:waypoint x="250" y="100"/>
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_2_di" bpmnElement="Flow_2">
        <di:waypoint x="350" y="100"/><di:waypoint x="412" y="100"/>
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</definitions>`

const LS_KEY = 'bpmn-editor-autosave'
const DEFAULT_NAME = T('diagram', 'diagramme')
const NAME_KEY = 'bpmn-editor-filename'

// Nom de base (sans extension) de l'enregistrement et des exports. Il se règle
// dans le champ de la barre d'outils, prérempli avec le nom du fichier ouvert,
// et il est retenu avec la sauvegarde automatique.
const nameInput = document.getElementById('file-name')

function cleanName(value) {
  return value
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '') // caractères refusés dans un nom de fichier
    .replace(/\.(bpmn|xml|svg|png|pdf)$/i, '')
    .replace(/^[.\s]+|[.\s]+$/g, '')
}
function baseName() {
  return cleanName(nameInput.value) || DEFAULT_NAME
}
function rememberName() {
  try { localStorage.setItem(NAME_KEY, baseName()) } catch {}
}
function setBaseName(name) {
  nameInput.value = cleanName(name) || DEFAULT_NAME
  rememberName()
}
nameInput.addEventListener('input', rememberName)
nameInput.addEventListener('change', () => { nameInput.value = baseName() })
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === 'Escape') nameInput.blur()
})

const modeler = new BpmnModeler({
  container: '#canvas',
  propertiesPanel: { parent: '#properties-panel' },
  linting: { bpmnlint: lintConfig, active: true },
  colorPicker: { colors: COLORS },
  // Probabilités des branches pour la carte de chaleur (attribut bpmnpilot:probability).
  // Tables de décision : lien bpmnpilot:decisionRef, et zeebe:calledDecision pour Camunda 8.
  moddleExtensions: { bpmnpilot: bpmnPilotModdle, zeebe: zeebeModdle },
  additionalModules: [
    BpmnPropertiesPanelModule,
    BpmnPropertiesProviderModule,
    minimapModule,
    TokenSimulationModule,
    CreateAppendAnythingModule,
    PaletteProfilesModule,
    BpmnColorPickerModule,
    CustomColorModule,
    LabelStyleModule,
    AppearancePanelModule,
    NativeCopyPasteModule,
    LintModule,
    LintProcessBadgeModule,
    LintNavigatorModule,
    GridModule,
    CopyAsImageModule,
    ProbabilityPanelModule,
    RulesPanelModule,
    DecisionPanelModule,
    FormPanelModule,
    SubLevelPanelModule,
    AgentStepModule,
    GoalPanelModule,
    PanelOrderModule,
    ...(lang === 'fr' ? [TranslateModule] : []),
  ],
})

setupDeepLink(modeler)
setupHistory({
  modeler,
  undoButton: document.getElementById('btn-undo'),
  redoButton: document.getElementById('btn-redo'),
})
setupZoomButtons(modeler, document.getElementById('zoom-buttons'))
const diagramPlan = setupDiagramPlan(modeler, { button: document.getElementById('btn-plan') })

// Onglet invisible du mode sans navigateur (version Docker) : le serveur l'ouvre avec ?headless=<clé>.
// Il part d'un diagramme vide, sans reprendre le travail gardé par ce navigateur.
const HEADLESS_KEY = (() => {
  try {
    const key = new URLSearchParams(location.search).get('headless')
    return key && /^[0-9a-f]{32}$/.test(key) ? key : null
  } catch {
    return null
  }
})()

// Toile vraiment vide, pour l'onglet invisible : l'agent part de rien, sans le trio Début, Tâche, Fin.
const BLANK_DIAGRAM = `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
  targetNamespace="http://bpmn.io/schema/bpmn">
  <process id="Process_1" isExecutable="false"/>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1"/>
  </bpmndi:BPMNDiagram>
</definitions>`

async function loadInitial() {
  const saved = HEADLESS_KEY ? BLANK_DIAGRAM : localStorage.getItem(LS_KEY)
  let savedName = null
  try { savedName = localStorage.getItem(NAME_KEY) } catch {}
  nameInput.value = (saved && savedName && !HEADLESS_KEY && cleanName(savedName)) || DEFAULT_NAME
  try {
    await modeler.importXML(saved || EMPTY_DIAGRAM)
    fitView(modeler.get('canvas'))
    setStatus(saved && !HEADLESS_KEY ? T('previous work restored', 'travail précédent restauré') : T('New diagram', 'Nouveau diagramme'))
  } catch (e) {
    console.error('Import error:', e)
    await modeler.importXML(EMPTY_DIAGRAM)
    fitView(modeler.get('canvas'))
  }
}

let saveTimer = null
function setStatus(msg) {
  document.getElementById('autosave-status').textContent = T('Autosave: ', 'Sauvegarde auto : ') + msg
}

// Diagramme ouvert depuis un fichier chiffré : il n'est pas recopié en clair dans le
// navigateur. La sauvegarde automatique reprend au prochain Nouveau ou à la prochaine
// ouverture d'un fichier non chiffré.
let sensitive = false

async function autosave({ quiet = false } = {}) {
  if (sensitive) {
    localStorage.removeItem(LS_KEY)
    if (!quiet) setStatus(T('off for this encrypted file', 'désactivée pour ce fichier chiffré'))
    return
  }
  try {
    const { xml } = await modeler.saveXML({ format: true })
    localStorage.setItem(LS_KEY, xml)
    if (!quiet) setStatus(new Date().toLocaleTimeString(lang === 'fr' ? 'fr-FR' : 'en-US'))
  } catch { setStatus(T('error', 'erreur')) }
}

// Modifications non enregistrées dans « Mes diagrammes ».
let dirty = false

modeler.on(['commandStack.changed', 'layout.done', 'history.restored'], () => {
  dirty = true
  clearTimeout(saveTimer)
  saveTimer = setTimeout(autosave, 1000)
})

document.getElementById('btn-new').addEventListener('click', async () => {
  if (!confirm(T('Create a new diagram? The current diagram will be lost if it has not been saved.', 'Créer un nouveau diagramme ? Le diagramme actuel sera perdu si non sauvegardé.'))) return
  localStorage.removeItem(LS_KEY)
  sensitive = false
  library.unlink()
  dirty = false
  setBaseName(DEFAULT_NAME)
  await modeler.importXML(EMPTY_DIAGRAM)
  fitView(modeler.get('canvas'))
  setStatus(T('New', 'Nouveau'))
  track('nouveau-diagramme')
})

document.getElementById('btn-open').addEventListener('click', () => {
  document.getElementById('file-input').click()
})

// Import commun au bouton Ouvrir, au glisser-déposer et à la fenêtre Importer XML.
// Renvoie un message d'erreur, ou rien si l'import a réussi.
async function importAndReport(xml, fileName, { encrypted = false } = {}) {
  try {
    const { warnings, laidOut } = await importDiagram(modeler, xml)
    sensitive = encrypted
    library.unlink()
    setBaseName(fileName ? fileName.replace(/\.(bpmn|xml)$/i, '') : DEFAULT_NAME)
    // Le diagramme ouvert est sauvegardé tout de suite, avec son nom : un
    // rechargement de la page le retrouve même sans modification.
    clearTimeout(saveTimer)
    await autosave({ quiet: true }) // garde le message d'import dans la barre
    let status = fileName ? T('File opened', 'Fichier ouvert') : T('XML imported', 'XML importé')
    if (encrypted) status = T('Encrypted file opened, not kept in the browser', 'Fichier chiffré ouvert, non gardé dans le navigateur')
    if (laidOut) status += T(', laid out automatically (no diagram layout in the file)', ', rangé automatiquement (pas de partie graphique)')
    if (warnings.length) {
      status += ', ' + warnings.length + (warnings.length > 1 ? T(' warnings', ' avertissements') : T(' warning', ' avertissement')) + T(' (see the console)', ' (voir la console)')
      console.warn('Avertissements d\'import :', warnings)
    }
    setStatus(status)
  } catch (err) {
    return err.message
  }
}

async function importFile(file) {
  // Fichier chiffré par mot de passe : déchiffré dans la page, puis ouvert comme un .bpmn.
  if (/\.enc$/i.test(file.name)) {
    const { isEncrypted, decryptText, askPassword } = await import('./encrypted-file.js')
    const content = await file.text()
    if (!isEncrypted(content)) {
      alert(T('This file is not an encrypted BPMN Pilot diagram.', 'Ce fichier n\'est pas un diagramme BPMN Pilot chiffré.'))
      return
    }
    for (;;) {
      const password = await askPassword({ fileName: file.name })
      if (password === null) return
      try {
        const xml = await decryptText(content, password)
        const failure = await importAndReport(xml, file.name.replace(/\.enc$/i, ''), { encrypted: true })
        if (failure) alert(T('Import failed: ', 'Import impossible : ') + failure)
        else track('fichier-ouvert', { source: 'chiffre' })
        return
      } catch (err) {
        if (err.message !== 'wrong password') { alert(T('Import failed: ', 'Import impossible : ') + err.message); return }
        alert(T('Wrong password.', 'Mot de passe incorrect.'))
      }
    }
  }
  // Un .dmn déposé sur l'éditeur rejoint les décisions du diagramme ouvert (mode Expert).
  if (/\.dmn$/i.test(file.name)) return decisions.importDmnFile(file)
  // Un fichier Mermaid (.mmd, .mermaid, ou .md qui contient un bloc mermaid) ouvre la fenêtre Depuis Mermaid.
  if (/\.(mmd|mermaid|md|markdown)$/i.test(file.name)) {
    const content = await file.text()
    if (/\.(mmd|mermaid)$/i.test(file.name) || looksLikeMermaid(content)) {
      mermaidDialog.openWith(content, { name: file.name.replace(/\.(mmd|mermaid|md|markdown)$/i, '') })
      return
    }
  }
  if (!/\.(bpmn|xml)$/i.test(file.name)) {
    track('fichier-invalide', { cause: 'format' })
    alert(T('Unsupported format: choose a .bpmn, .xml or .mmd file.', 'Format non pris en charge : choisissez un fichier .bpmn, .xml ou .mmd.'))
    return
  }
  const failure = await importAndReport(await file.text(), file.name)
  if (failure) {
    track('fichier-invalide', { cause: 'lecture' })
    alert(T('Import failed: ', 'Import impossible : ') + failure)
  } else track('fichier-ouvert', { source: 'fichier' })
}

document.getElementById('file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0]
  e.target.value = ''
  if (file) await importFile(file)
})

setupXmlDialog({
  openButton: document.getElementById('btn-import-xml'),
  fileInput: document.getElementById('file-input'),
  onImport: async (xml) => {
    // Un flowchart Mermaid collé ici passe par la fenêtre Depuis Mermaid, pour voir ce qui sera créé.
    if (looksLikeMermaid(xml)) {
      mermaidDialog.openWith(xml, { message: T('Mermaid text recognized: check the preview, then create the diagram.', 'Texte Mermaid reconnu : vérifiez l\'aperçu, puis créez le diagramme.') })
      return
    }
    const failure = await importAndReport(xml, null)
    track(failure ? 'fichier-invalide' : 'fichier-ouvert', failure ? { cause: 'xml' } : { source: 'xml' })
    return failure
  },
})
setupFileDrop({ onFile: importFile })

// Ouvrir > Depuis un tableau : une ligne par étape, convertie sans IA.
const tableDialog = setupTableDialog({
  openButton: document.getElementById('btn-import-table'),
  download: (content, name, ext, type) => download(content, `${name}.${ext}`, type),
  onCreate: async (xml, name) => {
    const failure = await importAndReport(xml, name)
    if (!failure) setStatus(T('Diagram created from the table', 'Diagramme créé depuis le tableau'))
    track(failure ? 'fichier-invalide' : 'fichier-ouvert', failure ? { cause: 'tableau' } : { source: 'tableau' })
    return failure
  },
})

// Ouvrir > Grille rôles × tâches : saisie d'atelier, un clic par tâche dans la colonne du rôle.
setupGridDialog({
  openButton: document.getElementById('btn-import-grid'),
  openTable: (rows) => tableDialog.openWith(rows),
  onCreate: async (xml, name) => {
    const failure = await importAndReport(xml, name)
    if (!failure) setStatus(T('Diagram created from the grid', 'Diagramme créé depuis la grille'))
    track(failure ? 'fichier-invalide' : 'fichier-ouvert', failure ? { cause: 'grille' } : { source: 'grille' })
    return failure
  },
})

// Ouvrir > Depuis Mermaid : un flowchart converti sans IA, puis rangé automatiquement.
const mermaidDialog = setupMermaidDialog({
  openButton: document.getElementById('btn-import-mermaid'),
  onCreate: async (xml, name) => {
    const failure = await importAndReport(xml, name)
    if (!failure) setStatus(T('Diagram created from Mermaid', 'Diagramme créé depuis Mermaid'))
    track(failure ? 'fichier-invalide' : 'fichier-ouvert', failure ? { cause: 'mermaid' } : { source: 'mermaid' })
    return failure
  },
})

// Ouvrir > Comparer avec un fichier : le fichier choisi à gauche, le diagramme ouvert à droite.
document.getElementById('btn-compare-file').addEventListener('click', () => {
  document.getElementById('compare-input').click()
})
document.getElementById('compare-input').addEventListener('change', async (e) => {
  const file = e.target.files[0]
  e.target.value = ''
  if (!file) return
  if (!/\.(bpmn|xml)$/i.test(file.name)) {
    alert(T('Unsupported format: choose a .bpmn or .xml file.', 'Format non pris en charge : choisissez un fichier .bpmn ou .xml.'))
    return
  }
  const { xml } = await modeler.saveXML({ format: true })
  const { openCompare } = await import('./compare.js')
  track('comparer', { source: 'fichier' })
  await openCompare({
    title: T('Compare', 'Comparer'),
    before: { xml: await file.text(), title: file.name },
    after: { xml, title: T('Open diagram', 'Diagramme ouvert') + ' · ' + baseName() },
  })
})

// Adresse du serveur mcp/ (pont, chat, diagrammes) : en développement, dans l'image
// docker (adresse relative « /bridge », relayée par nginx), ou VITE_MCP_BRIDGE_URL.
// Pas de serveur dans la version en ligne.
const configuredBridge = import.meta.env.MODE === 'online'
  ? ''
  : import.meta.env.VITE_MCP_BRIDGE_URL || (import.meta.env.DEV ? 'ws://127.0.0.1:3333/bridge' : '')
const mcpBridgeUrl = configuredBridge.startsWith('/')
  ? `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${configuredBridge}`
  : configuredBridge

const library = setupDiagramLibrary({
  button: document.getElementById('btn-library'),
  getXml: async () => (await modeler.saveXML({ format: true })).xml,
  getName: baseName,
  setName: setBaseName,
  openXml: (xml, name) => importAndReport(xml, name),
  setStatus: (msg) => { document.getElementById('autosave-status').textContent = msg },
  isDirty: () => dirty,
  markClean: () => { dirty = false },
  serverUrl: mcpBridgeUrl ? mcpBridgeUrl.replace(/^ws/, 'http').replace(/\/bridge$/, '/diagrams') : null,
  openDecisionModel: (item) => decisions.openDecisionModel(item),
})

// Carte à plusieurs niveaux : une activité d'appel ouvre le diagramme qui la détaille, fil d'Ariane
// pour remonter (src/sub-levels.js).
setupSubLevels(modeler, {
  library,
  getName: baseName,
  setStatus: (msg) => { document.getElementById('autosave-status').textContent = msg },
  showPanelGroup: () => {
    const toggle = document.getElementById('btn-properties')
    if (toggle?.getAttribute('aria-expanded') === 'false') toggle.click()
  },
})

// Version docker : le menu Exporter peut aussi déposer les fichiers dans le dossier du serveur.
const { deliver, sendToServer } = setupExportDestination({
  menu: document.getElementById('export-menu'),
  exportsUrl: mcpBridgeUrl ? mcpBridgeUrl.replace(/^ws/, 'http').replace(/\/bridge$/, '/exports') : null,
  download,
  setStatus: (msg) => { document.getElementById('autosave-status').textContent = msg },
})

// Entrées du menu Exporter qui produisent un fichier : même rendu que l'outil export_diagram.
async function exportFile(format) {
  const { content, ext, type } = await renderExport(modeler, format)
  await deliver(content, baseName(), ext, type)
  track('export', { format })
}

document.getElementById('btn-save').addEventListener('click', () => exportFile('bpmn'))

// Menus Ouvrir et Exporter : ouverts sous leur bouton, refermés dès qu'une entrée est choisie.
for (const menu of document.querySelectorAll('#toolbar .menu[popover]')) {
  const anchor = document.querySelector(`[popovertarget="${menu.id}"]`)
  menu.addEventListener('beforetoggle', (e) => {
    if (e.newState !== 'open') return
    const r = anchor.getBoundingClientRect()
    menu.style.left = r.left + 'px'
    menu.style.top = (r.bottom + 4) + 'px'
  })
  menu.addEventListener('click', (e) => {
    if (e.target.closest('button')) menu.hidePopover()
  })
}

document.getElementById('btn-save-xml').addEventListener('click', () => exportFile('xml'))

setupXmlExport({
  openButton: document.getElementById('btn-xml'),
  getXml: async () => (await modeler.saveXML({ format: true })).xml,
  download: (xml) => {
    download(xml, baseName() + '.xml', 'application/xml')
    track('export', { format: 'xml' })
  },
})

setupMermaidExport({
  openButton: document.getElementById('btn-mermaid'),
  getDefinitions: () => modeler.getDefinitions(),
  download: (text) => {
    download(text, baseName() + '.mmd', 'text/plain')
    track('export', { format: 'mermaid' })
  },
})

document.getElementById('btn-svg').addEventListener('click', () => exportFile('svg'))

document.getElementById('btn-png').addEventListener('click', async () => {
  try {
    await exportFile('png')
  } catch {
    alert(T('PNG export unavailable, use the SVG export.', 'Export PNG indisponible, utilise Export SVG.'))
  }
})

document.getElementById('btn-pdf').addEventListener('click', async (e) => {
  const button = e.currentTarget
  button.disabled = true
  try {
    if (!hasShapes(modeler)) throw new Error(T('the diagram is empty', 'le diagramme est vide'))
    await exportFile('pdf')
  } catch (err) {
    console.error('PDF export error:', err)
    alert(T('PDF export failed: ', 'Export PDF impossible : ') + err.message)
  } finally {
    button.disabled = false
  }
})

// Fichiers du menu Exporter tirés du diagramme : Camunda, rapport, fiches, page HTML, récits,
// RACI et décisions. Les boutons et l'outil export_diagram passent par buildDocument, pour que
// l'IA produise exactement le fichier d'un export à la main.
// Un fichier qui n'a rien à montrer (aucun RACI, aucun récit, aucune décision) lève une erreur
// marquée notice : le bouton l'affiche telle quelle, l'outil la renvoie à l'agent.
function nothingToExport(en, fr) {
  return Object.assign(new Error(en), { notice: T(en, fr) })
}

// Rapport de processus (menu Expert et outil get_process_report). Il reprend les comptes
// de la dernière simulation, s'il y en a une.
const reportName = () => `${baseName()} - ${T('process report', 'rapport de processus')}`

async function processReport({ simulate = false } = {}) {
  const simulation = simulate ? heatmap.runBatch() : heatmap.getResult()
  const { checkDiagram } = await import('./diagram-checks.js')
  const checks = await checkDiagram(modeler).catch((err) => { console.warn('Quality checks for the report:', err); return null })
  const decisionReport = await decisions.report().catch((err) => { console.warn('Decisions for the report:', err); return null })
  return buildReport(modeler, { name: baseName(), simulation, checks, decisions: decisionReport, mining: mining.getReport() })
}

// Export Word : le texte de l'export Markdown, en styles Word, avec l'image du diagramme.
const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
async function wordFile(markdown, report) {
  const [{ markdownToDocx }, { content }] = await Promise.all([import('./export-docx.js'), renderExport(modeler, 'png')])
  const png = new Uint8Array(await content.arrayBuffer())
  const bytes = await markdownToDocx(markdown, { title: report.title, png, imageName: report.title, lang })
  return new Blob([bytes], { type: DOCX_TYPE })
}

// Renvoie { content, name, ext, type, summary? } pour un format de DOCUMENT_FORMATS.
async function buildDocument(format) {
  if (format === 'dmn') {
    const xml = decisions.service.getXml()
    if (!xml) throw nothingToExport('This diagram has no decision yet: create one from a business rule task.', 'Ce diagramme n\'a pas encore de décision : créez-en une depuis une tâche de règle métier.')
    return { content: xml, name: baseName(), ext: 'dmn', type: 'application/xml' }
  }
  if (format === 'forms') {
    const file = await forms.exportFile()
    if (!file) throw nothingToExport('This diagram has no form yet: create one from a user task or a start event (Expert > Task forms).', 'Ce diagramme n\'a pas encore de formulaire : créez-en un depuis une tâche utilisateur ou un événement de début (Expert > Formulaires des tâches).')
    return file
  }
  if (!hasShapes(modeler)) throw nothingToExport('The diagram is empty: nothing to export.', 'Le diagramme est vide : rien à exporter.')
  if (format === 'camunda8' || format === 'camunda7') {
    const target = format === 'camunda8' ? 8 : 7
    const [{ toCamunda }, { xml }] = await Promise.all([import('./export-camunda.js'), modeler.saveXML({ format: true })])
    const { xml: out, summary } = await toCamunda(modeler.get('moddle'), xml, target)
    return { content: out, name: `${baseName()} - Camunda ${target}`, ext: 'bpmn', type: 'application/xml', summary: { target, ...summary } }
  }
  const report = await processReport()
  if (format.startsWith('report-')) {
    const kind = format.slice(7)
    if (kind === 'md') return { content: reportToMarkdown(report), name: reportName(), ext: 'md', type: 'text/markdown' }
    if (kind === 'docx') return { content: await wordFile(reportToMarkdown(report), report), name: reportName(), ext: 'docx', type: DOCX_TYPE }
    return { content: await reportToPdf(modeler, report), name: reportName(), ext: 'pdf', type: 'application/pdf' }
  }
  if (format.startsWith('sheets-')) {
    const kind = format.slice(7)
    const { sheetsToMarkdown, sheetsToPdf } = await import('./doc/procedure-sheets.js')
    const name = `${baseName()} - ${T('procedure sheets', 'fiches de procédure')}`
    if (kind === 'md') return { content: sheetsToMarkdown(report), name, ext: 'md', type: 'text/markdown' }
    if (kind === 'docx') return { content: await wordFile(sheetsToMarkdown(report), report), name, ext: 'docx', type: DOCX_TYPE }
    return { content: await sheetsToPdf(report), name, ext: 'pdf', type: 'application/pdf' }
  }
  if (format === 'doc-html') {
    const [{ docPageHtml }, { svg }] = await Promise.all([import('./doc/doc-page.js'), modeler.saveSVG()])
    return { content: docPageHtml({ report, svg }), name: `${baseName()} - ${T('documentation', 'documentation')}`, ext: 'html', type: 'text/html' }
  }
  if (format === 'stories-md') {
    const { storiesToMarkdown, activitiesWithStories } = await import('./user-stories.js')
    if (!activitiesWithStories(report).length) {
      throw nothingToExport('No activity has a user story or an acceptance criterion yet. Select an activity and fill in the User stories group of the Process panel, or ask the co-pilot (Expert > User stories by activity).',
        'Aucune activité n\'a encore de récit utilisateur ni de critère d\'acceptation. Sélectionnez une activité et remplissez le groupe Récits utilisateur du panneau Processus, ou demandez au Co-pilote (Expert > Récits utilisateur par activité).')
    }
    return { content: storiesToMarkdown(report), name: `${baseName()} - ${T('user stories', 'récits utilisateur')}`, ext: 'md', type: 'text/markdown' }
  }
  if (format === 'raci-xlsx') {
    // Cas normal d'un diagramme sans RACI : on dit quoi remplir, sans parler d'échec.
    if (!report.raci) {
      throw nothingToExport('No activity has an Accountable (A), Consulted (C) or Informed (I) role yet. Select an activity and fill in the Responsibilities (RACI) group of the Process panel.',
        'Aucune activité n\'a encore de rôle Approbateur (A), Consultés (C) ou Informés (I). Sélectionnez une activité et remplissez le groupe Responsabilités (RACI) du panneau Processus.')
    }
    const { raciRows } = await import('./raci.js')
    const bytes = await rowsToXlsx(raciRows(report.raci, T), 'RACI')
    return { content: new Blob([bytes], { type: XLSX_TYPE }), name: `${baseName()} - ${T('RACI matrix', 'matrice RACI')}`, ext: 'xlsx', type: XLSX_TYPE }
  }
  throw new Error(`Unknown export format: ${format}`)
}

// Message d'état après un export pour Camunda : conditions écrites, tâches converties, reste à faire.
function camundaSummary({ target, conditions, converted, left, forms: linkedForms }) {
  let msg = T(`Exported for Camunda ${target}: ${conditions} condition(s) written`, `Exporté pour Camunda ${target} : ${conditions} condition(s) écrite(s)`)
  if (converted) msg += T(`, ${converted} assigned task(s) turned into user tasks`, `, ${converted} tâche(s) assignée(s) passée(s) en tâche utilisateur`)
  if (left) msg += T(`, ${left} branch condition(s) to write in Camunda Modeler`, `, ${left} condition(s) de branche à écrire dans Camunda Modeler`)
  if (linkedForms) msg += T(`, ${linkedForms} linked form(s) to deploy with it (Export > Task forms)`, `, ${linkedForms} formulaire(s) lié(s) à déployer avec lui (Exporter > Formulaires des tâches)`)
  return msg
}

// Bouton du menu Exporter : produit le fichier, le livre selon la destination choisie.
// failure : début du message d'échec, dans la langue de l'interface.
function exportButton(id, format, failure, { expert = false } = {}) {
  document.getElementById(id).addEventListener('click', async (e) => {
    const button = e.currentTarget
    if (expert) setExpert(true)
    button.disabled = true
    try {
      const file = await buildDocument(format)
      await deliver(file.content, file.name, file.ext, file.type)
      if (file.summary) setStatus(camundaSummary(file.summary))
      track('export', { format: format.startsWith('camunda') ? `camunda-${format.slice(7)}` : format })
    } catch (err) {
      if (err.notice) {
        alert(err.notice)
        return
      }
      console.error(`Export ${format} error:`, err)
      alert(failure() + err.message)
    } finally {
      button.disabled = false
    }
  })
}

// Exporter > Fichier .bpmn chiffré : le XML chiffré dans la page avec un mot de passe.
// Il reste hors de l'outil export_diagram : un mot de passe n'a rien à faire chez un agent.
document.getElementById('btn-save-encrypted').addEventListener('click', async () => {
  try {
    if (!hasShapes(modeler)) throw new Error(T('the diagram is empty', 'le diagramme est vide'))
    const { encryptText, askPassword, ENCRYPTED_EXT } = await import('./encrypted-file.js')
    const password = await askPassword({ confirm: true })
    if (password === null) return
    const { xml } = await modeler.saveXML({ format: true })
    await deliver(await encryptText(xml, password), baseName(), ENCRYPTED_EXT, 'application/json')
    track('export', { format: 'bpmn-chiffre' })
  } catch (err) {
    console.error('Encryption error:', err)
    alert(T('Encrypted export failed: ', 'Export chiffré impossible : ') + err.message)
  }
})
// BPMN pour Camunda 8 ou 7 (mode Expert) : même diagramme, préparé pour le moteur.
exportButton('btn-save-forms', 'forms', () => T('Forms export failed: ', 'Export des formulaires impossible : '))
exportButton('btn-camunda-8', 'camunda8', () => T('Camunda export failed: ', 'Export Camunda impossible : '))
exportButton('btn-camunda-7', 'camunda7', () => T('Camunda export failed: ', 'Export Camunda impossible : '))
// Rapport de processus : dans le menu Expert, il active le mode s'il ne l'était pas.
const reportFailure = () => T('Process report failed: ', 'Rapport de processus impossible : ')
exportButton('btn-report-pdf', 'report-pdf', reportFailure, { expert: true })
exportButton('btn-report-md', 'report-md', reportFailure, { expert: true })
exportButton('btn-report-docx', 'report-docx', reportFailure, { expert: true })
// Fiches de procédure : une fiche par activité, avec sa documentation.
const sheetsFailure = () => T('Procedure sheets failed: ', 'Fiches de procédure impossibles : ')
exportButton('btn-sheets-pdf', 'sheets-pdf', sheetsFailure)
exportButton('btn-sheets-md', 'sheets-md', sheetsFailure)
exportButton('btn-sheets-docx', 'sheets-docx', sheetsFailure)
// Page de documentation (HTML) : une page autonome, diagramme et fiches (src/doc/doc-page.js).
exportButton('btn-doc-html', 'doc-html', () => T('Documentation page failed: ', 'Page de documentation impossible : '))

const mining = setupMining(modeler, { menuButton: document.getElementById('btn-mining'), isSimulating: () => !!modeler.get('toggleMode')._active })
// Récits utilisateur (Markdown), module Expert « Récits utilisateur ».
exportButton('btn-stories-md', 'stories-md', () => T('User stories failed: ', 'Récits utilisateur impossibles : '))
// Matrice RACI (Excel) : une ligne par activité, une colonne par rôle.
exportButton('btn-raci-xlsx', 'raci-xlsx', () => T('RACI matrix failed: ', 'Matrice RACI impossible : '))

// Entrées du menu Expert qui passent par le Co-pilote IA (visibles quand un modèle est choisi) :
// une demande toute prête part dans le chat (src/chat-panel.js), dans la langue de l'interface.
const askCopilot = (text) => window.dispatchEvent(new CustomEvent('bpmn-pilot-copilot-ask', { detail: { text } }))
// Tables de décision DMN (mode Expert, interrupteur du menu Expert).
const decisions = setupDecisions({
  modeler,
  library,
  download,
  baseName,
  setStatus: (msg) => { document.getElementById('autosave-status').textContent = msg },
  askCopilot,
})
// Formulaires des tâches (mode Expert, module Formulaires).
const forms = setupForms({
  modeler,
  download,
  baseName,
  setStatus: (msg) => { document.getElementById('autosave-status').textContent = msg },
  askCopilot,
})
document.getElementById('btn-ai-probabilities').addEventListener('click', () => {
  setExpert(true)
  const branches = modeler.get('elementRegistry').filter(isBranchFlow)
  if (!branches.length) {
    alert(T('No gateway with several outgoing flows (exclusive, inclusive, complex or event-based): there is no probability to propose.',
      'Aucune passerelle à plusieurs flux sortants (exclusive, inclusive, complexe ou basée sur les événements) : pas de probabilité à proposer.'))
    return
  }
  askCopilot(T(EXPERT_ASKS.probabilities.en, EXPERT_ASKS.probabilities.fr))
})
document.getElementById('btn-ai-potential').addEventListener('click', () => {
  setExpert(true)
  if (!modeler.get('elementRegistry').find((el) => el.businessObject?.$instanceOf?.('bpmn:Activity'))) {
    alert(T('The diagram has no activity to rate.', 'Le diagramme n\'a aucune activité à noter.'))
    return
  }
  askCopilot(T(EXPERT_ASKS.aiPotential.en, EXPERT_ASKS.aiPotential.fr))
})
document.getElementById('btn-ai-stories').addEventListener('click', () => {
  setExpert(true)
  if (!modeler.get('elementRegistry').find((el) => el.businessObject?.$instanceOf?.('bpmn:Activity'))) {
    alert(T('The diagram has no activity to describe.', 'Le diagramme n\'a aucune activité à décrire.'))
    return
  }
  askCopilot(T(
    'Write the user stories and acceptance criteria of each activity of this diagram, from its name, lane, documentation, assignee and systems, as a product owner would for the team that will tool the process. ' +
      'Save them with update_elements: userStories, one per line, in the form "As a <role>, I want <action>, so that <benefit>"; acceptanceCriteria, one per line, testable, in the form "Given <context>, when <event>, then <result>". ' +
      'Two or three stories and three to five criteria per activity at most, keeping the ones already written. Change nothing else. ' +
      'Then list in three lines the activities whose need is still unclear and the question to ask.',
    'Rédige les récits utilisateur et les critères d\'acceptation de chaque activité de ce diagramme, d\'après son nom, son couloir, sa documentation, la personne assignée et les systèmes, comme le ferait un product owner pour l\'équipe qui outillera le processus. ' +
      'Enregistre-les avec update_elements : userStories, un par ligne, sous la forme « En tant que <rôle>, je veux <action>, afin de <bénéfice> » ; acceptanceCriteria, un par ligne, vérifiable, sous la forme « Étant donné <contexte>, quand <événement>, alors <résultat> ». ' +
      'Deux ou trois récits et trois à cinq critères par activité au plus, en gardant ceux déjà écrits. Ne change rien d\'autre. ' +
      'Liste ensuite en trois lignes les activités dont le besoin reste flou et la question à poser.'))
})
document.getElementById('btn-ai-analysis').addEventListener('click', () => {
  setExpert(true)
  if (!hasShapes(modeler)) {
    alert(T('The diagram is empty: nothing to analyze.', 'Le diagramme est vide : rien à analyser.'))
    return
  }
  askCopilot(T(EXPERT_ASKS.analysis.en, EXPERT_ASKS.analysis.fr))
})

async function processReportForAi({ simulate } = {}) {
  if (!hasShapes(modeler)) throw new Error('The diagram is empty: nothing to report.')
  return reportToMarkdown(await processReport({ simulate }))
}

// Outil export_diagram (serveur MCP et chat intégré) : le fichier est produit ici,
// déposé dans le dossier exports du serveur s'il y en a un, et proposé dans une
// bannière du canevas. Il ne se télécharge que sur un clic de l'utilisateur.
const exportOffer = createExportOffer({ container: document.getElementById('canvas'), download })

// Fichier renvoyé à l'agent (export_diagram avec returnFile) : texte pour bpmn et svg, base64 sinon.
async function returnedFile(file, name, bytes) {
  if (bytes > MAX_RETURNED_FILE_BYTES) throw new Error(`The file is too large to be returned (${Math.round(bytes / 1048576)} MB, 10 MB at most). It was still exported.`)
  if (typeof file.content === 'string') return { name, mimeType: file.type, text: file.content }
  const buffer = new Uint8Array(await file.content.arrayBuffer())
  let binary = ''
  for (let i = 0; i < buffer.length; i += 0x8000) binary += String.fromCharCode(...buffer.subarray(i, i + 0x8000))
  return { name, mimeType: file.type, data: btoa(binary) }
}

async function exportForAi({ format, name, returnFile = false }) {
  const isDocument = DOCUMENT_FORMATS.includes(format)
  if (!isDocument && !EXPORT_FORMATS.includes(format)) throw new Error(`Unknown format: ${format}. Use one of: ${[...EXPORT_FORMATS, ...DOCUMENT_FORMATS].join(', ')}.`)
  if (format !== 'bpmn' && format !== 'dmn' && !hasShapes(modeler)) throw new Error('The diagram is empty: nothing to export.')
  let file
  try {
    file = isDocument ? await buildDocument(format) : await renderExport(modeler, format)
  } catch (err) {
    // Rien à exporter (aucun RACI, aucun récit…) : le message dit quoi remplir, tel quel.
    if (err.notice) throw err
    throw new Error(err.message === 'png-unavailable' ? 'The browser could not draw the diagram as a PNG image.' : `Export failed: ${err.message}`, { cause: err })
  }
  const base = (name !== undefined ? cleanName(name) : '') || file.name || baseName()
  const bytes = exportSize(file.content)
  let saved = null
  let serverError = null
  if (sendToServer) {
    try {
      saved = await sendToServer(file.content, base, file.ext)
    } catch (err) {
      // Le fichier est produit : la bannière Télécharger reste proposée, et l'outil le dit.
      serverError = err.message
    }
  }
  exportOffer.show({ content: file.content, filename: saved || `${base}.${file.ext}`, type: file.type, savedOnServer: !!saved })
  const returned = returnFile ? await returnedFile(file, saved || `${base}.${file.ext}`, bytes) : null
  return {
    ...(returned ? { file: returned } : {}),
    format,
    fileName: saved || `${base}.${file.ext}`,
    bytes,
    ...(file.summary ? { camunda: { conditionsWritten: file.summary.conditions, tasksTurnedIntoUserTasks: file.summary.converted || 0, conditionsLeftToWrite: file.summary.left || 0, ...(file.summary.forms ? { linkedFormsToDeploy: file.summary.forms } : {}) } } : {}),
    ...(saved ? { savedOnServer: `exports/${saved}` } : {}),
    ...(serverError ? { serverSaveFailed: serverError } : {}),
    downloadOffered: true,
    note: saved
      ? 'Saved in the exports folder of the server. The editor also shows a Download button: the file is downloaded only if the user clicks it.'
      : serverError
        ? `The file could not be saved on the server (${serverError}). Tell the user. The editor still shows a Download button: the file is downloaded only if the user clicks it.`
        : 'The editor shows a Download button: the file is downloaded only if the user clicks it.',
  }
}

document.getElementById('btn-print').addEventListener('click', async () => {
  try {
    await printDiagram(modeler, { title: baseName() })
  } catch (err) {
    if (err.message === 'empty') {
      alert(T('Nothing to print: the diagram is empty.', 'Rien à imprimer : le diagramme est vide.'))
      return
    }
    console.error('Print error:', err)
    alert(T('Printing failed: ', 'Impression impossible : ') + err.message)
  }
})

document.getElementById('btn-layout').addEventListener('click', async () => {
  if (!confirm(T('Tidy up the diagram automatically? All positions will be recalculated. Undo (Ctrl+Z) brings back the previous layout.', 'Ranger le diagramme automatiquement ? Toutes les positions seront recalculées. Annuler (Ctrl+Z) ramène la disposition d\'avant.'))) return
  try {
    await autoLayout(modeler)
    setStatus(T('Diagram tidied up', 'Diagramme rangé'))
    track('mise-en-page-auto')
  } catch (err) {
    console.error('Layout error:', err)
    alert(T('Layout failed: ', 'Mise en page impossible : ') + err.message)
  }
})

// L'entrée Simulation du menu Expert suit l'état réel de la simulation : on pilote le
// service de l'extension, et l'événement qu'elle émet met à jour le libellé, que la
// bascule vienne de ce menu, de la touche T ou du contrôle intégré au canevas. Le bouton
// Expert porte un point lumineux tant qu'une simulation tourne.
const simButton = document.getElementById('btn-simulation')
modeler.on('tokenSimulation.toggleMode', ({ active }) => {
  simButton.textContent = active ? T('Stop simulation', 'Arrêter la simulation') : 'Simulation'
  simButton.title = active
    ? T('Back to editing. Expert mode stays on, so you can set the branch probabilities', 'Revenir à l\'édition. Le mode Expert reste actif pour régler les probabilités des branches')
    : T('Run tokens through the process, with the heatmap and branch probabilities', 'Faire circuler des jetons dans le processus, avec la carte de chaleur et les probabilités des branches')
  simButton.classList.toggle('active', !!active)
  document.getElementById('btn-expert').classList.toggle('running', !!active)
  // Pendant une simulation, le canevas est verrouillé : les entrées du Co-pilote, qui écrivent
  // dans le diagramme, restent visibles mais grisées, et leur icône d'aide dit pourquoi.
  // L'arrêt garde le mode Expert pour régler les probabilités.
  document.getElementById('expert-menu').classList.toggle('simulating', !!active)
  const ready = document.documentElement.classList.contains('copilot-ready')
  for (const entry of document.querySelectorAll('#expert-menu .copilot-only')) entry.disabled = !!active || !ready
  for (const help of document.querySelectorAll('#expert-menu .copilot-help')) {
    help.dataset.label ??= help.getAttribute('aria-label')
    help.setAttribute('aria-label', active
      ? T('Stop the simulation first: this function writes into the diagram, which is locked during a simulation', 'Arrêtez d\'abord la simulation : cette fonction écrit dans le diagramme, verrouillé pendant une simulation')
      : help.dataset.label)
  }
})
simButton.addEventListener('click', () => {
  setExpert(true)
  modeler.get('toggleMode').toggleMode()
})
// La simulation de jetons appartient au mode expert : hors de ce mode, ni le bouton ni la
// touche T de l'extension ne la lancent, et quitter le mode expert l'arrête.
{
  const toggleMode = modeler.get('toggleMode')
  const toggle = toggleMode.toggleMode.bind(toggleMode)
  toggleMode.toggleMode = (active = !toggleMode._active) => (active && !(isExpert() && isModuleOn('simulation')) ? undefined : toggle(active))
  window.addEventListener(EXPERT_EVENT, ({ detail }) => { if (!detail.on && toggleMode._active) toggle(false) })
  // Module Simulation éteint (src/expert-modules.js) : une simulation en cours s'arrête.
  window.addEventListener(MODULES_EVENT, () => { if (!isModuleOn('simulation') && toggleMode._active) toggle(false) })
}

function download(content, filename, type) {
  const a = document.createElement('a')
  const blob = content instanceof Blob ? content : new Blob([content], { type })
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

setupThemeToggle(document.getElementById('btn-theme'))
setupExpertMode({ button: document.getElementById('btn-expert'), switchButton: document.getElementById('expert-switch') })
setupExpertModules(document.getElementById('btn-expert-modules'))
applyStaticTexts(() => { clearTimeout(saveTimer); return autosave({ quiet: true }) })
// Le logo de la barre ouvre la page vitrine Leylines dans un nouvel onglet (index.html) :
// le diagramme en cours et son historique d'annulation restent intacts.
document.querySelector('.brand-logo')?.setAttribute('aria-label', T('Leylines (opens in a new tab)', 'Leylines (ouvre un nouvel onglet)'))
setupBrandLogo()
setupPanelToggle({
  button: document.getElementById('btn-properties'),
  panel: document.getElementById('properties-panel'),
  canvas: modeler.get('canvas'),
})
setupSmallScreenNotice({ before: document.getElementById('main'), canvas: modeler.get('canvas') })
setupPwa({ before: document.getElementById('main'), canvas: modeler.get('canvas'), save: () => autosave({ quiet: true }) })
setupInstallButton(document.getElementById('btn-install'))
setupPresentation({ button: document.getElementById('btn-present'), modeler })
// Le plan du diagramme reste à portée en présentation, dans la barre, avant le zoom.
{
  const presBar = document.getElementById('presentation-bar')
  const planButton = document.createElement('button')
  planButton.type = 'button'
  planButton.className = 'btn'
  planButton.dataset.icon = 'levels'
  planButton.textContent = T('Map', 'Plan')
  planButton.title = T('Diagram map: subprocesses, sub-levels and decision tables', 'Plan du diagramme : sous-processus, sous-niveaux et tables de décision')
  presBar?.querySelector('[data-act="out"]')?.before(planButton)
  diagramPlan.attach(planButton)
}
setupSimulationSpeed(modeler)
// Les tables de décision orientent les jetons calculés (src/dmn/decision-routing.js).
const heatmap = setupHeatmap(modeler, { branchHint: () => decisions.routing() })
// Pilote automatique : les passerelles choisissent leur branche pendant l'animation, selon les mêmes règles.
setupSimulationAutopilot(modeler, { branchHint: () => decisions.routing() })

// Poignée pour régler la largeur du panneau Processus.
translatePanelTitles(document.getElementById('properties-panel'))
setupPanelPopup(modeler.get('eventBus'))
// Documentation des éléments : fenêtre Markdown, pastilles du canevas, recherche.
const docEditor = setupDocEditor(modeler)
setupDocBadges(modeler, { openEditor: docEditor.open })
const docSearch = setupDocSearch(modeler)
// Le clic qui ouvre la recherche ne doit pas remonter jusqu'au document : diagram-js
// referme la recherche à tout clic en dehors d'elle, et la refermerait aussitôt.
document.getElementById('btn-search').addEventListener('click', (e) => {
  e.stopPropagation()
  docSearch.open()
})
makeResizable(document.getElementById('properties-panel'), {
  name: 'properties', label: T('Process panel width', 'Largeur du panneau Processus'), min: 240, max: 640, fallback: 300,
})
loadInitial().then(() => { dirty = false })

// Chat intégré, en deux modes :
//   - en ligne (build « vite build --mode online ») : le chat tourne dans la page et
//     appelle le fournisseur réglé dans Options. Pas de pont MCP.
//   - serveur (développement, image docker, ou VITE_MCP_BRIDGE_URL définie au build) : pont vers le
//     serveur MCP (dossier mcp/), qui fait tourner le chat (route /chat).
// Lien « Feedback », en bas du canevas (adresses réglées au build).
const feedback = setupFeedback({ container: document.getElementById('canvas') })
// Image docker lancée avec SHOWCASE=off (voir nginx.conf.template) : pas de page vitrine,
// le logo de la barre ouvre la fenêtre « Votre avis » à la place.
if (import.meta.env.MODE !== 'online' && !import.meta.env.DEV && feedback) {
  fetch('showcase.json', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((config) => {
      const logo = document.querySelector('.brand-logo')
      if (config?.showcase !== 'off' || !logo) return
      for (const name of ['href', 'target', 'rel']) logo.removeAttribute(name)
      logo.setAttribute('role', 'button')
      logo.tabIndex = 0
      logo.title = T('Feedback', 'Votre avis')
      logo.setAttribute('aria-label', T('Feedback', 'Votre avis'))
      logo.addEventListener('click', (e) => { e.preventDefault(); feedback.open() })
      logo.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); feedback.open() }
      })
    })
    .catch(() => {})
}
// Page de développement en ligne : une pastille à côté du titre le dit, et mène à la page stable.
if (IS_DEV_SITE) {
  const badge = document.createElement(OTHER_SITE ? 'a' : 'span')
  badge.className = 'channel-badge'
  if (OTHER_SITE) badge.href = OTHER_SITE
  badge.textContent = 'Dev'
  badge.title = T(
    `Development version ${APP_VERSION}: it follows the latest changes and keeps its own diagrams and settings. Click to open the stable version.`,
    `Version de développement ${APP_VERSION} : elle suit les dernières modifications et garde ses propres diagrammes et réglages. Cliquez pour ouvrir la version stable.`,
  )
  document.querySelector('#toolbar .brand').append(badge)
}
// Version, dans un petit encadré discret en bas à gauche du canevas.
if (APP_VERSION) {
  const version = document.createElement('div')
  version.id = 'app-version'
  version.textContent = APP_VERSION
  version.title = T('BPMN-Pilot version', 'Version de BPMN-Pilot')
  document.getElementById('canvas').append(version)
}
if (import.meta.env.MODE === 'online') {
  // Mesure d'audience, si Umami est réglé au build (voir src/analytics.js). Pas sur la page de
  // développement : seule la page stable est mesurée. Puis l'usage des fonctions (src/usage-events.js).
  if (!IS_DEV_SITE) {
    setupAnalytics({ lang })
    setupUsageEvents(modeler)
  }
  // Bouton « Confidentialité », en bas à droite du canevas.
  import('./privacy.js').then(({ setupPrivacy }) => setupPrivacy({ container: document.getElementById('canvas') }))
  Promise.all([import('./mcp-bridge.js'), import('./chat-panel.js')]).then(([{ createTools }, { createChatPanel }]) => {
    createChatPanel({ mode: 'online', tools: createTools(modeler, { exportDiagram: exportForAi, processReport: processReportForAi, decisions: decisions.service, mining: mining.toolApi }) })
  })
  // Agent MCP local : la page se relie au relais que l'utilisateur fait tourner sur son poste
  // (serveur mcp/ lancé par son agent), à l'adresse 127.0.0.1. Seulement sur demande
  // (?mcp=local, mémorisé ; ?mcp=off l'oublie) : sans demande, aucune connexion vers le poste,
  // et Chrome n'affiche pas sa demande d'accès au réseau local.
  const LOCAL_MCP_KEY = 'bpmn-editor-local-mcp'
  const mcpParam = new URLSearchParams(location.search).get('mcp')
  let localMcp
  try {
    if (mcpParam === 'local') localStorage.setItem(LOCAL_MCP_KEY, '1')
    if (mcpParam === 'off') localStorage.removeItem(LOCAL_MCP_KEY)
    localMcp = localStorage.getItem(LOCAL_MCP_KEY) === '1'
  } catch {
    localMcp = mcpParam === 'local'
  }
  if (localMcp) {
    const port = Number(import.meta.env.VITE_LOCAL_MCP_PORT) || 3333
    import('./mcp-bridge.js').then(({ connectMcpBridge }) => {
      connectMcpBridge(modeler, `ws://127.0.0.1:${port}/bridge`, {
        exportDiagram: exportForAi,
        processReport: processReportForAi,
        decisions: decisions.service,
        mining: mining.toolApi,
      })
    })
  }
} else {
  if (mcpBridgeUrl) {
    Promise.all([import('./mcp-bridge.js'), import('./chat-panel.js'), import('./mcp-connect.js')]).then(([{ connectMcpBridge }, { createChatPanel }, { setupMcpConnect }]) => {
      let bridge = null
      const headlessOffer = HEADLESS_KEY ? null : createHeadlessOffer({
        container: document.getElementById('canvas'),
        open: async (id) => {
          const opened = await library.openServer(id)
          if (opened) bridge?.takeHeadless?.(id)
          return opened
        },
      })
      bridge = connectMcpBridge(modeler, mcpBridgeUrl, {
        exportDiagram: exportForAi,
        processReport: processReportForAi,
        decisions: decisions.service,
        mining: mining.toolApi,
        headlessKey: HEADLESS_KEY,
        onHeadlessDiagram: (item) => headlessOffer?.show(item),
      })
      // Le chat intégré passe par le même serveur, route /chat.
      const chatUrl = mcpBridgeUrl.replace(/^ws/, 'http').replace(/\/bridge$/, '/chat')
      createChatPanel({ mode: 'server', chatUrl, bridge })
      // Clic sur le badge MCP : adresse et configurations pour connecter un agent.
      const mcpUrl = mcpBridgeUrl.replace(/^ws/, 'http').replace(/\/bridge$/, '/mcp')
      setupMcpConnect({ badge: bridge.badge, mcpUrl, infoUrl: chatUrl })
    })
  }
}
