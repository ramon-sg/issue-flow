# 4. Orca y Paseo

[← Flujos](../flujos.md)

Orca y Paseo crean el worktree y abren el agente por su cuenta. `issue-flow`
se engancha en sus scripts de setup y de borrado, y deja el worktree igual
que uno de `issue start`: preparado, en la rama de la issue y con su PR.

```yaml
# orca.yaml
setupAgentStartupPolicy: wait-for-setup
scripts:
  setup: npx @ramon-sg/issue-flow adapter setup
  archive: npx @ramon-sg/issue-flow adapter archive
```

```json
{ "worktree": { "setup": ["npx @ramon-sg/issue-flow adapter setup"], "teardown": "npx @ramon-sg/issue-flow adapter archive" } }
```

El segundo bloque va en `paseo.json`. Acá va `npx` y no un script de
`npm run`, porque `init` no agrega uno para `adapter`.

## Qué hace por debajo

**Al crear el worktree** (`adapter setup`):

1. Copia los archivos de `.worktreeinclude` (Paseo no los copia).
2. Corre los pasos de `worktrees.setup` de `.agents/flow.json`.
3. Busca la issue de la que salió el worktree:
   - **Paseo:** de la rama (`feat/42-x` o `42-x`).
   - **Orca:** de su CLI (`orca worktree current --json`).
4. Si la encuentra, corre `issue start 42 --adopt`, que no pregunta:
   - Si la rama ya lleva el número de la issue (`fix/42-mi-nombre`), la deja
     como está. Si no, la renombra a la rama de la issue.
   - Si el worktree ya está en una rama viva de la issue, la retoma.
   - Hace el commit vacío, el push, el PR en draft y la asignación.
5. Siempre sale con 0, para no frenar a la herramienta. Si algo falla, dice
   qué correr.

Después, la herramienta abre el agente en el worktree. `issue-flow` no abre
Claude en este flujo.

**Al borrar el worktree** (`adapter archive`): corre el teardown, es decir
los pasos de limpieza, detiene las apps del worktree y libera sus puertos y
su Docker. También sale siempre con 0, porque un archive que falla no puede
bloquear el borrado.

## Cuándo `--adopt` se detiene

Solo adopta un worktree recién creado. Se detiene si:

- Su rama ya está en origin o tiene commits propios.
- Hay cambios sin commitear (los archivos sin seguimiento no cuentan: la
  herramienta puede dejar los suyos).
- La issue ya tiene su rama en otro lado. Ahí dice que sigas allá y borres
  este worktree.

## Opciones

| Comando | Qué hace |
|---|---|
| `adapter setup` | Prepara el worktree y adopta la issue. |
| `adapter setup --only <paso>` | Solo ese paso de setup. No adopta la issue. |
| `adapter issue [<url>]` | Solo empieza la issue, a mano. Con la URL sale con el código de `issue start`. |
| `adapter archive` | El teardown del worktree antes de borrarlo. |

Los worktrees de Orca y Paseo también los borra
`npm run worktree:prune` cuando su PR se mergea o se
cierra.
