// Série de jetons calculée d'un coup, sans animation : « Lancer N jetons » de la
// carte de chaleur. Chaque instance part de l'événement de début du processus et suit
// les flux de séquence selon la sémantique BPMN, simplifiée :
//   - passerelle exclusive, basée sur les événements ou complexe : un seul flux sortant,
//     tiré selon les probabilités (attribut bpmnpilot:probability, en %). Les flux sans
//     probabilité se partagent le reste à parts égales ;
//   - passerelle inclusive : chaque flux sortant est pris selon sa probabilité, au moins un ;
//     la convergence attend autant de jetons que la dernière divergence en a lancé ;
//   - passerelle parallèle : tous les flux sortants ; la convergence attend un jeton par flux entrant ;
//   - autre élément à plusieurs flux sortants : tous (flux non contrôlés) ;
//   - sous-processus déplié : on y entre par son événement de début, on en sort quand
//     ses jetons sont arrivés au bout ;
//   - les événements en bordure ne se déclenchent pas ;
//   - événement de fin de type Terminate : arrête l'instance.
// Le résultat compte, pour chaque élément et chaque flux, le nombre de passages.
// Il compte aussi les instances bloquées : quand plus aucun jeton ne peut avancer, des
// jetons attendent encore sur une convergence (par exemple une convergence parallèle
// derrière une divergence exclusive). blockedAt donne, par convergence, le nombre
// d'instances qui y sont restées bloquées.
// options.branchHint(passerelle, sortants, entrants) peut donner les poids d'une passerelle
// exclusive (tables de décision DMN, src/dmn/decision-routing.js) ; null garde le tirage habituel.

const MAX_STEPS = 5000 // par instance : une boucle sans sortie ne bloque pas la page

const isA = (bo, type) => bo?.$instanceOf?.(type)

export function probabilityOf(flow) {
  const value = flow.get ? flow.get('bpmnpilot:probability') : flow.probability
  const n = Number(value)
  return Number.isFinite(n) && n >= 0 ? n : null
}

// Probabilités normalisées (somme 1) des flux sortants d'une passerelle.
export function branchWeights(flows) {
  const given = flows.map(probabilityOf)
  const set = given.filter((p) => p !== null)
  const sum = set.reduce((a, b) => a + b, 0)
  const missing = given.filter((p) => p === null).length
  const rest = Math.max(0, 100 - sum)
  const raw = given.map((p) => (p === null ? (missing ? rest / missing : 0) : p))
  const total = raw.reduce((a, b) => a + b, 0)
  return total > 0 ? raw.map((p) => p / total) : flows.map(() => 1 / flows.length)
}

function pick(weights, random) {
  let r = random()
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]
    if (r < 0) return i
  }
  return weights.length - 1
}

// Événements de début d'un conteneur (processus ou sous-processus), hors sous-processus d'événement.
function startsOf(container) {
  return (container.flowElements || []).filter((e) => isA(e, 'bpmn:StartEvent'))
}

// Processus à simuler : celui du diagramme, ou ceux des bassins qui ont un événement de début.
export function simulatedProcesses(definitions) {
  const processes = []
  for (const root of definitions.rootElements || []) {
    if (isA(root, 'bpmn:Process') && startsOf(root).length) processes.push(root)
  }
  return processes
}

// Flux entrants et sortants de chaque élément, lus sur les flux de séquence eux-mêmes :
// les listes incoming et outgoing des éléments manquent dans les fichiers de certains outils.
export function flowIndex(containers) {
  const outgoing = new Map()
  const incoming = new Map()
  const push = (map, key, flow) => {
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(flow)
  }
  const walk = (container) => {
    for (const el of container.flowElements || []) {
      if (isA(el, 'bpmn:SequenceFlow')) {
        if (el.sourceRef) push(outgoing, el.sourceRef, el)
        if (el.targetRef) push(incoming, el.targetRef, el)
      } else if (isA(el, 'bpmn:SubProcess')) walk(el)
    }
  }
  containers.forEach(walk)
  return { outgoing: (node) => outgoing.get(node) || [], incoming: (node) => incoming.get(node) || [] }
}

export function runBatch(definitions, runs = 100, random = Math.random, { branchHint = null } = {}) {
  const nodes = {}
  const flows = {}
  const add = (map, id) => { map[id] = (map[id] || 0) + 1 }
  const processes = simulatedProcesses(definitions)
  const blockedAt = {}
  if (!processes.length) return { nodes, flows, runs: 0, truncated: 0, blocked: 0, blockedAt, source: 'batch' }
  const index = flowIndex(processes)
  let truncated = 0
  let blocked = 0

  for (let run = 0; run < runs; run++) {
    for (const process of processes) {
      // Une instance par processus, depuis son premier événement de début « simple »
      // (sans définition), sinon depuis le premier tout court.
      const starts = startsOf(process)
      const start = starts.find((s) => !(s.eventDefinitions || []).length) || starts[0]
      const state = { steps: 0, terminated: false, waiting: new Set() }
      runScope([start], state)
      if (state.steps >= MAX_STEPS) truncated++
      else if (!state.terminated && state.waiting.size) {
        blocked++
        for (const id of state.waiting) blockedAt[id] = (blockedAt[id] || 0) + 1
      }
    }
  }

  // Fait avancer les jetons d'un conteneur jusqu'à ce qu'ils soient tous arrivés.
  function runScope(startNodes, state) {
    const queue = [...startNodes]
    const joins = new Map() // passerelle de convergence -> jetons arrivés
    const inclusiveWidth = [] // nombre de branches lancées par les dernières divergences inclusives
    while (queue.length && !state.terminated) {
      if (++state.steps >= MAX_STEPS) return
      const node = queue.shift()
      const incoming = index.incoming(node)
      const outgoing = index.outgoing(node)

      // Convergences : on attend les jetons des autres branches.
      if (isA(node, 'bpmn:ParallelGateway') && incoming.length > 1) {
        const n = (joins.get(node) || 0) + 1
        if (n < incoming.length) { joins.set(node, n); continue }
        joins.set(node, 0)
      } else if (isA(node, 'bpmn:InclusiveGateway') && incoming.length > 1) {
        const expected = inclusiveWidth.length ? inclusiveWidth[inclusiveWidth.length - 1] : 1
        const n = (joins.get(node) || 0) + 1
        if (n < expected) { joins.set(node, n); continue }
        joins.set(node, 0)
        inclusiveWidth.pop()
      }

      add(nodes, node.id)

      if (isA(node, 'bpmn:SubProcess') && !node.triggeredByEvent) {
        const inner = startsOf(node)
        if (inner.length) runScope([inner.find((s) => !(s.eventDefinitions || []).length) || inner[0]], state)
        if (state.terminated || state.steps >= MAX_STEPS) return
      }
      if (isA(node, 'bpmn:EndEvent')) {
        if ((node.eventDefinitions || []).some((d) => isA(d, 'bpmn:TerminateEventDefinition'))) state.terminated = true
        continue
      }
      if (!outgoing.length) continue

      let taken
      if (outgoing.length === 1) taken = outgoing
      else if (isA(node, 'bpmn:ExclusiveGateway') || isA(node, 'bpmn:EventBasedGateway') || isA(node, 'bpmn:ComplexGateway')) {
        taken = [outgoing[pick((branchHint && branchHint(node, outgoing, incoming)) || branchWeights(outgoing), random)]]
      } else if (isA(node, 'bpmn:InclusiveGateway')) {
        const weights = branchWeights(outgoing)
        taken = outgoing.filter((f) => random() < (probabilityOf(f) ?? weights[outgoing.indexOf(f)] * 100) / 100)
        if (!taken.length) taken = [outgoing[pick(weights, random)]]
        inclusiveWidth.push(taken.length)
      } else taken = outgoing

      for (const flow of taken) {
        add(flows, flow.id)
        if (flow.targetRef) queue.push(flow.targetRef)
      }
    }
    // Plus rien à faire avancer : des jetons qui attendent encore sur une convergence n'en
    // repartiront jamais.
    if (!state.terminated) for (const [node, n] of joins) if (n > 0) state.waiting.add(node.id)
  }

  return { nodes, flows, runs, truncated, blocked, blockedAt, source: 'batch' }
}
