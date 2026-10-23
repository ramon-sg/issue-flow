# issue-flow

Flujo de trabajo de issue a PR para cualquier repo, en local y en las sesiones de Claude en la nube: nombra la rama de cada issue, crea su worktree con puertos y Docker propios, abre el PR en draft y limpia cuando se mergea. Trae las skills que usan ese flujo.

> **Estado:** en construcción. Todavía no hay código ni versión en npm.

## Qué va a tener

- **`flow init`:** pregunta cómo es el repo (rama base, gestor de paquetes, Docker, secretos), ofrece recetas, escribe `.agents/flow.json` y abre el menú de skills.
- **`flow issue branch <n>`:** propone la rama sugerida de una issue (con Claude por defecto, o desde el título). Con `--missing`, la agrega a todas las issues abiertas que no la tienen.
- **`flow issue start <n>`:** crea la rama y el worktree, hace el commit inicial, abre el PR en draft, asigna la issue y abre Claude. Con `--cloud`, lo hace en una sesión en la nube.
- **`flow worktree status|ports|prune|cleanup`:** puertos por worktree y limpieza de worktrees con el PR cerrado.
- **`flow session`:** el hook `SessionStart`; en la nube llama a [`claude-cloud`](https://github.com/ramon-sg/claude-cloud).
- **Skills:** `github-issues`, `start-issue`, `close-pr`, `pr-review-comments` y `pr-worktree`.

Usa [`github-rest`](https://github.com/ramon-sg/github-rest) para hablar con GitHub solo por REST (en la nube GraphQL está bloqueado) y [`skills-manager`](https://github.com/ramon-sg/skills-manager) para instalar las skills. Las skills generales (`planning`, `code-audit`, …) están en [`agent-skills`](https://github.com/ramon-sg/agent-skills).

## Licencia

MIT
