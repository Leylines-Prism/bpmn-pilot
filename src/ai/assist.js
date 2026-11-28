// Compléments du chat intégré, autour de la boucle d'outils (chat-loop.js) :
//   - critique de la demande avant de dessiner : un appel sans outils, qui relève
//     ambiguïtés et manques (gravité, passage cité, question) ;
//   - rapport de contrôle après chaque réponse qui a modifié le diagramme (validate_diagram) ;
//   - autocorrection : si un contrôle échoue, le problème repart au modèle, deux tours au plus.
//     Un tour qui ne fait pas baisser le nombre de problèmes est annulé (« non retenu »).
// La critique et l'autocorrection se coupent dans Options ; le rapport reste toujours.
//
// Ce module n'importe que des modules sans dépendance : il tourne dans la page et sur le serveur.

import { CRITIQUE_POINTS, CRITIQUE_SEVERITIES } from './prompts.js'

export const CRITIQUE_MIN_CHARS = 200 // en dessous, sans pièce jointe : une consigne, pas une description
export const MAX_CORRECTIONS = 2
const MAX_ISSUES = 6
const SEVERITIES = ['blocking', 'major', 'minor']
export const WRITE_TOOLS = ['add_shapes', 'connect_shapes', 'update_elements', 'style_elements', 'remove_elements', 'set_diagram_xml', 'import_mermaid', 'layout_diagram', 'auto_layout', 'move_elements', 'duplicate_elements', 'undo', 'redo']

export const CRITIQUE_SYSTEM = `You review a request to model a business process in BPMN, before it is drawn.
Find what is ambiguous or missing for a correct BPMN model:
${CRITIQUE_POINTS}

Severities:
${CRITIQUE_SEVERITIES}

Answer with JSON only, no other text:
{"issues":[{"severity":"blocking","quote":"exact short passage of the request, or empty when the point is about something missing","question":"the question to ask the author"}]}
At most ${MAX_ISSUES} issues, most severe first. Write the questions in the language of the request.
If the request is clear enough to model, or is not about a process, answer {"issues":[]}.`

export const wantsCritique = (text, attachments = []) => attachments.length > 0 || String(text || '').trim().length >= CRITIQUE_MIN_CHARS

// Lit la réponse de la critique. Renvoie la liste des points, ou null si elle est illisible.
export function parseCritique(reply) {
  const text = String(reply || '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let data
  try {
    data = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  if (!Array.isArray(data?.issues)) return null
  return data.issues
    .filter((i) => i && typeof i.question === 'string' && i.question.trim())
    .slice(0, MAX_ISSUES)
    .map((i) => ({
      severity: SEVERITIES.includes(i.severity) ? i.severity : 'minor',
      quote: typeof i.quote === 'string' ? i.quote.trim().slice(0, 300) : '',
      question: i.question.trim().slice(0, 500),
    }))
}

// Ajouté au message de l'utilisateur : le modèle dessine quand même, et dit ses hypothèses.
export function critiqueNote(issues) {
  const lines = issues.map((i) => `- [${i.severity}] ${i.quote ? `"${i.quote}": ` : ''}${i.question}`)
  return `[A review of this request, shown to the user, found these open points:
${lines.join('\n')}
Draw the process anyway, with a reasonable assumption for each point. End your reply with the assumptions you made, in one short list.]`
}

const CHECK_NAMES = {
  xml: 'well-formed XML',
  metamodel: 'BPMN 2.0 metamodel',
  references: 'references and scopes',
  di: 'diagram interchange',
  reimport: 'bpmn-js reimport',
  lint: 'bpmnlint',
}

// Problèmes d'un rapport de validate_diagram : ceux des contrôles échoués.
export const reportProblems = (report) => (report?.checks || []).filter((c) => !c.ok).reduce((n, c) => n + (c.problems?.length || 0) + (c.more || 0), 0)

export function correctionMessage(report) {
  const lines = []
  for (const c of report.checks.filter((c) => !c.ok)) {
    for (const p of c.problems || []) lines.push(`- ${CHECK_NAMES[c.check] || c.check}: ${p.id ? `${p.id}: ` : ''}${p.message}`)
    if (c.more) lines.push(`- ${CHECK_NAMES[c.check] || c.check}: ${c.more} more`)
  }
  return `[Automatic check by the editor after your reply: ${reportProblems(report)} problem(s) to fix.
${lines.slice(0, 25).join('\n')}
Fix them with the tools, without changing what the process does. Read the diagram with get_shapes first if needed.
Then reply in one short sentence saying what you fixed.]`
}

export const REVERTED_NOTE =
  '[Note from the editor: your last automatic correction did not reduce the problems, so it was undone. Read the diagram with get_shapes before changing it.]'

// Suivi d'un tour : ce qui a été écrit, les tours de correction, et le rapport final.
// executeTool : celui de la boucle. emit : reçoit { type: 'report', report, corrections }.
export function createAssist({ assist = {}, executeTool, emit, log = console.error }) {
  let wrote = false
  let asked = 0
  let kept = 0
  let pending = null // tour de correction en cours : { before, xml }

  async function check() {
    try {
      return await executeTool('validate_diagram', {})
    } catch (err) {
      log(`[chat] contrôle impossible : ${err.message}`)
      return null
    }
  }

  return {
    // Après chaque outil : un outil d'écriture réussi déclenchera le contrôle.
    toolDone(name, isError) {
      if (!isError && WRITE_TOOLS.includes(name)) wrote = true
    },

    // À la réponse finale. Renvoie le message de correction à envoyer au modèle, ou null
    // pour terminer le tour. conv reçoit pendingNote quand une correction est annulée.
    async afterAnswer(conv) {
      if (!wrote && !pending) return null
      wrote = false
      let report = await check()
      if (!report) return null
      if (pending) {
        const { before, xml } = pending
        pending = null
        if (reportProblems(report) < reportProblems(before)) kept++
        else {
          try {
            await executeTool('set_diagram_xml', { xml })
            report = before
            conv.pendingNote = REVERTED_NOTE
          } catch (err) {
            log(`[chat] correction non annulée : ${err.message}`)
          }
        }
      }
      if (assist.autocorrect && reportProblems(report) > 0 && asked < MAX_CORRECTIONS && !(asked > kept)) {
        let xml
        try {
          xml = await executeTool('get_diagram_xml', {})
        } catch (err) {
          log(`[chat] autocorrection impossible : ${err.message}`)
        }
        if (typeof xml === 'string') {
          asked++
          pending = { before: report, xml }
          emit({ type: 'status', phase: 'correcting', round: asked })
          return correctionMessage(report)
        }
      }
      emit({ type: 'report', report, corrections: { asked, kept } })
      return null
    },
  }
}

// Critique de la demande. call(system, userText) renvoie le texte de la réponse du modèle.
// Renvoie le texte à envoyer au modèle pour le dessin (la demande, avec les points relevés).
export async function runCritique({ assist = {}, text, attachments = [], call, emit, signal, log = console.error }) {
  if (!assist.critique || !wantsCritique(text, attachments)) return text
  emit({ type: 'status', phase: 'critique' })
  let issues
  let failed = null // 'error' : l'appel a échoué ; 'unreadable' : réponse sans liste lisible
  try {
    issues = parseCritique(await call(CRITIQUE_SYSTEM))
    if (!issues) failed = 'unreadable'
  } catch (err) {
    if (signal?.aborted) throw err
    log(`[chat] critique impossible : ${err.message}`)
    issues = null
    failed = 'error'
  }
  emit({ type: 'critique', issues: issues || [], ...(failed ? { failed } : {}) })
  return issues?.length ? `${text}\n\n${critiqueNote(issues)}` : text
}
