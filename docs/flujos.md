# Flujos de trabajo

Hay cuatro formas de empezar una issue. Todas terminan igual: una rama con el
nombre de la convención del repo, un commit vacío pusheado, un PR en draft
que cierra la issue y la issue asignada a ti. Cambia desde dónde la empiezas
y quién abre Claude.

Por debajo, todas corren el mismo comando: `issue-flow issue start <n>`, con
una opción distinta en cada caso.

Los comandos usan los scripts que `issue-flow apply` agrega al `package.json`
del repo: `issue:start`, `issue:start:free` (con `--free`, sin sandbox ni
preguntas), `worktree:prune` y `pr:worktree`. `issue-flow issue start --help`
explica cada opción.

<a id="administradores"></a>Cada administrador de paquetes le pasa los
argumentos al script a su manera:

| Administrador | Solo el número | Con opciones | Un `--` |
|---|---|---|---|
| npm | `npm run issue:start:free 42` | `npm run issue:start -- 42 --branch` | Necesario antes de las opciones: sin él, npm se las queda. |
| pnpm | `pnpm issue:start:free 42` | `pnpm issue:start 42 --branch` | No hace falta. pnpm lo pasa tal cual, e issue-flow lo ignora. |
| bun | `bun run issue:start:free 42` | `bun run issue:start 42 --branch` | No hace falta. bun lo quita. |
| yarn | `yarn issue:start:free 42` | `yarn issue:start 42 --branch` | No hace falta. yarn lo quita. |

Con `--` funciona en los cuatro, así que ante la duda se puede poner.
`issue:start:free` ya trae `--free`, así que no va con `--ask-permissions`,
`--cloud`, `--here` ni `--adopt`: para esas, `issue:start`.

| Flujo | Se empieza con | Dónde queda el trabajo | Quién abre Claude |
|---|---|---|---|
| [1. Terminal](flujos/terminal.md) | `npm run issue:start <n>` | Un worktree nuevo, o esta carpeta con `--branch` | El script, en la misma terminal |
| [2. Skill en una sesión](flujos/skill-en-sesion.md) | `/start-issue <n>` dentro de Claude | Un worktree nuevo, esta carpeta, o el worktree de `claude --worktree` | Nadie: ya estás en una sesión |
| [3. Nube de Claude](flujos/nube.md) | `issue start <n> --cloud` o `/start-issue <n>` en la nube | El checkout de la sesión en la nube | `claude --cloud`, o tú en claude.ai |
| [4. Orca y Paseo](flujos/orca-paseo.md) | Crear un worktree en Orca o Paseo | El worktree que creó la herramienta | La herramienta |

## Resumen de cada flujo

**[1. Terminal](flujos/terminal.md).** El flujo normal en tu máquina. El script lee
la issue, muestra un resumen, pregunta, crea el worktree y el PR, prepara el
worktree (dependencias, puertos, Docker) y abre Claude ahí con un pedido. Al
salir de Claude, si el PR ya se mergeó, ofrece borrar el worktree.

**[2. Skill en una sesión](flujos/skill-en-sesion.md).** Para cuando ya estás dentro
de Claude. La skill `start-issue` corre el mismo script en dos pasos (primero
el resumen, después lo hace con tu OK) pero no abre otra sesión. También
sirve para adoptar el worktree que creó `claude --worktree`.

**[3. Nube de Claude](flujos/nube.md).** La issue se trabaja en una sesión de
claude.ai. Se puede lanzar desde la terminal (`--cloud`), que confirma acá y
abre la sesión, o pedirla dentro de la sesión. Como la sesión queda anotada
en el PR, `--teleport` la trae después a un worktree local.

**[4. Orca y Paseo](flujos/orca-paseo.md).** Estas herramientas crean el worktree y
abren el agente. `orca.yaml` y `paseo.json` llaman a `issue-flow adapter`,
que prepara el worktree y adopta su rama: la renombra a la de la issue y
publica el PR, sin preguntar.

## Después de cualquier flujo

- **Trabajar la issue:** el primer paso depende del tipo de issue (un test
  que reproduce el bug, un plan para una mejora grande). Lo dice el Paso 5
  de la skill `start-issue` y el `project.md` del repo.
- **Revisión:** `pr-review-comments` para los comentarios de los bots y las
  personas.
- **Terminar:** `finish-pr` audita, deja el PR al día, lo saca de draft y
  revisa que se pueda mergear, sin mergearlo. El merge queda para GitHub.
- **Cerrar:** `close-pr` hace lo mismo que `finish-pr` y además mergea y
  limpia.
- **Limpiar:** `npm run worktree:prune` borra los worktrees
  cuyo PR se mergeó o se cerró, con su Docker y sus puertos.

Empezar de nuevo una issue que ya tiene rama la retoma, en cualquier flujo:
el script lee lo que hay (ramas, PRs, worktrees) y no duplica nada.
