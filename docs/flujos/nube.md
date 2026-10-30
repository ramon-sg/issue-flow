# 3. Nube de Claude

[← Flujos](../flujos.md)

La issue se trabaja en una sesión de Claude en la nube (claude.ai). Hay dos
formas de entrar y una de traer la sesión de vuelta a tu máquina.

```sh
npm run issue:start -- 42 --cloud     # desde la terminal
npm run issue:start -- 42 --teleport  # traer la sesión a un worktree local
```

```text
/start-issue 42    # dentro de una sesión en la nube
```

## Entrada A: desde la terminal con `--cloud`

1. **Lee la issue y elige la rama**, igual que el
   [flujo de terminal](terminal.md#qué-hace-por-debajo). Muestra el resumen
   y pregunta `[y/N]`.
2. **No crea nada acá.** Ni rama ni PR: eso lo hace la sesión de la nube.
   Se detiene si la rama ya está abierta en un checkout o existe solo en
   local, porque la nube no la vería.
3. **Abre la sesión** con `claude --cloud "/start-issue 42 --yes"` desde el
   checkout principal. Si la issue tiene varias ramas, suma la que elegiste
   (`--resume <rama>` o `--new`). Si el checkout principal no está en la
   rama base, avisa: la sesión clona la rama en la que está.
4. **Termina diciendo** cómo traer la sesión después: `--teleport`.

El `--yes` que lleva la sesión es tu OK de la terminal: la skill no vuelve a
preguntar.

## Entrada B: `/start-issue` dentro de la sesión

Abres una sesión en claude.ai sobre el repo y pides `/start-issue 42`. La
skill ve `CLAUDE_CODE_REMOTE=true`, usa `--here`, muestra el resumen y
espera tu OK, como en el [flujo de la skill](skill-en-sesion.md).

## Qué pasa dentro de la sesión

1. **Al abrir la sesión**, el hook `SessionStart` (`issue-flow session`)
   corre `claude-cloud session` y los pasos de setup en el checkout de la
   nube. Si falta `claude-cloud`, dice qué setup script poner en claude.ai.
2. **La skill corre** `issue start 42 --yes --no-launch --here`:
   - Trae todas las ramas de origin (el clon de la nube trae solo una).
   - Deja este checkout en la rama: desde `origin/<base>`, o desde
     `origin/<rama>` si ya existe. Se detiene si hay cambios sin commitear:
     no hace stash.
   - Hace el commit vacío, el push, el PR en draft y la asignación.
   - Anota el link de la sesión en el cuerpo del PR
     (`Cloud session: …`). Queda una sola línea, la de la última sesión.
   - Termina con una línea `Prompt: …`, que la skill sigue como si fuera tu
     pedido: resumir la issue y planificar.
3. **Sigue con la issue** como en local: el resumen en el PR y el primer
   paso según el tipo.

**Límites de la nube:**

- No hay `gh pr` ni `gh issue`, porque el proxy bloquea GraphQL. Todo va por
  REST (`npx @ramon-sg/github-rest` o `gh api`).
- Sacar el PR de draft y mergear necesitan `gh` en local. `finish-pr` te
  pide sacarlo de draft en GitHub, y `close-pr` se detiene antes del merge
  y te dice qué falta.

## Traer la sesión: `--teleport`

```sh
npm run issue:start -- 42 --teleport
```

Retoma la rama como siempre (crea o reusa el worktree, reabre el PR si
estaba cerrado) y abre `claude --teleport` con la sesión anotada en el PR. Si no hay ninguna
anotada, muestra la lista de sesiones para elegir. Después, `claude --resume`
la encuentra.

Sin `--teleport`, retomar una issue abre la sesión local, y el resumen avisa
si hay una en la nube.

## Opciones

| Opción | Dónde | Qué hace |
|---|---|---|
| `--cloud` | Terminal | Confirma acá y abre la sesión de la nube que empieza la issue. |
| `--here` | Dentro de la nube (la elige la skill) | Empieza la issue en este checkout. No abre Claude. |
| `--teleport` | Terminal | Trae al worktree la sesión anotada en el PR. Necesita que la issue tenga rama. |
| `--resume <rama>` / `--new` | Las dos | Cuál rama, si la issue tiene varias. `--teleport` no va con `--new`. |
| `--dry-run`, `--yes`, `--no-launch` | Las dos | Como en la [terminal](terminal.md#opciones). `--teleport` no va con `--no-launch`. |

`--cloud`, `--here`, `--teleport` y `--adopt` van de a uno. `--cloud` y
`--here` no van con `--branch`, `--plan`, `--ask-permissions` ni `--free`.
