---
name: finish-pr
description: |
  Termina un PR sin mergearlo: auditoría, dejar al día el plan o los
  documentos que implementa, commit y push, sacarlo de draft, revisión y CI,
  y el chequeo de que se puede mergear. Se detiene antes del merge con un
  reporte de hasta dónde llegó, qué falta, quién lo hace y cómo limpiar
  después del merge.
  Usar cuando: (1) El usuario pide dejar un PR listo sin mergearlo,
  (2) El merge lo hace una persona en GitHub o los permisos no dejan
  mergear al agente, (3) `close-pr` lo corre antes de mergear, (4) Hay que
  retomar un PR que quedó a medio terminar.
argument-hint: "[número de PR] — si no se pasa, el de la rama actual"
---

# Terminar un PR

> **Regla de oro:** lo que documenta el cambio (el plan, el README, `docs/`)
> se deja al día **dentro del PR**, antes del push que pide la revisión.
> Después del merge el objetivo ya se cumplió y ese paso se cae.

Esta skill deja el PR listo para mergear y se detiene ahí. El merge lo hace
`close-pr`, que corre esta skill primero, o una persona en GitHub.

**Lo propio de este repo está en `project.md`**, en esta misma carpeta: qué
pasos corren sin preguntar, qué se corre antes del push, cómo se cierra un
plan, qué bots revisan y qué cuenta como review aprobado. Léelo antes de
empezar. Se mira sección por sección: una que falta o sigue igual que la
plantilla se toma de `../close-pr/project.md`, si ahí tiene la misma
sección (de cuando vivían en `close-pr`). Si tampoco, vale lo de esta skill.

La rama base sale de `.agents/flow.json` (`baseBranch`, o la rama por
defecto del repo).

## Paso 0: Confirmación

Nunca commit, push ni ready sin el OK explícito del usuario, salvo lo que
`project.md` deje correr solo. "Continúa", "corrige" u "ok" a otra cosa no
cuenta. El OK del ciclo cubre auditoría, commit, push y ready. **No cubre**
los arreglos que salgan de la revisión o de CI: esos siguen su propio OK en
`pr-review-comments`. Esta skill nunca mergea.

Si la corre `close-pr`, el OK del ciclo completo que el usuario le dio a
`close-pr` cuenta como el OK de esta skill: no se vuelve a preguntar.

## Paso 1: Encontrar el PR y dónde corre la sesión

```bash
branch=$(git rev-parse --abbrev-ref HEAD)
npx @ramon-sg/github-rest pr find "$branch"
echo "${CLAUDE_CODE_REMOTE:-}"
[ "$(git rev-parse --path-format=absolute --git-dir)" = "$(git rev-parse --path-format=absolute --git-common-dir)" ] \
  && echo "checkout principal" || echo "worktree"
```

En la nube (`CLAUDE_CODE_REMOTE` es `true`) sacar de draft necesita `gh` en
local: en el Paso 5 le pides al usuario que lo saque de draft y sigues con
los Pasos 6 y 7, que van por REST.

**¿Ya se auditó antes?** El cuerpo del PR puede traer la marca que deja el
Paso 4, con el último SHA auditado:

```bash
npx @ramon-sg/github-rest pr view <n> > pr.json
jq -r .body pr.json | grep -o 'finish-pr: auditado [0-9a-f]\{40\}' | tail -1   # la marca
jq -r .headRefOid pr.json                                                     # HEAD en origin
git rev-parse HEAD
git status --porcelain
```

- **La marca es el `HEAD` local, es el `headRefOid` del PR y no hay cambios
  sin commitear:** la auditoría y los documentos ya están hechos para este
  código. Salta los Pasos 2 y 3, y sigue en el Paso 4 solo para revisar
  `Closes` o `Part of` (otro PR de la issue pudo mergearse mientras tanto).
- **La marca es un commit anterior de la rama** (`git merge-base
  --is-ancestor <marca> HEAD`): en el Paso 2 audita solo lo que vino
  después, con `--branch <marca>`.
- **No hay marca, o no es de esta rama:** sigue en el Paso 2 con todo.

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
`--no-verify`: si un hook bloquea, se arregla la causa. El push va con
`git push origin HEAD`: dentro del sandbox la rama puede no tener upstream.

**`Closes` o `Part of`:** solo el último PR de una issue la cierra.

- El PR se abrió con `Part of #N` y es el último de la issue: cambia el
  cuerpo a `Closes #N`.
- Se abrió con `Closes #N` pero queda trabajo (otro PR abierto de la issue,
  o etapas del plan): cambia el cuerpo a `Part of #N`.

Después del push, deja en el cuerpo la marca del código auditado en el
Paso 2, al final y en una sola línea (reemplaza la anterior: queda una
sola). El SHA es el `HEAD` pusheado, que incluye los arreglos de la
auditoría y los documentos:

```markdown
<!-- finish-pr: auditado <sha de HEAD> -->
```

```bash
npx @ramon-sg/github-rest pr edit <n> --body-file <archivo>
```

## Paso 5: Sacar de draft

Deja el cuerpo al día: qué cambia y cómo se probó, con el comando y su
salida. Conserva `Closes`, la URL de la issue y la marca del Paso 4.

Sacar de draft no tiene ruta REST. En local:

```bash
gh pr ready <n>
```

Si ya estaba listo, falla con `is already "ready for review"`: es lo
esperado, se sigue. En la nube, pídele al usuario que lo haga en GitHub
(botón "Ready for review") y sigue.

## Paso 6: Revisión y CI

Tras el push, procesa los comentarios y los checks con
`pr-review-comments`. Cada push de arreglos vuelve a disparar la revisión y
CI: se espera de nuevo. La marca del Paso 4 **no** se mueve con estos
pushes: la auditoría no vio esos commits. La próxima vez que corra la skill,
los audita solos (Paso 1).

## Paso 7: ¿Se puede mergear?

Las tres cosas, o el PR no está listo:

1. **Review aprobado.** `project.md` puede decir otra cosa (por ejemplo, en
   un repo de una persona, su OK en la conversación):

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
   avanzó, trae la base a la rama (merge, no rebase, con su OK) o avisa.
   Traerla es un push nuevo: vuelve al Paso 6 y espera la revisión y los
   checks de ese commit antes de volver acá.

Si falta una, no esperes en silencio: es el reporte del Paso 8. "Listo
para mergear" vale solo para los checks del `HEAD` que está en origin.

## Paso 8: Reportar y detenerse

Aquí termina la skill, esté listo o no. Si la llamó `close-pr`, le devuelve
el estado; si no, se lo muestra al usuario.

```text
PR:         #<n> (<url>)
Estado:     listo para mergear | falta <qué>
Quién:      <tú | un revisor | CI | nadie>
Hecho:      <auditoría, documentos, push, ready: lo que se hizo en esta vuelta o ya estaba>
Pendiente:  <issues propuestas, checks que el usuario decidió ignorar, o "nada">
Después:    <cómo limpiar, abajo>
```

Por qué puede faltar algo: no hay review aprobado, un check falla o sigue
corriendo, la base avanzó, o en la nube el PR sigue en draft. Correr la
skill de nuevo sigue desde donde quedó.

**Cómo limpiar después de mergear** (va en `Después:`; `close-pr` también
lo usa tras su merge):

- **Rama en origin:** la borra GitHub si el repo tiene "Automatically
  delete head branches" (Settings → General). Si no, el botón "Delete
  branch" del PR, o `git push origin --delete <rama>`.
- **Worktree:** `npx @ramon-sg/issue-flow worktree prune` borra los worktrees
  cuyo PR se mergeó, con su Docker y sus puertos, si no hay nada sin
  commitear ni sin push.
- **Checkout principal:** `git checkout <base> && git pull --ff-only &&
  git branch -d <rama>`. Si `-d` falla, nunca `-D`: algo quedó sin mergear.

## Notas

- Nunca `--no-verify` ni `git push --force`.
- Para mergear después de terminar, `close-pr`.
