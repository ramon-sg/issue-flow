# Hooks, atajos y versiones desde `.agents/runner.json` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `issue-flow` deja de instalarse en el repo: lee y escribe `.agents/runner.json` con `@ramon-sg/runner`, escribe hooks y atajos con el ejecutor del repo (`bunx --bun …` o `npx --yes …`) y se publica con sus dependencias adentro (issue #65).

**Architecture:** Un módulo nuevo, `src/runner-file.ts`, es lo único que habla con `@ramon-sg/runner` (leer/crear el archivo, entradas de herramientas, atajos). `apply` lo usa para planear y escribir; `doctor` usa sus revisiones; `settings-hooks.ts` arma los comandos con `toolCommandText`. El paquete publicado es un bundle de esbuild (`bundle/cli.js`) sin `dependencies`; `dist/` (tsc) sigue siendo lo que importan los tests.

**Tech Stack:** TypeScript (NodeNext, ESM), `node:test`, `@ramon-sg/runner` 1.0.0, esbuild, Bun 1.4.4 / Node 20 y 24.

**Spec:** issue #65 y el diseño `ramon-sg/agent-kitchen` → `docs/superpowers/specs/2026-11-20-bunx-runner-design.md` (paso 3 de "Orden entre repos"). API de la biblioteca: `../runner/src/*.ts`. Spike: `../runner/docs/spike-2026-11-20.md`.

## Global Constraints

- Comando por `runner`: `bun` → `bunx --bun <paquete>@<versión> <args>`; `node` → `npx --yes <paquete>@<versión> <args>`. Siempre con `toolCommandText`/`toolCommand` de `@ramon-sg/runner`, nunca armado a mano.
- Sin `runner` en el archivo, el ejecutor es `bun` (`effectiveRunner`).
- Archivo nuevo: `chooseRunner` — `bun` si está; sin Bun y con terminal, pregunta (Node o salir); sin terminal (o con `--yes`, `--dry-run`, `--json`), `node` con `NO_BUN_WARNING`.
- `issue-flow` escribe solo su entrada y agrega `@ramon-sg/github-rest` si falta (`setTool(..., { ifMissing: true })`); nunca baja una versión (`allowLower` nunca se pasa).
- Ningún texto ni código de `issue-flow` dice `npx` fijo (skills, prompts por defecto, mensajes, README).
- El paquete publicado no tiene `dependencies`; `@ramon-sg/github-rest` (exacta, `0.6.0`), `@ramon-sg/runner` (`1.0.0`) y esbuild van en `devDependencies`.
- Los tests nunca corren `npx`/`bunx` reales: `npx` sin red se cuelga (spike, step 5). Todo ejecutor en el PATH de un test es un fake.
- Solo macOS/Linux (como `@ramon-sg/runner` 1.x).
- Nombres con scope siempre: `@ramon-sg/issue-flow`, `@ramon-sg/github-rest`, `@ramon-sg/runner`.
- Mensajes nuevos en `src/messages/es.ts` y `en.ts`; `--json` sigue en inglés.

## Review Focus

- **Repo con el modo viejo** (`devDependencies` con `issue-flow`/`github-rest` exactas y scripts `"issue-flow issue start"`): `apply` las quita, pasa la `github-rest` exacta que tenía a `runner.json` (si no hay entrada) y reemplaza los scripts viejos; sin ese reemplazo `writeScripts` los vería como ajenos (clash). Test en Task 4.
- **`runner.json` con `runner: "node"` y hooks `bunx` (o al revés):** `apply` reescribe los hooks aunque la versión sea la misma; `doctor` falla. Tests en Tasks 3 y 5.
- **`runner.json` inválido** (JSON roto, rango en vez de versión): `apply` sale 1 con el mensaje de `RunnerFileError` y no escribe nada; `doctor` lo muestra como check fallido. Tests en Tasks 4 y 5.
- **`runner.json` con `@ramon-sg/issue-flow` más nueva que la que corre:** `apply` se niega (como hoy con `package.json`). Test en Task 4.
- **`--dry-run` predice exactamente lo que escribe:** las líneas de `--dry-run --json` son las mismas que las de la corrida real (los atajos se predicen sin `writeScripts`, que no tiene modo seco). Test en Task 4.

---

## File Structure

- Create `src/runner-file.ts` — todo lo de `.agents/runner.json` para issue-flow: leer/crear, entradas, atajos (predicción y escritura), limpieza del modo viejo.
- Modify `src/settings-hooks.ts` — `hookCommand`/`registerHooks` reciben el `runner`.
- Modify `src/package-edits.ts` — se va `withFlowPackages` y `FLOW_SCRIPTS`; quedan `isNewer`, `reaches`, `dependencyVersion`, `GITHUB_REST`, `START_SCRIPT`, `FREE_SCRIPT`, y se agrega `LEGACY_SCRIPTS`.
- Modify `src/setup-files.ts` — `ownVersions()` lee la `github-rest` de `devDependencies` (exacta) y agrega la de `@ramon-sg/runner`.
- Modify `src/commands/apply.ts`, `src/commands/doctor.ts`, `src/cli.ts`, `src/cli-flags.ts`, `src/usage.ts`, `src/messages/{es,en}.ts`.
- Modify `src/config.ts`, `src/issue-text.ts`, `src/commands/issue-start.ts`, `src/start-modes.ts` — prompts sin `npx`.
- Modify `skills/*/SKILL.md`, `skills/github-issues/project.md.template`, `README.md`, `README.en.md`.
- Modify `package.json`, `.gitignore`, `.tool-versions`, `.github/workflows/test.yml`, `.github/workflows/publish.yml`.
- Tests: `test/init-helpers.mjs`, `test/fake-npx.mjs`, create `test/fake-bun.mjs`, `test/runner-file.test.mjs`; modify `test/apply.test.mjs`, `test/doctor-upgrade.test.mjs`, `test/pack.test.mjs`, `test/catalog.test.mjs`.

---

### Task 1: Dependencias, versiones propias y `--version --json`

**Files:**
- Modify: `package.json`, `.gitignore`, `src/setup-files.ts:50-70`, `src/cli.ts:191-200`, `src/cli-flags.ts` (OPTIONS), `src/usage.ts`
- Test: `test/pack.test.mjs`

**Interfaces:**
- Produces: `OwnVersions { issueFlow: string; githubRest: string; runner: string }` — `githubRest` es la versión exacta que lleva adentro (de `devDependencies`), `runner` la de `@ramon-sg/runner`. `ownVersions()` mantiene firma.
- Produces: `issue-flow --version` → `0.6.0\n`; `issue-flow --version --json` → `{"version":"0.6.0","githubRest":"0.6.0","runner":"1.0.0"}\n`.

- [ ] **Step 1: package.json.** `dependencies` sale entero. `devDependencies` suma `"@ramon-sg/github-rest": "0.6.0"` (exacta), `"@ramon-sg/runner": "1.0.0"`, `"esbuild"` (última 0.x exacta). `bin` → `bundle/cli.js`; `files` → `["bundle", "schema.json", "recipes"]`. Scripts: `"bundle": "esbuild src/cli.ts --bundle --platform=node --format=esm --target=node20 --outfile=bundle/cli.js"`, `"test": "tsc && npm run bundle && node --test test/*.test.mjs"`. `bundle/` a `.gitignore`. `npm install`. Si el bundle falla por un `require` de CJS, agregar `--banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"`.

- [ ] **Step 2: tests que fallan en `test/pack.test.mjs`.**
  - `"the package has the bundle, the schema and the recipes, and no dependencies"`: los archivos incluyen `bundle/cli.js`, ninguno empieza con `dist/`, `src/`, `test/`, `skills/`; `JSON.parse(package.json).dependencies === undefined`.
  - El test `"the packed CLI runs init outside this repo…"` deja de hacer `symlinkSync(... node_modules)`, corre `bundle/cli.js` y prueba `--version --json`: `assert.deepEqual(JSON.parse(r.stdout), { version: OWN.version, githubRest: "0.6.0", runner: "1.0.0" })`. (El resto de ese test se ajusta en Task 4.)

- [ ] **Step 3: correr** `npm test -- --test-name-pattern=package` → FAIL.

- [ ] **Step 4: implementar.** `ownVersions()` lee `pkg.devDependencies["@ramon-sg/github-rest"]` y `["@ramon-sg/runner"]`; lanza `SetupError` si alguna falta o no es exacta. En `main`, antes de `flags.help`: `if (flags.version)` imprime la versión, o el JSON con `--json`. `version` va en `OPTIONS` (boolean) y en el uso general de `usage.ts`.

- [ ] **Step 5: correr** `npm test` → PASS (salvo los tests de `apply` que esperan `devDependencies` en el repo: siguen pasando hasta Task 4, porque `withFlowPackages` todavía existe — si alguno rompe por `ownVersions`, ajustar solo la lectura de `OWN.dependencies` → `OWN.devDependencies`).

- [ ] **Step 6: commit** `feat: se publica como bundle sin dependencias y --version --json dice qué github-rest lleva (#65)`

### Task 2: `src/runner-file.ts`

**Files:**
- Create: `src/runner-file.ts`
- Modify: `src/package-edits.ts` (agregar `LEGACY_SCRIPTS`), `src/ask.ts` (si hace falta una pregunta de dos opciones)
- Test: `test/runner-file.test.mjs` (importa `../dist/runner-file.js`)

**Interfaces:**
- Consumes: `@ramon-sg/runner` (`readRunnerConfig`, `writeRunnerConfig`, `effectiveRunner`, `chooseRunner`, `setTool`, `toolCommandText`, `writeScripts`, `RunnerFileError`, tipos `Runner`, `RunnerConfig`); `OwnVersions` (Task 1).
- Produces:
  - `export const FLOW_OWNED = "@ramon-sg/issue-flow@"` — el `owned` de `writeScripts`.
  - `loadRunnerFile(root: string, ask: (() => Promise<Runner | null>) | undefined): Promise<{ config: RunnerConfig; created: boolean; warning: string | null } | null>` — lee; si no existe, `chooseRunner({ ask })` y config `{ runner, tools: {}, extra: {} }`. `null` si el usuario eligió salir. Convierte `RunnerFileError` en `SetupError` con el mismo mensaje.
  - `withFlowTools(config: RunnerConfig, versions: OwnVersions, legacyRest: string | null, t: Messages): { config: RunnerConfig; changes: string[]; kept: string[] }` — `setTool(PACKAGE, versions.issueFlow)`; `setTool(GITHUB_REST, legacyRest ?? versions.githubRest, { ifMissing: true })` (`legacyRest` solo si es exacta); `kept` con el aviso si la `github-rest` que queda es más vieja que `versions.githubRest`.
  - `flowScripts(runner: Runner, version: string): Record<string, string>` — `issue:start` → `toolCommandText(runner, PACKAGE, version, ["issue", "start"])`, `issue:start:free` → `[..., "--free"]`, `worktree:prune` → `["worktree", "prune"]`, `pr:worktree` → `["pr", "worktree"]`.
  - `withoutLegacy(pkg: Record<string, unknown>): { pkg: Record<string, unknown>; changes: string[]; removedDependencies: boolean }` — quita `PACKAGE` y `GITHUB_REST` de `dependencies` y `devDependencies` (borra el objeto si queda vacío) y los scripts cuyo valor es exactamente uno de `LEGACY_SCRIPTS`.
  - `predictScripts(pkg: Record<string, unknown> | null, scripts: Record<string, string>): { changes: string[]; clashes: string[] }` — misma regla que `writeScripts`: se escribe si falta o si el valor actual contiene `FLOW_OWNED`; si no, clash.
  - `pickScripts(pkg: Record<string, unknown> | null, scripts: Record<string, string>): { scripts: Record<string, string>; kept: string[] }` — la regla de hoy: con un `issue:start` propio (que no contiene `FLOW_OWNED` ni es legacy), no se ofrece `issue:start:free` y va `t.setup.keptFree` a `kept`.
- En `src/package-edits.ts`: `export const LEGACY_SCRIPTS: Record<string, string>` = el `FLOW_SCRIPTS` de hoy (`"issue-flow issue start"`, etc.).

- [ ] **Step 1: tests que fallan** en `test/runner-file.test.mjs` (con `mkdtemp` como raíz):
  - `flowScripts("bun", "0.6.0")["issue:start"] === "bunx --bun @ramon-sg/issue-flow@0.6.0 issue start"`; `flowScripts("node", "0.6.0")["pr:worktree"] === "npx --yes @ramon-sg/issue-flow@0.6.0 pr worktree"`.
  - `withFlowTools` sobre `{ tools: {} }` agrega las dos; sobre `{ tools: { "@ramon-sg/github-rest": "0.9.0" } }` no la toca; sobre `github-rest` `0.5.0` no la sube y `kept.length === 1`; con `legacyRest: "0.7.0"` y sin entrada, escribe `0.7.0`; con `legacyRest: "^0.7.0"`, escribe `versions.githubRest`.
  - `withoutLegacy({ devDependencies: { "@ramon-sg/issue-flow": "0.5.1", "@ramon-sg/github-rest": "0.6.0" }, scripts: { "issue:start": "issue-flow issue start", lint: "eslint" } })` → sin `devDependencies`, `scripts` solo con `lint`, `removedDependencies === true`. Un `devDependencies` con `typescript` queda con `typescript`.
  - `predictScripts({ scripts: { "issue:start": "./wrap.sh" } }, flowScripts("bun","0.6.0")).clashes` → `["issue:start"]`; un `issue:start` con `@ramon-sg/issue-flow@0.5.0` → en `changes`.
  - `loadRunnerFile` con `.agents/runner.json` = `{"runner":"node","tools":{}}` → `created === false`, `config.runner === "node"`; con `"tools": {"x": "^1.0.0"}` → lanza `SetupError`.

- [ ] **Step 2: correr** `npm test -- --test-name-pattern=runner-file` (o el archivo) → FAIL (módulo no existe).

- [ ] **Step 3: implementar** `src/runner-file.ts` con esas firmas y `LEGACY_SCRIPTS` en `package-edits.ts`. Las líneas de `changes` siguen el estilo de hoy (`tools: @ramon-sg/issue-flow 0.5.1 → 0.6.0`, `scripts: issue:start`, `devDependencies: sin @ramon-sg/issue-flow`); textos en `messages`.

- [ ] **Step 4: correr** → PASS.

- [ ] **Step 5: commit** `feat: runner-file lee y escribe .agents/runner.json con @ramon-sg/runner (#65)`

### Task 3: Hooks con el comando del ejecutor

**Files:**
- Modify: `src/settings-hooks.ts:29-120`, `src/messages/{es,en}.ts` (`setup.rewroteHook`)
- Test: `test/apply.test.mjs` (los tests de hooks se ajustan en Task 4; aquí un test unitario nuevo en `test/runner-file.test.mjs` o `test/settings-hooks.test.mjs`)

**Interfaces:**
- Produces: `hookCommand(event: string, runner: Runner, version: string): string` — `toolCommandText(runner, PACKAGE, version, sub.split(" "))` + `note`. Ej.: `hookCommand("WorktreeCreate", "bun", "0.6.0") === "bunx --bun @ramon-sg/issue-flow@0.6.0 hook worktree-create"`.
- Produces: `registerHooks(settings, runner: Runner, version: string, t)` — igual que hoy, pero reemplaza también un hook nuestro con la misma versión y otro comando (otro ejecutor): change `t.setup.rewroteHook(event, runner)`.
- `hookVersions` no cambia (su regex ya calza con `bunx --bun` y `npx --yes`).
- Produces: `ourHookCommands(settings): string[]` — los comandos de nuestros hooks, para `checkToolPins` (Task 5).

- [ ] **Step 1: tests que fallan** (`test/settings-hooks.test.mjs`, importa `../dist/settings-hooks.js` y `../dist/messages/index.js`):
  - `hookCommand("SessionStart", "node", "0.6.0") === "npx --yes @ramon-sg/issue-flow@0.6.0 session # runs agent-cloud-kit session in the cloud"`.
  - `registerHooks` sobre settings con `npx --yes @ramon-sg/issue-flow@0.6.0 hook worktree-create` y `runner: "bun"`, versión `0.6.0` → el comando pasa a `bunx --bun …` y hay un change.
  - Dos corridas seguidas con el mismo runner → la segunda sin changes.

- [ ] **Step 2: correr** → FAIL.
- [ ] **Step 3: implementar** las firmas de arriba; actualizar el único llamador (`apply.ts`) pasando `"bun"` provisoriamente hasta Task 4.
- [ ] **Step 4: correr** `npm test` → PASS salvo `apply.test.mjs` que espera `npx --yes` (se reescribe en Task 4; si se ejecuta este task solo, ajustar `SESSION` del test a `bunx --bun`).
- [ ] **Step 5: commit** `feat: los hooks usan el ejecutor de .agents/runner.json (#65)`

### Task 4: `apply` con `runner.json`

**Files:**
- Modify: `src/commands/apply.ts`, `src/package-edits.ts` (se va `withFlowPackages`), `src/messages/{es,en}.ts`
- Create: `test/fake-bun.mjs`
- Modify: `test/fake-npx.mjs`, `test/init-helpers.mjs`, `test/apply.test.mjs`, `test/pack.test.mjs`

**Interfaces:**
- Consumes: todo lo de Tasks 1–3.
- Test helpers (produce): `withNpx(s)` además hace que `npx --version` y `npm --version` respondan `10.9.0` con exit 0 **sin** loguear; `withBun(s)` pone `bun` y `bunx` fakes en `${s.tmp}/bin` (`--version` → `1.4.4`, exit 0, sin loguear; cualquier otra llamada se loguea con `program: "bun"|"bunx"` y sale 1); `runnerCalls(s, program)` lee el log.

`apply` queda así (orden de `plan`):
1. `checkVersion`: además de `package.json` (legacy) y hooks, mira `tools["@ramon-sg/issue-flow"]` de `runner.json` (leído sin crear). Más nueva → `SetupError` (`t.apply.newer`, `where` = `.agents/runner.json`).
2. `loadRunnerFile(root, ask)` — `ask` solo si `out.interactive && !yes && !dryRun && !json`; responde `node` o `null`. `null` → `warn(t.apply.nothingWritten)` y exit 1. `warning` → `warn`.
3. `withFlowTools(config, versions, legacyRest)` con `legacyRest = dependencyVersion(pkg, GITHUB_REST)`.
4. `registerHooks(settings, effectiveRunner(config), versions.issueFlow, t)`.
5. Config/recetas como hoy.
6. `package.json`: si existe, `withoutLegacy`; `pickScripts` + `predictScripts` sobre el resultado → changes/kept (clashes van a `kept` con `t.setup.keptScript(name)`).
- Escritura (si no es dry-run), en orden: settings, `RUNNER_FILE` (`writeRunnerConfig`), config, `package.json` limpio (`writeJson`, solo si `withoutLegacy` cambió algo), y `writeScripts(root, runner, scripts, FLOW_OWNED)`.
- `next`: `${packageManager} install` solo si `removedDependencies` y al `package.json` le quedan `dependencies` o `devDependencies`; si no, solo `t.apply.reviewCommit`.
- JSON de salida igual que hoy (`version, changes, kept, written, next`).

- [ ] **Step 1: tests que fallan** en `test/apply.test.mjs` (reescribir los que esperan `devDependencies`; `PATH` del sandbox es `${tmp}/bin:/usr/bin:/bin`):
  - `"apply --yes in a repo without package.json writes runner.json, hooks and shortcuts, and no node_modules"` (con `withBun`): `runner.json` = `{ $schema: …, runner: "bun", tools: { "@ramon-sg/github-rest": "0.6.0", "@ramon-sg/issue-flow": VERSION } }` (comparar `runner` y `tools`); `package.json` = `{ private: true, packageManager: "bun@1.4.4", scripts: {4 atajos con bunx --bun} }` sin `devDependencies`; hooks `bunx --bun …@VERSION …`; `existsSync(node_modules) === false`; `npxCalls(s) = []`, `runnerCalls(s,"bunx") = []`; `out` dice `Next: review the diff and commit it` (sin install).
  - `"with runner node everything runs with npx --yes"`: `runner.json` previo `{"runner":"node","tools":{}}`; hooks y atajos empiezan con `npx --yes @ramon-sg/issue-flow@VERSION`; `packageManager` no se agrega si `package.json` ya existía.
  - `"without Bun and without a terminal it picks node with a warning"`: sin `withBun`; `runner.json.runner === "node"`; `err` contiene `Bun is not installed`.
  - `"in a terminal without Bun it asks, and saying no writes nothing"` (con `tty`, respuesta `n`): exit 1, no existe `.agents/runner.json` ni `.claude/settings.json`.
  - `"apply moves a repo off devDependencies"`: `package.json` con `devDependencies: { "@ramon-sg/issue-flow": "0.5.1", "@ramon-sg/github-rest": "0.6.0", typescript: "5.9.3" }` y scripts legacy → `devDependencies` = `{ typescript }`, scripts con `bunx --bun`, `runner.json.tools["@ramon-sg/github-rest"] === "0.6.0"`, `Next:` incluye `npm install`.
  - `"apply keeps a script of the repo"`: `issue:start: "./scripts/start.sh"` → no cambia, sin `issue:start:free`, `kept` lo dice.
  - `"apply refuses a runner.json with a newer issue-flow"` → exit 1, nada escrito.
  - `"apply with an invalid runner.json writes nothing"` (`"tools": {"@ramon-sg/issue-flow": "^0.5.0"}`) → exit 1, mensaje de la biblioteca.
  - `"apply twice changes nothing"` (ya existe; mantener, comparando también `runner.json`).
  - `"--dry-run --json lists the same changes as the real run"`: `changes` de `apply --dry-run --json --yes` === `changes` de `apply --json --yes` en sandboxes iguales; el dry-run no crea archivos.
  - En `pack.test.mjs`, el test del CLI empacado: corre `bundle/cli.js init --yes` con un `PATH` que tiene `bun`/`bunx` fakes y espera `runner.json.tools["@ramon-sg/issue-flow"] === version` en vez de `devDependencies`.

- [ ] **Step 2: correr** `npm test -- --test-name-pattern=apply` → FAIL.
- [ ] **Step 3: implementar** `apply` como arriba; borrar `withFlowPackages`/`FLOW_SCRIPTS` y sus mensajes sin uso; actualizar el comentario de cabecera de `apply.ts` y `package-edits.ts` (sin "npx").
- [ ] **Step 4: correr** `npm test` → PASS (`doctor-upgrade` puede fallar hasta Task 5).
- [ ] **Step 5: commit** `feat: apply escribe .agents/runner.json, hooks y atajos con el ejecutor, sin devDependencies (#65)`

### Task 5: `doctor` con `runner.json`

**Files:**
- Modify: `src/commands/doctor.ts`, `src/messages/{es,en}.ts`
- Test: `test/doctor-upgrade.test.mjs`

**Interfaces:**
- Consumes: `checkRunner`, `checkToolPins` (biblioteca), `ourHookCommands` (Task 3), `flowScripts`/`FLOW_OWNED` (Task 2), `ownVersions` (Task 1).
- La salida `--json` mantiene la forma `{ name, ok, detail }[]`. Un `Check` de la biblioteca se traduce: `ok = status !== "fail"`, `detail` tal cual.

Checks, en orden: config (igual); `checkRunner(root)`; `@ramon-sg/issue-flow` en `tools` === esta versión (hint como hoy: `issue-flow apply` si es esta, `agent-kitchen` si no); `@ramon-sg/github-rest` en `tools`, presente y no más vieja que `versions.githubRest` (`t.doctor.restOld` dice "lleva adentro X"); `checkToolPins(root, PACKAGE, [...ourHookCommands(settings), ...los valores de package.json.scripts que contienen FLOW_OWNED])`; un check por hook: está, y su comando === `hookCommand(event, runner, version)` (si la versión coincide pero no el ejecutor, `t.doctor.hookRunner`); `devDependencies`/`dependencies` sin `issue-flow` ni `github-rest` (si están: falla con "quítalas con apply").

- [ ] **Step 1: tests que fallan** (reescribir los que miran `devDependencies`):
  - Después de `apply --yes` (con `withBun`), `doctor` → exit 0, todo `✓`.
  - `"doctor fails when a shortcut is at another version"`: editar `issue:start` a `@0.0.1` → exit 1 y la línea nombra `issue:start`'s texto.
  - `"doctor fails when a hook uses another runner"`: `runner.json.runner = "node"` sin reaplicar → exit 1.
  - `"doctor fails when github-rest is older than the one inside"`: `tools["@ramon-sg/github-rest"] = "0.5.0"` → exit 1.
  - `"doctor shows an invalid runner.json as a failed check"` → exit 1, no lanza.
  - `"doctor fails while devDependencies still have issue-flow"`.
  - `--json` sigue en inglés y con `{ name, ok, detail }`.
- [ ] **Step 2: correr** → FAIL.
- [ ] **Step 3: implementar.** Actualizar el comentario de cabecera.
- [ ] **Step 4: correr** `npm test` → PASS.
- [ ] **Step 5: commit** `feat: doctor revisa runner.json, que hooks y atajos digan su versión y la github-rest de adentro (#65)`

### Task 6: Sin `npx` fijo en prompts, mensajes, skills y README

**Files:**
- Modify: `src/config.ts:88-95`, `src/issue-text.ts:194-206`, `src/commands/issue-start.ts:234`, `src/messages/{es,en}.ts` (líneas con `npx`: `runApply`, `runAgentKitchen`, `notExact`, `newer`, el de `npx -y ${pkg}@1 setup`), `skills/*/SKILL.md`, `skills/github-issues/project.md.template`, `README.md`, `README.en.md`, `schema.json` (descripciones de los prompts, si mencionan `npx`)
- Test: `test/catalog.test.mjs`, `test/issue-start.test.mjs`

**Decisiones:**
- Prompts por defecto: `npx @ramon-sg/github-rest issue view {number}` → `` `{githubRest} issue view {number}` `` y `PR_LANGUAGE_PROMPT` igual con `{githubRest} pr edit …`. `{githubRest}` lo llena `issue-start` con `toolCommandText(runner, GITHUB_REST, versión)` de `runner.json`; sin archivo o sin entrada, `@ramon-sg/github-rest (con el ejecutor y la versión de .agents/runner.json)`. Un prompt del repo sin `{githubRest}` queda como está (`fill` deja intactos los desconocidos y los no usados).
- Mensajes que sugieren correr una herramienta: `npx agent-kitchen apply` pasa a `agent-kitchen apply` (no se asume ejecutor); `issue-flow apply` como `toolCommandText(runner, PACKAGE, versión, ["apply"])` cuando se conoce el runner, si no `@ramon-sg/issue-flow@<versión> apply`. El de setup de la nube (`npx -y ${pkg}@1 setup`) es de `agent-cloud-kit` y su paso del diseño (6): se deja igual y no cuenta como "texto de issue-flow sobre herramientas que corre".
- Skills: cada `SKILL.md` que corre herramientas suma arriba una sección corta **"Cómo se corren las herramientas"**: "Corre `@ramon-sg/github-rest` y `@ramon-sg/issue-flow` con el ejecutor y la versión de `.agents/runner.json`: con `"runner": "bun"` (o sin `runner`), `bunx --bun <paquete>@<versión> <args>`; con `"node"`, `npx --yes <paquete>@<versión> <args>`. Abajo, `github-rest …` e `issue-flow …` abrevian ese comando." Los bloques pasan de `npx @ramon-sg/github-rest pr find` a `github-rest pr find`, y de `npx @ramon-sg/issue-flow …` a `issue-flow …`. Fuera de los bloques, ninguna mención a "dependencia de desarrollo". Atajos que el usuario corre (`bun run issue:start 42`) se quedan.
- README (es y en): instalación, `apply` (punto 2 pasa a describir `runner.json` + atajos sin dependencias), `doctor`, sección de skills, y la tabla de "cómo se lanza" (`issue-flow` o `npx` → `bunx --bun @ramon-sg/issue-flow@<v>` o `npx --yes …`).

- [ ] **Step 1: tests que fallan.**
  - `test/catalog.test.mjs`: `"no skill runs npx"` — ningún archivo de `skills/` contiene `/\bnpx @ramon-sg\//`; `"every skill that runs a tool explains how"` — si un `SKILL.md` contiene `github-rest ` o `issue-flow ` en un bloque de código, contiene `.agents/runner.json`. El test existente de `ISSUE_FLOW_COMMAND` sigue funcionando con `issue-flow <cmd>`.
  - `test/issue-start.test.mjs`: con `runner.json` `{"runner":"node","tools":{"@ramon-sg/github-rest":"0.6.0"}}`, el prompt con que se lanza el fake claude contiene `` `npx --yes @ramon-sg/github-rest@0.6.0 issue view 34` ``; sin `runner.json`, contiene `.agents/runner.json`.
  - Un test que recorre `src/**/*.ts` y `README*.md` y falla con `npx @ramon-sg/` o `npx --yes @ramon-sg/issue-flow` escritos fijos (excepción: la línea de `agent-cloud-kit … setup`).
- [ ] **Step 2: correr** → FAIL.
- [ ] **Step 3: implementar** según las decisiones de arriba.
- [ ] **Step 4: correr** `npm test` → PASS.
- [ ] **Step 5: commit** `docs: skills, prompts y README sin npx fijo: corren con el ejecutor de runner.json (#65)`

### Task 7: CI con Node y Bun, versión 0.6.0

**Files:**
- Modify: `.tool-versions` (agregar `bun 1.4.4`), `.github/workflows/test.yml`, `.github/workflows/publish.yml`, `package.json` (`version` → `0.6.0`)

- [ ] **Step 1:** `test.yml` copia el de `../runner/.github/workflows/test.yml`: job `node` (matriz 20, 24, `npm ci && npm test`) y job `bun` (`setup-node` 24 + `oven-sh/setup-bun@v2` con `bun-version-file: .tool-versions`, `npm ci`, `npx tsc`, `npm run bundle`, `bun test --timeout 20000 test/`). `publish.yml`: `npm test` ya incluye el bundle; nada más.
- [ ] **Step 2: correr local** `npx tsc && npm run bundle && bun test --timeout 20000 test/`. Arreglar lo que falle por diferencias de `node:test` en Bun en los tests (no en `src/`, salvo un bug real del CLI con Bun, que se arregla en `src/` con su test).
- [ ] **Step 3:** `version` → `0.6.0`; `npm install` para el lockfile; `npm test` → PASS.
- [ ] **Step 4: commit** `ci: tests con Node y Bun; versión 0.6.0 (#65)`

### Cierre (fuera de los tasks)

- PR contra `main` que cierra #65. Publicar (release `v0.6.0`) y avisar a `agent-kitchen` el mínimo **solo con OK del usuario**.
