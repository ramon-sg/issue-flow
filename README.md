# issue-flow

Flujo de trabajo de issue a PR para cualquier repo, en local y en las sesiones de Claude en la nube: nombra la rama de cada issue, crea su worktree con puertos y Docker propios, abre el PR en draft y limpia cuando se mergea. Trae las skills que usan ese flujo.

> **Estado:** en construcción, sin versión en npm. Ya funcionan `issue-flow issue branch`, `issue-flow issue start` (en local y en la nube), `issue-flow worktree`, `issue-flow pr worktree`, `issue-flow adapter`, `issue-flow session` e `issue-flow hook`; el resto llega por etapas. El paquete será `@ramon-sg/issue-flow` y el comando, `issue-flow`.

## Qué va a tener

- **`issue-flow init`:** pregunta cómo es el repo (rama base, gestor de paquetes, Docker, secretos), ofrece recetas, escribe `.agents/flow.json` y abre el menú de skills.
- **`issue-flow issue branch <n>`:** propone la rama de una issue (con Claude por defecto, o desde el título). Con `--missing`, agrega el slug de rama a todas las issues abiertas que no lo tienen.
- **`issue-flow issue start <n>`:** crea la rama y el worktree, hace el commit inicial, abre el PR en draft, asigna la issue y abre Claude. Con `--cloud`, lo hace en una sesión en la nube.
- **`issue-flow worktree setup|teardown|ports|cleanup|prune`:** prepara y limpia cada worktree con los pasos del repo, le da un bloque de puertos y borra los worktrees con el PR cerrado.
- **`issue-flow pr worktree <n>`:** abre un PR en su propio worktree, en la rama del PR, para revisarlo sin soltar lo que estás haciendo.
- **`issue-flow adapter setup|issue|archive`:** lo que corren Orca y Paseo al crear o borrar un worktree.
- **`issue-flow session`:** el hook `SessionStart`; en la nube llama a [`claude-cloud`](https://github.com/ramon-sg/claude-cloud).
- **`issue-flow hook worktree-create|worktree-remove`:** los hooks `WorktreeCreate` y `WorktreeRemove` de Claude Code, para `claude --worktree`.
- **Skills:** `github-issues`, `start-issue`, `close-pr`, `pr-review-comments` y `pr-worktree`.

## Nombre de la rama

```sh
issue-flow issue branch 42 57           # propone la rama de cada issue, sin escribir nada
issue-flow issue branch --missing       # la de cada issue abierta sin bloque, y lo agrega tras confirmar
issue-flow issue branch --missing --dry-run --json
```

La issue guarda solo el slug, en un bloque así:

```markdown
**Slug de rama**
`cart-total-with-credit`
```

El número es el de la issue y el tipo sale de las labels (o, si no hay, del prefijo del título: `bug:` da `fix`). Así el cuerpo se escribe antes de que la issue tenga número, de una sola vez, y no queda viejo si cambia el label o la plantilla. Es lo mismo que hacen GitHub, GitLab y Linear: la rama se calcula al crearla.

La rama se arma con la plantilla del repo y el slug sale, en este orden:

1. **Del bloque "Slug de rama"** de la issue.
2. **Del bloque antiguo "Rama sugerida"**, con la rama completa (`fix/42-cart`), si es `<prefijo>/<n>-<slug>` de esa issue. Se usa tal cual, así las issues de antes siguen funcionando; nunca se escribe.
3. **De Claude** (`claude -p`, una sola llamada para todas las issues): Claude propone el slug en inglés y, si la issue no tiene tipo, lo elige de la lista del repo. Su respuesta se valida.
4. **Del título**, si Claude no está, falla o responde algo que no sirve.

`--missing` agrega el bloque "Slug de rama" después del primer párrafo de cada issue abierta sin bloque (ni nuevo ni antiguo), solo con `--yes` o si respondes que sí en la terminal; `--dry-run` nunca escribe. Como solo guarda el slug, no usa el tipo que elegiría Claude: muestra la rama que dará la issue y avisa de las que no tienen label de tipo.

## Empezar una issue

```sh
issue-flow issue start 42              # worktree en .claude/worktrees/, PR en draft y Claude
issue-flow issue start 42 --dry-run    # el resumen, sin cambiar nada (solo hace git fetch)
issue-flow issue start 42 --yes --no-launch   # lo que corre la skill después de tu OK
issue-flow issue start 42 --plan       # una línea JSON con la rama y el pedido, sin efectos
```

Qué hace, en orden:

1. **Lee la issue y su trabajo:** se detiene si la issue está cerrada; hace `git fetch` y lee con [`github-rest`](https://github.com/ramon-sg/github-rest) sus PRs y ramas, en GitHub y en esta máquina.
2. **Elige la rama:**
   - **Sin ramas vivas:** crea una nueva, con el nombre de `issue branch`. Si ese nombre ya se usó en una tanda mergeada, le suma `-2`, `-3`…
   - **Con una:** la retoma.
   - **Con varias:** en la terminal te pregunta cuál seguir. Con `--yes` hay que elegir con `--resume <rama>` o `--new`.
3. **Muestra un resumen y pregunta `[y/N]`.** Una respuesta vacía es no.
4. **Crea lo que falta:**
   - el worktree, o con `--branch` la rama en este checkout;
   - el commit vacío con `[skip ci]`, el push y el PR en draft;
   - reabre el PR cerrado de una rama que se retoma, y te asigna la issue.

   El PR dice `Closes #n`, o `Part of #n` si la issue tiene otra rama viva; en ese caso los otros PRs abiertos que la cerraban también pasan a `Part of`. El worktree recibe los archivos ignorados que lista `.worktreeinclude` (credenciales, por ejemplo), como `claude --worktree`.
5. **Abre Claude en la misma terminal** con un pedido y el color de la prioridad.
   - Cada rama guarda su sesión, así que empezar otra vez la retoma.
   - Mientras Claude corre, el worktree queda bloqueado (`git worktree lock`). Si el bloqueo es de un `issue-flow` que ya no corre, lo toma.
6. **Al salir de Claude:**
   - Si el PR se mergeó y no queda trabajo sin pushear, ofrece borrar el worktree y la rama.
   - Si no, dice cómo retomar.

**Permisos:** si el repo tiene [`claude-repo-guard`](https://github.com/ramon-sg/claude-repo-guard), Claude se abre en modo auto con su contexto (lo mismo que `claude:auto`). Con `--ask-permissions` se abre con tus settings, y con `--free` sin sandbox ni preguntas (como `claude:free`). Sin `claude-repo-guard`, se abre con tus settings. `--plan` devuelve esos mismos argumentos en `claudeArgs`.

### Con la nube y con otras herramientas

```sh
issue-flow issue start 42 --cloud      # confirma acá y abre una sesión de Claude en la nube
issue-flow issue start 42 --here       # dentro de esa sesión: empieza la issue en este checkout
issue-flow issue start 42 --teleport   # trae al worktree la sesión de la nube anotada en el PR
issue-flow issue start 42 --adopt      # dentro de un worktree que creó Orca o Paseo
```

- **`--cloud`** lee la issue, muestra el resumen y pregunta, igual que en local. Después corre `claude --cloud "/start-issue 42 --yes"` desde el checkout principal, sin crear rama ni PR acá: los crea la sesión con `--here`. Si la issue tiene varias ramas, le pasa la elegida con `--resume <rama>` o `--new`. Se detiene si la rama ya está abierta en un checkout o existe solo en local, porque la nube no la vería.
- **`--here`** es para la skill dentro de una sesión en la nube. Deja este checkout en la rama (desde `origin/<base>`, o desde `origin/<rama>` si ya existe), hace el commit vacío, el push, el PR en draft y la asignación, y no abre Claude. Si corre en una sesión (`CLAUDE_CODE_REMOTE_SESSION_ID`), anota su link en el cuerpo del PR (`Cloud session: …`); queda una sola línea, la de la última sesión. Termina con una línea `Prompt: …` que la skill sigue. Se detiene si hay cambios sin commitear: no hace stash.
- **`--teleport`** retoma como siempre (worktree, PR) y abre `claude --teleport` con la sesión anotada en el PR, o con la lista de sesiones si no hay ninguna. Sin `--teleport`, retomar abre la sesión local y el resumen avisa si hay una en la nube.
- **`--adopt`** usa el worktree donde se corre, que creó otra herramienta. No pregunta ni abre Claude. Renombra su rama a la de la issue y publica; si la rama ya lleva el número de la issue (`fix/42-mi-nombre`), la deja como está. Si el worktree ya está en una rama viva de la issue, la retoma. Si no, solo adopta un worktree recién creado: se detiene si su rama está en origin, tiene commits propios o hay cambios sin commitear, o si la issue ya tiene su rama en otro lado.

## Worktrees: preparar, limpiar y borrar

```sh
issue-flow worktree setup              # corre los pasos de preparación en este worktree
issue-flow worktree setup --only deps  # uno solo
issue-flow worktree teardown           # sus pasos de limpieza, sus puertos y su Docker
issue-flow worktree ports [--next]     # el primer puerto de su bloque, o lo pasa al siguiente
issue-flow worktree cleanup            # el Docker de los worktrees que ya no existen
issue-flow worktree prune              # borra los worktrees cuyo PR se mergeó o se cerró
```

Lo propio de cada repo (instalar, armar la base, levantar Docker) son **pasos** en `worktrees` de `.agents/flow.json`; `issue-flow` solo los corre:

```json
{
  "worktrees": {
    "setup": [
      { "name": "deps", "run": "npm ci", "trusted": true, "once": true },
      { "name": "env", "run": "cp -n .env.example .env" }
    ],
    "teardown": [{ "name": "docker", "run": "docker compose -p acme-dev-$ISSUE_FLOW_DOCKER_SUFFIX down -v" }],
    "ports": true,
    "dockerProjects": ["acme-dev"]
  }
}
```

- **Cuándo corren:** `issue start` corre el `setup` en cada worktree nuevo, después de copiar `.worktreeinclude`. El hook `session` lo corre al abrir Claude en un worktree. El `teardown` corre antes de borrar un worktree, con `prune` o al limpiar después del merge.
- **De dónde salen:** siempre de la config del checkout principal, nunca de la del worktree. Así una rama no puede sumar comandos a su propio setup. En la nube no hay otro checkout: ahí la config es la de la rama de la sesión.
- **Pueden correr más de una vez:** `issue start` y el hook `session` corren el `setup` del mismo worktree, así que un paso sin `once` tiene que poder repetirse.
- **`trusted`:** el paso corre solo si el código del worktree está en `origin/<base>` y no tiene cambios. Es para un install, que corre los scripts de `package.json` de esa rama. En la nube corre siempre, porque la máquina es descartable.
- **`once`:** el paso no se repite una vez que funcionó (deja una marca en el git dir del worktree).
- **Variables de cada paso:** `ISSUE_FLOW_WORKTREE`, `ISSUE_FLOW_MAIN_ROOT`, `ISSUE_FLOW_DOCKER_SUFFIX` y, con `ports`, `ISSUE_FLOW_PORT_BASE`.
- **Puertos:** cada worktree recibe un bloque fijo. Sale de un hash de la máquina y la carpeta, salta los bloques donde algo escucha o que otro worktree de la máquina registró, y queda guardado. macOS usa la primera mitad del rango y el resto la segunda, así un worktree de la laptop no choca con uno del servidor que Orca reenvía.
- **Docker:** el proyecto de Compose de cada worktree es `<prefijo>-$ISSUE_FLOW_DOCKER_SUFFIX`. `cleanup` borra contenedores, volúmenes y redes de los proyectos con un prefijo de `dockerProjects` cuya carpeta ya no es un checkout. Nunca toca uno sin sufijo, el del checkout principal.
- **Apps:** el `teardown` detiene los procesos que escuchan en un puerto del bloque y corren dentro del worktree (TERM a su grupo y, a los 5 segundos, KILL). Nunca toca uno de afuera. Necesita `lsof`.
- **`prune`** pregunta antes de borrar. Nunca toca un worktree con cambios, con commits sin pushear o bloqueado por una sesión de Claude, y revisa cada uno otra vez justo antes de borrarlo.

Los nombres de Docker y los bloques de puertos salen iguales que los de Abastio.

## Revisar un PR: `issue-flow pr worktree`

```sh
issue-flow pr worktree 42               # crea (o reusa) .claude/worktrees/pr-42 en la rama del PR
issue-flow pr worktree 42 -- claude     # y corre el comando ahí; con `--` solo, abre Claude
issue-flow pr worktree 42 --no-setup    # sin los pasos de setup
```

- La rama sigue a `origin`, así que lo que commiteas y pusheas actualiza el PR. Si ya tienes la rama en local, avanza a la de origin cuando puede y avisa si no.
- Copia `.worktreeinclude` y corre el `setup`, pero salta los pasos `trusted`: el código del PR todavía no está en la rama base. Dice qué correr cuando lo revisaste.
- Nunca toca el checkout principal: si la rama está abierta ahí o en otro worktree, se detiene. Un PR de un fork no se abre, porque su rama no está en origin.
- Se borra con `issue-flow worktree prune` cuando el PR se mergea o se cierra, como cualquier worktree.

## Orca y Paseo: `issue-flow adapter`

`orca.yaml` y `paseo.json` solo llaman al adaptador, que deja el worktree igual que uno de `issue start`:

```yaml
# orca.yaml
setupAgentStartupPolicy: wait-for-setup
scripts:
  setup: npx issue-flow adapter setup
  archive: npx issue-flow adapter archive
```

```json
{ "worktree": { "setup": ["npx issue-flow adapter setup"], "teardown": "npx issue-flow adapter archive" } }
```

- **`setup [--only <paso>]`:** copia `.worktreeinclude` (Paseo no lo copia), corre los pasos de `setup` y, sin `--only`, empieza la issue de la que salió el worktree como `issue start <n> --adopt`. Con Paseo la issue sale de la rama (`feat/42-x`, `42-x`); con Orca, de su CLI (`orca worktree current --json`). Siempre sale con 0: si algo falla, dice qué correr.
- **`issue [<url>]`:** solo empieza la issue. Con la URL a mano sale con el código de `issue start`.
- **`archive`:** el `teardown` del worktree: pasos, apps, puertos y Docker. Siempre sale con 0, porque un archive que falla no puede bloquear el borrado. Si el enlace de git se rompió, igual borra el Docker de la carpeta con la config del checkout que nombran `ORCA_ROOT_PATH` o `PASEO_SOURCE_CHECKOUT_PATH`.

## Hooks de Claude Code para `claude --worktree`

`issue-flow hook worktree-create` y `issue-flow hook worktree-remove` son los hooks `WorktreeCreate` y `WorktreeRemove`. Con ellos, un worktree de `claude --worktree <nombre>` recibe lo mismo que uno de `issue start`, y se limpia cuando Claude lo borra. Claude solo llama a `WorktreeRemove` para los worktrees que hizo un hook `WorktreeCreate`.

- **`worktree-create`:** crea `<worktrees.dir>/<nombre>` en la rama `worktree-<nombre>` desde `origin/<base>` (la `baseBranch` de la config), o lo reusa. Copia `.worktreeinclude`, corre el `setup` e imprime solo la ruta, que es lo que Claude lee. Rechaza `pr-<n>`: para eso está `pr worktree`.
- **`worktree-remove`:** corre el `teardown` y borra la carpeta, y la rama si todos sus commits están en origin. Conserva un worktree con cambios sin commitear.

## Hook de sesión: `issue-flow session`

Es el hook `SessionStart` de Claude Code. Lo que imprime le llega a Claude como contexto, así que ahí van los avisos. Nunca hace fallar la sesión.

1. En una sesión en la nube (`CLAUDE_CODE_REMOTE=true`), corre `claude-cloud session`. Si no está, dice qué setup script poner en claude.ai.
2. En un worktree (o en el checkout de la nube), corre los pasos de `setup`. La carpeta sale del `cwd` que manda Claude, que con `claude --worktree` es la del worktree, y si no viene, de `CLAUDE_PROJECT_DIR`.
3. Si un worktree local está en la rama de una issue que no está en origin, avisa que la issue no quedó empezada.
4. Borra el Docker de los worktrees que ya no existen: Claude Code no llama al hook `WorktreeRemove` de los worktrees que no hizo un hook `WorktreeCreate`.
5. Si hay `.envrc` y `direnv`, agrega su entorno a `CLAUDE_ENV_FILE`, para que los comandos de la sesión lo tengan.

## Config: `.agents/flow.json`

Todo es opcional; sin el archivo valen los valores por defecto. Una clave desconocida es un error, así un error de tipeo no pasa en silencio. Se lee siempre del checkout principal, también desde un worktree. `schema.json` da autocompletado en el editor:

```json
{
  "$schema": "https://raw.githubusercontent.com/ramon-sg/issue-flow/main/schema.json",
  "branch": {
    "template": "{type}/{number}-{slug}",
    "namer": "claude",
    "types": {
      "labels": { "bug": "fix", "enhancement": "feat", "documentation": "docs", "spike": "spike" },
      "titlePrefixes": { "bug:": "fix", "mejora:": "feat", "docs:": "docs", "spike:": "spike" }
    }
  }
}
```

| Clave | Por defecto | Para qué |
|---|---|---|
| `repo` | `-R`, `GH_REPO` u `origin` | El repo en GitHub |
| `baseBranch` | La rama por defecto del repo | De dónde parte el trabajo |
| `branch.template` | `{type}/{number}-{slug}` | Nombre de la rama; necesita `{number}` y `{slug}` |
| `branch.namer` | `claude` | `claude` o `title` |
| `branch.claudeModel` | `haiku` | Modelo de `claude -p` |
| `branch.types` | Los de arriba | Tipo por label y por prefijo; cada mapa reemplaza al de por defecto |
| `worktrees.dir` | `.claude/worktrees` | Dónde van los worktrees |
| `worktrees.setup`, `worktrees.teardown` | Ninguno | Pasos para preparar y limpiar un worktree (ver arriba) |
| `worktrees.ports` | Apagado | `true` para bloques de 10 desde 20000, o `{ start, blockSize, blocks }` |
| `worktrees.dockerProjects` | Ninguno | Prefijos de los proyectos de Compose de los worktrees |
| `start.commitMessage` | `chore: empieza el trabajo en la issue #{number} [skip ci]` | Commit vacío inicial |
| `start.prBody` | `{keyword} #{number}` y "En progreso." | Cuerpo del PR en draft |
| `start.prompt`, `start.resumePrompt` | Resumir la issue y seguir `start-issue`, o retomar desde `{plan}` | Pedido con que se abre Claude |
| `start.summaryPrompt`, `start.summaryPlanPrompt` | Resumir y esperar | Pedido de `--plan` |
| `start.cloudPrompt` | `/start-issue {number} --yes{flags}` | Lo que `--cloud` le pide a la sesión; `{flags}` es `--new` o `--resume <rama>` |
| `plans.dirs` | `docs/plans`, `docs/specs` | Dónde buscar el plan de la issue: lo que tocó la rama, o el documento cuyo `prs:` nombra su PR |
| `colors` | `critical-path` y `P1:` rojo, `P2:` naranjo, `P3:` amarillo, `P4:` cian | Color de la sesión por prefijo de label; gana el primero que calce |

## Desarrollo

```sh
npm install && npm test
```

Usa [`github-rest`](https://github.com/ramon-sg/github-rest) para hablar con GitHub solo por REST (en la nube GraphQL está bloqueado) y [`skills-manager`](https://github.com/ramon-sg/skills-manager) para instalar las skills. Las skills generales (`planning`, `code-audit`, …) están en [`agent-skills`](https://github.com/ramon-sg/agent-skills).

## Licencia

MIT
