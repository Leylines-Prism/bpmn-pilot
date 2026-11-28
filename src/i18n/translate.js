import fr from './fr.js'

// Module de traduction de bpmn-js, d'après l'exemple officiel
// https://github.com/bpmn-io/bpmn-js-examples/tree/main/i18n
// Il remplace le service `translate` par défaut : tous les textes de
// bpmn-js, diagram-js et du panneau de propriétés passent par lui.

const missing = new Set()

// Textes qui finissent par une liste variable (« … : montant, client ») : le début se traduit,
// la liste reste telle quelle.
const PREFIXES = Object.keys(fr).filter((k) => k.endsWith(': '))

function translate(template, replacements) {
  replacements = replacements || {}

  let translated = fr[template]
  if (translated === undefined) {
    const prefix = PREFIXES.find((p) => template.startsWith(p))
    if (prefix) translated = fr[prefix] + template.slice(prefix.length)
  }

  if (translated === undefined && import.meta.env.DEV && !missing.has(template)) {
    missing.add(template)
    console.debug('[i18n] texte non traduit :', template)
  }

  return (translated || template).replace(/{([^}]+)}/g, (_, key) => {
    return key in replacements ? replacements[key] : '{' + key + '}'
  })
}

export default {
  translate: [ 'value', translate ]
}
