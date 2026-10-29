---
name: close-pr
description: |
  Cierra un PR: auditoría, dejar al día el plan o los documentos que
  implementa, commit y push, sacarlo de draft, revisión y CI, merge con merge
  commit cuando tiene un review aprobado, y limpieza de la rama y el
  worktree.
  Usar cuando: (1) El usuario autoriza el ciclo de cierre de un PR,
  (2) Terminaste de implementar una issue o una etapa de un plan y vas a
  mergear, (3) Hay que decidir si un PR cierra un plan o si quedan etapas.
argument-hint: "[número de PR] — si no se pasa, el de la rama actual"
---

# Cerrar un PR

> **Regla de oro:** lo que documenta el cambio (el plan, el README, `docs/`)
> se deja al día **dentro del PR**, antes del push que pide la revisión.
> Después del merge el objetivo ya se cumplió y ese paso se cae.

**Lo propio de este repo está en `project.md`**, en esta misma carpeta: qué
pasos corren sin preguntar, qué se corre antes del push, cómo se cierra un
plan, qué bots revisan y qué cuenta como review aprobado. Léelo antes de
empezar. Si no existe o sigue igual que la plantilla, vale lo de esta skill.

La rama base sale de `.agents/flow.json` (`baseBranch`, o la rama por
defecto del repo).

## Paso 0: Confirmación

Nunca commit, push, ready ni merge sin el OK explícito del usuario, salvo lo
que `project.md` deje correr solo. "Continúa", "corrige" u "ok" a otra cosa
no cuenta. El OK del ciclo completo cubre auditoría, commit, push, ready y
merge. **No cubre** los arreglos que salgan de la revisión o de CI: esos
siguen su propio OK en `pr-review-comments`.

## Paso 1: Encontrar el PR y dónde corre la sesión

```bash
branch=$(git rev-parse --abbrev-ref HEAD)
npx @ramon-sg/github-rest pr find "$branch"
echo "${CLAUDE_CODE_REMOTE:-}"
[ "$(git rev-parse --path-format=absolute --git-dir)" = "$(git rev-parse --path-format=absolute --git-common-dir)" ] \
  && echo "checkout principal" || echo "worktree"
```

En la nube (`CLAUDE_CODE_REMOTE` es `true`) sacar de draft y mergear
necesitan `gh` en local: en el Paso 5 le pides al usuario que lo saque de
draft, sigues con los Pasos 6 y 7, que van por REST, y te detienes antes del
merge con el reporte de lo que falta.

## Paso 2: Auditoría

Usa `code-audit` (del catálogo `agent-skills`) pasándole primero **qué se
pidió y qué queda fuera de alcance**: corre en un fork y no ve esta
conversación.

- **Hay cambios sin commitear:** el modo por defecto, que mira `git diff`.
- **Todo está commiteado:** `git fetch origin <base>` y
  `--branch origin/<base>`. Con la base local, que en un worktree suele estar
  atrasada, se cuelan commits que ya están en la base.

Resuelve **todos** los hallazgos: arréglalos, descártalos con una razón, o
propón una issue con `github-issues`. Listarlos no es cerrarlos. Una issue
solo si pasa el paso 0 de `github-issues`: lo que causó esta rama, o lo que
tiene que ver con lo que arregla, se arregla acá.

Antes del push, corre lo que CI va a correr sobre lo tocado (`project.md`
dice qué; si no, el lint y los tests del área).

## Paso 3: Dejar al día lo que el PR implementa

El único juicio del ciclo que no lo toma una herramienta:

**¿Este PR termina lo que describe su plan, o quedan etapas por venir?**

Va **antes** del commit final, para que los documentos viajen en el mismo
push y la revisión también los vea.

- **Con `planning`:** termina, `planning --close`; quedan etapas, se anota
  el estado de la etapa (`planning --stage`); se descarta, el motivo en el
  plan. Siempre con el número del PR.
- **Con otro sistema de planes:** el comando de `project.md`.
- Revisa también si el cambio deja viejo el README, una guía de `docs/` o
  una skill.

Si el PR no implementa ningún documento, salta este paso.

## Paso 4: Commit y push

Commits con la convención del repo (`CLAUDE.md` o `project.md`). Nunca
`--no-verify`: si un hook bloquea, se arregla la causa.

**`Closes` o `Part of`:** solo el último PR de una issue la cierra.

- El PR se abrió con `Part of #N` y es el último de la issue: cambia el
  cuerpo a `Closes #N` antes de mergear.
- Se abrió con `Closes #N` pero queda trabajo (otro PR abierto de la issue,
  o etapas del plan): cambia el cuerpo a `Part of #N`.

```bash
npx @ramon-sg/github-rest pr edit <n> --body-file <archivo>
```

## Paso 5: Sacar de draft

Actualiza también el cuerpo si todavía dice "Work in progress": qué cambia
y cómo se probó, con el comando y su salida.

Sacar de draft no tiene ruta REST. En local:

```bash
gh pr ready <n>
```

Si ya estaba listo, falla con `is already "ready for review"`: es lo
esperado, se sigue. En la nube, detente y pídele al usuario que lo haga en
GitHub (botón "Ready for review").

## Paso 6: Revisión y CI

Tras el push, procesa los comentarios y los checks con
`pr-review-comments`. Cada push de arreglos vuelve a disparar la revisión y
CI: se espera de nuevo.

## Paso 7: Antes del merge

Las tres cosas, o no se mergea:

1. **Review aprobado.** Sin review aprobado, detente y dilo. `project.md`
   puede decir otra cosa (por ejemplo, en un repo de una persona, su OK en
   la conversación):

   ```bash
   npx @ramon-sg/github-rest pr reviews <n> | jq '[.[] | select(.state == "APPROVED" or .state == "CHANGES_REQUESTED" or .state == "DISMISSED")]
     | group_by(.user) | map(last | {user, state})'
   ```

   Vale si algún revisor está en `APPROVED` y ninguno en
   `CHANGES_REQUESTED`.

2. **Checks en verde:**

   ```bash
   npx @ramon-sg/github-rest pr checks <n> | jq -r '.checks[] | "\(.bucket)\t\(.name)"'
   ```

   Ninguno en `fail` ni `pending`, salvo que el usuario lo decida sabiendo
   cuál y por qué.

3. **La base no avanzó** desde el último push:
   `git fetch origin <base> && git log --oneline HEAD..origin/<base>`. Si
   avanzó, trae la base a la rama (merge, no rebase) o avisa.

## Paso 8: Mergear y limpiar

**Merge commit siempre.** Nunca `--squash` ni `--rebase`: reescriben los
SHAs. Tampoco `gh pr merge --delete-branch`: intenta cambiarse a la base en
local. El merge lo revisa el modo auto de Claude Code, así que puede pedir
la aprobación del usuario: es lo esperado.

```bash
gh pr merge <n> --merge
git push origin --delete <rama>
```

- **Checkout principal:** `git checkout <base> && git pull --ff-only &&
  git branch -d <rama>`. Si `-d` falla, detente: nunca `-D`.
- **Worktree:** la rama local y el worktree no se borran desde adentro.
  `npx @ramon-sg/issue-flow worktree prune` lo hace después, con su Docker y sus
  puertos, si no hay nada sin commitear ni sin push. Si la sesión se abrió
  con `issue-flow issue start`, lo ofrece al salir de Claude.

## Paso 9: Reportar

```text
PR:         #<n> mergeado (<url>)
Commit:     <sha del merge>
Rama:       <rama> borrada en origin; la local, con el worktree
Documentos: <plan o docs al día, o "no aplica">
Pendiente:  <issues propuestas, checks que el usuario decidió ignorar, o "nada">
```
