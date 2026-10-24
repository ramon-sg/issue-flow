# issue-flow

Flujo de trabajo de issue a PR para cualquier repo, en local y en las sesiones de Claude en la nube: nombra la rama de cada issue, crea su worktree con puertos y Docker propios, abre el PR en draft y limpia cuando se mergea. Trae las skills que usan ese flujo.

> **Estado:** en construcción, sin versión en npm. Ya funciona `issue-flow issue branch`; el resto llega por etapas. El paquete será `@ramon-sg/issue-flow` y el comando, `issue-flow`.

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
| `start.commitMessage` | `chore: empieza el trabajo en la issue #{number}` | Commit vacío inicial |
| `start.prBody` | `{keyword} #{number}` y "En progreso." | Cuerpo del PR en draft |

## Desarrollo

```sh
npm install && npm test
```

Usa [`github-rest`](https://github.com/ramon-sg/github-rest) para hablar con GitHub solo por REST (en la nube GraphQL está bloqueado) y [`skills-manager`](https://github.com/ramon-sg/skills-manager) para instalar las skills. Las skills generales (`planning`, `code-audit`, …) están en [`agent-skills`](https://github.com/ramon-sg/agent-skills).

## Licencia

MIT
