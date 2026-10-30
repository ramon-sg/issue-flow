---
name: start-issue
description: |
  Empieza el trabajo en una issue del repo con `issue-flow`: detecta si ya hay
  trabajo (ramas, PRs, worktrees), crea o retoma la rama de la convención del
  repo en su worktree, publica un PR en draft que la cierra y deja la issue
  asignada. Funciona en local, en un worktree de `claude --worktree`, de Orca
  o de Paseo, y en la nube de Claude.
  Usar cuando: (1) El usuario pide empezar una issue, (2) Hay que dejar
  rastro visible de que una issue ya está tomada, (3) Hay que abrir el PR en
  draft antes de escribir código, (4) La sesión corre en un worktree o en la
  nube y hay que publicar su rama con la convención, (5) La sesión en la
  nube recibe `/start-issue <n>`.
argument-hint: "<número de issue> [--branch] [--resume <rama> | --new] [--yes]"
---

# Empezar una issue

El flujo vive en `issue-flow issue start` (dependencia de desarrollo del
repo, se llama con `npx @ramon-sg/issue-flow`). Lee el estado, no lo adivina: ramas,
PRs y worktrees de la issue en una sola pasada por REST. Correrlo dos veces
no duplica nada: la segunda vez retoma.

Desde una terminal, lo normal es `npx @ramon-sg/issue-flow issue start <n>`: crea el
worktree, publica el PR en draft y abre Claude ahí, con el nombre de la rama
y el pedido de resumir y planificar. Esta skill es para cuando el pedido
llega dentro de una sesión: corre lo mismo, pero sin abrir Claude, porque
una sesión no puede abrir otra en su pestaña.

El PR en draft es la señal pública de "esto ya lo tomó alguien"; no
significa que haya algo listo para revisar.

**El PR va en español** (título, cuerpo y commits), salvo que `project.md`
diga otro idioma en "Idioma". `issue-flow` usa el título de la issue y, para
el cuerpo y el commit de inicio, `start.prBody` y `start.commitMessage` de
`.agents/flow.json`, que por defecto están en español. Si `project.md` pide
otro idioma y esos textos no lo siguen, dilo en el resumen del Paso 2.

**Lo propio de este repo está en `project.md`**, en esta misma carpeta: qué
flujo sigue cada tipo de issue, cómo se busca la causa de un bug y cómo se
termina. Léelo en el Paso 5. Si no existe o sigue igual que la plantilla,
vale lo de esta skill.

## Paso 0: Confirmación

Nada se escribe (commit, push, PR, asignación) sin el OK explícito del
usuario. El resumen del Paso 2 enumera **todas** las acciones; el OK cubre
solo esas. "Continúa" u "ok" a otra cosa no cuenta.

Excepción: si los argumentos traen `--yes` (lo manda
`issue-flow issue start <n> --cloud`, donde el usuario ya confirmó en la
terminal, junto con `--resume <rama>` o `--new` si eligió), el Paso 0 se da
por confirmado y se salta el `--dry-run`.

**Sin usuario** (un turno sin supervisión): solo si `project.md` dice qué
label es el OK y la issue lo tiene. Sin eso, se detiene y lo dice.

## Paso 1: Dónde corre la sesión

```bash
echo "${CLAUDE_CODE_REMOTE:-}"
git rev-parse --abbrev-ref HEAD
[ "$(git rev-parse --path-format=absolute --git-dir)" = "$(git rev-parse --path-format=absolute --git-common-dir)" ] \
  && echo "checkout principal" || echo "worktree"
```

| Situación | Modo | Flags |
|---|---|---|
| `CLAUDE_CODE_REMOTE` es `true` | **Nube:** este mismo checkout | `--here` |
| Worktree recién hecho por `claude --worktree`, Orca o Paseo (rama `worktree-…` u otra sin commits ni push) | **Adoptar:** renombra la rama de este worktree | `--adopt` |
| Checkout principal, por defecto | **Worktree nuevo** en la carpeta de worktrees del repo | (ninguno) |
| Checkout principal y el usuario pidió quedarse ahí | **Esta carpeta** cambia a la rama; exige árbol limpio | `--branch` |

En la nube **no se usa `gh pr` ni `gh issue`** (el proxy bloquea GraphQL):
`issue-flow` ya va por REST, y cualquier otra consulta también
(`npx @ramon-sg/github-rest` o `gh api`).

## Paso 2: Resumen

```bash
npx @ramon-sg/issue-flow issue start <n> --dry-run [--here | --adopt | --branch] [--resume <rama> | --new]
```

No crea ni cambia nada: solo actualiza las referencias a origin. `--here` y
`--adopt` no van con `--branch`, y `--adopt` no retoma otra rama: no va con
`--resume` ni `--new`. Muestra la
salida tal cual como el borrador a confirmar: issue, labels, rama (o lo que
encontró, si la issue ya se empezó), modo y acciones. Si se crea el PR,
suma a las acciones el resumen de la issue en su cuerpo (Paso 5).

- **Sale con error:** muestra el mensaje y detente. Las guardas son: issue
  cerrada o inexistente, árbol sucio con `--branch`, un worktree que no se
  puede adoptar (ya tiene commits o está en origin) y un repo que no es el
  `origin` del checkout.
- **Avisos** (sin label de tipo, un bloque de rama que no valida, varias
  ramas): se muestran y se sigue.
- **Varias ramas:** el resumen las lista y propone una nueva. Pregunta cuál
  retomar y suma `--resume <rama>` o `--new` en el Paso 3.
- **Ya se empezó:** el resumen dice `Found:` y `Planned:`. La pregunta es
  si se continúa.
- **La issue sigue abierta y su PR ya se mergeó:** propone una tanda nueva
  en otra rama (`-2`, `-3`…); la rama exacta es la del resumen.

## Paso 3: Ejecutar (solo tras el OK)

Con las mismas opciones del Paso 2:

```bash
npx @ramon-sg/issue-flow issue start <n> --yes --no-launch [--here | --adopt | --branch] [--resume <rama> | --new]
```

Con `timeout: 600000` en el Bash: en un worktree nuevo corre los pasos de
`worktrees.setup` de `.agents/flow.json`, que pueden instalar dependencias.
El PR se publica antes, así que si se corta igual queda el rastro público.

**Si el sandbox bloquea algo** (crear el worktree, instalar, Docker), no lo
reintentes de otra forma ni lo saltes: `issue-flow` deja escrito qué correr.
Muéstraselo al usuario para que lo corra en una terminal, y sigue cuando
diga que terminó.

En la nube, la última línea de la salida empieza con `Prompt:`: es el
pedido de la sesión (resumir la issue y planificar). Síguelo como si fuera
el pedido del usuario, sin esperar otra orden.

## Paso 4: Devolver el resultado

```text
PR draft:  <url>
Rama:      <rama>
Carpeta:   <ruta del worktree> | esta misma
Siguiente: <el primer paso del flujo del Paso 5>
```

- **Worktree nuevo:** la sesión de la issue se abre desde una terminal con
  `npx @ramon-sg/issue-flow issue start <n>`, que encuentra lo que se acaba de crear y
  abre Claude en el worktree con el nombre de la rama.
- **Esta carpeta o adoptar:** esta misma sesión ya está en la rama. Sugiere
  `/rename <rama>` y sigue acá.

Si se asignó la issue, dilo también.

## Paso 5: Qué sigue

Primero, el resumen en el PR. El cuerpo que deja `issue-flow` trae la URL
de la issue y `En progreso.`: cambia esa línea por lo que pide la issue en
una o dos oraciones, para que una persona sepa de qué va el PR sin abrirla.
Lenguaje llano, sin detalles de implementación, en el idioma del PR.

```bash
npx @ramon-sg/github-rest pr view <pr>
npx @ramon-sg/github-rest pr edit <pr> --body-file <archivo>
```

Lo demás del cuerpo (`Closes`, la URL, la sesión de la nube) queda igual.
Si el cuerpo ya no dice `En progreso.` (alguien lo escribió, o se retoma un
PR con resumen), no lo toques. Lo cubre el OK del inicio: es parte de
publicar el PR, y en el Paso 2 se nombra junto al PR en draft.

Después, lo que diga `project.md`. Sin nada propio:

| Issue | Primer paso |
|---|---|
| `bug` | Un test que reproduce el bug y falla por esa causa |
| `enhancement` que se describe en una frase | El primer test del comportamiento nuevo |
| `enhancement` con más de un paso o con dudas | Un plan con `planning`, si está instalada, en esta misma rama |
| `spike` | Las preguntas que tiene que responder, y el informe en el PR |
| `documentation` | Editar |

Para dejar el PR listo sin mergearlo, `finish-pr`; para cerrarlo con merge,
`close-pr`. Después del merge,
`npx @ramon-sg/issue-flow worktree prune` borra el worktree con su Docker y sus puertos; si la sesión se abrió
con `issue-flow issue start`, lo ofrece al salir de Claude.

## Notas

- No corras `code-audit` justo después: el commit vacío no tiene diff.
- Nunca `--no-verify` ni `git push --force` en esta skill.
- Para revisar el PR de otra persona, `pr-worktree`, no esta skill.
