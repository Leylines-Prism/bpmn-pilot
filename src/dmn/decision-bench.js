// Banc d'essai de la fenêtre DMN : saisir des valeurs d'entrée, voir les règles qui
// s'appliquent et le résultat, ou lancer un cas par règle. Les règles retenues sont
// surlignées dans la table de dmn-js. Rien n'est enregistré : le banc lit la table telle
// qu'elle est dans la fenêtre, à chaque évaluation.

import { T } from '../i18n/lang.js'
import { summarize, parseEntry } from './dmn-model.js'
import { evaluateDecision, casesPerRule } from './dmn-eval.js'

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const show = (v) => (v === null || v === undefined ? '∅' : typeof v === 'object' && !Array.isArray(v) ? (v.toString !== Object.prototype.toString ? String(v) : JSON.stringify(v)) : typeof v === 'string' ? `"${v}"` : String(v))

export function resultText(d, r) {
  if (r.error === 'unique-conflict') return { error: true, text: T(`Rules ${r.matched.join(', ')} all apply, which the Unique hit policy forbids.`, `Les règles ${r.matched.join(', ')} s'appliquent ensemble, ce que la politique Unique interdit.`) }
  if (r.error === 'any-conflict') return { error: true, text: T(`Rules ${r.matched.join(', ')} apply with different outputs, which the Any hit policy forbids.`, `Les règles ${r.matched.join(', ')} s'appliquent avec des sorties différentes, ce que la politique Toutes interdit.`) }
  if (!r.matched.length) return { error: false, none: true, text: T('No rule applies: the result is empty.', 'Aucune règle ne s\'applique : le résultat est vide.') }
  const rules = r.matched.length > 1 ? T(`Rules ${r.matched.join(', ')}`, `Règles ${r.matched.join(', ')}`) : T(`Rule ${r.matched[0]}`, `Règle ${r.matched[0]}`)
  // Les sorties sont nommées par leur libellé (Plat), pas par leur variable (desiredDish).
  const labels = Object.fromEntries((d.outputs || []).map((o) => [o.name, o.label || o.name]))
  const fmt = (o) => Object.entries(o).map(([k, v]) => `${labels[k] || k} = ${show(v)}`).join(', ')
  const value = Array.isArray(r.result) ? `[${r.result.map((o) => `{ ${fmt(o)} }`).join(', ')}]` : typeof r.result === 'number' ? show(r.result) : fmt(r.result)
  return { error: false, text: `${rules} → ${value}` }
}

function control(input, k) {
  const id = `dmn-bench-in-${k}`
  const type = input.type || 'string'
  const allowed = type === 'string' ? parseEntry(input.values, 'string')?.values : null
  let field
  if (type === 'boolean') field = `<select id="${id}"><option value="">∅</option><option value="true">true</option><option value="false">false</option></select>`
  else if (allowed?.size) field = `<select id="${id}"><option value="">∅</option>${[...allowed].map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('')}</select>`
  else {
    const hint = { number: '1000', date: '2026-01-31', time: '09:30:00', dateTime: '2026-01-31T09:30:00', dayTimeDuration: 'P2D', yearMonthDuration: 'P1Y' }[type] || ''
    field = `<input id="${id}" type="text" autocomplete="off" placeholder="${esc(hint)}" />`
  }
  return `<label for="${id}"><span>${esc(input.label || input.expression || `#${k + 1}`)}</span><small>${esc(type)}</small></label>${field}`
}

// bench = createBench(container, { getDecision: async () => d | null, onHits(rules) })
export function createBench(container, { getDecision, onHits }) {
  let decision = null
  container.innerHTML = `
    <div class="dmn-bench-head"><h3>${T('Test bench', 'Banc d\'essai')}</h3>
      <p>${T('Enter input values and evaluate: the rules that apply are highlighted. Nothing is saved.', 'Saisissez des valeurs d\'entrée et évaluez : les règles qui s\'appliquent sont surlignées. Rien n\'est enregistré.')}</p></div>
    <form class="dmn-bench-form"></form>
    <div class="dmn-bench-actions">
      <button type="button" class="btn primary" data-act="run">${T('Evaluate', 'Évaluer')}</button>
      <button type="button" class="btn" data-act="cases" title="${T('Build one input case per rule and evaluate them all', 'Construire un cas d\'entrée par règle et les évaluer tous')}">${T('One case per rule', 'Un cas par règle')}</button>
    </div>
    <p class="dmn-bench-result" role="status" hidden></p>
    <div class="dmn-bench-cases" hidden></div>`
  const form = container.querySelector('.dmn-bench-form')
  const out = container.querySelector('.dmn-bench-result')
  const casesBox = container.querySelector('.dmn-bench-cases')

  function say(text, kind = '') {
    out.textContent = text
    out.className = `dmn-bench-result ${kind}`
    out.hidden = !text
  }

  async function refresh() {
    const previous = decision ? [...form.querySelectorAll('input, select')].map((f) => f.value) : []
    const sameShape = decision
    decision = await getDecision()
    casesBox.hidden = true
    say('')
    onHits([])
    if (!decision || decision.kind !== 'table') {
      form.innerHTML = `<p class="dmn-bench-empty">${T('Open a decision table to test it.', 'Ouvrez une table de décision pour la tester.')}</p>`
      container.querySelectorAll('.dmn-bench-actions button').forEach((b) => { b.disabled = true })
      return
    }
    container.querySelectorAll('.dmn-bench-actions button').forEach((b) => { b.disabled = false })
    form.innerHTML = decision.inputs.map((input, k) => `<div class="dmn-bench-field">${control(input, k)}</div>`).join('')
    if (sameShape && sameShape.id === decision.id) [...form.querySelectorAll('input, select')].forEach((f, k) => { if (previous[k] !== undefined) f.value = previous[k] })
  }

  async function run() {
    const fresh = await getDecision()
    if (!fresh || fresh.kind !== 'table') return refresh()
    if (fresh.inputs.length !== decision?.inputs.length) { await refresh(); return }
    decision = fresh
    casesBox.hidden = true
    if (!decision.rules.length) {
      say(T('This table has no rule yet, so nothing can apply. Add a rule with the + under the table, or fill it in with the co-pilot.',
        'Cette table n\'a encore aucune règle : rien ne peut s\'appliquer. Ajoutez une règle avec le + sous la table, ou faites-la remplir par le Co-pilote.'), 'none')
      onHits([])
      return
    }
    const values = [...form.querySelectorAll('input, select')].map((f) => f.value)
    try {
      const r = evaluateDecision(decision, values)
      const t = resultText(decision, r)
      say(t.text + (r.warnings.length ? `\n${r.warnings.join('\n')}` : ''), t.error ? 'error' : t.none ? 'none' : 'ok')
      onHits(r.matched)
    } catch (err) {
      say(err.message, 'error')
      onHits([])
    }
  }

  async function runCases() {
    const fresh = await getDecision()
    if (!fresh || fresh.kind !== 'table') return refresh()
    decision = fresh
    const cases = casesPerRule(decision)
    say('')
    onHits([])
    if (!cases.length) {
      say(T('No case can be built: the entries of these rules are not simple values.', 'Aucun cas ne se construit : les entrées de ces règles ne sont pas des valeurs simples.'), 'none')
      return
    }
    let failed = 0
    const rows = cases.map((c) => {
      const r = evaluateDecision(decision, c.inputs)
      // Avec Première, une règle masquée par une règle plus haute ne sert jamais : à vérifier.
      const ok = !r.error && r.matched.includes(c.rule) && (decision.hitPolicy !== 'FIRST' || r.matched[0] === c.rule)
      if (!ok) failed++
      return `<tr class="${ok ? 'ok' : 'ko'}"><td>${c.rule}</td><td>${c.inputs.map((v) => esc(show(v))).join(', ')}</td><td>${esc(resultText(decision, r).text)}</td><td aria-label="${ok ? T('as expected', 'conforme') : T('to check', 'à vérifier')}">${ok ? '✓' : '!'}</td></tr>`
    })
    casesBox.innerHTML = `<table><thead><tr><th>${T('Rule', 'Règle')}</th><th>${T('Inputs', 'Entrées')}</th><th>${T('Result', 'Résultat')}</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table>`
    casesBox.hidden = false
    const skipped = decision.rules.length - cases.length
    say(T(`${cases.length} case(s), ${failed ? `${failed} to check` : 'all as expected'}${skipped ? `, ${skipped} rule(s) with complex entries left out` : ''}.`,
      `${cases.length} cas, ${failed ? `${failed} à vérifier` : 'tous conformes'}${skipped ? `, ${skipped} règle(s) aux entrées complexes laissée(s) de côté` : ''}.`), failed ? 'error' : 'ok')
  }

  container.querySelector('[data-act="run"]').addEventListener('click', run)
  container.querySelector('[data-act="cases"]').addEventListener('click', runCases)
  form.addEventListener('submit', (e) => { e.preventDefault(); run() })
  form.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run() } })
  return { refresh }
}

// Décision résumée depuis le XML courant de la fenêtre.
export async function decisionFromXml(xml, decisionId) {
  const summary = await summarize(xml)
  return summary.decisions.find((d) => d.id === decisionId) || null
}
