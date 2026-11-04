# issue-flow en español e inglés, con mensajes finales amigables

Fecha: 2026-11-04 · Estado: borrador para aprobar

## Por qué

Hoy issue-flow mezcla idiomas: el CLI (`src/`) habla en inglés, y las skills
(`skills/*/SKILL.md`) y `docs/` están en español. Lo que ve el usuario debería salir
en español por defecto y en inglés cuando alguien lo pida.

Además, los mensajes finales se pierden. Por ejemplo, al cerrar Claude aparece
`The session is saved. To resume it: issue-flow issue start 34` como una sola línea
suelta después de toda la salida de la sesión. Tampoco sirve para copiar: si la
sesión se abrió con `bun run issue:start:free 34`, el mensaje sugiere otro comando
distinto. Lo que se busca es un cierre que se entienda de un vistazo, que sea amigable
(con Kuro, la mascota de la issue #49) y que diga exactamente cómo volver.

## Objetivos

1. Todos los textos que el CLI muestra **en la terminal** existen en español (`es`) y en
   inglés (`en`).
2. El idioma por defecto es **español siempre**. El inglés solo sale si se pide de forma
   explícita. `LANG` y `LC_ALL` **no** se consultan, porque en macOS suelen venir como
   `en_US.UTF-8` aunque la persona hable español.
3. Los mensajes finales tienen un formato de bloque legible e incluyen a Kuro, la mascota
   de la issue #49.
4. El comando para retomar repite la forma en que se lanzó issue-flow (gestor + script +
   flags que importan).

## No objetivos

- No se traducen las skills. Quedan en español y se les agrega una instrucción para que
  respondan en el idioma del usuario.
- No se traducen las descripciones de `schema.json` (ayuda del editor). Quedan como están.
- No se traduce la salida `--json`: es para máquinas y sus claves y valores no cambian.
- No se guarda en disco cómo se lanzó una issue. Se recuerda solo durante esa ejecución.
- Los textos con lenguaje natural dentro de `--json` (por ejemplo `error` o las notas de
  `labels sync`) quedan siempre en inglés: usan el catálogo `en` fijo, no `out.t`.
  *(Decisión de Claude.)*

## Anti-objetivos (fallaría aunque funcione)

- Cambiar cualquier texto que issue-flow escriba en GitHub o que vuelva a leer de ahí:
  marcadores, palabras de cierre (`Closes`, `Part of`), plantillas y etiquetas
  (`src/config.ts`, `src/issue-text.ts`, `src/branch-name.ts`,
  `skills/github-issues/check-issue.sh`). Pasar esos textos al catálogo sería un error.
- Que Kuro o los colores ensucien logs, pipes o CI.
- Que los dos catálogos se desincronicen sin que nadie lo note.

## Cómo se decide el idioma

Hay dos idiomas independientes.

**Idioma del CLI** (lo que se imprime en la terminal, incluido `--help`). Se toma lo
primero que exista:

1. Flag `--lang es|en`, global y válido en cualquier subcomando.
2. Variable `ISSUE_FLOW_LANG=es|en`.
3. `es`.

Un valor desconocido es un error de uso (exit 2) que muestra los valores válidos.

**Lo que se escribe en GitHub no cambia** (decisión del usuario). El commit inicial, el
cuerpo del PR, los comentarios, los prompts para Claude, los marcadores que se vuelven a
leer ("Slug de rama", `Cloud session:`) y las etiquetas con sus descripciones quedan
exactamente como hoy. No se agrega ninguna clave `lang` a la config. `--lang` y
`ISSUE_FLOW_LANG` solo afectan a la terminal.

## Catálogo de mensajes

- `src/messages/es.ts` y `src/messages/en.ts` exportan el mismo objeto con tipo
  (`Messages`). Cada mensaje es un string o una función con parámetros, por ejemplo
  `sessionSaved(n, resume)`. Se definen en `es.ts` y `en.ts` tiene que cumplir el mismo
  tipo, así TypeScript avisa si falta alguna clave.
- Un test comprueba además que los dos objetos tienen las mismas claves en tiempo de
  ejecución.
- El idioma se resuelve una sola vez en la entrada (`src/cli.ts`) y viaja junto a
  `Output` (`src/output.ts`), por ejemplo como `out.t`, para que los comandos no lean el
  entorno.
- `src/usage.ts` pasa a tener dos versiones del texto de ayuda. La ayuda en español
  conserva el nivel de detalle actual: flags, ejemplos y diferencias entre gestores
  (`npm run x -- 42` vs `pnpm x 42`).
- Sin dependencias nuevas.

## Comando para retomar

`again()` (`src/start-state.ts:73`) hoy siempre devuelve `issue-flow issue start <n> …`.
Pasa a armar el comando a partir de cómo se lanzó el proceso:

- `npm_lifecycle_event` dice el script (por ejemplo `issue:start:free`).
- `npm_config_user_agent` dice el gestor: la primera palabra antes de `/` es `bun`,
  `npm`, `pnpm` o `yarn`.

Comprobado el 2026-11-04 con bun 1.4.4, npm 11.11, pnpm 12.8 y yarn 1.22: los cuatro
dejan ambas variables.

| Gestor | Forma |
|---|---|
| bun | `bun run issue:start:free 34 --no-repo-deny` |
| npm | `npm run issue:start:free 34`, o `npm run issue:start:free -- 34 --no-repo-deny` si hay flags |
| pnpm | `pnpm issue:start:free 34 --no-repo-deny` |
| yarn | `yarn issue:start:free 34 --no-repo-deny` |

- Solo se usa la forma de script si `npm_lifecycle_event` es uno de los scripts que
  issue-flow instala (`issue:start`, `issue:start:free`, ver `src/package-edits.ts`). Si
  no, o si no hay variables (se lanzó con `issue-flow` o `npx`), se usa
  `issue-flow issue start <n> …` como hoy.
- **Flags que se repiten** porque definen cómo corre la sesión: `--free`,
  `--ask-permissions`, `--no-repo-deny`, `--namer`, `-R`. Si el script ya incluye
  `--free`, no se repite.
- **Flags que no se repiten** porque son de una sola vez: `--new`, `--branch`, `--yes`,
  `--dry-run`, `--resume <rama>`, `--no-launch`, `--plan`.
- `--lang <x>` se repite solo si vino como flag. Si vino de `ISSUE_FLOW_LANG`, no hace
  falta, porque la variable sigue en el entorno. *(Decisión de Claude.)*
- Las llamadas que hoy pasan un `extra` explícito (`--cloud`, `--teleport`,
  `--resume <branch>`) lo siguen agregando.
- El cambio aplica en todos los lugares que usan `again()`.

## Mensajes finales: formato de bloque con Kuro

**Qué mensajes son "finales":** los que cierran un comando y dicen qué pasó y qué hacer
después. Hoy son estos:

- `src/start-place.ts`: sesión guardada, PR mergeado (y la pregunta de borrar), los
  motivos para no borrar.
- `src/start-modes.ts`: "Ready: issue #n is on branch …", "Ready. To open the cloud
  session …".
- `src/commands/issue-start.ts`: "Ready. To open the Claude session …", "Bringing the
  cloud session …", "Ready: … Open plan …".
- `src/commands/pr-worktree.ts`: "Ready. To go in: cd …".
- El error que corta `issue start` o `pr worktree` (GitHubError, errores de git, etc.),
  capturado en la entrada del CLI. Va a **stderr** con la marca `[!]`, y Kuro sale si
  **stderr** es una terminal. `UsageError` no lleva a Kuro y sigue mostrando la ayuda. Los
  demás comandos (`labels sync`, `worktree …`, `doctor`, `apply`) no tienen bloque final:
  sus errores solo se traducen. *(Decisión de Claude.)*

Los avisos intermedios (`warn()`, `issue-flow: …` en stderr) se traducen pero no cambian
de formato.

**Formato:**

```
    ▄█████▄
 ≋≋██▀▀▀▀▀██              [ok] Sesión guardada - issue #34
    █ ▄  ▄ █   ╱
    ▀█▄▄▄▄█▀  ╱           Rama  feat/34-agrega-login
                          PR    #51 (draft)

                          Para retomarla:
                            bun run issue:start:free 34
```

- La mascota es **Kuro, el ninja cocinero**, de la issue #49. El usuario pidió que sea
  **idéntica al dibujo de la issue**, con sus bloques Unicode (`▄ █ ▀ ≋ ╱`). Esto
  reemplaza el pedido anterior de usar solo ASCII y el diseño "B". El PR de este cambio
  cierra la #49.
- El dibujo es el mismo en todos los casos. El estado se ve en la marca y en el color del
  título, no en la cara. *(Decisión de Claude, para no alterar el dibujo.)*
- Marcas de estado en ASCII: `[ok]`, `[!]` para errores y `[?]` para preguntas.
- Un test fija el dibujo byte a byte contra el de la issue.
- Estructura: una línea en blanco antes y otra después, el título junto a la cabeza,
  pares etiqueta/valor alineados y el comando a copiar solo en su línea con sangría. Si
  el texto tiene más líneas que Kuro, sigue con la misma sangría. Si tiene menos, el
  dibujo de Kuro sale completo igual.
- Vive en un módulo nuevo (por ejemplo `src/banner.ts`) con una función pura del tipo
  `banner({ mood, title, rows, next }, { art, color }) => string`, que se pueda probar sin
  terminal.

**Cuándo sale Kuro:** solo si stdout es una terminal (`out.interactive` o equivalente
para stdout) **y** la config del repo no tiene `art: false` (clave nueva en
`schema.json`, por defecto `true`). Si no, se imprime el mismo bloque sin dibujo, alineado
a la izquierda.

**Color:** Kuro y el título en color, el comando resaltado. Sin color si
existe `NO_COLOR` o si stdout no es una terminal.

## Skills

Se quedan en español. A cada `SKILL.md` se le agrega una línea que pide responder al
usuario en el idioma en que escribe. Lo que publican en GitHub no cambia.

## Docs

`README.md` sigue en español; `README.en.md` es la traducción al inglés, enlazados entre sí. `docs/`
sigue en español.

## Tests

- Los tests que comparan texto exacto fijan el idioma (por ejemplo
  `ISSUE_FLOW_LANG=en` en el entorno del test, o un `out.t` explícito) para no
  reescribirlos todos. Se agregan casos en español para los mensajes finales.
- Tests nuevos: resolución de idioma (flag > variable > `es`, valor inválido), igualdad
  de claves entre catálogos, `again()` con cada gestor y combinación de flags, `banner()`
  con y sin dibujo y con y sin color, y que el dibujo coincida con el de la #49.
- Los tests que hoy cubren lo que se escribe en GitHub siguen pasando sin cambios. Eso
  confirma que ese texto no se tocó.

## Queda a criterio de quien construye

- Nombres exactos de las claves del catálogo y de los archivos nuevos.
- Cómo se pasa el catálogo (`out.t` u otro campo).
- El color exacto de la capucha.
- El orden de la migración. Una sugerencia: primero el catálogo con `en` igual al texto
  actual, después `es`, después el banner y al final `again()`.
