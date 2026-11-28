import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { defineConfig, loadEnv } from 'vite'

// Politique de sécurité du contenu, posée au build dans chaque page : seuls les scripts
// du site s'exécutent (le petit script du thème est autorisé par son empreinte).
// connectSrc dit où la page peut se connecter :
//   - version en ligne : en https, et vers localhost pour Ollama, car l'adresse du
//     fournisseur est libre. La clé du visiteur est protégée par l'absence de script tiers.
//   - version serveur (image docker) : le site lui-même seulement, car tout passe par le
//     serveur (pont, chat, diagrammes), plus l'adresse de VITE_MCP_BRIDGE_URL si elle est absolue.
function csp(connectSrc) {
  return {
    name: 'csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        // Toutes les balises script, quelle que soit la casse ou les attributs. Celles qui
        // chargent un fichier (src) sont couvertes par 'self' et n'ont pas d'empreinte.
        const hashes = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script[^>]*>/gi)]
          .filter(([, attrs]) => !/\bsrc\s*=/i.test(attrs))
          .map(([, , code]) => `'sha256-${createHash('sha256').update(code).digest('base64')}'`)
        const policy = [
          "default-src 'self'",
          `script-src 'self' ${hashes.join(' ')}`.trim(),
          "style-src 'self' 'unsafe-inline'",
          "img-src 'self' data: blob:",
          "font-src 'self' data:",
          `connect-src ${connectSrc}`,
          "worker-src 'self' blob:",
          "object-src 'none'",
          "base-uri 'self'",
          "form-action 'none'",
        ].join('; ')
        return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n  <meta http-equiv="Content-Security-Policy" content="${policy}" />`)
      },
    },
  }
}

// ws:// pour le relais MCP lancé sur le poste de l'utilisateur (agent MCP local).
const ONLINE_CONNECT = "'self' https: http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*"

// Version serveur : le site, plus le serveur MCP s'il est à une autre adresse (ws:// et http://).
function serverConnect(mode) {
  const bridge = (process.env.VITE_MCP_BRIDGE_URL || loadEnv(mode, process.cwd(), 'VITE_').VITE_MCP_BRIDGE_URL || '').trim()
  const sources = ["'self'"]
  try {
    if (bridge && !bridge.startsWith('/')) {
      const url = new URL(bridge)
      const http = url.protocol === 'wss:' ? 'https:' : 'http:'
      sources.push(`${url.protocol}//${url.host}`, `${http}//${url.host}`)
    }
  } catch {}
  return sources.join(' ')
}

// Contact et adresse mail de la fenêtre « Feedback » (CONTACT_URL et FEEDBACK_EMAIL,
// dans .env ou l'environnement) : chiffrés au build par le module d'obfuscation d'ALTCHA
// (src/seal.js). La clé ne se retrouve que par une preuve de travail, que le navigateur
// calcule au clic (une seconde environ) : un robot qui fouille le code n'y lit ni l'un
// ni l'autre sans refaire ce calcul. Du contact, seuls restent en clair son domaine et
// le fait que ce soit LinkedIn, pour l'icône et le texte du choix.
// SEAL_WORK : nombre d'essais demandés au navigateur, tiré au hasard dans cette plage.
const SEAL_WORK = { cost: 5000, counterMin: 400, counterMax: 800 }

async function sealedContacts(mode) {
  const env = loadEnv(mode, process.cwd(), '')
  const email = (env.FEEDBACK_EMAIL || '').trim()
  let url = (env.CONTACT_URL || '').trim()
  if (/^www\./i.test(url)) url = `https://${url}`
  let contact = null
  try {
    if (url && url.toLowerCase() !== 'none') {
      const parsed = new URL(url)
      if (parsed.protocol === 'https:') {
        const host = parsed.hostname.replace(/^www\./, '')
        contact = { url: parsed.href, host, linkedin: host === 'linkedin.com' || host.endsWith('.linkedin.com') }
      }
    }
  } catch {}
  const { Obfuscation } = await import('./src/seal.js')
  return {
    __FEEDBACK_EMAIL__: JSON.stringify(email ? await Obfuscation.obfuscate(email, SEAL_WORK) : ''),
    __CONTACT_LINK__: JSON.stringify(contact && { sealed: await Obfuscation.obfuscate(contact.url, SEAL_WORK), host: contact.host, linkedin: contact.linkedin }),
  }
}

// Aperçu des liens partagés : les réseaux veulent une adresse absolue pour og:image.
// SITE_URL (par exemple https://bpmn.example.com, dans .env ou l'environnement) donne
// l'origine publique du site. Sans elle, l'image reste relative au chemin du site et og:url
// est absente : une installation privée n'annonce aucune adresse.
function socialPreview(mode, base) {
  const site = (process.env.SITE_URL || loadEnv(mode, process.cwd(), '').SITE_URL || '').trim().replace(/\/+$/, '')
  const image = `${site}${base}social-preview.png`
  return {
    name: 'social-preview',
    transformIndexHtml(html) {
      let out = html.replace(/(<meta (?:property|name)="(?:og|twitter):image" content=")social-preview\.png"/g, `$1${image}"`)
      if (site) out = out.replace('<meta property="og:type"', `<meta property="og:url" content="${site}${base}" />\n  <meta property="og:type"`)
      return out
    },
  }
}

// Version affichée (Options, aide) : APP_VERSION si elle est donnée (image Docker, construite
// depuis un tag), sinon le dernier tag de git (« v1.1.0 » sur un tag, « v1.1.0-12-gabc1234 »
// entre deux), sinon le numéro de package.json.
function appVersion() {
  const given = (process.env.APP_VERSION || '').trim()
  if (given) return given
  try {
    return execFileSync('git', ['describe', '--tags', '--always'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return `v${JSON.parse(readFileSync('package.json', 'utf8')).version}`
  }
}

// Canal du site en ligne : SITE_CHANNEL=dev pour la page de développement (/dev/), qui suit
// main, à côté de la page stable qui suit les versions. Les deux partagent l'origine, donc le
// stockage du navigateur : en dev, toutes les clés « bpmn-editor-… » (localStorage et IndexedDB,
// dans le code et dans les petits scripts des pages) deviennent « bpmn-editor-dev-… », pour qu'un
// essai en dev n'abîme pas les diagrammes ni les réglages de la page stable. La page dev n'est
// pas indexée par les moteurs de recherche.
// Dans les pages, %APP_VERSION% est remplacé par la version.
function siteChannel(channel, version) {
  const prefix = (code) => code.replace(/(['"`])bpmn-editor-(?!dev-)/g, '$1bpmn-editor-dev-')
  return {
    name: 'site-channel',
    transform(code, id) {
      if (channel !== 'dev' || !/[\\/]src[\\/].*\.js$/.test(id) || id.includes('node_modules')) return null
      return { code: prefix(code), map: null }
    },
    transformIndexHtml(html) {
      let out = html.replaceAll('%APP_VERSION%', version)
      if (channel === 'dev') {
        out = prefix(out).replace('<meta charset="UTF-8" />', '<meta charset="UTF-8" />\n  <meta name="robots" content="noindex" />')
      }
      return out
    },
  }
}

// Pages d'aide : un même fichier pour les deux versions. Un passage propre à l'une s'écrit
// entre <!-- online --> et <!-- /online -->, ou entre <!-- docker --> et <!-- /docker -->.
// Le build en ligne (mode « online ») garde les passages online, tous les autres modes
// (image docker, npm run dev) gardent les passages docker. L'autre version disparaît de la page.
function helpEdition(mode) {
  const keep = mode === 'online' ? 'online' : 'docker'
  return {
    name: 'help-edition',
    transformIndexHtml(html) {
      let out = html
      for (const edition of ['online', 'docker']) {
        const open = `<!-- ${edition} -->`
        const close = `<!-- /${edition} -->`
        for (let start = out.indexOf(open); start !== -1; start = out.indexOf(open, start)) {
          const end = out.indexOf(close, start)
          if (end === -1) throw new Error(`help-edition: ${open} sans ${close}`)
          const body = edition === keep ? out.slice(start + open.length, end) : ''
          out = out.slice(0, start) + body + out.slice(end + close.length)
        }
      }
      return out
    },
  }
}

// Application installable (PWA). Toutes les versions reçoivent le manifeste et ses icônes
// (public/icons) : Chrome et Edge proposent alors d'installer l'éditeur, en HTTPS ou sur localhost.
// La version en ligne reçoit en plus le service worker (src/pwa/sw.js), qui l'ouvre hors connexion.
// La version serveur (image docker) n'en a pas : le co-pilote, le serveur MCP et les diagrammes
// enregistrés y passent par le serveur, et nginx renverrait index.html pour un sw.js absent.
// Le service worker reçoit au build la liste des fichiers construits, sauf les GIF de l'aide
// (trop lourds, copiés seulement une fois vus) et l'image d'aperçu des liens partagés.
const MANIFEST = {
  name: 'BPMN-Pilot',
  short_name: 'BPMN-Pilot',
  description: 'A BPMN 2.0 editor with an AI co-pilot. Draw processes by hand, with the co-pilot, or from any MCP agent.',
  id: './',
  start_url: './',
  scope: './',
  display: 'standalone',
  background_color: '#F5F7FA',
  theme_color: '#0C1120',
  lang: 'en',
  categories: ['productivity', 'business', 'developer'],
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}
const NOT_PRECACHED = /\.(gif|map)$|^sw\.js$|^social-preview\.png$/

function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? listFiles(path) : [path]
  })
}

function pwa(mode, base, version) {
  let outDir = 'dist'
  return {
    name: 'pwa',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir)
    },
    transformIndexHtml(html) {
      return html.replace('<link rel="apple-touch-icon"', `<link rel="manifest" href="${base}manifest.webmanifest" />\n  <meta name="apple-mobile-web-app-title" content="BPMN-Pilot" />\n  <link rel="apple-touch-icon"`)
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: `${JSON.stringify(MANIFEST, null, 2)}\n` })
    },
    // Après l'écriture de tous les fichiers, public/ compris.
    closeBundle() {
      if (mode !== 'online') return
      const files = listFiles(outDir)
        .map((path) => relative(outDir, path).split(sep).join('/'))
        .filter((file) => !NOT_PRECACHED.test(file))
        .sort()
      const hash = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 10)
      const sw = readFileSync('src/pwa/sw.js', 'utf8')
        .replace("'__PWA_VERSION__'", JSON.stringify(version))
        .replace("'__PWA_HASH__'", JSON.stringify(hash))
        .replace("'__PWA_BASE__'", JSON.stringify(base))
        .replace('const FILES = __PWA_FILES__', `const FILES = ${JSON.stringify(files)}`)
      writeFileSync(join(outDir, 'sw.js'), sw)
    },
  }
}

const APP_VERSION = appVersion()

export default defineConfig(async ({ mode }) => ({
  // Chemin du site : « / » par défaut, « /bpmn-pilot/ » sur GitHub Pages (réglé par le workflow).
  base: process.env.BASE_PATH || '/',
  plugins: [
    csp(mode === 'online' ? ONLINE_CONNECT : serverConnect(mode)),
    socialPreview(mode, process.env.BASE_PATH || '/'),
    siteChannel(process.env.SITE_CHANNEL || '', APP_VERSION),
    helpEdition(mode),
    pwa(mode, process.env.BASE_PATH || '/', APP_VERSION),
  ],
  define: {
    ...(await sealedContacts(mode)),
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __SITE_CHANNEL__: JSON.stringify(process.env.SITE_CHANNEL || ''),
  },
  build: {
    outDir: mode === 'online' ? 'dist-online' : 'dist',
    assetsDir: 'assets',
    rolldownOptions: {
      // Quatre pages : l'éditeur, la page d'aide en anglais et en français, et la page vitrine.
      input: {
        main: 'index.html',
        help: 'help.html',
        aide: 'aide.html',
        about: 'about.html',
      },
      output: {
        // bpmn-js dans un fichier à part, comme avant Vite 8 (Rolldown n'accepte plus
        // la forme objet de manualChunks).
        codeSplitting: {
          groups: [{ name: 'bpmn', test: /[\\/]node_modules[\\/]bpmn-js[\\/]/ }],
        },
      }
    }
  },
  optimizeDeps: {
    include: ['bpmn-js']
  }
}))
