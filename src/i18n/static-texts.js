// Textes de index.html, écrits en anglais dans la page : traduits ici quand
// l'interface est en français. Bouton EN/FR de la barre d'outils.

import { lang, setLang } from './lang.js'

const FR = {
  'h1': { text: 'BPMN-Pilot' },
  '#file-name-field': { title: "Nom du fichier pour l'enregistrement et les exports" },
  '#file-name': { 'aria-label': 'Nom du fichier', placeholder: 'Nom du fichier' },
  '#btn-new': { text: 'Nouveau', title: 'Créer un diagramme vide (remplace la sauvegarde auto)' },
  '#btn-open-menu': { text: 'Ouvrir', title: 'Ouvrir un fichier, coller du XML, construire depuis un tableau, une grille ou Mermaid, ou comparer avec un fichier' },
  '#btn-open': { text: 'Fichier .bpmn, .xml ou chiffré…', title: 'Ouvrir un diagramme BPMN 2.0 depuis votre ordinateur, ou un fichier chiffré .bpmn.enc' },
  '#btn-open-dmn': { text: 'Fichier .dmn (décisions)…', title: 'Ajouter les décisions d\'un fichier DMN au diagramme ouvert, pour les lier à ses tâches de règle métier' },
  '#btn-save-forms': { text: 'Formulaires des tâches (fichiers .form)', title: 'Les formulaires des tâches de ce diagramme en fichiers form-js (.form, ou un .zip qui les réunit), à déployer avec le processus dans Camunda 8' },
  '#btn-save-dmn': { text: 'Décisions (fichier .dmn)', title: 'Les décisions de ce diagramme en fichier DMN 1.3, pour Camunda Modeler ou un moteur de décision' },
  '#btn-expert-modules': { text: 'Choisir les modules…', title: 'Allumer ou éteindre chaque fonction experte' },
  '#btn-dmn-drd': { text: 'Décisions du diagramme…', title: 'Ouvrir les décisions de ce diagramme et leur diagramme d\'exigences' },
  '#btn-import-xml': { text: 'Coller du XML…', title: 'Coller du XML BPMN ; un processus sans disposition est rangé automatiquement' },
  '#btn-import-table': { text: 'Depuis un tableau…', title: 'Construire un processus à partir d\'un tableau d\'étapes collé depuis Excel, ou d\'un fichier .csv ou .xlsx, sans IA' },
  '#btn-import-grid': { text: 'Grille rôles × tâches…', title: 'Pour un atelier : rôles en colonnes, tâches en lignes, un clic par tâche ; le diagramme se construit avec un couloir par rôle' },
  '#btn-import-mermaid': { text: 'Depuis Mermaid…', title: 'Construire un processus à partir d\'un flowchart Mermaid, collé ou tiré d\'un fichier .mmd ou .md, sans IA' },
  '#btn-compare-file': { text: 'Comparer avec un fichier…', title: 'Comparer le diagramme ouvert avec un fichier .bpmn, côte à côte' },
  '#history-buttons': { 'aria-label': 'Historique et recherche' },
  '#btn-undo': { title: 'Annuler (Ctrl+Z)', 'aria-label': 'Annuler' },
  '#btn-redo': { title: 'Rétablir (Ctrl+Y)', 'aria-label': 'Rétablir' },
  '#btn-search': { title: 'Rechercher dans les libellés et la documentation (Ctrl+F)', 'aria-label': 'Rechercher' },
  '#zoom-buttons': { 'aria-label': 'Zoom' },
  '#btn-plan': { title: 'Plan du diagramme : sous-processus, sous-niveaux et tables de décision', 'aria-label': 'Plan du diagramme' },
  '#btn-zoom-out': { title: 'Dézoomer (Ctrl+−)', 'aria-label': 'Dézoomer' },
  '#btn-zoom-level': { title: 'Niveau de zoom : clic pour la glissière de zoom', 'aria-label': 'Niveau de zoom, clic pour la glissière de zoom' },
  '#btn-zoom-in': { title: 'Zoomer (Ctrl++)', 'aria-label': 'Zoomer' },
  '#btn-zoom-fit': { title: 'Ajuster le diagramme à l\'écran', 'aria-label': 'Ajuster le diagramme à l\'écran' },
  '#btn-export': { text: 'Exporter', title: 'Exporter en BPMN, XML, SVG, PNG ou PDF, en fiches de procédure (PDF, Word, Markdown), en page de documentation HTML, ou imprimer' },
  '#btn-save': { text: 'Fichier .bpmn', title: 'Fichier BPMN 2.0, lisible par les autres outils BPMN' },
  '#btn-save-xml': { text: 'Fichier .xml', title: 'Même contenu que le .bpmn, avec l\'extension .xml' },
  '#btn-mining': { text: 'Analyser un journal d\'événements (process mining)…', title: 'Charger un journal d\'événements exporté de votre ERP, CRM ou outil de tickets, et voir sur le diagramme ce qui se passe vraiment : passages, durées, écarts' },
  '#btn-camunda-8': { text: 'BPMN pour Camunda 8', title: 'Fichier BPMN préparé pour Camunda 8 : plateforme indiquée, processus exécutable, conditions des passerelles en FEEL tirées du champ Condition ou du libellé du flux, tâches assignées en tâches utilisateur' },
  '#btn-camunda-7': { text: 'BPMN pour Camunda 7', title: 'Fichier BPMN préparé pour Camunda 7 : plateforme indiquée, processus exécutable, conditions des passerelles en JUEL tirées du champ Condition ou du libellé du flux, tâches assignées en tâches utilisateur' },
  '#btn-save-encrypted': { text: 'Fichier .bpmn chiffré…', title: 'Le fichier .bpmn chiffré dans votre navigateur par un mot de passe (AES-256), pour envoyer un processus sensible' },
  '#btn-xml': { text: 'Code XML à copier…', title: 'Afficher le XML BPMN, prêt à copier' },
  '#btn-mermaid': { text: 'Code Mermaid à copier…', title: 'Le diagramme en flowchart Mermaid, à coller dans un README ou un wiki' },
  '#btn-svg': { text: 'Image SVG', title: 'Image vectorielle, nette à toute taille' },
  '#btn-png': { text: 'Image PNG', title: 'Image bitmap en résolution 2×, fond blanc' },
  '#btn-pdf': { text: 'Document PDF', title: 'Document PDF vectoriel' },
  '#btn-sheets-pdf': { text: 'Fiches de procédure (PDF)', title: 'Une page par activité, dans l\'ordre du flux, avec sa documentation' },
  '#btn-sheets-md': { text: 'Fiches de procédure (Markdown)', title: 'Les mêmes fiches de procédure, en texte Markdown' },
  '#btn-sheets-docx': { text: 'Fiches de procédure (Word)', title: 'Les mêmes fiches de procédure, en document Word modifiable' },
  '#btn-raci-xlsx': { text: 'Matrice RACI (Excel)', title: 'Qui réalise, valide, est consulté et est informé pour chaque activité, en classeur Excel' },
  '#expert-report-title': { text: 'Rapport de processus' },
  '#btn-report-pdf': { text: 'PDF', title: 'Rapport de processus : constats, axes d\'amélioration et séquence des éléments, en PDF' },
  '#btn-report-docx': { text: 'Word', title: 'Le même rapport de processus, en document Word modifiable' },
  '#btn-report-md': { text: 'Markdown', title: 'Le même rapport de processus, en texte Markdown' },
  '#btn-ai-potential': { text: 'Quelles activités confier à l\'IA ?', title: 'Le Co-pilote IA note chaque activité : automatisable, assistée par IA ou humaine, avec sa raison et son garde-fou, et note les risques et contrôles des étapes confiées à l\'IA ; le résultat va dans le rapport de processus' },
  '#btn-ai-probabilities': { text: 'Proposer les probabilités', title: 'Demander au Co-pilote IA des probabilités réalistes pour les branches, à revoir avant la simulation' },
  '#help-ai-probabilities': { 'aria-label': "Connectez un modèle d'IA au Co-pilote pour utiliser cette fonction" },
  '#help-ai-analysis': { 'aria-label': "Connectez un modèle d'IA au Co-pilote pour utiliser cette fonction" },
  '#help-ai-potential': { 'aria-label': "Connectez un modèle d'IA au Co-pilote pour utiliser cette fonction" },
  '#btn-ai-stories': { text: 'Récits utilisateur par activité', title: 'Le Co-pilote IA rédige les récits utilisateur et les critères d\'acceptation de chaque activité, d\'après son nom, son couloir, sa documentation et ses systèmes' },
  '#help-ai-stories': { 'aria-label': "Connectez un modèle d'IA au Co-pilote pour utiliser cette fonction" },
  '#btn-stories-md': { text: 'Récits utilisateur (Markdown)', title: 'Les récits utilisateur et critères d\'acceptation de chaque activité, dans l\'ordre du flux, en Markdown' },
  '#btn-doc-html': { text: 'Page de documentation (HTML)', title: 'Une page web autonome : le diagramme, et la fiche de chaque élément au clic. Elle s\'ouvre dans n\'importe quel navigateur, sans BPMN Pilot' },
  '#btn-ai-analysis': { text: 'Analyse du Co-pilote', title: 'Le Co-pilote IA lance 100 jetons, lit le rapport et y écrit son analyse' },
  '#btn-print': { text: 'Imprimer…', title: 'Imprimer, ou enregistrer en PDF depuis la fenêtre du navigateur' },
  '#btn-library': { text: 'Mes diagrammes', title: 'Enregistrer, rouvrir, renommer ou supprimer des diagrammes (Ctrl+S enregistre)' },
  '#btn-layout': { text: 'Ranger', title: 'Ranger la disposition' },
  '#btn-simulation': { title: 'Faire circuler des jetons dans le processus, avec la carte de chaleur et les probabilités des branches' },
  '#btn-present': { text: 'Présentation', title: 'Présentation : le diagramme seul, en plein écran' },
  '#btn-expert': { text: 'Expert', title: 'Mode Expert : simulation de jetons et rapport de processus' },
  '#expert-switch': { 'aria-label': 'Mode Expert' },
  '#autosave-status': { text: 'Sauvegarde auto : —' },
  '#btn-install': { title: 'Installer BPMN-Pilot en PWA', 'aria-label': 'Installer la PWA' },
  '#btn-help': { href: 'aide.html', title: "Aide : comment utiliser l'éditeur", 'aria-label': 'Aide' },
  '#btn-properties': { title: 'Masquer le panneau Processus', 'aria-label': 'Masquer le panneau Processus' },
}

export function applyStaticTexts(save) {
  document.documentElement.lang = lang
  if (lang === 'fr') {
    document.title = 'BPMN-Pilot · Leylines'
    for (const [selector, attrs] of Object.entries(FR)) {
      const el = document.querySelector(selector)
      if (!el) continue
      for (const [name, value] of Object.entries(attrs)) {
        if (name === 'text') el.textContent = value
        else el.setAttribute(name, value)
      }
    }
  }

  // Bouton de langue : il affiche l'autre langue, et son infobulle est écrite dans celle-ci.
  const button = document.getElementById('btn-lang')
  if (!button) return
  const other = lang === 'fr' ? 'en' : 'fr'
  button.textContent = other.toUpperCase()
  button.title = other === 'fr' ? 'Passer en français' : 'Switch to English'
  button.setAttribute('aria-label', button.title)
  button.setAttribute('lang', other)
  button.addEventListener('click', async () => {
    try { await save?.() } catch {}
    setLang(other)
    location.reload()
  })
}
