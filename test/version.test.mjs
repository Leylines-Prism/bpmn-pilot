import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))

// Le serveur MCP annonce la version de mcp/package.json aux clients et aux annuaires :
// elle doit suivre celle de l'application à chaque release.
test('the MCP server version matches the application version', () => {
  const app = read('../package.json').version
  assert.equal(read('../mcp/package.json').version, app, 'set "version" in mcp/package.json')
  const lock = read('../mcp/package-lock.json')
  assert.equal(lock.version, app, 'run npm install in mcp/ to update mcp/package-lock.json')
  assert.equal(lock.packages[''].version, app, 'run npm install in mcp/ to update mcp/package-lock.json')
})

// Les deux fichiers compose prêts à l'emploi tirent les images de la version en cours.
test('the compose files use the images of the application version', () => {
  const app = read('../package.json').version
  for (const file of ['../docker-compose.image.yml', '../docker-compose.headless.yml']) {
    const text = readFileSync(new URL(file, import.meta.url), 'utf8')
    const tags = [...text.matchAll(/ghcr\.io\/leylines-prism\/bpmn-pilot[a-z-]*:([^\s]+)/g)].map((m) => m[1])
    assert.ok(tags.length >= 2, `${file}: no image found`)
    for (const tag of tags) assert.equal(tag, app, `${file}: image tag ${tag} instead of ${app}`)
  }
})

// Le relais local de la version en ligne (paquet npm et extension Claude Desktop) porte aussi
// la version de l'application.
test('the local relay version matches the application version', () => {
  assert.equal(read('../relay/package.json').version, read('../package.json').version, 'set "version" in relay/package.json')
})
