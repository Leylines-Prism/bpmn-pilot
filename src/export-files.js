// Fichiers d'export du diagramme ouvert : le menu Exporter et l'outil export_diagram
// passent par ici, pour que l'IA produise exactement le même fichier qu'un export à la main.

import { exportPdf } from './export-pdf.js'

export const EXPORT_FORMATS = ['bpmn', 'svg', 'png', 'pdf']

// Documents du menu Exporter tirés du diagramme, produits par src/main.js (buildDocument) :
// décisions, BPMN pour Camunda, rapport, fiches de procédure, page HTML, récits utilisateur, RACI.
// Recopiés dans l'outil export_diagram (src/ai/tools.js, qui n'importe rien) : un test les compare.
export const DOCUMENT_FORMATS = [
  'dmn', 'forms', 'camunda8', 'camunda7',
  'report-pdf', 'report-md', 'report-docx',
  'sheets-pdf', 'sheets-md', 'sheets-docx',
  'doc-html', 'stories-md', 'raci-xlsx',
]

const TYPES = {
  bpmn: 'application/xml',
  xml: 'application/xml',
  svg: 'image/svg+xml',
  png: 'image/png',
  pdf: 'application/pdf',
}

// PNG : SVG de bpmn-js dessiné en x2 sur fond blanc.
async function renderPng(modeler) {
  const { svg } = await modeler.saveSVG()
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('png-unavailable'))
      image.src = url
    })
    const scale = 2
    const canvas = document.createElement('canvas')
    canvas.width = (img.naturalWidth || 800) * scale
    canvas.height = (img.naturalHeight || 600) * scale
    const ctx = canvas.getContext('2d')
    ctx.scale(scale, scale)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width / scale, canvas.height / scale)
    ctx.drawImage(img, 0, 0)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('png-unavailable')
    return blob
  } finally {
    URL.revokeObjectURL(url)
  }
}

// Renvoie { content (texte ou Blob), ext, type }. format : bpmn, xml, svg, png ou pdf.
export async function renderExport(modeler, format) {
  const type = TYPES[format]
  if (!type) throw new Error(`Unknown export format: ${format}`)
  let content
  if (format === 'bpmn' || format === 'xml') content = (await modeler.saveXML({ format: true })).xml
  else if (format === 'svg') content = (await modeler.saveSVG()).svg
  else if (format === 'png') content = await renderPng(modeler)
  else content = await exportPdf(modeler)
  return { content, ext: format, type }
}

// Taille en octets d'un contenu d'export.
export function exportSize(content) {
  return content instanceof Blob ? content.size : new TextEncoder().encode(content).length
}

// Le diagramme a-t-il au moins une forme ? Une image d'un diagramme vide n'a pas de sens.
export function hasShapes(modeler) {
  const root = modeler.get('canvas').getRootElement()
  return modeler.get('elementRegistry').filter((el) => el !== root && !el.labelTarget).length > 0
}
