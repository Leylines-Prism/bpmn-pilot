// Ouvrir > Depuis Mermaid : un flowchart Mermaid converti en processus BPMN, sans IA.
//
// Le parseur lit le sous-ensemble « flowchart » de la syntaxe officielle de Mermaid
// (https://mermaid.js.org/syntax/flowchart.html, version 12) : nœuds et leurs formes, formes
// abrégées @{ shape: … }, liens et leurs libellés, chaînes A --> B --> C et A & B --> C,
// sous-graphes. Le paquet mermaid n'est pas utilisé : il pèse plusieurs mégaoctets, ne
// tourne pas sous Node sans DOM, et son parseur séparé (@mermaid-js/parser) ne lit pas les
// flowcharts. Ce qui n'est pas compris est signalé avec son numéro de ligne, jamais ignoré
// en silence.
//
// La conversion suit le sens documenté de chaque forme : losange en passerelle exclusive,
// rond et stade en événement, sous-routine en sous-processus, cylindre en magasin de données,
// document en objet de données, accolade en annotation. Les sous-graphes deviennent des
// couloirs, ou des sous-processus dépliés. Le XML produit n'a pas de partie graphique :
// l'éditeur le range avec bpmn-auto-layout, comme l'import depuis un tableau.

import { layoutProcess } from 'bpmn-auto-layout'
import { escapeXml } from './zip-write.js'

const OTHER_DIAGRAMS = /^(sequenceDiagram|stateDiagram(-v2)?|classDiagram(-v2)?|erDiagram|gantt|pie|journey|gitGraph|mindmap|timeline|quadrantChart|requirementDiagram|C4\w*|sankey(-beta)?|xychart(-beta)?|block(-beta)?|packet(-beta)?|kanban|architecture(-beta)?|radar(-beta)?|treemap(-beta)?|zenuml|info)\b/

// Formes abrégées (@{ shape: … }) et formes classiques, ramenées à une famille.
const SHAPE_FAMILY = {
  // Événements selon leurs liens
  stadium: 'event', pill: 'event', terminal: 'event', circle: 'event', circ: 'event', 'sm-circ': 'event', 'small-circle': 'event', start: 'event',
  // Fins
  'dbl-circ': 'end', 'double-circle': 'end', 'fr-circ': 'end', 'framed-circle': 'end', stop: 'end',
  // Passerelles
  diamond: 'xor', diam: 'xor', decision: 'xor', question: 'xor',
  fork: 'and', join: 'and',
  'f-circ': 'junction', 'filled-circle': 'junction', junction: 'junction',
  // Sous-processus
  subroutine: 'sub', subproc: 'sub', subprocess: 'sub', 'fr-rect': 'sub', 'framed-rectangle': 'sub',
  // Minuterie
  delay: 'timer', 'half-rounded-rectangle': 'timer', hourglass: 'timer', collate: 'timer',
  // Tâche manuelle
  'manual-input': 'manual', 'sl-rect': 'manual', 'sloped-rectangle': 'manual', 'trap-t': 'manual', 'inv-trapezoid': 'manual', manual: 'manual', 'trapezoid-top': 'manual',
  // Données
  cyl: 'store', cylinder: 'store', db: 'store', database: 'store', datastore: 'store', 'data-store': 'store', das: 'store', 'h-cyl': 'store', 'horizontal-cylinder': 'store', 'lin-cyl': 'store', 'disk': 'store', 'lined-cylinder': 'store',
  doc: 'data', document: 'data', docs: 'data', documents: 'data', 'st-doc': 'data', 'stacked-document': 'data', 'lin-doc': 'data', 'lined-document': 'data', 'tag-doc': 'data', 'tagged-document': 'data',
  'lean-r': 'data', 'lean-right': 'data', 'in-out': 'data', 'lean-l': 'data', 'lean-left': 'data', 'out-in': 'data',
  // Annotations
  comment: 'note', 'brace-l': 'note', brace: 'note', 'brace-r': 'note', braces: 'note', text: 'note',
}

// Ouvertures des formes classiques, de la plus longue à la plus courte.
const OPENERS = [
  ['(((', ')))', 'dbl-circ'],
  ['((', '))', 'circle'],
  ['([', '])', 'stadium'],
  ['[[', ']]', 'subroutine'],
  ['[(', ')]', 'cyl'],
  ['[/', ['/]', '\\]'], ['lean-r', 'trap-b']],
  ['[\\', ['\\]', '/]'], ['lean-l', 'trap-t']],
  ['{{', '}}', 'hex'],
  ['{', '}', 'diamond'],
  ['(', ')', 'rounded'],
  ['[', ']', 'rect'],
  ['>', ']', 'odd'],
]

const ENTITIES = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", nbsp: '\u00a0', num: '#', semi: ';', colon: ':' }

// Texte d'un nœud ou d'un lien : guillemets, chaînes Markdown, <br>, codes #quot; et #9829;,
// icônes fa:fa-x.
export function cleanText(raw) {
  let s = String(raw ?? '').trim()
  if (s.length >= 2 && s[0] === '"' && s.endsWith('"')) s = s.slice(1, -1)
  if (s.length >= 2 && s[0] === '`' && s.endsWith('`')) {
    s = s.slice(1, -1).replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1')
      .replace(/(^|[^\w*])\*(?!\s)(.+?)\*/g, '$1$2').replace(/(^|\W)_(?!\s)(.+?)_(?=\W|$)/g, '$1$2')
  }
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?[a-z][^>]*>/gi, '')
  s = s.replace(/#(\d+|[a-z]+);/gi, (m, code) => (/^\d+$/.test(code) ? String.fromCodePoint(Math.min(Number(code), 0x10ffff)) : ENTITIES[code.toLowerCase()] ?? m))
  s = s.replace(/\bfa[bsrlk]?:fa-[\w-]+\s*/g, '')
  return s.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n')
}

// Prend le premier bloc ```mermaid d'un texte Markdown, ou le texte tel quel.
export function extractMermaid(text) {
  const src = String(text ?? '').replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '')
  const fence = src.match(/^[ \t]*(```|~~~)[ \t]*mermaid[^\n]*\n([\s\S]*?)^[ \t]*\1[ \t]*$/m)
  return fence ? { source: fence[2], fenced: true } : { source: src, fenced: false }
}

// Vrai si le texte ressemble à un flowchart Mermaid (pour Coller du XML et le dépôt de fichier).
export function looksLikeMermaid(text) {
  const { source, fenced } = extractMermaid(text)
  if (fenced) return true
  const first = stripPreamble(source).split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('%%'))
  return !!first && /^(flowchart|graph)\b/i.test(first)
}

function stripPreamble(source) {
  // En-tête de configuration YAML (---) et directives %%{init: …}%%.
  return source.replace(/^\s*---\n[\s\S]*?\n---[ \t]*(\n|$)/, '').replace(/%%\{[\s\S]*?\}%%/g, '')
}

// Découpe en instructions : fins de ligne et « ; » hors des guillemets et des crochets.
function statements(body, firstLine) {
  const out = []
  let cur = ''
  let line = firstLine
  let startLine = line
  let quote = ''
  let depth = 0
  const push = () => {
    const t = cur.trim()
    if (t && !t.startsWith('%%')) out.push({ text: t, line: startLine })
    cur = ''
  }
  for (let i = 0; i < body.length; i++) {
    const c = body[i]
    if (!cur.trim()) startLine = line
    if (c === '\n') {
      line++
      // Un texte entre guillemets peut tenir sur plusieurs lignes ; un crochet ouvert, non.
      if (quote) { cur += ' '; continue }
      if (depth > 0) { out.push({ text: cur.trim(), line: startLine, unclosed: true }); cur = ''; depth = 0; continue }
      push()
      continue
    }
    if (quote) { if (c === quote) quote = ''; cur += c; continue }
    if (c === '"') { quote = '"'; cur += c; continue }
    if ('[({'.includes(c)) depth++
    else if (')]}'.includes(c)) depth = Math.max(0, depth - 1)
    if (c === ';' && depth === 0) { push(); continue }
    // Un « %% » en milieu de ligne commence un commentaire jusqu'à la fin de la ligne.
    if (c === '%' && body[i + 1] === '%' && depth === 0) {
      while (i + 1 < body.length && body[i + 1] !== '\n') i++
      continue
    }
    cur += c
  }
  if (quote || depth > 0) out.push({ text: cur.trim(), line: startLine, unclosed: true })
  else push()
  return out
}

// Contenu d'un @{ … } : paires clé: valeur, valeurs entre guillemets possibles.
function parseMeta(src) {
  const meta = {}
  const re = /([\w-]+)\s*:\s*("(?:[^"\\]|\\.)*"|[^,}]*)/g
  let m
  while ((m = re.exec(src))) meta[m[1].toLowerCase()] = m[2].trim().replace(/^"|"$/g, '').replace(/\\"/g, '"')
  return meta
}

// Lien : formes -->, ---, ==>, -.->, ~~~, <-->, --x, --o, longueurs variables, texte -- texte -->
// ou -->|texte|. Rend { end, kind, label, arrow } ou null.
const LINK = /^([<xo])?(?:(-{2,}|={2,})([>xo])?|-(\.+)-([>xo])?|(~{3,}))/
function readLink(s, i) {
  const rest = s.slice(i)
  // Identifiant de lien (e1@-->) : ignoré.
  const idm = rest.match(/^[\w-]+@(?=[-=~<xo.])/)
  if (idm) return readLink(s, i + idm[0].length)
  // Texte au milieu : -- texte -->, == texte ==>, -. texte .->
  const mid = rest.match(/^([<xo])?(--|==|-\.)(?=\s)/)
  if (mid) {
    const close = mid[2] === '--' ? /\s(-{2,}[>xo]|-{3,})/ : mid[2] === '==' ? /\s(={2,}[>xo]|={3,})/ : /\s(\.+-[>xo]?)/
    const after = rest.slice(mid[0].length)
    const cm = after.match(close)
    if (cm) {
      const label = after.slice(0, cm.index)
      const end = i + mid[0].length + cm.index + cm[0].length
      const head = cm[1].slice(-1)
      return { end, kind: 'flow', label: cleanText(label), arrow: '>xo'.includes(head) ? head : '', back: mid[1] || '' }
    }
  }
  const m = rest.match(LINK)
  if (!m) return null
  let end = i + m[0].length
  let label = ''
  const pipe = s.slice(end).match(/^\s*\|([^|]*)\|/)
  if (pipe) { label = cleanText(pipe[1]); end += pipe[0].length }
  if (m[6]) return { end, kind: 'invisible', label, arrow: '', back: '' }
  return { end, kind: 'flow', label, arrow: m[3] || m[5] || '', back: m[1] || '' }
}

const ID_CHAR = /[\p{L}\p{N}_.$/\\+!?'*#-]/u

function readId(s, i) {
  let j = i
  while (j < s.length && ID_CHAR.test(s[j])) {
    // Un tiret suivi d'un tiret, d'un point ou d'un chevron commence un lien.
    if (s[j] === '-' && /[-.>]/.test(s[j + 1] || '')) break
    if (s[j] === '.' && s[j + 1] === '-') break
    j++
  }
  // Têtes de lien collées : A--xB et Ao--oB restent rares, mais « x » et « o » avant -- en fin
  // d'identifiant sont lus comme une tête de lien (A x--x B s'écrit avec des espaces).
  return j > i ? { id: s.slice(i, j), end: j } : null
}

function readBracket(s, i, open, close) {
  // Texte entre guillemets, ou jusqu'à la fermeture.
  let j = i + open.length
  while (s[j] === ' ') j++
  const closes = Array.isArray(close) ? close : [close]
  if (s[j] === '"') {
    const q = s.indexOf('"', j + 1)
    if (q < 0) return null
    let k = q + 1
    while (s[k] === ' ') k++
    const c = closes.findIndex((cl) => s.startsWith(cl, k))
    if (c < 0) return null
    return { text: s.slice(j, q + 1), end: k + closes[c].length, which: c }
  }
  let best = null
  closes.forEach((cl, c) => {
    const k = s.indexOf(cl, j)
    if (k >= 0 && (!best || k < best.k)) best = { k, c }
  })
  if (!best) return null
  return { text: s.slice(j, best.k), end: best.k + closes[best.c].length, which: best.c }
}

// Nœud : identifiant, forme facultative, @{ … } facultatif, :::classe facultative.
function readNode(s, i) {
  const idr = readId(s, i)
  if (!idr) return null
  let j = idr.end
  const node = { id: idr.id }
  if (s[j] === '@' && s[j + 1] === '{') {
    const k = s.indexOf('}', j)
    if (k < 0) return { error: 'meta', end: s.length }
    node.meta = parseMeta(s.slice(j + 2, k))
    j = k + 1
  } else {
    for (const [open, close, shape] of OPENERS) {
      if (!s.startsWith(open, j)) continue
      const b = readBracket(s, j, open, close)
      if (!b) return { error: 'bracket', end: s.length }
      node.text = b.text
      node.shape = Array.isArray(shape) ? shape[b.which] : shape
      j = b.end
      break
    }
  }
  const cls = s.slice(j).match(/^:::[\w-]+/)
  if (cls) j += cls[0].length
  return { node, end: j }
}

const skipSpaces = (s, i) => { while (s[i] === ' ' || s[i] === '\t') i++; return i }

// Analyse un flowchart. Rend { direction, nodes, edges, subgraphs, warnings, errors }.
export function parseMermaid(text, T = (en) => en) {
  const errors = []
  const warnings = []
  const result = { direction: 'TB', nodes: new Map(), edges: [], subgraphs: [], warnings, errors }
  const { source } = extractMermaid(text)
  const clean = stripPreamble(source)
  const offset = source.split('\n').length - clean.split('\n').length
  const lines = clean.split('\n')
  let h = 0
  while (h < lines.length && (!lines[h].trim() || lines[h].trim().startsWith('%%'))) h++
  if (h >= lines.length) {
    errors.push(T('The text is empty.', 'Le texte est vide.'))
    return result
  }
  const header = lines[h].trim()
  const hm = header.match(/^(flowchart|graph)\b[ \t]*(TB|TD|BT|RL|LR)?[ \t]*;?(.*)$/i)
  if (!hm) {
    const other = header.match(OTHER_DIAGRAMS)
    errors.push(other
      ? T(`This is a Mermaid ${other[1]}, not a flowchart: only flowcharts (flowchart or graph) can be converted to BPMN.`,
        `C'est un ${other[1]} Mermaid, pas un flowchart : seuls les flowcharts (flowchart ou graph) se convertissent en BPMN.`)
      : T('The text does not start with "flowchart" or "graph": it is not a Mermaid flowchart.',
        'Le texte ne commence pas par « flowchart » ou « graph » : ce n\'est pas un flowchart Mermaid.'))
    return result
  }
  result.direction = (hm[2] || 'TB').toUpperCase().replace('TD', 'TB')
  const body = [hm[3] || '', ...lines.slice(h + 1)].join('\n')
  const stack = []
  const ignored = new Set()
  const lineNo = (n) => n + offset

  const touch = (raw, line) => {
    let n = result.nodes.get(raw.id)
    if (!n) {
      n = { id: raw.id, label: '', shape: '', line, order: result.nodes.size, subgraph: null, defined: false }
      result.nodes.set(raw.id, n)
    }
    if (raw.text !== undefined) { n.label = cleanText(raw.text); n.shape = raw.shape; n.defined = true }
    if (raw.meta) {
      if (raw.meta.shape) { n.shape = raw.meta.shape.toLowerCase(); n.defined = true }
      if (raw.meta.label !== undefined) { n.label = cleanText(raw.meta.label); n.defined = true }
      if (raw.meta.view) n.view = raw.meta.view
    }
    // Comme Mermaid : une étape reste dans le premier sous-graphe où elle apparaît, même quand un
    // lien écrit dans un autre sous-graphe la cite.
    const sg = stack[stack.length - 1]
    if (sg && n.subgraph === null) { n.subgraph = sg; sg.nodes.push(n.id) }
    return n
  }

  for (const st of statements(body, h + 1)) {
    const s = st.text
    const L = lineNo(st.line)
    if (st.unclosed) {
      warnings.push(T(`Line ${L}: a quote or a bracket is not closed, line ignored.`, `Ligne ${L} : un guillemet ou un crochet n'est pas fermé, ligne ignorée.`))
      continue
    }
    const kw = s.match(/^(\w+)/)?.[1]
    if (kw === 'subgraph') {
      const rest = s.slice(8).trim()
      let id = rest
      let title = rest
      const br = rest.match(/^([^\s[]+)\s*\[(.*)\]$/)
      if (br) { id = br[1]; title = br[2] }
      else if (/^".*"$/.test(rest)) id = `subgraph_${result.subgraphs.length + 1}`
      const sg = { id: id || `subgraph_${result.subgraphs.length + 1}`, title: cleanText(title) || id, parent: stack[stack.length - 1] || null, nodes: [], line: L, order: result.subgraphs.length }
      result.subgraphs.push(sg)
      stack.push(sg)
      continue
    }
    if (kw === 'end' && s === 'end') {
      if (!stack.length) errors.push(T(`Line ${L}: "end" without a subgraph.`, `Ligne ${L} : « end » sans sous-graphe.`))
      stack.pop()
      continue
    }
    if (/^direction\s+(TB|TD|BT|RL|LR)$/i.test(s)) { ignored.add('direction'); continue }
    if (/^(classDef|class|style|linkStyle|click|callback|accTitle|accDescr)\b/.test(s)) { ignored.add(kw); continue }

    // Chaîne : groupe (lien groupe)*, un groupe étant nœud (& nœud)*.
    let i = 0
    let prev = null
    let ok = true
    while (i < s.length) {
      i = skipSpaces(s, i)
      const group = []
      for (;;) {
        const r = readNode(s, i)
        if (!r || r.error) { ok = false; break }
        group.push(r.node)
        i = skipSpaces(s, r.end)
        if (s[i] === '&') { i = skipSpaces(s, i + 1); continue }
        break
      }
      if (!ok) break
      // Métadonnée d'un lien (e1@{ step: 1 }) : ignorée.
      if (group.length === 1 && group[0].meta && !prev && i >= s.length && ('step' in group[0].meta || 'animate' in group[0].meta || 'animation' in group[0].meta || 'curve' in group[0].meta) && !group[0].meta.shape) {
        ignored.add('animation')
        group.length = 0
        break
      }
      const nodes = group.map((g) => touch(g, st.line))
      if (prev) {
        for (const a of prev.nodes) for (const b of nodes) result.edges.push({ from: a.id, to: b.id, label: prev.link.label, kind: prev.link.kind, arrow: prev.link.arrow, back: prev.link.back, line: L })
      }
      if (i >= s.length) break
      const link = readLink(s, i)
      if (!link) { ok = false; break }
      i = skipSpaces(s, link.end)
      if (i >= s.length) { ok = false; break }
      prev = { nodes, link }
    }
    if (!ok) {
      warnings.push(T(`Line ${L}: not understood, ignored: ${s.slice(0, 60)}`, `Ligne ${L} : pas comprise, ignorée : ${s.slice(0, 60)}`))
    }
  }
  if (stack.length) warnings.push(T(`A subgraph is not closed by "end": "${stack[stack.length - 1].title}".`, `Un sous-graphe n'est pas fermé par « end » : « ${stack[stack.length - 1].title} ».`))

  // Un identifiant de sous-graphe utilisé dans un lien désigne le sous-graphe, pas un nœud.
  const sgIds = new Map(result.subgraphs.map((sg) => [sg.id, sg]))
  for (const [id, n] of result.nodes) {
    if (sgIds.has(id) && !n.defined) {
      result.nodes.delete(id)
      if (n.subgraph) n.subgraph.nodes = n.subgraph.nodes.filter((x) => x !== id)
      if (n.view === 'collapsed') sgIds.get(id).collapsed = true
    }
  }
  for (const sg of result.subgraphs) sg.nodes = sg.nodes.filter((id) => result.nodes.has(id))
  for (const n of result.nodes.values()) if (!n.label) n.label = n.id
  if (ignored.size) {
    warnings.push(T(`Ignored, without effect on the process: ${[...ignored].join(', ')}.`, `Ignoré, sans effet sur le processus : ${[...ignored].join(', ')}.`))
  }
  if (!result.nodes.size && !errors.length) errors.push(T('The flowchart has no node.', 'Le flowchart n\'a aucun nœud.'))
  return result
}

// ── Conversion en BPMN ──

const TAGS = {
  task: 'bpmn:task', manual: 'bpmn:manualTask', sub: 'bpmn:callActivity', expanded: 'bpmn:subProcess',
  start: 'bpmn:startEvent', end: 'bpmn:endEvent', intermediate: 'bpmn:intermediateThrowEvent', timer: 'bpmn:intermediateCatchEvent',
  xor: 'bpmn:exclusiveGateway', and: 'bpmn:parallelGateway',
  store: 'bpmn:dataStoreReference', data: 'bpmn:dataObjectReference', note: 'bpmn:textAnnotation',
}
const PREFIX = {
  task: 'Activity', manual: 'Activity', sub: 'Activity', expanded: 'Activity',
  start: 'StartEvent', end: 'EndEvent', intermediate: 'Event', timer: 'Event',
  xor: 'Gateway', and: 'Gateway', store: 'DataStoreReference', data: 'DataObjectReference', note: 'TextAnnotation',
}
const isGateway = (k) => k === 'xor' || k === 'and'
const isActivity = (k) => k === 'task' || k === 'manual' || k === 'sub' || k === 'expanded'
const isArtifact = (k) => k === 'store' || k === 'data' || k === 'note'

// Construit le XML BPMN sans partie graphique.
// options.subgraphs : 'lanes' (couloirs, par défaut) ou 'subprocesses' (sous-processus dépliés).
// options.skip : identifiants Mermaid de notes ou de données laissées de côté, quand la mise
// en page ne trouve pas de place pour elles.
export function mermaidToXml(graph, { name = 'Process', subgraphs = 'lanes', skip = [], T = (en) => en } = {}) {
  const warnings = []
  const asSub = subgraphs === 'subprocesses'
  const items = []
  const byId = new Map()
  let n = 0
  const add = (it) => { it.k = ++n; items.push(it); return it }

  // Sous-graphes : couloir (titre du plus profond) ou sous-processus déplié.
  const sgItem = new Map()
  if (asSub) {
    for (const sg of graph.subgraphs) {
      const it = add({ kind: 'expanded', label: sg.title, sg, scope: null })
      sgItem.set(sg, it)
    }
    for (const sg of graph.subgraphs) sgItem.get(sg).scope = sg.parent ? sgItem.get(sg.parent) : null
  }
  const nested = graph.subgraphs.some((sg) => sg.parent)
  if (!asSub && nested) {
    warnings.push(T('Nested subgraphs: each step goes to the lane of its innermost subgraph.', 'Sous-graphes imbriqués : chaque étape va dans le couloir de son sous-graphe le plus profond.'))
  }

  for (const node of graph.nodes.values()) {
    let fam = SHAPE_FAMILY[node.shape] || 'task'
    if (isArtifact(fam) && skip.includes(node.id)) continue
    let text = node.label
    // Losange marqué + (comme l'écrit l'export) : passerelle parallèle ; × ou vide : exclusive.
    if (fam === 'xor' && /^\+$/.test(text)) { fam = 'and'; text = '' }
    else if (fam === 'xor' && /^[×xX*O○]?$/.test(text.trim())) text = ''
    const it = add({ kind: fam, label: text, node, scope: asSub && node.subgraph ? sgItem.get(node.subgraph) : null, lane: !asSub && node.subgraph ? node.subgraph.title : '' })
    byId.set(node.id, it)
  }

  // Liens : d'un nœud, ou d'un sous-graphe (premières ou dernières étapes, ou le sous-processus).
  const members = (sg) => [...graph.nodes.values()].filter((nd) => {
    for (let s = nd.subgraph; s; s = s.parent) if (s === sg) return true
    return false
  }).map((nd) => byId.get(nd.id))
  const sgById = new Map(graph.subgraphs.map((sg) => [sg.id, sg]))
  const links = []
  let dropped = { invisible: 0, heads: 0, both: 0, self: 0, dup: 0, artifact: 0, gateway: 0, crossed: 0 }
  const rawLinks = []
  for (const e of graph.edges) {
    if (e.kind === 'invisible') { dropped.invisible++; continue }
    if (e.back && e.arrow) dropped.both++
    else if ('xo'.includes(e.arrow) && e.arrow) dropped.heads++
    rawLinks.push(e)
  }
  // Ends of a link to a subgraph, as lanes: heads (incoming) or tails (outgoing) of the subgraph.
  function endsOf(id, side) {
    const it = byId.get(id)
    if (it) return [it]
    const sg = sgById.get(id)
    if (!sg) return []
    if (asSub) return [sgItem.get(sg)]
    const inside = members(sg).filter((m) => !isArtifact(m.kind))
    const set = new Set(inside.map((m) => m.node.id))
    const pick = inside.filter((m) => !rawLinks.some((l) => (side === 'in' ? l.to === m.node.id && set.has(l.from) : l.from === m.node.id && set.has(l.to))))
    return pick.length ? pick : inside.slice(side === 'in' ? 0 : -1)
  }
  const chain = (it) => { const c = []; for (let s = it.scope; s; s = s.scope) c.unshift(s); return c }
  const seen = new Set()
  for (const e of rawLinks) {
    for (let a of endsOf(e.from, 'out')) {
      for (let b of endsOf(e.to, 'in')) {
        // Un lien qui traverse le bord d'un sous-processus part du sous-processus ou y arrive.
        if (asSub && !isArtifact(a.kind) && !isArtifact(b.kind)) {
          const ca = chain(a)
          const cb = chain(b)
          let k = 0
          while (k < ca.length && k < cb.length && ca[k] === cb[k]) k++
          if (ca.length > k) { a = ca[k]; dropped.crossed++ }
          if (cb.length > k) { b = cb[k]; dropped.crossed++ }
          // Lien d'une étape vers son propre sous-processus : sans objet.
          if (chain(b).includes(a) || chain(a).includes(b)) continue
        }
        if (a === b) { dropped.self++; continue }
        const key = `${a.k}>${b.k}>${e.label}`
        if (seen.has(key)) { dropped.dup++; continue }
        seen.add(key)
        links.push({ from: a, to: b, label: e.label, line: e.line })
      }
    }
  }

  // Données et annotations : associations. Le reste : flux de séquence.
  const flows = []
  const assoc = []
  for (const l of links) {
    const fa = isArtifact(l.from.kind)
    const fb = isArtifact(l.to.kind)
    if (!fa && !fb) { flows.push(l); continue }
    if (l.from.kind === 'note' || l.to.kind === 'note') {
      if (l.from.kind === 'note' && l.to.kind === 'note') { dropped.artifact++; continue }
      const note = l.from.kind === 'note' ? l.from : l.to
      const other = note === l.from ? l.to : l.from
      assoc.push({ type: 'note', note, other })
      continue
    }
    if (fa && fb) { dropped.artifact++; continue }
    const data = fa ? l.from : l.to
    const flowNode = fa ? l.to : l.from
    if (!isActivity(flowNode.kind)) { dropped.gateway++; continue }
    assoc.push({ type: fa ? 'input' : 'output', data, activity: flowNode })
  }

  // Une donnée ou une note se place dans la portée de l'étape qu'elle accompagne.
  for (const a of assoc) {
    const art = a.type === 'note' ? a.note : a.data
    const other = a.type === 'note' ? a.other : a.activity
    if (!art.placed) { art.scope = other.scope; art.placed = true }
  }

  // Événements selon leurs liens.
  const ins = (it) => flows.filter((f) => f.to === it)
  const outs = (it) => flows.filter((f) => f.from === it)
  for (const it of items) {
    if (it.kind === 'event') it.kind = !ins(it).length ? 'start' : !outs(it).length ? 'end' : 'intermediate'
    if (it.kind === 'junction') it.kind = 'xor'
  }
  // Un début n'a pas de flux entrant, une fin pas de flux sortant.
  const badIn = flows.filter((f) => f.to.kind === 'start')
  const badOut = flows.filter((f) => f.from.kind === 'end')
  if (badIn.length) warnings.push(T('Links into a start are ignored.', 'Les liens qui arrivent sur un début sont ignorés.'))
  if (badOut.length) warnings.push(T('Links out of an end are ignored.', 'Les liens qui partent d\'une fin sont ignorés.'))
  for (const f of [...badIn, ...badOut]) flows.splice(flows.indexOf(f), 1)

  const laneOf = (it) => it.lane || ''
  // Début et fin ajoutés, dans chaque portée (processus, chaque sous-processus).
  const scopes = [null, ...(asSub ? graph.subgraphs.map((sg) => sgItem.get(sg)) : [])]
  for (const scope of scopes) {
    const local = items.filter((it) => it.scope === scope && !isArtifact(it.kind))
    if (!local.length) continue
    if (!local.some((it) => it.kind === 'start')) {
      const heads = local.filter((it) => it.kind !== 'end' && !ins(it).length)
      const first = heads.length ? heads : local.slice(0, 1)
      const start = add({ kind: 'start', label: scope ? '' : T('Start', 'Début'), scope, lane: laneOf(first[0]), added: true })
      first.forEach((it) => flows.push({ from: start, to: it, label: '' }))
    }
    const tails = items.filter((it) => it.scope === scope && !isArtifact(it.kind) && it.kind !== 'end' && !outs(it).length)
    if (tails.length) {
      const loose = local.filter((it) => it.kind === 'end' && !ins(it).length)
      let end = loose.length === 1 ? loose[0] : null
      if (!end) end = add({ kind: 'end', label: scope ? '' : T('End', 'Fin'), scope, lane: laneOf(tails[tails.length - 1]), added: true })
      tails.forEach((it) => { if (it !== end) flows.push({ from: it, to: end, label: '' }) })
    }
  }

  // Passerelle de départ après une étape à plusieurs sorties : exclusive si les liens sont
  // nommés, parallèle sinon. Un losange qui reçoit et distribue est dédoublé.
  for (const it of [...items]) {
    if (isArtifact(it.kind)) continue
    const o = outs(it)
    if (o.length < 2) continue
    if (isGateway(it.kind)) {
      const i2 = ins(it)
      if (i2.length < 2) continue
      const merge = add({ kind: it.kind, label: '', scope: it.scope, lane: it.lane, added: true })
      for (const f of i2) f.to = merge
      flows.push({ from: merge, to: it, label: '' })
      continue
    }
    const kind = o.some((f) => f.label) ? 'xor' : 'and'
    const split = add({ kind, label: '', scope: it.scope, lane: it.lane, added: true })
    for (const f of o) f.from = split
    flows.push({ from: it, to: split, label: '' })
  }
  // Passerelle de convergence avant une étape à plusieurs entrées : parallèle si toutes les
  // branches viennent d'une passerelle parallèle, exclusive sinon.
  const splitKinds = (from) => {
    const kinds = new Set()
    const seenB = new Set()
    const queue = [from]
    while (queue.length) {
      const x = queue.shift()
      if (seenB.has(x)) continue
      seenB.add(x)
      if (isGateway(x.kind) && outs(x).length > 1) { kinds.add(x.kind); continue }
      for (const f of ins(x)) queue.push(f.from)
    }
    return kinds
  }
  for (const it of [...items]) {
    if (isArtifact(it.kind) || isGateway(it.kind) || it.kind === 'end') continue
    const i2 = ins(it)
    if (i2.length < 2) continue
    const kinds = new Set(i2.flatMap((f) => [...splitKinds(f.from)]))
    const kind = kinds.size === 1 && kinds.has('and') ? 'and' : 'xor'
    const merge = add({ kind, label: '', scope: it.scope, lane: it.lane, added: true })
    for (const f of i2) f.to = merge
    flows.push({ from: merge, to: it, label: '' })
  }

  // Avertissements regroupés.
  const say = (count, en, fr) => { if (count) warnings.push(T(en(count), fr(count))) }
  say(dropped.invisible, (c) => `${c} invisible link(s) (~~~) ignored.`, (c) => `${c} lien(s) invisible(s) (~~~) ignoré(s).`)
  say(dropped.both, (c) => `${c} two-way link(s) kept in one direction only.`, (c) => `${c} lien(s) à double sens gardé(s) dans un seul sens.`)
  say(dropped.heads, (c) => `${c} link(s) ending in a cross or a circle read as plain links.`, (c) => `${c} lien(s) terminé(s) par une croix ou un rond lu(s) comme de simples liens.`)
  say(dropped.self, (c) => `${c} link(s) from a step to itself ignored.`, (c) => `${c} lien(s) d'une étape vers elle-même ignoré(s).`)
  say(dropped.dup, (c) => `${c} duplicate link(s) ignored.`, (c) => `${c} lien(s) en double ignoré(s).`)
  say(dropped.artifact, (c) => `${c} link(s) between two data items or two notes ignored.`, (c) => `${c} lien(s) entre deux données ou deux notes ignoré(s).`)
  say(dropped.gateway, (c) => `${c} link(s) between data and an event or a gateway ignored: only tasks read or write data.`, (c) => `${c} lien(s) entre une donnée et un événement ou une passerelle ignoré(s) : seules les tâches lisent ou écrivent des données.`)
  say(dropped.crossed, () => 'Links that cross the edge of a subprocess are attached to the subprocess.', () => 'Les liens qui traversent le bord d\'un sous-processus sont rattachés au sous-processus.')

  // ── XML ──
  items.forEach((it, i) => { it.uid = `${PREFIX[it.kind]}_${i + 1}` })
  const attr = (s) => (s ? ` name="${escapeXml(s)}"` : '')
  const flowIds = new Map(flows.map((f, i) => [f, `Flow_${i + 1}`]))
  let propN = 0
  let assocN = 0
  function nodeXml(it, pad) {
    const tag = TAGS[it.kind]
    if (it.kind === 'note') return `${pad}<bpmn:textAnnotation id="${it.uid}">\n${pad}  <bpmn:text>${escapeXml(it.label)}</bpmn:text>\n${pad}</bpmn:textAnnotation>`
    if (it.kind === 'store') return `${pad}<bpmn:dataStoreReference id="${it.uid}"${attr(it.label)} />`
    if (it.kind === 'data') {
      const obj = `DataObject_${it.uid.split('_')[1]}`
      return `${pad}<bpmn:dataObject id="${obj}" />\n${pad}<bpmn:dataObjectReference id="${it.uid}"${attr(it.label)} dataObjectRef="${obj}" />`
    }
    const body = []
    for (const f of flows) if (f.to === it) body.push(`${pad}  <bpmn:incoming>${flowIds.get(f)}</bpmn:incoming>`)
    for (const f of flows) if (f.from === it) body.push(`${pad}  <bpmn:outgoing>${flowIds.get(f)}</bpmn:outgoing>`)
    const inputs = assoc.filter((a) => a.type === 'input' && a.activity === it)
    const outputs = assoc.filter((a) => a.type === 'output' && a.activity === it)
    if (inputs.length) {
      const prop = `Property_${++propN}`
      body.push(`${pad}  <bpmn:property id="${prop}" name="__targetRef_placeholder" />`)
      for (const a of inputs) body.push(`${pad}  <bpmn:dataInputAssociation id="DataInputAssociation_${++assocN}">\n${pad}    <bpmn:sourceRef>${a.data.uid}</bpmn:sourceRef>\n${pad}    <bpmn:targetRef>${prop}</bpmn:targetRef>\n${pad}  </bpmn:dataInputAssociation>`)
    }
    for (const a of outputs) body.push(`${pad}  <bpmn:dataOutputAssociation id="DataOutputAssociation_${++assocN}">\n${pad}    <bpmn:targetRef>${a.data.uid}</bpmn:targetRef>\n${pad}  </bpmn:dataOutputAssociation>`)
    if (it.kind === 'timer') body.push(`${pad}  <bpmn:timerEventDefinition />`)
    if (it.kind === 'expanded') body.push(...scopeXml(it, `${pad}  `))
    return [`${pad}<${tag} id="${it.uid}"${attr(it.label)}>`, ...body, `${pad}</${tag}>`].join('\n')
  }
  function scopeXml(scope, pad) {
    const local = items.filter((it) => it.scope === scope)
    const out = local.filter((it) => it.kind !== 'note').map((it) => nodeXml(it, pad))
    for (const f of flows) {
      if (f.from.scope !== scope) continue
      out.push(`${pad}<bpmn:sequenceFlow id="${flowIds.get(f)}"${attr(f.label)} sourceRef="${f.from.uid}" targetRef="${f.to.uid}" />`)
    }
    for (const it of local.filter((x) => x.kind === 'note')) out.push(nodeXml(it, pad))
    for (const a of assoc.filter((x) => x.type === 'note' && x.note.scope === scope)) {
      out.push(`${pad}<bpmn:association id="Association_${a.note.uid.split('_')[1]}_${a.other.uid.split('_')[1]}" sourceRef="${a.other.uid}" targetRef="${a.note.uid}" />`)
    }
    return out
  }

  const laneNames = asSub ? [] : [...new Set(graph.subgraphs.filter((sg) => graph.nodes.size && [...graph.nodes.values()].some((nd) => nd.subgraph === sg && !isArtifact(byId.get(nd.id).kind))).map((sg) => sg.title))]
  const otherLane = laneNames.length && items.some((it) => !isArtifact(it.kind) && !it.lane) ? T('Other', 'Autre') : ''
  if (otherLane) warnings.push(T('Some steps are outside any subgraph: they go to a lane named "Other".', 'Certaines étapes sont hors de tout sous-graphe : elles vont dans un couloir « Autre ».'))
  const processBody = scopeXml(null, '    ')
  let laneSet = ''
  const allLanes = otherLane ? [...laneNames, otherLane] : laneNames
  if (allLanes.length) {
    const lanes = allLanes.map((lane, i) => {
      const refs = items.filter((it) => !isArtifact(it.kind) && (it.lane || otherLane) === lane).map((it) => `        <bpmn:flowNodeRef>${it.uid}</bpmn:flowNodeRef>`)
      return [`      <bpmn:lane id="Lane_${i + 1}"${attr(lane)}>`, ...refs, '      </bpmn:lane>'].join('\n')
    })
    laneSet = ['    <bpmn:laneSet id="LaneSet_1">', ...lanes, '    </bpmn:laneSet>'].join('\n')
  }
  const process = [
    `  <bpmn:process id="Process_1"${allLanes.length ? '' : attr(name)} isExecutable="false">`,
    ...(laneSet ? [laneSet] : []),
    ...processBody,
    '  </bpmn:process>',
  ].join('\n')
  const collaboration = allLanes.length
    ? `  <bpmn:collaboration id="Collaboration_1">\n    <bpmn:participant id="Participant_1"${attr(name)} processRef="Process_1" />\n  </bpmn:collaboration>\n`
    : ''
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
${collaboration}${process}
</bpmn:definitions>
`
  const count = (pred) => items.filter(pred).length
  const counts = {
    tasks: count((it) => isActivity(it.kind)),
    gateways: count((it) => isGateway(it.kind)),
    events: count((it) => ['start', 'end', 'intermediate', 'timer'].includes(it.kind)),
    data: count((it) => it.kind === 'store' || it.kind === 'data'),
    notes: count((it) => it.kind === 'note'),
    lanes: allLanes.length,
    flows: flows.length,
  }
  const sources = Object.fromEntries(items.filter((it) => it.node).map((it) => [it.uid, it.node.id]))
  return { xml, counts, warnings, sources }
}

// Lecture et conversion en une fois, sans mise en page. Rend { xml, counts, warnings, errors }.
export function importMermaid(text, { name, subgraphs = 'lanes', skip = [], T = (en) => en } = {}) {
  const graph = parseMermaid(text, T)
  if (graph.errors.length) return { xml: '', counts: null, warnings: graph.warnings, errors: graph.errors, graph }
  const out = mermaidToXml(graph, { name: name || T('Process', 'Processus'), subgraphs, skip, T })
  if (!out.counts.tasks && !out.counts.gateways && !out.counts.events) {
    return { xml: '', counts: null, warnings: graph.warnings, errors: [T('The flowchart has no step, only data or notes.', 'Le flowchart n\'a aucune étape, seulement des données ou des notes.')], graph }
  }
  return { ...out, warnings: [...graph.warnings, ...out.warnings], errors: [], graph }
}

// Conversion et mise en page (bpmn-auto-layout). Si la mise en page ne trouve pas de place
// pour une note ou une donnée, elle recommence sans elle, et le dit. Rend
// { xml, counts, warnings, errors } ; xml porte alors la partie graphique.
export async function mermaidToDiagram(text, { name, subgraphs = 'lanes', T = (en) => en } = {}) {
  const skip = []
  for (let attempt = 0; attempt < 30; attempt++) {
    const r = importMermaid(text, { name, subgraphs, skip, T })
    if (r.errors.length) return r
    try {
      const { xml } = await layoutProcess(r.xml)
      if (skip.length) {
        const names = skip.map((id) => `« ${r.graph.nodes.get(id)?.label || id} »`).join(', ')
        r.warnings.push(T(`The automatic layout found no room for ${names}: left out, to add by hand.`,
          `La mise en page automatique n'a pas trouvé de place pour ${names} : laissé de côté, à ajouter à la main.`))
      }
      return { ...r, xml }
    } catch (err) {
      const uid = String(err?.message || '').match(/\((\w+)\)/)?.[1]
      const id = uid && r.sources[uid]
      if (err?.code !== 'ARTIFACT_PLACEMENT_FAILED' || !id || skip.includes(id)) {
        return { xml: '', counts: null, warnings: r.warnings, errors: [T(`The automatic layout failed: ${err?.message}`, `La mise en page automatique a échoué : ${err?.message}`)] }
      }
      skip.push(id)
    }
  }
  return { xml: '', counts: null, warnings: [], errors: [T('The automatic layout failed.', 'La mise en page automatique a échoué.')] }
}
