# 1. Terminal

[← Flujos](../flujos.md)

El flujo normal en tu máquina: corres el script, confirmas y terminas dentro
de Claude, en un worktree propio de la issue.

```sh
npm run issue:start -- 42
npm run issue:start -- 42 --branch    # sin worktree, en esta carpeta
```

## Qué hace por debajo

1. **Lee la issue y su trabajo.** Hace `git fetch` y lee por REST la issue,
   sus PRs y sus ramas, en GitHub y en esta máquina. Se detiene si la issue
   está cerrada o no existe.
2. **Elige la rama.**
   - Sin ramas vivas, propone una nueva con la plantilla del repo
     (`{type}/{number}-{slug}`). El slug sale del bloque "Slug de rama" de
     la issue, de Claude o del título. Si ese nombre ya se usó en una tanda
     mergeada, suma `-2`, `-3`…
   - Con una rama viva, la retoma.
   - Con varias, pregunta cuál seguir o si crear otra.
3. **Muestra el resumen y pregunta `[y/N]`.** Issue, labels, rama, carpeta,
   permisos y la lista de acciones. Enter vacío es no.
4. **Crea lo que falta.**
   - El worktree en `.claude/worktrees/` (la carpeta sale de `worktrees.dir`
     en `.agents/flow.json`), desde `origin/<base>`.
   - Un commit vacío con `[skip ci]`, el push y el PR en draft. El título es
     el de la issue. El cuerpo dice `Closes #42` (o `Part of #42` si la issue
     tiene otra rama viva) y trae la URL de la issue.
   - Reabre el PR si la rama retomada lo tenía cerrado, y te asigna la issue
     si no tiene a nadie.
5. **Prepara el worktree.** Copia los archivos ignorados que lista
   `.worktreeinclude` (credenciales, `.env`) y corre los pasos de
   `worktrees.setup`: instalar dependencias, levantar Docker, darle un bloque
   de puertos.
6. **Abre Claude en la misma terminal.**
   - La sesión se llama como la rama, con `w-` adelante si está en un
     worktree (`w-feat/42-x`), y toma el color de la prioridad de la issue.
   - Arranca con un pedido: leer la issue, resumirla y seguir la skill
     `start-issue` para elegir el flujo. La skill también cambia el
     "En progreso." del PR por un resumen corto.
   - Cada rama guarda su sesión, así que empezar otra vez la retoma.
   - Mientras Claude corre, el worktree queda bloqueado para que `prune` no
     lo borre.
7. **Al salir de Claude.** Si el PR se mergeó y no queda nada sin pushear,
   ofrece borrar el worktree y la rama. Si no, dice cómo retomar.

## Opciones

| Opción | Qué hace |
|---|---|
| `--dry-run` | Solo el resumen. No crea nada (solo hace `git fetch`). |
| `--yes`, `-y` | No pregunta. Con varias ramas, hay que elegir con `--resume` o `--new`. |
| `--branch` | Sin worktree: cambia esta carpeta a la rama de la issue. Exige que no haya cambios sin commitear. |
| `--resume <rama>` | Retoma esa rama cuando la issue tiene varias. |
| `--new` | Crea una rama nueva aunque la issue ya tenga otras. No va con `--resume`. |
| `--no-launch` | Hace todo, pero no abre Claude. Dice qué correr para abrirlo. |
| `--ask-permissions` | Abre Claude con tus settings, en vez del modo auto de `claude-repo-guard`. |
| `--free` | Abre Claude sin sandbox ni preguntas. |
| `--namer claude\|title` | De dónde sale el slug si la issue no tiene el bloque. |
| `--plan` | Una línea JSON con la rama y el pedido. No cambia nada. No va con `--branch`, `--dry-run`, `--yes`, `--resume` ni `--new`. |
| `--teleport` | Retoma la rama y trae la sesión de la nube anotada en el PR. Ver [Nube](nube.md). |
| `-R owner/repo` | Otro repo que el `origin` de este checkout. |

**Permisos al abrir Claude:** si el repo tiene `claude-repo-guard`, Claude se
abre en modo auto con su contexto. Sin él, con tus settings.

`npm run issue:start -- --help` muestra la ayuda de todo el CLI.

## Cuándo no sirve

- Ya estás dentro de una sesión de Claude: usa la [skill](skill-en-sesion.md),
  porque una sesión no puede abrir otra en su pestaña.
- Quieres trabajar en la nube: usa `--cloud` ([Nube](nube.md)).
