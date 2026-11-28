// ESLint, règles recommandées. Lancé par `npm run lint` et par la CI sur chaque PR.
import js from '@eslint/js'
import globals from 'globals'

export default [
  {
    ignores: ['node_modules/', 'mcp/node_modules/', 'dist/', 'dist-online/', 'src/packed-lint-config.js', 'design/'],
  },
  js.configs.recommended,
  {
    rules: {
      // Les catch vides sont voulus : stockage du navigateur indisponible, valeur facultative illisible.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Les noms saisis sont nettoyés de leurs caractères de contrôle : ces expressions sont voulues.
      'no-control-regex': 'off',
      // `const { a, ...rest } = obj` sert à retirer une propriété.
      'no-unused-vars': ['error', { ignoreRestSiblings: true }],
    },
  },
  {
    // L'éditeur, exécuté dans le navigateur. Vite fournit import.meta.env.
    files: ['src/**/*.js'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    // Le service worker de la version en ligne.
    files: ['src/pwa/sw.js'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
  {
    // Le serveur MCP, la configuration de Vite, les tests et les scripts, exécutés par Node.
    files: ['mcp/**/*.js', 'test/**/*.mjs', 'test/**/*.js', 'scripts/**/*.mjs', '*.config.js', '*.config.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
]
