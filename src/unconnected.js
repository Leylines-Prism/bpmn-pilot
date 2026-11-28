// Éléments laissés sans flux de séquence, signalés à l'agent dans la réponse de add_shapes,
// connect_shapes et export_diagram, pour qu'il relie les formes sans attendre validate_diagram.
// Travaille sur le modèle (bpmn-moddle) : la même fonction sert à la page et aux tests.

const isA = (bo, type) => !!bo?.$instanceOf?.(type)

// Ce que l'élément attend : un flux entrant, un flux sortant, ou les deux.
function needs(bo) {
  const definitions = bo.eventDefinitions || []
  const isLink = definitions.some((d) => isA(d, 'bpmn:LinkEventDefinition'))
  const isCompensation = definitions.some((d) => isA(d, 'bpmn:CompensateEventDefinition'))
  if (isA(bo, 'bpmn:BoundaryEvent')) {
    // Une bordure de compensation se relie par une association, pas par un flux.
    return isCompensation ? null : { incoming: false, outgoing: true }
  }
  if (isA(bo, 'bpmn:StartEvent')) return { incoming: false, outgoing: true }
  if (isA(bo, 'bpmn:EndEvent')) return { incoming: true, outgoing: false }
  // Paire d'événements de lien : le lanceur n'a pas de sortie, le receveur pas d'entrée.
  if (isA(bo, 'bpmn:IntermediateThrowEvent') && isLink) return { incoming: true, outgoing: false }
  if (isA(bo, 'bpmn:IntermediateCatchEvent') && isLink) return { incoming: false, outgoing: true }
  if (isA(bo, 'bpmn:Activity')) {
    // Activité de compensation et sous-processus d'événement : jamais reliés par un flux.
    if (bo.isForCompensation) return null
    if (isA(bo, 'bpmn:SubProcess') && bo.triggeredByEvent) return null
  }
  return { incoming: true, outgoing: true }
}

// Flux de séquence comptés depuis leurs extrémités (sourceRef, targetRef) : le modèle lu par
// bpmn-moddle ne remplit incoming et outgoing que si le XML les écrit.
function collectFlows(container, ends) {
  for (const bo of container.flowElements || []) {
    if (isA(bo, 'bpmn:SequenceFlow')) {
      if (bo.sourceRef) ends.out.add(bo.sourceRef)
      if (bo.targetRef) ends.in.add(bo.targetRef)
    } else if (bo.flowElements) collectFlows(bo, ends)
  }
}

function walk(container, ends, found) {
  // Dans un sous-processus ad hoc, les activités se passent de flux.
  const adHoc = isA(container, 'bpmn:AdHocSubProcess')
  for (const bo of container.flowElements || []) {
    if (!isA(bo, 'bpmn:FlowNode')) continue
    const need = adHoc ? null : needs(bo)
    if (need) {
      const missing = []
      if (need.incoming && !ends.in.has(bo)) missing.push('incoming')
      if (need.outgoing && !ends.out.has(bo)) missing.push('outgoing')
      if (missing.length) {
        const entry = { id: bo.id, type: bo.$type.replace('bpmn:', ''), missing }
        if (bo.name?.trim()) entry.name = bo.name.trim()
        found.push(entry)
      }
    }
    if (bo.flowElements) walk(bo, ends, found)
  }
}

// Liste des éléments sans le flux qu'ils attendent, dans l'ordre du document.
export function unconnectedNodes(definitions) {
  const found = []
  for (const root of definitions?.rootElements || []) {
    if (!isA(root, 'bpmn:Process')) continue
    const ends = { in: new Set(), out: new Set() }
    collectFlows(root, ends)
    walk(root, ends, found)
  }
  return found
}

const SHOWN = 10

// Champs ajoutés à la réponse d'un outil, ou rien quand tout est relié.
export function unconnectedNotice(definitions, { exporting = false } = {}) {
  const found = unconnectedNodes(definitions)
  if (!found.length) return {}
  const hint = exporting
    ? 'The file was exported, but some elements have no sequence flow: connect them with connect_shapes, then export again.'
    : 'Some elements have no sequence flow: connect them with connect_shapes, or append the next shape with add_shapes "after". Then check the result with validate_diagram.'
  const notice = { unconnected: found.slice(0, SHOWN), hint }
  if (found.length > SHOWN) notice.moreUnconnected = found.length - SHOWN
  return notice
}
