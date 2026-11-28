// Profils de palette : ce que proposent la palette, le menu contextuel et les menus
// Créer, Ajouter et Remplacer de l'éditeur.
//   - Complète : tous les éléments BPMN (par défaut) ;
//   - Essentiel : événement de début, tâche, passerelle exclusive, événement de fin. Pour
//     un premier diagramme, sans le reste du vocabulaire BPMN ;
//   - Camunda 8 : masque les éléments que le moteur Camunda 8 n'exécute pas. La liste suit
//     la règle element-type de bpmnlint-plugin-camunda-compat 2.63.1 (celle de Camunda
//     Modeler) pour la version visée par l'export (src/export-camunda.js) : passerelle
//     complexe, transaction, événements d'annulation.
// Un profil ne touche pas au diagramme : un élément déjà dessiné reste tel quel, et l'IA
// garde tous ses outils. Le choix se fait par le bouton du bas de la palette, et reste
// retenu dans ce navigateur.
//
// Principe repris de la démo « service-task-only » de bpmn-io (licence MIT) : un
// fournisseur de faible priorité filtre les entrées des fournisseurs existants.
import { T } from './i18n/lang.js'

const KEY = 'bpmn-editor-palette-profile'
const MENU = 'bpmn-pilot-palette-profile'
const LOWEST = 1

export const PROFILES = ['full', 'essential', 'camunda8']

// Nom d'une entrée de menu sans son préfixe : create-cancel-end → cancel-end.
const menuName = (id) => id.replace(/^(create-|append-|replace-with-)/, '')

const ESSENTIAL = {
  palette: new Set(['hand-tool', 'lasso-tool', 'space-tool', 'global-connect-tool', 'tool-separator',
    'create.start-event', 'create.end-event', 'create.exclusive-gateway', 'create.task']),
  // Menu contextuel : seuls les ajouts d'éléments sont filtrés, les commandes restent.
  append: new Set(['append.end-event', 'append.gateway', 'append.append-task']),
  menu: new Set(['task', 'exclusive-gateway', 'none-start', 'none-start-event', 'none-end', 'none-end-event',
    'sequence-flow', 'default-flow', 'conditional-flow']),
}

// Éléments que Camunda 8 n'exécute pas (bpmnlint-plugin-camunda-compat, element-type).
const CAMUNDA8_HIDDEN = /^(complex-gateway|transaction|cancel-.*|.*-cancel)$/

export function keepEntry(profile, kind, id) {
  if (profile === 'essential') {
    if (kind === 'palette') return ESSENTIAL.palette.has(id) || !(id.startsWith('create') || id.endsWith('-tool'))
    if (kind === 'context-pad') return !id.startsWith('append') || ESSENTIAL.append.has(id)
    return ESSENTIAL.menu.has(menuName(id))
  }
  if (profile === 'camunda8') {
    if (kind === 'palette' || kind === 'context-pad') return true
    return !CAMUNDA8_HIDDEN.test(menuName(id))
  }
  return true
}

const filtered = (profile, kind) => (entries) => {
  const out = {}
  for (const [id, entry] of Object.entries(entries)) if (keepEntry(profile, kind, id)) out[id] = entry
  return out
}

const label = (p) => ({
  full: T('Full', 'Complète'),
  essential: T('Essential', 'Essentiel'),
  camunda8: 'Camunda 8',
})[p]
const description = (p) => ({
  full: T('Every BPMN element.', 'Tous les éléments BPMN.'),
  essential: T('Start, task, exclusive gateway, end: enough for a first diagram.', 'Début, tâche, passerelle exclusive, fin : de quoi faire un premier diagramme.'),
  camunda8: T('Hides what Camunda 8 does not run: complex gateway, transaction, cancel events.', 'Masque ce que Camunda 8 n\'exécute pas : passerelle complexe, transaction, événements d\'annulation.'),
})[p]

const ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>'
const CHECK = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'

function PaletteProfiles(palette, contextPad, popupMenu, canvas, eventBus) {
  let profile = 'full'
  try {
    const saved = localStorage.getItem(KEY)
    if (PROFILES.includes(saved)) profile = saved
  } catch { /* stockage indisponible : profil complet */ }

  const self = this
  this.get = () => profile
  this.set = (value) => {
    if (!PROFILES.includes(value) || value === profile) return
    profile = value
    try { localStorage.setItem(KEY, value) } catch { /* le choix vaut pour cette page */ }
    palette._update()
    contextPad.close?.()
    eventBus.fire('bpmn-pilot.palette-profile.changed', { profile })
  }

  palette.registerProvider(LOWEST, {
    getPaletteEntries: () => (entries) => ({
      ...filtered(profile, 'palette')(entries),
      'palette-profile-separator': { group: 'pilot-profile', separator: true },
      'palette-profile': {
        group: 'pilot-profile',
        html: `<div class="entry bpmn-pilot-palette-profile${profile === 'full' ? '' : ' narrowed'}" title="${T('Palette', 'Palette')} : ${label(profile)}. ${T('Choose the elements offered…', 'Choisir les éléments proposés…')}">${ICON}</div>`,
        title: T(`Palette: ${label(profile)}`, `Palette : ${label(profile)}`),
        action: {
          click: (event) => {
            const box = event.delegateTarget?.getBoundingClientRect?.() || event.target.getBoundingClientRect()
            popupMenu.open(canvas.getRootElement(), MENU, { x: box.right + 8, y: box.top }, {
              title: T('Elements offered', 'Éléments proposés'), width: 320,
            })
          },
        },
      },
    }),
  })
  contextPad.registerProvider(LOWEST, { getContextPadEntries: () => filtered(profile, 'context-pad') })
  for (const id of ['bpmn-create', 'bpmn-append', 'bpmn-replace']) {
    popupMenu.registerProvider(id, LOWEST, { getPopupMenuEntries: () => filtered(profile, 'menu') })
  }
  popupMenu.registerProvider(MENU, {
    getPopupMenuEntries: () => Object.fromEntries(PROFILES.map((p) => [`profile-${p}`, {
      label: label(p),
      description: description(p),
      imageHtml: p === profile ? CHECK : '<span></span>',
      action: () => { self.set(p); popupMenu.close() },
    }])),
  })
}
PaletteProfiles.$inject = ['palette', 'contextPad', 'popupMenu', 'canvas', 'eventBus']

export default {
  __init__: ['paletteProfiles'],
  paletteProfiles: ['type', PaletteProfiles],
}
