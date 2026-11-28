// Mention de confidentialité de la version en ligne : un bouton « Confidentialité »
// en bas à droite du canevas ouvre une fenêtre en courtes sections titrées. Le nom
// de l'hébergeur se règle au build avec VITE_SITE_HOST (par exemple « GitHub Pages ») ;
// sans lui, le texte reste générique. La section « Mesure d'audience » n'apparaît que
// si la mesure est réglée au build (voir src/analytics.js).
// « Mentions légales » donne le texte de VITE_HOST_LEGAL (nom, adresse et téléphone de
// l'hébergeur) et n'apparaît que si ce réglage est donné.

import { T } from './i18n/lang.js'
import { analyticsHost } from './analytics.js'

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`
const ICONS = {
  shield: svg('<path d="M12 3 5 6v5c0 4.4 3 8.3 7 10 4-1.7 7-5.6 7-10V6z"/><path d="m9 12 2 2 4-4"/>'),
  device: svg('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>'),
  assistant: svg('<path d="M12 3v3M5 9h14a1 1 0 0 1 1 1v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a1 1 0 0 1 1-1z"/><circle cx="9" cy="14" r="1"/><circle cx="15" cy="14" r="1"/>'),
  chart: svg('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  key: svg('<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M15 8l2 2"/>'),
  scale: svg('<path d="M12 3v18M7 21h10M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z"/>'),
  server: svg('<rect x="3" y="4" width="18" height="7" rx="1.5"/><rect x="3" y="13" width="18" height="7" rx="1.5"/><path d="M7 7.5h.01M7 16.5h.01"/>'),
}

// Installation de la version Docker, dans le README du dépôt (section « Run it with Docker »)
// Logo GitHub (Simple Icons), comme dans les pages d'aide
const GITHUB_ICON = '<svg class="pv-gh" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>'

const DOCKER_URL = {
  en: 'https://github.com/Leylines-Prism/bpmn-pilot#run-it-with-docker',
  fr: 'https://github.com/Leylines-Prism/bpmn-pilot/blob/main/README.fr.md#le-lancer-avec-docker',
}

function section(icon, title, body) {
  return `<section class="pv-section">
        <span class="pv-icon">${ICONS[icon]}</span>
        <div class="pv-body"><h3>${title}</h3>${body}</div>
      </section>`
}

export function setupPrivacy({ container, env = import.meta.env }) {
  const host = (env.VITE_SITE_HOST || '').trim()
  const hostLegal = (env.VITE_HOST_LEGAL || '').trim()
  const hostName = host ? ` (${esc(host)})` : ''

  // Bouton visible en bas à droite du canevas, au-dessus de « Votre avis » s'il existe.
  const button = document.createElement('button')
  button.type = 'button'
  button.id = 'privacy-button'
  button.title = T('What happens to your data on this site', 'Ce que deviennent vos données sur ce site')
  button.innerHTML = `${ICONS.shield}<span>${T('Privacy', 'Confidentialité')}</span>`
  container.append(button)

  const yours = section('device', T('Your data', 'Vos données'), `
          <p>${T('Your diagrams, your settings and your API keys stay in your browser, on your device.',
                 'Vos diagrammes, vos réglages et vos clés API restent dans votre navigateur, sur votre appareil.')}</p>
          <p>${T(`They are not sent to us, nor to the host of this site${hostName}.`,
                 `Ils ne sont transmis ni à nous ni à l'hébergeur du site${hostName}.`)}</p>
          <p>${T('Your own AI agent (MCP), distinct from the AI co-pilot, uses no API key from this page. Once turned on in the MCP window, it exchanges the diagram with this tab through a relay on your computer, through no other server. What it does with it depends on the agent and its provider.',
                 "Votre propre agent IA (MCP), distinct du Co-pilote IA, n'utilise aucune clé API de cette page. Une fois activé dans la fenêtre MCP, il échange le diagramme avec cet onglet par un relais sur votre ordinateur, sans passer par aucun autre serveur. Ce qu'il en fait dépend de l'agent et de son fournisseur.")}</p>`)

  const assistant = section('assistant', T('With the AI co-pilot', "Avec le co-pilote IA"), `
          <p>${T('Your messages, the diagram and your API key are sent from your browser directly to the provider you selected (Anthropic, OpenAI, Mistral, etc.).',
                 "Vos messages, le diagramme et votre clé API sont envoyés directement de votre navigateur au fournisseur que vous avez choisi (Anthropic, OpenAI, Mistral, etc.).")}</p>
          <p>${T("The provider's own terms and privacy policy apply, and it bills you for usage.",
                 "Les conditions d'utilisation et la politique de confidentialité de ce fournisseur s'appliquent, et c'est lui qui vous facture l'usage.")}</p>
          <p>${T('Voice dictation is recognized on your device: neither the sound nor the dictated text leaves the browser until you send the message.',
                 "La dictée vocale est reconnue sur votre appareil : ni le son ni le texte dicté ne quittent le navigateur avant l'envoi du message.")}</p>`)

  // Encadré mis en avant : la clé d'API recommandée pour cet éditeur.
  const responsible = `<section class="pv-section pv-responsible" aria-labelledby="pv-responsible-title">
        <span class="pv-icon">${ICONS.key}</span>
        <div class="pv-body"><h3 id="pv-responsible-title">${T('Responsible use', 'Usage responsable')}</h3>
          <p>${T('Use an API key reserved for this editor, with a short validity period.',
                 "Utilisez une clé API réservée à cet éditeur, avec une durée de validité courte.")}</p>
          <p>${T('Add a spending cap if your provider allows it. If it leaks, the key only works here, expires on its own and can be deleted without affecting anything else you use.',
                 "Ajoutez un plafond de dépense si votre fournisseur le permet. En cas de fuite, la clé ne sert qu'ici, expire d'elle-même et se supprime sans toucher à vos autres usages.")}</p>
        </div>
      </section>`

  const audience = analyticsHost ? section('chart', T('Audience measurement', "Mesure d'audience"), `
          <p>${T('The site counts its visits anonymously.', 'Le site compte ses visites de façon anonyme.')}</p>
          <ul class="pv-facts">
            <li>${T('The content of your diagrams, messages and API keys is never collected.', 'Le contenu de vos diagrammes, de vos messages et de vos clés API n\'est jamais collecté.')}</li>
            <li>${T(`It follows the <a href="https://www.cnil.fr/fr/cookies-solutions-pour-les-outils-de-mesure-daudience" target="_blank" rel="noopener">recommendations of the CNIL</a> (the French data protection authority, page in French) for audience measurement exempt from consent:`, `Ce comptage suit les <a href="https://www.cnil.fr/fr/cookies-solutions-pour-les-outils-de-mesure-daudience" target="_blank" rel="noopener">recommandations de la CNIL</a> pour les mesures d'audience exemptées de consentement :`)}</li>
            <li class="pv-sub">${T('No cookie is set and your IP address is not recorded.', "Aucun cookie n'est déposé et votre adresse IP n'est pas enregistrée.")}</li>
            <li class="pv-sub">${T('Visitors are counted with a hashed identifier, renewed every month.', 'Les visiteurs sont comptés au moyen d\'un identifiant haché, renouvelé chaque mois.')}</li>
            <li class="pv-sub">${T('Nothing is counted if your browser sends a "Do Not Track" or "Global Privacy Control" signal.', 'Rien n\'est compté si votre navigateur envoie le signal « Do Not Track » ou « Global Privacy Control ».')}</li>
          </ul>
          <p>${T("Its purpose is to know how the site is used, so as to improve it.",
                 "Le but : savoir comment le site est utilisé, pour l'améliorer.")}</p>`) : ''

  const legal = hostLegal ? section('scale', T('Legal notice', 'Mentions légales'), `
          <p>${T('Personal, non-commercial site, published by a private individual.',
                 'Site personnel et non commercial, édité par un particulier.')}</p>
          <p>${T('Host:', 'Hébergeur :')} ${esc(hostLegal)}</p>`) : ''

  const hosting = section('server', T('Hosting', 'Hébergement'), `
          <p>${T(`The host of this site${hostName} keeps technical logs, as any web host does, including your IP address and the pages requested.`,
                 `L'hébergeur du site${hostName} conserve, comme tout hébergeur web, des journaux techniques qui incluent votre adresse IP et les pages demandées.`)}${analyticsHost
            ? T(' The statistics server may also keep technical logs for a short period.', ' Le serveur de statistiques peut aussi conserver des journaux techniques pendant une courte durée.')
            : ''}</p>
          <p>${analyticsHost
            ? T('The page loads no third-party scripts.', 'La page ne charge aucun script tiers.')
            : T('The page sets no cookies, measures no audience and loads no third-party scripts.', "La page ne dépose aucun cookie, ne mesure pas l'audience et ne charge aucun script tiers.")}</p>
          <p class="pv-docker">${T(
            `For data sovereignty, deploy the <a href="${DOCKER_URL.en}" target="_blank" rel="noopener">Docker version, available on GitHub${GITHUB_ICON}</a>: the editor runs on your machine or network, API keys stay server-side, and no third-party host logs your requests. Its built-in MCP server connects the editor to your AI agent and its full context, with no relay to install and even with no tab open: that is where it shows its full potential.`,
            `Pour la souveraineté de vos données, déployez la <a href="${DOCKER_URL.fr}" target="_blank" rel="noopener">version Docker, disponible sur GitHub${GITHUB_ICON}</a> : l'éditeur s'exécute sur votre machine ou votre réseau, les clés API restent côté serveur, et aucun hébergeur tiers ne journalise vos accès. Son serveur MCP intégré relie l'éditeur à votre agent IA et à tout son contexte, sans relais à installer et même sans onglet ouvert : c'est là que l'usage prend toute son ampleur.`)}</p>`)

  const dialog = document.createElement('dialog')
  dialog.id = 'privacy-dialog'
  dialog.setAttribute('aria-labelledby', 'privacy-title')
  dialog.innerHTML = `
    <form method="dialog">
      <header class="pv-head" tabindex="-1" autofocus>
        <span class="pv-badge">${ICONS.shield}</span>
        <h2 id="privacy-title">${T('Privacy', 'Confidentialité')}</h2>
        <button type="submit" class="btn icon-only pv-close" value="close" aria-label="${T('Close', 'Fermer')}" title="${T('Close (Esc)', 'Fermer (Échap)')}">×</button>
      </header>
      <div class="pv-pair">
      ${yours}
      ${assistant}
      </div>
      ${responsible}
      ${audience}
      ${hosting}
      ${legal}
      <div class="actions">
        <span class="grow"></span>
        <button type="submit" class="btn primary" value="close">${T('Close', 'Fermer')}</button>
      </div>
    </form>`
  document.body.append(dialog)
  button.addEventListener('click', () => {
    dialog.showModal()
    // La fenêtre s'ouvre en haut, même si le focus va au bouton Fermer.
    dialog.scrollTop = 0
  })
}
