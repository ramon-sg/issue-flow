# 2. Skill en una sesión

[← Flujos](../flujos.md)

Para cuando el pedido llega dentro de una sesión de Claude que ya está
abierta. La skill `start-issue` corre el mismo script que el
[flujo de terminal](terminal.md), pero no abre Claude: ya estás en él.

```text
/start-issue 42
/start-issue 42 --branch
```

## Qué hace la skill

1. **Ve dónde corre la sesión** y elige el modo:

   | Situación | Modo | Opción |
   |---|---|---|
   | Checkout principal, por defecto | Worktree nuevo | (ninguna) |
   | Checkout principal y pediste quedarte ahí | Esta carpeta cambia a la rama | `--branch` |
   | Worktree recién creado por `claude --worktree` (u Orca o Paseo) | Adopta ese worktree: renombra su rama | `--adopt` |
   | Sesión en la nube | Este checkout | `--here` (ver [Nube](nube.md)) |

2. **Muestra el resumen** con `issue start 42 --dry-run` y las mismas
   opciones. No crea nada. Si la issue tiene varias ramas, te pregunta cuál
   retomar.
3. **Espera tu OK.** Nada se escribe (commit, push, PR, asignación) sin él.
   "Continúa" a otra cosa no cuenta.
4. **Ejecuta** `issue start 42 --yes --no-launch` con las mismas opciones.
   En un worktree nuevo corre los pasos de setup, que pueden tardar (instalar
   dependencias). No necesita escribir `.git/config`, que el sandbox de
   Claude Code prohíbe: si no puede dejar la rama siguiendo a `origin`, avisa,
   y el push se hace con `git push origin HEAD`. Si el sandbox bloquea otra
   cosa, no lo reintenta de otra forma: te muestra qué correr en una terminal.
5. **Devuelve el resultado:** la URL del PR, la rama, la carpeta y el
   siguiente paso.
6. **Sigue con la issue.** Cambia el "En progreso." del PR por un resumen
   corto de la issue y da el primer paso según su tipo, o lo que diga
   `project.md`.

Por debajo pasa lo mismo que en la terminal (pasos 1 a 5 del
[flujo de terminal](terminal.md#qué-hace-por-debajo)). La diferencia es el
final:

- **Worktree nuevo:** la sesión actual no se mueve. Para trabajar ahí, desde
  una terminal: `npm run issue:start -- 42`. Encuentra lo que
  se acaba de crear y abre Claude en el worktree.
- **Esta carpeta o adoptar:** la sesión ya está en la rama. La skill sugiere
  `/rename <rama>` y sigue ahí.

## Con `claude --worktree`

`claude --worktree <nombre>` crea un worktree antes de abrir la sesión. Con
los hooks que agrega `issue-flow apply`:

1. **El hook `WorktreeCreate`** (`issue-flow hook worktree-create`) crea
   `<worktrees.dir>/<nombre>` en la rama `worktree-<nombre>` desde
   `origin/<base>`, copia `.worktreeinclude` y corre el setup.
2. **Dentro de la sesión**, `/start-issue 42` ve que está en un worktree
   recién creado y usa `--adopt`: renombra `worktree-<nombre>` a la rama de
   la issue, hace el commit, el push y el PR.
3. **El hook `WorktreeRemove`**, cuando Claude borra el worktree, corre el
   teardown (pasos, puertos, Docker) y borra la rama si todo está en origin.

`--adopt` solo adopta un worktree recién creado: se detiene si su rama ya
está en origin, tiene commits propios o hay cambios sin commitear.

## Opciones de la skill

```text
/start-issue <n> [--branch] [--resume <rama> | --new] [--yes]
```

| Opción | Qué hace |
|---|---|
| `--branch` | Sin worktree: esta carpeta cambia a la rama. Exige que no haya cambios sin commitear. |
| `--resume <rama>` | Retoma esa rama cuando la issue tiene varias. |
| `--new` | Crea una rama nueva aunque la issue ya tenga otras. |
| `--yes` | Da el OK por dado y salta el resumen. Lo usa la sesión de la nube que lanza `--cloud`, porque ya confirmaste en la terminal. |

`--adopt` y `--here` no se escriben: la skill los elige según dónde corre.
`--adopt` no va con `--branch`, `--resume` ni `--new`.

**Sin usuario** (un turno sin supervisión), la skill solo empieza una issue
si `project.md` dice qué label hace de OK y la issue lo tiene.
