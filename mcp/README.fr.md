# Serveur MCP et chat intégré de l'éditeur BPMN (prototype)

[English](README.md) | **Français**

Ce serveur permet à une IA (Claude Code, Claude Desktop, GitHub Copilot dans VS Code ou tout client MCP) de lire et de dessiner
dans l'éditeur BPMN **ouvert dans le navigateur**. Les modifications apparaissent en direct sur le
canevas, comme si elles étaient faites à la main, et chaque appel d'outil s'annule d'un seul Ctrl+Z. `set_diagram_xml` et `layout_diagram` rechargent tout le diagramme : un Ctrl+Z ramène le diagramme d'avant, mais les étapes plus anciennes ne s'annulent plus une par une.

## Fonctionnement

```
Client MCP  ──HTTP──▶  serveur MCP (Node, 127.0.0.1:3333)  ──WebSocket──▶  onglet de l'éditeur (bpmn-js)
             /mcp                                            /bridge
```

- Le serveur valide les arguments de chaque outil puis relaie l'appel à l'onglet ouvert.
- L'onglet exécute l'outil avec l'API de modélisation de bpmn-js (`src/mcp-bridge.js`) et renvoie le résultat.
- Si plusieurs onglets sont ouverts, c'est le dernier utilisé qui reçoit les appels des clients MCP. Le chat intégré, lui, dessine toujours dans l'onglet où l'on discute.
- Sans onglet ouvert, les outils répondent par une erreur explicite, sauf en mode sans écran (plus bas).
- Un badge « MCP » dans la barre d'outils indique si l'éditeur est relié au serveur.
- Les outils, les consignes et la boucle du chat sont définis dans `src/ai/`, partagé avec l'éditeur : le serveur se lance depuis le dépôt complet, pas depuis le seul dossier `mcp/`.

## Chat intégré

Le bouton « Co-pilote IA » de la barre d'outils ouvre un panneau de discussion à droite du canevas.
On y décrit un processus ou une modification, et le modèle la dessine dans **cet onglet** avec les mêmes
outils que le serveur MCP. Sous chaque réponse, une pastille par outil appelé (✓ réussi, ✗ échoué).
Le modèle se choisit dans la fenêtre Options, parmi ceux que le serveur propose et ceux des fournisseurs
réglés là ; le panneau l'affiche au-dessus de la zone de saisie. Passer d'un fournisseur à l'autre ouvre
une nouvelle discussion, sans toucher au diagramme.
Le bouton « Arrêter » interrompt la réponse en cours. « Nouvelle discussion » repart de zéro.

```
éditeur (panneau de chat) ──HTTP /chat──▶ serveur ──API Claude──────────────▶ Claude
                                                  └─API compatible OpenAI──▶ Mistral, OpenAI, OpenRouter, Ollama…
                          ◀──WebSocket── outils exécutés dans l'onglet
```

- Les clés API des variables d'environnement restent sur le serveur. Le navigateur ne reçoit que la liste
  des modèles (identifiant et libellé), ni clé ni adresse de fournisseur, et le serveur refuse tout
  modèle absent de cette liste.
- Un fournisseur réglé dans la fenêtre Options (voir plus bas) part avec chaque message : adresse,
  clé et modèle. Le serveur s'en sert pour cet appel, sans l'enregistrer ni l'écrire dans son journal.
- La route `/chat` n'accepte que les pages de l'éditeur (même liste d'origines que le WebSocket).
- Les conversations sont gardées en mémoire par le serveur (20 au plus) et perdues à son redémarrage.
- Les images et PDF joints dans le panneau partent avec le message (34 Mo au plus par requête, avec
  leur propre type de contenu `application/vnd.bpmn-chat+json`), puis sont transmis au modèle.
- Si Claude Opus ou Sonnet décline une demande, l'API la rejoue sur un modèle de repli
  (`fallbacks: "default"`). Haiku n'a pas ce repli.
- Chaque message consomme des crédits d'API : la clé API de l'organisation à crédits inclus s'arrête
  quand ils sont épuisés, une clé avec moyen de paiement est facturée à l'usage. Il en va de même chez
  les fournisseurs compatibles OpenAI, sauf un modèle local (Ollama, LM Studio).

### Configurer les fournisseurs

Copier `mcp/.env.example` en `mcp/.env` (exclu de git) et remplir ce qui sert. Un fournisseur n'apparaît
dans le menu que s'il est configuré. Plusieurs peuvent l'être en même temps.

**Anthropic** : il suffit de la clé API. Le menu propose alors Claude Opus 5.5, Sonnet 5.5 et Haiku 5.5.

```
ANTHROPIC_API_KEY=sk-ant-...
```

**Compatible OpenAI** : tout service qui expose `/chat/completions` avec appels d'outils (`tools`).
La liste des modèles est obligatoire, car elle dépend du service.

```
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_API_KEY=sk-or-...
OPENAI_MODELS=openai/gpt-5=GPT-5,mistralai/mistral-large=Mistral Large
OPENAI_LABEL=OpenRouter
```

Pour un modèle local avec Ollama, pas de clé API : `OPENAI_BASE_URL=http://localhost:11434/v1` et
`OPENAI_MODELS=qwen3:14b`. Le modèle doit savoir appeler des outils, et un petit modèle dessine moins
bien qu'un grand.

**Mistral** : il suffit de la clé API. Le menu propose alors Mistral Large et Mistral Small. Pour un
traitement dans l'Union européenne (facturé 10 % de plus), ajoutez
`MISTRAL_BASE_URL=https://api.eu.mistral.ai/v1`.

```
MISTRAL_API_KEY=...
```

Sans aucun fournisseur, le serveur démarre quand même : les outils MCP marchent, et le panneau invite
à régler un fournisseur dans la fenêtre Options.

### Fenêtre Options

Le bouton « Options » du panneau ouvre une fenêtre avec un bloc par fournisseur : Anthropic, OpenAI,
Mistral, xAI (Grok), Ollama et « Compatible OpenAI » (LiteLLM, LM Studio, vLLM…). Pour chacun : l'adresse
(préremplie pour Anthropic, OpenAI, Mistral, xAI et Ollama), la clé API, et les modèles à proposer. « Lister les modèles » les demande au
fournisseur, « Tester » vérifie l'adresse et la clé. Ces deux boutons ne consomment aucun crédit.
Les modèles d'un fournisseur ne sont proposés qu'après la réussite de « Tester » ou « Lister les
modèles », et de nouveau après un changement d'adresse ou de clé. « Modèle du co-pilote » choisit le
modèle du chat.

- Les réglages restent dans le navigateur. Les clés API sont oubliées à la fermeture de l'onglet, sauf si
  « Se souvenir des clés API sur votre appareil » est coché. « Effacer les clés API » les retire.
- Les appels passent par le serveur (routes `/chat` et `/chat/models`) : l'adresse est vue depuis le
  serveur. S'il tourne dans docker, Ollama sur la machine hôte se joint par
  `http://host.docker.internal:11434/v1`.
- Les modèles des variables d'environnement restent proposés, sous leur propre groupe.

### Dans un docker compose

Le fichier `docker-compose.yml` à la racine du dépôt lance l'éditeur et ce serveur (voir le
[README principal](../README.fr.md#le-lancer-avec-docker)). Le serveur lit `mcp/.env` s'il existe. Les
variables peuvent aussi se passer par `environment`, les clés API de préférence par un fichier `.env`
à côté du compose, jamais écrites dans le compose lui-même :

```yaml
services:
  mcp:
    environment:
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
      CHAT_MODEL: anthropic:claude-sonnet-5-5
```

### Derrière un nom de domaine

Par défaut, le compose ne publie le site que sur `127.0.0.1` de la machine hôte. Pour le servir sous
un nom de domaine ou depuis une autre machine, régler ces variables dans un fichier `.env` à côté de
`docker-compose.yml` :

| Variable | Exemple | Rôle |
|---|---|---|
| `CHAT_RELAY` | `off` | `off` coupe les fournisseurs réglés dans la fenêtre Options : le serveur ne propose plus que ses propres modèles et n'appelle jamais une adresse envoyée par une page |
| `BPMN_EDITOR_ORIGINS` | `https://bpmn.example.com` | adresses des pages de l'éditeur, avec `http://` ou `https://`, séparées par des virgules. Le WebSocket et le chat n'acceptent qu'elles |
| `MCP_ALLOWED_HOSTS` | `bpmn.example.com` | noms d'hôte qu'utilisent les clients MCP |
| `BPMN_BIND` | `0.0.0.0` | interface où le site écoute (`127.0.0.1` par défaut). Utile seulement si le proxy tourne sur une autre machine |

| Installation | Adresse MCP |
|---|---|
| docker sur cette machine | `http://localhost:8080/mcp` (ou le port réglé dans `BPMN_PORT`) |
| développement (`npm run dev` et `mcp/`) | `http://127.0.0.1:3333/mcp` |
| docker derrière un nom de domaine ou un proxy inverse | `https://votre-domaine/mcp` |

Le proxy inverse doit transmettre l'en-tête `Host`, accepter le passage en WebSocket sur `/bridge`, et
ne pas retenir les réponses de `/mcp` et `/chat` (Caddy fait tout cela par défaut). Régler `MCP_TOKEN`
pour que les clients MCP doivent envoyer `Authorization: Bearer <jeton>`. Les pages de l'éditeur et
les diagrammes enregistrés restent ouverts à quiconque joint le site : placer une connexion devant au
niveau du proxy, comme dans le [README principal](../README.fr.md#sur-internet-à-vos-propres-risques).

## Lancer

Avec docker : `docker compose up -d --build` à la racine du dépôt, puis ouvrir http://localhost:8080.
Les clients MCP se connectent à `http://localhost:8080/mcp`.

En développement, dans deux terminaux, à la racine du dépôt :

```
npm install && npm run dev
cd mcp && npm install && npm start
```

Puis ouvrir http://localhost:5173. Le badge passe à « MCP : prêt » (l'onglet est relié au serveur), puis au nom de l'agent dès qu'il se connecte (« MCP : Claude Code »). Le protocole MCP ne transmet que le nom et la version du client, jamais le modèle.

Pour Claude Code, le fichier `.mcp.json` à la racine déclare déjà le serveur
(`http://127.0.0.1:3333/mcp`).

Le serveur parle aussi MCP par stdio, pour les clients qui le lancent eux-mêmes :
`node mcp/server.js --stdio` (ou `MCP_TRANSPORT=stdio`). Il ouvre quand même son port HTTP pour les
onglets de l'éditeur, et son journal part sur la sortie d'erreur. Les contrôles des annuaires utilisent ce mode.

## Outils

| Outil | Rôle |
|---|---|
| `get_shapes` | liste les formes et les connexions du diagramme (id, type, nom, position, liens) |
| `get_diagram_xml` | renvoie le diagramme en BPMN 2.0 XML |
| `get_diagram_image` | renvoie une image PNG du diagramme, tel qu'il est dessiné, pour que le modèle vérifie la mise en page ou la montre (avec les fournisseurs compatibles OpenAI, Mistral compris, le co-pilote intégré ne peut pas la recevoir) |
| `export_diagram` | produit un fichier comme le menu Exporter : le diagramme (`bpmn`, `svg`, `png`, `pdf`) ou l'un de ses documents (décisions `dmn`, formulaires des tâches `forms` en fichier .form ou en .zip, BPMN `camunda8` et `camunda7`, rapport de processus `report-pdf`, `report-md`, `report-docx`, fiches de procédure `sheets-pdf`, `sheets-md`, `sheets-docx`, page de documentation `doc-html`, récits utilisateur `stories-md`, matrice RACI `raci-xlsx`). Seul le fichier chiffré en reste exclu : un mot de passe n'a rien à faire chez un agent. Le fichier est déposé dans `EXPORTS_DIR`, sans jamais en remplacer un autre, et l'éditeur affiche un bouton Télécharger : rien ne se télécharge sans clic de l'utilisateur. Avec `returnFile`, le fichier est aussi renvoyé au client (PNG en image, BPMN, SVG, DMN, .form, Markdown et HTML en texte, PDF, Word et Excel en ressource intégrée, 10 Mo au plus) |
| `set_diagram_xml` | remplace tout le diagramme. Un XML illisible ou sans partie graphique est refusé et le diagramme reste inchangé |
| `add_shapes` | ajoute des formes, à la suite d'un élément (`after`, placement et connexion automatiques), à une position, ou à droite du diagramme. Ajoute aussi des pools (`Participant`) et leurs lanes (`Lane`), et place une forme dans une lane avec `parent`. Avec `attachTo`, ajoute un événement de bordure (minuteur, erreur…) sur une tâche |
| `connect_shapes` | relie deux formes. Le type de connexion suit les règles BPMN de bpmn-js |
| `update_elements` | renomme ou change le type d'éléments (Task vers UserTask, événement minuté…), remplit leur champ Documentation, règle la personne assignée, les systèmes et le RACI d'une activité, la condition en clair d'une branche, son potentiel d'IA et sa raison, ses risques, contrôles et exigences, ses récits utilisateur et critères d'acceptation, la fiche d'identité du processus sur la racine du diagramme, ou la probabilité d'une branche de passerelle, marquée comme proposée par l'IA jusqu'à sa revue |
| `style_elements` | règle le fond, le contour, la couleur du texte et la police (gras, italique, souligné, taille, famille) d'éléments |
| `remove_elements` | supprime des formes ou des connexions |
| `layout_diagram` | range tout le diagramme, comme le bouton « Ranger ». Un Ctrl+Z ramène la disposition d'avant. Son ancien nom, `auto_layout`, fonctionne toujours |
| `move_elements` | place des formes à un centre donné, ou les décale, sans toucher au reste ; les connexions suivent |
| `duplicate_elements` | copie des formes avec les connexions entre elles, sous les originaux ou décalées |
| `undo`, `redo` | reculent ou avancent dans l'historique de l'éditeur, comme Ctrl+Z et Ctrl+Y : un appel d'outil ou un geste par pas |
| `load_event_log` | charge un journal d'événements (texte CSV ou XES) dans l'éditeur pour le process mining, devine les colonnes (dossier, étape, début, fin, ressource) et associe les étapes aux éléments du diagramme. Ne renvoie que des totaux |
| `get_log_summary` | résume le journal chargé : étapes et passages, quelle étape suit quelle autre avec l'attente médiane, étapes de début et de fin, variantes les plus fréquentes, durée médiane d'un dossier. `activities` et `paths` (de 0 à 1) masquent les étapes et chemins rares, pour dessiner un premier diagramme à partir du journal |
| `map_log_activities` | corrige l'association entre étapes du journal et éléments du diagramme (`null` : hors modèle) |
| `apply_log_frequencies` | écrit sur les branches des passerelles les parts observées dans le journal, marquées comme observées, et renvoie les passages réels, les attentes et durées, et les goulets d'étranglement |
| `check_conformance` | compare le journal au diagramme : part des dossiers qui le suivent, conformité (fitness), écarts (étape sautée, ordre inversé, étape hors modèle, dossier inachevé) avec leur nombre de dossiers |
| `validate_diagram` | renvoie un rapport de contrôle : compteurs d'éléments et six contrôles (XML bien formé, métamodèle BPMN 2.0, références et portées, DI complet, réimport bpmn-js, bpmnlint), avec erreurs et avertissements élément par élément ; avec des décisions dans le fichier, leurs constats aussi |
| `get_process_report` | renvoie le rapport de processus en Markdown, comme le menu Exporter : constats par niveau, axes d'amélioration, événements de fin, activités par couloir, séquence des éléments. Avec `simulate`, calcule d'abord 100 jetons selon les probabilités des branches |
| `set_report_commentary` | enregistre votre analyse du processus (synthèse, goulots, chemins rares, risques, pistes d'amélioration, chacun relié aux éléments) dans le fichier du diagramme ; le rapport de processus la présente comme rédigée par le Co-pilote IA |
| `get_decisions` | liste les décisions DMN rangées dans le fichier du diagramme : tables de décision (politique de résultat, entrées, sorties, règles), tâches de règle métier qui les appellent, et constats (règles qui se chevauchent, valeurs non couvertes, tâches non liées) |
| `set_decision_table` | crée une table de décision DMN, ou en remplace une, dans le modèle de décision du diagramme, et peut y lier une tâche (`linkTo`). Le lien est écrit pour BPMN-Pilot et pour Camunda 8 (`zeebe:calledDecision`) |
| `link_decision` | lie une tâche à une décision du diagramme, ou la délie |
| `test_decision` | évalue une table de décision sur des cas d'entrée, sans la modifier : règles qui s'appliquent et résultat selon la politique. Sans cas, un cas par règle, pour vérifier que chacune se déclenche |
| `get_task_forms` | liste les formulaires des tâches utilisateur et des événements de début (champs, clés, types, obligatoires, valeurs prévues, variables remplies), les tâches utilisateur sans formulaire, et le contrôle des données : passerelles et tables de décision qui lisent une variable qu'aucun formulaire placé avant ne remplit |
| `set_task_form` | écrit le formulaire d'une tâche utilisateur ou d'un événement de début à partir d'une liste de champs (ou d'un schéma form-js complet), rangé dans le fichier du diagramme avec le lien Camunda 8 (`zeebe:formDefinition`). Une tâche simple devient tâche utilisateur |

Un appel qui échoue en cours de route est annulé en entier : le diagramme ne reste jamais à moitié modifié.

Ce que les outils ajoutent, modifient ou suppriment est marqué sur le canevas de l'éditeur (`src/ai-changes.js`), pour le co-pilote intégré comme pour les agents MCP.

## Règles de modélisation et prompts

Les instructions que le serveur envoie à la connexion (`INSTRUCTIONS` dans `src/ai/tools.js`) expliquent
l'usage des outils et donnent des règles de modélisation : événements de début et de fin, verbe + objet
pour les tâches, objet + état pour les événements, une question sur chaque passerelle exclusive, pas de
séparation ni de jonction implicite, le chemin nominal de gauche à droite. La plupart correspondent à ce
que vérifie `validate_diagram`. Le chat intégré envoie le même texte.

Le serveur propose aussi treize prompts MCP (`src/ai/prompts.js`), que l'utilisateur choisit dans son client. Les trois premiers du bloc Expert envoient la même demande que les commandes correspondantes du menu Expert du Co-pilote IA :

| Prompt | Arguments | Rôle |
|---|---|---|
| `model_process` | `description` | dessine un processus d'après une description, puis le range et le valide |
| `model_collaboration` | `description`, `participants` (facultatif) | dessine un pool par participant, reliés par des flux de messages |
| `review_diagram` | aucun | relit le diagramme ouvert d'après les règles et le validateur, sans rien modifier |
| `tidy_diagram` | aucun | renomme selon les conventions, corrige les erreurs de validation et range, sans changer le sens |
| `critique_description` | `description` | relève ce qui est ambigu ou manquant dans une description (gravité, passage cité, question) avant de dessiner |
| `write_user_stories` | aucun | rédige les récits utilisateur et les critères d'acceptation de chaque activité, enregistrés dans le diagramme |
| `add_agent_step` | `goal`, `tools` (facultatif), `after` (facultatif) | ajoute une étape d'agent IA : un sous-processus ad hoc avec les outils de l'agent à l'intérieur, une revue humaine après lui et une sortie si l'agent échoue |
| `propose_probabilities` | aucun | règle des probabilités réalistes sur les branches de chaque passerelle (Expert > Proposer les probabilités) |
| `rate_ai_potential` | aucun | note chaque activité automate, assist ou human, avec la raison, et ajoute les risques et contrôles de la confier à l'IA (Expert > Quelles activités confier à l'IA ?) |
| `analyze_process` | aucun | lance 100 jetons, lit le rapport et enregistre son analyse avec `set_report_commentary` (Expert > Analyse du Co-pilote) |
| `assess_compliance` | `framework` (facultatif) | rédige les risques, contrôles et exigences de chaque activité, et propose la fiche d'identité du processus |
| `model_from_event_log` | aucun | dessine le processus à partir du journal chargé, puis confronte le journal au diagramme (conformité, écarts, parts réelles) |
| `fill_decision_table` | `task` (facultatif) | rédige la table de décision DMN d'une tâche de règle métier (entrées, sorties, politique de résultat, règles annotées), la lie et la teste avec `test_decision` (fenêtre de décision > Remplir avec le Co-pilote) |

## Diagrammes enregistrés

La fenêtre « Mes diagrammes » de l'éditeur peut enregistrer les diagrammes sur ce serveur, en plus du
navigateur. Les routes `/diagrams` les listent, les lisent, les enregistrent (`PUT`, corps en XML
BPMN, 10 Mo au plus), les renomment et les suppriment. Elles n'acceptent que les pages de l'éditeur,
comme `/chat`. Chaque diagramme est un fichier `.bpmn` au nom du diagramme (`Mon processus.bpmn`,
puis `Mon processus (2).bpmn`), dans `DIAGRAMS_DIR` (`mcp/data/diagrams` par défaut, exclu de git,
`/data/diagrams` en docker). Le fichier caché `.index.json` relie chaque identifiant à son fichier, son
nom et sa date. Les fichiers des versions précédentes (`<id>.bpmn` et `<id>.json`) sont renommés au
démarrage. Un fichier `.bpmn` copié à la main dans le dossier entre dans la liste sous son nom de
fichier. Taille et date viennent du fichier.

`POST /exports?format=pdf&name=Mon%20processus` enregistre un export (corps `application/octet-stream`,
20 Mo au plus) dans `EXPORTS_DIR` (`mcp/data/exports`, `/data/exports` en docker), pour les
destinations « Serveur » et « Les deux » du menu Exporter, et pour l'outil `export_diagram`. Formats : `bpmn`, `xml`, `dmn`, `svg`, `png`,
`pdf`, `md` (rapport, fiches de procédure, récits utilisateur), `html` (page de documentation), `docx`, `xlsx` et `bpmn.enc`
(fichier chiffré), avec un contrôle du contenu. Un fichier n'est jamais remplacé : la réponse donne le nom retenu,
par exemple `{"file": "Mon processus (2).pdf"}`.

## Sécurité

- Le serveur n'écoute que sur `127.0.0.1`. Dans son conteneur docker, il écoute sur toutes les
  interfaces du conteneur, mais le site n'est publié que sur `127.0.0.1` de la machine hôte.
- Avec `MCP_TOKEN`, `/mcp` répond 401 à toute requête sans `Authorization: Bearer <jeton>`. L'onglet
  de l'éditeur (`/bridge`) et le chat ne l'utilisent pas : ils sont limités aux origines de l'éditeur.
- Sans `MCP_TOKEN`, `/mcp` répond 401 à toute requête dès que `MCP_HOST` n'est pas local et que
  `MCP_ALLOWED_HOSTS` contient un autre nom que localhost (« MCP is closed ») : un tel serveur est
  joignable depuis d'autres machines. `MCP_AUTH=off` l'ouvre quand même, pour un réseau de confiance ou
  derrière un proxy qui authentifie `/mcp`. La fenêtre « Connecter un agent » indique quand MCP est fermé.
- Les requêtes MCP dont l'en-tête `Host` n'est pas local sont refusées (protection contre le DNS rebinding, fournie par le SDK).
  Dans docker, les noms acceptés sont ceux de `MCP_ALLOWED_HOSTS`.
- Les clients MCP n'envoient pas d'en-tête `Origin`. Une requête vers `/mcp` qui en porte un vient
  d'une page web : elle est refusée si cette origine ne figure pas dans `BPMN_EDITOR_ORIGINS`.
- Seules les pages de l'éditeur peuvent se connecter au WebSocket : l'origine doit figurer dans
  `BPMN_EDITOR_ORIGINS` (par défaut `http://localhost:5173` et `http://127.0.0.1:5173`).
- Le pont et le chat par le serveur ne sont actifs dans l'éditeur qu'en développement, dans l'image
  docker du compose, ou si `VITE_MCP_BRIDGE_URL` est définie au build. La version en ligne n'a pas
  de pont : son chat tourne dans la page.
- Les routes `/chat` et `/chat/models` appellent l'adresse qu'on leur donne : elles n'acceptent que les
  pages de l'éditeur, et le serveur ne doit pas être exposé sur un réseau public.
- Les routes `/diagrams` n'ont pas non plus d'authentification : quiconque atteint une page de l'éditeur
  servie par le serveur peut lire et modifier les diagrammes enregistrés.

## Vérifier les fournisseurs

`npm run check-providers` (dans `mcp/`), ou `docker compose exec mcp node mcp/check-providers.js` dans
docker, appelle pour de vrai chaque modèle réglé sur le serveur : réponse texte, appel d'outil, image,
PDF. Les outils répondent avec un diagramme d'exemple : aucun onglet de l'éditeur n'est nécessaire. Un
échec affiche le statut et le message du fournisseur, ce qui distingue une erreur de réglage (401, 404,
adresse injoignable) d'une limite du modèle (pas d'appel d'outil, pas de vision, pas de PDF). Quelques
centaines de jetons par modèle.

## Variables d'environnement

Elles peuvent aussi être placées dans `mcp/.env`.

| Variable | Défaut | Rôle |
|---|---|---|
| `MCP_PORT` | `3333` | port du serveur |
| `MCP_TRANSPORT` | aucune | `stdio` ajoute le transport stdio, comme l'option `--stdio`. Le port HTTP reste ouvert pour les onglets de l'éditeur |
| `MCP_HOST` | `127.0.0.1` (`0.0.0.0` dans l'image docker) | adresse d'écoute |
| `MCP_TOKEN` | aucune | jeton que les clients MCP doivent envoyer (`Authorization: Bearer <jeton>`). Sans lui, `/mcp` ne demande rien sur localhost, et il est fermé (401) quand `MCP_ALLOWED_HOSTS` contient un autre nom que localhost |
| `MCP_AUTH` | aucune | `off` ouvre `/mcp` sans jeton même sous un autre nom que localhost (réseau de confiance, ou proxy qui authentifie `/mcp`). Le serveur avertit au démarrage |
| `MCP_ALLOWED_HOSTS` | `localhost,127.0.0.1` | noms d'hôte acceptés quand `MCP_HOST` n'est pas local |
| `BPMN_EDITOR_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | origines autorisées pour le WebSocket et le chat |
| `ANTHROPIC_API_KEY` | aucune | clé API Anthropic. Sans elle, pas de modèle Claude dans le menu |
| `ANTHROPIC_MODELS` | `claude-opus-5-5=Claude Opus 5.5,claude-sonnet-5-5=Claude Sonnet 5.5,claude-haiku-5-5=Claude Haiku 5.5` | modèles Claude proposés, `identifiant=Libellé` séparés par des virgules (libellé facultatif) |
| `CHAT_EFFORT` | `medium` | effort de réflexion des modèles Claude : `low`, `medium`, `high`, `xhigh` ou `max` |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | adresse de l'API compatible OpenAI, sans `/chat/completions` |
| `OPENAI_API_KEY` | aucune | clé API de ce fournisseur. Facultative pour un serveur local |
| `OPENAI_MODELS` | aucune | modèles proposés, même format que `ANTHROPIC_MODELS`. Sans elle, pas de fournisseur compatible OpenAI |
| `OPENAI_LABEL` | `OpenAI-compatible` | nom du fournisseur dans le menu (OpenRouter, Ollama…) |
| `OPENAI_REASONING_EFFORT` | aucune | envoyée telle quelle en `reasoning_effort`, pour les modèles qui l'acceptent |
| `MISTRAL_API_KEY` | aucune | clé API Mistral. Sans elle, pas de modèle Mistral dans le menu |
| `MISTRAL_MODELS` | `mistral-large-latest=Mistral Large,mistral-small-latest=Mistral Small` | modèles Mistral proposés, même format que `ANTHROPIC_MODELS` |
| `MISTRAL_BASE_URL` | `https://api.mistral.ai/v1` | adresse de l'API Mistral. `https://api.eu.mistral.ai/v1` garde le traitement dans l'Union européenne |
| `MISTRAL_REASONING_EFFORT` | aucune | envoyée telle quelle en `reasoning_effort` (`low`, `medium`, `high`…). Sans elle, chaque modèle garde son réglage par défaut |
| `CHAT_MODEL` | le premier de la liste | modèle choisi par défaut dans le menu : `anthropic:claude-sonnet-5-5`, `openai:qwen3:14b`, ou l'identifiant seul |
| `CHAT_RELAY` | `on` | `off` coupe les fournisseurs réglés dans la fenêtre Options : le serveur ne propose plus que ses propres modèles (ci-dessus) et n'appelle jamais une adresse envoyée par une page |
| `DIAGRAMS_DIR` | `mcp/data/diagrams` (`/data/diagrams` dans l'image docker) | dossier des diagrammes enregistrés sur le serveur |
| `VITE_MCP_BRIDGE_URL` (côté éditeur) | `ws://127.0.0.1:3333/bridge` en développement, `/bridge` dans le compose | adresse du pont. Une adresse relative vise le site lui-même |

## Mode sans écran (sans navigateur ouvert)

Coupé par défaut (`MCP_HEADLESS=on` l'active ; `docker-compose.headless.yml` le fait pour vous). Quand
un client MCP appelle un outil et qu'aucun onglet de l'éditeur n'est relié, le serveur ouvre l'éditeur
dans un onglet invisible d'un Chromium sans écran (`HEADLESS_BROWSER_URL`, le service `renderer`, image
`bpmn-pilot-renderer`), par la seule interface HTTP de DevTools (`/json/new`, `/json/close`) : aucune
bibliothèque de pilotage de navigateur n'est embarquée. La page charge
`HEADLESS_EDITOR_URL/?headless=<clé>` et présente la clé à `/bridge`, pour que le serveur la distingue
des vrais onglets (`mcp/renderer.js`, `mcp/bridge.js`).

- Un onglet ouvert passe en premier. Une série d'appels commencée dans l'onglet invisible y reste
  jusqu'à sa fermeture (`HEADLESS_IDLE_SECONDS` sans appel, 300 par défaut) ou jusqu'à ce qu'un
  utilisateur ouvre son diagramme.
- Après chaque appel qui modifie le diagramme, son XML est enregistré dans Mes diagrammes (un fichier
  par série, `Agent AAAA-MM-JJ HHhMM`) et les onglets ouverts affichent un bandeau avec un bouton
  **Ouvrir**. L'ouvrir ferme l'onglet invisible, et les appels suivants vont à cet onglet.
- `GET /healthz/headless` dit si le serveur joint le navigateur.

## Limites du prototype

- Sans le mode sans écran, l'onglet de l'éditeur doit être ouvert pour que l'IA dessine.
- `layout_diagram` utilise bpmn-auto-layout 2.0.0-alpha.2, qui range pools, lanes, flux de messages et événements de bordure. C'est encore une version alpha : le rendu peut changer avec ses prochaines versions.
