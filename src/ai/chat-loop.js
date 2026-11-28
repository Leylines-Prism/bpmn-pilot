// Boucle du chat intégré : le modèle appelle les outils de dessin jusqu'à sa
// réponse finale. Commune au serveur (mcp/chat.js) et, plus tard, à la page.
//
// Ce module n'importe rien. L'appelant fournit :
//   - z : sa copie de zod (v4), pour valider les arguments ;
//   - le client du fournisseur (SDK Anthropic ou OpenAICompatClient) ;
//   - executeTool(name, args) : exécute l'outil dans l'éditeur et renvoie le résultat ;
//   - emit(event) : reçoit le texte et l'état en direct, pour le panneau.
// Une conversation est un objet { messages } que la boucle met à jour.

import { INSTRUCTIONS, buildTools } from './tools.js'
import { imageCaption, isImageResult } from './image-result.js'
import { isFileResult, withoutFile } from './file-result.js'
import { anthropicUserContent, openaiUserContent } from './attachments.js'
import { createAssist, runCritique } from './assist.js'

// Après un tour, l'historique est allégé. Les images renvoyées par les outils en sortent : le
// modèle peut en redemander une à jour. Les pièces jointes de l'utilisateur restent, pour les
// questions suivantes sur le même document, tant qu'elles tiennent dans HISTORY_BUDGET : au-delà,
// les plus anciennes sont retirées, pour que la requête reste sous la limite de taille des
// fournisseurs (32 Mo chez Anthropic).
export const HISTORY_BUDGET = 20 * 1024 * 1024 // caractères base64 gardés dans l'historique
const GONE = '[An attachment or image was shown here earlier in the conversation; it is no longer attached.]'
const HEAVY = ['image', 'document', 'image_url', 'file', 'document_url']
const isHeavy = (part) => part && typeof part === 'object' && HEAVY.includes(part.type)
const partSize = (part) => (JSON.stringify(part).length)

function strip(content, keep) {
  if (!Array.isArray(content)) return content
  let dropped = false
  const out = []
  for (const part of content) {
    if (isHeavy(part) && !keep(part)) {
      dropped = true
      continue
    }
    out.push(part?.type === 'tool_result' && Array.isArray(part.content) ? { ...part, content: strip(part.content, () => false) } : part)
  }
  return dropped ? [...out, { type: 'text', text: GONE }] : out
}

// toolImages : indices des messages utilisateur qui ne portent que l'image d'un outil.
export function lightenHistory(messages, toolImages = new Set()) {
  let budget = HISTORY_BUDGET
  const result = messages.slice()
  for (let i = result.length - 1; i >= 0; i--) {
    const m = result[i]
    if (m.role === 'assistant' || !Array.isArray(m.content)) continue
    const keepAll = !toolImages.has(i)
    result[i] = {
      ...m,
      content: strip(m.content, (part) => {
        if (!keepAll) return false
        budget -= partSize(part)
        return budget >= 0
      }),
    }
  }
  return result
}

export const MAX_STEPS = 30 // appels successifs au modèle pour un seul message
const MAX_JSON_RETRIES = 2

export const CHAT_SYSTEM = `${INSTRUCTIONS}

You are the AI co-pilot built into this BPMN editor. The user sees the canvas next to the chat:
each tool you call changes their diagram before their eyes.
- Reply briefly, in the language of the user's message. Do not copy the XML or the list of shapes into your reply.
- Name new elements in the language of the user's message.
- Before changing an existing diagram, read it with get_shapes.
- When you have finished drawing, check it with validate_diagram and fix what can be fixed.
- For a vague request, draw a reasonable first version rather than asking questions.
- For a large diagram, work in several calls of 10 to 15 shapes: the user sees the drawing progress.`

// Prépare les outils pour les deux formats d'API, avec le zod fourni.
export function createToolSet(z) {
  // Les anciens noms gardés pour les agents MCP (mcpOnly) ne sont pas proposés au co-pilote.
  const tools = buildTools(z).filter((t) => !t.mcpOnly)
  // Schémas zod pour valider les arguments, schémas JSON pour l'API.
  const validators = Object.fromEntries(tools.map((t) => [t.name, z.object(t.inputSchema)]))
  const jsonSchemas = Object.fromEntries(
    tools.map((t) => {
      const { $schema, ...schema } = z.toJSONSchema(validators[t.name])
      return [t.name, schema]
    }),
  )
  return {
    z,
    tools,
    validators,
    // Les arguments arrivent au fil de l'eau : le panneau montre leur progression.
    // Ils ne sont plus validés par l'API, d'où la validation zod avant exécution.
    anthropic: tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: jsonSchemas[t.name],
      eager_input_streaming: true,
    })),
    // Même liste au format des API compatibles OpenAI.
    openai: tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: jsonSchemas[t.name] },
    })),
  }
}

function toolError(name, content, emit, log) {
  log(`[chat] ${name} : ${content}`)
  emit({ type: 'tool', name, ok: false, error: content })
  return { content, isError: true }
}

// Valide les arguments puis exécute l'outil. Renvoie { content, isError }.
// images : le format sait-il recevoir une image en résultat d'outil (API Claude) ?
// lang : langue de l'interface, pour les messages d'erreur montrés dans le panneau.
export async function runTool({ toolSet, name, input, executeTool, emit, log = console.error, images = false, lang = 'en' }) {
  const T = (en, fr) => (lang === 'fr' ? fr : en)
  // Object.hasOwn : un nom comme « __proto__ » ou « toString » ne doit pas tomber sur Object.prototype.
  const validator = Object.hasOwn(toolSet.validators, name) ? toolSet.validators[name] : null
  if (!validator) return toolError(name, T(`Unknown tool: ${name}`, `Outil inconnu : ${name}`), emit, log)
  const parsed = validator.safeParse(input)
  if (!parsed.success) return toolError(name, T(`Invalid arguments: ${toolSet.z.prettifyError(parsed.error)}`, `Arguments invalides : ${toolSet.z.prettifyError(parsed.error)}`), emit, log)
  try {
    let data = await executeTool(name, parsed.data)
    // Le panneau propose déjà le fichier (bouton Télécharger) : le modèle n'en reçoit que la fiche.
    if (isFileResult(data)) data = withoutFile(data)
    if (isImageResult(data)) {
      if (!images) {
        return toolError(name, 'This provider cannot receive images from tools: read the diagram with get_shapes instead.', emit, log)
      }
      emit({ type: 'tool', name, ok: true })
      return {
        content: [
          { type: 'image', source: { type: 'base64', media_type: data.image.mediaType, data: data.image.data } },
          { type: 'text', text: imageCaption(data.image) },
        ],
        isError: false,
      }
    }
    emit({ type: 'tool', name, ok: true })
    return { content: typeof data === 'string' ? data : JSON.stringify(data), isError: false }
  } catch (err) {
    return toolError(name, `Erreur : ${err.message}`, emit, log)
  }
}

// Un tour avec l'API Claude. client : instance du SDK Anthropic ;
// APIError : sa classe d'erreur (Anthropic.APIError), pour reconnaître les erreurs de l'API.
// assist : { critique, autocorrect }, réglés dans Options (voir assist.js).
export async function runAnthropicTurn({ client, APIError, model, effort = 'medium', conv, text, attachments = [], toolSet, executeTool, emit, signal, log = console.error, lang = 'en', assist = {} }) {
  const T = (en, fr) => (lang === 'fr' ? fr : en)
  // Si le modèle décline une demande, l'API la rejoue sur un modèle de repli.
  // Haiku n'a pas de repli côté serveur : le paramètre est omis.
  const fallback = model.startsWith('claude-haiku') ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }

  // On travaille sur une copie, et on n'enregistre que des étapes complètes :
  // une interruption ne laisse jamais un appel d'outil sans résultat.
  const before = startTurn(conv)
  const helper = createAssist({ assist, executeTool, emit, log })
  const drawText = await runCritique({
    assist,
    text,
    attachments,
    emit,
    signal,
    log,
    call: async (system) => {
      const reply = await client.beta.messages.create(
        { model, max_tokens: 4000, output_config: { effort: 'low' }, ...fallback, system, messages: [{ role: 'user', content: anthropicUserContent(text, attachments) }] },
        { signal },
      )
      return reply.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
    },
  })
  const messages = [...before, { role: 'user', content: anthropicUserContent(withNote(conv, drawText), attachments) }]
  conv.messages = messages.slice()
  let jsonRetries = 0
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      // Jusqu'à son premier morceau de réponse, le modèle lit la demande (ou le résultat des outils).
      emit({ type: 'status', phase: 'waiting', step })
      const stream = client.beta.messages.stream(
        {
          model,
          max_tokens: 64000,
          output_config: { effort },
          ...fallback,
          cache_control: { type: 'ephemeral' },
          system: CHAT_SYSTEM,
          tools: toolSet.anthropic,
          messages,
        },
        { signal },
      )
      stream.on('text', (delta) => emit({ type: 'text', text: delta }))
      // État en direct pour le panneau : réflexion, puis outil en préparation
      // avec la taille de ses arguments (au plus une mise à jour par 300 ms).
      let toolName = null
      let inputSize = 0
      let lastStatus = 0
      stream.on('streamEvent', (event) => {
        if (event.type !== 'content_block_start') return
        const block = event.content_block
        if (block.type === 'thinking' || block.type === 'redacted_thinking') emit({ type: 'status', phase: 'thinking' })
        if (block.type === 'tool_use') {
          toolName = block.name
          inputSize = 0
          emit({ type: 'status', phase: 'preparing', tool: toolName, size: 0 })
        }
      })
      stream.on('inputJson', (partial) => {
        inputSize += partial.length
        const now = Date.now()
        if (now - lastStatus < 300) return
        lastStatus = now
        emit({ type: 'status', phase: 'preparing', tool: toolName, size: inputSize })
      })

      let message
      try {
        message = await stream.finalMessage()
        jsonRetries = 0
      } catch (err) {
        // Arguments d'outil illisibles : on relance l'étape. Les erreurs de l'API
        // et l'interruption par l'utilisateur remontent telles quelles.
        if ((APIError && err instanceof APIError) || signal?.aborted || jsonRetries++ >= MAX_JSON_RETRIES) throw err
        log(`[chat] étape relancée : ${err.message}`)
        step--
        continue
      }

      if (message.stop_reason === 'refusal') {
        // La demande est retirée de l'historique pour ne pas bloquer la suite.
        conv.messages = before
        throw new Error(T('The model declined the request.', 'La demande a été refusée par le modèle.'))
      }

      const toolUses = message.content.filter((b) => b.type === 'tool_use')
      if (message.stop_reason === 'max_tokens' && toolUses.length) {
        // Arguments tronqués : on n'exécute rien et on n'enregistre pas cette étape.
        throw new Error(T('Reply cut off: the tool call exceeded the maximum length. Ask for a smaller diagram, in several steps.', "Réponse interrompue : l'appel d'outil dépassait la longueur maximale. Demandez un schéma plus petit, en plusieurs fois."))
      }
      if (toolUses.length === 0 || message.stop_reason !== 'tool_use') {
        messages.push({ role: 'assistant', content: message.content })
        conv.messages = messages.slice()
        if (message.stop_reason === 'max_tokens') throw new Error(T('Reply cut off: maximum length reached.', 'Réponse interrompue : longueur maximale atteinte.'))
        // Contrôle du diagramme, et tour de correction si besoin.
        const correction = await helper.afterAnswer(conv)
        if (!correction) return
        messages.push({ role: 'user', content: correction })
        conv.messages = messages.slice()
        continue
      }

      const results = []
      for (const use of toolUses) {
        emit({ type: 'status', phase: 'running', tool: use.name })
        const { content, isError } = await runTool({ toolSet, name: use.name, input: use.input, executeTool, emit, log, images: true, lang })
        helper.toolDone(use.name, isError)
        results.push({ type: 'tool_result', tool_use_id: use.id, content, ...(isError ? { is_error: true } : {}) })
      }
      messages.push({ role: 'assistant', content: message.content }, { role: 'user', content: results })
      conv.messages = messages.slice()
    }
    throw new Error(T(`Stopped after ${MAX_STEPS} steps without a final answer.`, `Arrêt après ${MAX_STEPS} étapes sans réponse finale.`))
  } finally {
    conv.messages = lightenHistory(conv.messages)
  }
}

// Même boucle pour une API compatible OpenAI (/chat/completions avec outils).
// client : OpenAICompatClient. providerId choisit le format des PDF joints.
export async function runOpenAITurn({ client, model, providerId = null, reasoningEffort = null, conv, text, attachments = [], toolSet, executeTool, emit, signal, log = console.error, lang = 'en', assist = {} }) {
  const T = (en, fr) => (lang === 'fr' ? fr : en)
  const before = startTurn(conv)
  const helper = createAssist({ assist, executeTool, emit, log })
  const drawText = await runCritique({
    assist,
    text,
    attachments,
    emit,
    signal,
    log,
    call: async (system) => {
      const reply = await client.stream(
        {
          model,
          messages: [{ role: 'system', content: system }, { role: 'user', content: openaiUserContent(text, attachments, providerId) }],
          ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
        },
        { signal },
      )
      return reply.content || ''
    },
  })
  const messages = [...before, { role: 'user', content: openaiUserContent(withNote(conv, drawText), attachments, providerId) }]
  conv.messages = messages.slice()
  let imageAt = -1 // index du message qui porte l'image d'un outil, envoyé à l'étape suivante
  const toolImageAt = new Set()

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      // Jusqu'à son premier morceau de réponse, le modèle lit la demande (ou le résultat des outils).
      emit({ type: 'status', phase: 'waiting', step })
      let toolName = null
      let lastStatus = 0
      let result
      try {
        result = await client.stream(
          {
            model,
            messages: [{ role: 'system', content: CHAT_SYSTEM }, ...messages],
            tools: toolSet.openai,
            ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
          },
          {
            signal,
            onText: (delta) => emit({ type: 'text', text: delta }),
            onReasoning: () => emit({ type: 'status', phase: 'thinking' }),
            onToolStart: (name) => {
              toolName = name
              emit({ type: 'status', phase: 'preparing', tool: name, size: 0 })
            },
            onToolArgs: (size) => {
              const now = Date.now()
              if (now - lastStatus < 300) return
              lastStatus = now
              emit({ type: 'status', phase: 'preparing', tool: toolName, size })
            },
          },
        )
      } catch (err) {
        // Requête refusée juste après l'envoi de l'image de get_diagram_image : le modèle ne
        // lit pas les images, ou le serveur refuse un message utilisateur après un outil. On
        // retire l'image, on le dit au modèle, et on relance l'étape. La conversation n'en
        // renverra plus.
        if (imageAt === messages.length - 1 && err?.status === 400) {
          conv.noToolImages = true
          imageAt = -1
          messages[messages.length - 1] = { role: 'user', content: NO_IMAGE_NOTE }
          step--
          continue
        }
        throw err
      }

      if (result.finishReason === 'content_filter') {
        conv.messages = before
        throw new Error(T("The request was blocked by the provider's filter.", 'La demande a été refusée par le filtre du fournisseur.'))
      }
      if (result.finishReason === 'length' && result.toolCalls.length) {
        throw new Error(T('Reply cut off: the tool call exceeded the maximum length. Ask for a smaller diagram, in several steps.', "Réponse interrompue : l'appel d'outil dépassait la longueur maximale. Demandez un schéma plus petit, en plusieurs fois."))
      }
      // Certains serveurs (Ollama notamment) terminent par « stop » même avec
      // des appels d'outils : on se fie à leur présence, pas à finish_reason.
      if (result.toolCalls.length === 0) {
        messages.push({ role: 'assistant', content: result.content })
        conv.messages = messages.slice()
        if (result.finishReason === 'length') throw new Error(T('Reply cut off: maximum length reached.', 'Réponse interrompue : longueur maximale atteinte.'))
        const correction = await helper.afterAnswer(conv)
        if (!correction) return
        messages.push({ role: 'user', content: correction })
        conv.messages = messages.slice()
        continue
      }

      const assistant = {
        role: 'assistant',
        content: result.content || null,
        tool_calls: result.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.arguments } })),
      }
      const results = []
      const images = []
      for (const call of result.toolCalls) {
        emit({ type: 'status', phase: 'running', tool: call.name })
        let input
        try {
          input = call.arguments.trim() ? JSON.parse(call.arguments) : {}
        } catch {
          input = undefined
        }
        const { content, isError } =
          input === undefined
            ? toolError(call.name, T('Unreadable arguments: invalid JSON. Send a complete JSON object.', 'Arguments illisibles : JSON invalide. Renvoie un objet JSON complet.'), emit, log)
            : await runTool({ toolSet, name: call.name, input, executeTool, emit, log, images: !conv.noToolImages, lang })
        helper.toolDone(call.name, isError)
        // Un résultat d'outil ne porte que du texte dans ce format : l'image part dans un
        // message utilisateur juste après les résultats.
        if (Array.isArray(content)) {
          const image = content.find((p) => p.type === 'image')
          const caption = content.find((p) => p.type === 'text')?.text || ''
          images.push({ type: 'image_url', image_url: { url: `data:${image.source.media_type};base64,${image.source.data}` } })
          results.push({ role: 'tool', tool_call_id: call.id, content: `${caption} The image follows in the next message.` })
        } else {
          results.push({ role: 'tool', tool_call_id: call.id, content })
        }
      }
      messages.push(assistant, ...results)
      imageAt = -1
      if (images.length) imageAt = messages.push({ role: 'user', content: [{ type: 'text', text: 'Image returned by the tool above:' }, ...images] }) - 1
      if (imageAt >= 0) toolImageAt.add(imageAt)
      conv.messages = messages.slice()
    }
    throw new Error(T(`Stopped after ${MAX_STEPS} steps without a final answer.`, `Arrêt après ${MAX_STEPS} étapes sans réponse finale.`))
  } finally {
    conv.messages = lightenHistory(conv.messages, toolImageAt)
  }
}

// Début d'un tour : l'historique d'avant est gardé, pour « Relancer depuis la même source ».
function startTurn(conv) {
  conv.previous = conv.messages
  return conv.messages
}

// Note laissée par l'éditeur au tour précédent (correction annulée) : elle part avec ce message.
function withNote(conv, text) {
  if (!conv.pendingNote) return text
  const note = conv.pendingNote
  delete conv.pendingNote
  return `${note}\n\n${text}`
}

// Retire le dernier échange, avant de relancer la même demande.
export function rewindTurn(conv) {
  if (!conv?.previous) return false
  conv.messages = conv.previous
  delete conv.previous
  delete conv.pendingNote
  return true
}

const NO_IMAGE_NOTE = 'This model cannot receive images, so the image of the diagram was removed: read the diagram with get_shapes instead.'
