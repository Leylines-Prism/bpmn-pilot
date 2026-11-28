![BPMN-Pilot : dessiner des processus BPMN 2.0 dans le navigateur, à la main, avec un co-pilote IA ou depuis un agent MCP](public/social-preview.png)

# BPMN-Pilot

[![CI](https://github.com/Leylines-Prism/bpmn-pilot/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Leylines-Prism/bpmn-pilot/actions/workflows/ci.yml)
[![Version](https://img.shields.io/github/v/tag/Leylines-Prism/bpmn-pilot?sort=semver&label=version)](https://github.com/Leylines-Prism/bpmn-pilot/tags)
[![ghcr.io](https://img.shields.io/badge/ghcr.io-leylines--prism%2Fbpmn--pilot-blue?logo=docker&logoColor=white)](https://github.com/Leylines-Prism/bpmn-pilot/pkgs/container/bpmn-pilot)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/Leylines-Prism/bpmn-pilot/badge)](https://scorecard.dev/viewer/?uri=github.com/Leylines-Prism/bpmn-pilot)
[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/17089/badge)](https://www.bestpractices.dev/projects/17089)
[![BPMN-Pilot MCP server on Glama](https://glama.ai/mcp/servers/Leylines-Prism/bpmn-pilot/badges/score.svg)](https://glama.ai/mcp/servers/Leylines-Prism/bpmn-pilot)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-soutenir-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/leylines_prism)

[English](README.md) | **Français**

![Le co-pilote IA dessine un processus de commande en ligne avec deux pools et quatre lanes](docs/demo.fr.gif)

**Modélisez en quelques secondes tous les processus de votre contexte, simplement en échangeant avec
votre agent IA.**

Relié à un agent et à tout ce qu'il connaît (messagerie, wiki, base documentaire, RAG, mémoire en
graphe ou « second cerveau »), BPMN-Pilot transforme de simples conversations en diagrammes BPMN :
l'agent trouve les processus, l'éditeur les dessine et les vérifie, et vous relisez le résultat. Fini
les heures passées sur la structure BPMN et le dessin à la main.

<table>
<tr><th width="34%">Votre invite</th><th>Le diagramme dessiné par le co-pilote IA</th></tr>
<tr>
<td valign="top">

> Dessine une demande d'achat : le salarié saisit sa demande, son manager l'accepte ou la refuse. Si elle est acceptée, les achats commandent au fournisseur, puis la comptabilité paie la facture. En cas de refus, le salarié est prévenu.

<sub>Un message, un seul passage. Couloirs, décision, flux de messages vers le pool du fournisseur, puis les six contrôles du résultat.</sub>
</td>
<td><img src="docs/prompt-example.fr.png" alt="Diagramme BPMN dessiné depuis l'invite : un pool Entreprise avec les couloirs Salarié, Manager, Achats et Comptabilité, une décision d'acceptation et des flux de messages vers un pool Fournisseur"></td>
</tr>
</table>

BPMN-Pilot est un éditeur BPMN 2.0 dans le navigateur (bpmn-js), en français et en anglais :

- **Connectez un agent par MCP** ([en ligne](#connecter-un-agent-à-la-version-en-ligne) ou en Docker), comme
  Claude Desktop, Claude Code, Cursor ou GitHub Copilot dans VS Code. Il pilote l'éditeur ouvert dans votre
  navigateur, ou, avec le mode sans écran facultatif de la version Docker, un éditeur invisible.
- **Demandez au co-pilote IA intégré** ([en ligne](https://bpmn.leylines.fr) ou en Docker) : décrivez
  un processus ou joignez vos documents (Word, Excel, PDF, e-mails…), et il le dessine.
- **Dessinez à la main**, avec le modeleur bpmn-js et ses extensions.

La même conversation met aussi le schéma en forme (couleurs, polices, noms et types, sur autant
d'éléments à la fois que vous voulez) et chaque réponse s'annule d'un clic. Le pilote, c'est vous,
d'où le nom : le co-pilote IA et vos agents préparent le travail, et vous gardez la main sur chaque
diagramme.

Deux façons de l'utiliser, au choix :

<table>
<tr>
<td width="50%" valign="top">

**En ligne : [bpmn.leylines.fr](https://bpmn.leylines.fr)**

Rien à installer, aucun compte : ouvrez le lien et dessinez. Le co-pilote IA marche avec votre propre
clé API, et vos diagrammes restent dans votre navigateur. [En savoir plus](#lutiliser-en-ligne)

</td>
<td width="50%" valign="top">

**En Docker : `ghcr.io/leylines-prism/bpmn-pilot`**

Chez vous, sur votre machine ou votre serveur, avec le serveur MCP qui relie vos agents
(Claude Code, Claude Desktop, GitHub Copilot) à l'éditeur. [Le lancer](#le-lancer-avec-docker)

</td>
</tr>
</table>

**Pour dessiner, rien de plus.** La palette, le menu contextuel et le co-pilote IA suffisent pour un
schéma de processus lisible, sans connaître BPMN. Viennent ensuite :

**Présentation** (bouton de la barre d'outils) : le schéma seul, en plein écran et en lecture, pour dérouler
un processus en réunion. Le menu Pointeur cumule un pointeur laser, la surbrillance de l'élément survolé et de ses flux,
une onde au clic et un curseur masqué à l'arrêt (touches 1 à 4). En mode Expert, la simulation de jetons s'y lance aussi.

**Documentation des éléments** : saisie en Markdown avec aperçu immédiat, modèles par type d'élément, dictée sur
l'appareil, ou première version rédigée par le co-pilote IA d'après le diagramme. Des pastilles signalent les éléments
documentés avec un aperçu au survol, la recherche porte aussi sur la documentation, un clic en présentation affiche la
fiche de l'élément, et le menu Exporter produit des fiches de procédure (PDF ou Markdown), une par activité dans l'ordre
du flux (voir l'[aide](https://bpmn.leylines.fr/aide.html#documenter)).

**Contrôles à chaque réponse du co-pilote** : critique de la demande avant le dessin (ambiguïtés,
manques), puis six contrôles (XML, métamodèle BPMN 2.0, références et portées, DI, réimport,
bpmnlint), avec autocorrection.

**Mode Expert, pour éprouver un modèle.** Rien de ce qui suit n'est nécessaire pour dessiner. Le bouton
**Expert** de la barre l'active, et **Choisir les modules…** n'allume que les fonctions dont vous vous
servez : l'éditeur reste sobre pour les autres (voir la
[section dédiée de l'aide](https://bpmn.leylines.fr/aide.html#experts-bpmn)) :

- **Simulation de jetons avec carte de chaleur** : autant d'instances que vous voulez, calculées d'un
  coup selon les probabilités des branches, pour voir les chemins empruntés, jamais atteints ou parcourus en boucle.
- **Objectifs du processus** posés sur les fins et les activités (au moins 80 % de demandes acceptées, au plus
  15 reprises pour 100), confrontés à la simulation de jetons dans le rapport.
- **Rapport de processus** en PDF, en Markdown ou en Word : chiffres clés, constats par niveau, axes
  d'amélioration, événements de fin, activités par couloir, matrice RACI.
- **Analyse d'un journal d'événements (process mining)** : chargez un export CSV ou XES de votre ERP,
  CRM ou outil de tickets et voyez sur le diagramme ce qui se passe vraiment : passages, attentes et
  durées, goulets d'étranglement, dossiers qui s'écartent du modèle. Le journal est lu dans le
  navigateur et n'est envoyé nulle part. Sans diagramme, tirez du journal une première version du
  processus. Un exemple fictif de 412 commandes est fourni.
- **Potentiel d'IA par activité** : automatisable, assistée par IA ou humaine, avec la raison et le
  garde-fou, noté par le co-pilote ou à la main, et repris dans le rapport.
- **Risques, contrôles et conformité** : risques et contrôles de chaque activité, références
  réglementaires (RGPD, ISO 9001, AI Act…), et une fiche d'identité du processus (propriétaire, version,
  statut, périmètre) en tête du rapport et des fiches de procédure. Le rapport ajoute un tableau des
  risques et contrôles et une matrice de conformité.
- **Récits utilisateur et critères d'acceptation** de chaque activité, rédigés à la main ou par le
  co-pilote, exportés en carnet Markdown pour un outil de suivi.
- **BPMN pour Camunda 8 ou 7** : plateforme indiquée, processus exécutable, conditions des passerelles
  en FEEL ou en JUEL, tâches utilisateur avec leur personne assignée.
- **Tables de décision DMN** : chaque tâche de règle métier se relie à une
  table de décision modifiable et à son diagramme d'exigences (dmn-js), rangées dans le .bpmn avec le lien Camunda 8
  (`zeebe:calledDecision`), contrôlées (chevauchements, valeurs non couvertes), et rédigées par le co-pilote ou un agent MCP à la demande.
- **Formulaires des tâches** : chaque tâche utilisateur ou événement de début reçoit un formulaire form-js, rangé
  dans le .bpmn avec le lien Camunda 8 (`zeebe:formDefinition`), un contrôle que chaque branche lit une donnée
  remplie par un formulaire, et les formulaires remplis pendant la simulation de jetons, où les réponses choisissent la branche.

Sur un processus d'achat interne à quatre couloirs :

<table>
<tr>
<th width="50%">Mode Présentation</th>
<th width="50%">Simulation de jetons</th>
</tr>
<tr>
<td><img src="docs/presentation.fr.gif" alt="Le processus d'achat en mode Présentation : zoom, déplacement, ajustement, puis un jeton à 2×" width="100%"></td>
<td><img src="docs/token-simulation.fr.gif" alt="Un jeton parcourt le processus d'achat, à 0,5× puis à 3×" width="100%"></td>
</tr>
<tr>
<th width="50%">Carte de chaleur</th>
<th width="50%">Rapport de processus</th>
</tr>
<tr>
<td><img src="docs/heatmap.fr.gif" alt="La probabilité d'une branche dans le panneau Processus, puis la carte de chaleur après 200 jetons" width="100%"></td>
<td><img src="docs/process-report.fr.gif" alt="Le rapport de processus en PDF depuis le menu Expert, puis ses quatre pages" width="100%"></td>
</tr>
</table>

BPMN 2.0 est la norme internationale ISO/IEC 19510,
publiée par l'OMG. Un diagramme fait ici se lit de la même façon dans tout éditeur ou moteur conforme,
et le fichier .bpmn s'y ouvre.

<details>
<summary><b>Pourquoi BPMN plutôt qu'un logigramme ?</b></summary>

Les outils de dessin généralistes comme draw.io, Lucidchart ou Visio tracent des boîtes et des flèches.
Une forme veut dire ce que son auteur a voulu dire, et chaque équipe invente ses conventions. BPMN donne
à chaque symbole un sens défini :

- **Qui fait quoi** : des pools pour les organisations, des couloirs pour les rôles, des flux de messages
  pour ce qu'ils échangent.
- **Ce qui déclenche et ce qui attend** : événements de début, minuteur, message et erreur, et
  événements accrochés à une tâche pour les délais et les exceptions.
- **Comment les chemins se séparent et se rejoignent** : passerelles exclusive (une seule branche),
  parallèle (toutes) et inclusive (certaines), chacune avec sa règle.
- **Un fichier que les outils comprennent** : le .bpmn décrit le processus lui-même, pas son
  image. Il se vérifie, se simule, devient un rapport, se lit et s'écrit par un agent IA, et
  s'exécute dans un moteur de workflow. Une image de logigramme ne permet rien de tout cela.
- **Pas d'enfermement** : le même fichier s'ouvre dans tout éditeur conforme, aujourd'hui comme dans dix
  ans.

</details>

> [!TIP]
> **La version en ligne, [bpmn.leylines.fr](https://bpmn.leylines.fr), s'utilise telle quelle, sans risque.**
> Ce ne sont que des fichiers statiques servis par GitHub Pages : aucun serveur applicatif, aucun compte,
> aucune base de données derrière.
>
> - **Vos diagrammes restent dans votre navigateur.** Ils sont enregistrés dans le stockage du
>   navigateur, et les fichiers que vous ouvrez ou téléchargez ne quittent jamais votre ordinateur.
> - **Vos clés API aussi.** Elles ne sont envoyées qu'au fournisseur d'IA que vous avez choisi,
>   directement depuis votre navigateur, jamais à un serveur de ce projet.
> - **Quand vous utilisez le co-pilote**, votre message et le diagramme partent directement chez ce
>   fournisseur, selon ses propres conditions. Aucun intermédiaire.
> - **La seule autre requête** est une mesure d'audience sans cookie, qui ne contient jamais de
>   diagramme, de message ni de clé.
>
> Prenez tout de même une clé API réservée à cet éditeur, qui expire d'elle-même et dont la dépense est
> plafonnée. Ce qui est protégé, ce qui ne l'est pas et comment le vérifier vous-même :
> [Vos données et vos clés API dans la version en ligne](docs/online-privacy.fr.md).

La connexion MCP va plus loin que le dessin à l'écran. Un agent apporte sa mémoire, son contexte et tout
ce à quoi il est connecté, et intègre des diagrammes BPMN à ses propres workflows :

- il charge un diagramme en XML BPMN, ou le dessine ;
- il le vérifie selon les règles BPMN ;
- il le récupère en XML BPMN ou en image PNG, ou l'exporte en fichier BPMN, SVG, PNG ou PDF (dans le dossier
  exports du serveur en version Docker, renvoyé à l'agent en ligne), pour l'étape suivante : un document,
  un ticket, un dépôt.

Les outils s'exécutent dans un onglet de l'éditeur, qui doit seulement rester ouvert.

> [!WARNING]
> **Version Docker seulement : pas faite pour être exposée sur internet, par conception.** Cela
> concerne la copie que vous faites tourner, pas la version en ligne ci-dessus. Prévue pour votre
> machine ou un réseau privé, la version Docker n'a pas d'identification. Le risque reste limité,
> mais la publier revient à ouvrir à tous un service sans authentification : vos clés API peuvent
> être utilisées ou volées, et les diagrammes stockés dans le conteneur (les fichiers BPMN de « Mes
> diagrammes ») peuvent être lus ou supprimés. Par défaut, elle ne répond que sur cette machine
> (`127.0.0.1`). Si vous la mettez quand même sur internet, c'est à vos risques.

## L'utiliser en ligne

L'éditeur est ouvert à tous sur https://bpmn.leylines.fr (GitHub Pages) : sans compte, sans
installation, juste un navigateur. Son [guide d'utilisation](https://bpmn.leylines.fr/aide.html)
explique comment dessiner, enregistrer, exporter et se servir du co-pilote IA. Le bouton Aide (?) de
la barre d'outils l'ouvre aussi.

Il suit les versions publiées (le dernier tag `vX.Y.Z`) et affiche sa version en bas à gauche
du canevas et du guide d'utilisation.

Pour le co-pilote IA, chaque visiteur saisit sa propre clé API, qui reste dans son navigateur. Par
rapport à la version Docker, pas d'enregistrement sur un serveur ni de mode sans écran, et
certains fournisseurs (OpenAI) refusent les appels depuis une page web. Le lien « Confidentialité » de la page
dit ce qui sort du navigateur, et
[Vos données et vos clés API dans la version en ligne](docs/online-privacy.fr.md) donne le détail.

### Connecter un agent à la version en ligne

Un agent installé sur votre ordinateur pilote l'éditeur en ligne par un petit relais local,
`bpmn-pilot-mcp`, que l'agent lance lui-même. Le relais ne fait que passer les messages entre l'agent
et l'onglet, sur `127.0.0.1` : le diagramme ne passe par aucun autre serveur, et le relais n'écrit rien
sur le disque.

1. Installez le relais dans votre agent :
   - **Claude Desktop** : téléchargez `bpmn-pilot.mcpb` dans la [dernière version publiée](https://github.com/Leylines-Prism/bpmn-pilot/releases/latest)
     et double-cliquez dessus. Claude Desktop fait tourner le relais lui-même : pas de Node.js à installer.
   - **Claude Code** : `claude mcp add bpmn-pilot -- npx -y bpmn-pilot-mcp`
   - **Cursor, VS Code et les autres clients MCP** : `{ "command": "npx", "args": ["-y", "bpmn-pilot-mcp"] }`
     dans leurs réglages MCP (Node.js 20 ou plus).
2. Dans l'éditeur, cliquez sur **MCP** dans la barre d'outils et activez **Agent local**. Jusque-là, la
   page n'ouvre aucune connexion vers votre ordinateur. Chrome et Edge demandent une fois d'autoriser
   l'accès au réseau local : acceptez.
3. Demandez à votre agent : « Décris le diagramme ouvert dans BPMN Pilot. »

L'agent a les mêmes outils et les mêmes prompts qu'avec la version Docker. Un export revient à l'agent,
ou attend dans la page derrière le bouton Télécharger. Safari bloque la connexion d'une page HTTPS vers
l'ordinateur : utilisez Chrome, Edge ou Firefox. Détails dans [relay/README.md](relay/README.md).

La page stable compte son audience de façon anonyme, sans cookie :
visites (pages d'aide comprises), provenance, version de l'app et usage de chaque fonction (diagramme créé, ouvert
ou exporté, mode Expert, installation et ouverture en PWA, simulation, carte de chaleur, analyse de journal, mise en page, comparaison, co-pilote ouvert ou utilisé,
fournisseur connecté, types de fichiers joints, classes d'erreur, Votre avis, exemples de prompts copiés, liens
GitHub et de soutien, temps actif par tranche). Aucun script tiers n'est chargé : la page envoie
elle-même ces événements ([src/analytics.js](src/analytics.js)), jamais le contenu des diagrammes, des
messages ni les clés API. « Do Not Track » et « Global Privacy Control » coupent ce comptage, et un
indicateur dans le stockage du navigateur exclut vos propres visites. Ni l'image Docker ni `npm run dev`
n'envoient quoi que ce soit. Le réglage suit les [recommandations de la CNIL](https://www.cnil.fr/fr/cookies-solutions-pour-les-outils-de-mesure-daudience) pour les mesures d'audience
exemptées de consentement.

### L'installer sur votre poste (PWA)

La version en ligne est une PWA (Progressive Web App), avec un manifeste d'application web. Chrome
et Edge (ordinateur et Android) proposent de l'installer : bouton Installer de la barre d'outils, ou icône à droite de la barre d'adresse. Sur iPhone et iPad :
Partager, Sur l'écran d'accueil. Dans Safari sur Mac : Fichier, Ajouter au Dock. Firefox sur
ordinateur ne prend pas en charge l'installation des PWA. La PWA s'ouvre dans sa propre fenêtre.

Après une première visite, l'éditeur et son guide fonctionnent aussi hors connexion, installés ou
non : un service worker ([src/pwa/sw.js](src/pwa/sw.js)) met en cache les fichiers du site
(Cache API). Il ne traite que les requêtes vers le site lui-même : les appels aux fournisseurs
d'IA et la mesure d'audience ne passent jamais par lui. Le co-pilote IA a besoin du réseau pour
joindre son fournisseur. Une nouvelle version s'annonce par un bandeau avec un bouton Recharger :
rien ne se recharge tout seul. Sur iPhone et iPad, la PWA installée a son propre stockage
(localStorage et IndexedDB), séparé de Safari : pour passer un diagramme de l'un à l'autre, passez par un fichier .bpmn.

## Le lancer avec Docker

Il faut [Docker](https://docs.docker.com/get-docker/) avec Docker Compose. Deux images sont publiées
sur le GitHub Container Registry, pour amd64 et arm64 :

- `ghcr.io/leylines-prism/bpmn-pilot` : l'éditeur.
- `ghcr.io/leylines-prism/bpmn-pilot-mcp` : son serveur (co-pilote IA, MCP pour les agents,
  « Mes diagrammes »).

### En ligne de commande

```
mkdir bpmn-pilot && cd bpmn-pilot
curl -fsSLO https://raw.githubusercontent.com/Leylines-Prism/bpmn-pilot/main/docker-compose.image.yml
docker compose -f docker-compose.image.yml up -d
```

Puis ouvrir http://localhost:8080. Sans `curl`, `wget https://raw.githubusercontent.com/Leylines-Prism/bpmn-pilot/main/docker-compose.image.yml` fait la même chose.

- **Co-pilote IA** : créez un fichier `.env` dans le même dossier avec votre clé API (Anthropic,
  OpenAI, Mistral, ou un Ollama local), par exemple `ANTHROPIC_API_KEY=sk-ant-...`, puis relancez la
  commande `up -d`. Toutes les variables sont listées dans [mcp/.env.example](mcp/.env.example).
  Une clé peut aussi se saisir dans la fenêtre Options du co-pilote. Sans clé, l'éditeur marche ;
  seul le co-pilote est éteint.
- **Vos fichiers** (Mes diagrammes sur le serveur, exports) sont dans le dossier `bpmn-data`, à côté
  de `docker-compose.image.yml` : voir [Vos fichiers](#vos-fichiers-version-docker).
- **Page vitrine** : le logo de la barre d'outils ouvre une page vitrine, avec le logo et les fonds
  d'écran de l'auteur. Pour la couper, ajoutez `SHOWCASE=off` au fichier `.env` (ou aux variables
  d'environnement de la pile), puis relancez la commande `up -d`. Le logo ouvre alors la fenêtre
  « Votre avis ».
- **Mise à jour** : téléchargez de nouveau `docker-compose.image.yml` avec la même commande `curl`,
  pour avoir aussi les nouveaux services et réglages (votre fichier `.env` et le dossier `bpmn-data`
  restent tels quels). Pour rester sur une version donnée, changez plutôt le numéro de version des
  trois lignes d'image (voir les [versions](https://github.com/Leylines-Prism/bpmn-pilot/tags)). Le tag
  `edge` suit la branche de développement (`main`) à chaque modification : utile pour les essais, pas
  pour l'usage courant. Puis :

  ```
  docker compose -f docker-compose.image.yml pull
  docker compose -f docker-compose.image.yml up -d
  ```

### Avec un gestionnaire de conteneurs

Dans un outil qui déploie des piles Compose (Portainer, par exemple), créez une pile, collez-y le
contenu de [docker-compose.image.yml](docker-compose.image.yml), et saisissez les réglages ci-dessous
(`ANTHROPIC_API_KEY`…) comme variables d'environnement de la pile. Réglez `BPMN_DATA_DIR` sur un chemin
absolu de la machine hôte : le dossier où vous retrouverez vos fichiers.

### Depuis le code source

Pour modifier le code, ou construire les images vous-même :

```
git clone https://github.com/Leylines-Prism/bpmn-pilot.git
cd bpmn-pilot
docker compose up -d --build
```

Les clés API vont alors dans `mcp/.env` (copie de `mcp/.env.example`), les autres réglages dans
un fichier `.env` à côté de `docker-compose.yml`. **Mise à jour** : `git pull`, puis
`docker compose up -d --build`.

### L'installer sur votre poste (PWA)

Sur `http://localhost:8080`, Chrome et Edge proposent d'installer l'éditeur en PWA
(icône dans la barre d'adresse, ou menu > Installer). Il s'ouvre dans sa propre fenêtre, que l'on
garde ouverte pour qu'un agent y dessine. Les navigateurs ne proposent l'installation qu'en HTTPS ou
sur localhost : depuis une autre machine, passez par une adresse HTTPS (voir
[Le joindre depuis d'autres machines](#le-joindre-depuis-dautres-machines)). La version Docker n'a
pas de service worker et ne fonctionne pas hors ligne : le Co-pilote IA, le serveur MCP et les diagrammes enregistrés ont besoin
du serveur.

## Vos fichiers (version Docker)

Tout ce que garde le serveur est dans un seul dossier, `bpmn-data`, à côté du fichier compose.
Ouvrez-le avec votre explorateur de fichiers pour récupérer vos fichiers :

- `bpmn-data/diagrams` : les diagrammes enregistrés sur le serveur avec « Mes diagrammes », un
  fichier `.bpmn` par diagramme, à son nom (`Mon processus.bpmn`). Renommer un diagramme dans
  l'éditeur renomme son fichier. Deux diagrammes de même nom donnent `Mon processus.bpmn` et
  `Mon processus (2).bpmn`. Le fichier caché `.index.json` relie les fichiers à l'éditeur : laissez-le
  en place. Un fichier `.bpmn` copié dans ce dossier apparaît dans Mes diagrammes, sous son nom de
  fichier (10 Mo au plus).
- `bpmn-data/exports` : les exports (.bpmn, .xml, SVG, PNG, PDF), quand la **Destination** en haut du
  menu Exporter est « Serveur » ou « Les deux ». « Téléchargement », le choix par défaut, les télécharge
  seulement dans le navigateur, comme avant. Un export ne remplace jamais un fichier : un deuxième `Mon processus.pdf`
  devient `Mon processus (2).pdf`. « Code XML à copier » et « Imprimer » ne créent pas de fichier et
  ne sont pas concernés.

Où est le dossier :

- Il est créé au premier démarrage, à côté du fichier compose, sous Docker Desktop (Windows, macOS)
  comme sous Linux. Un court service `data-init` le prépare avant le serveur (crée `diagrams/` et
  `exports/`, les donne à l'utilisateur du serveur), puis s'arrête : son état « Exited (0) » est
  normal.
- **Linux** : le serveur tourne sous l'utilisateur 1000, sans root, pour que les fichiers vous
  appartiennent. Si `id -u` et `id -g` donnent d'autres nombres, ajoutez `PUID=` et `PGID=` avec ces
  nombres au fichier `.env`. Si le serveur ne peut toujours pas écrire dans le dossier, il le dit dans
  son journal au démarrage (`docker compose logs mcp`) et dans l'erreur de l'export, avec le dossier
  en cause.
- **Ailleurs** : réglez `BPMN_DATA_DIR` sur le chemin d'un autre dossier. Dans un outil de gestion de
  conteneurs, donnez toujours un chemin absolu, et collez le dernier `docker-compose.image.yml` : une
  copie plus ancienne n'a pas le service `data-init`.
- **SELinux** (Fedora, RHEL…) : si l'accès est refusé au serveur malgré le bon propriétaire, ajoutez
  `:z` après le montage (`${BPMN_DATA_DIR:-./bpmn-data}:/data:z`), seulement pour un dossier réservé à
  BPMN Pilot.

Sécurité : les fichiers ne sont lisibles que par leur propriétaire et son groupe (0640, dossiers 0750).
Le serveur tourne sur un système de fichiers en lecture seule, sauf ce dossier, sans aucune capacité
Linux et sans élévation de privilèges. Il n'accepte que les cinq formats d'export, vérifie que chaque
fichier correspond à son format, prend 20 Mo au plus par export et nettoie les noms de fichiers (pas
de dossier, pas de fichier caché, pas de nom réservé par Windows).

## En cas de problème (version Docker)

- **Le journal du serveur** dit ce qu'il ne peut pas faire au démarrage :
  `docker compose -f docker-compose.image.yml logs mcp` (sans `-f …` depuis le code source, ou le
  journal du conteneur dans votre outil de gestion de conteneurs).
- **Un export vers le serveur, ou un enregistrement dans Mes diagrammes, échoue** : le serveur ne
  peut pas écrire dans son dossier de données, et l'erreur le nomme. Le service `data-init` prépare ce
  dossier à chaque démarrage ; si l'erreur reste, le dossier appartient à un autre utilisateur que
  `PUID`:`PGID` (1000:1000 par défaut).
- **Un agent reçoit une erreur 401 « MCP is closed »** : l'éditeur est servi sous un autre nom que
  localhost sans `MCP_TOKEN`. Réglez le jeton (voir [Le joindre depuis d'autres machines](#le-joindre-depuis-dautres-machines)).
- **Que sait faire mon modèle ?** `docker compose -f docker-compose.image.yml exec mcp node mcp/check-providers.js`
  essaie chaque modèle réglé sur le serveur avec de vrais appels : réponse, appel d'outil, image, PDF.
  Elle distingue une erreur de réglage (clé, adresse, nom du modèle, refus du fournisseur) d'une limite
  du modèle (pas d'appel d'outil, pas de vision, pas de PDF), pour quelques centaines de jetons par
  modèle. Elle ne couvre pas les fournisseurs saisis dans la fenêtre Options, qui restent dans le navigateur.

## Fournisseurs d'IA : vos essais sont les bienvenus

Anthropic (Claude Opus, Sonnet et Haiku 5.5) est vérifié avec de vrais appels : réponse, appels
d'outils, images et PDF. OpenAI, Mistral, xAI, Ollama et les serveurs compatibles OpenAI suivent leurs
API publiées, mais les mainteneurs n'ont pas de clé pour les vérifier. Si vous en utilisez un, un court
retour aide beaucoup : lancez la commande de vérification (voir [En cas de problème](#en-cas-de-problème-version-docker)),
puis ouvrez une issue avec le formulaire [AI provider test report](https://github.com/Leylines-Prism/bpmn-pilot/issues/new?template=provider_test.yml).
Ne collez jamais de clé.

## Le joindre depuis d'autres machines

Le conteneur sert du HTTP simple sur `127.0.0.1:8080`, pour cette machine seulement. Pour l'utiliser
depuis vos autres appareils, gardez-le sur un réseau privé : [Tailscale Serve](https://tailscale.com/kb/1312/serve),
par exemple, lui donne une adresse HTTPS que seules les machines de votre tailnet peuvent joindre.
Donnez ensuite son nouveau nom à l'éditeur, dans le fichier `.env` à côté du fichier Compose, et
ajoutez un jeton `MCP_TOKEN=...` (la fenêtre « Connecter un agent » en génère un ; depuis le code
source, il va dans `mcp/.env`). Le jeton est obligatoire ici : dès que `MCP_ALLOWED_HOSTS` contient un
autre nom que localhost, `/mcp` répond 401 tant que `MCP_TOKEN` n'est pas réglé. `MCP_AUTH=off`
l'ouvre sans jeton, pour un réseau de confiance ou derrière un proxy qui authentifie déjà `/mcp` :

```
BPMN_EDITOR_ORIGINS=https://bpmn.example.com
MCP_ALLOWED_HOSTS=bpmn.example.com
```

Relancez `docker compose up -d`. D'autres proxys marchent aussi : ils doivent transmettre l'en-tête
`Host` et accepter le WebSocket sur `/bridge` (détails dans
[mcp/README.fr.md](mcp/README.fr.md#derrière-un-nom-de-domaine)).

### Sur internet, à vos propres risques

Ce projet n'est ni conçu ni testé pour être exposé sur internet, et n'offre aucune garantie si vous
le faites. Si vous le choisissez quand même, placez une connexion devant les pages et réglez le
jeton. Voici un exemple avec [Caddy](https://caddyserver.com/), qui obtient tout seul le certificat
de votre domaine. Faites pointer le DNS du domaine vers la machine, réglez les deux variables et le
jeton ci-dessus, puis utilisez ce `Caddyfile` :

```
bpmn.example.com {
	# Une connexion pour les pages. /mcp en est exclu : les agents utilisent MCP_TOKEN.
	@pages not path /mcp
	basic_auth @pages {
		alice <empreinte donnée par : caddy hash-password>
	}
	reverse_proxy 127.0.0.1:8080
}
```

Sans connexion au proxy, quiconque trouve l'adresse peut utiliser l'éditeur et vos clés API. Une
connexion et un jeton réduisent le risque, ils ne le suppriment pas. [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
avec Cloudflare Access est une autre façon de placer une connexion devant, sans port ouvert.

## Connecter un agent (MCP)

Cliquez sur le badge **MCP** de la barre d'outils. La fenêtre « Connecter un agent » donne l'adresse à
utiliser (`http://localhost:8080/mcp`, ou `https://votre-domaine/mcp`), et le réglage à coller pour
Claude Code, Claude Desktop, GitHub Copilot dans VS Code, Cursor ou un autre client MCP. L'agent dessine dans le dernier onglet de l'éditeur
utilisé : gardez-le ouvert.

L'agent lit et dessine le diagramme, le range (`layout_diagram`), déplace ou duplique des formes
précises (`move_elements`, `duplicate_elements`), et reprend un appel raté avec `undo` et `redo`, comme
Ctrl+Z et Ctrl+Y. Il remplit les champs experts (RACI, potentiel d'IA, risques et contrôles, récits utilisateur,
fiche d'identité du processus), et `export_diagram` produit tous les fichiers du menu Exporter : rapport, fiches
de procédure, page de documentation HTML, matrice RACI, récits utilisateur, décisions et BPMN pour Camunda. Douze
prompts MCP, dont cinq pour le mode Expert, sont prêts à choisir dans l'agent. La liste complète des outils est dans [mcp/README.fr.md](mcp/README.fr.md).

Un jeton protège cet accès : la même fenêtre en génère un et dit où le mettre. Il est facultatif
sur `localhost`, et obligatoire dès que l'éditeur est servi sous un autre nom (voir
[Le joindre depuis d'autres machines](#le-joindre-depuis-dautres-machines)). Sans lui, la fenêtre
indique que MCP est fermé, et l'agent reçoit une erreur 401 qui nomme `MCP_TOKEN`.

### Sans navigateur ouvert (mode sans écran)

Un mode avancé, facultatif, coupé par défaut. L'agent dessine, contrôle, exporte et lit le rapport
sans qu'aucun onglet de l'éditeur soit ouvert : utile pour un agent qui modélise en série les
processus décrits dans vos documents, puis vous en remet le résultat à relire.

Pour l'activer, utilisez [`docker-compose.headless.yml`](docker-compose.headless.yml) à la place de
`docker-compose.image.yml`. C'est le même fichier avec un quatrième service, `renderer` : un Chromium
sans écran (image `bpmn-pilot-renderer`, environ 160 Mo à télécharger) que le serveur pilote par le
protocole DevTools. Même `.env`, même dossier de données.

```bash
docker compose -f docker-compose.headless.yml up -d
```

Fonctionnement :

- Quand un agent appelle un outil et qu'aucun onglet de l'éditeur n'est relié, le serveur ouvre
  l'éditeur dans un onglet invisible de `renderer`. Tous les outils y marchent comme dans un vrai
  onglet, images et PDF compris. L'onglet se ferme après `HEADLESS_IDLE_SECONDS` sans appel (300 par
  défaut).
- Chaque diagramme ainsi dessiné est enregistré dans Mes diagrammes sur le serveur
  (`bpmn-data/diagrams`), sous un nom comme `Agent 2026-11-28 14h05`. Rien ne reste seulement en
  mémoire.
- Un onglet ouvert passe toujours en premier. Mais une série d'appels commencée sans onglet reste dans
  l'onglet invisible, même si vous ouvrez l'éditeur entre-temps : l'agent ne bascule jamais de
  lui-même sur le diagramme que vous avez sous les yeux. Un bandeau en haut du canevas annonce le
  diagramme de l'agent, et **Ouvrir** le charge dans votre onglet : les appels suivants de l'agent y
  arrivent alors. Rien n'est fusionné : si votre diagramme a des modifications non enregistrées,
  l'éditeur demande d'abord.
- Avec `returnFile`, `export_diagram` renvoie le fichier à l'agent (PNG en image, SVG et BPMN en texte,
  PDF en ressource intégrée), avec ou sans onglet ouvert.

Sécurité : `renderer` est sur un réseau Docker interne sans accès à Internet, ne publie aucun port, et
ne voit ni les clés API ni le dossier de données. Il n'ouvre que l'éditeur du même fichier compose.
Chromium tourne sous un utilisateur sans droits root, sans capacité Linux et sur un système de
fichiers en lecture seule. Il prend 300 à 600 Mo de mémoire tant qu'un onglet est ouvert (plafond
`HEADLESS_MEMORY`, 1 Go par défaut). Les règles du jeton MCP ci-dessus s'appliquent toujours.

Le conteneur surveille Chromium : si son interface DevTools ne répond pas dans les 30 secondes qui
suivent le démarrage, ou cesse de répondre, le conteneur s'arrête et Docker le relance. Le service
`mcp` démarre une fois `renderer` déclaré sain.

Vérification : `docker compose -f docker-compose.headless.yml exec mcp wget -qO- http://localhost:3333/healthz/headless`
répond `"browser": true` quand le serveur joint Chromium.

## Où sont gardées vos clés API

**Dans la version Docker**, le plus sûr est le serveur : le fichier `.env` à côté de
`docker-compose.image.yml` (ou `mcp/.env` depuis le code source). La clé reste sur le serveur et
n'arrive jamais au navigateur. Une clé saisie dans la fenêtre Options du co-pilote est gardée dans le
navigateur comme ci-dessous, puis envoyée à chaque message à votre serveur, qui la transmet au
fournisseur sans l'enregistrer.

**Dans le navigateur** (la version en ligne, ou les clés saisies dans Options) :

- La clé reste dans votre navigateur, pour ce site seulement. Les autres sites ne peuvent pas la lire.
- « Se souvenir des clés API sur votre appareil » décoché (par défaut) : la clé est gardée dans le
  `sessionStorage` et disparaît à la fermeture de l'onglet.
- Coché : la clé est gardée dans le `localStorage` et reste sur l'appareil jusqu'au clic sur
  « Effacer les clés API ».
- Elle n'est pas chiffrée. La chiffrer dans le navigateur ne servirait à rien : la clé pour la
  déchiffrer devrait être rangée juste à côté.
- Ce qui la protège : la page n'exécute aucun script venu d'un autre site (politique de sécurité du
  contenu, CSP), et la clé ne part que vers le fournisseur choisi.
- La limite : une extension de navigateur malveillante, ou quelqu'un qui utilise votre session sur
  l'ordinateur, peut la lire. Sur un ordinateur partagé, laissez la case décochée.

## Réglages

Tous facultatifs. Avec les images publiées, mettez-les tous dans le fichier `.env` à côté de
`docker-compose.image.yml`, ou dans les variables d'environnement de la pile, puis relancez la
commande `up -d`. Depuis le code source, mettez-les dans un fichier `.env` à côté de
`docker-compose.yml` (git l'ignore), sauf si le tableau indique `mcp/.env`, puis lancez
`docker compose up -d --build`.

| Réglage | Rôle |
|---|---|
| `MISTRAL_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`… (`mcp/.env`) | Clés API du co-pilote IA. Voir `mcp/.env.example`. |
| `MCP_TOKEN` (`mcp/.env`) | Jeton que les agents doivent envoyer. La fenêtre « Connecter un agent » en génère un. Obligatoire quand `MCP_ALLOWED_HOSTS` contient un autre nom que localhost. |
| `MCP_AUTH` (`mcp/.env`) | `off` ouvre `/mcp` sans jeton sous un autre nom que localhost. Seulement sur un réseau de confiance, ou derrière un proxy qui authentifie `/mcp`. |
| `BPMN_PORT` | Port du site (8080 par défaut). |
| `BPMN_EDITOR_ORIGINS`, `MCP_ALLOWED_HOSTS` | L'adresse et le nom du site quand il est servi sous un nom de domaine (voir plus haut). |
| `BPMN_BIND` | Interface réseau où le site écoute (`127.0.0.1` par défaut). `0.0.0.0` l'ouvre à votre réseau, sans HTTPS. |
| `BPMN_DATA_DIR` | Dossier des fichiers du serveur, Mes diagrammes et exports (`./bpmn-data` par défaut). Dans un outil de gestion de conteneurs, un chemin absolu. |
| `PUID`, `PGID` | Utilisateur et groupe du serveur, propriétaires du dossier de données (1000 par défaut). |
| `SHOWCASE` | `off` coupe la page vitrine (`about.html`) et ses fonds d'écran. Le logo de la barre d'outils ouvre alors la fenêtre « Votre avis ». `on` par défaut. |
| `MCP_HEADLESS` (`mcp/.env`) | `on` active le [mode sans écran](#sans-navigateur-ouvert-mode-sans-écran). Coupé par défaut ; `docker-compose.headless.yml` le règle. `HEADLESS_BROWSER_URL` (`http://renderer:9222`) et `HEADLESS_EDITOR_URL` (`http://editor:8080`) ne changent que pour un montage sur mesure. |
| `HEADLESS_IDLE_SECONDS`, `HEADLESS_MEMORY` | Mode sans écran : secondes sans appel avant la fermeture de l'onglet invisible (300), plafond de mémoire de `renderer` (`1g`). |

## Ce que fait l'éditeur

### Pour tous

- **Fichiers** : nom, nouveau, ouvrir (fichier, XML collé, ou glisser-déposer), exporter (.bpmn,
  .xml, SVG, PNG, PDF, fichier .bpmn chiffré par mot de passe), copier en image, imprimer le diagramme seul, sur une page. Le diagramme en
  cours est restauré quand vous revenez.
- **Mes diagrammes** : enregistrer plusieurs diagrammes, les rouvrir, renommer, supprimer. Ctrl+S
  enregistre.
- **Carte à plusieurs niveaux** : une activité d'appel se lie au diagramme de Mes diagrammes qui la
  détaille. Un clic y descend, et un fil d'Ariane fait remonter, en mode Présentation aussi.
- **Sans IA** : construire un processus depuis un tableau d'étapes (collé depuis Excel, .csv ou .xlsx,
  colonnes de Visio Data Visualizer lues telles quelles), depuis une grille rôles × tâches en atelier, ou
  depuis un flowchart Mermaid (collé, ou fichier .mmd ou .md). Exporter > Code Mermaid rend le diagramme
  en flowchart, pour un README ou un wiki.
- **Responsabilités** : personne assignée, systèmes utilisés et RACI de chaque activité, conditions en
  clair sur les branches des décisions. Fiches de procédure en PDF, Markdown ou Word, matrice RACI en Excel,
  et une page de documentation HTML en un seul fichier : le diagramme en lecture seule, où un clic sur un
  élément ouvre sa fiche.
- **Dessin** : palette, menu contextuel, copier-coller, boutons Annuler et Rétablir, rangement,
  vérification des règles BPMN, grille, mini-carte, et le panneau Processus
  pour les propriétés de chaque élément.
- **Étapes d'agent IA** : un sous-processus ad hoc marqué comme agent IA, avec ses outils à l'intérieur, une revue
  humaine après lui et une sortie si l'agent échoue. La vérification signale une revue ou une sortie absente, et un clic complète le motif.
- **Comparer** : deux versions côte à côte, avec en couleur ce qui a été ajouté, supprimé ou modifié,
  et la liste des différences, depuis un fichier .bpmn ou depuis l'avant de la réponse de l'IA.
- **Couleurs et texte** : n'importe quelle couleur de fond, de contour ou de texte, dans des palettes
  toutes prêtes ou le sélecteur de couleur du système, et la mise en forme du texte (gras, italique,
  souligné, taille, police, « Auto » pour un texte lisible sur les fonds sombres). Le panneau
  Processus copie un style sur d'autres éléments et reprend d'un clic ceux déjà dans le diagramme.
- **Co-pilote IA** : décrivez un processus et il le dessine, dans votre langue. Vous pouvez coller ou
  déposer des images, des PDF, des documents bureautiques (Word, Excel, PowerPoint, OpenDocument) et
  des fichiers texte (CSV, JSON, XML, Markdown…), dont le texte est lu dans le navigateur. On peut aussi dicter : la voix est reconnue sur l'appareil (Chrome, Edge 139+ ou Firefox 160+), sans que le son quitte le navigateur. Le modèle se choisit dans Options. Ce qu'il ajoute ou modifie est
  entouré sur le canevas, une pilule résume les changements, et un clic montre l'avant et l'après ou
  annule toute la réponse.
- **Interface** : thème clair ou sombre, anglais ou français, panneaux latéraux redimensionnables.
  Pensé pour un écran d'ordinateur : sur un téléphone, il sert surtout à regarder un diagramme.

### Mode Expert

Chaque fonction s'allume à part dans **Expert** > **Choisir les modules…**.

- **Simulation de jetons, carte de chaleur et rapport de processus** : faire
  circuler des jetons dans le processus, avec une glissière de vitesse. Pendant la simulation, colorer le diagramme selon
  le nombre de jetons passés par chaque élément, joués à la main ou calculés d'après les
  probabilités des branches. Exporter un rapport de processus (PDF, Markdown ou Word) : constats en trois
  niveaux, axes d'amélioration, séquence des éléments, matrice RACI et, après une simulation, carte de chaleur et
  objectifs du processus posés sur les fins et les activités, atteints ou non.
- **Process mining** : confronter un journal d'événements (CSV ou XES) au diagramme, appliquer les
  parts réelles des branches, trouver attentes, goulets et écarts, ou tirer le processus du journal.
- **Potentiel d'IA, risques et conformité** : pour chaque activité, son potentiel d'IA (automatisable, assistée
  par IA ou humaine, avec la raison et le garde-fou), ses risques et contrôles, et ses références réglementaires ;
  une fiche d'identité du processus (propriétaire, version, statut, date de validation, périmètre). Le rapport
  ajoute un tableau des risques et contrôles, une matrice de conformité et un constat pour chaque risque sans contrôle.
- **Récits utilisateur** : récits et critères d'acceptation (Étant donné, quand, alors) de chaque activité,
  rédigés par le co-pilote à la demande, exportés en Markdown, et repris dans le rapport, les fiches de
  procédure et la page de documentation.
- **Export pour Camunda 8 et 7** : plateforme indiquée, processus exécutables, conditions des passerelles en FEEL
  ou en JUEL tirées du champ Condition ou du libellé du flux, tâches assignées en tâches utilisateur.
- **Tables de décision DMN** : relier les tâches de règle métier à des tables de décision éditées avec dmn-js,
  avec le DRD, l'import et l'export .dmn, l'import et l'export Excel et CSV d'une table, les modèles de décision dans Mes diagrammes, `zeebe:calledDecision` pour Camunda 8,
  les contrôles des tables (chevauchements en politique Unique, valeurs non couvertes, textes sans guillemets), un banc d'essai
  (règles qui s'appliquent, un cas par règle), la comparaison de deux versions, des jetons calculés qui suivent les tables aux passerelles,
  et les outils MCP `get_decisions`, `set_decision_table`, `link_decision`, `test_decision`.
- **Formulaires des tâches** : formulaires des tâches utilisateur et des événements de début, édités avec form-js
  (palette, aperçu avec les données envoyées), import et export .form (un .zip quand il y en a plusieurs),
  `zeebe:formDefinition` pour Camunda 8, un contrôle des données (une passerelle ou une table de décision lit une
  variable qu'aucun formulaire placé avant ne remplit), des formulaires remplis pendant la simulation de jetons pour
  choisir les branches, et les outils MCP `get_task_forms`, `set_task_form`.

## En quoi il diffère de draw.io ou Lucidchart

Ils sont très bien pour dessiner à peu près tout, à plusieurs. Cet éditeur ne fait que du BPMN 2.0,
sur la base de [bpmn-js](https://github.com/bpmn-io/bpmn-js) : un diagramme y est un vrai modèle
BPMN, le fichier .bpmn s'ouvre donc dans d'autres outils BPMN, se vérifie et se simule, et ce que
dessine l'IA est aussi du BPMN valide. En revanche, pas de collaboration en temps réel, de lien de
partage ni de modèles.

## Développement

`npm install`, puis `npm run dev` pour l'éditeur, et `npm start` dans `mcp/` pour le serveur.
Détails sur le serveur, le co-pilote et les outils MCP : [mcp/README.fr.md](mcp/README.fr.md).
`npm run build:online` construit la version en ligne en site statique dans `dist-online/` (`BASE_PATH` règle son
chemin). La mesure d'audience s'active avec les variables GitHub `VITE_UMAMI_URL` (adresse
du service de mesure) et `VITE_UMAMI_WEBSITE_ID` (identifiant du site) : sans elles, rien n'est envoyé. Le site est publié par [.github/workflows/pages.yml](.github/workflows/pages.yml) à chaque
changement sur `main`.

## À propos du projet

C'est un projet personnel, maintenu sur le temps libre, et **toutes les contributions sont les
bienvenues** : signalements de bugs, idées, traductions, documentation ou code. Si vous avez envie de
le faire grandir, n'hésitez pas.

En toute transparence : son auteur n'est pas développeur professionnel. Le développement de
l'éditeur est assisté par IA, avec Claude Code et d'autres modèles, et chaque changement est essayé
dans le navigateur avant d'être publié. Les relectures de développeurs expérimentés sont particulièrement
appréciées.

**Testeurs recherchés pour les fournisseurs d'IA.** Le co-pilote est essayé au quotidien avec les
modèles Anthropic seulement. OpenAI, Mistral, xAI (Grok), Ollama et les serveurs compatibles OpenAI sont pris en
charge d'après leur documentation, mais rarement essayés pour de vrai. Si vous utilisez l'un d'eux,
tout retour aide, que ça marche ou non : ouvrez une [issue](https://github.com/Leylines-Prism/bpmn-pilot/issues)
ou une [discussion](https://github.com/Leylines-Prism/bpmn-pilot/discussions) avec le fournisseur,
le modèle et ce que vous avez essayé (dessin, images, PDF).

Commencez par [CONTRIBUTING.md](CONTRIBUTING.md) (en anglais). Les questions et les idées vont dans
les [Discussions](https://github.com/Leylines-Prism/bpmn-pilot/discussions), les bugs dans les
[issues](https://github.com/Leylines-Prism/bpmn-pilot/issues), et les failles de sécurité passent
par le formulaire privé décrit dans [SECURITY.md](SECURITY.md). Pas de délai de réponse garanti,
mais tout est lu.

## Référencé sur

[![Serveur MCP bpmn-pilot : note de qualité et de maintenance sur Glama](https://glama.ai/mcp/servers/Leylines-Prism/bpmn-pilot/badges/card.svg)](https://glama.ai/mcp/servers/Leylines-Prism/bpmn-pilot)

<a href="https://alternativeto.net/software/bpmn-pilot/about/?utm_source=badge&utm_medium=referral"><picture><source media="(prefers-color-scheme: dark)" srcset="https://alternativeto.net/static/badges/badge-compact-dark.svg"><img src="https://alternativeto.net/static/badges/badge-compact-light.svg" alt="BPMN-Pilot sur AlternativeTo" width="171" height="58"></picture></a>

## Soutenir le développement

BPMN-Pilot est gratuit, sans abonnement. Mon copain Claude carbure à la caféine. S'il vous fait gagner du temps, un café sur Ko-fi fait vivre le projet :

[![Soutenir sur Ko-fi](https://img.shields.io/badge/Ko--fi-Soutenir%20le%20projet-FF5E5B?logo=ko-fi&logoColor=white&style=for-the-badge)](https://ko-fi.com/leylines_prism)

## Licence

Le code est publié sous la [licence MIT](LICENSE).

Le nom, le logo et les éléments de marque Leylines (les fichiers de [src/brand/](src/brand/)
et le logo dessiné par [src/theme/brand-logo.js](src/theme/brand-logo.js)) ne sont pas couverts
par cette licence. Si vous publiez votre propre version, remplacez-les par les vôtres.

L'éditeur repose sur [bpmn-js](https://github.com/bpmn-io/bpmn-js), dont la licence impose que le
filigrane bpmn.io reste entièrement visible sur le canevas. Gardez-le si vous changez la mise en page.
