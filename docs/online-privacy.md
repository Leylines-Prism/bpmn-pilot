# Your data and API keys in the online version

**English** | [Français](online-privacy.fr.md)

This page sums up a review of the online version (https://bpmn.leylines.fr), done on 2026-11-26 on version v1.2.2. It traces where each piece of data lives and where it can go.
It does not cover the Docker version, which has its own server (see the [README](../README.md)).

## In short

- The online version is only static files served by GitHub Pages. There is no application server, no
  account and no database behind it. Nothing receives your diagrams or your API keys, apart from the AI
  provider you choose.
- Your diagrams and your API keys stay in your browser. The keys only go to the AI provider you chose,
  with no middleman.
- When you use the AI co-pilot, your message, your attachments and the diagram it reads go straight to
  that provider, under its own terms.
- The only other request is anonymous usage statistics without cookies, which never contain a diagram, a
  message or a key.

Entering an API key on this page is safe, with the caveats listed below. Still, use a key reserved for
this editor, one that expires on its own and has a spending cap (see [Good practice](#good-practice)).

## Where each piece of data lives

| Data | Where it is kept | Where it can go |
|---|---|---|
| The open diagram | browser storage (`localStorage`), saved automatically | nowhere, except to the AI provider when you use the co-pilot |
| "My diagrams" | browser database (IndexedDB) | nowhere: server storage is turned off in the online version |
| Opened files and exports (BPMN, SVG, PNG, PDF) | read and created in the page, downloaded to your computer | nowhere |
| API keys | `sessionStorage` by default (gone when the tab closes), `localStorage` if "Remember API keys on your device" is checked | only in the request headers sent to the provider you chose |
| Provider addresses and models | `localStorage` | nowhere |
| Conversation with the co-pilot | page memory only, lost on reload | to the provider, with each message |
| Chat attachments (images, PDF, office documents, text files) | page memory (for office documents and text files, only the extracted text is kept) | to the provider, with the message |
| Event log for process mining (CSV, XES), Expert menu | page memory only, lost on reload. If "Keep the totals in the .bpmn file" is checked, the diagram stores totals only (passes, durations, deviations), never case or resource names | nowhere. If you ask the co-pilot to draw the process from the log, it receives totals only (step names, counts, durations). A CSV attached in the chat is a chat attachment, sent in full |
| Copy of the site for offline use | browser cache storage (Cache API), filled by the service worker: the site's own files only (code, pages, pictures) | nowhere: it holds none of your data |
| Voice dictation | recognized on the device by the browser (Web Speech API with `processLocally`), the text goes into the input box | nowhere: the microphone button only appears when the browser can recognize speech on the device, so no audio goes to a speech service |

## Every request the page makes

1. **The site's own files** (HTML, scripts, styles, images), from GitHub Pages. As with any website, the
   host sees your IP address and the files requested.
   After a first visit, a service worker ([src/pwa/sw.js](../src/pwa/sw.js)) keeps a copy of these
   files to open the site offline, and checks for a new version now and then. It handles only requests
   to the site itself: the requests below go straight to their destination, without it.
2. **The AI provider you chose**, only when you use the co-pilot or list its models: Anthropic, OpenAI,
   Mistral, xAI, Ollama on your own machine, or the "OpenAI-compatible" address you enter yourself.
3. **Anonymous usage statistics** (audience measurement), on the stable page only: the page address
   (without the part after `#`), the referring site, the browser language, the screen size, the app version,
   and the name of an action with at most a category: the interface language, an export format, a provider
   name, a file type, an error class (HTTP code range), a count range. The actions are listed in
   [src/usage-events.js](../src/usage-events.js) and the files that call `track`. No cookie, no diagram, no
   message, no file content, no key. It is turned off by "Do Not Track" and "Global Privacy Control". The
   code is in [src/analytics.js](../src/analytics.js).

Server storage and server exports do not exist in the online version: their server address is forced
to empty when the online version is built ([src/main.js](../src/main.js)).

## Local agent (MCP)

An AI agent installed on your computer can drive the page through the local relay `bpmn-pilot-mcp`,
that the agent starts itself ([relay/README.md](../relay/README.md), code in
[mcp/relay.js](../mcp/relay.js)).

- **Off by default.** The page opens a connection to your computer only after you turn on **Local
  agent** in the "Connect an agent" window (MCP button), and closes it when you turn it off. The choice
  is kept in the browser's local storage.
- **On your computer only.** The page connects to `ws://127.0.0.1:3333`. The relay listens on
  `127.0.0.1` only, accepts only the `https://bpmn.leylines.fr` page (checked from the `Origin` header,
  which a web page cannot forge) and only local host names. Chrome and Edge also ask you once to allow
  access to the local network.
- **Nothing goes through another server.** The diagram goes from the agent to the relay, then to the
  tab, and back. The relay writes nothing to disk and calls no service.
- **What the agent does with the diagram** depends on the agent and its AI provider, as for any file
  you give it. The audience measurement records no diagram and no message from the agent.

## What protects your keys and diagrams

- **No third-party script.** The Content Security Policy only allows the site's own scripts
  (`script-src 'self'`, plus one short inline script allowed by its hash). No CDN, no
  tracker script, no external font.
- **No HTML from outside.** The co-pilot's replies, diagram names and model names are shown as plain
  text, never interpreted as HTML. The code uses no `eval`.
- **No setting read from the address.** The page reads nothing from the URL's query string: a crafted
  link cannot change a provider address to divert a key.
- **No exit through the co-pilot.** The co-pilot's tools only read and change the diagram, or offer a
  download. None of them sends data to an address, so instructions hidden in a diagram or a PDF cannot
  make the co-pilot send your key elsewhere.
- **No display inside another site.** GitHub Pages cannot send the header that forbids it, so the page
  checks it itself: inside a frame of another page, the editor does not start and only shows a link that
  opens it in its own tab ([src/frame-guard.js](../src/frame-guard.js)). Nothing can be clicked without
  you seeing it.
- **Stored for this site only.** Other websites cannot read what this page keeps in your browser. The
  development page lives on its own address, so its code, built from changes not yet released, cannot
  read what the stable page keeps either.
- **A locked build.** Exact dependency versions (`npm ci` on the lock file), GitHub Actions pinned by
  commit, and no known vulnerability in the bundled dependencies (`npm audit`) on the review date.

## Known limits

- **Your own device.** A malicious browser extension, or someone using your session on the computer, can
  read a stored key. On a shared computer, leave "Remember API keys on your device" unchecked.
- **Stored keys are not encrypted.** Encrypting them in the browser would not help: the key to decrypt
  them would have to sit right next to them.
- **Open connections.** The page may connect to any `https` address, because you can choose any provider.
  Protection against a stolen key therefore rests on the points above (no third-party script, no HTML from
  outside), not on a list of allowed addresses.

## Good practice

- Use an API key created for this editor alone, with a limited validity period.
- Add a spending limit if your provider allows it. If the key leaks, it only works here, expires on its
  own and can be deleted without affecting anything else you use.
- On a shared computer, do not tick "Remember API keys on your device", and click "Clear API keys" when
  you are done.

## Check it yourself

Open the browser's developer tools on the page: the Network tab lists every request, and the
Application (or Storage) tab shows what is kept in the browser. The Content Security Policy is in the
`<meta http-equiv="Content-Security-Policy">` tag of the page. To report a problem, see
[SECURITY.md](../SECURITY.md).
