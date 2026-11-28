# Vos données et vos clés API dans la version en ligne

[English](online-privacy.md) | **Français**

Cette page résume une revue de la version en ligne (https://bpmn.leylines.fr), faite le 2026-11-26 sur la version v1.2.2. Elle suit où vit chaque donnée et où elle peut aller.
Elle ne couvre pas la version Docker, qui a son propre serveur (voir le [README](../README.fr.md)).

## En bref

- La version en ligne n'est que des fichiers statiques servis par GitHub Pages. Aucun serveur applicatif,
  aucun compte, aucune base de données derrière. Rien ne reçoit vos diagrammes ni vos clés API, à part le
  fournisseur d'IA que vous choisissez.
- Vos diagrammes et vos clés API restent dans votre navigateur. Les clés ne partent que chez le
  fournisseur d'IA choisi, sans intermédiaire.
- Quand vous utilisez le co-pilote IA, votre message, vos pièces jointes et le diagramme qu'il lit partent
  directement chez ce fournisseur, selon ses propres conditions.
- La seule autre requête est une mesure d'audience sans cookie, qui ne contient jamais de diagramme, de
  message ni de clé.

Saisir une clé API sur cette page est sûr, avec les réserves listées plus bas. Prenez tout de même une
clé réservée à cet éditeur, qui expire d'elle-même et dont la dépense est plafonnée (voir
[Bonnes pratiques](#bonnes-pratiques)).

## Où vit chaque donnée

| Donnée | Où elle est gardée | Où elle peut aller |
|---|---|---|
| Le diagramme ouvert | stockage du navigateur (`localStorage`), enregistré automatiquement | nulle part, sauf chez le fournisseur d'IA quand vous utilisez le co-pilote |
| « Mes diagrammes » | base de données du navigateur (IndexedDB) | nulle part : l'enregistrement sur serveur est coupé dans la version en ligne |
| Fichiers ouverts et exports (BPMN, SVG, PNG, PDF) | lus et produits dans la page, téléchargés sur votre ordinateur | nulle part |
| Clés API | `sessionStorage` par défaut (effacées à la fermeture de l'onglet), `localStorage` si « Se souvenir des clés API sur votre appareil » est coché | seulement dans les en-têtes des requêtes envoyées au fournisseur choisi |
| Adresses et modèles des fournisseurs | `localStorage` | nulle part |
| Conversation avec le co-pilote | mémoire de la page seulement, perdue au rechargement | chez le fournisseur, à chaque message |
| Pièces jointes du chat (images, PDF, documents bureautiques, fichiers texte) | mémoire de la page (pour les documents et les fichiers texte, seul le texte extrait est gardé) | chez le fournisseur, avec le message |
| Journal d'événements pour le process mining (CSV, XES), menu Expert | mémoire de la page seulement, perdu au rechargement. Si « Garder les totaux dans le fichier .bpmn » est cochée, le diagramme ne garde que des totaux (passages, durées, écarts), jamais de nom de dossier ni de ressource | nulle part. Si vous demandez au co-pilote de dessiner le processus à partir du journal, il ne reçoit que des totaux (noms d'étapes, nombres, durées). Un CSV joint dans le chat est une pièce jointe du chat, envoyée en entier |
| Copie du site pour le hors connexion | stockage de cache du navigateur (Cache API), rempli par le service worker : les seuls fichiers du site (code, pages, images) | nulle part : elle ne contient aucune de vos données |

## Toutes les requêtes de la page

1. **Les fichiers du site** (HTML, scripts, styles, images), depuis GitHub Pages. Comme pour tout site,
   l'hébergeur voit votre adresse IP et les fichiers demandés.
   Après une première visite, un service worker ([src/pwa/sw.js](../src/pwa/sw.js)) garde une copie de
   ces fichiers pour ouvrir le site hors connexion, et regarde de temps en temps si une nouvelle version
   est sortie. Il ne traite que les requêtes vers le site lui-même : celles qui suivent vont droit à leur
   destination, sans lui.
2. **Le fournisseur d'IA choisi**, seulement quand vous utilisez le co-pilote ou listez ses modèles :
   Anthropic, OpenAI, Mistral, xAI, Ollama sur votre propre machine, ou l'adresse « compatible OpenAI » que
   vous saisissez vous-même.
3. **La mesure d'audience anonyme** (statistiques d'usage), sur la page stable seulement : l'adresse de la
   page (sans la partie après `#`), le site de provenance, la langue du navigateur, la taille de l'écran, la
   version de l'app, et le nom d'une action avec au plus une catégorie : langue de l'interface, format
   d'export, nom de fournisseur, type de fichier, classe d'erreur (tranche de code HTTP), tranche de nombre.
   Les actions sont listées dans [src/usage-events.js](../src/usage-events.js) et les fichiers qui appellent
   `track`. Ni cookie, ni diagramme, ni message, ni contenu de fichier, ni clé. Elle est coupée par « Do Not
   Track » et « Global Privacy Control ». Le code est dans [src/analytics.js](../src/analytics.js).

L'enregistrement et les exports sur serveur n'existent pas dans la version en ligne : leur adresse de
serveur est forcée à vide quand la version en ligne est construite ([src/main.js](../src/main.js)).

## Agent local (MCP)

Un agent IA installé sur votre ordinateur peut piloter la page par le relais local `bpmn-pilot-mcp`,
que l'agent lance lui-même ([relay/README.md](../relay/README.md), code dans
[mcp/relay.js](../mcp/relay.js)).

- **Désactivé par défaut.** La page n'ouvre une connexion vers votre ordinateur qu'après que vous avez
  activé **Agent local** dans la fenêtre « Connecter un agent » (bouton MCP), et la ferme quand vous le
  désactivez. Le choix est gardé dans le stockage local du navigateur.
- **Sur votre ordinateur seulement.** La page se connecte à `ws://127.0.0.1:3333`. Le relais n'écoute que
  sur `127.0.0.1`, n'accepte que la page `https://bpmn.leylines.fr` (contrôlée par l'en-tête `Origin`,
  qu'une page web ne peut pas falsifier) et que des noms d'hôte locaux. Chrome et Edge demandent en plus,
  une fois, d'autoriser l'accès au réseau local.
- **Rien ne passe par un autre serveur.** Le diagramme va de l'agent au relais, puis à l'onglet, et
  retour. Le relais n'écrit rien sur le disque et n'appelle aucun service.
- **Ce que l'agent fait du diagramme** dépend de l'agent et de son fournisseur d'IA, comme pour tout
  fichier que vous lui donnez. La mesure d'audience n'enregistre ni diagramme ni message de l'agent.

## Ce qui protège vos clés et vos diagrammes

- **Aucun script tiers.** La politique de sécurité du contenu n'autorise que les scripts du site
  (`script-src 'self'`, plus un court script intégré, autorisé par son empreinte). Ni CDN,
  ni script de suivi, ni police externe.
- **Aucun HTML venu de l'extérieur.** Les réponses du co-pilote, les noms de diagrammes et de modèles
  s'affichent en texte simple, jamais interprétés comme du HTML. Le code n'utilise pas `eval`.
- **Aucun réglage lu dans l'adresse.** La page ne lit rien dans les paramètres de l'URL : un lien piégé ne
  peut pas changer l'adresse d'un fournisseur pour détourner une clé.
- **Aucune sortie par le co-pilote.** Les outils du co-pilote ne font que lire et modifier le diagramme,
  ou proposer un téléchargement. Aucun n'envoie de données vers une adresse : des consignes cachées dans un
  diagramme ou un PDF ne peuvent pas faire envoyer votre clé ailleurs.
- **Aucun affichage dans un autre site.** GitHub Pages ne peut pas envoyer l'en-tête qui l'interdit, la
  page le vérifie donc elle-même : dans le cadre d'une autre page, l'éditeur ne démarre pas et n'affiche
  qu'un lien qui l'ouvre dans son propre onglet ([src/frame-guard.js](../src/frame-guard.js)). Rien ne peut
  être cliqué à votre insu.
- **Gardé pour ce site seulement.** Les autres sites ne peuvent pas lire ce que cette page garde dans votre
  navigateur. La page de développement vit à sa propre adresse : son code, construit à partir de
  changements pas encore publiés, ne peut pas non plus lire ce que garde la page stable.
- **Une construction verrouillée.** Versions exactes des dépendances (`npm ci` sur le fichier de
  verrouillage), actions GitHub épinglées par commit, et aucune vulnérabilité connue dans les dépendances
  embarquées (`npm audit`) à la date de la revue.

## Limites connues

- **Votre propre appareil.** Une extension de navigateur malveillante, ou quelqu'un qui utilise votre
  session sur l'ordinateur, peut lire une clé mémorisée. Sur un ordinateur partagé, laissez « Se souvenir
  des clés API sur votre appareil » décoché.
- **Les clés mémorisées ne sont pas chiffrées.** Les chiffrer dans le navigateur ne servirait à rien : la
  clé pour les déchiffrer devrait être rangée juste à côté.
- **Connexions ouvertes.** La page peut se connecter à toute adresse `https`, car vous pouvez choisir
  n'importe quel fournisseur. La protection contre le vol d'une clé repose donc sur les points ci-dessus
  (aucun script tiers, aucun HTML venu de l'extérieur), pas sur une liste d'adresses autorisées.

## Bonnes pratiques

- Utilisez une clé API créée pour cet éditeur seul, avec une durée de validité limitée.
- Ajoutez une limite de dépense si votre fournisseur le permet. En cas de fuite, la clé ne sert qu'ici,
  expire d'elle-même et se supprime sans toucher à vos autres usages.
- Sur un ordinateur partagé, ne cochez pas « Se souvenir des clés API sur votre appareil », et cliquez sur
  « Effacer les clés API » à la fin.

## Vérifier par vous-même

Ouvrez les outils de développement du navigateur sur la page : l'onglet Réseau liste chaque requête, et
l'onglet Application (ou Stockage) montre ce qui est gardé dans le navigateur. La politique de sécurité du
contenu est dans la balise `<meta http-equiv="Content-Security-Policy">` de la page. Pour signaler un
problème, voir [SECURITY.md](../SECURITY.md).
