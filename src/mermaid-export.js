// Exporter > Mermaid : le diagramme ouvert écrit en flowchart Mermaid, pour un README ou un wiki
// qui affiche Mermaid (GitHub, GitLab…).
//
// Les tâches deviennent des rectangles, les sous-processus repliés des sous-routines, les
// sous-processus dépliés des sous-graphes, les événements des ronds (double rond pour une fin),
// les passerelles des losanges, les magasins et objets de données des cylindres et des
// parallélogrammes, les annotations des accolades. Couloirs et participants deviennent des
// sous-graphes, les flux de messages et les associations des liens en pointillé. Les positions,
// les couleurs et le détail des types (tâche utilisateur, événement de message…) n'ont pas
// d'équivalent dans un flowchart et sont perdus.

// Comme is() de bpmn-js, sans l'importer (le module tourne aussi sous Node, dans les tests).
const is = (el, type) => !!el?.$instanceOf?.(type)

const RESERVED = /^(end|graph|flowchart|subgraph|style|class|classdef|click|linkstyle|direction|default|call|callback|href|o|x)$/i

// Texte entre guillemets : guillemet et retour à la ligne codés comme Mermaid les lit.
export function mermaidText(s) {
  return `"${String(s ?? '').replace(/"/g, '#quot;').replace(/\r?\n/g, '<br>').trim()}"`
}

function safeId(id, used) {
  let s = String(id || 'node').replace(/[^A-Za-z0-9_-]/g, '_').replace(/^-+/, '')
  if (!s || RESERVED.test(s)) s = `n_${s}`
  let out = s
  let i = 2
  while (used.has(out)) out = `${s}_${i++}`
  used.add(out)
  return out
}

// definitions : la racine moddle (modeler.getDefinitions() ou BpmnModdle.fromXML).
export function bpmnToMermaid(definitions) {
  const lines = ['flowchart LR']
  const used = new Set()
  const ids = new Map()
  const idOf = (el) => {
    if (!ids.has(el)) ids.set(el, safeId(el.id, used))
    return ids.get(el)
  }
  // Partie graphique : sous-processus déplié ou non.
  const expanded = new Map()
  for (const d of definitions.diagrams || []) {
    for (const pe of d.plane?.planeElement || []) if (pe.bpmnElement && pe.isExpanded !== undefined) expanded.set(pe.bpmnElement, !!pe.isExpanded)
  }
  const isExpanded = (el) => (expanded.has(el) ? expanded.get(el) : !!el.flowElements?.some((f) => is(f, 'bpmn:FlowNode')))
  const edges = []
  const label = (el) => el.name || ''

  function shape(el) {
    const t = label(el)
    if (is(el, 'bpmn:StartEvent') || is(el, 'bpmn:IntermediateCatchEvent') || is(el, 'bpmn:IntermediateThrowEvent') || is(el, 'bpmn:BoundaryEvent')) return `((${mermaidText(t)}))`
    if (is(el, 'bpmn:EndEvent')) return `(((${mermaidText(t)})))`
    if (is(el, 'bpmn:Gateway')) {
      const sign = is(el, 'bpmn:ParallelGateway') ? '+' : is(el, 'bpmn:InclusiveGateway') ? 'O' : is(el, 'bpmn:EventBasedGateway') ? '*' : '×'
      return `{${mermaidText(t || sign)}}`
    }
    if (is(el, 'bpmn:SubProcess') || is(el, 'bpmn:CallActivity')) return `[[${mermaidText(t)}]]`
    if (is(el, 'bpmn:DataStoreReference')) return `[(${mermaidText(t)})]`
    if (is(el, 'bpmn:DataObjectReference')) return `[/${mermaidText(t)}/]`
    if (is(el, 'bpmn:TextAnnotation')) return `@{ shape: braces, label: ${mermaidText(el.text)} }`
    return `[${mermaidText(t)}]`
  }

  // Contenu d'un processus ou d'un sous-processus, couloirs en sous-graphes.
  function container(owner, pad, laneSets) {
    const elements = owner.flowElements || []
    const artifacts = owner.artifacts || []
    const inLane = new Map()
    function lanes(set, p) {
      for (const lane of set?.lanes || []) {
        lines.push(`${p}subgraph ${idOf(lane)}[${mermaidText(lane.name)}]`)
        if (lane.childLaneSet?.lanes?.length) lanes(lane.childLaneSet, `${p}  `)
        for (const fn of lane.flowNodeRef || []) {
          if (inLane.has(fn) || !elements.includes(fn)) continue
          inLane.set(fn, lane)
          node(fn, `${p}  `)
        }
        lines.push(`${p}end`)
      }
    }
    for (const set of laneSets || []) lanes(set, pad)
    for (const el of elements) {
      if (is(el, 'bpmn:SequenceFlow') || is(el, 'bpmn:DataObject') || inLane.has(el)) continue
      node(el, pad)
    }
    for (const el of artifacts) {
      if (is(el, 'bpmn:TextAnnotation')) node(el, pad)
      else if (is(el, 'bpmn:Association') && el.sourceRef && el.targetRef) edges.push([el.sourceRef, '-.-', '', el.targetRef])
    }
    for (const el of elements) {
      if (is(el, 'bpmn:SequenceFlow') && el.sourceRef && el.targetRef) edges.push([el.sourceRef, '-->', label(el), el.targetRef])
      for (const a of el.dataInputAssociations || []) for (const src of a.sourceRef || []) edges.push([src, '-.->', '', el])
      for (const a of el.dataOutputAssociations || []) if (a.targetRef) edges.push([el, '-.->', '', a.targetRef])
      if (is(el, 'bpmn:BoundaryEvent') && el.attachedToRef) edges.push([el.attachedToRef, '-.-', '', el])
    }
  }

  function node(el, pad) {
    if (is(el, 'bpmn:SubProcess') && isExpanded(el)) {
      lines.push(`${pad}subgraph ${idOf(el)}[${mermaidText(label(el))}]`)
      container(el, `${pad}  `, [])
      lines.push(`${pad}end`)
      return
    }
    if (!is(el, 'bpmn:FlowNode') && !is(el, 'bpmn:DataStoreReference') && !is(el, 'bpmn:DataObjectReference') && !is(el, 'bpmn:TextAnnotation')) return
    lines.push(`${pad}${idOf(el)}${shape(el)}`)
  }

  const roots = definitions.rootElements || []
  const collaboration = roots.find((r) => is(r, 'bpmn:Collaboration'))
  const done = new Set()
  if (collaboration?.participants?.length) {
    const many = collaboration.participants.length > 1
    for (const p of collaboration.participants) {
      const proc = p.processRef
      if (!proc) {
        // Participant sans processus (boîte noire) : un simple rectangle.
        lines.push(`  ${idOf(p)}[${mermaidText(label(p))}]`)
        continue
      }
      done.add(proc)
      const sets = proc.laneSets || []
      if (many || !sets.length) {
        lines.push(`  subgraph ${idOf(p)}[${mermaidText(label(p) || label(proc))}]`)
        container(proc, '    ', sets)
        lines.push('  end')
      } else {
        container(proc, '  ', sets)
      }
    }
    for (const el of collaboration.artifacts || []) {
      if (is(el, 'bpmn:TextAnnotation')) node(el, '  ')
      else if (is(el, 'bpmn:Association') && el.sourceRef && el.targetRef) edges.push([el.sourceRef, '-.-', '', el.targetRef])
    }
    for (const m of collaboration.messageFlows || []) if (m.sourceRef && m.targetRef) edges.push([m.sourceRef, '-.->', label(m), m.targetRef])
  }
  for (const proc of roots.filter((r) => is(r, 'bpmn:Process') && !done.has(r))) {
    if (!proc.flowElements?.length) continue
    container(proc, '  ', proc.laneSets || [])
  }
  for (const [a, link, text, b] of edges) {
    if (!ids.has(a) || !ids.has(b)) continue
    lines.push(`  ${ids.get(a)} ${link}${text ? `|${mermaidText(text)}|` : ''} ${ids.get(b)}`)
  }
  return `${lines.join('\n')}\n`
}
