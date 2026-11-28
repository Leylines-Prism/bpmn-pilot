// Où le diagramme range les formulaires de ses tâches (mode Expert, module Formulaires).
//
// - Le formulaire d'une tâche utilisateur ou d'un événement de début est un schéma form-js
//   (JSON), texte d'un élément bpmnpilot:taskForm dans les extensions de l'élément
//   (src/bpmn-pilot-moddle.json). Il suit le .bpmn partout : Mes diagrammes, sauvegarde
//   automatique, export, Comparer, copier-coller, serveur MCP.
// - Pour que le fichier s'ouvre déjà relié dans les outils Camunda 8, l'élément porte aussi
//   zeebe:formDefinition formId="<id du schéma>" (formulaire lié, à déployer avec le processus).
//
// Ce module ne dépend de rien : il tourne dans la page et dans les tests.

const isA = (bo, type) => !!bo?.$instanceOf?.(type)

export const FORM_HOLDERS = ['bpmn:UserTask', 'bpmn:StartEvent']
// Version du schéma form-js écrite dans un formulaire neuf (form-js 2.2.0).
export const SCHEMA_VERSION = 19
export const EXPORTER = { name: 'BPMN Pilot', version: '1' }

export const canHoldForm = (bo) => FORM_HOLDERS.some((t) => isA(bo, t))

const taskFormOf = (bo) => (bo?.extensionElements?.values || []).find((v) => isA(v, 'bpmnpilot:TaskForm'))
const formDefinitionOf = (bo) => (bo?.extensionElements?.values || []).find((v) => isA(v, 'zeebe:FormDefinition'))

// Schéma du formulaire de l'élément, ou null. Un texte illisible compte comme absent.
export function formOf(bo) {
  const text = taskFormOf(bo)?.schema
  if (!text?.trim()) return null
  try {
    const schema = JSON.parse(text)
    return schema && typeof schema === 'object' && Array.isArray(schema.components) ? schema : null
  } catch {
    return null
  }
}

export const hasForm = (bo) => !!formOf(bo)

// Identifiant de formulaire tiré de l'élément : Form_<id de l'élément>.
export const formIdFor = (bo) => `Form_${String(bo?.id || 'task').replace(/[^\w-]/g, '_')}`

// Propriétés à passer à modeling.updateModdleProperties(element, bo, …) pour ranger `schema`
// (ou retirer le formulaire si schema est vide). Le lien Camunda 8 suit l'id du schéma.
export function formProperties(moddle, bo, schema) {
  const values = (bo.extensionElements?.values || []).filter((v) => !isA(v, 'bpmnpilot:TaskForm') && !(schema === null && isA(v, 'zeebe:FormDefinition') && v.formId))
  if (schema) {
    const id = schema.id || formIdFor(bo)
    const full = { ...schema, id }
    values.push(moddle.create('bpmnpilot:TaskForm', { schema: JSON.stringify(full) }))
    const previous = formDefinitionOf(bo)
    const rest = values.filter((v) => !isA(v, 'zeebe:FormDefinition'))
    // Un lien Camunda vers une autre forme de formulaire (formKey, externalReference) est gardé tel quel.
    const link = previous && !previous.formId ? previous : moddle.create('zeebe:FormDefinition', { formId: id })
    return { extensionElements: moddle.create('bpmn:ExtensionElements', { values: [...rest, link] }) }
  }
  return { extensionElements: values.length ? moddle.create('bpmn:ExtensionElements', { values }) : undefined }
}

// ── Champs et variables ──

// Composants qui ne saisissent rien (texte, image, séparateur…).
const DISPLAY = new Set(['text', 'html', 'image', 'separator', 'spacer', 'button', 'iframe', 'documentPreview', 'table', 'expression'])
const CONTAINERS = new Set(['group', 'dynamiclist'])

// Champs de saisie du formulaire, à plat : [{ key, path, label, type, required, values? }].
// path : la clé complète (groupe.champ) quand un groupe range ses champs sous un chemin.
export function formFields(schema) {
  const out = []
  const walk = (components, prefix) => {
    for (const c of components || []) {
      if (!c || typeof c !== 'object') continue
      if (CONTAINERS.has(c.type)) {
        const path = c.path ? [...prefix, ...String(c.path).split('.')] : prefix
        walk(c.components, path)
        continue
      }
      if (DISPLAY.has(c.type) || !c.key) continue
      const field = { key: String(c.key), path: [...prefix, ...String(c.key).split('.')].join('.'), label: c.label || '', type: c.type, required: !!c.validate?.required }
      if (Array.isArray(c.values) && c.values.length) field.values = c.values.map((v) => (v && typeof v === 'object' ? String(v.value ?? v.label ?? '') : String(v)))
      if (c.readonly || c.disabled) field.readonly = true
      out.push(field)
    }
  }
  walk(schema?.components, [])
  return out
}

// Variables que le formulaire remplit : le premier segment de chaque chemin (clé de premier niveau).
export const formVariables = (schema) => [...new Set(formFields(schema).filter((f) => !f.readonly).map((f) => f.path.split('.')[0]))]

// Tous les formulaires du diagramme : [{ bo, schema }], sous-processus compris.
export function formsOf(definitions) {
  const out = []
  const walk = (container) => {
    for (const el of container.flowElements || []) {
      if (canHoldForm(el)) {
        const schema = formOf(el)
        if (schema) out.push({ bo: el, schema })
      }
      if (el.flowElements) walk(el)
    }
  }
  for (const root of definitions?.rootElements || []) if (isA(root, 'bpmn:Process')) walk(root)
  return out
}

// ── Formulaire écrit par le Co-pilote : description simple → schéma form-js ──

export const FIELD_TYPES = ['textfield', 'textarea', 'number', 'checkbox', 'radio', 'select', 'checklist', 'taglist', 'datetime']
const CHOICE = new Set(['radio', 'select', 'checklist', 'taglist'])
const KEY_RE = /^[A-Za-z_][\w]*$/

// Clé de variable tirée d'un libellé : « Montant TTC » → montantTtc.
export function keyFromLabel(label, fallback = 'field') {
  const words = String(label ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)
  if (!words.length) return fallback
  const key = words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join('')
  return /^[0-9]/.test(key) ? `${fallback}${key}` : key
}

// spec : { title?, intro?, fields: [{ key?, label, type?, required?, values?, min?, max?, description?, defaultValue? }],
// submitLabel? }. Renvoie un schéma form-js complet. Lance une erreur lisible sur une clé en double.
export function schemaFromSpec(spec, id) {
  const fields = spec?.fields || []
  const components = []
  if (spec?.title || spec?.intro) {
    components.push({ type: 'text', id: 'Text_title', text: [spec.title ? `## ${spec.title}` : '', spec.intro || ''].filter(Boolean).join('\n\n') })
  }
  const seen = new Set()
  fields.forEach((f, n) => {
    const type = FIELD_TYPES.includes(f.type) ? f.type : 'textfield'
    const key = f.key && KEY_RE.test(f.key) ? f.key : keyFromLabel(f.key || f.label, `field${n + 1}`)
    if (seen.has(key)) throw new Error(`Two fields use the key "${key}". Each field needs its own key.`)
    seen.add(key)
    const c = { type, id: `Field_${key}`, key, label: f.label || key }
    if (f.description) c.description = f.description
    const validate = {}
    if (f.required) validate.required = true
    if (type === 'number') {
      if (typeof f.min === 'number') validate.min = f.min
      if (typeof f.max === 'number') validate.max = f.max
    }
    if (Object.keys(validate).length) c.validate = validate
    if (CHOICE.has(type)) {
      const values = (f.values || []).map((v) => String(v)).filter(Boolean)
      if (!values.length) throw new Error(`Field "${c.label}" (${type}) needs its values.`)
      c.values = values.map((v) => ({ label: v, value: v }))
    }
    if (type === 'datetime') c.subtype = 'date'
    if (f.defaultValue !== undefined && f.defaultValue !== null && f.defaultValue !== '') c.defaultValue = f.defaultValue
    components.push(c)
  })
  const schema = { type: 'default', id, components, schemaVersion: SCHEMA_VERSION, exporter: EXPORTER }
  return schema
}

// Formulaire vide pour une tâche : un titre (son nom) et rien d'autre.
export const emptySchema = (bo) => ({ type: 'default', id: formIdFor(bo), components: bo?.name ? [{ type: 'text', id: 'Text_title', text: `## ${bo.name}` }] : [], schemaVersion: SCHEMA_VERSION, exporter: EXPORTER })

// Constats sur un formulaire : [{ level, code, text, fr }].
export function checkForm(schema) {
  const out = []
  const fields = formFields(schema)
  if (!fields.length) out.push({ level: 'warning', code: 'no-field', text: 'The form has no input field: it collects nothing.', fr: 'Le formulaire n\'a aucun champ de saisie : il ne recueille rien.' })
  const count = {}
  for (const f of fields) count[f.path] = (count[f.path] || 0) + 1
  for (const [path, n] of Object.entries(count)) {
    if (n > 1) out.push({ level: 'error', code: 'duplicate-key', text: `${n} fields write the same variable "${path}".`, fr: `${n} champs écrivent la même variable « ${path} ».` })
  }
  for (const f of fields) {
    if (!f.label) out.push({ level: 'info', code: 'no-label', text: `Field "${f.key}" has no label.`, fr: `Le champ « ${f.key} » n'a pas de libellé.` })
    if (!KEY_RE.test(f.key.split('.').pop())) out.push({ level: 'warning', code: 'bad-key', text: `Key "${f.key}" is not a valid variable name (letters, digits and _ only).`, fr: `La clé « ${f.key} » n'est pas un nom de variable valide (lettres, chiffres et _ seulement).` })
  }
  return out
}

// Résumé d'un formulaire pour les outils et le panneau.
export function describeForm(schema) {
  const fields = formFields(schema)
  return {
    id: schema.id || null,
    title: (schema.components || []).find((c) => c.type === 'text')?.text?.split('\n')[0].replace(/^#+\s*/, '') || null,
    fields: fields.map(({ path, label, type, required, values, readonly }) => ({ key: path, label, type, ...(required ? { required } : {}), ...(values ? { values } : {}), ...(readonly ? { readonly } : {}) })),
    variables: formVariables(schema),
  }
}
