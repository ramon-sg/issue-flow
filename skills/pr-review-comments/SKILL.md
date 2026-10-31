---
name: pr-review-comments
description: |
  Revisa y resuelve los comentarios de bots y de personas, y el estado de los
  checks de CI, en un PR: verifica cada hallazgo contra el código, propone un
  plan, aplica lo aprobado, responde y resuelve los hilos.
  Usar cuando: (1) El usuario pide revisar los comentarios de un PR,
  (2) Después de pushear a un PR y esperar la revisión, (3) Para resolver
  hilos de review, (4) Para entender por qué un check del PR falla o sigue
  pendiente.
argument-hint: "[número de PR] — si no se pasa, el de la rama actual"
---

# Comentarios de review de un PR

> **Regla de oro:** el OK al plan del Paso 4 autoriza a aplicar los
> arreglos, no a escribir en git ni en GitHub. Cada commit (mostrando antes
> el mensaje), el push y las respuestas y resoluciones de hilos necesitan su
> propio OK explícito. "Continúa", "corrige" u "ok" a otra cosa no lo son.

**Lo propio de este repo está en `project.md`**, en esta misma carpeta: qué
bots revisan y cómo comentan, qué CI corre y cómo se leen sus logs, y los
criterios propios de falso positivo. Léelo antes del Paso 2. Si no existe o
sigue igual que la plantilla, vale lo de esta skill.

Todo se lee por REST con `npx @ramon-sg/github-rest`, que también funciona en la nube.
Resolver un hilo solo existe en GraphQL: se hace en local con `gh`, y en la
nube se deja dicho.

## Paso 1: Obtener el PR

Si no viene como argumento:

```bash
npx @ramon-sg/github-rest pr find "$(git rev-parse --abbrev-ref HEAD)"
```

## Paso 2: Traer comentarios y estado de CI

```bash
npx @ramon-sg/github-rest pr view <n>        # estado, draft, rama y SHA del head
npx @ramon-sg/github-rest pr reviews <n>     # aprobaciones y resúmenes de los bots
npx @ramon-sg/github-rest pr comments <n>    # comentarios del diff, agrupados por hilo
npx @ramon-sg/github-rest issue comments <n> # comentarios generales del PR
npx @ramon-sg/github-rest pr checks <n>      # {sha, checks: [{name, bucket, link}]}
```

`pr comments` devuelve cada hilo con su `id` (el que usa `pr reply`), su
archivo y línea, si quedó `outdated` y sus respuestas. Si un hilo ya está
resuelto solo se ve en GraphQL; en local:

```bash
gh api graphql -f query='{ repository(owner: "<owner>", name: "<repo>") { pullRequest(number: <n>) {
  reviewThreads(first: 100) { nodes { id isResolved comments(first: 1) { nodes { databaseId } } } } } } }'
```

El `databaseId` del primer comentario es el `id` de `pr comments`, y el
`id` del nodo es el del Paso 7.

Un hilo `outdated` apunta a código que ya cambió: verifica si el cambio lo
arregló antes de clasificarlo, sin darlo por resuelto solo por eso.

Los checks no son opcionales: uno en `fail` es una señal más dura que
cualquier comentario (algo se rompió, no es una opinión), y uno en
`pending` se anota para volver a mirarlo, no se da por bueno.

**Si el PR es draft**, muchos bots no lo revisan: dilo y propón sacarlo de
draft (`finish-pr`, Paso 5). No esperes comentarios que no van a llegar.

### Investigar un check que falla

Lee el log real antes de clasificarlo (`project.md` dice dónde; con GitHub
Actions, `gh run view <id> --log-failed`). Decide si el fallo:

- **Lo causó este PR:** va a la tabla del Paso 4 con `CI` como origen y el
  job y el paso en vez de un archivo.
- **Es de infraestructura o intermitente** (red, un servicio caído, un test
  que pasó al reintento): se avisa al usuario en vez de decidir solo. No se
  ignora.
- **Sigue corriendo:** nada que clasificar todavía; se revisa en el Paso 6.

## Paso 3: Clasificar cada comentario

> **Verificar ANTES de clasificar.** La descripción del bot es una
> hipótesis, no un hallazgo. Ve al código y confírmalo o descártalo,
> reprodúcelo si se puede. Si no se puede verificar, se dice.

| Clasificación | Acción |
| --- | --- |
| **Válido y accionable** | Arreglo, commit, respuesta |
| **Falso positivo** | Respuesta con la evidencia de por qué no aplica |
| **Fuera de alcance** | Respuesta y una issue con `github-issues` (sin arreglo) |
| **Informativo** | Sin acción (resúmenes del bot) |

**Fuera de alcance** solo si pasa el paso 0 de `github-issues`: lo que causó
esta rama, o lo que tiene que ver con lo que arregla, es válido y se arregla
acá. Si es parte de otra issue, la respuesta lo dice: "no se corrige aquí
porque es parte de #N".

**Agrupa por causa antes de parchear.** Varios hallazgos con el mismo origen
se arreglan una vez y bien; parchados de a uno dejan el mismo agujero por
otro camino. Tres comentarios sobre "devuelve éxito cuando falló" en
archivos distintos son una convención ausente, no tres bugs.

**Pregunta si generaliza.** El bot reporta dónde miró, no dónde más aplica:
ante cada hallazgo válido, busca el mismo problema en otros archivos.

**Falso positivo**, por ejemplo cuando:

- El bot no tiene el contexto (el plan lo decide a propósito).
- La sugerencia contradice un pedido explícito del usuario o un `CLAUDE.md`.
- El bot pide lo que el linter del repo prohíbe.

## Paso 4: Presentar el plan y pedir confirmación

**Obligatorio.** Antes de aplicar nada, una tabla con **todos** los
comentarios y checks:

| # | Origen | Sev. | Archivo | Comentario | Clasificación | Acción propuesta |
| --- | --- | --- | --- | --- | --- | --- |

`Sev.` es la severidad que dé el bot, si da una. Un check que falla va en
la misma tabla: `Origen` = `CI`, `Archivo` = el job y el paso, `Comentario`
= el resumen del fallo real (del log, no del nombre del job).

Pregunta: "¿Aplico estas correcciones? Dime si quieres cambiar alguna
clasificación." Si un comentario de una persona pide una decisión de
diseño, pregúntala aparte.

## Paso 5: Aplicar los arreglos (solo tras el OK)

Para cada comentario aprobado:

1. Lee el archivo completo.
2. Aplica el arreglo.
3. Verifica: el lint y el test que cubre lo tocado; si el lote es grande, la
   suite.
4. Deja los cambios en stage, muestra el diff resumido y el mensaje
   propuesto, y commitea solo tras el OK. El mensaje dice qué se corrigió y
   de quién vino ("(review de <bot>)").

### Revisa los arreglos con la misma desconfianza que el código

Un arreglo es código nuevo escrito rápido, con la sensación de estar
cerrando algo: en las rondas de review los defectos nuevos suelen entrar por
las correcciones. Antes de responder, relee el diff de los arreglos como si
fuera ajeno. Si el lote es grande o toca dinero, permisos o scripts de
entorno, corre `code-audit` sobre él, diciéndole qué comentarios se estaban
resolviendo.

La verificación también puede pasar por la razón equivocada:

- Una prueba negativa ("esto ya no pasa") vale solo si antes comprobaste que
  el mecanismo **puede** pasar.
- Si el resultado esperado es "no hay nada", confirma que el comando
  **podría** haber mostrado algo.
- Al probar códigos de salida, distingue "falló porque bloqueó" de "falló
  porque reventó": mira el mensaje, no solo el código.

Antes de resolver, vuelve a listar los hilos abiertos y contrástalos con lo
hecho. Clasificar algo como válido no lo arregla.

## Paso 6: Push (con su propio OK)

1. Pide el OK para el push; el del commit no lo cubre. Usa
   `git push origin HEAD`: dentro del sandbox la rama puede no tener upstream.
2. Confirma que llegó: `git ls-remote origin <rama>` coincide con
   `git rev-parse HEAD`. Recién entonces los SHA que cites existen en
   GitHub.
3. El push dispara corridas nuevas: no reportes el estado anterior de los
   checks como final.
4. Los bots vuelven a revisar: **los hallazgos sobre las correcciones suelen
   ser los más graves**. Si traen hallazgos nuevos, es otra vuelta de esta
   skill.

## Paso 7: Responder y resolver hilos (con OK, después del push)

Solo con los arreglos ya en origin y el OK para escribir en el PR:

```bash
npx @ramon-sg/github-rest pr reply <n> <comment-id> --body-file <archivo>
```

Resolver un hilo (los arreglados y los falsos positivos), solo en local:

```bash
gh api graphql -f query='mutation { resolveReviewThread(input: { threadId: "<id del nodo>" }) { thread { isResolved } } }'
```

En la nube no se puede: responde igual y lista en el reporte los hilos que
quedan por resolver en GitHub.

**Qué escribir en la respuesta:** es el registro que alguien leerá en seis
meses. Un "fixed" seco no dice nada.

- Qué se verificó, con el comando y su salida si se reprodujo.
- Qué se cambió y por qué esa opción, con el SHA del commit.
- Si el hallazgo apareció en más lugares de los que señaló el bot.
- Si el arreglo quedó corto, dilo en vez de resolver en silencio.
- En un falso positivo, la evidencia concreta (`archivo:línea`, el documento
  que lo decide).
- En un fuera de alcance, el enlace a la issue.

## Paso 8: Reportar

- Cuántos comentarios había y de quién.
- Cuántos se arreglaron, cuántos eran falsos positivos y cuántos pasaron a
  issue.
- Qué hilos se resolvieron y cuáles quedan.
- Estado de los checks: verdes, pendientes, o fallando y por qué.
- Si los bots ya revisaron el SHA nuevo y con qué resultado.

## Reglas

- Nunca resolver un hilo sin analizar si el comentario es válido.
- Nunca commit, push ni respuesta sin su propio OK.
- Nunca responder ni resolver antes de que el push esté en origin.
- Un check en rojo es un hallazgo, no un dato: lee su log antes de
  clasificarlo.
- Lo que está fuera del alcance del PR va a una issue, no a un arreglo de
  pasada.
