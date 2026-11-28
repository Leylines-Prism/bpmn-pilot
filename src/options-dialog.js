// Fenêtre Options du co-pilote : le choix du fournisseur, son bloc (adresse, clé,
// modèles, boutons Tester et Lister), et le modèle du co-pilote. Un seul fournisseur
// est actif à la fois : les adresses et les clés des autres restent gardées.
// Même fenêtre en ligne et en version docker ; seul le texte sur la vie privée change.

import { PROVIDERS, providerBaseUrl } from './ai/providers.js'
import { forgetKeys, providerLabel, saveSettings, userModels } from './ai-settings.js'
import { T } from './i18n/lang.js'
import { trackOnce } from './analytics.js'
import { addDialogClose } from './dialog-close.js'

const HINTS = {
  online: {
    anthropic: T('Create an API key at console.anthropic.com. Calls go straight from this page to Anthropic.', 'Créez une clé API sur console.anthropic.com. Les appels partent directement de cette page vers Anthropic.'),
    openai: T('Create an API key at platform.openai.com. OpenAI does not always allow calls made from a web page: if "Test" fails, use the docker version.', "Créez une clé API sur platform.openai.com. OpenAI n'autorise pas toujours les appels faits depuis une page : si « Tester » échoue, utilisez la version docker."),
    mistral: T('Create an API key at console.mistral.ai. Calls go straight from this page to Mistral. For processing in the European Union, use the address https://api.eu.mistral.ai/v1 (billed 10% more).', "Créez une clé API sur console.mistral.ai. Les appels partent directement de cette page vers Mistral. Pour un traitement dans l'Union européenne, utilisez l'adresse https://api.eu.mistral.ai/v1 (facturée 10 % de plus)."),
    xai: T('Create an API key at console.x.ai. Calls go straight from this page to xAI. Grok reads PNG and JPEG images, not PDF files.', "Créez une clé API sur console.x.ai. Les appels partent directement de cette page vers xAI. Grok lit les images PNG et JPEG, pas les PDF."),
    ollama: T('Ollama must allow this page: start it with OLLAMA_ORIGINS={origin}. Pick a model that supports tool calls.', 'Ollama doit autoriser cette page : lancez-le avec la variable OLLAMA_ORIGINS={origin}. Choisissez un modèle qui sait appeler des outils.'),
    compat: T('LiteLLM, LM Studio, vLLM… The server must allow the origin {origin} (CORS setting). An https page can only call an https address, or localhost.', "LiteLLM, LM Studio, vLLM… Le serveur doit autoriser l'origine {origin} (réglage CORS). Une page en https ne peut appeler qu'une adresse en https, ou localhost."),
  },
  server: {
    anthropic: T('Create an API key at console.anthropic.com.', 'Créez une clé API sur console.anthropic.com.'),
    openai: T('Create an API key at platform.openai.com.', 'Créez une clé API sur platform.openai.com.'),
    mistral: T('Create an API key at console.mistral.ai. For processing in the European Union, use the address https://api.eu.mistral.ai/v1 (billed 10% more).', "Créez une clé API sur console.mistral.ai. Pour un traitement dans l'Union européenne, utilisez l'adresse https://api.eu.mistral.ai/v1 (facturée 10 % de plus)."),
    xai: T('Create an API key at console.x.ai. Grok reads PNG and JPEG images, not PDF files.', 'Créez une clé API sur console.x.ai. Grok lit les images PNG et JPEG, pas les PDF.'),
    ollama: T('Address as seen from the server. If it runs in docker, try http://host.docker.internal:11434/v1. Pick a model that supports tool calls.', "Adresse vue depuis le serveur. S'il tourne dans docker, essayez http://host.docker.internal:11434/v1. Choisissez un modèle qui sait appeler des outils."),
    compat: T('LiteLLM, LM Studio, vLLM… Address as seen from the server.', 'LiteLLM, LM Studio, vLLM… Adresse vue depuis le serveur.'),
  },
}

// Nom de l'hébergeur de la version en ligne (VITE_SITE_HOST, par exemple « GitHub Pages »).
const SITE_HOST = (import.meta.env.VITE_SITE_HOST || '').trim()

const PRIVACY = {
  online:
    T('Your API keys and settings stay in your browser. Your messages and your diagram go straight to the chosen provider, which bills you at its own rates. ', 'Vos clés API et vos réglages restent dans votre navigateur. Vos messages et votre diagramme partent directement chez le fournisseur choisi, qui vous facture selon son tarif. ') +
    (SITE_HOST
      ? T(`Neither this site nor its host (${SITE_HOST}) receives your keys or your diagrams.`, `Ni ce site ni son hébergeur (${SITE_HOST}) ne reçoivent vos clés ni vos diagrammes.`)
      : T('Neither this site nor its host receives your keys or your diagrams.', 'Ni ce site ni son hébergeur ne reçoivent vos clés ni vos diagrammes.')),
  server:
    T('Your API keys and settings stay in your browser. With each message, the key goes to your server, which passes it on to the provider without storing it. The provider receives your messages and your diagram, and bills you at its own rates.', "Vos clés API et vos réglages restent dans votre navigateur. À chaque message, la clé part vers votre serveur, qui la transmet au fournisseur sans l'enregistrer. Le fournisseur reçoit vos messages et votre diagramme, et vous facture selon son tarif."),
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

// mode : « online » ou « server ». serverModels : modèles réglés sur le serveur.
// test(connection) : renvoie la liste des modèles, ou lève une erreur au message lisible.
// onSave(settings) : appelé après l'enregistrement.
export function createOptionsDialog({ mode, test, onSave, onForget }) {
  const origin = location.origin
  const dialog = document.createElement('dialog')
  dialog.id = 'options-dialog'
  dialog.setAttribute('aria-labelledby', 'options-title')
  dialog.innerHTML = `
    <form method="dialog">
      <h2 id="options-title">${T('Co-pilot options', "Options du co-pilote")}</h2>
      <p class="hint intro-keys">${T('Choose a provider, paste the API key if needed and test the connection: its models then appear in the menu below, where you pick the model of the co-pilot.', 'Choisissez un fournisseur, collez la clé API si besoin et testez la connexion : ses modèles apparaissent alors dans le menu du bas, où vous choisissez le modèle du co-pilote.')}</p>
      <label class="field"><span>${T('Provider', 'Fournisseur')}</span><select id="options-provider">
        ${PROVIDERS.map((p) => `<option value="${p.id}">${esc(p.id === 'compat' ? T('OpenAI-compatible', 'Compatible OpenAI') : p.label)}</option>`).join('')}
      </select></label>
      <div class="providers">
        <div class="provider server-block" data-id="server" hidden>
          <p class="hint server-hint">${T('Models set up in the server variables (Docker stack or mcp/.env). The server holds their keys.', 'Modèles réglés dans les variables du serveur (pile Docker ou mcp/.env). Le serveur garde leurs clés.')}</p>
          <p class="server-only-note">${T('The API keys are provided by the server (variables of the Docker stack or mcp/.env). Entering keys in the browser is turned off on this server. The administrator can turn it back on with BROWSER_KEYS=on.', "Les clés API sont fournies par le serveur (variables de la pile Docker ou de mcp/.env). La saisie de clés dans le navigateur est coupée sur ce serveur. L'administrateur peut la rouvrir avec BROWSER_KEYS=on.")}</p>
        </div>
        ${PROVIDERS.map(
          (p) => `
        <div class="provider" data-id="${p.id}" hidden>
          <div class="p-body">
            ${p.customLabel ? `<label class="field"><span>${T('Display name', 'Nom affiché')}</span><input type="text" class="p-label" maxlength="60" placeholder="${T('For example: LiteLLM', 'Par exemple : LiteLLM')}" /></label>` : ''}
            <label class="field"><span>${T('Address', 'Adresse')}</span><input type="url" class="p-url" spellcheck="false" placeholder="${esc(p.baseUrl || 'http://localhost:4000/v1')}" /></label>
            <label class="field"><span>${T('API key', 'Clé API')}${p.needsKey ? '' : T(' (optional)', ' (facultative)')}</span><input type="password" class="p-key" spellcheck="false" autocomplete="off" placeholder="${esc(p.keyHint || '')}" /></label>
            <div class="field"><span>${T('Models', 'Modèles')}</span>
              <div class="p-models"></div>
              <div class="p-add-row"><input type="text" class="p-add" spellcheck="false" placeholder="${T('Add a model by its id', 'Ajouter un modèle par son identifiant')}" aria-label="${T('Id of the model to add', 'Identifiant du modèle à ajouter')}" /><button type="button" class="btn p-add-btn" title="${T('Add a model missing from the list, by its id', 'Ajouter un modèle absent de la liste, par son identifiant')}">${T('Add', 'Ajouter')}</button></div>
            </div>
            <div class="p-actions">
              <button type="button" class="btn p-test" title="${T('Check the address and the key, then load the models', 'Vérifier l\'adresse et la clé, puis charger les modèles')}">${T('Test', 'Tester')}</button>
              <button type="button" class="btn p-list" title="${T('Show every model the provider offers', 'Afficher tous les modèles proposés par le fournisseur')}">${T('List models', 'Lister les modèles')}</button>
              <span class="p-result" role="status"></span>
            </div>
            <p class="hint p-hint">${esc(HINTS[mode][p.id]).replaceAll('{origin}', esc(origin))}</p>
          </div>
        </div>`,
        ).join('')}
      </div>
      <label class="field default-model"><span>${T('Co-pilot model', 'Modèle du co-pilote')}</span><select id="options-default"></select></label>
      <div class="assist-row">
        <label><input type="checkbox" id="options-assist" /> ${T('Review the request and correct automatically', 'Critique de la demande et autocorrection')}</label>
        <p class="hint">${T('Before drawing a description, the model lists what is ambiguous or missing. After drawing, a failed check goes back to it, two rounds at most. Each costs extra calls and time. The check report, the details under each reply and the destination line stay in any case.', "Avant de dessiner une description, le modèle relève ce qui est ambigu ou manquant. Après le dessin, un contrôle échoué lui revient, deux tours au plus. Chacun coûte des appels en plus et du temps. Le rapport de contrôle, le détail sous chaque réponse et la ligne de destination restent dans tous les cas.")}</p>
      </div>
      <div class="keys-row">
        <label><input type="checkbox" id="options-remember" /> ${T('Remember API keys on your device', 'Se souvenir des clés API sur votre appareil')}</label>
        <span class="grow"></span>
        <button type="button" class="btn" id="options-forget" title="${T('Remove every API key stored in this browser', 'Supprimer toutes les clés API gardées dans ce navigateur')}">${T('Clear API keys', 'Effacer les clés API')}</button>
      </div>
      <p class="hint privacy">${esc(PRIVACY[mode])} ${T('Without the box above, keys are forgotten when the tab is closed.', "Sans la case ci-dessus, les clés sont oubliées à la fermeture de l'onglet.")}</p>
      <div class="actions">
        <span class="grow"></span>
        <button type="button" class="btn" id="options-cancel">${T('Cancel', 'Annuler')}</button>
        <button type="button" class="btn primary" id="options-save">${T('Save', 'Enregistrer')}</button>
      </div>
    </form>`
  addDialogClose(dialog)
  document.body.append(dialog)

  let draft = null
  let live = null // réglages en cours d'usage, reçus à l'ouverture
  let serverModels = []
  const blocks = new Map([...dialog.querySelectorAll('.provider:not(.server-block)')].map((el) => [el.dataset.id, el]))
  const serverBlock = dialog.querySelector('.server-block')
  const providerSelect = dialog.querySelector('#options-provider')
  // Choix « Modèles du serveur » : seulement si le serveur en propose (version docker).
  const serverOption = new Option(T('Server models', 'Modèles du serveur'), 'server')
  const defaultSelect = dialog.querySelector('#options-default')
  const remember = dialog.querySelector('#options-remember')
  const assist = dialog.querySelector('#options-assist')

  const read = (id) => {
    const el = blocks.get(id)
    const s = draft.providers[id]
    const url = el.querySelector('.p-url')
    // Adresse d'Ollama sans /v1 : complétée, et montrée telle qu'elle sera appelée.
    s.baseUrl = url.value.trim() ? providerBaseUrl(id, url.value) : ''
    if (s.baseUrl !== url.value.trim()) url.value = s.baseUrl
    s.apiKey = el.querySelector('.p-key').value.trim()
    const label = el.querySelector('.p-label')
    if (label) s.label = label.value.trim()
  }

  function renderModels(id) {
    const box = blocks.get(id).querySelector('.p-models')
    const models = draft.providers[id].models
    box.replaceChildren(
      ...models.map((m, i) => {
        const row = document.createElement('label')
        row.innerHTML = `<input type="checkbox" ${m.on ? 'checked' : ''} /> <span></span>`
        row.querySelector('span').textContent = m.label === m.id ? m.id : `${m.label} (${m.id})`
        row.querySelector('input').addEventListener('change', (e) => {
          models[i].on = e.target.checked
          renderDefault()
        })
        return row
      }),
    )
    if (!models.length) box.textContent = T('No models: "List models" asks the provider for them.', 'Aucun modèle : « Lister les modèles » les demande au fournisseur.')
  }

  function renderDefault() {
    const options = draft.active === 'server' ? serverModels : userModels(draft)
    defaultSelect.replaceChildren()
    const groups = new Map()
    for (const m of options) {
      let group = groups.get(m.provider)
      if (!group) {
        group = document.createElement('optgroup')
        group.label = m.providerLabel
        groups.set(m.provider, group)
        defaultSelect.append(group)
      }
      group.append(new Option(m.label, m.id))
    }
    if (!options.length) defaultSelect.append(new Option(T('No model yet: test the connection of the provider', 'Aucun modèle pour l\'instant : testez la connexion du fournisseur'), ''))
    defaultSelect.value = options.some((m) => m.id === draft.defaultModel) ? draft.defaultModel : options[0]?.id || ''
    defaultSelect.disabled = !options.length
  }

  function renderBlock(id) {
    const el = blocks.get(id)
    const s = draft.providers[id]
    el.querySelector('.p-url').value = s.baseUrl
    el.querySelector('.p-key').value = s.apiKey
    const label = el.querySelector('.p-label')
    if (label) label.value = s.label
    showStatus(id)
    renderModels(id)
  }

  function connection(id) {
    read(id)
    const s = draft.providers[id]
    const def = PROVIDERS.find((p) => p.id === id)
    return { provider: id, label: providerLabel(id, draft), format: def.format, baseUrl: s.baseUrl, apiKey: s.apiKey || null }
  }

  async function runTest(id, { fill }) {
    const el = blocks.get(id)
    const result = el.querySelector('.p-result')
    const conn = connection(id)
    const def = PROVIDERS.find((p) => p.id === id)
    if (!conn.baseUrl) return showResult(result, false, T('Enter the address first.', "Indiquez d'abord l'adresse."))
    if (def.needsKey && !conn.apiKey) return showResult(result, false, T('Paste the API key first.', "Collez d'abord la clé API."))
    const buttons = el.querySelectorAll('.p-test, .p-list')
    buttons.forEach((b) => (b.disabled = true))
    showResult(result, null, T('Connecting…', 'Connexion…'))
    try {
      const models = await test(conn)
      draft.providers[id].verified = true
      // Fournisseur réellement connecté : seulement son type, jamais la clé ni l'adresse.
      trackOnce('fournisseur-connecte', { fournisseur: id })
      if (fill) {
        const current = draft.providers[id].models
        const on = new Set(current.filter((m) => m.on).map((m) => m.id))
        // Les modèles cochés restent, même absents de la liste reçue.
        const kept = current.filter((m) => m.on && !models.some((x) => x.id === m.id))
        // Un libellé déjà connu (« Mistral Large ») l'emporte sur l'identifiant brut.
        const labels = new Map(current.filter((m) => m.label && m.label !== m.id).map((m) => [m.id, m.label]))
        draft.providers[id].models = [...kept, ...models.map((m) => ({ ...m, label: m.label === m.id ? labels.get(m.id) || m.label : m.label, on: on.has(m.id) }))]
        renderModels(id)
        showResult(result, true, T(`${models.length} model${models.length > 1 ? 's' : ''} received: tick the ones to offer.`, `${models.length} modèle${models.length > 1 ? 's' : ''} reçu${models.length > 1 ? 's' : ''} : cochez ceux à proposer.`))
      } else {
        showResult(result, true, T(`Connected: ${models.length} model${models.length > 1 ? 's' : ''} available.`, `Connexion réussie : ${models.length} modèle${models.length > 1 ? 's' : ''} disponible${models.length > 1 ? 's' : ''}.`))
      }
      renderDefault()
    } catch (err) {
      draft.providers[id].verified = false
      renderDefault()
      showResult(result, false, err.message)
    } finally {
      buttons.forEach((b) => (b.disabled = false))
    }
  }

  // État d'un bloc : connexion déjà testée, ou test à faire avant que ses modèles
  // soient proposés.
  function showStatus(id) {
    const el = blocks.get(id)
    const s = draft.providers[id]
    const result = el.querySelector('.p-result')
    if (s.verified) showResult(result, true, T('Connection tested.', 'Connexion testée.'))
    else showResult(result, null, T('Test the connection to offer its models.', 'Testez la connexion pour proposer ses modèles.'))
  }

  function showResult(el, ok, text) {
    el.textContent = ok === true ? `✓ ${text}` : ok === false ? `✗ ${text}` : text
    el.className = `p-result${ok === true ? ' ok' : ok === false ? ' failed' : ''}`
  }

  // Affiche le bloc du fournisseur actif, et lui seul.
  function showActive() {
    providerSelect.value = draft.active
    serverBlock.hidden = draft.active !== 'server'
    for (const [id, el] of blocks) el.hidden = id !== draft.active
  }

  providerSelect.addEventListener('change', () => {
    draft.active = providerSelect.value
    showActive()
    renderDefault()
  })

  for (const [id, el] of blocks) {
    for (const input of el.querySelectorAll('.p-url, .p-key, .p-label')) {
      input.addEventListener('input', () => {
        read(id)
        // Autre adresse ou autre clé : la connexion est à tester de nouveau.
        if (!input.classList.contains('p-label') && draft.providers[id].verified) {
          draft.providers[id].verified = false
          showStatus(id)
        }
        renderDefault()
      })
    }
    // « Tester » remplit aussi la liste tant qu'elle est vide.
    el.querySelector('.p-test').addEventListener('click', () => runTest(id, { fill: !draft.providers[id].models.length }))
    el.querySelector('.p-list').addEventListener('click', () => runTest(id, { fill: true }))
    const addInput = el.querySelector('.p-add')
    const add = () => {
      const value = addInput.value.trim()
      if (!value) return
      const models = draft.providers[id].models
      const found = models.find((m) => m.id === value)
      if (found) found.on = true
      else models.push({ id: value, label: value, on: true })
      addInput.value = ''
      renderModels(id)
      renderDefault()
    }
    el.querySelector('.p-add-btn').addEventListener('click', add)
    addInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        add()
      }
    })
  }

  defaultSelect.addEventListener('change', () => (draft.defaultModel = defaultSelect.value || null))
  dialog.querySelector('#options-forget').addEventListener('click', () => {
    forgetKeys(draft)
    // Aussi les réglages en cours d'usage : la fenêtre peut se fermer sans Enregistrer.
    if (live) forgetKeys(live)
    for (const el of blocks.values()) el.querySelector('.p-key').value = ''
    renderDefault()
    onForget?.()
  })
  dialog.querySelector('#options-cancel').addEventListener('click', () => dialog.close())
  dialog.querySelector('#options-save').addEventListener('click', () => {
    for (const id of blocks.keys()) read(id)
    draft.remember = remember.checked
    draft.assist = assist.checked
    draft.defaultModel = defaultSelect.value || null
    saveSettings(draft)
    dialog.close()
    onSave(draft)
  })

  return {
    open(settings, { server = [], browserKeys = true } = {}) {
      live = settings
      draft = structuredClone(settings)
      serverModels = server
      // Le serveur fournit ses clés et refuse celles du navigateur : seuls ses modèles restent.
      const serverOnly = !browserKeys && server.length > 0
      dialog.classList.toggle('server-keys-only', serverOnly)
      providerSelect.disabled = serverOnly
      if (serverOnly) draft.active = 'server'
      if (server.length) providerSelect.prepend(serverOption)
      else serverOption.remove()
      // Sans choix enregistré (ou avec les modèles du serveur, absents ici) : ceux du
      // serveur s'il en a, sinon le premier fournisseur de la liste.
      if (!draft.active || (draft.active === 'server' && !server.length)) draft.active = server.length ? 'server' : PROVIDERS[0].id
      for (const id of blocks.keys()) renderBlock(id)
      showActive()
      remember.checked = draft.remember
      assist.checked = draft.assist !== false
      renderDefault()
      dialog.showModal()
    },
  }
}
