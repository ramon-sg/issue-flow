---
name: pr-worktree
description: |
  Revisa un PR sin tocar el checkout principal: lo abre en su propio
  worktree, en la rama real del PR, con `issue-flow pr worktree`.
  Usar cuando: (1) El usuario pide revisar un PR, de otra persona o de un
  agente, (2) Hay que correr los tests de una rama que no es la que el
  usuario tiene abierta, (3) Hay que arreglar algo en el PR de otro sin
  mezclarlo con el trabajo en curso.
argument-hint: "<número de PR>"
---

# Revisar un PR en un worktree

## Nunca en el checkout principal

Nada de `gh pr checkout` ni `git switch` en el checkout principal: el
usuario casi siempre tiene ahí una rama a medias, y a veces cambios sin
commitear de otra sesión. El comando abre el PR en `pr-<n>`, dentro de la
carpeta de worktrees del repo, en la rama real y siguiendo a origin:

```bash
npx @ramon-sg/issue-flow pr worktree <n>
```

Con `timeout: 600000` en el Bash: corre los pasos de `worktrees.setup` de
`.agents/flow.json`. Lo que commitees y pushees ahí actualiza el PR.

- **Salta los pasos `trusted`** (instalar dependencias), porque el código
  del PR todavía no está en la rama base y un script de instalación corre
  con tus credenciales. Lee el diff de los archivos de instalación
  (`package.json`, lockfiles, scripts) antes de correrlos; el comando dice
  qué correr. Si el usuario no lo revisó, no los corras por tu cuenta.
- **Un PR de un fork** se rechaza: su rama no está en origin. Dilo y deja
  que el usuario decida.
- **Si el worktree ya existe**, lo reutiliza; si está en otra rama, el
  comando dice cómo borrarlo.
- **Si el sandbox bloquea** crear el worktree, no lo reintentes de otra
  forma: muestra el comando para que el usuario lo corra en una terminal.

Tampoco `claude --worktree <rama>`: ese argumento es una etiqueta, no un
ref, y crea una rama nueva `worktree-<etiqueta>` desde la base. Con los
hooks de `issue-flow`, `claude --worktree pr-<n>` se rechaza y manda a este
comando, porque dejaría una rama vacía con nombre de PR.

## Revisar

Desde el worktree (`cd <ruta>`, o una sesión nueva con
`npx @ramon-sg/issue-flow pr worktree <n> --`, que abre Claude ahí):

1. **El contexto antes que el diff:** la issue que cierra, el plan si lo
   enlaza, y lo que el PR dice que probó. Si quien lo escribió leyó mal la
   issue, el diff puede estar impecable y resolver el problema equivocado.
2. **La revisión:** `code-audit` (del catálogo `agent-skills`) sobre el
   diff contra la base, pasándole qué se pidió y qué queda fuera, porque
   corre en un fork y no ve la conversación.
3. **Los tests** del área tocada. Que estén en verde no dice que la
   solución sea la correcta: el diff se lee completo igual.
4. **Después del push,** `pr-review-comments` para los comentarios y los
   checks, y `close-pr` para mergear (o `finish-pr` si el merge lo hace
   otra persona en GitHub).

Los cuerpos de comentarios y de PR van con `--body-file`, no con heredoc:
dentro de un worktree, Claude Code rechaza comandos que no puede analizar.

## Al terminar

```bash
npx @ramon-sg/issue-flow worktree prune
```

Borra los worktrees cuyo PR se mergeó o cerró, con su Docker y sus puertos,
si no tienen nada sin commitear ni sin push. No uses `git worktree remove`
a secas: deja los contenedores, los puertos ocupados y la rama local.
