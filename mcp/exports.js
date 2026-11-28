// Exports enregistrés sur le serveur (version docker) : le menu Exporter de l'éditeur et l'outil
// export_diagram peuvent déposer leurs fichiers (.bpmn, .xml, .dmn, SVG, PNG, PDF, Markdown, page HTML,
// Word, Excel, .bpmn chiffré) dans ce dossier, sous le nom du diagramme.
// Un fichier existant n'est jamais remplacé : « Mon processus (2).pdf » s'ajoute à côté.
// Le dossier est monté par docker-compose, ou mcp/data/exports en développement.

import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { DIR_MODE, createUnique, safeBaseName } from './files.js'

export const MAX_EXPORT_BYTES = 20 * 1024 * 1024

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
// Word (.docx) et Excel (.xlsx) sont des archives ZIP : en-tête local « PK\x03\x04 ».
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04])
const zipOf = (buf, part) => buf.length > ZIP.length && buf.subarray(0, ZIP.length).equals(ZIP) && buf.includes(Buffer.from(part))
const utf8 = new TextDecoder('utf-8', { fatal: true })

// Texte UTF-8 valide qui commence par une balise XML (après un éventuel BOM).
function xmlText(buf) {
  try {
    const text = utf8.decode(buf).replace(/^\uFEFF/, '').trimStart()
    return text.startsWith('<') ? text : null
  } catch {
    return null
  }
}

// Formats acceptés et contrôle du contenu reçu : le fichier doit être ce que son extension annonce.
export const FORMATS = {
  bpmn: (buf) => /<([\w-]+:)?definitions[\s>]/.test(xmlText(buf) ?? ''),
  xml: (buf) => /<([\w-]+:)?definitions[\s>]/.test(xmlText(buf) ?? ''),
  svg: (buf) => /<svg[\s>]/.test(xmlText(buf) ?? ''),
  png: (buf) => buf.length > PNG.length && buf.subarray(0, PNG.length).equals(PNG),
  pdf: (buf) => buf.subarray(0, 5).toString('latin1') === '%PDF-',
  // Rapport de processus, fiches de procédure, récits utilisateur : texte UTF-8 valide, sans caractère nul.
  md: (buf) => {
    try {
      return !utf8.decode(buf).includes('\0')
    } catch {
      return false
    }
  },
  // Décisions DMN 1.3 : un document XML <definitions> dans l'espace de noms DMN.
  dmn: (buf) => {
    const text = xmlText(buf) ?? ''
    return /<([\w-]+:)?definitions[\s>]/.test(text) && /omg\.org\/spec\/DMN\//.test(text)
  },
  // Formulaire form-js (.form) : un objet JSON avec sa liste de composants.
  form: (buf) => {
    try {
      const data = JSON.parse(utf8.decode(buf))
      return !!data && typeof data === 'object' && Array.isArray(data.components)
    } catch {
      return false
    }
  },
  // Plusieurs formulaires : une archive zip.
  zip: (buf) => buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50,
  // Page de documentation : une page HTML complète.
  html: (buf) => /^<!doctype html>/i.test(xmlText(buf) ?? ''),
  // Les noms des parties d'un document Word ou d'un classeur Excel figurent dans l'archive.
  docx: (buf) => zipOf(buf, 'word/document.xml'),
  xlsx: (buf) => zipOf(buf, 'xl/workbook.xml'),
  // Fichier chiffré de BPMN Pilot : un objet JSON qui porte son format.
  'bpmn.enc': (buf) => {
    try {
      const data = JSON.parse(utf8.decode(buf))
      return !!data && typeof data === 'object' && typeof data.format === 'string' && typeof data.data === 'string'
    } catch {
      return false
    }
  },
}

export function exportsDir() {
  return process.env.EXPORTS_DIR || fileURLToPath(new URL('./data/exports', import.meta.url))
}

export class ExportStore {
  constructor(dir = exportsDir()) {
    this.dir = dir
    this.ready = mkdir(dir, { recursive: true, mode: DIR_MODE })
    this.ready.catch(() => {})
  }

  static validFormat(format) {
    return typeof format === 'string' && Object.hasOwn(FORMATS, format)
  }

  static validContent(format, buf) {
    return ExportStore.validFormat(format) && Buffer.isBuffer(buf) && buf.length > 0 && buf.length <= MAX_EXPORT_BYTES && FORMATS[format](buf)
  }

  // Enregistre le fichier et renvoie le nom retenu.
  async save(name, format, buf) {
    await this.ready
    return createUnique(this.dir, safeBaseName(name), format, buf)
  }
}
