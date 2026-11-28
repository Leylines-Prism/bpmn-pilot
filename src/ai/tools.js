// Outils de dessin proposés aux modèles : définition commune au serveur MCP
// (dossier mcp/) et au chat intégré, qu'il tourne sur le serveur ou dans la page.
// L'éditeur ouvert fait le vrai travail sur bpmn-js (src/mcp-bridge.js).
//
// Ce module n'importe rien : chacun lui passe sa propre copie de zod (v4),
// pour que les schémas soient ceux de la bibliothèque qui les lira.

export const INSTRUCTIONS = `This server drives a BPMN editor (bpmn-js) open in the user's browser.
Every change shows up live on their canvas and can be undone with Ctrl+Z.

Recommended method:
1. Call get_shapes to learn the current diagram.
2. For a linear sequence, add_shapes with "after": the shape is placed to the right of the previous one and connected automatically.
3. For branches and loops back, add_shapes then connect_shapes.
4. Read the diagram again with get_shapes to check. get_diagram_image shows how it actually looks.
5. When the drawing is complete, call layout_diagram: it places every shape and connection cleanly, pools and lanes included.
6. Finish with validate_diagram and fix the reported errors.

Pools and lanes: create each Participant first (add_shapes with x and y, one under the other),
then its lanes, from top to bottom (type Lane, parent: the participant id), then the shapes with parent: the lane id.
Connect shapes of two different participants with connect_shapes: it creates a message flow.
Do not worry about exact positions: layout_diagram tidies everything at the end.
To adjust a few shapes afterwards, move_elements places or shifts them; duplicate_elements copies a fragment;
undo and redo step through the editor's history, one tool call per step.

Deadlines and exceptions on a task: add a boundary event with attachTo (for example a timer "3 days"),
then draw the exception path from it with "after".

Size guide: task 100×80, event 36×36, gateway 50×50. The x and y coordinates are the centre of the shape.
Colors and text formatting: style_elements sets the fill, stroke, text color and font of shapes and connections.
Use them sparingly and consistently, for example one color per actor or to highlight an exception path.
To start from scratch or import a complete diagram, use set_diagram_xml.
When the user asks for a file, use export_diagram: the diagram (BPMN, SVG, PNG, PDF) or one of its documents (process report, procedure sheets, HTML documentation page, RACI matrix, user stories, DMN decisions, BPMN for Camunda 8 or 7). To read the diagram yourself, use get_diagram_xml or get_diagram_image instead.

Process analysis: get_process_report gives the findings, and with simulate the token counts per element and per gateway branch.
Gateway branch probabilities are set with update_elements (probability, in %); the branches of one gateway add up to 100.
They are marked as proposed by the AI until the user reviews them.
set_report_commentary stores your analysis of the process (summary, bottlenecks, rare paths, risks, improvements)
in the diagram file: it appears in the process report, under your name. Base each point on the report's figures.
The process goals (at least or at most a share of instances ending on an end event, or of passes through an activity) are the user's own targets: the report says whether the simulation reaches them. Cite them in your analysis, never change them.

Process documentation: update_elements also fills in what the procedure sheets, the RACI matrix and the report show.
On an activity: documentation (Markdown), assignee, systems, accountable, consulted, informed (RACI), aiPotential with aiPotentialReason (automate, assist or human),
risks, controls and requirements (compliance), userStories and acceptanceCriteria. On the diagram root (id from get_shapes): the process identity
(owner, version, status, validatedOn, scope). get_shapes returns these fields when they are filled in: read them first and keep what is written.
A CallActivity can be linked by the user to another diagram that details it (multi-level map): get_shapes gives its name as linkedDiagram.

Decisions (DMN): a business rule task can call a DMN decision kept in the diagram file (one DMN 1.3 model per diagram,
with its decision requirements diagram). get_decisions lists the decisions, their tables and the tasks that call them.
set_decision_table creates or replaces a decision table and can link it to a task (linkTo); link_decision links or unlinks
a task. Write FEEL: text between double quotes ("A"), numbers bare, "-" for any value, comparisons (< 1000, >= 18),
ranges ([1..10], ]1000..5000]), lists ("A","B"). Give the allowed values of text inputs and outputs. With the Unique hit
policy no two rules may apply together; use First or Priority when they must overlap. Check the findings each tool returns.
test_decision evaluates a decision table on input cases (with no cases, one case per rule): use it to check a table you wrote.

Forms: a user task or a start event can carry a form (form-js schema kept in the diagram file, linked for Camunda 8).
get_task_forms lists them, with the variables each fills in and the gateways or decision tables that read a variable no form fills in.
set_task_form writes a form from a simple list of fields. Each field key is a process variable: reuse the names the gateway conditions
and decision tables already read, so that the data check passes and the token simulation can follow the answers.

Process mining: load_event_log reads an event log (CSV or XES) exported from an ERP, CRM or ticketing tool.
With a diagram, check the step matches (map_log_activities), then apply_log_frequencies and check_conformance.
Without one, get_log_summary gives the directly-follows graph to draw the process from; review it with check_conformance.

Modeling rules (validate_diagram checks most of them):
- Every process has a start event and at least one end event. At most one blank start event per process: when the trigger is known, use a typed one (message, timer, signal, conditional).
- Each event takes only the triggers the BPMN standard allows for its kind (for example no timer end event, no error start event outside an event subprocess, no non-interrupting error boundary event): the tools refuse the others.
- Name every task, event, splitting gateway, pool and lane, in the user's business words, not technical terms.
- Task: verb + object ("Check invoice"). Avoid vague verbs such as handle, process or manage.
- Event: object + state reached ("Invoice received", "Order shipped"). End events name the result.
- Exclusive gateway: a question ("Amount over 1000?"). Label each outgoing flow with an answer ("Yes", "No").
- Never give a task two outgoing flows: split with a gateway. Never merge flows into a task: join them with a gateway.
- A gateway either splits or joins, never both. Close a parallel split with a parallel join.
- Do not name parallel gateways or joining gateways.
- Put the happy path on a straight line from left to right, with exceptions below it.
- Exceptions on a task: a boundary event (timer, error, message), not a gateway after the task.
- Something that can happen at any time during a process or subprocess: an event subprocess (eventSubProcess: true) with a typed start event.
- Repeated work: a marker (loop, parallel or sequential multi-instance) on the activity, not a loop back. Link events (throw and catch with the same name) only to avoid long flows across a large diagram.
- Work done by an AI agent that decides its own steps (LLM, assistant, bot): an AI agent step. An expanded AdHocSubProcess with agent: true, named after its goal; its tools as ServiceTasks inside it (parent: its id, no sequence flows between them, no start or end event inside); then a UserTask that reviews its result before it is used; and a timer or error boundary event leading to manual handling. validate_diagram warns when the review or the exit is missing.
- Lanes only when the user names roles or departments. Separate organizations are separate pools linked by message flows.
- No retry loops for technical failures. A loop back is for a business reason ("Correct the request").
- Keep default sizes. Use color only to convey meaning, and say what it means.`

// Polices proposées par l'éditeur (src/label-style.js, FONTS), recopiées ici : ce module n'importe rien.
export const FONT_NAMES = ['Arial', 'Times New Roman', 'Courier New', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Georgia', 'Palatino Linotype', 'Comic Sans MS']

// Formats de l'outil export_diagram : ceux du diagramme (src/export-files.js, EXPORT_FORMATS) puis
// ses documents (DOCUMENT_FORMATS), recopiés ici. Un test vérifie qu'ils restent les mêmes.
export const EXPORT_FORMATS = [
  'bpmn', 'svg', 'png', 'pdf',
  'dmn', 'forms', 'camunda8', 'camunda7',
  'report-pdf', 'report-md', 'report-docx',
  'sheets-pdf', 'sheets-md', 'sheets-docx',
  'doc-html', 'stories-md', 'raci-xlsx',
]

// Renvoie la liste des outils, décrits avec le zod fourni : buildTools(z).
export function buildTools(z) {
  const elementId = z.string().min(1).describe('Id of a diagram element, as returned by get_shapes')

  const bpmnType = z
    .string()
    .min(1)
    .describe(
      'BPMN type, with or without the "bpmn:" prefix. Examples: StartEvent, EndEvent, IntermediateThrowEvent, ' +
        'IntermediateCatchEvent, Task, UserTask, ServiceTask, ScriptTask, ManualTask, SendTask, ReceiveTask, ' +
        'BusinessRuleTask, SubProcess, Transaction, AdHocSubProcess, CallActivity, ExclusiveGateway, ParallelGateway, ' +
        'InclusiveGateway, EventBasedGateway, ComplexGateway, DataObjectReference, DataStoreReference, TextAnnotation, Group, Participant, Lane',
    )

  const eventDefinition = z
    .string()
    .describe(
      'For an event only: definition type, for example TimerEventDefinition, MessageEventDefinition, ' +
        'SignalEventDefinition, ErrorEventDefinition, EscalationEventDefinition, ConditionalEventDefinition, ' +
        'LinkEventDefinition, CompensateEventDefinition, CancelEventDefinition, TerminateEventDefinition. ' +
        'Only the combinations allowed by the BPMN standard are accepted: for example a timer is never an end event or a throw event, ' +
        'an error, escalation or compensation start event goes only in an event subprocess, a cancel event only in or on a Transaction',
    )

  const marker = z
    .enum(['loop', 'parallel', 'sequential', 'compensation', 'none'])
    .describe(
      'Activities only: loop (repeats while a condition holds), parallel or sequential multi-instance (one run per item of a list), ' +
        'compensation (the activity undoes completed work, linked to a compensation boundary event), none to remove the marker',
    )

  const interrupting = z
    .boolean()
    .describe(
      'Boundary event, or start event of an event subprocess, only: false for a non-interrupting event (the activity or process goes on). ' +
        'Default: true. Error, compensation and cancel events are always interrupting',
    )

  const color = z
    .string()
    .regex(/^(#?[0-9a-fA-F]{6}|#?[0-9a-fA-F]{3}|)$/)
    .describe('Hexadecimal color such as #1E88E5, or an empty string')

  // Annotations MCP (readOnlyHint, destructiveHint, idempotentHint, openWorldHint) : des indices
  // pour les clients, qui peuvent par exemple demander confirmation avant un outil destructif.
  // Seul le serveur MCP les transmet. Tous les outils agissent sur l'onglet ouvert, jamais au-delà.
  const READ = { readOnlyHint: true, openWorldHint: false }
  const edit = (destructive, idempotent) => ({ readOnlyHint: false, destructiveHint: destructive, idempotentHint: idempotent, openWorldHint: false })

  return [
    {
      name: 'get_shapes',
      title: 'Read the diagram elements',
      description:
        'Lists the elements of the open diagram: shapes (id, type, name, position, parent, incoming and outgoing flows, documentation) and connections (id, type, name, source, target). ' +
        'Documentation is the Markdown text the user wrote about the element (shortened past 1,500 characters): use it to answer questions about the process. ' +
        'Filled-in fields are included too (assignee, systems, RACI roles, AI potential, risks, controls, requirements, user stories, acceptance criteria, branch condition and probability, and the diagram a call activity is linked to), and the root carries the process identity: read them before completing them with update_elements, which replaces a field as a whole. ' +
        'Call it before changing an existing diagram: the other tools take these ids. Read-only. ' +
        'For the full BPMN content (conditions, full documentation, extensions) use get_diagram_xml; to see the layout, get_diagram_image.',
      inputSchema: {},
      annotations: READ,
    },
    {
      name: 'get_diagram_xml',
      title: 'Read the BPMN XML',
      description:
        'Returns the open diagram as BPMN 2.0 XML, with its diagram layout. Read-only. ' +
        'Use it to keep or pass on the exact file, or to read details get_shapes leaves out; to list ids before an edit, get_shapes is shorter.',
      inputSchema: {},
      annotations: READ,
    },
    {
      name: 'get_diagram_image',
      title: 'See the diagram',
      description:
        'Returns a PNG image of the open diagram, as drawn on the canvas. Use it to check the layout visually (overlaps, crossing flows, readability), or to show the diagram to the user. ' +
        'Read-only: nothing is saved. To give the user an image file, use export_diagram.',
      inputSchema: {},
      annotations: READ,
    },
    {
      name: 'export_diagram',
      title: 'Export the diagram or one of its documents',
      description:
        'Produces a file exactly like the editor\'s Export menu. The diagram: bpmn (BPMN 2.0 XML), svg, png (2x, white background) or pdf (vector). ' +
        'Its documents: dmn (the decision tables, DMN 1.3), forms (the task forms, a .form file or a .zip of them, to deploy with the process in Camunda 8), camunda8 and camunda7 (BPMN prepared for the engine: executable process, gateway conditions in FEEL or JUEL, assigned tasks as user tasks), ' +
        'report-pdf, report-md and report-docx (the process report, see get_process_report), sheets-pdf, sheets-md and sheets-docx (procedure sheets: one per activity in flow order, with its documentation, RACI, risks and stories), ' +
        'doc-html (a self-contained web page: the diagram, and the sheet of each element on a click), stories-md (user stories and acceptance criteria backlog) and raci-xlsx (RACI matrix as an Excel workbook). ' +
        'The documents work whatever the Expert modules shown in the tab. When there is nothing to put in one (no decision, no RACI role, no user story), the error says which field to fill in. ' +
        'When the editor runs with its server, the file is saved in the exports folder of the server; an existing file is never replaced ' +
        '("Name (2).pdf" is added next to it). The editor also shows the user a Download button: nothing is downloaded unless they click it. ' +
        'With returnFile, the file itself is also returned to you (png as an image, bpmn, svg, dmn, md and html as text, pdf, docx and xlsx as an embedded resource), ' +
        'so you can pass it on or attach it elsewhere; without it, only the file name and size come back. ' +
        'The diagram itself is not changed. Use it only when the user asks for a file: to read the diagram yourself, use get_diagram_xml or get_diagram_image; to read the report, get_process_report.',
      inputSchema: {
        format: z
          .enum(EXPORT_FORMATS)
          .describe('File format: bpmn, svg, png or pdf for the diagram; dmn, forms, camunda8, camunda7, report-*, sheets-*, doc-html, stories-md or raci-xlsx for a document'),
        name: z
          .string()
          .max(120)
          .optional()
          .describe('File name without extension. Default: the name of the diagram in the editor, followed by the kind of document (for example "Order - procedure sheets")'),
        returnFile: z
          .boolean()
          .optional()
          .describe('true to receive the file content in the result (10 MB at most), for example to use the image or the PDF directly'),
      },
      annotations: edit(false, false),
    },
    {
      name: 'set_diagram_xml',
      title: 'Replace the diagram',
      description:
        "Replaces the whole open diagram with the given BPMN 2.0 XML, for example to load a file or to start over. Everything not in the XML is lost. " +
        'Unreadable XML, or XML without a drawn diagram (BPMNDiagram), is rejected and the diagram stays unchanged. ' +
        'The user can undo it in one step, but not the earlier changes one by one. To change part of a diagram, prefer add_shapes, update_elements or remove_elements.',
      annotations: edit(true, true),
      inputSchema: {
        xml: z.string().min(1).describe('Complete BPMN 2.0 XML document, with its diagram layout (BPMNDiagram)'),
      },
    },
    {
      name: 'add_shapes',
      title: 'Add shapes',
      description:
        'Adds one or more shapes. With "after", the shape is placed to the right of the given element and connected to it. ' +
        'With x and y, it is placed at that position without a connection. With neither, it is placed to the right of the diagram. ' +
        'A Lane is added at the bottom of its participant, which grows to make room. ' +
        'With "attachTo", the shape becomes a boundary event on a task or subprocess. ' +
        'Returns the id created for each shape, and for each "key" given. To connect existing shapes, use connect_shapes. ' +
        'If one shape fails, the whole call is undone. The user can undo the call with Ctrl+Z.',
      annotations: edit(false, false),
      inputSchema: {
        shapes: z
          .array(
            z.object({
              key: z
                .string()
                .optional()
                .describe('Free local name, usable in "after" of later shapes in the same call'),
              type: bpmnType,
              name: z.string().optional().describe('Displayed label'),
              eventDefinition: eventDefinition.optional(),
              after: z
                .string()
                .optional()
                .describe('Id of an existing element, or "key" of an earlier shape in this call'),
              attachTo: z
                .string()
                .optional()
                .describe(
                  'Boundary event: id (or "key") of the task or subprocess it is attached to. The shape becomes a BoundaryEvent ' +
                    'on the bottom edge of that activity; give its eventDefinition (TimerEventDefinition, ErrorEventDefinition…). ' +
                    'Continue from it with "after" for the exception path',
                ),
              interrupting: interrupting.optional(),
              marker: marker.optional(),
              eventSubProcess: z
                .boolean()
                .optional()
                .describe('SubProcess only: true for an event subprocess (dotted border, no incoming flow), started by its typed start event. Add its start event with parent: this subprocess'),
              agent: z
                .boolean()
                .optional()
                .describe('AdHocSubProcess only: true marks it as an AI agent step (the agent picks which inner activities, its tools, to run), false removes the mark'),
              expanded: z
                .boolean()
                .optional()
                .describe('SubProcess, Transaction or AdHocSubProcess: true to draw it expanded, so shapes can go inside with parent: its id. Default: collapsed'),
              x: z.number().optional().describe('Horizontal position of the shape centre, in diagram pixels. Give x and y together, without "after"'),
              y: z.number().optional().describe('Vertical position of the shape centre, in diagram pixels'),
              parent: elementId
                .optional()
                .describe(
                  'Participant, lane or subprocess that will contain the shape (an id, or the "key" of an earlier shape in this call). ' +
                    'In a lane, the shape is placed at the height of the lane, even with "after". ' +
                    'For a Lane: the participant that receives it. Default: the main process, or the first participant',
                ),
            }),
          )
          .min(1),
      },
    },
    {
      name: 'connect_shapes',
      title: 'Connect shapes',
      description:
        'Creates connections between existing shapes. The type follows the BPMN rules: sequence flow within a process, ' +
        'message flow between participants, association to an annotation. Returns the id of each connection. ' +
        'Shapes added with "after" in add_shapes are already connected. To rename a connection later, use update_elements; ' +
        'to remove one, remove_elements. The user can undo the call with Ctrl+Z.',
      annotations: edit(false, false),
      inputSchema: {
        connections: z
          .array(
            z.object({
              source: elementId.describe('Id of the shape the connection starts from'),
              target: elementId.describe('Id of the shape the connection goes to'),
              name: z.string().optional().describe('Connection label, for example "Yes" after a gateway'),
            }),
          )
          .min(1),
      },
    },
    {
      name: 'update_elements',
      title: 'Update elements',
      description:
        'Renames elements, changes their type (for example Task to UserTask), sets an activity marker, whether an event interrupts or whether an ad-hoc sub-process is an AI agent step, fills in their Documentation field, sets the probability or the plain-language condition of a gateway branch, ' +
        'or fills in the assignee, systems used, RACI roles, AI potential, risks, controls, regulatory requirements, user stories and acceptance criteria of an activity. ' +
        'With the id of the diagram root (the process, or the collaboration when there are pools, as given by get_shapes), it fills in the process identity: owner, version, status, approval date, scope. ' +
        'Only the fields given change. A type change can produce a new id, returned in the result. ' +
        'For colors and fonts use style_elements; to move shapes, move_elements or layout_diagram. The user can undo the call with Ctrl+Z.',
      annotations: edit(false, false),
      inputSchema: {
        elements: z
          .array(
            z.object({
              id: elementId,
              name: z.string().optional().describe('New label. Empty string to clear it'),
              type: bpmnType.optional(),
              eventDefinition: eventDefinition.optional(),
              interrupting: interrupting.optional(),
              marker: marker.optional(),
              agent: z
                .boolean()
                .optional()
                .describe('AdHocSubProcess only: true marks it as an AI agent step (the agent picks which inner activities, its tools, to run), false removes the mark'),
              documentation: z.string().max(4000).optional().describe('Text of the Documentation field, in Markdown (## headings, - lists, **bold**, [links](https://…)). It replaces the whole field: to complete a documentation, send the existing text with your additions. Empty string to clear it'),
              probability: z
                .number()
                .min(0)
                .max(100)
                .nullable()
                .optional()
                .describe('Sequence flows leaving an exclusive, inclusive, complex or event-based gateway only: probability of this branch in %, used by the heatmap simulation. null to clear it'),
              condition: z.string().max(300).nullable().optional()
                .describe('Sequence flows leaving an exclusive or inclusive gateway only: the rule in plain words, e.g. "Advance < 3000". Shown on the flow while it has no other label. null or empty to clear it'),
              assignee: z.string().max(200).optional().describe('Activities only: person or precise role who performs it (R), in addition to the lane. Empty string to clear it'),
              systems: z.string().max(300).optional().describe('Activities only: applications or tools used, comma-separated. Empty string to clear it'),
              accountable: z.string().max(200).optional().describe('Activities only, RACI: who answers for the result (A). Empty string to clear it'),
              consulted: z.string().max(300).optional().describe('Activities only, RACI: roles consulted (C), comma-separated. Empty string to clear it'),
              informed: z.string().max(300).optional().describe('Activities only, RACI: roles informed (I), comma-separated. Empty string to clear it'),
              aiPotential: z.enum(['automate', 'assist', 'human']).nullable().optional()
                .describe('Activities only: AI potential. automate = an AI agent or automation can perform it with a human review; assist = a human performs it with AI help; human = stays human (judgment, relationship, accountability). null to clear it'),
              aiPotentialReason: z.string().max(400).optional().describe('Activities only: one or two sentences on why, and the safeguard needed (review, data, accountability)'),
              risks: z.string().max(1000).optional().describe('Activities only: what can go wrong at this step, one risk per line. Empty string to clear it'),
              controls: z.string().max(1000).optional().describe('Activities only: what prevents or detects those risks (review, double check, threshold, log), one control per line. Empty string to clear it'),
              requirements: z.string().max(500).optional().describe('Activities only: regulatory or standard references this step must meet, separated by semicolons, e.g. "GDPR art. 30; ISO 9001 §8.5; AI Act art. 14". Empty string to clear it'),
              userStories: z.string().max(2000).optional().describe('Activities only: user stories of the need this step carries, one per line, "As a <role>, I want <action>, so that <benefit>". It replaces the whole field: send the existing stories with your additions. Empty string to clear it'),
              acceptanceCriteria: z.string().max(2000).optional().describe('Activities only: testable acceptance criteria, one per line, "Given <context>, when <event>, then <result>". It replaces the whole field. Empty string to clear it'),
              owner: z.string().max(200).optional().describe('Diagram root only: process owner, the person or role who answers for the process'),
              version: z.string().max(50).optional().describe('Diagram root only: version of the process, e.g. "2.1"'),
              status: z.enum(['draft', 'review', 'approved', 'retired']).nullable().optional().describe('Diagram root only: status of the process. null to clear it'),
              validatedOn: z.string().max(50).optional().describe('Diagram root only: approval date, e.g. "2026-11-27"'),
              scope: z.string().max(1000).optional().describe('Diagram root only: where the process applies, where it starts and ends, what it leaves out'),
            }),
          )
          .min(1),
      },
    },
    {
      name: 'style_elements',
      title: 'Style elements',
      description:
        'Sets the colors and text formatting of shapes and connections, like the editor\'s Shape and Text panels. ' +
        'Each field is optional: only the fields given change. An empty string removes that setting. ' +
        'Colors are hexadecimal, for example #1E88E5. A connection only has a stroke. ' +
        'For a dark fill, set textColor to "auto" (or #FFFFFF) so the label stays readable. ' +
        'reset: true removes every color and text formatting of the element first. ' +
        'Returns the resulting style of each element. Names and types are changed with update_elements. The user can undo it in one step.',
      annotations: edit(false, true),
      inputSchema: {
        elements: z
          .array(
            z.object({
              id: elementId,
              reset: z.boolean().optional().describe('Remove all colors and text formatting before applying the other fields'),
              fill: color.optional().describe('Shape fill color. Empty string for the default'),
              stroke: color.optional().describe('Shape outline or connection line color. Empty string for the default'),
              textColor: z
                .union([color, z.literal('auto')])
                .optional()
                .describe('Label color, or "auto" for black or white, whichever reads best on the fill. Empty string for the default'),
              bold: z.boolean().optional(),
              italic: z.boolean().optional(),
              underline: z.boolean().optional(),
              fontSize: z.number().int().min(8).max(48).optional().describe('Label font size in points. The editor offers 10, 12, 14, 18 and 24'),
              font: z.enum(FONT_NAMES).optional().describe('Label font'),
            }),
          )
          .min(1),
      },
    },
    {
      name: 'layout_diagram',
      title: 'Tidy up the diagram',
      description:
        'Recalculates the position of every shape and the route of every connection, like the editor\'s "Tidy up" button. ' +
        'Handles pools, lanes, message flows, boundary events, expanded subprocesses, annotations and groups. ' +
        'Colors, names and connections are kept: only positions and routes change. Returns the layout warnings, if any, and the number of shapes and connections. ' +
        'Call it once the drawing is complete, then check the result with get_diagram_image. To place or shift a few shapes without touching the rest, use move_elements. ' +
        'The user can undo it in one step (Ctrl+Z, or the undo tool).',
      inputSchema: {},
      annotations: edit(false, true),
    },
    {
      // Ancien nom de layout_diagram, gardé pour les agents réglés avant le renommage.
      // Le serveur MCP le publie ; le co-pilote intégré ne le voit pas (mcpOnly).
      name: 'auto_layout',
      mcpOnly: true,
      title: 'Tidy up the diagram (former name)',
      description:
        'Former name of layout_diagram, kept so that agents set up before the rename keep working: same behavior, same result. ' +
        'Recalculates the position of every shape and the route of every connection, like the editor\'s "Tidy up" button. ' +
        'New agents should call layout_diagram.',
      inputSchema: {},
      annotations: edit(false, true),
    },
    {
      name: 'move_elements',
      title: 'Move shapes',
      description:
        'Moves specific shapes, without touching the rest of the diagram: give either the new centre (x and y) or a shift (dx and dy, in pixels). ' +
        'Connections follow their shapes and are rerouted; boundary events, labels and the content of a pool or an expanded subprocess move with it. ' +
        'Connections and lanes cannot be moved on their own: move their shapes, or the pool. Read the ids and the current positions with get_shapes first. ' +
        'Returns the new centre of each shape. If one id is unknown, nothing moves. To tidy up the whole diagram, use layout_diagram. ' +
        'The user can undo the call with Ctrl+Z.',
      annotations: edit(false, false),
      inputSchema: {
        elements: z
          .array(
            z.object({
              id: elementId,
              x: z.number().optional().describe('New x of the shape centre. Give x and y together, or dx and dy'),
              y: z.number().optional().describe('New y of the shape centre'),
              dx: z.number().optional().describe('Horizontal shift in pixels, positive to the right'),
              dy: z.number().optional().describe('Vertical shift in pixels, positive downwards'),
            }),
          )
          .min(1)
          .describe('Shapes to move, each with x and y, or dx and dy'),
      },
    },
    {
      name: 'duplicate_elements',
      title: 'Duplicate shapes',
      description:
        'Copies shapes, with their names, types, documentation, colors and the connections between them, like copy and paste in the editor. ' +
        'All the shapes must have the same parent (the same pool, or the process). The copy is placed below the originals, or shifted by dx and dy. ' +
        'Copying a pool or an expanded subprocess copies what it contains. Connections to shapes that are not copied are left out: draw them with connect_shapes. ' +
        'Returns the new id of each copied element, by original id. The user can undo the call with Ctrl+Z.',
      annotations: edit(false, false),
      inputSchema: {
        ids: z.array(elementId).min(1).describe('Ids of the shapes to copy, as returned by get_shapes'),
        dx: z.number().optional().describe('Horizontal shift of the copy in pixels. Default: 0'),
        dy: z.number().optional().describe('Vertical shift of the copy in pixels. Default: the height of the copied group plus 60'),
      },
    },
    {
      name: 'undo',
      title: 'Undo',
      description:
        'Undoes the last changes on the diagram, like the editor\'s Undo button (Ctrl+Z): a whole tool call, or a user gesture, per step, ' +
        'including a layout or a replaced diagram. Use it to back out of your own last call when its result is wrong, after checking with get_shapes or get_diagram_image. ' +
        'It also undoes the user\'s own edits if they come last: read the diagram first. Returns how many steps were undone and whether more can be undone or redone.',
      annotations: edit(true, false),
      inputSchema: {
        steps: z.number().int().min(1).max(20).optional().describe('Number of steps to undo. Default: 1'),
      },
    },
    {
      name: 'redo',
      title: 'Redo',
      description:
        'Redoes the changes just undone, like the editor\'s Redo button (Ctrl+Y). Only possible right after undo: a new change clears what can be redone. ' +
        'Returns how many steps were redone and whether more can be undone or redone.',
      annotations: edit(false, false),
      inputSchema: {
        steps: z.number().int().min(1).max(20).optional().describe('Number of steps to redo. Default: 1'),
      },
    },
    {
      name: 'validate_diagram',
      title: 'Validate the diagram',
      description:
        'Checks the diagram and returns a report. Six checks: the XML is well formed; every element and attribute exists in the BPMN 2.0 metamodel; ' +
        'references resolve, ids are unique and each flow stays in its scope (sequence flows inside their process, message flows between two pools); ' +
        'every element is drawn (diagram interchange complete); bpmn-js reimports the document without warnings; ' +
        'the recommended bpmnlint rules raise no error (isolated element, missing start or end event, element without a label, superfluous gateway…). ' +
        'Returns the element counts, each check with its problems, the number of errors and warnings, and the bpmnlint issues ' +
        'with the id of the element concerned, the rule and the message. Read-only: fix the problems with the editing tools, then validate again. ' +
        'For an analysis of how the process runs, use get_process_report.',
      inputSchema: {},
      annotations: READ,
    },
    {
      name: 'get_decisions',
      title: 'Read the decisions',
      description:
        'Lists the DMN decisions kept in the diagram file: for each decision its id, name and logic. A decision table gives its hit policy, ' +
        'inputs (label, FEEL expression, type, allowed values), outputs (label, name, type, allowed values) and rules (input entries, output entries, annotation). ' +
        'Also returns the business rule tasks that call each decision, the input data of the requirements diagram, and the findings ' +
        '(overlapping rules under the Unique hit policy, uncovered values, outputs outside their allowed values, unquoted text, unlinked tasks). Read-only.',
      inputSchema: {},
      annotations: READ,
    },
    {
      name: 'set_decision_table',
      title: 'Write a decision table',
      description:
        'Creates a DMN decision with its decision table, or replaces the table of an existing decision (decisionId), in the decision model kept in the diagram file. ' +
        'A new decision is drawn in the requirements diagram with one input data per input. linkTo links a task to the decision ' +
        '(a plain task becomes a business rule task); the link is written for BPMN-Pilot and for Camunda 8 (zeebe:calledDecision). ' +
        'Entries are FEEL: "-" or an empty string for any value; text values may be given without quotes when the type is string. ' +
        'Returns the decision id and the findings on the table. The user can undo it with Ctrl+Z.',
      annotations: edit(true, false),
      inputSchema: {
        decisionId: z.string().optional().describe('Id of an existing decision to replace its table; omit to create a decision'),
        name: z.string().min(1).max(200).describe('Decision name, in business words, for example "Assess the credit risk"'),
        hitPolicy: z.enum(['UNIQUE', 'FIRST', 'PRIORITY', 'ANY', 'COLLECT', 'RULE ORDER', 'OUTPUT ORDER']).optional().describe('Default UNIQUE'),
        aggregation: z.enum(['SUM', 'MIN', 'MAX', 'COUNT']).optional().describe('With COLLECT only'),
        inputs: z
          .array(
            z.object({
              label: z.string().min(1).max(120),
              expression: z.string().max(200).optional().describe('FEEL expression read from the process data, for example amount or customer.score; derived from the label if omitted'),
              type: z.enum(['string', 'number', 'boolean', 'date', 'time', 'dateTime', 'dayTimeDuration', 'yearMonthDuration']).optional().describe('Default string'),
              values: z.array(z.string().max(120)).max(30).optional().describe('Allowed values, for a text input for example ["A", "B", "C"]'),
            }),
          )
          .min(1)
          .max(10),
        outputs: z
          .array(
            z.object({
              label: z.string().min(1).max(120),
              name: z.string().max(80).optional().describe('Variable name of the result, derived from the label if omitted'),
              type: z.enum(['string', 'number', 'boolean', 'date', 'time', 'dateTime', 'dayTimeDuration', 'yearMonthDuration']).optional().describe('Default string'),
              values: z.array(z.string().max(120)).max(30).optional(),
            }),
          )
          .min(1)
          .max(5),
        rules: z
          .array(
            z.object({
              inputs: z.array(z.string().max(300)).describe('One FEEL entry per input, in order'),
              outputs: z.array(z.string().max(300)).describe('One FEEL value per output, in order'),
              annotation: z.string().max(300).optional(),
            }),
          )
          .max(60),
        linkTo: elementId.optional().describe('Id of the task that calls this decision'),
      },
    },
    {
      name: 'test_decision',
      title: 'Test a decision table',
      description:
        'Evaluates a DMN decision table of the diagram on input cases, without changing anything: for each case, the rules that apply and the result ' +
        'under the hit policy, or the conflict (two rules under Unique, different outputs under Any). Give each case its input values in column order, ' +
        'or as an object keyed by input label or expression. Without cases, builds one case per rule from its simple entries and says whether each rule fires. ' +
        'Use it after set_decision_table to check the table, and to explain it with examples. Read-only.',
      annotations: READ,
      inputSchema: {
        decisionId: z.string().min(1).describe('Id of the decision, as returned by get_decisions'),
        cases: z
          .array(z.union([z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])), z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))]))
          .max(50)
          .optional()
          .describe('Input cases: each an array of values in column order, or an object { "input label or expression": value }. Omit for one case per rule'),
      },
    },
    {
      name: 'link_decision',
      title: 'Link a task to a decision',
      description:
        'Links a task to a DMN decision of the diagram (a plain task becomes a business rule task), or unlinks it when decisionId is empty. ' +
        'The link is written for BPMN-Pilot and for Camunda 8 (zeebe:calledDecision). Use get_decisions for the ids. The user can undo it with Ctrl+Z.',
      annotations: edit(false, true),
      inputSchema: {
        elementId,
        decisionId: z.string().describe('Id of the decision, or an empty string to unlink'),
      },
    },
    {
      name: 'get_task_forms',
      title: 'Read the task forms',
      description:
        'Lists the forms kept in the diagram file: for each user task or start event that has one, its form id, title and fields ' +
        '(key, label, type, required, allowed values) and the process variables it fills in. Also lists the user tasks and start events without a form, ' +
        'and the data findings: a gateway or a decision table that reads a variable no form before it fills in. With elementId, also returns the full form-js schema of that element. Read-only.',
      inputSchema: {
        elementId: elementId.optional().describe('Id of a user task or start event, to get its full form-js schema'),
      },
      annotations: READ,
    },
    {
      name: 'set_task_form',
      title: 'Write a task form',
      description:
        'Creates or replaces the form of a user task or a start event (a plain task becomes a user task), kept in the diagram file as a form-js schema ' +
        'and linked for Camunda 8 (zeebe:formDefinition). Describe the fields simply; each key is the process variable the field fills in. ' +
        'Reuse the variable names the diagram already reads: a gateway condition such as "Amount > 3000" reads amount, and a gateway whose branches are ' +
        'named after answers reads the gateway name in camelCase ("Category?" reads category, with the branch names as values). ' +
        'An empty fields list with no schema removes the form. Returns the form id, its variables and the findings. The user can undo it with Ctrl+Z.',
      annotations: edit(true, true),
      inputSchema: {
        elementId,
        title: z.string().max(200).optional().describe('Heading shown at the top of the form, for example the task name'),
        intro: z.string().max(1000).optional().describe('Short instructions under the heading (Markdown)'),
        fields: z
          .array(
            z.object({
              key: z.string().max(80).optional().describe('Process variable the field fills in, camelCase, for example amount; derived from the label if omitted'),
              label: z.string().min(1).max(200),
              type: z.enum(['textfield', 'textarea', 'number', 'checkbox', 'radio', 'select', 'checklist', 'taglist', 'datetime']).optional().describe('Default textfield. checkbox gives true or false; radio and select one value, checklist and taglist a list'),
              required: z.boolean().optional(),
              values: z.array(z.string().max(120)).max(30).optional().describe('Allowed values, required for radio, select, checklist and taglist'),
              min: z.number().optional().describe('number only'),
              max: z.number().optional().describe('number only'),
              description: z.string().max(300).optional().describe('Help text under the field'),
              defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
            }),
          )
          .max(40),
        schema: z.string().max(100000).optional().describe('Advanced: a complete form-js schema as JSON text, used instead of title, intro and fields'),
      },
    },
    {
      name: 'remove_elements',
      title: 'Remove elements',
      description:
        'Removes shapes or connections from the diagram. Removing a shape also removes its connections and, for a pool or an expanded subprocess, what it contains. ' +
        'Read the ids with get_shapes first. To change an element rather than delete it, use update_elements; to replace the whole diagram, set_diagram_xml. ' +
        'If one id is unknown, nothing is removed. The user can undo the call with Ctrl+Z.',
      annotations: edit(true, true),
      inputSchema: {
        ids: z.array(elementId).min(1).describe('Ids of the shapes and connections to remove, as returned by get_shapes'),
      },
    },
    {
      name: 'get_process_report',
      title: 'Read the process report',
      description:
        'Returns the process report of the open diagram, in Markdown, as the editor\'s Export menu produces it: key figures, ' +
        'modeling findings by level (error, warning, to complete) with their source (bpmnlint, model check, simulation), ' +
        'improvement areas by priority with the expected effect, the process goals set by the user and whether the simulation reaches them, end events, activities by lane, and the element sequence ' +
        '(type, lane, documentation, outgoing flows with their conditions). Use it to review a model, write a procedure, or ' +
        'propose improvements; the improvement areas you add are your own analysis, to be validated by the process owner. ' +
        'Read-only. To check conformance only, validate_diagram is shorter; to store your analysis in the report, set_report_commentary.',
      annotations: READ,
      inputSchema: {
        simulate: z
          .boolean()
          .optional()
          .describe('Compute 100 tokens first, following the gateway probabilities, to add instance counts, rework and the share of each end event'),
      },
    },
    {
      name: 'load_event_log',
      title: 'Load an event log',
      description:
        'Loads an event log (process mining) into the editor: a CSV table with one row per step carried out (case id, step, ' +
        'start and/or end date, optional resource), or an XES file (IEEE 1849). The columns are guessed from the headers; set ' +
        'columns to name them. Returns the cases, events, period, the steps with their counts, and the proposed match of each step ' +
        'with a diagram element (by name). Case ids and resources stay in the editor: no tool ever returns them. ' +
        'Then: map_log_activities to fix the matches, apply_log_frequencies for real branch shares and durations, check_conformance ' +
        'for deviations, or get_log_summary to draw the process from the log when the diagram is empty.',
      annotations: edit(false, true),
      inputSchema: {
        content: z.string().min(1).max(50_000_000).describe('The whole file content, CSV or XES text'),
        name: z.string().max(200).optional().describe('File name, shown to the user (for example orders-2026.csv)'),
        format: z.enum(['csv', 'xes']).optional().describe('Format; guessed from the content when omitted'),
        columns: z
          .object({
            case: z.string().optional().describe('Header of the case id column'),
            activity: z.string().optional().describe('Header of the step (activity) column'),
            start: z.string().optional().describe('Header of the start timestamp column'),
            end: z.string().optional().describe('Header of the end (or only) timestamp column'),
            resource: z.string().optional().describe('Header of the resource column'),
          })
          .optional()
          .describe('CSV only: column headers, when the guess is wrong'),
      },
    },
    {
      name: 'get_log_summary',
      title: 'Read the event log summary',
      description:
        'Summary of the loaded event log, in totals only: cases, events, period, median case duration, steps with counts, ' +
        'the most frequent variants (sequences of steps), and the directly-follows graph (who follows whom, how many times, ' +
        'median wait), filtered to the most frequent steps and paths. Use it to draw the process from the log: exclusive ' +
        'choices where a step is followed by different steps, parallel branches where two steps appear in both orders, loops ' +
        'where a step comes back. Read-only.',
      annotations: READ,
      inputSchema: {
        activities: z.number().min(0.05).max(1).optional().describe('Share of the events covered by the steps kept, 0.05 to 1 (default 1)'),
        paths: z.number().min(0.05).max(1).optional().describe('Share of the passes covered by the paths kept, 0.05 to 1 (default 0.9)'),
      },
    },
    {
      name: 'map_log_activities',
      title: 'Match log steps with diagram elements',
      description:
        'Sets which diagram element each step of the loaded event log stands for. Keys are step names as returned by ' +
        'load_event_log; values are element ids from get_shapes, or null for a step that is not in the diagram. Steps not ' +
        'listed keep their current match. Returns the full matching.',
      annotations: edit(false, true),
      inputSchema: {
        mapping: z.record(z.string(), elementId.nullable()).describe('Step name → element id, or null'),
      },
    },
    {
      name: 'apply_log_frequencies',
      title: 'Apply the real frequencies of the log',
      description:
        'Replays the loaded event log on the diagram, writes the observed share of each gateway branch as its probability ' +
        '(marked as coming from the log), and shows the real passes on the canvas. Returns passes per element and per flow, ' +
        'the branch shares, the median wait before and duration of each step, and the three longest waits (bottlenecks). ' +
        'The user can undo it with Ctrl+Z.',
      annotations: edit(true, true),
      inputSchema: {},
    },
    {
      name: 'check_conformance',
      title: 'Check the log against the diagram',
      description:
        'Replays each case of the loaded event log on the diagram (token replay) and returns the share of cases that follow it, ' +
        'the fitness (0 to 1), and the deviations with their number of cases: skipped step, step done before another, step ' +
        'without the expected step before, case stopped before an end, step not in the diagram. Shows them on the canvas. ' +
        'Read-only for the diagram.',
      annotations: READ,
      inputSchema: {},
    },
    {
      name: 'set_report_commentary',
      title: 'Write the analysis of the process report',
      description:
        'Stores your analysis of the process in the diagram file, where the process report shows it in a section of its own, ' +
        'marked as written by the AI co-pilot, with your name and the date. It replaces the previous analysis. ' +
        'Read get_process_report (with simulate for token counts) first, and base each point on its findings and figures. ' +
        'Each point has a kind: bottleneck (an activity or path most instances go through, or that repeats), rare_path ' +
        '(a branch or end seldom or never reached), risk (a missing exception, a dead end, a gap in the model), or improvement ' +
        '(a concrete change and its expected effect). Cite the elements concerned by id. ' +
        'Write in the language of the user. An empty summary with no points removes the analysis. The user can undo it with Ctrl+Z.',
      annotations: edit(true, true),
      inputSchema: {
        summary: z.string().max(2000).describe('Two to five sentences on how the process runs and what matters most'),
        points: z
          .array(
            z.object({
              kind: z.enum(['bottleneck', 'rare_path', 'risk', 'improvement']),
              elements: z.array(elementId).max(10).optional().describe('Ids of the elements this point is about'),
              text: z.string().min(1).max(600).describe('The point, with the figure it relies on when there is one'),
            }),
          )
          .max(12),
      },
    },
  ]
}
