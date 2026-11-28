# MCP server and built-in chat for the BPMN editor (prototype)

**English** | [Français](README.fr.md)

This server lets an AI (Claude Code, Claude Desktop, GitHub Copilot in VS Code or any MCP client) read and draw in the BPMN
editor **open in the browser**. Changes show up live on the canvas, as if made by hand, and each tool
call can be undone with a single Ctrl+Z. `set_diagram_xml`, `import_mermaid` and `layout_diagram` reload the whole diagram: one
Ctrl+Z brings back the diagram from before them, but earlier steps can no longer be undone one by one.

## How it works

```
MCP client  ──HTTP──▶  MCP server (Node, 127.0.0.1:3333)  ──WebSocket──▶  editor tab (bpmn-js)
             /mcp                                           /bridge
```

- The server validates each tool's arguments, then relays the call to the open tab.
- The tab runs the tool with the bpmn-js modeling API (`src/mcp-bridge.js`) and sends back the result.
- When several tabs are open, the last one used receives calls from MCP clients. The built-in chat
  always draws in the tab where the conversation takes place.
- With no tab open, tools answer with an explicit error, unless the headless mode is on (below).
- An "MCP" badge in the toolbar shows whether the editor is connected to the server.
- Tools, instructions and the chat loop are defined in `src/ai/`, shared with the editor: the server
  runs from the full repository, not from the `mcp/` folder alone.

## Built-in chat

The "AI co-pilot" button in the toolbar opens a chat panel to the right of the canvas. Describe a
process or a change, and the model draws it in **this tab** with the same tools as the MCP server.
Under each answer, one chip per tool called (✓ succeeded, ✗ failed). The model is picked in
the Options window, among those the server offers and those of the providers set up there; the panel
shows it above the input. Switching provider starts a new conversation, without touching the diagram. The "Stop" button stops the current answer. "New chat" starts over.

```
editor (chat panel) ──HTTP /chat──▶ server ──Claude API──────────────▶ Claude
                                           └─OpenAI-compatible API──▶ Mistral, OpenAI, OpenRouter, Ollama…
                    ◀──WebSocket── tools run in the tab
```

- API keys from environment variables stay on the server. The browser only receives the list of models
  (id and label), neither key nor provider address, and the server rejects any model not in that list.
- A provider set up in the Options window (see below) is sent with each message: address, key and
  model. The server uses it for that call, without storing it or writing it to its log.
- The `/chat` route only accepts editor pages (same list of origins as the WebSocket).
- Conversations are kept in the server's memory (20 at most) and lost when it restarts.
- Images and PDF files attached in the panel are sent with the message (34 MB at most per request,
  with their own content type `application/vnd.bpmn-chat+json`), then passed on to the model.
- If Claude Opus or Sonnet declines a request, the API replays it on a fallback model
  (`fallbacks: "default"`). Haiku has no fallback.
- Each message uses API credits: an API key from an organization with included credits stops when they
  run out, a key with a payment method is billed by usage. The same goes for OpenAI-compatible
  providers, except a local model (Ollama, LM Studio).

### Setting up providers

Copy `mcp/.env.example` to `mcp/.env` (excluded from git) and fill in what you need. A provider only
shows in the menu once it is set up. Several can be set up at the same time.

**Anthropic**: the API key is enough. The menu then offers Claude Opus 5.5, Sonnet 5.5 and Haiku 5.5.

```
ANTHROPIC_API_KEY=sk-ant-...
```

**OpenAI-compatible**: any service that exposes `/chat/completions` with tool calls (`tools`). The list
of models is required, since it depends on the service.

```
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_API_KEY=sk-or-...
OPENAI_MODELS=openai/gpt-5=GPT-5,mistralai/mistral-large=Mistral Large
OPENAI_LABEL=OpenRouter
```

For a local model with Ollama, no API key: `OPENAI_BASE_URL=http://localhost:11434/v1` and
`OPENAI_MODELS=qwen3:14b`. The model must support tool calls, and a small model draws less well than
a large one.

**Mistral**: the API key is enough. The menu then offers Mistral Large and Mistral Small. For
processing in the European Union (billed 10% more), add
`MISTRAL_BASE_URL=https://api.eu.mistral.ai/v1`.

```
MISTRAL_API_KEY=...
```

With no provider at all, the server still starts: the MCP tools work, and the panel suggests setting
up a provider in the Options window.

### Options window

The "Options" button of the panel opens a window with one block per provider: Anthropic, OpenAI,
Mistral, xAI (Grok), Ollama and "OpenAI-compatible" (LiteLLM, LM Studio, vLLM…). For each one: the address
(prefilled for Anthropic, OpenAI, Mistral, xAI and Ollama), the API key, and the models to offer. "List models" asks the provider
for them, "Test" checks the address and the key. Neither button uses any credit. A provider's
models are only offered once "Test" or "List models" has succeeded, and again after its address or
key changes. "Co-pilot model" picks the model used by the chat.

- Settings stay in the browser. API keys are forgotten when the tab is closed, unless "Remember API keys on
  your device" is checked. "Clear API keys" removes them.
- Calls go through the server (`/chat` and `/chat/models` routes): the address is reached from the
  server. When it runs in docker, Ollama on the host machine is reachable at
  `http://host.docker.internal:11434/v1`.
- Models from environment variables are still offered, under their own group.

### With docker compose

The `docker-compose.yml` file at the root of the repository starts the editor and this server (see
the [main README](../README.md#run-it-with-docker)). The server reads `mcp/.env` when it exists.
Variables can also be passed through `environment`, API keys preferably through a `.env` file next to the
compose file, never written in the compose file itself:

```yaml
services:
  mcp:
    environment:
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
      CHAT_MODEL: anthropic:claude-sonnet-5-5
```

### Behind a domain name

By default, the compose file publishes the site on `127.0.0.1` of the host only. To serve it under
a domain name or from another machine, set these variables in a `.env` file next to
`docker-compose.yml`:

| Variable | Example | Purpose |
|---|---|---|
| `CHAT_RELAY` | `off` | `off` turns off the providers set in the Options window: the server then only offers its own models and never calls an address sent by a page |
| `BPMN_EDITOR_ORIGINS` | `https://bpmn.example.com` | addresses of the editor pages, with `http://` or `https://`, separated by commas. The WebSocket and the chat only accept them |
| `MCP_ALLOWED_HOSTS` | `bpmn.example.com` | host names that MCP clients use |
| `BPMN_BIND` | `0.0.0.0` | interface the site listens on (`127.0.0.1` by default). Only needed when the proxy runs on another machine |

| Install | MCP address |
|---|---|
| docker on this machine | `http://localhost:8080/mcp` (or the port set in `BPMN_PORT`) |
| development (`npm run dev` and `mcp/`) | `http://127.0.0.1:3333/mcp` |
| docker behind a domain name or a reverse proxy | `https://your-domain/mcp` |

The reverse proxy must pass the `Host` header, allow WebSocket upgrades on `/bridge`, and not buffer
the answers of `/mcp` and `/chat` (Caddy does all of this by default). Set `MCP_TOKEN` so that MCP
clients must send `Authorization: Bearer <token>`. The editor pages and saved diagrams stay open to
anyone who reaches the site: put a login in front of them at the proxy, as in the
[main README](../README.md#on-the-internet-at-your-own-risk).

## Running

With docker: `docker compose up -d --build` at the root of the repository, then open
http://localhost:8080. MCP clients connect to `http://localhost:8080/mcp`.

For development, in two terminals, at the root of the repository:

```
npm install && npm run dev
cd mcp && npm install && npm start
```

Then open http://localhost:5173. The badge switches to "MCP: ready" (the tab is linked to the server), then to the agent's name once it connects ("MCP: Claude Code"). The MCP protocol only sends the client's name and version, never the model.

For Claude Code, the `.mcp.json` file at the root already declares the server
(`http://127.0.0.1:3333/mcp`).

The server also speaks MCP over stdio, for clients that launch it themselves:
`node mcp/server.js --stdio` (or `MCP_TRANSPORT=stdio`). It still opens its HTTP port for the
editor tabs, and its log goes to the error output. Directory checks use this mode.

## Local relay for the online version

`relay.js` is a reduced server for the online editor (https://bpmn.leylines.fr), which has no server
of its own. The agent starts it and talks to it over stdio. It only opens the `/bridge` WebSocket (and
`/healthz`) on `127.0.0.1:3333`, accepts only the online editor as `Origin` and local host names, and
relays the same tools and prompts as `server.js` (shared in `mcp-server.js`). No chat, no saved
diagrams, no exports folder, no headless mode: it writes nothing to disk.

`npm run build:relay` at the root bundles it into one file, `relay/dist/bpmn-pilot-mcp.mjs`, published
on npm as `bpmn-pilot-mcp` (`npx -y bpmn-pilot-mcp`). `npm run pack:mcpb` also builds the Claude
Desktop extension `relay/dist/bpmn-pilot.mcpb`, attached to each release. The page connects to it once
**Local agent** is on in its "Connect an agent" window. To try it with `npm run dev:online`, start it
with `BPMN_EDITOR_ORIGINS=http://localhost:5173 node mcp/relay.js`.

## Tools

| Tool | Purpose |
|---|---|
| `get_shapes` | lists the diagram's shapes and connections (id, type, name, position, links) |
| `get_diagram_xml` | returns the diagram as BPMN 2.0 XML |
| `get_diagram_image` | returns a PNG image of the diagram, as drawn on the canvas, so the model can check the layout or show it (with OpenAI-compatible providers, Mistral included, the built-in AI co-pilot cannot receive it) |
| `export_diagram` | produces a file like the Export menu: the diagram (`bpmn`, `svg`, `png`, `pdf`) or one of its documents (`dmn` decisions, `forms` task forms as a .form file or a .zip, `camunda8` and `camunda7` BPMN, process report `report-pdf`, `report-md`, `report-docx`, procedure sheets `sheets-pdf`, `sheets-md`, `sheets-docx`, `doc-html` documentation page, `stories-md` user stories, `raci-xlsx` RACI matrix). Only the encrypted file stays out of it: a password has no place with an agent. The file is saved in `EXPORTS_DIR`, never replacing another one, and the editor shows a Download button: nothing is downloaded unless the user clicks it. With `returnFile`, the file is also returned to the client (PNG as an image, BPMN, SVG, DMN, .form, Markdown and HTML as text, PDF, Word and Excel as an embedded resource, 10 MB at most). An export of the diagram also lists the elements still lacking a sequence flow, without blocking it |
| `set_diagram_xml` | replaces the whole diagram. Unreadable XML, or XML without a drawn diagram, is rejected and the diagram stays unchanged |
| `import_mermaid` | replaces the whole diagram with a Mermaid flowchart converted to BPMN and laid out automatically: tasks, decisions, events, call activities, data, notes, link labels as conditions, subgraphs as lanes (or expanded subprocesses with `subgraphs: "subprocesses"`). Returns the counts and the warnings, line by line. Other Mermaid diagrams are rejected and the diagram stays unchanged |
| `get_diagram_mermaid` | returns the diagram as a Mermaid flowchart, for a README or a wiki |
| `add_shapes` | adds shapes, after an element (`after`, automatic placement and connection), at a position, or to the right of the diagram. Also adds pools (`Participant`) and their lanes (`Lane`), and places a shape in a lane with `parent`. With `attachTo`, adds a boundary event (timer, error…) on a task. The result lists the elements still lacking a sequence flow (`unconnected`) |
| `connect_shapes` | connects two shapes. The connection type follows the bpmn-js BPMN rules. The result lists the elements still lacking a sequence flow (`unconnected`) |
| `update_elements` | renames elements or changes their type (Task to UserTask, timer event…), fills in their Documentation field, sets the assignee, systems used and RACI of an activity, the plain-words condition of a gateway branch, its AI potential with the reason, its risks, controls and regulatory requirements, its user stories and acceptance criteria, the process identity on the diagram root (owner, version, status, scope), or the probability of a gateway branch, marked as proposed by the AI until the user reviews it |
| `style_elements` | sets the fill, stroke, text color and font (bold, italic, underline, size, typeface) of elements |
| `remove_elements` | removes shapes or connections |
| `layout_diagram` | tidies up the whole diagram, like the "Tidy up" button. One Ctrl+Z brings back the previous layout. Its former name, `auto_layout`, still works |
| `move_elements` | places shapes at a given centre, or shifts them, without touching the rest; connections follow |
| `duplicate_elements` | copies shapes with the connections between them, below the originals or shifted |
| `undo`, `redo` | step back or forward through the editor's history, like Ctrl+Z and Ctrl+Y: one tool call or one gesture per step |
| `load_event_log` | loads an event log (CSV or XES text) into the editor for process mining, guesses the columns (case, step, start, end, resource) and matches the steps with the diagram's elements. Returns totals only |
| `get_log_summary` | summarizes the loaded log: steps and their passes, which step follows which with the median wait, start and end steps, most frequent variants, median case duration. `activities` and `paths` (0 to 1) hide rare steps and paths, to draw a first diagram from the log |
| `map_log_activities` | corrects the matching between log steps and diagram elements (`null`: not in the diagram) |
| `apply_log_frequencies` | writes the shares observed in the log on the gateway branches, marked as observed, and returns the real passes, the waits and durations, and the bottlenecks |
| `check_conformance` | compares the log with the diagram: share of cases that follow it, fitness, deviations (skipped step, wrong order, step outside the model, unfinished case) with their number of cases |
| `validate_diagram` | returns a check report: element counts and six checks (well-formed XML, BPMN 2.0 metamodel, references and scopes, complete DI, bpmn-js reimport, bpmnlint), with errors and warnings element by element; with decisions in the file, their findings too |
| `get_process_report` | returns the process report in Markdown, like the Export menu: findings by level, improvement areas, end events, activities by lane, element sequence. With `simulate`, first computes 100 tokens following the branch probabilities |
| `set_report_commentary` | saves your analysis of the process (summary, bottlenecks, rare paths, risks, improvements, each tied to elements) in the diagram file; the process report shows it as written by the AI co-pilot |
| `get_decisions` | lists the DMN decisions kept in the diagram file: decision tables (hit policy, inputs, outputs, rules), the business rule tasks that call them, and the findings (overlapping rules, uncovered values, unlinked tasks) |
| `set_decision_table` | creates a DMN decision table, or replaces one, in the decision model of the diagram, and can link a task to it (`linkTo`). The link is written for BPMN-Pilot and for Camunda 8 (`zeebe:calledDecision`) |
| `link_decision` | links a task to a decision of the diagram, or unlinks it |
| `test_decision` | evaluates a decision table on input cases without changing it: rules that apply and result under the hit policy. Without cases, one case per rule, to check that each rule fires |
| `get_task_forms` | lists the forms of user tasks and start events (fields, keys, types, required, allowed values, variables filled in), the user tasks without a form, and the data check: gateways and decision tables that read a variable no earlier form fills in |
| `set_task_form` | writes the form of a user task or start event from a list of fields (or a full form-js schema), stored in the diagram file with the Camunda 8 link (`zeebe:formDefinition`). A plain task becomes a user task |

A call that fails halfway is undone entirely: the diagram is never left half changed.

What the tools add, change or remove is marked on the editor's canvas (`src/ai-changes.js`), for the built-in AI co-pilot and MCP agents alike.

## Modeling rules and prompts

The instructions the server sends on connection (`INSTRUCTIONS` in `src/ai/tools.js`) explain how to use
the tools and give modeling rules: start and end events, verb + object for tasks, object + state for
events, a question on each exclusive gateway, no implicit split or join, the happy path from left to right.
Most of them match what `validate_diagram` checks. The built-in chat sends the same text.

The server also offers thirteen MCP prompts (`src/ai/prompts.js`), which the user picks in their client. The first three of the Expert block send the same request as the matching Expert menu commands of the AI co-pilot:

| Prompt | Arguments | Purpose |
|---|---|---|
| `model_process` | `description` | draws a process from a text description, then lays it out and validates it |
| `model_collaboration` | `description`, `participants` (optional) | draws one pool per participant, linked by message flows |
| `review_diagram` | none | reviews the open diagram against the rules and the validator, without changing anything |
| `tidy_diagram` | none | renames elements to the conventions, fixes validation errors and lays the diagram out, keeping its meaning |
| `critique_description` | `description` | lists what is ambiguous or missing in a description (severity, quoted passage, question) before drawing |
| `write_user_stories` | none | writes user stories and acceptance criteria for each activity, saved in the diagram |
| `add_agent_step` | `goal`, `tools` (optional), `after` (optional) | adds an AI agent step: an ad-hoc sub-process with the agent's tools inside, a human review after it and an exit if the agent fails |
| `propose_probabilities` | none | sets realistic probabilities on the branches of each gateway (Expert > Propose probabilities) |
| `rate_ai_potential` | none | rates each activity automate, assist or human, with the reason, and adds the risks and controls of handing it to AI (Expert > Which activities to hand to AI?) |
| `analyze_process` | none | runs 100 tokens, reads the report and saves its analysis with `set_report_commentary` (Expert > Co-pilot analysis) |
| `assess_compliance` | `framework` (optional) | writes the risks, controls and requirements of each activity, and proposes the process identity |
| `model_from_event_log` | none | draws the process from the loaded event log, then checks the log against it (fitness, deviations, real shares) |
| `fill_decision_table` | `task` (optional) | writes the DMN decision table of a business rule task (inputs, outputs, hit policy, annotated rules), links it and tests it with `test_decision` (decision window > Fill in with the co-pilot) |

## Saved diagrams

The "My diagrams" window of the editor can save diagrams on this server, besides the browser. The
`/diagrams` routes list, read, save (`PUT`, BPMN XML body, 10 MB at most), rename and delete them.
They only accept editor pages, like `/chat`. Each diagram is a `.bpmn` file named after the diagram
(`Order process.bpmn`, then `Order process (2).bpmn`), in `DIAGRAMS_DIR` (`mcp/data/diagrams` by
default, excluded from git, `/data/diagrams` in docker). The hidden `.index.json` file links each id to
its file, name and date. Files of older versions (`<id>.bpmn` and `<id>.json`) are renamed at startup. A `.bpmn` file copied
into the folder by hand is added to the list under its file name. Size and date come from the file.

`POST /exports?format=pdf&name=Order%20process` saves an export (body `application/octet-stream`,
20 MB at most) in `EXPORTS_DIR` (`mcp/data/exports`, `/data/exports` in docker), for the "Server" and
"Both" destinations of the Export menu, and for the `export_diagram` tool. Formats: `bpmn`, `xml`, `dmn`, `svg`, `png`, `pdf`, `md` (report, procedure sheets, user stories),
`html` (documentation page), `docx`, `xlsx` and `bpmn.enc` (encrypted file), with a check that the content matches. A file is never replaced: the answer gives the name chosen, such as
`{"file": "Order process (2).pdf"}`.

## Security

- The server only listens on `127.0.0.1`. In its docker container it listens on all of the
  container's interfaces, but the site is only published on `127.0.0.1` of the host machine.
- With `MCP_TOKEN` set, `/mcp` answers 401 to any request without `Authorization: Bearer <token>`.
- Without `MCP_TOKEN`, `/mcp` answers 401 to every request as soon as `MCP_HOST` is not local and
  `MCP_ALLOWED_HOSTS` holds a name other than localhost ("MCP is closed"): such a server can be reached
  from other machines. `MCP_AUTH=off` opens it anyway, for a trusted network or behind a proxy that
  authenticates `/mcp`. The "Connect an agent" window says when MCP is closed.
  The editor tab (`/bridge`) and the chat do not use it: they are limited to the editor origins.
- MCP requests whose `Host` header is not local are rejected (DNS rebinding protection, provided by
  the SDK). In docker, the accepted names are those in `MCP_ALLOWED_HOSTS`.
- MCP clients send no `Origin` header. A request to `/mcp` that carries one comes from a web page
  and is rejected unless that origin is listed in `BPMN_EDITOR_ORIGINS`.
- Only editor pages can connect to the WebSocket: the origin must be listed in `BPMN_EDITOR_ORIGINS`
  (`http://localhost:5173` and `http://127.0.0.1:5173` by default).
- The bridge and the chat through the server are only active in the editor during development, in
  the docker image built by the compose file, or when `VITE_MCP_BRIDGE_URL` is set at build time. The
  online build has no bridge: its chat runs in the page.
- The `/chat` and `/chat/models` routes call the address they are given: they only accept editor
  pages, and the server must not be exposed on a public network.
- The `/diagrams` routes have no authentication either: anyone who reaches an editor page served by
  the server can read and change the saved diagrams.

## Checking the providers

`npm run check-providers` (in `mcp/`), or `docker compose exec mcp node mcp/check-providers.js` in
docker, calls each model set on the server for real: text reply, tool call, image, PDF. Tools answer
with a sample diagram, so no editor tab is needed. A failure prints the provider's status and message,
which tells a setting error (401, 404, unreachable address) from a limit of the model (no tool call,
no vision, no PDF). A few hundred tokens per model.

## Environment variables

They can also be placed in `mcp/.env`.

| Variable | Default | Purpose |
|---|---|---|
| `MCP_PORT` | `3333` | server port |
| `MCP_TRANSPORT` | none | `stdio` adds the stdio transport, like the `--stdio` option. The HTTP port stays open for the editor tabs |
| `MCP_HOST` | `127.0.0.1` (`0.0.0.0` in the docker image) | listening address |
| `MCP_TOKEN` | none | token MCP clients must send (`Authorization: Bearer <token>`). Without it, `/mcp` asks for nothing on localhost, and is closed (401) when `MCP_ALLOWED_HOSTS` holds a name other than localhost |
| `MCP_AUTH` | none | `off` opens `/mcp` without a token even under a name other than localhost (trusted network, or a proxy that authenticates `/mcp`). The server warns at startup |
| `MCP_ALLOWED_HOSTS` | `localhost,127.0.0.1` | host names accepted when `MCP_HOST` is not local |
| `BPMN_EDITOR_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | origins allowed for the WebSocket and the chat |
| `ANTHROPIC_API_KEY` | none | Anthropic API key. Without it, no Claude model in the menu |
| `ANTHROPIC_MODELS` | `claude-opus-5-5=Claude Opus 5.5,claude-sonnet-5-5=Claude Sonnet 5.5,claude-haiku-5-5=Claude Haiku 5.5` | Claude models offered, `id=Label` separated by commas (label optional) |
| `CHAT_EFFORT` | `medium` | thinking effort of Claude models: `low`, `medium`, `high`, `xhigh` or `max` |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | address of the OpenAI-compatible API, without `/chat/completions` |
| `OPENAI_API_KEY` | none | API key for that provider. Optional for a local server |
| `OPENAI_MODELS` | none | models offered, same format as `ANTHROPIC_MODELS`. Without it, no OpenAI-compatible provider |
| `OPENAI_LABEL` | `OpenAI-compatible` | provider name in the menu (OpenRouter, Ollama…) |
| `OPENAI_REASONING_EFFORT` | none | sent as is as `reasoning_effort`, for models that accept it |
| `MISTRAL_API_KEY` | none | Mistral API key. Without it, no Mistral model in the menu |
| `MISTRAL_MODELS` | `mistral-large-latest=Mistral Large,mistral-small-latest=Mistral Small` | Mistral models offered, same format as `ANTHROPIC_MODELS` |
| `MISTRAL_BASE_URL` | `https://api.mistral.ai/v1` | Mistral API address. `https://api.eu.mistral.ai/v1` keeps processing in the European Union |
| `MISTRAL_REASONING_EFFORT` | none | sent as is as `reasoning_effort` (`low`, `medium`, `high`…). Without it, each model uses its own default |
| `CHAT_MODEL` | the first in the list | model selected by default in the menu: `anthropic:claude-sonnet-5-5`, `openai:qwen3:14b`, or the id alone |
| `CHAT_RELAY` | `on` | `off` turns off the providers set in the Options window: the server then only offers its own models (above) and never calls an address sent by a page |
| `DIAGRAMS_DIR` | `mcp/data/diagrams` (`/data/diagrams` in the docker image) | folder of the diagrams saved on the server |
| `VITE_MCP_BRIDGE_URL` (editor side) | `ws://127.0.0.1:3333/bridge` in development, `/bridge` in the compose file | bridge address. A relative address points to the site itself |

## Headless mode (no open browser)

Off by default (`MCP_HEADLESS=on` turns it on; `docker-compose.headless.yml` does it for you). When an
MCP client calls a tool and no editor tab is connected, the server opens the editor in an invisible tab
of a headless Chromium (`HEADLESS_BROWSER_URL`, the `renderer` service, image `bpmn-pilot-renderer`),
through the DevTools HTTP interface only (`/json/new`, `/json/close`): no browser automation library is
bundled. The page loads `HEADLESS_EDITOR_URL/?headless=<key>` and presents the key to `/bridge`, so the
server tells it apart from real tabs (`mcp/renderer.js`, `mcp/bridge.js`).

- An open tab comes first. A series of calls started in the invisible tab stays there until that tab
  closes (`HEADLESS_IDLE_SECONDS` without a call, 300 by default) or a user opens its diagram.
- After each call that changes the diagram, its XML is saved in My diagrams (one file per series,
  `Agent YYYY-MM-DD HHhMM`) and the open tabs show a banner with an **Open** button. Opening it closes
  the invisible tab, and the next calls go to that tab.
- `GET /healthz/headless` tells whether the server reaches the browser.

## Prototype limits

- Without the headless mode, the editor tab must be open for the AI to draw.
- `layout_diagram` uses bpmn-auto-layout 2.0.0-alpha.2, which lays out pools, lanes, message flows
  and boundary events. It is still an alpha version: the result can change with its next releases.
