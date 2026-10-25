# issue-flow

Flujo de trabajo de issue a PR para cualquier repo, en local y en las sesiones de Claude en la nube: nombra la rama de cada issue, crea su worktree con puertos y Docker propios, abre el PR en draft y limpia cuando se mergea. Trae las skills que usan ese flujo.

> **Estado:** en construcción, sin versión en npm. Ya funcionan `issue-flow issue branch` e `issue-flow issue start` en local; el resto llega por etapas. El paquete será `@ramon-sg/issue-flow` y el comando, `issue-flow`.

## Qué va a tener

- **`issue-flow init`:** pregunta cómo es el repo (rama base, gestor de paquetes, Docker, secretos), ofrece recetas, escribe `.agents/flow.json` y abre el menú de skills.
- **`issue-flow issue branch <n>`:** propone la rama de una issue (con Claude por defecto, o desde el título). Con `--missing`, agrega el slug de rama a todas las issues abiertas que no lo tienen.
- **`issue-flow issue start <n>`:** crea la rama y el worktree, hace el commit inicial, abre el PR en draft, asigna la issue y abre Claude. Con `--cloud`, lo hace en una sesión en la nube.
- **`issue-flow worktree status|ports|prune|cleanup`:** puertos por worktree y limpieza de worktrees con el PR cerrado.
- **`issue-flow session`:** el hook `SessionStart`; en la nube llama a [`claude-cloud`](https://github.com/ramon-sg/claude-cloud).
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

## Config: `.agents/flow.json`

Todo es opcional; sin el archivo valen los valores por defecto. Una clave desconocida es un error, así un error de tipeo no pasa en silencio. `schema.json` da autocompletado en el editor:

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
