// Parcours utilisateurs : ce qu'une vraie personne fait, selon son niveau BPMN et son but, joué
// de bout en bout dans le navigateur, avec une capture à chaque étape pour la relecture à l'œil.
//
//   node test/e2e/journeys.mjs --url http://localhost:8080 [--lang fr|en] [--only P1,P3] [--out dossier]
//
// P1 Découverte (aucun niveau) : premier processus dessiné à la souris, vérifié, rangé, exporté.
// P2 Analyste métier (notions) : Co-pilote sans fournisseur, processus depuis un tableau et depuis
//    la grille rôles × tâches, documentation, RACI, exports Word et HTML.
// P3 Expert BPMN (courant) : mode Expert, probabilités, simulation, carte de chaleur, rapport,
//    décisions DMN, journal d'événements, agent IA.
// P4 Développeur Camunda : exports Camunda 8 et 7, contrôle du XML produit.
// P7 Présentateur : mode Présentation, pointeur (touches 1 à 4), simulation en plein écran.
// P5 (agent MCP) et P6 (administrateur Docker) sont joués par mcp-suite.mjs et docker-suite.sh.
//
// Une étape échoue quand une personne de ce niveau resterait bloquée : élément absent, action
// sans effet, erreur JavaScript, fichier vide.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const { chromium } = createRequire(import.meta.url)('playwright')

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') ? true : all[i + 1] ?? true]] : acc), []),
)
const BASE = String(args.url || 'http://localhost:8080').replace(/\/$/, '')
const OUT = String(args.out || 'test-results/journeys')
const LANGS = args.lang && args.lang !== true ? [String(args.lang)] : ['fr', 'en']
const ONLY = args.only && args.only !== true ? String(args.only).split(',') : null
mkdirSync(OUT, { recursive: true })
const FIXTURE = readFileSync(new URL('./fixtures/commande.bpmn', import.meta.url), 'utf8')

const results = []
let shot = 0
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg)
}

// ---------------------------------------------------------------- outils communs

async function openEditor(browser, lang, { expert = false, xml = null, width = 1440 } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true, locale: lang === 'fr' ? 'fr-FR' : 'en-US' })
  await context.addInitScript(([lang, expert, xml]) => {
    try {
      if (sessionStorage.getItem('e2e-init')) return
      localStorage.clear()
      localStorage.setItem('bpmn-editor-lang', lang)
      localStorage.setItem('bpmn-editor-expert', expert ? 'on' : 'off')
      if (xml) localStorage.setItem('bpmn-editor-autosave', xml)
      sessionStorage.setItem('e2e-init', '1')
    } catch {}
  }, [lang, expert, xml])
  const page = await context.newPage()
  page.errors = []
  page.on('dialog', (d) => d.accept())
  page.on('pageerror', (err) => page.errors.push(err.message))
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.waitForSelector('.djs-container')
  await page.waitForTimeout(600)
  return { context, page }
}

function journey(name, lang) {
  return async function step(label, page, fn) {
    const where = `${name} ${lang}`
    const before = page.errors.length
    try {
      const detail = await fn()
      assert(page.errors.length === before, `erreur JavaScript : ${page.errors.slice(before).join(' | ').slice(0, 200)}`)
      results.push({ journey: where, step: label, ok: true, detail: typeof detail === 'string' ? detail : '' })
      console.log(`OK    [${where}] ${label}${typeof detail === 'string' && detail ? ` : ${detail}` : ''}`)
    } catch (err) {
      results.push({ journey: where, step: label, ok: false, detail: err.message.slice(0, 300) })
      console.log(`ÉCHEC [${where}] ${label} : ${err.message.slice(0, 300)}`)
    }
    const file = `${String(++shot).padStart(3, '0')}-${name.split(' ')[0]}-${lang}-${label.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 50)}.png`
    await page.screenshot({ path: join(OUT, file) }).catch(() => {})
    // Une fenêtre ou un menu resté ouvert après un échec ne doit pas bloquer l'étape suivante.
    await page.evaluate(() => {
      document.querySelectorAll('dialog[open]').forEach((d) => d.close())
      document.querySelectorAll('[popover]').forEach((p) => { try { p.hidePopover() } catch {} })
    }).catch(() => {})
  }
}

const ids = (page) => page.$$eval('.djs-element.djs-shape, .djs-element.djs-connection', (els) => els.map((e) => e.dataset.elementId).filter((i) => !i.endsWith('_label')))
const shape = (page, id) => page.locator(`.djs-element[data-element-id="${id}"]`).first()

// Ajoute un élément après la forme sélectionnée, par le menu contextuel, et rend son id.
async function append(page, fromId, action) {
  const before = new Set(await ids(page))
  await shape(page, fromId).click()
  await page.locator(`.djs-context-pad .entry[data-action="${action}"]`).click()
  await page.waitForTimeout(300)
  // Une nouvelle forme peut ouvrir l'édition du libellé : on la ferme.
  if (await page.locator('.djs-direct-editing-parent:visible').count()) await page.keyboard.press('Escape')
  const added = (await ids(page)).filter((i) => !before.has(i) && !/Flow|Association/.test(i))
  assert(added.length === 1, `${action} : ${added.length} forme(s) ajoutée(s)`)
  return added[0]
}

// Renomme un élément par double-clic, comme à la main.
async function rename(page, id, text) {
  await shape(page, id).dblclick()
  const editor = page.locator('.djs-direct-editing-parent')
  await editor.waitFor({ state: 'visible', timeout: 3000 })
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type(text)
  // Clic dans le vide pour valider.
  await page.mouse.click(700, 820)
  await page.waitForTimeout(200)
  const label = await page.$eval(`.djs-element[data-element-id="${id}"], .djs-element[data-element-id="${id}_label"]`, (el) => el.textContent).catch(() => '')
  const all = await page.$$eval(`[data-element-id="${id}"], [data-element-id="${id}_label"]`, (els) => els.map((e) => e.textContent).join(' '))
  assert(all.replace(/\s+/g, ' ').includes(text.split(' ')[0]), `libellé non appliqué à ${id} (${label})`)
}

async function menuItem(page, menuButton, itemId) {
  await page.click(`#${menuButton}`)
  await page.waitForTimeout(200)
  await page.click(`#${itemId}`)
}

async function download(page, menuButton, itemId, check) {
  const [file] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), menuItem(page, menuButton, itemId)])
  const path = join(OUT, `${shot + 1}-${file.suggestedFilename()}`)
  await file.saveAs(path)
  const raw = readFileSync(path)
  assert(raw.length > 50, `${file.suggestedFilename()} vide`)
  if (check) assert(check(raw), `${file.suggestedFilename()} : contenu inattendu`)
  return `${file.suggestedFilename()} (${raw.length} octets)`
}

// Allume des modules Expert par leur fenêtre, comme l'utilisateur (cases repérées par leur libellé).
async function enableModules(page, patterns) {
  await menuItem(page, 'btn-expert', 'btn-expert-modules')
  await page.waitForTimeout(300)
  // Une case cochée redessine la liste : chaque module se coche à part, sur la liste à jour.
  const done = []
  for (const pattern of patterns) {
    const hit = await page.$$eval('dialog[open] input[type="checkbox"]', (boxes, pattern) => {
      for (const box of boxes) {
        const text = (box.closest('label') || box.parentElement).textContent
        if (new RegExp(pattern, 'i').test(text)) {
          if (!box.checked) box.click()
          return text.trim().slice(0, 40)
        }
      }
      return null
    }, pattern)
    if (hit) done.push(hit)
    await page.waitForTimeout(200)
  }
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  assert(done.length >= patterns.length, `modules introuvables : ${patterns.join(', ')} (trouvés : ${done.join(' ; ')})`)
  return done.join(' ; ')
}

// Choisit un profil de palette par le bouton du bas de la palette.
async function paletteProfile(page, profile) {
  await page.locator('.bpmn-pilot-palette-profile').click()
  await page.waitForTimeout(250)
  await page.locator(`.djs-popup .entry[data-id="profile-${profile}"]`).click()
  await page.waitForTimeout(250)
  return page.$$eval('.djs-palette .entry', (els) => els.map((e) => e.dataset.action).filter(Boolean))
}

const lintText = (page) => page.locator('.bjsl-button').first().textContent().catch(() => '')
const T = (lang, en, fr) => (lang === 'fr' ? fr : en)

// ---------------------------------------------------------------- P1 Découverte

async function p1(browser, lang) {
  const step = journey('P1 Découverte', lang)
  const { context, page } = await openEditor(browser, lang)
  const n = {}
  await step('vitrine puis éditeur', page, async () => {
    const about = await context.newPage()
    const res = await about.goto(BASE + '/about.html', { waitUntil: 'networkidle' })
    assert(res.status() === 200, `vitrine ${res.status()}`)
    const link = about.locator('a[href*="index.html"], a[href="/"], a[href="./"]').first()
    assert(await link.count(), 'aucun lien vers l’éditeur sur la vitrine')
    await about.close()
  })
  await step('aide, Premiers pas', page, async () => {
    const [help] = await Promise.all([context.waitForEvent('page'), page.click('#btn-help')])
    await help.waitForLoadState('networkidle')
    const text = await help.textContent('body')
    assert(new RegExp(T(lang, 'Getting started', 'Premiers pas'), 'i').test(text), 'section Premiers pas absente')
    await help.close()
  })
  await step('nouveau diagramme', page, async () => {
    await page.click('#btn-new')
    await page.waitForTimeout(400)
    const all = await ids(page)
    n.start = all.find((i) => /StartEvent/.test(i))
    n.task = all.find((i) => /Task/.test(i))
    n.end = all.find((i) => /EndEvent/.test(i))
    assert(n.start && n.task && n.end, `diagramme de départ inattendu : ${all.join(', ')}`)
  })
  await step('palette Essentiel : seulement début, tâche, passerelle, fin', page, async () => {
    const entries = await paletteProfile(page, 'essential')
    const creates = entries.filter((a) => a.startsWith('create.'))
    const extra = creates.filter((a) => !['create.start-event', 'create.end-event', 'create.exclusive-gateway', 'create.task'].includes(a))
    assert(!extra.length, `éléments en trop : ${extra.join(', ')}`)
    assert(creates.length === 4, `palette Essentiel : ${creates.join(', ')}`)
    await shape(page, n.task).click()
    const pad = await page.$$eval('.djs-context-pad .entry', (els) => els.map((e) => e.dataset.action))
    assert(!pad.includes('append.intermediate-event'), 'événement intermédiaire encore proposé dans le menu contextuel')
    await page.keyboard.press('Escape')
    return creates.join(', ')
  })
  await step('nommer le début et la première tâche', page, async () => {
    await rename(page, n.start, T(lang, 'Request received', 'Demande reçue'))
    await rename(page, n.task, T(lang, 'Check the request', 'Vérifier la demande'))
  })
  await step('ajouter une passerelle Oui/Non et deux fins', page, async () => {
    await shape(page, n.end).click()
    await page.locator('.djs-context-pad .entry[data-action="delete"]').click()
    n.gw = await append(page, n.task, 'append.gateway')
    await rename(page, n.gw, T(lang, 'Complete?', 'Complète ?'))
    n.yes = await append(page, n.gw, 'append.append-task')
    await rename(page, n.yes, T(lang, 'Process the request', 'Traiter la demande'))
    n.no = await append(page, n.gw, 'append.append-task')
    await rename(page, n.no, T(lang, 'Ask for the missing items', 'Demander les pièces'))
    n.end1 = await append(page, n.yes, 'append.end-event')
    n.end2 = await append(page, n.no, 'append.end-event')
  })
  await step('la vérification signale ce qui manque', page, async () => {
    const t = await lintText(page)
    assert(/\d/.test(t), `pastille de vérification illisible : « ${t} »`)
    return t.trim()
  })
  await step('nommer les fins et les branches', page, async () => {
    await rename(page, n.end1, T(lang, 'Request processed', 'Demande traitée'))
    await rename(page, n.end2, T(lang, 'Items requested', 'Pièces demandées'))
    const flows = await page.$$eval('.djs-element.djs-connection', (els) => els.map((e) => e.dataset.elementId))
    const out = []
    for (const f of flows) {
      const src = await page.evaluate((f) => document.querySelector(`[data-element-id="${f}"]`)?.closest('.djs-group') && f, f)
      if (src) out.push(f)
    }
    return `${out.length} flux`
  })
  await step('ranger', page, async () => {
    await page.click('#btn-layout')
    await page.waitForTimeout(800)
  })
  await step('changer une couleur', page, async () => {
    await shape(page, n.yes).click()
    await page.locator('.djs-context-pad .entry[data-action="set-color"]').click()
    await page.waitForTimeout(300)
    const swatch = page.locator('.djs-popup .entry, .djs-popup [data-id]').nth(2)
    assert(await swatch.count(), 'palette de couleurs absente')
    await swatch.click()
    await page.waitForTimeout(300)
    const fill = await page.$eval(`[data-element-id="${n.yes}"] .djs-visual rect`, (r) => r.style.fill || r.getAttribute('fill'))
    assert(fill && !/white|#fff|rgb\(255, 255, 255\)/i.test(fill), `couleur non appliquée (${fill})`)
    return fill
  })
  await step('annuler puis rétablir', page, async () => {
    const color = () => page.$eval(`[data-element-id="${n.yes}"] .djs-visual rect`, (r) => r.style.fill || r.getAttribute('fill'))
    const after = await color()
    await page.click('#btn-undo')
    await page.waitForTimeout(200)
    assert((await color()) !== after, 'annuler sans effet')
    await page.click('#btn-redo')
    await page.waitForTimeout(200)
    assert((await color()) === after, 'rétablir sans effet')
  })
  await step('fermer et revenir : le travail est là', page, async () => {
    await page.waitForTimeout(1500) // sauvegarde automatique, une seconde après la dernière modification
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForSelector('.djs-container')
    await page.waitForTimeout(600)
    const text = await page.textContent('.djs-container')
    assert(text.includes(T(lang, 'Process the request', 'Traiter la demande')), 'diagramme perdu au rechargement')
  })
  await step('Mes diagrammes', page, async () => {
    await page.click('#btn-library')
    await page.waitForTimeout(500)
    const dialog = page.locator('dialog[open]').last()
    assert(await dialog.count(), 'fenêtre Mes diagrammes absente')
    return (await dialog.textContent()).replace(/\s+/g, ' ').slice(0, 120)
  })
  await step('exporter en PNG', page, () => download(page, 'btn-export', 'btn-png', (raw) => raw[0] === 0x89))
  await step('exporter en PDF', page, () => download(page, 'btn-export', 'btn-pdf', (raw) => raw.toString('latin1', 0, 4) === '%PDF'))
  await step('mode Présentation', page, async () => {
    await page.click('#btn-present')
    await page.waitForTimeout(600)
    const on = await page.evaluate(() => document.documentElement.className + ' ' + document.body.className)
    assert(/present/i.test(on), `mode Présentation non visible (${on})`)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
  })
  await step('dictée : bouton présent ou masqué proprement', page, async () => {
    await page.click('#btn-chat').catch(() => {})
    await page.waitForTimeout(400)
    // La dictée se fait sur l'appareil seulement : bouton visible là où le navigateur la permet.
    // La reconnaissance elle-même ne se joue pas ici (pas de micro) : elle reste un essai à la main.
    const mic = page.locator('#chat-mic')
    assert(await mic.count(), 'bouton de dictée absent du Co-pilote')
    const title = await mic.getAttribute('title')
    return `${(await mic.isVisible()) ? 'visible' : 'masqué'} : ${title || ''}`.slice(0, 140)
  })
  await context.close()
}

// ---------------------------------------------------------------- P2 Analyste métier

async function p2(browser, lang) {
  const step = journey('P2 Analyste', lang)
  const { context, page } = await openEditor(browser, lang)
  await step('Co-pilote sans fournisseur : message clair', page, async () => {
    await page.click('#btn-chat')
    await page.waitForTimeout(500)
    const panel = page.locator('#chat-log')
    const text = (await panel.textContent().catch(() => '')) || ''
    assert(text.length > 20, 'panneau du Co-pilote vide')
    return text.replace(/\s+/g, ' ').slice(0, 140)
  })
  await step('processus depuis un tableau, sans IA', page, async () => {
    await menuItem(page, 'btn-open-menu', 'btn-import-table')
    await page.waitForTimeout(400)
    const dialog = page.locator('dialog[open]').last()
    const area = dialog.locator('textarea').first()
    assert(await area.count(), 'zone de saisie du tableau absente')
    await area.fill(T(lang,
      'Step\tRole\nReceive the claim\tEmployee\nCheck the receipts\tManager\nPay\tAccounting',
      'Étape\tRôle\nRecevoir la note\tSalarié\nVérifier les justificatifs\tManager\nRembourser\tComptabilité'))
    await page.waitForTimeout(300)
    const ok = dialog.locator('button.primary, button[type="submit"], button:has-text("' + T(lang, 'Build', 'Construire') + '")').last()
    await ok.click()
    await page.waitForTimeout(1200)
    const text = await page.textContent('.djs-container')
    assert(text.includes(T(lang, 'Check the receipts', 'Vérifier les justificatifs')), 'le tableau n’a pas donné de diagramme')
  })
  await step('documenter un élément', page, async () => {
    const task = page.locator('.djs-element.djs-shape[data-element-id*="Activity"], .djs-element.djs-shape[data-element-id*="Task"]').first()
    await task.click()
    await page.waitForTimeout(300)
    const header = page.locator('.bio-properties-panel-group-header', { hasText: 'Documentation' }).first()
    assert(await header.count(), 'groupe Documentation absent du panneau')
    await header.click()
    const field = page.locator('.bio-properties-panel-group:has(.bio-properties-panel-group-header:has-text("Documentation")) textarea, .bio-properties-panel-group:has(.bio-properties-panel-group-header:has-text("Documentation")) [contenteditable="true"]').first()
    assert(await field.count(), 'champ Documentation absent')
    await field.click()
    await page.keyboard.type(T(lang, 'Check that every receipt is attached.', 'Vérifier que chaque justificatif est joint.'))
    await page.waitForTimeout(400)
  })
  await step('responsabilités (RACI)', page, async () => {
    const header = page.locator('.bio-properties-panel-group-header', { hasText: 'RACI' }).first()
    assert(await header.count(), 'groupe RACI absent')
    await header.click()
    const input = page.locator('.bio-properties-panel-group:has(.bio-properties-panel-group-header:has-text("RACI")) input').first()
    await input.fill(T(lang, 'Finance director', 'Directeur financier'))
    await page.waitForTimeout(300)
  })
  await step('exporter les fiches en Word', page, () => download(page, 'btn-export', 'btn-sheets-docx', (raw) => raw[0] === 0x50))
  await step('exporter la page de documentation HTML', page, () => download(page, 'btn-export', 'btn-doc-html', (raw) => /<html/i.test(raw.toString('utf8', 0, 2000))))
  await step('grille rôles × tâches', page, async () => {
    await menuItem(page, 'btn-open-menu', 'btn-import-grid')
    await page.waitForTimeout(400)
    assert(await page.locator('dialog[open]').count(), 'fenêtre de la grille absente')
  })
  await context.close()
}

// ---------------------------------------------------------------- P3 Expert BPMN

async function p3(browser, lang) {
  const step = journey('P3 Expert', lang)
  const { context, page } = await openEditor(browser, lang, { expert: true, xml: FIXTURE })
  await step('mode Expert actif', page, async () => {
    const on = await page.evaluate(() => document.documentElement.classList.contains('expert'))
    assert(on, 'classe expert absente')
  })
  await step('choisir les modules (ajouter les décisions DMN)', page, () => enableModules(page, ['DMN']))
  await step('simulation de jetons', page, async () => {
    await menuItem(page, 'btn-expert', 'btn-simulation')
    await page.waitForTimeout(800)
    const on = await page.evaluate(() => document.querySelector('.bts-toggle-mode.active, .simulation, [class*="token-simulation"]') !== null || /simulation/i.test(document.body.className))
    assert(on, 'simulation non activée')
  })
  await step('Pilote auto des passerelles', page, async () => {
    const auto = page.locator('.autopilot-toggle')
    assert(await auto.count(), 'bouton Pilote auto absent')
    await auto.click()
    await page.waitForTimeout(200)
    assert((await auto.getAttribute('aria-pressed')) === 'true', 'Pilote auto non activé')
  })
  await step('lancer des jetons et voir la carte de chaleur', page, async () => {
    const run = page.locator('button:visible', { hasText: new RegExp(T(lang, 'tokens|Run', 'jetons|Lancer'), 'i') }).first()
    assert(await run.count(), 'commande pour lancer des jetons absente')
    await run.click()
    await page.waitForTimeout(3000)
  })
  await step('arrêter la simulation', page, async () => {
    await page.click('#btn-expert')
    await page.waitForTimeout(200)
    const stop = page.locator('#expert-menu button:visible', { hasText: new RegExp(T(lang, 'Stop', 'Arrêter'), 'i') }).first()
    if (await stop.count()) await stop.click()
    else await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
  })
  await step('décisions du diagramme (DMN)', page, async () => {
    await menuItem(page, 'btn-expert', 'btn-dmn-drd')
    await page.waitForTimeout(600)
    const text = await page.locator('dialog[open]').last().textContent().catch(() => '')
    assert(/transporteur|carrier/i.test(text || ''), 'la décision du diagramme n’apparaît pas')
  })
  await step('formulaire d’une tâche utilisateur (form-js)', page, async () => {
    await enableModules(page, [T(lang, 'forms', 'Formulaires')])
    const id = await page.$$eval('.djs-element.djs-shape', (els) => els.find((e) => /Recevoir la commande/.test(e.textContent))?.dataset.elementId)
    assert(id, 'tâche utilisateur « Recevoir la commande » introuvable')
    await shape(page, id).click()
    await page.waitForTimeout(300)
    const header = page.locator('.bio-properties-panel-group-header', { hasText: T(lang, 'Form', 'Formulaire') }).first()
    assert(await header.count(), 'groupe Formulaire absent du panneau')
    await header.click()
    await page.waitForTimeout(300)
    const group = page.locator('.bio-properties-panel-group', { has: header })
    const text = ((await group.textContent({ timeout: 3000 })) || '').replace(/\s+/g, ' ')
    assert(text.length > 20, 'groupe Formulaire vide')
    const badge = await page.locator('.djs-overlays', { hasText: T(lang, 'Form', 'Formulaire') }).count()
    assert(badge, 'badge Formulaire absent sur la tâche')
    return text.slice(0, 140)
  })
  await step('journal d’événements : exemple fourni, colonnes, analyse', page, async () => {
    await menuItem(page, 'btn-expert', 'btn-mining')
    await page.waitForTimeout(400)
    const sample = page.locator('dialog[open] button', { hasText: new RegExp(T(lang, 'example|sample', 'exemple'), 'i') }).first()
    assert(await sample.count(), 'bouton de l’exemple absent')
    await sample.click()
    await page.waitForTimeout(1500)
    await page.locator('dialog[open] button', { hasText: T(lang, 'Next', 'Suivant') }).last().click()
    await page.waitForTimeout(1500)
    const summary = ((await page.locator('dialog[open]').last().textContent()) || '').replace(/\s+/g, ' ')
    assert(/\d+\s?(dossiers|cases)/.test(summary), `résumé du journal absent : ${summary.slice(0, 160)}`)
    await page.locator('dialog[open] button', { hasText: T(lang, 'Analyze', 'Analyser') }).last().click()
    await page.waitForTimeout(2000)
    return summary.match(/[\d\s ]+(dossiers|cases)[^·]*·[^·]*/)?.[0]?.trim()
  })
  await step('rapport en PDF', page, () => download(page, 'btn-expert', 'btn-report-pdf', (raw) => raw.toString('latin1', 0, 4) === '%PDF'))
  await step('rapport en Markdown', page, () => download(page, 'btn-expert', 'btn-report-md'))
  await step('rapport en Word', page, () => download(page, 'btn-expert', 'btn-report-docx', (raw) => raw[0] === 0x50))
  await step('agent IA : une tâche devient une étape d’agent', page, async () => {
    // La vue du journal verrouille le dessin : on repart d'une page rechargée (le diagramme est gardé).
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForSelector('.djs-container')
    await page.waitForTimeout(600)
    // Le journal d'exemple a remplacé le diagramme : on prend sa première tâche.
    const id = await page.$$eval('.djs-element.djs-shape', (els) => els.find((e) => {
      const r = e.querySelector('.djs-visual > rect')
      return r && Number(r.getAttribute('rx')) > 0 && Number(r.getAttribute('width')) >= 80
    })?.dataset.elementId)
    assert(id, 'aucune tâche dans le diagramme')
    await shape(page, id).click()
    await page.locator('.djs-context-pad .entry[data-action="replace"]').click()
    await page.locator('.djs-popup .entry[data-id="replace-with-collapsed-ad-hoc-subprocess"]').click()
    await page.waitForTimeout(400)
    const header = page.locator('.bio-properties-panel-group-header', { hasText: T(lang, 'AI agent', 'Agent IA') }).first()
    assert(await header.count(), 'groupe Agent IA absent du panneau')
    await header.click()
    const toggle = page.locator('.bio-properties-panel-group:has(.bio-properties-panel-group-header.open) input[type="checkbox"]').first()
    assert(await toggle.count(), 'interrupteur Agent IA absent')
    await toggle.click()
    await page.waitForTimeout(1500)
    const saved = await page.evaluate(() => localStorage.getItem('bpmn-editor-autosave') || '')
    assert(/agent="true"/.test(saved), 'marque d’agent IA non enregistrée')
  })
  await context.close()
}

// ---------------------------------------------------------------- P4 Développeur Camunda

async function p4(browser, lang) {
  const step = journey('P4 Camunda', lang)
  const { context, page } = await openEditor(browser, lang, { expert: true, xml: FIXTURE })
  await step('allumer les modules Camunda et DMN', page, () => enableModules(page, ['Camunda', 'DMN']))
  await step('palette Camunda 8 : passerelle complexe absente', page, async () => {
    await paletteProfile(page, 'camunda8')
    const gw = await page.$$eval('.djs-element.djs-shape', (els) => els.find((e) => e.querySelector('.djs-visual polygon'))?.dataset.elementId)
    assert(gw, 'aucune passerelle dans le diagramme')
    await shape(page, gw).click()
    await page.locator('.djs-context-pad .entry[data-action="replace"]').click()
    await page.waitForTimeout(300)
    const entries = await page.$$eval('.djs-popup .entry', (els) => els.map((e) => e.dataset.id))
    await page.keyboard.press('Escape')
    assert(entries.length, 'menu Remplacer vide')
    assert(!entries.some((e) => /complex/.test(e)), 'passerelle complexe encore proposée')
    return `${entries.length} remplacements proposés`
  })
  await step('export Camunda 8', page, () =>
    download(page, 'btn-export', 'btn-camunda-8', (raw) => {
      const x = raw.toString('utf8')
      return /isExecutable="true"/.test(x) && /zeebe:/.test(x)
    }))
  await step('export Camunda 7', page, () =>
    download(page, 'btn-export', 'btn-camunda-7', (raw) => /isExecutable="true"/.test(raw.toString('utf8'))))
  await step('export des décisions (.dmn)', page, () => download(page, 'btn-export', 'btn-save-dmn', (raw) => /decision/.test(raw.toString('utf8'))))
  await context.close()
}

// ---------------------------------------------------------------- P7 Présentateur

async function p7(browser, lang) {
  const step = journey('P7 Présentateur', lang)
  const { context, page } = await openEditor(browser, lang, { expert: true, xml: FIXTURE })
  // Le plein écran réel n'existe pas en navigateur sans écran : on garde la mise en page seule.
  await page.evaluate(() => {
    Element.prototype.requestFullscreen = function () { return Promise.resolve() }
  })
  await step('entrer en Présentation', page, async () => {
    await page.click('#btn-present')
    await page.waitForTimeout(600)
  })
  for (const [key, name] of [['1', 'laser'], ['2', 'surbrillance'], ['3', 'onde au clic'], ['4', 'masquer à l’arrêt']]) {
    await step(`pointeur : touche ${key} (${name})`, page, async () => {
      await page.keyboard.press(key)
      await page.mouse.move(600, 450)
      await page.mouse.click(620, 460)
      await page.waitForTimeout(400)
    })
  }
  await step('quitter la Présentation', page, async () => {
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    const still = await page.evaluate(() => /present/i.test(document.documentElement.className + document.body.className))
    assert(!still, 'toujours en Présentation après Échap')
  })
  await step('touches 1 à 4 hors Présentation : sans effet', page, async () => {
    for (const k of ['1', '2', '3', '4']) await page.keyboard.press(k)
    await page.waitForTimeout(300)
  })
  await context.close()
}

const JOURNEYS = { P1: p1, P2: p2, P3: p3, P4: p4, P7: p7 }
const browser = await chromium.launch()
for (const lang of LANGS) {
  for (const [key, run] of Object.entries(JOURNEYS)) {
    if (ONLY && !ONLY.includes(key)) continue
    console.log(`=== ${key} ${lang}`)
    await run(browser, lang).catch((err) => results.push({ journey: `${key} ${lang}`, step: 'parcours interrompu', ok: false, detail: err.message }))
  }
}
await browser.close()
const failed = results.filter((r) => !r.ok)
writeFileSync(join(OUT, 'resultats.json'), JSON.stringify({ base: BASE, date: new Date().toISOString(), results }, null, 2))
console.log(`\n${results.length - failed.length}/${results.length} étapes réussies. Captures dans ${OUT}`)
process.exit(failed.length ? 1 : 0)
