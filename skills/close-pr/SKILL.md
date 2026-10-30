---
name: close-pr
description: |
  Cierra un PR: corre `finish-pr` (auditoría, documentos al día, commit y
  push, ready, revisión y CI, chequeo de review aprobado) y, si queda listo,
  lo mergea con merge commit y limpia la rama y el worktree.
  Usar cuando: (1) El usuario autoriza el ciclo de cierre de un PR con
  merge, (2) Terminaste de implementar una issue o una etapa de un plan y vas
  a mergear, (3) Hay que decidir si un PR cierra un plan o si quedan etapas.
  Sin merge (lo hace una persona en GitHub), `finish-pr`.
argument-hint: "[número de PR] — si no se pasa, el de la rama actual"
---

# Cerrar un PR

Cerrar es terminar y mergear. Todo lo de antes del merge vive en
`finish-pr`; esta skill solo suma el merge y la limpieza.

**Lo propio de este repo está en `project.md`**, en esta misma carpeta:
quién mergea y si el merge corre sin preguntar. Lo de antes del merge
(qué corre antes del push, planes, review aprobado, bots) está en el
`project.md` de `finish-pr`. Si este archivo es de una versión anterior y
no tiene la sección "Merge", lo que diga del merge en "Qué corre sin
preguntar" vale para el merge.

## Paso 0: Confirmación

Nunca merge sin el OK explícito del usuario, salvo que `project.md` lo deje
correr solo. El OK del ciclo completo cubre lo de `finish-pr` (auditoría,
commit, push, ready) y el merge. **No cubre** los arreglos que salgan de la
revisión o de CI: esos siguen su propio OK en `pr-review-comments`.

**Si mergea la persona** (lo pide, o `project.md` lo dice): corre solo
`finish-pr` y termina con su reporte. No mergees.

## Paso 1: Terminar con `finish-pr`

Corre `finish-pr` con el mismo PR. Hace todo hasta el chequeo de review,
checks y base, y devuelve el estado. Se decide en este orden:

1. **En la nube** (`CLAUDE_CODE_REMOTE` es `true`), aunque el estado sea
   "listo": el merge necesita `gh` en local. Detente con el reporte de
   `finish-pr` y di que el merge queda para una sesión local o para GitHub.
2. **Falta algo:** detente y muestra su reporte tal cual. No mergees.
3. **`Estado: listo para mergear`:** sigue al Paso 2.

## Paso 2: Mergear y limpiar

**Merge commit siempre.** Nunca `--squash` ni `--rebase`: reescriben los
SHAs. Tampoco `gh pr merge --delete-branch`: intenta cambiarse a la base en
local. El merge lo revisa el modo auto de Claude Code, así que puede pedir
la aprobación del usuario: es lo esperado.

```bash
gh pr merge <n> --merge
git push origin --delete <rama>
```

Después, la rama local y el worktree se limpian como dice "Cómo limpiar
después de mergear" en el Paso 8 de `finish-pr` (checkout principal o
worktree). Si la sesión se abrió con `issue-flow issue start`, ofrece
borrar el worktree al salir de Claude.

## Paso 3: Reportar

```text
PR:         #<n> mergeado (<url>)
Commit:     <sha del merge>
Rama:       <rama> borrada en origin; la local, con el worktree
Documentos: <plan o docs al día, o "no aplica">
Pendiente:  <issues propuestas, checks que el usuario decidió ignorar, o "nada">
```
