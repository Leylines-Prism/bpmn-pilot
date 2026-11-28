# bpmn-pilot-mcp

Local MCP relay for [BPMN Pilot](https://bpmn.leylines.fr), a BPMN 2.0 editor that runs in the browser.

Your AI agent (Claude Code, Cursor, VS Code, Windsurf, Gemini CLI…) starts this relay and talks to it over stdio. The BPMN Pilot page open in a browser on the same computer connects to it at `ws://127.0.0.1:3333`, and the agent then reads, draws, lays out, checks and exports the diagram open in that tab.

This is not the AI co-pilot built into the page, which calls a provider with an API key entered in the page. Here your own agent works with its own subscription, model and context, and no API key is entered in the page.

It is made for agents installed on your computer (Claude Desktop, Claude Code, Cursor, VS Code…). Assistants used in a browser tab, such as claude.ai or ChatGPT, run on their vendor's servers and cannot reach the relay.

In the editor, pick **MCP agent** in the **AI** selector of the toolbar: only one AI edits the diagram at a time, and turning on **Local agent** picks the agent for you.

The relay only passes messages between the agent and the tab. It writes nothing to disk, calls no service and accepts no page other than the BPMN Pilot editor.

## Setup

1. Add the relay to your agent, for example in its MCP settings file:

   ```json
   { "mcpServers": { "bpmn-pilot": { "command": "npx", "args": ["-y", "bpmn-pilot-mcp"] } } }
   ```

   With Claude Code: `claude mcp add bpmn-pilot -- npx -y bpmn-pilot-mcp`.
   With Claude Desktop, install the `bpmn-pilot.mcpb` extension from the [latest release](https://github.com/Leylines-Prism/bpmn-pilot/releases/latest) instead: no Node.js needed.

2. Open [bpmn.leylines.fr](https://bpmn.leylines.fr), click **MCP** in the toolbar and turn on **Local agent**. Your browser may ask to allow access to the local network: accept.

3. Ask your agent: "Describe the diagram open in BPMN Pilot."

Requires Node.js 20 or later. Safari blocks the connection from an HTTPS page to the computer: use Chrome, Edge or Firefox.

## Settings

| Variable | Default | Use |
|---|---|---|
| `MCP_PORT` | `3333` | Local port of the bridge, the one the page expects |
| `BPMN_EDITOR_ORIGINS` | `https://bpmn.leylines.fr` | Editor addresses allowed to connect, comma-separated |

The Docker version of BPMN Pilot has its own MCP server and does not need this relay. See the [project README](https://github.com/Leylines-Prism/bpmn-pilot#readme).

License: MIT.
