# Idiomas y mensajes finales: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que la terminal de issue-flow hable español por defecto (inglés con `--lang en` o `ISSUE_FLOW_LANG=en`), con mensajes finales en bloque junto a Kuro y un comando para retomar que repite cómo se lanzó.

**Architecture:** el idioma se resuelve una vez en `src/cli.ts` y viaja en `Output` como `out.t`, un catálogo con tipo (`src/messages/{es,en}.ts`). Un módulo puro `src/banner.ts` arma los bloques finales. `again()` pasa a recibir un `Launch` (gestor, script y flags) que se calcula en `cli.ts` a partir de `npm_lifecycle_event` y `npm_config_user_agent`.

**Tech Stack:** TypeScript 5.9 (`tsc` → `dist/`), Node ≥ 20, `node:test` contra `dist/`. Sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-11-04-idiomas-y-mensajes-design.md`

## Global Constraints

- Idioma de la terminal: `--lang es|en` > `ISSUE_FLOW_LANG=es|en` > `es`. `LANG` y `LC_ALL` no se leen. Un valor desconocido es `UsageError` (exit 2). Un `ISSUE_FLOW_LANG` vacío cuenta como si no existiera.
- **Nada de lo que se escribe en GitHub o se lee de ahí cambia**: `src/config.ts` (plantillas, etiquetas), los marcadores y las palabras de cierre de `src/issue-text.ts`, `src/branch-name.ts` y `skills/github-issues/check-issue.sh`. Esos textos no van al catálogo.
- `--json` no cambia. Sus textos en lenguaje natural usan siempre el catálogo `en` (`messages("en")`), nunca `out.t`.
- El texto `en` de cada mensaje es **idéntico** al actual, así los tests existentes siguen pasando sin tocarse. Los únicos que cambian a propósito son los mensajes finales (Tareas 5 y 6).
- El español es neutro, de tú y con tildes, en el mismo tono llano que las skills. El `--help` en español conserva todo el detalle del inglés: flags, ejemplos y diferencias entre gestores.
- Kuro es byte a byte el dibujo de la issue #49:
  ```
      ▄█████▄
   ≋≋██▀▀▀▀▀██
      █ ▄  ▄ █   ╱
      ▀█▄▄▄▄█▀  ╱
  ```
  Las cuatro líneas, sin espacios al final: `"    ▄█████▄"`, `" ≋≋██▀▀▀▀▀██"`, `"    █ ▄  ▄ █   ╱"`, `"    ▀█▄▄▄▄█▀  ╱"`.
- Marcas de estado en ASCII: `[ok]`, `[!]` y `[?]`.
- Sin color si existe `NO_COLOR` o si el stream no es una terminal.
- Rama de trabajo: `feat/49-idiomas-y-kuro`. Antes de cada commit, confirma con `git branch --show-current` que sigues en esa rama: otras sesiones cambian la rama en este checkout. Haz push con refspec explícito.
- El PR cierra la #49.

## Review Focus

1. **Las preguntas `[y/N]` en español:** se muestran como `[s/N]` y aceptan `s`, `si`, `sí`, `y` y `yes`. Si se traduce el texto pero no el parser, un "s" pasaría como "no" y la pregunta de borrar el worktree se saltaría en silencio. → test en la Tarea 3.
2. **`npm_lifecycle_event` de un script ajeno:** por ejemplo un `npm run dev` que llama a `issue-flow`, o `npm test`. Se tiene que caer a `issue-flow issue start <n>`. → test en la Tarea 4.
3. **npm con flags:** `npm run issue:start:free 34` funciona sin `--`. Con cualquier flag adicional se necesita `npm run issue:start -- 34 --no-repo-deny`, porque sin el `--` npm se queda los flags. → test en la Tarea 4.
4. **`--lang` en cualquier subcomando**, incluidos `doctor`, `hook …` y `labels sync`. `ownFlags()` no lo puede rechazar, y con `--json` el JSON sale igual en ambos idiomas. → test en la Tarea 1.
5. **Valores largos en el bloque**, como ramas largas o rutas de worktree. No se truncan ni se parten: el comando para copiar tiene que salir entero en su línea. → test en la Tarea 5.

---

### Task 1: Idioma, catálogo y `out.t`

**Files:**
- Create: `src/lang.ts`, `src/messages/es.ts`, `src/messages/en.ts`, `src/messages/index.ts`
- Modify: `src/output.ts`, `src/cli-flags.ts` (`OPTIONS.lang`), `src/cli.ts` (`main`, `ownFlags`, entrada), `test/helpers.mjs` y `test/start-helpers.mjs` (por defecto `ISSUE_FLOW_LANG: "en"` antes de `...env`)
- Test: `test/lang.test.mjs`

**Interfaces:**
- Produces:
  - `type Lang = "es" | "en"`
  - `resolveLang(flag: string | undefined, env: NodeJS.ProcessEnv): Lang`, que lanza `UsageError("--lang expects es or en: <x>")` (o `ISSUE_FLOW_LANG expects …`).
  - `interface Messages`, definida por la forma de `es.ts`: `export const es = {…}`, `export type Messages = typeof es`, y `en.ts` exporta `en: Messages`.
  - `messages(lang: Lang): Messages`
  - `Output` gana `t: Messages`, `lang: Lang` y `terminal: { stdout: boolean; stderr: boolean }`.
  - `processOutput(lang: Lang): Output`
- Las tareas siguientes agregan claves a `es.ts` y `en.ts`. Las claves se agrupan por área (`cli`, `start`, `worktree`…) y cada mensaje es un string o `(…args) => string`.

- [ ] **Step 1: Crear la rama.** `git switch -c feat/49-idiomas-y-kuro main` y comprobar con `git branch --show-current`. Commitear el spec y este plan (`docs/superpowers/`) como `docs: diseño y plan de idiomas y Kuro`.
- [ ] **Step 2: Escribir los tests que fallan** en `test/lang.test.mjs`:
  - `resolveLang(undefined, {})` → `"es"`
  - `resolveLang(undefined, { LANG: "en_US.UTF-8" })` → `"es"`
  - `resolveLang(undefined, { ISSUE_FLOW_LANG: "en" })` → `"en"`
  - `resolveLang("es", { ISSUE_FLOW_LANG: "en" })` → `"es"`
  - `resolveLang(undefined, { ISSUE_FLOW_LANG: "" })` → `"es"`
  - `resolveLang("fr", {})` lanza un error que menciona `es or en`
  - Paridad: las claves de `messages("es")` y `messages("en")` son iguales, recorridas en profundidad, y en cada clave los dos lados tienen el mismo `typeof`.
  - Integración con el sandbox de `helpers.mjs`: `doctor --json --lang es` y `doctor --json --lang en` dan el mismo JSON. `doctor --lang fr` termina con status 2.
- [ ] **Step 3: Correr** `npm test`. Esperado: FAIL, porque `dist/lang.js` no existe.
- [ ] **Step 4: Implementar.** En `main`, `--lang` se acepta en cualquier comando, igual que `--repo` y `--help`. La entrada resuelve el idioma antes que todo lo demás y arma el `Output` con él. Un error de `--lang` se imprime con el catálogo `es`. Por ahora el catálogo solo tiene la clave de ese error. `UsageError` y el resto de la entrada no cambian.
- [ ] **Step 5: Correr** `npm test`. Esperado: PASS, con todos los tests existentes en verde gracias a `ISSUE_FLOW_LANG: "en"` en los helpers.
- [ ] **Step 6: Commit** `feat: elige el idioma de la terminal (--lang, ISSUE_FLOW_LANG, español por defecto)`

### Task 2: Ayuda y errores de uso en dos idiomas

**Files:**
- Modify: `src/usage.ts` (`USAGE`, `START_USAGE` y `usageOf` pasan a depender del idioma), `src/cli.ts` (todos los `UsageError(…)`), `src/messages/*.ts`
- Test: `test/lang.test.mjs`. Revisa también el test que hoy compara la ayuda con `OPTIONS` (`grep -l usage test/*.mjs`).

**Interfaces:**
- Consumes: `Messages` y `out.t` (Tarea 1).
- Produces: `usageOf(words: string[], t: Messages): string`. La ayuda vive en el catálogo como `t.usage.main` y `t.usage.start`.

- [ ] **Step 1: Tests que fallan.**
  - `issue-flow --help` sin `ISSUE_FLOW_LANG` incluye `Uso:` y `npm run issue:start:free 42`.
  - Con `ISSUE_FLOW_LANG=en`, la salida es idéntica a la de hoy.
  - `issue start --help` en `es` menciona `--free`, `--no-repo-deny` y la nota de npm con `--`.
  - El test que verifica que cada flag de `OPTIONS` aparece en la ayuda corre también con la ayuda en `es`, y la ayuda de ambos idiomas menciona `--lang`.
- [ ] **Step 2: Correr** `npm test`. Esperado: FAIL.
- [ ] **Step 3: Implementar.** Mover el texto actual a `en` sin cambios y agregar `--lang es|en` a la línea de flags globales. Traducir a `es`. Los `UsageError` de `cli.ts` toman su texto de `out.t`.
- [ ] **Step 4: Correr** `npm test`. Esperado: PASS.
- [ ] **Step 5: Commit** `feat: ayuda y errores de uso en español e inglés`

### Task 3: Textos de `issue start` y de las preguntas

**Files:**
- Modify: `src/ask.ts`, `src/start-summary.ts`, `src/start-place.ts`, `src/start-modes.ts`, `src/commands/issue-start.ts`, `src/launch.ts`, `src/plan-doc.ts`, `src/session-lock.ts`, `src/messages/*.ts`
- Test: `test/issue-start.test.mjs`, `test/lang.test.mjs`

**Interfaces:**
- Consumes: `out.t`. `StartState.out` ya es un `Output`, así que no hace falta nuevo plumbing.
- Produces: `confirm(out: Output, question: string): Promise<boolean>`. Si hoy el nombre o la firma son otros, se conservan y solo se agrega lo que falte. En `es` muestra `[s/N]` y acepta `s|si|sí|y|yes` sin importar mayúsculas. En `en` sigue igual: `[y/N]`, `y|yes`.

- [ ] **Step 1: Tests que fallan.**
  - Con el sandbox de `start-helpers.mjs` y `env: { ISSUE_FLOW_LANG: "es" }`, el resumen de `issue start 214 --dry-run` incluye las etiquetas traducidas. Usa las del catálogo `es`, por ejemplo `Rama:`.
  - Con `runTty` en `es` y respuesta `s`, la pregunta se toma como sí. `runTty` hoy espera `[y/N]`: agrégale un parámetro opcional para la marca que espera.
  - Todos los asserts existentes siguen iguales en `en`.
- [ ] **Step 2: Correr** `npm test`. Esperado: FAIL.
- [ ] **Step 3: Implementar.** Pasar al catálogo los textos de esos archivos que se muestran en la terminal, tanto en stdout como en stderr. `StartError` toma su mensaje del catálogo. `describeBranch` y `plannedActions` también: van al resumen de la terminal y no a GitHub. **No** tocar lo que arma `prBody`, el commit inicial ni los prompts.
- [ ] **Step 4: Correr** `npm test`. Esperado: PASS.
- [ ] **Step 5: Commit** `feat: issue start habla español`

### Task 4: `again()` repite cómo se lanzó

**Files:**
- Create: `src/launch-as.ts`
- Modify: `src/start-state.ts` (`StartOptions.launchedAs`, `again`), `src/cli.ts` (arma `launchedAs`), los 13 llamadores de `again(` (`grep -rn "again(" src`), `src/package-edits.ts` (exportar `START_SCRIPT` y `FREE_SCRIPT`)
- Test: `test/launch-as.test.mjs`

**Interfaces:**
- Produces:
  - `type Manager = "bun" | "npm" | "pnpm" | "yarn"`
  - `interface Launch { manager: Manager | null; script: "issue:start" | "issue:start:free" | null; flags: string[] }`
  - `launchOf(env: NodeJS.ProcessEnv, flags: Flags): Launch`. `script` solo se llena si `npm_lifecycle_event` es `START_SCRIPT` o `FREE_SCRIPT`. `manager` es lo que va antes de la primera `/` en `npm_config_user_agent`, si es uno de los cuatro. Si falta cualquiera de los dos, ambos quedan en `null`.
  - `flags` guarda, en este orden, los que vinieron: `--ask-permissions`, `--free` (salvo que el script sea `issue:start:free`), `--no-repo-deny`, `--namer <x>`, `-R <x>`, `--lang <x>`. Nunca guarda `--new`, `--branch`, `--yes`, `--dry-run`, `--resume`, `--no-launch` ni `--plan`.
  - `again(options: StartOptions, extra?: string): string`. `StartOptions` gana `launchedAs: Launch`.

- [ ] **Step 1: Tests que fallan**, sobre `launchOf` + `again` con un `StartOptions` mínimo:
  - bun + `issue:start:free` + `--no-repo-deny` → `bun run issue:start:free 34 --no-repo-deny`
  - npm + `issue:start:free`, sin flags → `npm run issue:start:free 34`
  - npm + `issue:start` + `--free` → `npm run issue:start -- 34 --free`
  - pnpm → `pnpm issue:start:free 34`
  - yarn → `yarn issue:start:free 34`
  - sin variables → `issue-flow issue start 34`
  - `npm_lifecycle_event: "test"` o `"dev"` → `issue-flow issue start 34`
  - `--yes --new --free` directo → `issue-flow issue start 34 --free`
  - `extra: "--teleport"` va al final: con npm, `npm run issue:start -- 34 --teleport`
  - `--lang en` como flag se repite. Con `ISSUE_FLOW_LANG` no.
- [ ] **Step 2: Correr** `npm test`. Esperado: FAIL.
- [ ] **Step 3: Implementar** y actualizar los llamadores. Donde hoy se pasa solo `number`, se pasa `state.options` u `options`.
- [ ] **Step 4: Correr** `npm test`. Esperado: PASS. Los tests existentes no definen esas variables, así que siguen viendo `issue-flow issue start …`.
- [ ] **Step 5: Commit** `feat: el comando para retomar repite cómo se lanzó issue-flow`

### Task 5: `banner()` con Kuro y `art` en la config

**Files:**
- Create: `src/banner.ts`
- Modify: `src/config.ts` (`FlowConfig.art: boolean`, por defecto `true`, validada como las demás secciones), `schema.json` (`art`, boolean, con descripción en inglés como el resto)
- Test: `test/banner.test.mjs`, `test/config.test.mjs`

**Interfaces:**
- Produces:
  - `type Mood = "ok" | "error" | "question"` → marcas `[ok]`, `[!]` y `[?]`
  - `interface Block { mood: Mood; title: string; rows?: [label: string, value: string][]; next?: { label: string; command: string }; lines?: string[] }`
  - `banner(block: Block, opts: { art: boolean; color: boolean }): string`
  - `KURO: readonly string[]`, las cuatro líneas de Global Constraints
  - `blockOpts(out: Output, stream: "stdout" | "stderr", config: FlowConfig | null): { art: boolean; color: boolean }`. Para `art` exige la terminal del stream y `config?.art !== false`. Para `color`, la terminal del stream y que no exista `NO_COLOR`.

  Disposición con `art: true`:
  - Una línea en blanco antes y otra después.
  - Las líneas de Kuro se rellenan hasta 26 columnas visibles y el texto empieza ahí. Kuro ocupa las filas 0 a 3 y el texto empieza en la fila 1. El texto es: `"<marca> <title>"`, `""`, las filas alineadas por el label más largo + 2, `""`, `next.label` y `"  " + next.command`.
  - Las filas que pasan de Kuro llevan 26 espacios.
  - Con `art: false`, la sangría es de 2 espacios y no hay dibujo.
  - El color va en el título según el mood: verde para ok, rojo para error y amarillo para pregunta, más negrita en `command`. Kuro va sin color.

- [ ] **Step 1: Tests que fallan.**
  - `KURO.join("\n")` es igual al string exacto de Global Constraints.
  - `banner({ mood:"ok", title:"Sesión guardada - issue #34", rows:[["Rama","feat/34-x"],["PR","#51 (draft)"]], next:{label:"Para retomarla:", command:"bun run issue:start:free 34"} }, {art:true,color:false})` es igual al bloque del spec con esos valores.
  - Con `art:false` no contiene `█` y empieza con `"\n  [ok] "`.
  - Con `color:false` no contiene `\x1b`. Con `color:true`, sí.
  - Una rama de 120 caracteres sale entera en una sola línea.
  - `loadConfig` con `{ "art": false }` da `art === false`, sin config da `true` y con `{ "art": "no" }` lanza `ConfigError`.
- [ ] **Step 2: Correr** `npm test`. Esperado: FAIL.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Correr** `npm test`. Esperado: PASS.
- [ ] **Step 5: Commit** `feat: Kuro y el formato de bloque de los mensajes finales (#49)`

### Task 6: Los mensajes finales usan el bloque

**Files:**
- Modify: `src/start-place.ts` (`afterSession`: guardada, mergeada + pregunta, motivos para no borrar), `src/start-modes.ts:238,274,282`, `src/commands/issue-start.ts:303,315,380`, `src/commands/pr-worktree.ts:115`, `src/cli.ts` (entrada: `StartError`, `GitHubError` y errores de git de `issue start` y `pr worktree` van a stderr como bloque `error`; `UsageError` y `ConfigError` quedan como hoy), `src/messages/*.ts`
- Test: `test/issue-start.test.mjs`, `test/pr-worktree.test.mjs`, `test/issue-start-cloud.test.mjs`

**Interfaces:**
- Consumes: `banner`, `blockOpts` (Tarea 5), `again` (Tarea 4) y `out.t`.

- [ ] **Step 1: Actualizar los asserts** de esos mensajes, en `en` y sin TTY. Por ejemplo, `issue-start.test.mjs:192` pasa a esperar `[ok] The session is saved - issue #214`, y en otra línea `To resume it:` y `  issue-flow issue start 214`. Agregar:
  - El mismo caso en `es`: `[ok] Sesión guardada - issue #214`.
  - El mismo caso con `runTty`: el stdout contiene `▄█████▄`.
  - Con `.issue-flow.json` (o la ruta que use `CONFIG_PATH`) en `{ "art": false }` y `runTty`, no lo contiene.
  - Un `issue start` que falla en GitHub escribe `[!]` en stderr y termina con exit 1.
- [ ] **Step 2: Correr** `npm test`. Esperado: FAIL.
- [ ] **Step 3: Implementar.** Cada sitio arma un `Block` con los datos que ya tiene: issue, rama, PR y comando de `again()`.
- [ ] **Step 4: Correr** `npm test`. Esperado: PASS.
- [ ] **Step 5: Commit** `feat: mensajes finales en bloque, con Kuro en la terminal`

### Task 7: El resto de los comandos en español

**Files:**
- Modify: `src/commands/{adapter,apply,claude-hooks,doctor,issue-branch,labels,pr-worktree,session,worktree}.ts`, `src/cli-setup.ts`, `src/cli-worktree.ts`, `src/worktree-steps.ts`, `src/setup-files.ts`, `src/docker.ts`, `src/ports.ts`, `src/stop-apps.ts`, `src/package-edits.ts`, `src/repo-deny.ts`, `src/propose.ts`, `src/recipes.ts`, `src/messages/*.ts`. Revisa cada uno con `grep -n "stdout\|stderr\|warn(\|Error(" src/...`.
- Test: `test/lang.test.mjs`

- [ ] **Step 1: Test que falla.** Un test de humo en `es` por comando que imprime algo legible sin GitHub: `worktree ports`, `doctor` (sin `--json`) y `apply --dry-run`. Cada salida contiene una frase del catálogo `es` y no la frase `en` equivalente.
- [ ] **Step 2: Correr** `npm test`. Esperado: FAIL.
- [ ] **Step 3: Implementar.** Pasar los textos de terminal al catálogo. Lo que va a `--json` usa `messages("en")`. La revisión de `grep -rn '"[A-Z][a-z].* ' src --include=*.ts` no debería dejar textos de terminal en inglés fuera de `src/messages/en.ts`, aparte de los marcadores de GitHub de Global Constraints.
- [ ] **Step 4: Correr** `npm test`. Esperado: PASS.
- [ ] **Step 5: Commit** `feat: el resto de los comandos habla español`

### Task 8: Skills y README

**Files:**
- Modify: `skills/*/SKILL.md` (los 6), `README.md` (enlace a `README.es.md`, sección de `--lang`/`ISSUE_FLOW_LANG` y `art`)
- Create: `README.es.md`
- Test: `test/catalog.test.mjs` o `test/skills-install.test.mjs`, el que ya recorra las skills

- [ ] **Step 1: Test que falla.** Cada `SKILL.md` contiene la línea `Responde al usuario en el idioma en que te escribe.`
- [ ] **Step 2: Correr** `npm test`. Esperado: FAIL.
- [ ] **Step 3: Implementar.** Agregar esa línea al principio del cuerpo de cada skill, justo después del frontmatter. `README.es.md` es la traducción completa de `README.md`, y cada uno enlaza al otro en la primera línea.
- [ ] **Step 4: Correr** `npm test`. Esperado: PASS.
- [ ] **Step 5: Commit** `docs: README en español y skills que responden en el idioma del usuario`
