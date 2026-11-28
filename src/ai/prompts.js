// Prompts MCP : des recettes que l'utilisateur choisit dans son client MCP
// (menu des prompts de Claude Desktop, commande /mcp__bpmn-pilot__… de Claude Code).
// Elles s'appuient sur les règles de modélisation de INSTRUCTIONS (tools.js).
//
// Ce module n'importe rien : buildPrompts(z) décrit les arguments avec le zod fourni.
// Chaque prompt renvoie le texte d'un message utilisateur.

// Critique d'une description avant de la dessiner : commune au prompt MCP critique_description
// et à l'étape de critique du chat intégré (src/ai/chat-loop.js).
export const CRITIQUE_POINTS = `- who does what: the organizations or actors (pools) and the roles inside them (lanes);
- what starts the process and which results end it;
- each decision: the question asked and the condition of each answer;
- exceptions, cancellations, deadlines and waiting times;
- loops and repetitions, and when they stop;
- documents, data and messages exchanged;
- vague or contradictory wording.`

export const CRITIQUE_SEVERITIES = `- blocking: without the answer, the model would probably be wrong;
- major: an assumption is needed, and it changes the model;
- minor: a detail, such as a name.`

// Demandes des commandes du menu Expert qui passent par le Co-pilote IA (src/main.js), en anglais
// et en français. Les prompts MCP du même nom reprennent le texte anglais : un agent MCP reçoit
// la même consigne que le Co-pilote.
export const EXPERT_ASKS = {
  probabilities: {
    en:
      'Propose realistic probabilities for the branches of each gateway of this diagram, from the labels, conditions and documentation. ' +
        'Set them with update_elements (the branches of one gateway add up to 100 %), without changing anything else. ' +
        'Then give, in one line per gateway, what justifies your values.',
    fr:
      'Propose des probabilités réalistes pour les branches de chaque passerelle de ce diagramme, d\'après les libellés, les conditions et la documentation. ' +
        'Inscris-les avec update_elements (les branches d\'une passerelle font 100 % ensemble), sans rien changer d\'autre. ' +
        'Donne ensuite, en une ligne par passerelle, ce qui justifie tes valeurs.',
  },
  aiPotential: {
    en:
      'Rate the AI potential of each activity of this diagram, from its name, lane, documentation, assignee and systems: ' +
        'automate (an AI agent or automation performs it, with a human review), assist (a human performs it with AI help) or human (judgment, relationship or accountability). ' +
        'Save it with update_elements (aiPotential and aiPotentialReason: one or two sentences on why and the safeguard needed), without changing anything else. ' +
        'For each automate or assist activity, also add to its risks field the risks of handing it to AI (error, personal data, missing review…), one per line, and to its controls field the matching controls, one per line, keeping the risks and controls already written. ' +
        'Then sum up in three lines where AI pays off first, and the risks to frame.',
    fr:
      'Note le potentiel d\'IA de chaque activité de ce diagramme, d\'après son nom, son couloir, sa documentation, la personne assignée et les systèmes : ' +
        'automate (un agent IA ou une automatisation la réalise, avec une revue humaine), assist (un humain la réalise aidé par l\'IA) ou human (jugement, relation ou responsabilité). ' +
        'Enregistre-le avec update_elements (aiPotential et aiPotentialReason : une ou deux phrases sur la raison et le garde-fou nécessaire), sans rien changer d\'autre. ' +
        'Pour chaque activité automate ou assist, ajoute aussi dans son champ risks les risques de la confier à l\'IA (erreur, données personnelles, absence de revue…), un par ligne, et dans son champ controls les contrôles correspondants, un par ligne, en gardant les risques et contrôles déjà écrits. ' +
        'Résume ensuite en trois lignes où l\'IA rapporte d\'abord, et les risques à encadrer.',
  },
  analysis: {
    en:
      'Analyze this process for its report: read get_process_report with simulate, then save your analysis with set_report_commentary ' +
        '(summary, bottlenecks, rare paths, risks, improvements, each tied to the elements concerned and to the figures of the report). ' +
        'Do not change the diagram. Finish with a short summary of what you saved.',
    fr:
      'Analyse ce processus pour son rapport : lis get_process_report avec simulate, puis enregistre ton analyse avec set_report_commentary ' +
        '(synthèse, goulots, chemins rares, risques, pistes d\'amélioration, chacun relié aux éléments concernés et aux chiffres du rapport). ' +
        'Ne modifie pas le diagramme. Termine par un court résumé de ce que tu as enregistré.',
  },
}

// Ligne ajoutée aux demandes du menu Expert quand elles servent de prompt MCP.
// Remplir une table de décision DMN : bouton « Remplir avec le Co-pilote » de la fenêtre DMN et
// « Rédiger avec le Co-pilote » du panneau (src/dmn/setup.js), et prompt MCP fill_decision_table.
// task et decision : { id, name } ou rien ; rules : nombre de règles déjà écrites.
export function decisionTableAsk({ task, decision, rules = 0 } = {}) {
  const q = (x) => `"${x.name || x.id}"`
  const qf = (x) => `« ${x.name || x.id} »`
  const what = {
    en: `Fill in the DMN decision table${decision ? ` of the decision ${decision.id} (${q(decision)})` : ''}${task ? `${decision ? ', called by' : ' of'} the business rule task ${task.id} (${q(task)})` : ''}, from its name, the task's documentation and the rest of the process.`,
    fr: `Remplis la table de décision DMN${decision ? ` de la décision ${decision.id} (${qf(decision)})` : ''}${task ? `${decision ? ', appelée par' : ' de'} la tâche de règle métier ${task.id} (${qf(task)})` : ''}, d'après son nom, la documentation de la tâche et le reste du processus.`,
  }
  const state = !decision
    ? { en: '', fr: '' }
    : rules
      ? { en: ` It already has ${rules} rule(s): keep them unless they are wrong, add the missing cases, and say what you changed.`,
          fr: ` Elle a déjà ${rules} règle(s) : garde-les sauf si elles sont fausses, ajoute les cas manquants et dis ce que tu as changé.` }
      : { en: ' It has no rule yet, and its columns may only carry default names (Input, Output): replace them.',
          fr: ' Elle n\'a encore aucune règle, et ses colonnes ne portent peut-être que des noms par défaut (Entrée, Sortie) : remplace-les.' }
  const target = { en: [decision && `decisionId ${decision.id}`, task && `linkTo ${task.id}`].filter(Boolean).join(' and '), fr: [decision && `decisionId ${decision.id}`, task && `linkTo ${task.id}`].filter(Boolean).join(' et ') }
  return {
    en: what.en + state.en +
      ` Use set_decision_table${target.en ? ` with ${target.en}` : ''}: name the inputs and outputs in business words, give the allowed values of text inputs and outputs, ` +
      'choose the hit policy, write rules that do not overlap unless the policy allows it and that cover every combination of allowed values, ' +
      'and give each rule a short annotation that says why. Then check it with test_decision (one case per rule), sum up the table in a few lines and say what the user must confirm.',
    fr: what.fr + state.fr +
      ` Utilise set_decision_table${target.fr ? ` avec ${target.fr}` : ''} : nomme les entrées et sorties en termes métier, donne les valeurs prévues des entrées et sorties texte, ` +
      'choisis la politique de résultat, écris des règles qui ne se chevauchent pas, sauf si la politique le permet, et qui couvrent toutes les combinaisons de valeurs prévues, ' +
      'et donne à chaque règle une courte annotation qui dit pourquoi. Vérifie-la ensuite avec test_decision (un cas par règle), résume la table en quelques lignes et dis ce que l\'utilisateur doit confirmer.',
  }
}

const OPEN_DIAGRAM = 'Work on the BPMN diagram open in the editor: read it with get_shapes first. Write in the language of the diagram\'s names. I can undo everything with Ctrl+Z.'

export function buildPrompts(z) {
  return [
    {
      name: 'model_process',
      title: 'Model a process from a description',
      description: 'Draws a process in the open editor from a text description, following the modeling rules.',
      argsSchema: {
        description: z.string().min(1).describe('The process to model, in plain words'),
      },
      text: ({ description }) =>
        `Model this process in the BPMN editor:

${description}

- Read the current diagram with get_shapes first. If it is not empty, ask me whether to add to it or replace it.
- Follow the modeling rules of this server: start and end events, verb + object for tasks, object + state for events, a question on each exclusive gateway with answers on its flows, the happy path from left to right.
- Name the elements in the language of the description.
- Finish with layout_diagram, then validate_diagram, and fix what it reports.
- Then summarize the process in a few lines and list the assumptions you made.`,
    },
    {
      name: 'model_collaboration',
      title: 'Model a collaboration between organizations',
      description:
        'Draws one pool per organization or actor, with message flows between them, from a text description.',
      argsSchema: {
        description: z.string().min(1).describe('The exchange to model, in plain words'),
        participants: z
          .string()
          .optional()
          .describe('The organizations or actors, separated by commas. Left empty, they are taken from the description'),
      },
      text: ({ description, participants }) =>
        `Model this collaboration in the BPMN editor:

${description}
${participants ? `\nParticipants: ${participants}\n` : ''}
- Read the current diagram with get_shapes first. If it is not empty, ask me whether to add to it or replace it.
- Create one pool per participant, one under the other. Use lanes only for roles inside one participant.
- Model each participant's own process inside its pool, with its own start and end events.
- Connect the pools only with message flows (connect_shapes between shapes of two pools), never with sequence flows.
- Follow the modeling rules of this server, and name the elements in the language of the description.
- Finish with layout_diagram, then validate_diagram, and fix what it reports.`,
    },
    {
      name: 'review_diagram',
      title: 'Review the diagram',
      description: 'Reviews the open diagram against the modeling rules and the validator, without changing anything.',
      argsSchema: {},
      text: () =>
        `Review the BPMN diagram open in the editor. Do not change anything.

- Read it with get_shapes, look at it with get_diagram_image, and run validate_diagram.
- List the problems, most important first: validation errors, then breaches of the modeling rules of this server (names, gateways, events, happy path, layout), then what is unclear for a reader.
- For each problem, name the element and propose a concrete fix, such as a better name.
- End with a short verdict, and ask me which fixes to apply.
Reply in the language of the diagram's names.`,
    },
    {
      name: 'tidy_diagram',
      title: 'Tidy up the diagram',
      description:
        'Renames elements to the naming conventions, fixes validation errors and lays the diagram out, keeping its meaning.',
      argsSchema: {},
      text: () =>
        `Tidy up the BPMN diagram open in the editor, keeping its meaning.

- Read it with get_shapes and run validate_diagram.
- Rename elements that break the naming rules of this server, in the language of the existing names.
- Fix the validation errors. Do not add or remove steps of the process: if a fix would change what the process does, list it and ask me instead.
- Then call layout_diagram and validate_diagram again. If a few shapes still sit badly, adjust them with move_elements rather than laying out again.
- If a call gives a wrong result, back out of it with undo before trying again.
- Finally, list what you changed. I can undo everything with Ctrl+Z.`,
    },
    {
      name: 'write_user_stories',
      title: 'Write the user stories of each activity',
      description:
        'Writes user stories and acceptance criteria for each activity of the open diagram, saved in the diagram, for the team that will tool the process.',
      argsSchema: {},
      text: () =>
        `Write the user stories and acceptance criteria of each activity of the BPMN diagram open in the editor, as a product owner would for the team that will tool the process.

- Read it with get_shapes: name, lane, documentation, assignee, systems, and the stories and criteria already written.
- Save them with update_elements, keeping what is already written: userStories, one per line, "As a <role>, I want <action>, so that <benefit>"; acceptanceCriteria, one per line, testable, "Given <context>, when <event>, then <result>".
- Two or three stories and three to five criteria per activity at most. Change nothing else in the diagram.
- Then list the activities whose need is still unclear, with the question to ask.
Write in the language of the diagram's names. I can undo everything with Ctrl+Z, and export the backlog with Export > User stories (Markdown).`,
    },
    {
      name: 'add_agent_step',
      title: 'Add an AI agent step',
      description:
        'Draws a step where an AI agent picks its own actions, as an ad-hoc sub-process with its tools, a human review and an exit if the agent fails.',
      argsSchema: {
        goal: z.string().min(1).describe('What the agent must achieve, in plain words'),
        tools: z
          .string()
          .optional()
          .describe('The actions or systems the agent can use, separated by commas. Left empty, they are taken from the goal'),
        after: z.string().optional().describe('Name or id of the element the step follows. Left empty, I ask where it goes'),
      },
      text: ({ goal, tools, after }) =>
        `Add an AI agent step to the BPMN diagram open in the editor.

Goal of the agent: ${goal}
${tools ? `Tools: ${tools}\n` : ''}${after ? `Place it after: ${after}\n` : ''}
- Read the diagram with get_shapes first.${after ? '' : ' Ask me where the step goes if it is not obvious.'}
- Draw an expanded AdHocSubProcess with agent: true, named after the goal (verb + object).
- Put one ServiceTask per tool inside it (parent: its id), named verb + object, with no sequence flow between them and no start or end event: the agent picks which to run and in which order.
- After it, a UserTask where a person reviews the agent's result before it is used.
- On it, a timer or error boundary event leading to manual handling, then to an end event or back to the main path through a gateway.
- Write in the Documentation field of the step what the agent decides alone and what it must not do.
- Name the elements in the language of the diagram. Finish with layout_diagram, then validate_diagram, and fix what it reports.`,
    },
    {
      name: 'critique_description',
      title: 'Review a description before modeling it',
      description:
        'Lists what is ambiguous or missing in a process description before drawing it, with a severity, the passage concerned and a question.',
      argsSchema: {
        description: z.string().min(1).describe('The process description to review, in plain words'),
      },
      text: ({ description }) =>
        `Review this process description before modeling it in BPMN. Do not draw anything yet.

${description}

Look for what is ambiguous or missing for a correct BPMN model:
${CRITIQUE_POINTS}

List at most 8 points, most severe first, in a table with three columns: severity, the exact passage concerned (or "missing" when nothing in the text covers it), and the question to ask me. Severities:
${CRITIQUE_SEVERITIES}

Then give the assumption you would make for each point, and ask me whether to draw now with these assumptions or to wait for my answers.
Reply in the language of the description.`,
    },
    {
      name: 'propose_probabilities',
      title: 'Propose branch probabilities',
      description:
        'Sets realistic probabilities on the branches of each gateway, from the labels, conditions and documentation, for the simulation and the heatmap. Same request as the Expert menu command "Propose probabilities".',
      argsSchema: {},
      text: () => `${EXPERT_ASKS.probabilities.en}
${OPEN_DIAGRAM}
The values stay marked as proposed by the AI until I review them.`,
    },
    {
      name: 'rate_ai_potential',
      title: 'Rate which activities to hand to AI',
      description:
        'Rates each activity automate, assist or human with the reason and the safeguard, and adds the risks and controls of handing it to AI. Same request as the Expert menu command "Which activities to hand to AI?".',
      argsSchema: {},
      text: () => `${EXPERT_ASKS.aiPotential.en}
${OPEN_DIAGRAM}`,
    },
    {
      name: 'analyze_process',
      title: 'Analyze the process for its report',
      description:
        'Runs 100 simulated tokens, reads the process report and saves an analysis (summary, bottlenecks, rare paths, risks, improvements) that the report shows. Same request as the Expert menu command "Co-pilot analysis".',
      argsSchema: {},
      text: () => `${EXPERT_ASKS.analysis.en}
${OPEN_DIAGRAM}`,
    },
    {
      name: 'assess_compliance',
      title: 'Assess risks, controls and requirements',
      description:
        'Writes the risks, controls and regulatory requirements of each activity, and proposes the process identity, for the compliance matrix of the process report.',
      argsSchema: {
        framework: z
          .string()
          .optional()
          .describe('Regulations or standards to check against, for example "GDPR, ISO 9001, AI Act". Left empty, the ones the activities call for'),
      },
      text: ({ framework }) =>
        `Assess the risks and compliance of the BPMN diagram open in the editor, activity by activity.
${framework ? `Frameworks: ${framework}\n` : ''}
- Read it with get_shapes: name, lane, documentation, assignee, systems, and the risks, controls and requirements already written. The process identity is on the diagram root.
- For each activity, save with update_elements, keeping what is already written: risks (what can go wrong at this step, one per line), controls (what prevents or detects each risk: review, double check, threshold, log, one per line), requirements (the articles or clauses this step must meet, separated by semicolons).
- Cite only references you are sure of. When unsure, leave requirements empty and write the question to ask in your answer.
- If the process identity (owner, version, status, scope) is empty, propose it in your answer and save it on the diagram root only once I confirm it.
- Change nothing else in the diagram. Then list the three highest risks, and the activities that have a risk without a control.
Write in the language of the diagram's names. I can undo everything with Ctrl+Z; the process report shows the compliance matrix.`,
    },
    {
      name: 'fill_decision_table',
      title: 'Fill in a decision table',
      description:
        'Writes the DMN decision table of a business rule task (inputs, outputs, hit policy, rules with annotations) from the task, its documentation and the process, links it to the task and tests it. Same request as the "Fill in with the co-pilot" button of the decision window.',
      argsSchema: {
        task: z.string().optional().describe('Name or id of the business rule task. Left empty, every business rule task without a decision or with an empty table'),
      },
      text: ({ task } = {}) =>
        `${task
          ? `Find the business rule task "${task}" with get_shapes, and its decision with get_decisions.`
          : 'With get_shapes and get_decisions, find the business rule tasks that have no decision, or whose decision table has no rule, and do the following for each of them.'}
${decisionTableAsk({}).en.replace('Fill in the DMN decision table, ', 'Fill in its DMN decision table, ').replace('Use set_decision_table:', 'Use set_decision_table, with decisionId when the task already has a decision and linkTo the task:')}
${OPEN_DIAGRAM}`,
    },
    {
      name: 'model_from_event_log',
      title: 'Draw the process from an event log',
      description:
        'Draws the process found in an event log (CSV or XES from an ERP, CRM or ticketing tool), then checks the log against it: fitness, deviations, real branch shares and bottlenecks.',
      argsSchema: {},
      text: () =>
        `Draw the BPMN process found in the event log loaded in the editor, then check the log against it.

- If no log is loaded, ask me for the file and load it with load_event_log. If the open diagram is not empty, ask me before drawing.
- Read get_log_summary with activities 0.8 and paths 0.8 to keep the main flow first.
- Draw a start event, one task per step named as in the log, an exclusive gateway where a step is followed by different steps, a parallel split and join where two steps appear in both orders, a loop back where a step comes back, and an end event for each way cases end.
- Finish the drawing with layout_diagram. Match each step with its task (map_log_activities), then run check_conformance and apply_log_frequencies.
- Report the fitness, the main deviations with their number of cases, the bottlenecks, and the rare steps and paths you left out.
Name the gateways and end events in the language of the step names. I can undo the drawing with Ctrl+Z.`,
    },
  ]
}
