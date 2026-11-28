// Mise en page automatique du diagramme ouvert, partagée par le bouton
// « Ranger » et l'outil MCP layout_diagram (ancien nom : auto_layout).

import { layoutProcess } from 'bpmn-auto-layout'
import { fitView } from './fit-view.js'
import { separateMessageFlows } from './separate-flows.js'
import { reloadWithCopy } from './history.js'
import { fontOf } from './label-style.js'

// bpmn-auto-layout se repère avec les listes incoming/outgoing des éléments,
// or un fichier BPMN valide venu d'un autre outil peut ne pas les contenir.
// On les complète à partir des flux de séquence avant de ranger.
function ensureFlowRefs(modeler) {
  modeler.get('elementRegistry').forEach((el) => {
    const bo = el.businessObject
    if (!bo || bo.$type !== 'bpmn:SequenceFlow') return
    const { sourceRef, targetRef } = bo
    if (sourceRef && !(sourceRef.get('outgoing') || []).includes(bo)) sourceRef.get('outgoing').push(bo)
    if (targetRef && !(targetRef.get('incoming') || []).includes(bo)) targetRef.get('incoming').push(bo)
  })
}

// bpmn-auto-layout redessine tout le DI et perd les couleurs : on les relève
// avant, avec la mise en forme du texte, puis on les remet sur les nouveaux
// éléments, sans passer par l'historique.
const COLOR_ATTRS = ['bioc:fill', 'bioc:stroke', 'color:background-color', 'color:border-color']

function readColors(modeler) {
  const colors = new Map()
  modeler.get('elementRegistry').forEach((el) => {
    if (el.type === 'label' || !el.di) return
    const attrs = {}
    for (const name of COLOR_ATTRS) if (el.di.get(name)) attrs[name] = el.di.get(name)
    const text = el.di.label?.get('color:color')
    if (text) attrs.text = text
    const font = fontOf(el)
    if (font) attrs.font = font
    if (Object.keys(attrs).length) colors.set(el.id, attrs)
  })
  return colors
}

// Mise en forme du texte (bpmndi:BPMNLabelStyle) : bpmn-auto-layout ne garde
// pas les styles du diagramme. On recrée un style par police distincte.
function styleFor(modeler, di, font) {
  const moddle = modeler.get('moddle')
  let diagram = di
  while (diagram && diagram.$type !== 'bpmndi:BPMNDiagram') diagram = diagram.$parent
  if (!diagram) return null
  const styles = diagram.get('labelStyle')
  const keys = ['name', 'size', 'isBold', 'isItalic', 'isUnderline']
  const same = (f) => keys.every((k) => (f?.[k] || undefined) === (font[k] || undefined))
  let style = styles.find((s) => same(s.font))
  if (!style) {
    style = moddle.create('bpmndi:BPMNLabelStyle', { font: moddle.create('dc:Font', font) })
    style.font.$parent = style
    style.id = moddle.ids.nextPrefixed('LabelStyle_', style)
    style.$parent = diagram
    styles.push(style)
  }
  return style
}

function restoreColors(modeler, colors) {
  const registry = modeler.get('elementRegistry')
  const bpmnFactory = modeler.get('bpmnFactory')
  const eventBus = modeler.get('eventBus')
  for (const [id, attrs] of colors) {
    const el = registry.get(id)
    if (!el?.di) continue
    for (const name of COLOR_ATTRS) if (attrs[name]) el.di.set(name, attrs[name])
    if (attrs.text) {
      if (!el.di.label) el.di.label = bpmnFactory.create('bpmndi:BPMNLabel')
      el.di.label.set('color:color', attrs.text)
    }
    if (attrs.font) {
      const style = styleFor(modeler, el.di, attrs.font)
      if (style) {
        if (!el.di.label) el.di.label = bpmnFactory.create('bpmndi:BPMNLabel')
        el.di.label.$parent = el.di
        el.di.label.labelStyle = style
      }
    }
    eventBus.fire('element.changed', { element: el })
    if (el.label) eventBus.fire('element.changed', { element: el.label })
  }
}

// Recalcule toutes les positions puis recharge le diagramme. Le rechargement
// vide l'historique de bpmn-js : une copie d'avant est gardée (src/history.js),
// et Annuler y revient d'un coup. En cas d'échec, le diagramme reste inchangé.
export function autoLayout(modeler) {
  return reloadWithCopy(modeler, () => layoutAndReload(modeler))
}

async function layoutAndReload(modeler) {
  ensureFlowRefs(modeler)
  const colors = readColors(modeler)
  const { xml } = await modeler.saveXML({ format: true })
  const { xml: laid, warnings } = await layoutProcess(xml)
  await modeler.importXML(laid)
  restoreColors(modeler, colors)
  separateMessageFlows(modeler)
  fitView(modeler.get('canvas'))
  // Le rechargement ne passe pas par l'historique : on prévient l'éditeur pour
  // qu'il enregistre le diagramme rangé.
  modeler.get('eventBus').fire('layout.done')
  return warnings.map((w) => w.message)
}
