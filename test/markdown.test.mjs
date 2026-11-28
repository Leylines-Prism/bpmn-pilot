// Markdown des réponses du Co-pilote : découpage en blocs et en morceaux de ligne.
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseInline, parseMarkdown } from '../src/ai/markdown.js'

test('inline: bold, italic, code, links, escapes', () => {
  assert.deepEqual(parseInline('a **b** c'), [
    { type: 'text', text: 'a ' },
    { type: 'strong', children: [{ type: 'text', text: 'b' }] },
    { type: 'text', text: ' c' },
  ])
  assert.deepEqual(parseInline('*x*')[0], { type: 'em', children: [{ type: 'text', text: 'x' }] })
  assert.deepEqual(parseInline('`a**b**`'), [{ type: 'code', text: 'a**b**' }])
  assert.deepEqual(parseInline('[doc](https://example.org/a)'), [
    { type: 'link', href: 'https://example.org/a', children: [{ type: 'text', text: 'doc' }] },
  ])
  assert.deepEqual(parseInline('\\*pas en italique\\*'), [{ type: 'text', text: '*pas en italique*' }])
})

test('inline: no italics inside identifiers, no unsafe links', () => {
  assert.deepEqual(parseInline('classe_du_change'), [{ type: 'text', text: 'classe_du_change' }])
  assert.deepEqual(parseInline('3 * 4 * 5'), [{ type: 'text', text: '3 * 4 * 5' }])
  const js = parseInline('[x](javascript:alert(1))')
  assert.ok(js.every((n) => n.type === 'text'))
})

test('HTML written by the model stays text', () => {
  const blocks = parseMarkdown('<img src=x onerror=alert(1)> **ok**')
  assert.equal(blocks[0].type, 'paragraph')
  assert.equal(blocks[0].lines[0][0].text, '<img src=x onerror=alert(1)> ')
})

test('blocks: headings, lists, rule, quote, code', () => {
  const b = parseMarkdown('## Titre\n\n- un\n- **deux**\n  suite\n\n1. a\n2. b\n\n---\n\n> cité\n\n```\n<b>x</b>\n```')
  assert.deepEqual(b.map((x) => x.type), ['heading', 'list', 'list', 'rule', 'quote', 'code'])
  assert.equal(b[0].level, 2)
  assert.equal(b[1].items.length, 2)
  assert.equal(b[1].items[1].sub[0].type, 'paragraph')
  assert.equal(b[2].ordered, true)
  assert.equal(b[5].text, '<b>x</b>')
})

test('blocks: table with alignment and short rows', () => {
  const b = parseMarkdown('Avant\n| Impact | Urgence | Classe |\n|---|:-:|--:|\n| Faible | Normale | Standard |\n| Élevé | Haute |\n\nAprès')
  assert.deepEqual(b.map((x) => x.type), ['paragraph', 'table', 'paragraph'])
  const t = b[1]
  assert.deepEqual(t.align, [null, 'center', 'right'])
  assert.equal(t.rows.length, 2)
  assert.equal(t.rows[1].length, 3)
  assert.deepEqual(t.rows[1][2], [])
})

test('streaming: an unfinished table or code block does not throw', () => {
  assert.equal(parseMarkdown('| a | b |')[0].type, 'paragraph')
  assert.equal(parseMarkdown('```js\nconst a = 1')[0].type, 'code')
  assert.deepEqual(parseMarkdown('**gras pas fini'), [{ type: 'paragraph', lines: [[{ type: 'text', text: '**gras pas fini' }]] }])
})
