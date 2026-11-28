// Rapport de processus : le diagramme ouvert mis en document, en PDF ou en Markdown.
//
// Tout se calcule à partir du modèle, sans saisie supplémentaire :
//   - chiffres clés et diagramme, les éléments concernés par un constat entourés de la
//     couleur de leur niveau ;
//   - constats de modélisation en trois niveaux : erreur (rouge), avertissement (orange),
//     à compléter (jaune). Sources : bpmnlint, contrôles du modèle (accessibilité, chemin
//     vers une fin, documentation, libellés, couloirs) et dernière simulation ;
//   - carte de chaleur de la dernière simulation, s'il y en a une ;
//   - axes d'amélioration déduits des constats, par priorité, avec l'effet attendu ;
//   - événements de fin (part des instances si une simulation a tourné), activités par
//     couloir, séquence des éléments ;
//   - après une simulation, les éléments les plus traversés, le passage par branche de
//     passerelle et ce qui n'est jamais atteint ;
//   - les six contrôles de qualité (src/diagram-checks.js), calculés dans la page ;
//   - les objectifs chiffrés posés sur les fins et les activités (src/goals.js), atteints
//     ou non d'après la dernière série de jetons ;
//   - l'analyse du Co-pilote IA, si elle a été enregistrée (src/copilot-analysis.js), et les
//     probabilités qu'il a proposées et que personne n'a encore revues.
// Le menu Expert et l'outil get_process_report passent par ici.

import { buildRaci, raciRows } from './raci.js'
import { buildCompliance, identityHolder, identityOf, identityRows, splitLines, splitRefs } from './compliance.js'
import { lang, T, num } from './i18n/lang.js'
import { deviationText, formatDuration, formatDate } from './mining/texts.js'
import { flowIndex } from './simulation-stats.js'
import { heatColor, heatBadge } from './heatmap.js'
import { readAnalysis, structureFingerprint, isAiProbability } from './copilot-analysis.js'
import { goalOf, measureGoal, goalMet } from './goals.js'
import { isAgentStep } from './lint/agent-steps.js'
import { markdownToLine, markdownToPlain, shiftHeadings } from './doc/markdown.js'
import { findingText, describeTable } from './dmn/decision-texts.js'

const LEVELS = ['error', 'warning', 'todo']
const LEVEL_LABEL = {
  error: () => T('Error', 'Erreur'),
  warning: () => T('Warning', 'Avertissement'),
  todo: () => T('To complete', 'À compléter'),
}
const PRIORITY_LABEL = {
  error: () => T('High', 'Haute'),
  warning: () => T('Medium', 'Moyenne'),
  todo: () => T('Low', 'Basse'),
}
const SOURCE_LABEL = {
  bpmnlint: () => 'bpmnlint',
  check: () => T('Check', 'Contrôle'),
  simulation: () => 'Simulation',
  goal: () => T('Goal', 'Objectif'),
  copilot: () => T('AI co-pilot', 'Co-pilote IA'),
}
const POINT_LABEL = {
  bottleneck: () => T('Bottleneck', 'Goulot'),
  rare_path: () => T('Rare path', 'Chemin rare'),
  risk: () => T('Risk', 'Risque'),
  improvement: () => T('Improvement', 'Piste d\'amélioration'),
}
export const CHECK_LABEL = {
  xml: () => T('Well-formed XML', 'XML bien formé'),
  metamodel: () => T('Conforms to the BPMN 2.0 metamodel', 'Conforme au métamodèle BPMN 2.0'),
  references: () => T('References and scopes', 'Références et portées'),
  di: () => T('Every element drawn (DI)', 'Chaque élément dessiné (DI)'),
  reimport: () => T('Reimported by bpmn-js', 'Réimport par bpmn-js'),
  lint: () => T('bpmnlint rules', 'Règles bpmnlint'),
}
const COLORS = {
  error: { strong: '#DC2626', soft: '#FEF2F2', text: '#FFFFFF' },
  warning: { strong: '#F97316', soft: '#FFF7ED', text: '#FFFFFF' },
  todo: { strong: '#EAB308', soft: '#FEFCE8', text: '#422006' },
}
const TAG_FILL = { error: '#DC2626', warning: '#F97316', todo: '#FACC15' }

const TYPE_LABELS = {
  StartEvent: ['Start event', 'Événement de début'],
  EndEvent: ['End event', 'Événement de fin'],
  IntermediateCatchEvent: ['Intermediate catch event', 'Événement intermédiaire de réception'],
  IntermediateThrowEvent: ['Intermediate throw event', 'Événement intermédiaire d\'émission'],
  BoundaryEvent: ['Boundary event', 'Événement en bordure'],
  Task: ['Task', 'Tâche'],
  UserTask: ['User task', 'Tâche utilisateur'],
  ServiceTask: ['Service task', 'Tâche de service'],
  SendTask: ['Send task', 'Tâche d\'envoi'],
  ReceiveTask: ['Receive task', 'Tâche de réception'],
  ManualTask: ['Manual task', 'Tâche manuelle'],
  ScriptTask: ['Script task', 'Tâche de script'],
  BusinessRuleTask: ['Business rule task', 'Tâche de règle métier'],
  CallActivity: ['Call activity', 'Activité d\'appel'],
  SubProcess: ['Sub-process', 'Sous-processus'],
  Transaction: ['Transaction', 'Transaction'],
  AdHocSubProcess: ['Ad-hoc sub-process', 'Sous-processus ad hoc'],
  ExclusiveGateway: ['Exclusive gateway', 'Passerelle exclusive'],
  ParallelGateway: ['Parallel gateway', 'Passerelle parallèle'],
  InclusiveGateway: ['Inclusive gateway', 'Passerelle inclusive'],
  EventBasedGateway: ['Event-based gateway', 'Passerelle basée sur les événements'],
  ComplexGateway: ['Complex gateway', 'Passerelle complexe'],
}
const EVENT_DEFINITIONS = {
  TimerEventDefinition: ['timer', 'minuterie'],
  MessageEventDefinition: ['message', 'message'],
  SignalEventDefinition: ['signal', 'signal'],
  ErrorEventDefinition: ['error', 'erreur'],
  EscalationEventDefinition: ['escalation', 'escalade'],
  ConditionalEventDefinition: ['conditional', 'conditionnel'],
  TerminateEventDefinition: ['terminate', 'terminaison'],
  CompensateEventDefinition: ['compensation', 'compensation'],
  LinkEventDefinition: ['link', 'lien'],
}

const is = (bo, type) => !!bo?.$instanceOf?.(type)
const isActivity = (bo) => is(bo, 'bpmn:Activity')
const isGateway = (bo) => is(bo, 'bpmn:Gateway')
const isEvent = (bo) => is(bo, 'bpmn:Event')
const short = (bo) => bo.$type.replace(/^bpmn:/, '')
const pick = ([en, fr]) => T(en, fr)
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()
// Documentation d'un élément : Markdown d'origine, et sa version sur une ligne pour les tableaux.
const docSource = (bo) => (bo?.documentation || []).map((d) => d.text || '').filter((t) => t.trim()).join('\n\n').trim()
const docOf = (bo) => markdownToLine(docSource(bo))
// Condition d'un flux écrite en clair (« Avance < 3000 ») et personne ou rôle assigné à une activité.
export const conditionText = (flow) => clean(flow?.conditionExpression?.body)
export const assigneeOf = (bo) => clean(bo?.get?.('bpmnpilot:assignee'))
// Potentiel d'IA d'une activité, noté par le Co-pilote (mode Expert) ou à la main.
export const AI_POTENTIAL = {
  automate: () => T('Automatable (AI agent, human review)', 'Automatisable (agent IA, revue humaine)'),
  assist: () => T('AI-assisted', 'Assistée par IA'),
  human: () => T('Human', 'Humaine'),
}
const laneCell = (s) => [s.lane, s.assignee ? `${T('Assigned to', 'Assigné à')}${T(': ', ' : ')}${s.assignee}` : '', s.systems ? `${T('Systems', 'Systèmes')}${T(': ', ' : ')}${s.systems}` : ''].filter(Boolean).join(' · ')

export function typeLabel(bo) {
  if (isAgentStep(bo)) return T('AI agent step (ad-hoc sub-process)', "Étape d'agent IA (sous-processus ad hoc)")
  const base = TYPE_LABELS[short(bo)] ? pick(TYPE_LABELS[short(bo)]) : short(bo)
  const def = (bo.eventDefinitions || [])[0]
  const kind = def && EVENT_DEFINITIONS[short(def)]
  if (!kind) return base
  // « Événement intermédiaire (minuterie) » : la définition dit déjà s'il reçoit ou émet.
  const head = /Intermediate/.test(short(bo)) ? T('Intermediate event', 'Événement intermédiaire') : base
  return `${head} (${pick(kind)})`
}

// ── Lecture du modèle ───────────────────────────────────────────────────────

function collectContainers(definitions) {
  const processes = []
  const participants = []
  for (const root of definitions.rootElements || []) {
    if (is(root, 'bpmn:Process')) processes.push(root)
    if (is(root, 'bpmn:Collaboration')) participants.push(...(root.participants || []))
  }
  return { processes, participants }
}

// Éléments de flux d'un conteneur, sous-processus compris.
function allFlowElements(container, out = []) {
  for (const el of container.flowElements || []) {
    out.push(el)
    if (is(el, 'bpmn:SubProcess')) allFlowElements(el, out)
  }
  return out
}

function allLanes(laneSets, out = []) {
  for (const set of laneSets || []) {
    for (const lane of set.lanes || []) {
      out.push(lane)
      if (lane.childLaneSet) allLanes([lane.childLaneSet], out)
    }
  }
  return out
}

// ── Construction ────────────────────────────────────────────────────────────

// options : { name (nom du fichier), simulation (résultat de la carte de chaleur), lint (résultats
// bpmnlint), checks (rapport de checkDiagram, src/diagram-checks.js) }
export async function buildReport(modeler, { name = '', simulation = null, lint = null, checks = null, decisions = null, mining = null } = {}) {
  const definitions = modeler.getDefinitions()
  const translate = modeler.get('translate')
  const { processes, participants } = collectContainers(definitions)
  const nodes = []
  const flows = []
  for (const p of processes) {
    for (const el of allFlowElements(p)) {
      if (is(el, 'bpmn:SequenceFlow')) flows.push(el)
      else if (is(el, 'bpmn:FlowNode')) nodes.push(el)
    }
  }
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const out = flowIndex(processes).outgoing
  // Flux entrants, d'après les flux eux-mêmes (un fichier peut omettre <incoming>).
  const incomingOf = (n) => flows.filter((f) => f.targetRef === n)

  // Couloirs : le plus profond qui référence l'élément.
  const laneOf = new Map()
  const lanes = []
  for (const p of processes) {
    for (const lane of allLanes(p.laneSets)) {
      lanes.push(lane)
      for (const ref of lane.flowNodeRef || []) laneOf.set(ref.id, lane)
    }
  }
  const laneName = (bo) => clean(laneOf.get(bo.id)?.name)

  // Événements en bordure, rangés sous leur activité.
  const boundaries = new Map()
  for (const n of nodes) {
    if (is(n, 'bpmn:BoundaryEvent') && n.attachedToRef) {
      if (!boundaries.has(n.attachedToRef.id)) boundaries.set(n.attachedToRef.id, [])
      boundaries.get(n.attachedToRef.id).push(n)
    }
  }

  // Ordre de lecture : parcours en largeur depuis les événements de début, sous-processus
  // et événements en bordure compris. Les passerelles ne sont pas numérotées : la colonne
  // des flux sortants les traverse.
  const starts = (container) => (container.flowElements || []).filter((e) => is(e, 'bpmn:StartEvent'))
  const visited = new Set()
  const order = []
  const queue = processes.flatMap((p) => starts(p))
  while (queue.length) {
    const n = queue.shift()
    if (visited.has(n.id)) continue
    visited.add(n.id)
    if (!isGateway(n)) order.push(n)
    if (is(n, 'bpmn:SubProcess')) queue.push(...starts(n))
    queue.push(...(boundaries.get(n.id) || []))
    for (const f of out(n)) if (f.targetRef) queue.push(f.targetRef)
  }
  const reachable = new Set(visited)
  // Les éléments que rien n'atteint ferment la liste.
  for (const n of nodes) if (!visited.has(n.id) && !isGateway(n)) order.push(n)
  const number = new Map(order.map((n, i) => [n.id, i + 1]))

  const displayName = (bo) => clean(bo.name) || typeLabel(bo)
  const ref = (bo) => (number.has(bo.id) ? `${number.get(bo.id)}. ${displayName(bo)}` : displayName(bo))
  const quoted = (list) => joinList(list.map((bo) => quote(displayName(bo))))

  // ── Constats ──
  const findings = []
  const flagged = new Set()
  const add = (f) => {
    findings.push(f)
    if (f.element) flagged.add(f.element.id)
  }

  // bpmnlint
  const lintResults = lint || (modeler.get('linting', false) ? await modeler.get('linting').lint() : {})
  for (const [rule, reports] of Object.entries(lintResults || {})) {
    for (const report of reports) {
      const level = report.category === 'warn' ? 'warning' : report.category === 'info' ? 'todo' : 'error'
      const element = byId.get(report.id) || findAny(definitions, report.id)
      add({
        kind: `lint:${rule}`,
        rule,
        level,
        element,
        title: `${clean(translate(report.message))}`,
        detail: lintDetail(rule),
        source: 'bpmnlint',
      })
    }
  }
  const lintIds = new Set(findings.map((f) => f.element?.id))

  // Éléments que rien n'atteint depuis un événement de début.
  for (const n of nodes) {
    if (reachable.has(n.id) || lintIds.has(n.id)) continue
    if (is(n, 'bpmn:StartEvent')) continue
    if (n.$parent?.triggeredByEvent) continue // contenu d'un sous-processus d'événement
    add({
      kind: 'unreachable', level: 'error', element: n, source: 'check',
      title: T('Unreachable element', 'Élément inaccessible'),
      detail: T('No path from a start event reaches this element.', 'Aucun chemin partant d\'un événement de début n\'atteint cet élément.'),
    })
  }

  // Éléments d'où aucun chemin ne mène à un événement de fin (boucle sans sortie, impasse).
  for (const container of [...processes, ...nodes.filter((n) => is(n, 'bpmn:SubProcess'))]) {
    if (container.triggeredByEvent) continue
    const own = (container.flowElements || []).filter((e) => is(e, 'bpmn:FlowNode'))
    const ends = own.filter((e) => is(e, 'bpmn:EndEvent'))
    if (!ends.length) continue
    const canEnd = new Set(ends.map((e) => e.id))
    let changed = true
    while (changed) {
      changed = false
      for (const n of own) {
        if (canEnd.has(n.id)) continue
        const next = out(n).map((f) => f.targetRef).concat(boundaries.get(n.id) || [])
        if (next.some((t) => t && canEnd.has(t.id))) {
          canEnd.add(n.id)
          changed = true
        }
      }
    }
    const stuck = own.filter((n) => !canEnd.has(n.id) && reachable.has(n.id) && !lintIds.has(n.id) && out(n).length && !is(n, 'bpmn:BoundaryEvent'))
    if (stuck.length) {
      const first = stuck.find((n) => !isGateway(n)) || stuck[0]
      add({
        kind: 'no-end', level: 'error', element: first, elements: stuck, source: 'check',
        title: T('No path to an end event', 'Aucun chemin vers un événement de fin'),
        detail: T(`Once a token reaches ${quoted(stuck)}, it can no longer reach an end event: the instance never completes.`,
          `Un jeton arrivé sur ${quoted(stuck)} ne peut plus atteindre d'événement de fin : l'instance ne se termine jamais.`),
      })
    }
  }

  // Reprise mesurée par la simulation.
  if (simulation?.runs) {
    for (const n of order) {
      const count = simulation.nodes[n.id] || 0
      if (isActivity(n) && count > simulation.runs) {
        add({
          kind: 'rework', level: 'warning', element: n, count, source: 'simulation',
          title: T('Frequent rework', 'Reprise fréquente'),
          detail: T(`${fmt(count / simulation.runs)} executions per instance (${num(count)} for ${num(simulation.runs)} instances).`,
            `${fmt(count / simulation.runs)} exécutions par instance (${num(count)} pour ${num(simulation.runs)} instances).`),
        })
      }
    }
  }

  // Instances bloquées par la série de jetons : un jeton attend une branche qui ne viendra pas.
  if (simulation?.runs && simulation.blocked) {
    for (const [id, count] of Object.entries(simulation.blockedAt || {})) {
      const element = findAny(definitions, id)
      if (!element) continue
      add({
        kind: 'blocked', level: 'error', element, count, source: 'simulation',
        title: T('Instances blocked on a merge', 'Instances bloquées sur une convergence'),
        detail: blockedDetail(quoted([element]), count, simulation.runs),
      })
    }
  }

  // Objectifs chiffrés, mesurés par la dernière série de jetons.
  const goals = nodes.filter((n) => goalOf(n)).map((n) => {
    const goal = goalOf(n)
    const measured = measureGoal(n, simulation)
    return { bo: n, goal, measured, status: measured === null ? 'unmeasured' : goalMet(goal, measured) ? 'met' : 'missed' }
  })
  for (const g of goals.filter((x) => x.status === 'missed')) {
    add({
      kind: 'goal', level: 'warning', element: g.bo, source: 'goal',
      title: T('Goal not reached', 'Objectif non atteint'),
      detail: T(`Goal: ${goalText(g.bo, g.goal)}. Simulation: ${measuredText(g.bo, g.measured)} (${num(simulation.runs)} instances).`,
        `Objectif : ${goalText(g.bo, g.goal)}. Simulation : ${measuredText(g.bo, g.measured)} (${num(simulation.runs)} instances).`),
    })
  }

  // Informations manquantes.
  for (const n of order) {
    if (isActivity(n) && !is(n, 'bpmn:SubProcess') && !docOf(n)) {
      add({
        kind: 'doc', level: 'todo', element: n, source: 'check',
        title: T('No documentation', 'Documentation absente'),
        detail: T('The Documentation field is empty.', 'Le champ Documentation est vide.'),
      })
    }
  }
  for (const g of nodes.filter((n) => (is(n, 'bpmn:ExclusiveGateway') || is(n, 'bpmn:InclusiveGateway')) && out(n).length > 1)) {
    const unnamed = out(g).filter((f) => !clean(f.name))
    if (unnamed.length) {
      add({
        kind: 'flow-label', level: 'todo', element: g, source: 'check',
        title: T('Unlabeled conditions', 'Conditions sans libellé'),
        detail: T(`${unnamed.length} outgoing flow(s) of this gateway have no label: the answer to its question.`,
          `${unnamed.length} flux sortant(s) de cette passerelle sans libellé : la réponse à sa question.`),
      })
    }
  }
  for (const lane of lanes) {
    if (lane.childLaneSet) continue
    const activities = (lane.flowNodeRef || []).filter(isActivity)
    if (activities.length === 1) {
      add({
        kind: 'lane-single', level: 'todo', element: activities[0], lane, source: 'check',
        title: T('Lane with a single activity', 'Couloir à activité unique'),
        detail: T(`The lane ${quote(clean(lane.name))} contains only one activity.`, `Le couloir ${quote(clean(lane.name))} ne contient qu'une activité.`),
      })
    }
  }

  // Risques sans contrôle (mode Expert, groupe Risques et conformité).
  for (const n of order) {
    if (isActivity(n) && splitLines(n.get?.('bpmnpilot:risks')).length && !splitLines(n.get?.('bpmnpilot:controls')).length) {
      add({
        kind: 'risk-control', level: 'todo', element: n, source: 'check',
        title: T('Risk without control', 'Risque sans contrôle'),
        detail: T('Risks are listed for this activity, but no control.', 'Des risques sont notés pour cette activité, mais aucun contrôle.'),
      })
    }
  }

  // Probabilités proposées par le Co-pilote IA et pas encore revues : un constat par passerelle.
  for (const n of nodes) {
    if (!isGateway(n)) continue
    const branches = out(n)
    const ai = branches.filter(isAiProbability)
    if (!ai.length) continue
    add({
      kind: 'ai-probability', level: 'todo', element: n, source: 'copilot',
      title: T('Probabilities proposed by the AI co-pilot', 'Probabilités proposées par le Co-pilote IA'),
      detail: T(`${ai.length} of ${branches.length} branch(es) to review: Properties panel, Simulation group, on each flow.`,
        `${ai.length} branche(s) sur ${branches.length} à revoir : panneau Propriétés, groupe Simulation, sur chaque flux.`),
    })
  }

  findings.sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level))
  const worst = new Map()
  for (const f of findings) {
    for (const el of f.elements || (f.element ? [f.element] : [])) {
      if (!worst.has(el.id)) worst.set(el.id, f.level)
    }
  }

  // ── Axes d'amélioration ──
  const axes = []
  const groups = new Map()
  for (const f of findings) {
    if (!groups.has(f.kind)) groups.set(f.kind, [])
    groups.get(f.kind).push(f)
  }
  for (const [kind, list] of groups) {
    const level = list[0].level
    const elements = [...new Map(list.flatMap((f) => f.elements || (f.element ? [f.element] : [])).map((e) => [e.id, e])).values()]
    const axis = axisFor(kind, list, elements, { quoted, simulation })
    if (axis) axes.push({ ...axis, level, source: kind === 'rework' || kind === 'blocked' ? 'simulation' : kind === 'goal' ? 'goal' : kind === 'ai-probability' ? 'copilot' : 'check' })
  }
  axes.sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level))

  // ── Séquence ──
  const describeNext = (n, depth = 0) => out(n).map((f) => {
    const t = f.targetRef
    if (!t) return ''
    const rule = conditionText(f)
    const name = clean(f.name)
    const shown = name && rule && name !== rule ? `${name} (${rule})` : name || rule
    const label = shown ? `${shown}${T(': ', ' : ')}` : ''
    if (isGateway(t) && depth < 3 && out(t).length) {
      const inner = describeNext(t, depth + 1)
      if (is(t, 'bpmn:ParallelGateway') && out(t).length > 1) return `${label}${T('in parallel', 'en parallèle')}${T(': ', ' : ')}${inner}`
      if (out(t).length > 1) return `${label}${clean(t.name) || T('Choice', 'Choix')} ${inner}`
      return label + inner
    }
    return label + ref(t)
  }).filter(Boolean).join(T('; ', ' ; '))

  const sequence = order.map((n) => ({
    number: number.get(n.id),
    id: n.id,
    name: displayName(n),
    type: typeLabel(n),
    lane: laneName(n),
    assignee: assigneeOf(n),
    activity: isActivity(n),
    systems: clean(n.get?.('bpmnpilot:systems')),
    accountable: clean(n.get?.('bpmnpilot:accountable')),
    consulted: clean(n.get?.('bpmnpilot:consulted')),
    informed: clean(n.get?.('bpmnpilot:informed')),
    aiPotential: AI_POTENTIAL[n.get?.('bpmnpilot:aiPotential')] ? n.get('bpmnpilot:aiPotential') : null,
    aiPotentialReason: clean(n.get?.('bpmnpilot:aiPotentialReason')),
    risks: isActivity(n) ? splitLines(n.get?.('bpmnpilot:risks')) : [],
    controls: isActivity(n) ? splitLines(n.get?.('bpmnpilot:controls')) : [],
    requirements: isActivity(n) ? splitRefs(n.get?.('bpmnpilot:requirements')) : [],
    userStories: isActivity(n) ? splitLines(n.get?.('bpmnpilot:userStories')) : [],
    acceptanceCriteria: isActivity(n) ? splitLines(n.get?.('bpmnpilot:acceptanceCriteria')) : [],
    linkedDiagram: is(n, 'bpmn:CallActivity') ? clean(n.get?.('bpmnpilot:linkedDiagramName')) : '',
    documentation: docOf(n),
    docMarkdown: docSource(n),
    previous: [...incomingOf(n).map((f) => f.sourceRef), ...(n.attachedToRef ? [n.attachedToRef] : [])].filter(Boolean).map((p) => (isGateway(p) ? clean(p.name) || typeLabel(p) : ref(p))),
    needsDoc: isActivity(n) && !is(n, 'bpmn:SubProcess'),
    next: describeNext(n),
    count: simulation?.runs ? simulation.nodes[n.id] || 0 : null,
    level: worst.get(n.id) || null,
    tags: [...new Set(findings.filter((f) => (f.elements || [f.element]).some((e) => e?.id === n.id)).map((f) => `${f.level}|${f.title}`))]
      .map((s) => { const [level, title] = s.split('|'); return { level, title } }),
  }))

  // Passerelles documentées (elles ne sont pas numérotées) : chacune suit l'élément
  // numéroté qui la précède, pour les fiches de procédure.
  const numberedBefore = (g, seen = new Set()) => {
    for (const f of incomingOf(g)) {
      const src = f.sourceRef
      if (!src || seen.has(src.id)) continue
      seen.add(src.id)
      if (number.has(src.id)) return number.get(src.id)
      if (isGateway(src)) {
        const n = numberedBefore(src, seen)
        if (n) return n
      }
    }
    return 0
  }
  const gatewayDocs = nodes.filter((n) => isGateway(n) && docSource(n)).map((g) => ({
    id: g.id,
    name: clean(g.name) || typeLabel(g),
    type: typeLabel(g),
    lane: laneName(g),
    docMarkdown: docSource(g),
    next: describeNext(g),
    after: numberedBefore(g),
  }))

  const ends = nodes.filter((n) => is(n, 'bpmn:EndEvent') && processes.includes(n.$parent)).map((n) => ({
    name: displayName(n),
    lane: laneName(n),
    share: simulation?.runs ? (simulation.nodes[n.id] || 0) / simulation.runs : null,
  }))

  const laneRows = lanes.filter((l) => !l.childLaneSet).map((l) => ({
    name: clean(l.name) || T('Unnamed lane', 'Couloir sans nom'),
    activities: (l.flowNodeRef || []).filter(isActivity).sort((a, b) => (number.get(a.id) || 0) - (number.get(b.id) || 0)).map(ref),
  }))

  // ── Carte de chaleur : les chiffres que la simulation a comptés ──
  let heat = null
  if (simulation?.runs) {
    const runs = simulation.runs
    const count = (bo) => simulation.nodes[bo.id] || 0
    const top = nodes.filter((n) => isActivity(n) && count(n) > 0)
      .sort((a, b) => count(b) - count(a)).slice(0, 5)
      .map((n) => ({ id: n.id, name: ref(n), count: count(n), perInstance: count(n) / runs }))
    const branches = []
    for (const g of nodes) {
      if (!isGateway(g) || is(g, 'bpmn:ParallelGateway') || out(g).length < 2) continue
      const flowsOut = out(g)
      const total = flowsOut.reduce((a, f) => a + (simulation.flows[f.id] || 0), 0)
      for (const f of flowsOut) {
        const passes = simulation.flows[f.id] || 0
        const p = Number(f.get ? f.get('bpmnpilot:probability') : NaN)
        branches.push({
          gateway: clean(g.name) || typeLabel(g),
          branch: clean(f.name),
          target: f.targetRef ? ref(f.targetRef) : '',
          probability: Number.isFinite(p) ? p : null,
          ai: isAiProbability(f),
          count: passes,
          share: total ? passes / total : 0,
        })
      }
    }
    const never = nodes.filter((n) => !count(n) && !is(n, 'bpmn:BoundaryEvent') && !isGateway(n)).map(ref)
    heat = { top, branches, never }
  }

  // ── Contrôles de qualité ──
  const checkRows = (checks?.checks || []).map((c) => ({
    id: c.id,
    label: CHECK_LABEL[c.id] ? CHECK_LABEL[c.id]() : c.id,
    ok: !!c.ok,
    skipped: !!c.skipped,
    problems: c.ok || c.skipped ? 0 : (c.problems?.length || 0) + (c.more || 0),
    first: c.ok || c.skipped ? [] : (c.problems || []).slice(0, 3).map((p) => clean(p.message)),
  }))

  // ── Analyse du Co-pilote IA ──
  const saved = readAnalysis(definitions)
  const nameOf = (id) => {
    const bo = byId.get(id) || findAny(definitions, id)
    return bo ? (is(bo, 'bpmn:FlowNode') ? ref(bo) : clean(bo.name) || typeLabel(bo)) : id
  }
  const analysis = saved && {
    author: saved.author,
    date: saved.date ? new Date(saved.date) : null,
    stale: !!saved.fingerprint && saved.fingerprint !== structureFingerprint(definitions),
    summary: saved.summary,
    points: saved.points.map((p) => ({ kind: p.kind, label: POINT_LABEL[p.kind](), elements: p.elements.map(nameOf), elementIds: p.elements, text: p.text })),
  }

  // ── Comportement réel : analyse d'un journal d'événements (src/mining/), en totaux ──
  const realLife = mining && {
    source: mining.source,
    cases: mining.cases,
    events: mining.events,
    from: mining.from,
    to: mining.to,
    stale: !!mining.stale,
    saved: !mining.live,
    savedDate: mining.savedDate || '',
    hasDuration: !!mining.hasDuration,
    cycle: mining.cycle?.median ?? null,
    fitting: mining.conformance.fitting,
    total: mining.conformance.total,
    fitness: mining.conformance.fitness,
    deviations: mining.conformance.deviations.map((d) => ({ text: deviationText(d, nameOf), cases: d.cases })),
    timing: Object.entries(mining.timing || {})
      .map(([id, t]) => ({ name: nameOf(id), passes: mining.nodes[id] || 0, wait: t.wait?.median ?? null, waitP90: t.wait?.p90 ?? null, duration: mining.hasDuration && t.duration?.median ? t.duration.median : null }))
      .sort((a, b) => (b.wait ?? -1) - (a.wait ?? -1)),
    bottlenecks: (mining.bottlenecks || []).map(nameOf),
    variants: (mining.variants || []).slice(0, 5).map((v) => ({ steps: v.steps.join(' → '), cases: v.cases, fits: v.fits })),
    outside: mining.outside || [],
    heat: { runs: mining.cases, source: 'log', nodes: mining.nodes, flows: mining.flows },
  }

  const title = clean(participants.map((p) => p.name).filter(Boolean).join(' · '))
    || clean(processes.map((p) => p.name).filter(Boolean).join(' · '))
    || clean(name) || T('Process', 'Processus')

  return {
    title,
    fileName: clean(name),
    date: new Date(),
    counts: {
      activities: nodes.filter(isActivity).length,
      events: nodes.filter(isEvent).length,
      gateways: nodes.filter(isGateway).length,
      lanes: laneRows.length,
      error: findings.filter((f) => f.level === 'error').length,
      warning: findings.filter((f) => f.level === 'warning').length,
      todo: findings.filter((f) => f.level === 'todo').length,
    },
    findings: findings.map((f) => ({
      level: f.level,
      elementId: f.element?.id || null,
      element: f.element ? ref(f.element) : '',
      title: f.title,
      detail: f.detail,
      source: f.source,
      rule: f.rule || null,
    })),
    axes,
    ends,
    lanes: laneRows,
    sequence,
    raci: buildRaci(sequence),
    compliance: buildCompliance(sequence),
    identity: identityOf([
      ...(definitions.rootElements || []).filter((e) => is(e, 'bpmn:Collaboration')).map(identityHolder),
      ...processes,
      ...(definitions.rootElements || []).filter((e) => is(e, 'bpmn:Collaboration')),
    ]),
    gatewayDocs,
    // Documentation des réserves et des processus, en tête des fiches et du rapport.
    processDocs: [...participants, ...processes]
      .map((bo) => ({ name: clean(bo.name) || typeLabel(bo), markdown: docSource(bo) }))
      .filter((d) => d.markdown),
    realLife,
    simulation: simulation?.runs
      ? { runs: simulation.runs, source: simulation.source, truncated: simulation.truncated || 0, blocked: simulation.blocked || 0, blockedAt: { ...(simulation.blockedAt || {}) }, nodes: { ...simulation.nodes }, flows: { ...simulation.flows } }
      : null,
    heat,
    goals: goals.map((g) => ({
      elementId: g.bo.id,
      element: ref(g.bo),
      target: goalText(g.bo, g.goal),
      measured: g.measured === null ? null : measuredText(g.bo, g.measured),
      status: g.status,
    })),
    checks: checkRows,
    analysis,
    decisions: decisionRows(decisions),
    flagged: Object.fromEntries(worst),
  }
}

// Décisions DMN du diagramme (mode Expert), d'après src/dmn/setup.js report() : une entrée par
// décision avec sa table, les tâches qui l'appellent et ses constats, plus les constats des liens.
function decisionRows(data) {
  if (!data) return null
  const findingsOf = (id) => data.findings.filter((f) => f.decision === id).map((f) => ({ level: f.level, text: findingText(f) }))
  return {
    items: data.summary.decisions.map((d) => ({
      id: d.id,
      name: clean(d.name) || d.id,
      line: describeTable(d),
      calledBy: (data.calls[d.id] || []).map((t) => clean(t.name) || t.id),
      table: d.kind === 'table'
        ? {
            head: [...d.inputs.map((i) => clean(i.label || i.expression)), ...d.outputs.map((o) => clean(o.label || o.name)), T('Annotation', 'Annotation')],
            inputs: d.inputs.length,
            rows: d.rules.map((rule) => [...rule.inputs.map((v) => v || '-'), ...rule.outputs, rule.annotation || '']),
          }
        : null,
      expression: d.kind === 'literal' ? d.expression : '',
      findings: findingsOf(d.id),
    })),
    links: data.findings.filter((f) => !f.decision).map((f) => ({ level: f.level, text: findingText(f) })),
  }
}

function findAny(definitions, id) {
  for (const root of definitions.rootElements || []) {
    if (root.id === id) return root
    for (const el of allFlowElements(root)) if (el.id === id) return el
    for (const p of root.participants || []) if (p.id === id) return p
  }
  return null
}

const fmt = (x) => num(Math.round(x * 10) / 10)
// « au moins 80 % des instances », « au plus 15 passages pour 100 instances ».
function goalText(bo, goal) {
  const bound = goal.op === 'max' ? T('at most', 'au plus') : T('at least', 'au moins')
  return is(bo, 'bpmn:EndEvent')
    ? T(`${bound} ${fmt(goal.share)} % of instances`, `${bound} ${fmt(goal.share)} % des instances`)
    : T(`${bound} ${fmt(goal.share)} passes per 100 instances`, `${bound} ${fmt(goal.share)} passages pour 100 instances`)
}
const measuredText = (bo, value) => (is(bo, 'bpmn:EndEvent') ? `${fmt(value)} %` : T(`${fmt(value)} passes per 100`, `${fmt(value)} passages pour 100`))
const GOAL_STATUS = {
  met: () => T('Reached', 'Atteint'),
  missed: () => T('Not reached', 'Non atteint'),
  unmeasured: () => T('Not measured: run N tokens', 'Non mesuré : lancez N jetons'),
}
const quote = (text) => (lang === 'fr' ? `« ${text} »` : `"${text}"`)
// « A », « B » et « C »
function joinList(items) {
  if (items.length < 2) return items.join('')
  return `${items.slice(0, -1).join(', ')} ${T('and', 'et')} ${items[items.length - 1]}`
}

function lintDetail(rule) {
  const details = {
    'fake-join': T('Several incoming sequence flows without a merging gateway: each incoming token triggers the activity.',
      'Plusieurs flux de séquence entrants sans passerelle de convergence : chaque jeton entrant déclenche l\'activité.'),
    'label-required': T('A name makes the diagram and this report readable.', 'Un nom rend le diagramme et ce rapport lisibles.'),
    'no-disconnected': T('The element is connected to no sequence flow.', 'L\'élément n\'est relié à aucun flux de séquence.'),
    'no-implicit-start': T('An element without incoming flow starts the process instead of a start event.', 'Un élément sans flux entrant démarre le processus à la place d\'un événement de début.'),
    'no-implicit-end': T('An element without outgoing flow ends the process instead of an end event.', 'Un élément sans flux sortant termine le processus à la place d\'un événement de fin.'),
    'superfluous-gateway': T('A gateway with one incoming and one outgoing flow does nothing.', 'Une passerelle à un flux entrant et un flux sortant ne sert à rien.'),
    'no-gateway-join-fork': T('A gateway both merges and splits: two gateways are clearer.', 'Une passerelle converge et diverge à la fois : deux passerelles sont plus claires.'),
    'start-event-required': T('Every process and sub-process needs a start event.', 'Chaque processus et sous-processus a besoin d\'un événement de début.'),
    'end-event-required': T('Every process and sub-process needs an end event.', 'Chaque processus et sous-processus a besoin d\'un événement de fin.'),
    'bpmnpilot/agent-review': T('The result of the AI agent reaches an end without a person seeing it.', 'Le résultat de l\'agent IA atteint une fin sans qu\'une personne le voie.'),
    'bpmnpilot/agent-escalation': T('Nothing in the diagram says what happens if the AI agent fails or takes too long.', 'Rien dans le diagramme ne dit ce qui se passe si l\'agent IA échoue ou tarde.'),
    'bpmnpilot/form-data': T('A branch or a decision table reads data that no form before it asks for: in the engine, the variable would be empty.', 'Une branche ou une table de décision lit une donnée qu\'aucun formulaire placé avant elle ne demande : dans le moteur, la variable serait vide.'),
  }
  return details[rule] || T(`bpmnlint rule ${rule}.`, `Règle bpmnlint ${rule}.`)
}

function axisFor(kind, list, elements, { quoted, simulation }) {
  const n = list.length
  if (kind === 'unreachable') {
    return {
      title: T('Connect unreachable elements', 'Relier les éléments inaccessibles'),
      change: T(`Connect ${quoted(elements)} to the flow of the process, or remove them.`, `Relier ${quoted(elements)} au flux du processus, ou les supprimer.`),
      effect: T('Every element can be reached.', 'Chaque élément peut être atteint.'),
    }
  }
  if (kind === 'no-end') {
    return {
      title: T('Give the loop a way out', 'Donner une issue à la boucle'),
      change: T(`Add a path from ${quoted(elements)} to an end event, for example an exclusive gateway that limits repetitions.`,
        `Ajouter depuis ${quoted(elements)} un chemin vers un événement de fin, par exemple une passerelle exclusive qui limite les répétitions.`),
      effect: T('Every instance can complete.', 'Toutes les instances peuvent se terminer.'),
    }
  }
  if (kind === 'blocked') {
    return {
      title: n === 1 ? T(`Unblock ${quoted(elements)}`, `Débloquer ${quoted(elements)}`) : T('Unblock the merges', 'Débloquer les convergences'),
      change: T(`Match each merge with the split that opens its branches: a parallel merge after a parallel split, an exclusive merge after an exclusive split. Here: ${quoted(elements)}.`,
        `Accorder chaque convergence avec la divergence qui ouvre ses branches : convergence parallèle après une divergence parallèle, exclusive après une divergence exclusive. Ici : ${quoted(elements)}.`),
      effect: T('Every instance can complete.', 'Toutes les instances peuvent se terminer.'),
    }
  }
  if (kind === 'rework') {
    const top = list.reduce((a, b) => (b.count > a.count ? b : a))
    return {
      title: T(`Reduce rework on ${quoted([top.element])}`, `Réduire la reprise sur ${quoted([top.element])}`),
      change: T('Address the cause of the returns: information requested earlier, checks upstream.',
        'Traiter la cause des retours : informations demandées plus tôt, contrôle en amont.'),
      effect: T(`Up to ${num(top.count - simulation.runs)} executions avoided for ${num(simulation.runs)} instances.`,
        `Jusqu'à ${num(top.count - simulation.runs)} exécutions évitées pour ${num(simulation.runs)} instances.`),
    }
  }
  if (kind === 'goal') {
    return {
      title: n === 1 ? T(`Reach the goal on ${quoted(elements)}`, `Atteindre l'objectif sur ${quoted(elements)}`) : T('Reach the process goals', 'Atteindre les objectifs du processus'),
      change: T(`Review the paths leading to ${quoted(elements)}: checks upstream, branch probabilities, or the goal itself.`,
        `Revoir les chemins qui mènent à ${quoted(elements)} : contrôles en amont, probabilités des branches, ou l'objectif lui-même.`),
      effect: T(`${n} goal(s) reached at the next run of tokens.`, `${n} objectif(s) atteint(s) à la prochaine série de jetons.`),
    }
  }
  if (kind === 'ai-probability') {
    return {
      title: T('Review the proposed probabilities', 'Revoir les probabilités proposées'),
      change: T(`Check the branches of ${quoted(elements)} against what you know of the process, then keep or correct each value.`,
        `Confronter les branches de ${quoted(elements)} à ce que vous savez du processus, puis valider ou corriger chaque valeur.`),
      effect: T('The simulation and the heatmap rest on reviewed figures.', 'La simulation et la carte de chaleur reposent sur des chiffres revus.'),
    }
  }
  if (kind === 'risk-control') {
    return {
      title: T('Give each risk a control', 'Doter chaque risque d\'un contrôle'),
      change: T(`Name the control that prevents or detects the risks of ${quoted(elements)}, or accept the risk explicitly.`,
        `Nommer le contrôle qui prévient ou détecte les risques de ${quoted(elements)}, ou accepter le risque explicitement.`),
      effect: T('Every listed risk is covered.', 'Chaque risque noté est couvert.'),
    }
  }
  if (kind === 'doc') {
    return {
      title: T('Complete the documentation', 'Compléter la documentation'),
      change: T(`Describe ${quoted(elements)} in the Documentation field.`, `Décrire ${quoted(elements)} dans le champ Documentation.`),
      effect: T('Complete documentation.', 'Documentation complète.'),
    }
  }
  if (kind === 'flow-label') {
    return {
      title: T('Label the conditions', 'Nommer les conditions'),
      change: T(`Label the outgoing flows of ${quoted(elements)} with the answer to the gateway's question.`,
        `Libeller les flux sortants de ${quoted(elements)} par la réponse à la question de la passerelle.`),
      effect: T('The sequence reads without the diagram.', 'La séquence se lit sans le diagramme.'),
    }
  }
  if (kind === 'lane-single') {
    const names = joinList(list.map((f) => quote(clean(f.lane.name))))
    const one = list.length === 1
    return {
      title: T('Review the lanes', 'Revoir le découpage des couloirs'),
      change: one
        ? T(`The lane ${names} holds a single activity: merge it with another lane, or detail its work.`, `Le couloir ${names} ne porte qu'une activité : le fusionner avec un autre, ou détailler son travail.`)
        : T(`The lanes ${names} hold a single activity each: merge them, or detail their work.`, `Les couloirs ${names} ne portent chacun qu'une activité : les fusionner, ou détailler leur travail.`),
      effect: T('Clearer split of roles.', 'Répartition des rôles plus claire.'),
    }
  }
  if (kind === 'lint:bpmnpilot/agent-review') {
    return {
      title: T('Have a person review the AI agent', 'Faire relire l\'agent IA par une personne'),
      change: T(`After ${quoted(elements)}, add a user task that reviews the agent's result before it is used.`,
        `Après ${quoted(elements)}, ajouter une tâche utilisateur qui revoit le résultat de l'agent avant son usage.`),
      effect: T('No result of the agent leaves the process unchecked.', 'Aucun résultat de l\'agent ne sort du processus sans contrôle.'),
    }
  }
  if (kind === 'lint:bpmnpilot/agent-escalation') {
    return {
      title: T('Give the AI agent an exit', 'Prévoir une sortie à l\'agent IA'),
      change: T(`Attach a timer, error or escalation boundary event to ${quoted(elements)}, leading to a person.`,
        `Accrocher à ${quoted(elements)} un événement en bordure (minuterie, erreur ou escalade) qui mène à une personne.`),
      effect: T('A failed or stalled agent does not block the instance.', 'Un agent en échec ou bloqué n\'arrête pas l\'instance.'),
    }
  }
  if (kind === 'lint:bpmnpilot/form-data') {
    return {
      title: T('Ask for the data the process reads', 'Demander les données que lit le processus'),
      change: T(`Add the missing fields to a form placed before ${quoted(elements)}, with the same key as the variable.`,
        `Ajouter les champs manquants à un formulaire placé avant ${quoted(elements)}, avec la même clé que la variable.`),
      effect: T('Every branch and decision reads data someone filled in.', 'Chaque branche et chaque décision lit une donnée que quelqu\'un a remplie.'),
    }
  }
  if (kind === 'lint:fake-join') {
    return {
      title: T('Make merges explicit', 'Expliciter les convergences'),
      change: T(`Add a merging gateway before ${quoted(elements)}.`, `Ajouter une passerelle de convergence avant ${quoted(elements)}.`),
      effect: T(`${n} warning(s) cleared.`, `${n} avertissement(s) levé(s).`),
    }
  }
  if (kind.startsWith('lint:')) {
    const rule = kind.slice(5)
    return {
      title: T(`Fix: ${list[0].title}`, `Corriger : ${list[0].title}`),
      change: elements.length
        ? T(`Rule ${rule}, on ${quoted(elements)}.`, `Règle ${rule}, sur ${quoted(elements)}.`)
        : T(`Rule ${rule}.`, `Règle ${rule}.`),
      effect: T(`${n} finding(s) cleared.`, `${n} constat(s) levé(s).`),
    }
  }
  return null
}

// ── Markdown ────────────────────────────────────────────────────────────────

// Fiche d'identité, en tête du rapport et des fiches de procédure : une ligne par champ rempli.
export function identityMarkdown(identity) {
  const rows = identityRows(identity)
  return rows.length ? [...rows.map(([k, v]) => T(`- **${k}**: ${v}`, `- **${k}** : ${v}`)), ''] : []
}

// Cellule de tableau : barres verticales et barres obliques inverses échappées.
const mdCell = (s) => clean(s).replace(/[\\|]/g, '\\$&')

export function reportToMarkdown(r) {
  const c = r.counts
  const lines = [
    `# ${r.title}`,
    '',
    T(`Process report generated on ${dateText(r.date)} by BPMN Pilot`, `Rapport de processus généré le ${dateText(r.date)} par BPMN Pilot`) + (r.fileName ? ` · ${r.fileName}.bpmn` : '') + '.',
    '',
    ...identityMarkdown(r.identity),
    T(`${c.activities} activities, ${c.events} events, ${c.gateways} gateways, ${c.lanes} lanes. **${c.error} error(s), ${c.warning} warning(s), ${c.todo} to complete.**`,
      `${c.activities} activités, ${c.events} événements, ${c.gateways} passerelles, ${c.lanes} couloirs. **${c.error} erreur(s), ${c.warning} avertissement(s), ${c.todo} à compléter.**`),
    '',
    `## ${T('Modeling findings', 'Constats de modélisation')}`,
    '',
  ]
  if (r.findings.length) {
    lines.push(`| ${T('Level', 'Niveau')} | ${T('Element', 'Élément')} | ${T('Finding', 'Constat')} | ${T('Detail', 'Détail')} | Source |`, '|---|---|---|---|---|')
    for (const f of r.findings) lines.push(`| **${LEVEL_LABEL[f.level]().toUpperCase()}** | ${mdCell(f.element)} | ${mdCell(f.title)} | ${mdCell(f.detail)} | ${SOURCE_LABEL[f.source]()} |`)
  } else lines.push(T('No finding.', 'Aucun constat.'))
  lines.push('', `## ${T('Improvement areas', 'Axes d\'amélioration')}`, '')
  if (r.axes.length) {
    lines.push(`| ${T('Priority', 'Priorité')} | ${T('Area', 'Axe')} | ${T('Proposed change', 'Modification proposée')} | ${T('Expected effect', 'Effet attendu')} |`, '|---|---|---|---|')
    r.axes.forEach((a, i) => lines.push(`| **${PRIORITY_LABEL[a.level]().toUpperCase()}** | ${i + 1}. ${mdCell(a.title)} | ${mdCell(a.change)} | ${mdCell(a.effect)} |`))
  } else lines.push(T('Nothing to improve from the checks.', 'Rien à améliorer d\'après les contrôles.'))
  if (r.goals.length) {
    lines.push('', `## ${T('Process goals', 'Objectifs du processus')}`, '')
    lines.push(`| ${T('Element', 'Élément')} | ${T('Goal', 'Objectif')} | Simulation | ${T('Result', 'Résultat')} |`, '|---|---|---|---|')
    for (const g of r.goals) lines.push(`| ${mdCell(g.element)} | ${mdCell(g.target)} | ${g.measured ? mdCell(g.measured) : '–'} | **${GOAL_STATUS[g.status]()}** |`)
  }
  if (r.analysis) {
    const a = r.analysis
    lines.push('', `## ${T('AI co-pilot analysis', 'Analyse du Co-pilote IA')}`, '')
    lines.push(`*${analysisByline(a)}*`)
    if (a.stale) lines.push('', `> ${staleText()}`)
    if (a.summary) lines.push('', a.summary)
    if (a.points.length) {
      lines.push('', `| ${T('Kind', 'Nature')} | ${T('Elements', 'Éléments')} | ${T('Point', 'Point')} |`, '|---|---|---|')
      for (const p of a.points) lines.push(`| **${mdCell(p.label)}** | ${mdCell(p.elements.join(' · '))} | ${mdCell(p.text)} |`)
    }
  }
  if (r.heat) {
    const h = r.heat
    lines.push('', `## ${T('Heatmap', 'Carte de chaleur')}`, '')
    lines.push(heatIntro(r.simulation))
    if (h.top.length) {
      lines.push('', `### ${T('Most traversed activities', 'Activités les plus traversées')}`, '')
      lines.push(`| ${T('Activity', 'Activité')} | ${T('Passes', 'Passages')} | ${T('Per instance', 'Par instance')} |`, '|---|---|---|')
      for (const t of h.top) lines.push(`| ${mdCell(t.name)} | ${num(t.count)} | ${fmt(t.perInstance)} |`)
    }
    if (h.branches.length) {
      lines.push('', `### ${T('Gateway branches', 'Branches des passerelles')}`, '')
      lines.push(`| ${T('Gateway', 'Passerelle')} | ${T('Branch', 'Branche')} | ${T('Probability set', 'Probabilité saisie')} | ${T('Passes', 'Passages')} | ${T('Observed share', 'Part observée')} |`, '|---|---|---|---|---|')
      for (const b of h.branches) lines.push(`| ${mdCell(b.gateway)} | ${mdCell(branchText(b))} | ${probabilityText(b)} | ${num(b.count)} | ${Math.round(b.share * 100)} % |`)
    }
    lines.push('', `${T('**Never reached**:', '**Jamais atteints** :')} ${h.never.length ? mdCell(h.never.join(' · ')) : T('none', 'aucun')}.`)
    if (r.simulation.truncated) lines.push('', truncatedText(r.simulation.truncated))
    if (r.simulation.blocked) lines.push('', blockedText(r.simulation.blocked, r.simulation.runs))
  }
  if (r.realLife) {
    const m = r.realLife
    lines.push('', `## ${T('What really happens (event log)', 'Ce qui se passe réellement (journal d\'événements)')}`, '')
    lines.push(realLifeIntro(m))
    if (m.stale) lines.push('', `> ${T('The diagram changed since this analysis: load the log again for up-to-date figures.', 'Le diagramme a changé depuis cette analyse : rechargez le journal pour des chiffres à jour.')}`)
    lines.push('', `### ${T('Deviations from the diagram', 'Écarts au schéma')}`, '')
    lines.push(conformanceText(m))
    if (m.deviations.length) {
      lines.push('', `| ${T('Deviation', 'Écart')} | ${T('Cases', 'Dossiers')} |`, '|---|---|')
      for (const d of m.deviations) lines.push(`| ${mdCell(d.text)} | ${num(d.cases)} |`)
    }
    if (m.timing.length) {
      lines.push('', `### ${T('Waits and durations', 'Attentes et durées')}`, '')
      lines.push(`| ${T('Step', 'Étape')} | ${T('Passes', 'Passages')} | ${T('Median wait before', 'Attente médiane avant')} | ${T('90% wait under', '90 % des attentes sous')} |${m.hasDuration ? ` ${T('Median duration', 'Durée médiane')} |` : ''}`, `|---|---|---|---|${m.hasDuration ? '---|' : ''}`)
      for (const t of m.timing) lines.push(`| ${mdCell(t.name)} | ${num(t.passes)} | ${formatDuration(t.wait)} | ${formatDuration(t.waitP90)} |${m.hasDuration ? ` ${formatDuration(t.duration)} |` : ''}`)
      if (m.bottlenecks.length) lines.push('', `${T('**Longest waits (bottlenecks)**:', '**Attentes les plus longues (goulets d\'étranglement)** :')} ${mdCell(m.bottlenecks.join(' · '))}.`)
    }
    if (m.variants.length) {
      lines.push('', `### ${T('Most frequent paths (variants)', 'Chemins les plus fréquents (variantes)')}`, '')
      lines.push(`| ${T('Steps', 'Étapes')} | ${T('Cases', 'Dossiers')} | ${T('Follows the diagram', 'Suit le schéma')} |`, '|---|---|---|')
      for (const v of m.variants) lines.push(`| ${mdCell(v.steps)} | ${num(v.cases)} | ${v.fits ? T('yes', 'oui') : T('no', 'non')} |`)
    }
  }
  if (r.checks.length) {
    lines.push('', `## ${T('Quality checks', 'Contrôles de qualité')}`, '')
    lines.push(`| ${T('Check', 'Contrôle')} | ${T('Result', 'Résultat')} | ${T('First problems', 'Premiers problèmes')} |`, '|---|---|---|')
    for (const c of r.checks) lines.push(`| ${mdCell(c.label)} | ${checkResult(c)} | ${mdCell(c.first.join(' · '))} |`)
  }
  if (r.decisions) {
    lines.push('', `## ${T('Decisions (DMN)', 'Décisions (DMN)')}`)
    for (const d of r.decisions.items) {
      lines.push('', `### ${d.name}`, '', `*${mdCell(d.line)}* · ${T('called by', 'appelée par')} ${d.calledBy.length ? mdCell(d.calledBy.join(' · ')) : T('no task', 'aucune tâche')} · \`${d.id}\``)
      if (d.table?.rows.length) {
        lines.push('', `| N° | ${d.table.head.map((h, i) => (i < d.table.inputs ? `${T('When', 'Quand')} ${mdCell(h)}` : i < d.table.head.length - 1 ? `${T('Then', 'Alors')} ${mdCell(h)}` : mdCell(h))).join(' | ')} |`, `|---|${d.table.head.map(() => '---').join('|')}|`)
        d.table.rows.forEach((row, i) => lines.push(`| ${i + 1} | ${row.map((v) => mdCell(v)).join(' | ')} |`))
      }
      if (d.expression) lines.push('', '```', d.expression, '```')
      for (const f of d.findings) lines.push('', `- **${DECISION_LEVEL[f.level]()}** : ${f.text}`)
    }
    if (r.decisions.links.length) {
      lines.push('')
      for (const f of r.decisions.links) lines.push(`- **${DECISION_LEVEL[f.level]()}** : ${f.text}`)
    }
  }
  if (r.ends.length) {
    lines.push('', `## ${T('End events', 'Événements de fin')}`, '')
    lines.push(`| ${T('End event', 'Événement de fin')} | ${T('Lane', 'Couloir')} |${r.simulation ? ` ${T('Share of instances', 'Part des instances')} |` : ''}`, `|---|---|${r.simulation ? '---|' : ''}`)
    for (const e of r.ends) lines.push(`| ${mdCell(e.name)} | ${mdCell(e.lane)} |${r.simulation ? ` ${Math.round(e.share * 100)} % |` : ''}`)
  }
  if (r.lanes.length) {
    lines.push('', `## ${T('Activities by lane', 'Activités par couloir')}`, '')
    lines.push(`| ${T('Lane', 'Couloir')} | ${T('Activities', 'Activités')} |`, '|---|---|')
    for (const l of r.lanes) lines.push(`| ${mdCell(l.name)} | ${mdCell(l.activities.join(' · '))} |`)
  }
  const potential = r.sequence.filter((s) => s.aiPotential)
  if (potential.length) {
    const count = (k) => potential.filter((s) => s.aiPotential === k).length
    lines.push('', `## ${T('AI potential by activity', 'Potentiel d\'IA par activité')}`, '')
    lines.push(T(`${count('automate')} automatable, ${count('assist')} AI-assisted, ${count('human')} human, out of ${potential.length} rated activities.`,
      `${count('automate')} automatisable(s), ${count('assist')} assistée(s) par IA, ${count('human')} humaine(s), sur ${potential.length} activité(s) notée(s).`), '')
    lines.push(`| N° | ${T('Activity', 'Activité')} | ${T('Potential', 'Potentiel')} | ${T('Why, and safeguard', 'Raison et garde-fou')} |`, '|---|---|---|---|')
    for (const s of potential) lines.push(`| ${s.number} | ${mdCell(s.name)} | **${AI_POTENTIAL[s.aiPotential]()}** | ${mdCell(s.aiPotentialReason)} |`)
  }
  if (r.raci) {
    const [head, ...body] = raciRows(r.raci, T)
    lines.push('', `## ${T('RACI matrix', 'Matrice RACI')}`, '', T('R performs, A answers for it, C is consulted, I is informed.', 'R réalise, A en répond, C est consulté, I est informé.'), '')
    lines.push(`| ${head.map(mdCell).join(' | ')} |`, `|${head.map(() => '---').join('|')}|`)
    for (const row of body) lines.push(`| ${row.map(mdCell).join(' | ')} |`)
  }
  if (r.compliance?.risks.length) {
    lines.push('', `## ${T('Risks and controls', 'Risques et contrôles')}`, '')
    lines.push(`| N° | ${T('Activity', 'Activité')} | ${T('Risks', 'Risques')} | ${T('Controls', 'Contrôles')} |`, '|---|---|---|---|')
    for (const x of r.compliance.risks) lines.push(`| ${x.number} | ${mdCell(x.name)} | ${mdCell(x.risks.join(' · '))} | ${x.controls.length ? mdCell(x.controls.join(' · ')) : `*${T('none', 'aucun')}*`} |`)
  }
  if (r.compliance?.requirements.length) {
    lines.push('', `## ${T('Compliance matrix', 'Matrice de conformité')}`, '')
    lines.push(`| ${T('Requirement', 'Exigence')} | ${T('Activities concerned', 'Activités concernées')} |`, '|---|---|')
    for (const q of r.compliance.requirements) lines.push(`| ${mdCell(q.ref)} | ${mdCell(q.activities.join(' · '))} |`)
  }
  const stories = r.sequence.filter((s) => s.userStories.length || s.acceptanceCriteria.length)
  if (stories.length) {
    lines.push('', `## ${T('User stories and acceptance criteria', 'Récits utilisateur et critères d\'acceptation')}`)
    for (const s of stories) {
      lines.push('', `### ${s.number}. ${s.name}`)
      if (s.userStories.length) lines.push('', ...s.userStories.map((t) => `- ${t}`))
      if (s.acceptanceCriteria.length) lines.push('', `*${T('Acceptance criteria', 'Critères d\'acceptation')}*`, '', ...s.acceptanceCriteria.map((t) => `- [ ] ${t}`))
    }
  }
  lines.push('', `## ${T('Element sequence', 'Séquence des éléments')}`, '')
  lines.push(`| N° | ${T('Element', 'Élément')} | Type | ${T('Lane', 'Couloir')} | Documentation | ${T('Outgoing flows', 'Flux sortants')} |${r.simulation ? ` ${T('Instances', 'Instances')} |` : ''}`,
    `|---|---|---|---|---|---|${r.simulation ? '---|' : ''}`)
  for (const s of r.sequence) {
    const flag = s.level ? ` (${LEVEL_LABEL[s.level]().toLowerCase()})` : ''
    const doc = s.documentation || (s.needsDoc ? `*${T('to complete', 'à compléter')}*` : '')
    lines.push(`| ${s.number} | ${mdCell(s.name)}${flag} | ${mdCell(s.type)} | ${mdCell(laneCell(s))} | ${mdCell(doc)} | ${mdCell(s.next)} |${r.simulation ? ` ${s.count} |` : ''}`)
  }
  if (r.simulation) lines.push('', T(`Instances: tokens counted at the last simulation (${num(r.simulation.runs)} instances).`, `Instances : jetons comptés lors de la dernière simulation (${num(r.simulation.runs)} instances).`))
  // La documentation entière, mise en forme : le tableau n'en montre qu'une ligne.
  const documented = r.sequence.filter((s) => s.docMarkdown)
  if (r.processDocs.length || documented.length) {
    lines.push('', `## ${T('Documentation of the elements', 'Documentation des éléments')}`)
    for (const d of r.processDocs) lines.push('', `### ${d.name}`, '', shiftHeadings(d.markdown, 2))
    for (const s of documented) lines.push('', `### ${s.number}. ${s.name}`, '', shiftHeadings(s.docMarkdown, 2))
  }
  return lines.join('\n') + '\n'
}

const DECISION_LEVEL = {
  error: () => T('Error', 'Erreur'),
  warning: () => T('Warning', 'Avertissement'),
  info: () => T('To complete', 'À compléter'),
}

const analysisByline = (a) => {
  const when = a.date && !Number.isNaN(a.date.getTime()) ? dateText(a.date) : ''
  const who = a.author ? ` (${a.author})` : ''
  return T(`Written by the AI co-pilot${who}${when ? ` on ${when}` : ''}. To be validated by the process owner.`,
    `Rédigée par le Co-pilote IA${who}${when ? ` le ${when}` : ''}. À valider par le responsable du processus.`)
}
const staleText = () => T('The diagram has changed since this analysis: run it again for an up-to-date reading.',
  'Le diagramme a changé depuis cette analyse : relancez-la pour une lecture à jour.')
const heatIntro = (sim) => sim.source === 'batch'
  ? T(`${num(sim.runs)} tokens computed from the gateway probabilities.`, `${num(sim.runs)} jetons calculés selon les probabilités des passerelles.`)
  : T(`${num(sim.runs)} token(s) played during the simulation.`, `${num(sim.runs)} jeton(s) joué(s) pendant la simulation.`)
const realLifeIntro = (m) => T(
  `From the event log ${m.source}: ${num(m.cases)} cases, ${num(m.events)} events, ${formatDate(m.from)} to ${formatDate(m.to)}${m.cycle !== null ? `, median case ${formatDuration(m.cycle)}` : ''}.${m.saved ? ' Totals saved in the diagram file.' : ''}`,
  `D'après le journal d'événements ${m.source} : ${num(m.cases)} dossiers, ${num(m.events)} événements, du ${formatDate(m.from)} au ${formatDate(m.to)}${m.cycle !== null ? `, durée médiane d'un dossier ${formatDuration(m.cycle)}` : ''}.${m.saved ? ' Totaux enregistrés dans le fichier du diagramme.' : ''}`)
const conformanceText = (m) => T(
  `${Math.round((m.total ? m.fitting / m.total : 1) * 100)} % of cases follow the diagram (${num(m.fitting)} of ${num(m.total)}), fitness ${m.fitness.toFixed(2)}.`,
  `${Math.round((m.total ? m.fitting / m.total : 1) * 100)} % des dossiers suivent le schéma (${num(m.fitting)} sur ${num(m.total)}), conformité ${m.fitness.toFixed(2).replace('.', ',')}.`)
// Une convergence où des jetons attendent pour toujours : la branche attendue n'a pas été prise.
const blockedDetail = (where, count, runs) => T(
  `${num(count)} of ${num(runs)} instances (${Math.round((count / runs) * 100)} %) stay blocked on ${where}: a token waits there for a branch that was not taken, so the instance never completes.`,
  `${num(count)} instances sur ${num(runs)} (${Math.round((count / runs) * 100)} %) restent bloquées sur ${where} : un jeton y attend une branche qui n'a pas été prise, et l'instance ne se termine jamais.`)
const blockedText = (n, runs) => T(
  `${num(n)} of ${num(runs)} instances (${Math.round((n / runs) * 100)} %) stayed blocked on a merge: see the findings.`,
  `${num(n)} instances sur ${num(runs)} (${Math.round((n / runs) * 100)} %) sont restées bloquées sur une convergence : voir les constats.`)
const truncatedText = (n) => T(`${num(n)} instance(s) stopped after 5,000 steps: check for a loop without exit.`, `${num(n)} instance(s) arrêtée(s) après 5 000 étapes : vérifiez qu'aucune boucle n'est sans sortie.`)
const branchText = (b) => [b.branch, b.target].filter(Boolean).join(' → ')
const probabilityText = (b) => (b.probability === null ? T('shared', 'partagée') : `${num(b.probability)} %${b.ai ? T(' (AI, to review)', ' (IA, à revoir)') : ''}`)
const checkResult = (c) => (c.skipped ? T('not run', 'non fait') : c.ok ? 'OK' : T(`${c.problems} problem(s)`, `${c.problems} problème(s)`))

function dateText(date) {
  return date.toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
}

// ── PDF ─────────────────────────────────────────────────────────────────────

// Les polices standard de jsPDF (WinAnsi) n'ont ni les espaces fines insécables ni la flèche.
export const pdfText = (s) => String(s ?? '').replace(/[\u202f\u00a0\u2009]/g, ' ').replace(/\u2192/g, '>')

function hex(c) {
  const v = parseInt(c.slice(1), 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

// SVG du diagramme, les éléments concernés par un constat entourés de leur couleur.
async function flaggedSvg(modeler, flagged) {
  const { svg } = await modeler.saveSVG()
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  for (const [id, level] of Object.entries(flagged)) {
    const g = doc.querySelector(`g[data-element-id="${CSS.escape(id)}"] .djs-visual > :first-child`)
    if (!g) continue
    g.setAttribute('style', `${g.getAttribute('style') || ''};stroke:${COLORS[level].strong};stroke-width:4px;fill:${COLORS[level].soft}`)
  }
  return document.importNode(doc.documentElement, true)
}

// SVG du diagramme coloré selon les passages de jetons, comme la carte de chaleur du
// canevas : formes et flux du bleu pâle au rouge, épaisseur des flux selon le compte,
// pastille du compte sur les activités et les événements, gris pointillé si jamais atteint.
const rgb = (c) => c.match(/\d+/g).map(Number)
const SVG_NS = 'http://www.w3.org/2000/svg'

async function heatSvg(modeler, sim) {
  const { svg } = await modeler.saveSVG()
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const max = Math.max(1, ...Object.values(sim.nodes))
  const flowMax = Math.max(1, ...Object.values(sim.flows))
  const cold = 'stroke:#9CA3AF;stroke-dasharray:4 3;fill:#FFFFFF;opacity:0.7'
  // Les pastilles passent au-dessus de tout, flux compris.
  const badges = []
  for (const el of modeler.get('elementRegistry').getAll()) {
    if (el.type === 'label') continue
    const g = doc.querySelector(`g[data-element-id="${CSS.escape(el.id)}"]`)
    if (el.type === 'bpmn:SequenceFlow') {
      // Le trait est le chemin hors de <defs> ; la pointe de flèche, dans <defs>, prend la même couleur.
      const line = g?.querySelector('.djs-visual > path')
      if (!line) continue
      const n = sim.flows[el.id] || 0
      const color = n ? heatColor(n / flowMax) : '#9CA3AF'
      const width = n ? 2 + 5 * (n / flowMax) : 2
      line.setAttribute('style', `${line.getAttribute('style') || ''};stroke:${color};` + (n
        ? `stroke-width:${width.toFixed(1)}px`
        : 'stroke-dasharray:4 3'))
      g.querySelectorAll('marker').forEach((marker) => {
        // Pointe de taille fixe, quelle que soit l'épaisseur du trait.
        const size = (20 / width).toFixed(2)
        Object.entries({ markerWidth: size, markerHeight: size }).forEach(([k, v]) => marker.setAttribute(k, v))
        marker.querySelectorAll('path').forEach((m) => m.setAttribute('style', `${m.getAttribute('style') || ''};stroke:${color};fill:${color}`))
      })
      continue
    }
    const shape = g?.querySelector('.djs-visual > :first-child')
    if (!shape) continue
    if (!el.businessObject?.$instanceOf?.('bpmn:FlowNode') || !el.width) continue
    const n = sim.nodes[el.id] || 0
    if (!n) {
      shape.setAttribute('style', `${shape.getAttribute('style') || ''};${cold}`)
      continue
    }
    const color = heatColor(n / max)
    shape.setAttribute('style', `${shape.getAttribute('style') || ''};stroke:${color};fill:${color};fill-opacity:0.55`)
    if (el.type.endsWith('Gateway')) continue
    // Pastille du compte, au-dessus à droite de la forme.
    const text = heatBadge(n, sim)
    const w = text.length * 5.6 + 8
    const badge = doc.createElementNS(SVG_NS, 'g')
    badge.setAttribute('transform', `translate(${el.x + el.width - w + (el.width > 60 ? -4 : 12)}, ${el.y - 9})`)
    const rect = doc.createElementNS(SVG_NS, 'rect')
    Object.entries({ width: w, height: 13, rx: 6.5, ry: 6.5, style: 'fill:#1F2937;stroke:none' }).forEach(([k, v]) => rect.setAttribute(k, v))
    const label = doc.createElementNS(SVG_NS, 'text')
    Object.entries({ x: w / 2, y: 9.5, 'text-anchor': 'middle', style: 'fill:#FFFFFF;font-family:Arial, sans-serif;font-size:9px;font-weight:bold' }).forEach(([k, v]) => label.setAttribute(k, v))
    label.textContent = text
    badge.append(rect, label)
    badges.push(badge)
  }
  doc.documentElement.append(...badges)
  return document.importNode(doc.documentElement, true)
}

export async function reportToPdf(modeler, r) {
  const [{ jsPDF }, { svg2pdf }, { autoTable }] = await Promise.all([import('jspdf'), import('svg2pdf.js'), import('jspdf-autotable')])
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 12
  const ink = [31, 41, 55]
  const muted = [107, 114, 128]
  const blue = [30, 58, 138]
  doc.setProperties({ title: pdfText(r.title), subject: T('Process report', 'Rapport de processus'), creator: 'BPMN Pilot' })

  let y = M + 4
  doc.setFont('helvetica', 'bold').setFontSize(17).setTextColor(...ink)
  doc.text(pdfText(r.title), M, y)
  y += 5.5
  doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...muted)
  doc.text(pdfText(T(`Process report · generated on ${dateText(r.date)} by BPMN Pilot`, `Rapport de processus · généré le ${dateText(r.date)} par BPMN Pilot`) + (r.fileName ? ` · ${r.fileName}.bpmn` : '')), M, y)
  y += 4
  // Fiche d'identité : une ligne pour les champs courts, puis le périmètre.
  const idRows = identityRows(r.identity)
  if (idRows.length) {
    const scope = r.identity.scope
    const short = idRows.filter(([, v]) => v !== scope).map(([k, v]) => `${k}${T(': ', ' : ')}${v}`).join('   ·   ')
    doc.setFontSize(8.5).setTextColor(...ink)
    y += 1
    if (short) { doc.text(pdfText(short), M, y); y += 4 }
    if (scope) {
      const wrapped = doc.splitTextToSize(pdfText(`${T('Scope', 'Périmètre')}${T(': ', ' : ')}${scope}`), W - 2 * M)
      doc.text(wrapped.slice(0, 3), M, y)
      y += 3.6 * Math.min(3, wrapped.length) + 0.4
    }
  }

  // Chiffres clés.
  const c = r.counts
  const tiles = [
    [c.activities, T('activities', 'activités')],
    [c.events, T('events', 'événements')],
    [c.gateways, T('gateways', 'passerelles')],
    [c.lanes, T('lanes', 'couloirs')],
    [c.error, T('error(s)', 'erreur(s)'), 'error'],
    [c.warning, T('warning(s)', 'avertissement(s)'), 'warning'],
    [c.todo, T('to complete', 'à compléter'), 'todo'],
  ]
  const tw = 30
  tiles.forEach(([value, label, level], i) => {
    const x = M + i * (tw + 3)
    if (level) {
      doc.setFillColor(...hex(COLORS[level].soft)).setDrawColor(...hex(COLORS[level].strong))
    } else doc.setFillColor(255, 255, 255).setDrawColor(229, 231, 235)
    doc.roundedRect(x, y, tw, 13, 2, 2, 'FD')
    doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(...(level ? hex(level === 'todo' ? '#A16207' : COLORS[level].strong) : blue))
    doc.text(String(value), x + 3, y + 6)
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...ink)
    doc.text(pdfText(label), x + 3, y + 10.5)
  })
  y += 17

  // Priorité : la première erreur.
  const first = r.findings.find((f) => f.level === 'error')
  if (first) {
    doc.setFillColor(...hex(COLORS.error.soft)).setDrawColor(254, 202, 202)
    doc.roundedRect(M, y, W - 2 * M, 8, 2, 2, 'FD')
    tag(doc, M + 2.5, y + 1.8, T('Priority', 'Priorité'), 'error')
    doc.setFont('helvetica', 'bold').setFontSize(9).setTextColor(...ink)
    const head = pdfText(first.element ? `${first.element} : ` : '')
    doc.text(head, M + 22, y + 5.4)
    doc.setFont('helvetica', 'normal')
    doc.text(pdfText(first.title), M + 22 + doc.getTextWidth(head), y + 5.4)
    y += 11
  }

  // Diagramme.
  // svg2pdf lit les styles calculés : le SVG doit être dans la page le temps du dessin.
  const drawDiagram = async (svgEl, maxH, maxScale) => {
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden'
    host.append(svgEl)
    document.body.appendChild(host)
    try {
      const el = host.querySelector('svg')
      const sw = parseFloat(el.getAttribute('width')) || 800
      const sh = parseFloat(el.getAttribute('height')) || 600
      const maxW = W - 2 * M
      const scale = Math.min(maxW / sw, maxH / sh, maxScale)
      const dw = sw * scale
      const dh = sh * scale
      doc.setDrawColor(229, 231, 235)
      doc.roundedRect(M, y, maxW, dh + 4, 2, 2, 'S')
      await svg2pdf(el, doc, { x: M + (maxW - dw) / 2, y: y + 2, width: dw, height: dh })
      y += dh + 8
    } finally {
      host.remove()
    }
  }
  await drawDiagram(await flaggedSvg(modeler, r.flagged), Math.max(60, H - y - M - 30), 0.35)

  const section = (title) => {
    if (y > H - M - 25) { doc.addPage(); y = M + 4 }
    doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(...blue)
    doc.text(pdfText(title), M, y + 4)
    doc.setDrawColor(37, 99, 235).setLineWidth(0.6).line(M, y + 6, W - M, y + 6).setLineWidth(0.2)
    y += 8
  }

  const subsection = (title) => {
    if (y > H - M - 20) { doc.addPage(); y = M + 4 }
    doc.setFont('helvetica', 'bold').setFontSize(9.5).setTextColor(...ink)
    doc.text(pdfText(title), M, y + 3)
    y += 5
  }

  const baseTable = {
    margin: { left: M, right: M, top: M },
    theme: 'grid',
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.6, textColor: ink, lineColor: [229, 231, 235], lineWidth: 0.2, valign: 'top' },
    headStyles: { fillColor: [243, 244, 246], textColor: ink, fontStyle: 'bold' },
  }
  const table = (opts) => {
    autoTable(doc, { ...baseTable, startY: y, ...opts })
    y = doc.lastAutoTable.finalY + 6
  }
  // Ligne teintée selon le niveau, liseré à gauche, étiquette de couleur dans la première colonne.
  const levelHooks = (levels, labels) => ({
    didParseCell: (d) => {
      if (d.section !== 'body') return
      const level = levels[d.row.index]
      if (level) d.cell.styles.fillColor = hex(COLORS[level].soft)
      if (d.column.index === 0 && labels) d.cell.text = ['']
    },
    didDrawCell: (d) => {
      if (d.section !== 'body' || d.column.index !== 0) return
      const level = levels[d.row.index]
      if (!level) return
      doc.setFillColor(...hex(COLORS[level].strong))
      doc.rect(d.cell.x, d.cell.y, 1.2, d.cell.height, 'F')
      if (labels) tag(doc, d.cell.x + 2.4, d.cell.y + 1.4, labels[d.row.index], level)
    },
  })

  section(T('Modeling findings', 'Constats de modélisation'))
  if (r.findings.length) {
    table({
      head: [[T('Level', 'Niveau'), T('Element', 'Élément'), T('Finding', 'Constat'), T('Detail', 'Détail'), 'Source']],
      body: r.findings.map((f) => ['', pdfText(f.element), pdfText(f.title), pdfText(f.detail), SOURCE_LABEL[f.source]()]),
      columnStyles: { 0: { cellWidth: 28 }, 1: { cellWidth: 48, fontStyle: 'bold' }, 2: { cellWidth: 52 }, 4: { cellWidth: 20, textColor: muted } },
      ...levelHooks(r.findings.map((f) => f.level), r.findings.map((f) => LEVEL_LABEL[f.level]())),
    })
  } else note(T('No finding.', 'Aucun constat.'))

  // Carte de chaleur, sur sa propre page, si une simulation a tourné.
  if (r.simulation) {
    doc.addPage()
    y = M + 4
    section(T('Heatmap', 'Carte de chaleur'))
    const sim = r.simulation
    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...ink)
    doc.text(pdfText(heatIntro(sim)), M, y + 2)
    y += 5
    await drawDiagram(await heatSvg(modeler, sim), H - y - M - 22, 0.6)
    // Légende : dégradé, bornes et lecture.
    const max = Math.max(1, ...Object.values(sim.nodes))
    const lw = 70
    for (let i = 0; i < 70; i++) {
      doc.setFillColor(...rgb(heatColor(i / 69)))
      doc.rect(M + (i * lw) / 70, y, lw / 70 + 0.05, 3, 'F')
    }
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...muted)
    doc.text('1', M, y + 6.5)
    doc.text(num(max), M + lw, y + 6.5, { align: 'right' })
    doc.text(pdfText(T('Passes per element, from pale blue to red. Flow width follows the count. Dashed grey: never reached.',
      'Passages par élément, du bleu pâle au rouge. Épaisseur des flux selon le nombre de passages. Gris pointillé : jamais atteint.')), M + lw + 6, y + 2.6)
    if (sim.source === 'batch') doc.text(pdfText(T('Badge: passes · share of instances (or executions per instance above one).', 'Pastille : passages · part des instances (ou exécutions par instance au-delà de une).')), M + lw + 6, y + 6.5)
    y += 10
    if (sim.truncated) {
      doc.setTextColor(...hex(COLORS.warning.strong))
      doc.text(pdfText(truncatedText(sim.truncated)), M, y)
      y += 6
    }
    if (sim.blocked) {
      doc.setTextColor(...hex(COLORS.warning.strong))
      doc.text(pdfText(blockedText(sim.blocked, sim.runs)), M, y)
      y += 6
    }
    const h = r.heat
    if (h?.top.length) {
      subsection(T('Most traversed activities', 'Activités les plus traversées'))
      table({
        head: [[T('Activity', 'Activité'), T('Passes', 'Passages'), T('Per instance', 'Par instance')]],
        body: h.top.map((t) => [pdfText(t.name), num(t.count), fmt(t.perInstance)]),
        columnStyles: { 0: { fontStyle: 'bold' }, 1: { cellWidth: 30, halign: 'right' }, 2: { cellWidth: 30, halign: 'right' } },
      })
    }
    if (h?.branches.length) {
      subsection(T('Gateway branches', 'Branches des passerelles'))
      table({
        head: [[T('Gateway', 'Passerelle'), T('Branch', 'Branche'), T('Probability set', 'Probabilité saisie'), T('Passes', 'Passages'), T('Observed share', 'Part observée')]],
        body: h.branches.map((b) => [pdfText(b.gateway), pdfText(branchText(b)), pdfText(probabilityText(b)), num(b.count), `${Math.round(b.share * 100)} %`]),
        columnStyles: { 0: { cellWidth: 60, fontStyle: 'bold' }, 2: { cellWidth: 40 }, 3: { cellWidth: 24, halign: 'right' }, 4: { cellWidth: 28, halign: 'right' } },
        didParseCell: (d) => {
          if (d.section === 'body' && d.column.index === 2 && h.branches[d.row.index].ai) {
            d.cell.styles.fillColor = hex(COLORS.todo.soft)
            d.cell.styles.textColor = hex('#A16207')
          }
        },
      })
    }
    if (h) note(T('Never reached: ', 'Jamais atteints : ') + (h.never.length ? h.never.join(' · ') : T('none', 'aucun')) + '.')
  }

  // Comportement réel (journal d'événements), sur sa propre page.
  if (r.realLife) {
    const m = r.realLife
    doc.addPage()
    y = M + 4
    section(T('What really happens (event log)', 'Ce qui se passe réellement (journal d\'événements)'))
    doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(...ink)
    doc.text(doc.splitTextToSize(pdfText(realLifeIntro(m) + ' ' + conformanceText(m)), W - 2 * M), M, y + 2)
    y += 9
    if (m.stale) {
      doc.setTextColor(...hex(COLORS.warning.strong))
      doc.text(pdfText(T('The diagram changed since this analysis: load the log again for up-to-date figures.', 'Le diagramme a changé depuis cette analyse : rechargez le journal pour des chiffres à jour.')), M, y)
      y += 6
    } else {
      await drawDiagram(await heatSvg(modeler, m.heat), H - y - M - 16, 0.6)
      doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...muted)
      doc.text(pdfText(T('Real passes per element, from pale blue to red. Flow width follows the count. Dashed grey: never reached.',
        'Passages réels par élément, du bleu pâle au rouge. Épaisseur des flux selon le nombre de passages. Gris pointillé : jamais atteint.')), M, y + 2)
      y += 8
    }
    if (m.deviations.length) {
      subsection(T('Deviations from the diagram', 'Écarts au schéma'))
      table({
        head: [[T('Deviation', 'Écart'), T('Cases', 'Dossiers')]],
        body: m.deviations.map((d) => [pdfText(d.text), num(d.cases)]),
        columnStyles: { 1: { cellWidth: 30, halign: 'right' } },
      })
    }
    if (m.timing.length) {
      subsection(T('Waits and durations', 'Attentes et durées'))
      table({
        head: [[T('Step', 'Étape'), T('Passes', 'Passages'), T('Median wait before', 'Attente médiane avant'), T('90% wait under', '90 % des attentes sous'), ...(m.hasDuration ? [T('Median duration', 'Durée médiane')] : [])]],
        body: m.timing.map((t) => [pdfText(t.name), num(t.passes), pdfText(formatDuration(t.wait)), pdfText(formatDuration(t.waitP90)), ...(m.hasDuration ? [pdfText(formatDuration(t.duration))] : [])]),
        columnStyles: { 0: { fontStyle: 'bold' }, 1: { cellWidth: 24, halign: 'right' }, 2: { cellWidth: 40, halign: 'right' }, 3: { cellWidth: 40, halign: 'right' }, 4: { cellWidth: 32, halign: 'right' } },
      })
      if (m.bottlenecks.length) note(T('Longest waits (bottlenecks): ', 'Attentes les plus longues (goulets d\'étranglement) : ') + m.bottlenecks.join(' · ') + '.')
    }
    if (m.variants.length) {
      subsection(T('Most frequent paths (variants)', 'Chemins les plus fréquents (variantes)'))
      table({
        head: [[T('Steps', 'Étapes'), T('Cases', 'Dossiers'), T('Follows the diagram', 'Suit le schéma')]],
        body: m.variants.map((v) => [pdfText(v.steps), num(v.cases), v.fits ? T('yes', 'oui') : T('no', 'non')]),
        columnStyles: { 1: { cellWidth: 24, halign: 'right' }, 2: { cellWidth: 32 } },
      })
    }
  }

  section(T('Improvement areas', 'Axes d\'amélioration'))
  if (r.axes.length) {
    table({
      head: [[T('Priority', 'Priorité'), T('Area', 'Axe'), T('Proposed change', 'Modification proposée'), T('Expected effect', 'Effet attendu')]],
      body: r.axes.map((a, i) => ['', pdfText(`${i + 1}. ${a.title}`), pdfText(a.change), pdfText(a.effect)]),
      columnStyles: { 0: { cellWidth: 22 }, 1: { cellWidth: 62, fontStyle: 'bold' }, 3: { cellWidth: 70, textColor: [21, 128, 61], fontStyle: 'bold' } },
      ...levelHooks(r.axes.map((a) => a.level), r.axes.map((a) => PRIORITY_LABEL[a.level]())),
    })
  } else note(T('Nothing to improve from the checks.', 'Rien à améliorer d\'après les contrôles.'))

  if (r.goals.length) {
    section(T('Process goals', 'Objectifs du processus'))
    table({
      head: [[T('Element', 'Élément'), T('Goal', 'Objectif'), 'Simulation', T('Result', 'Résultat')]],
      body: r.goals.map((g) => [pdfText(g.element), pdfText(g.target), pdfText(g.measured || '–'), pdfText(GOAL_STATUS[g.status]())]),
      columnStyles: { 0: { cellWidth: 56, fontStyle: 'bold' }, 3: { cellWidth: 40 } },
      didParseCell: (d) => {
        if (d.section !== 'body' || d.column.index !== 3) return
        const status = r.goals[d.row.index].status
        d.cell.styles.fontStyle = 'bold'
        d.cell.styles.textColor = status === 'met' ? [21, 128, 61] : status === 'missed' ? hex(COLORS.warning.strong) : muted
      },
    })
  }

  if (r.analysis) {
    const a = r.analysis
    section(T('AI co-pilot analysis', 'Analyse du Co-pilote IA'))
    doc.setFont('helvetica', 'italic').setFontSize(8).setTextColor(...muted)
    doc.text(pdfText(analysisByline(a)), M, y + 2.5)
    y += 6.5
    if (a.stale) {
      doc.setFont('helvetica', 'bold').setTextColor(...hex(COLORS.warning.strong))
      doc.text(pdfText(staleText()), M, y + 1)
      y += 5
    }
    if (a.summary) {
      doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...ink)
      const wrapped = doc.splitTextToSize(pdfText(a.summary), W - 2 * M)
      if (y + wrapped.length * 4.2 > H - M) { doc.addPage(); y = M + 4 }
      doc.text(wrapped, M, y + 2)
      y += wrapped.length * 4.2 + 3
    }
    if (a.points.length) {
      table({
        head: [[T('Kind', 'Nature'), T('Elements', 'Éléments'), T('Point', 'Point')]],
        body: a.points.map((p) => [pdfText(p.label), pdfText(p.elements.join(' · ') || '–'), pdfText(p.text)]),
        columnStyles: { 0: { cellWidth: 34, fontStyle: 'bold', textColor: blue }, 1: { cellWidth: 62 } },
      })
    }
  }

  if (r.checks.length) {
    section(T('Quality checks', 'Contrôles de qualité'))
    table({
      head: [[T('Check', 'Contrôle'), T('Result', 'Résultat'), T('First problems', 'Premiers problèmes')]],
      body: r.checks.map((c) => [pdfText(c.label), pdfText(checkResult(c)), pdfText(c.first.join('\n') || '–')]),
      columnStyles: { 0: { cellWidth: 70, fontStyle: 'bold' }, 1: { cellWidth: 32 } },
      didParseCell: (d) => {
        if (d.section !== 'body' || d.column.index !== 1) return
        const c = r.checks[d.row.index]
        d.cell.styles.fontStyle = 'bold'
        d.cell.styles.textColor = c.skipped ? muted : c.ok ? [21, 128, 61] : hex(COLORS.error.strong)
      },
    })
  }

  if (r.decisions) {
    section(T('Decisions (DMN)', 'Décisions (DMN)'))
    for (const d of r.decisions.items) {
      subsection(`${d.name} (${d.id})`)
      doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...muted)
      doc.text(pdfText(`${d.line} · ${T('called by', 'appelée par')} ${d.calledBy.join(', ') || T('no task', 'aucune tâche')}`), M, y + 1)
      y += 4
      if (d.table?.rows.length) {
        table({
          head: [['N°', ...d.table.head.map((h, i) => pdfText(i < d.table.inputs ? `${T('When', 'Quand')} ${h}` : i < d.table.head.length - 1 ? `${T('Then', 'Alors')} ${h}` : h))]],
          body: d.table.rows.map((row, i) => [String(i + 1), ...row.map(pdfText)]),
          columnStyles: { 0: { cellWidth: 10 } },
          styles: { ...baseTable.styles, font: 'courier' },
        })
      } else y += 2
      if (d.expression) {
        doc.setFont('courier', 'normal').setFontSize(8).setTextColor(...ink)
        doc.text(doc.splitTextToSize(pdfText(d.expression), W - 2 * M), M, y + 2)
        y += 8
      }
      for (const f of d.findings) {
        if (y > H - M - 8) { doc.addPage(); y = M + 4 }
        doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...(f.level === 'error' ? hex(COLORS.error.strong) : f.level === 'warning' ? hex(COLORS.warning.strong) : muted))
        const lines = doc.splitTextToSize(pdfText(`${DECISION_LEVEL[f.level]()} : ${f.text}`), W - 2 * M)
        doc.text(lines, M, y + 1)
        y += lines.length * 3.6 + 1
      }
      y += 2
    }
    for (const f of r.decisions.links) {
      if (y > H - M - 8) { doc.addPage(); y = M + 4 }
      doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...(f.level === 'error' ? hex(COLORS.error.strong) : muted))
      doc.text(pdfText(`${DECISION_LEVEL[f.level]()} : ${f.text}`), M, y + 1)
      y += 4.5
    }
    y += 2
  }

  if (r.ends.length) {
    section(T('End events', 'Événements de fin'))
    table({
      head: [[T('End event', 'Événement de fin'), T('Lane', 'Couloir'), ...(r.simulation ? [T('Share of instances (simulation)', 'Part des instances (simulation)')] : [])]],
      body: r.ends.map((e) => [pdfText(e.name), pdfText(e.lane), ...(r.simulation ? [`${Math.round(e.share * 100)} %`] : [])]),
      columnStyles: { 0: { fontStyle: 'bold' } },
    })
  }

  if (r.lanes.length) {
    section(T('Activities by lane', 'Activités par couloir'))
    table({
      head: [[T('Lane', 'Couloir'), T('Activities', 'Activités')]],
      body: r.lanes.map((l) => [pdfText(l.name), pdfText(l.activities.join(' · '))]),
      columnStyles: { 0: { cellWidth: 50, fontStyle: 'bold', textColor: [37, 99, 235] } },
    })
  }

  const potential = r.sequence.filter((s) => s.aiPotential)
  if (potential.length) {
    section(T('AI potential by activity', 'Potentiel d\'IA par activité'))
    const tint = { automate: [219, 234, 254], assist: [254, 243, 199], human: [243, 244, 246] }
    table({
      head: [['N°', T('Activity', 'Activité'), T('Potential', 'Potentiel'), T('Why, and safeguard', 'Raison et garde-fou')]],
      body: potential.map((s) => [String(s.number), pdfText(s.name), pdfText(AI_POTENTIAL[s.aiPotential]()), pdfText(s.aiPotentialReason || '–')]),
      columnStyles: { 0: { cellWidth: 9 }, 1: { cellWidth: 50, fontStyle: 'bold' }, 2: { cellWidth: 42 } },
      didParseCell: (d) => { if (d.section === 'body' && d.column.index === 2) d.cell.styles.fillColor = tint[potential[d.row.index].aiPotential] },
    })
  }

  if (r.raci) {
    const [head, ...body] = raciRows(r.raci, T)
    section(T('RACI matrix', 'Matrice RACI'))
    table({
      head: [head.map(pdfText)],
      body: body.map((row) => row.map(pdfText)),
      columnStyles: { 0: { cellWidth: 9 }, 1: { cellWidth: 50, fontStyle: 'bold' } },
      didParseCell: (d) => { if (d.section === 'body' && d.column.index > 1) { d.cell.styles.halign = 'center'; d.cell.styles.fontStyle = 'bold' } },
    })
  }

  if (r.compliance?.risks.length) {
    const risks = r.compliance.risks
    section(T('Risks and controls', 'Risques et contrôles'))
    table({
      head: [['N°', T('Activity', 'Activité'), T('Risks', 'Risques'), T('Controls', 'Contrôles')]],
      body: risks.map((x) => [String(x.number), pdfText(x.name), pdfText(x.risks.map((t) => `• ${t}`).join('\n') || '–'), pdfText(x.controls.map((t) => `• ${t}`).join('\n') || T('none', 'aucun'))]),
      columnStyles: { 0: { cellWidth: 9 }, 1: { cellWidth: 50, fontStyle: 'bold' } },
      didParseCell: (d) => { if (d.section === 'body' && d.column.index === 3 && !risks[d.row.index].controls.length) d.cell.styles.fillColor = hex(COLORS.todo.soft) },
    })
  }

  if (r.compliance?.requirements.length) {
    section(T('Compliance matrix', 'Matrice de conformité'))
    table({
      head: [[T('Requirement', 'Exigence'), T('Activities concerned', 'Activités concernées')]],
      body: r.compliance.requirements.map((q) => [pdfText(q.ref), pdfText(q.activities.join('\n'))]),
      columnStyles: { 0: { cellWidth: 70, fontStyle: 'bold' } },
    })
  }

  const stories = r.sequence.filter((s) => s.userStories.length || s.acceptanceCriteria.length)
  if (stories.length) {
    section(T('User stories and acceptance criteria', 'Récits utilisateur et critères d\'acceptation'))
    table({
      head: [['N°', T('Activity', 'Activité'), T('User stories', 'Récits utilisateur'), T('Acceptance criteria', 'Critères d\'acceptation')]],
      body: stories.map((x) => [String(x.number), pdfText(x.name), pdfText(x.userStories.map((t) => `• ${t}`).join('\n') || '–'), pdfText(x.acceptanceCriteria.map((t) => `• ${t}`).join('\n') || '–')]),
      columnStyles: { 0: { cellWidth: 9 }, 1: { cellWidth: 40, fontStyle: 'bold' } },
    })
  }

  doc.addPage()
  y = M + 4
  section(T('Element sequence', 'Séquence des éléments'))
  const levels = r.sequence.map((s) => s.level)
  table({
    head: [['N°', T('Element', 'Élément'), 'Type', T('Lane', 'Couloir'), 'Documentation', T('Outgoing flows', 'Flux sortants'), ...(r.simulation ? ['Instances'] : [])]],
    body: r.sequence.map((s) => [
      String(s.number),
      pdfText(s.name + (s.tags.length ? '\n' + s.tags.map((t) => t.title).join(', ') : '')),
      pdfText(s.type),
      pdfText(laneCell(s)),
      pdfText(s.docMarkdown ? markdownToPlain(s.docMarkdown) : s.needsDoc ? T('to complete', 'à compléter') : '–'),
      pdfText(s.next || '–'),
      ...(r.simulation ? [String(s.count)] : []),
    ]),
    columnStyles: { 0: { cellWidth: 9 }, 1: { cellWidth: 46, fontStyle: 'bold' }, 2: { cellWidth: 32 }, 3: { cellWidth: 30, textColor: [37, 99, 235] }, 4: { cellWidth: 55 }, ...(r.simulation ? { 6: { cellWidth: 18, halign: 'right' } } : {}) },
    didParseCell: (d) => {
      if (d.section !== 'body') return
      const s = r.sequence[d.row.index]
      if (s.level) d.cell.styles.fillColor = hex(COLORS[s.level].soft)
      if (d.column.index === 4 && !s.documentation && s.needsDoc) {
        d.cell.styles.fillColor = hex('#FEF9C3')
        d.cell.styles.textColor = hex('#A16207')
        d.cell.styles.fontStyle = 'italic'
      }
      if (r.simulation && d.column.index === 6 && s.count > r.simulation.runs) {
        d.cell.styles.textColor = hex(COLORS.warning.strong)
        d.cell.styles.fontStyle = 'bold'
      }
    },
    didDrawCell: (d) => {
      if (d.section !== 'body' || d.column.index !== 0) return
      const level = levels[d.row.index]
      if (!level) return
      doc.setFillColor(...hex(COLORS[level].strong))
      doc.rect(d.cell.x, d.cell.y, 1.2, d.cell.height, 'F')
    },
  })
  if (r.simulation) note(T(`Instances: tokens counted at the last simulation (${num(r.simulation.runs)} instances).`, `Instances : jetons comptés lors de la dernière simulation (${num(r.simulation.runs)} instances).`))

  // Pied de page : numéro de page.
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...muted)
    doc.text(pdfText(`${r.title} · ${i}/${pages}`), W - M, H - 6, { align: 'right' })
  }
  return doc.output('blob')

  function note(text) {
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...muted)
    const lines = doc.splitTextToSize(pdfText(text), W - 2 * M)
    if (y + lines.length * 3.6 > H - 7) { doc.addPage(); y = M + 4 }
    doc.text(lines, M, y)
    y += lines.length * 3.6 + 2.4
  }
}

// Étiquette arrondie de couleur, texte en gras.
function tag(doc, x, y, text, level) {
  doc.setFont('helvetica', 'bold').setFontSize(7)
  const w = doc.getTextWidth(pdfText(text)) + 3.2
  doc.setFillColor(...hex(TAG_FILL[level]))
  doc.roundedRect(x, y, w, 4.2, 1, 1, 'F')
  doc.setTextColor(...hex(COLORS[level].text))
  doc.text(pdfText(text), x + 1.6, y + 3)
}

