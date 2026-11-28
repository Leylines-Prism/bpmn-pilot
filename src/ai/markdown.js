// Markdown des réponses du Co-pilote, rendu sans jamais passer par innerHTML.
//
// parseMarkdown(text) découpe le texte en blocs (titres, paragraphes, listes, tableaux,
// code, citations, filets) et en morceaux de ligne (gras, italique, code, liens).
// renderMarkdown(text, doc) construit les nœuds avec createElement et textContent :
// une balise écrite par le modèle reste du texte, et seuls les liens http(s) deviennent cliquables.
// Le texte arrive par morceaux pendant la réponse : le rendu est refait à chaque morceau,
// donc un bloc encore incomplet (tableau, code) s'affiche tel quel jusqu'à sa fin.

const FENCE = /^\s*(```|~~~)/
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const BULLET = /^(\s*)[-*+]\s+(.*)$/
const ORDERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/
const QUOTE = /^\s{0,3}>\s?(.*)$/
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/
const TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/

const isRow = (line) => /\|/.test(line) && line.trim() !== '|'
const isBlank = (line) => !line.trim()

function splitRow(line) {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const cells = []
  let cur = ''
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      cur += '|'
      i++
    } else if (s[i] === '|') {
      cells.push(cur.trim())
      cur = ''
    } else cur += s[i]
  }
  cells.push(cur.trim())
  return cells
}

function alignOf(cell) {
  const c = cell.trim()
  const left = c.startsWith(':')
  const right = c.endsWith(':')
  return left && right ? 'center' : right ? 'right' : left ? 'left' : null
}

// Morceaux d'une ligne : texte, gras, italique, code, lien.
export function parseInline(text) {
  const out = []
  let buf = ''
  const flush = () => {
    if (buf) out.push({ type: 'text', text: buf })
    buf = ''
  }
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    // Caractère échappé : \* \_ \` \[ …
    if (ch === '\\' && /[\\`*_[\]()#+\-.!|>~]/.test(text[i + 1] || '')) {
      buf += text[i + 1]
      i += 2
      continue
    }
    if (ch === '`') {
      const ticks = text.slice(i).match(/^`+/)[0]
      const end = text.indexOf(ticks, i + ticks.length)
      if (end > i) {
        flush()
        out.push({ type: 'code', text: text.slice(i + ticks.length, end).replace(/^ (.*) $/, '$1') })
        i = end + ticks.length
        continue
      }
    }
    if (ch === '[') {
      const m = text.slice(i).match(/^\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/)
      if (m) {
        flush()
        out.push({ type: 'link', href: m[2], children: parseInline(m[1]) })
        i += m[0].length
        continue
      }
    }
    if ((ch === '*' || ch === '_') && text[i + 1] === ch) {
      const mark = ch + ch
      const end = text.indexOf(mark, i + 2)
      if (end > i + 2 && !/\s/.test(text[i + 2]) && !/\s/.test(text[end - 1])) {
        flush()
        out.push({ type: 'strong', children: parseInline(text.slice(i + 2, end)) })
        i = end + 2
        continue
      }
    }
    if (ch === '*' || ch === '_') {
      // Un _ au milieu d'un mot (nom_de_variable) n'ouvre pas d'italique.
      const inWord = ch === '_' && /\w/.test(text[i - 1] || '')
      let end = i + 1
      while ((end = text.indexOf(ch, end)) !== -1 && text[end + 1] === ch) end += 2
      if (!inWord && end > i + 1 && !/\s/.test(text[i + 1]) && !/\s/.test(text[end - 1]) && !(ch === '_' && /\w/.test(text[end + 1] || ''))) {
        flush()
        out.push({ type: 'em', children: parseInline(text.slice(i + 1, end)) })
        i = end + 1
        continue
      }
    }
    buf += ch
    i++
  }
  flush()
  return out
}

// Blocs du texte.
export function parseMarkdown(text) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n')
  const blocks = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (isBlank(line)) {
      i++
      continue
    }
    const fence = line.match(FENCE)
    if (fence) {
      const body = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++])
      i++ // la clôture (absente pendant l'écriture)
      blocks.push({ type: 'code', text: body.join('\n') })
      continue
    }
    const heading = line.match(HEADING)
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, children: parseInline(heading[2]) })
      i++
      continue
    }
    if (RULE.test(line)) {
      blocks.push({ type: 'rule' })
      i++
      continue
    }
    if (isRow(line) && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const head = splitRow(line)
      const align = splitRow(lines[i + 1]).map(alignOf)
      const rows = []
      i += 2
      while (i < lines.length && isRow(lines[i]) && !isBlank(lines[i])) rows.push(splitRow(lines[i++]))
      const width = head.length
      blocks.push({
        type: 'table',
        align: Array.from({ length: width }, (_, k) => align[k] || null),
        head: head.map(parseInline),
        rows: rows.map((r) => Array.from({ length: width }, (_, k) => parseInline(r[k] ?? ''))),
      })
      continue
    }
    if (QUOTE.test(line)) {
      const body = []
      while (i < lines.length && QUOTE.test(lines[i])) body.push(lines[i++].match(QUOTE)[1])
      blocks.push({ type: 'quote', children: parseMarkdown(body.join('\n')) })
      continue
    }
    const bullet = line.match(BULLET)
    const ordered = !bullet && line.match(ORDERED)
    if (bullet || ordered) {
      const isOrdered = !!ordered
      const re = isOrdered ? ORDERED : BULLET
      const indent = (bullet || ordered)[1].length
      const items = []
      while (i < lines.length) {
        const m = lines[i].match(re)
        if (m && m[1].length <= indent + 1) {
          items.push([isOrdered ? m[3] : m[2]])
          i++
        } else if (!isBlank(lines[i]) && lines[i].match(/^\s*/)[0].length > indent) {
          // Ligne en retrait : suite de l'élément ou sous-liste.
          items.at(-1).push(lines[i].replace(new RegExp(`^\\s{0,${indent + 4}}`), ''))
          i++
        } else if (isBlank(lines[i]) && items.length && i + 1 < lines.length && lines[i + 1].match(re) && lines[i + 1].match(re)[1].length <= indent + 1) {
          i++ // liste aérée
        } else break
      }
      blocks.push({
        type: 'list',
        ordered: isOrdered,
        start: isOrdered ? Number(ordered[2]) : 1,
        items: items.map((parts) => {
          const [first, ...rest] = parts
          return { children: parseInline(first), sub: rest.length ? parseMarkdown(rest.join('\n')) : [] }
        }),
      })
      continue
    }
    // Paragraphe : jusqu'à une ligne vide ou un autre bloc.
    const body = [line]
    i++
    while (
      i < lines.length &&
      !isBlank(lines[i]) &&
      !FENCE.test(lines[i]) &&
      !HEADING.test(lines[i]) &&
      !QUOTE.test(lines[i]) &&
      !BULLET.test(lines[i]) &&
      !ORDERED.test(lines[i]) &&
      !(isRow(lines[i]) && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes('-'))
    )
      body.push(lines[i++])
    blocks.push({ type: 'paragraph', lines: body.map(parseInline) })
  }
  return blocks
}

function appendInline(doc, parent, nodes) {
  for (const n of nodes) {
    if (n.type === 'text') parent.append(doc.createTextNode(n.text))
    else if (n.type === 'code') {
      const el = doc.createElement('code')
      el.textContent = n.text
      parent.append(el)
    } else if (n.type === 'link') {
      const a = doc.createElement('a')
      a.href = n.href
      a.target = '_blank'
      a.rel = 'noopener noreferrer'
      appendInline(doc, a, n.children)
      parent.append(a)
    } else {
      const el = doc.createElement(n.type === 'strong' ? 'strong' : 'em')
      appendInline(doc, el, n.children)
      parent.append(el)
    }
  }
}

function appendBlocks(doc, parent, blocks) {
  for (const b of blocks) {
    let el
    if (b.type === 'heading') {
      // Titres ramenés à la taille du panneau : h4 à h6.
      el = doc.createElement(`h${Math.min(6, b.level + 3)}`)
      appendInline(doc, el, b.children)
    } else if (b.type === 'paragraph') {
      el = doc.createElement('p')
      b.lines.forEach((line, k) => {
        if (k) el.append(doc.createElement('br'))
        appendInline(doc, el, line)
      })
    } else if (b.type === 'code') {
      el = doc.createElement('pre')
      const code = doc.createElement('code')
      code.textContent = b.text
      el.append(code)
    } else if (b.type === 'rule') {
      el = doc.createElement('hr')
    } else if (b.type === 'quote') {
      el = doc.createElement('blockquote')
      appendBlocks(doc, el, b.children)
    } else if (b.type === 'list') {
      el = doc.createElement(b.ordered ? 'ol' : 'ul')
      if (b.ordered && b.start !== 1) el.start = b.start
      for (const item of b.items) {
        const li = doc.createElement('li')
        appendInline(doc, li, item.children)
        appendBlocks(doc, li, item.sub)
        el.append(li)
      }
    } else if (b.type === 'table') {
      // Le tableau défile dans son cadre si le panneau est étroit.
      el = doc.createElement('div')
      el.className = 'md-table'
      const table = doc.createElement('table')
      const thead = doc.createElement('thead')
      const tr = doc.createElement('tr')
      b.head.forEach((cell, k) => {
        const th = doc.createElement('th')
        if (b.align[k]) th.style.textAlign = b.align[k]
        appendInline(doc, th, cell)
        tr.append(th)
      })
      thead.append(tr)
      table.append(thead)
      const tbody = doc.createElement('tbody')
      for (const row of b.rows) {
        const r = doc.createElement('tr')
        row.forEach((cell, k) => {
          const td = doc.createElement('td')
          if (b.align[k]) td.style.textAlign = b.align[k]
          appendInline(doc, td, cell)
          r.append(td)
        })
        tbody.append(r)
      }
      table.append(tbody)
      el.append(table)
    }
    if (el) parent.append(el)
  }
}

// Remplace le contenu de target par le rendu du texte.
export function renderMarkdownInto(target, text) {
  const doc = target.ownerDocument
  const frag = doc.createDocumentFragment()
  appendBlocks(doc, frag, parseMarkdown(text))
  target.replaceChildren(frag)
}
