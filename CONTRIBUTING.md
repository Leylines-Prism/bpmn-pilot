# Contributing

Thank you for your interest in this BPMN editor. **All contributions are welcome**: bug reports,
ideas, translations, documentation, BPMN examples, and code. If you want to help this project grow,
you are more than welcome here.

## A word about how this project is made

This is a personal project, maintained in spare time. Its author is not a professional developer:
the code is written with AI assistance, using Claude Code and other AI models, then tried in the
browser before each change. So:

- If you see something clumsy, fragile or simply wrong, say so. A short explanation in an issue
  helps as much as a fix.
- Experienced developers are especially welcome to review the code, the security of the MCP server,
  or the way the AI co-pilot handles API keys.
- AI-assisted contributions are fine too, as long as you have read and tested what you submit.

There is no guaranteed response time, but every issue and pull request is read.

## Where to start

- **A bug**: open an issue with the "Bug report" form.
- **An idea or a question**: start a [discussion](https://github.com/Leylines-Prism/bpmn-pilot/discussions),
  or open an issue with the "Idea" form.
- **A security problem**: never in public. See [SECURITY.md](SECURITY.md).
- **Something to code**: look at the issues labelled `good first issue` or `help wanted`. For a
  large change, open an issue first, so we can agree on the approach before you spend time on it.

## Run the project

You need Node.js 22 or later.

```
npm install
npm run dev          # the editor, at http://localhost:5173
cd mcp && npm install && npm start   # the MCP server and the built-in AI co-pilot
```

`npm run lint` checks the code with ESLint, and `npm test` runs the automated tests (Node.js test
runner, files in `test/`). Both run in CI on every pull request. `test/properties.test.mjs` uses
[fast-check](https://fast-check.dev/) to throw thousands of random inputs at the MCP server's
guards (file names, diagram ids, relay addresses). `test/fuzz/xml-and-tools.fuzz.test.js` does the
same for what comes from outside: imported BPMN and DMN XML (random, truncated or corrupted
documents) and the arguments of every MCP tool. When a property fails, the test prints the smallest
input that breaks the rule and a seed: `FC_SEED=<seed> npm test` replays the fuzz tests with it.
The fuzz tests are `.js` files on purpose, since OpenSSF Scorecard only looks for fast-check in
`.js`, `.jsx`, `.ts` and `.tsx` files.

`npm run dev:online` runs the editor as the online version (no server, API keys in the browser). The
[README](README.md) and [mcp/README.md](mcp/README.md) explain the rest.

## Pull requests

- One change per pull request, with a short description of what it does and how you tried it
  (screenshots are welcome for anything visible).
- Try your change in the browser, including the case that should fail (an invalid file, an empty
  diagram), and check the console for errors.
- Add or update automated tests in `test/` for any major new functionality, and for a bug fix
  when the bug can be reproduced outside the browser. `npm test` must pass.
- `npm run lint` must pass without errors.
- Dependencies use exact versions in `package.json` (no `^` or `~`).
- The user interface is in English and French: give both texts, with the `T('English', 'Français')` helper of `src/i18n/lang.js`.
- Commit messages, pull requests and issues are written in English.
- Never commit an API key, a token or a `.env` file.
- The automated checks (CI) must pass. For a first contribution, they start once the maintainer
  approves them.

The maintainer may ask for changes, or decline a pull request that does not fit the project. It is
never personal.

## Releases

A version is a `vX.Y.Z` tag, published from the Releases page. The tag builds the Docker images.
The online site has a stable page at its root, built from the latest tag, and a development page
built from main on its own address, published from another repository so that it cannot read
what the stable page keeps in the browser.

GitHub Pages keeps the deployment it already has when the same commit comes back. A tag placed on
a commit that main has already published therefore leaves the stable page on the previous version.
To avoid that, release in this order:

1. Open a pull request that bumps the version in `package.json`, `package-lock.json`,
   `mcp/package.json`, `mcp/package-lock.json` and the three image lines of
   `docker-compose.image.yml` (editor, mcp and data-init). The MCP server announces the version of
   `mcp/package.json` to clients and directories, and a test fails if it differs from the
   application's.
2. Once its checks pass, publish the release with the pull request's branch as its target (not
   main). The tag builds the Docker images and publishes the stable page from that commit.
3. Merge the pull request. The merge is a new commit, so the site is published again, with the
   new tag as its stable page.

Do not let main move between steps 2 and 3: the release must hold the same code as main after the
merge.

## License

By contributing, you agree that your contribution is released under the project's
[MIT License](LICENSE). The Leylines name and logo are not part of it.

## Code of conduct

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md). Be kind, especially to
newcomers.
