---
name: github-issues
description: |
  Crea una issue corta y fácil de entender en el repo (o en otro): cabecera
  de tres líneas, plantilla según sea bug o feature, criterios de aceptación
  verificables, labels, slug de rama y assignee. Revisa duplicados, muestra
  el borrador y crea solo con confirmación. Solo REST, así que funciona
  también en la nube de Claude.
  Usar cuando: (1) El usuario pide crear una issue, (2) Un hallazgo fuera de
  alcance debe quedar registrado en vez de arreglarse en el momento, (3) Hay
  que registrar un bug o una mejora, (4) Un plan deja trabajo para después o
  para otro repo, (5) Hay que adjuntar una captura a una issue.
---

# Issues de GitHub

Una issue es un prompt para quien la resuelva, persona o agente. Las cortas,
que dicen dónde mirar y cómo se comprueba, se resuelven mejor.

> **Regla de oro:** nunca crear ni editar una issue sin el OK explícito del
> usuario. "Ajusta" o "corrige" no es un OK para crear.

**Lo propio de este repo está en `project.md`**, en esta misma carpeta: el
assignee, la taxonomía de labels, si hay un label para que un agente la tome
solo y los topes. Léelo antes de clasificar. Si no existe o sigue igual que
la plantilla, vale lo de esta skill.

Todo va por REST: `npx @ramon-sg/github-rest` (dependencia de desarrollo del repo) y
`gh api`. Nunca `gh issue create`, `gh issue edit` ni `gh search`: usan
GraphQL, que la nube de Claude bloquea. `github-rest` llama a `gh` por
dentro: sirve para no usar GraphQL, no para trabajar sin token. Si
`gh auth status` falla, detente y dilo. El repo sale del `origin` del
checkout; para otro, agrega `-R <owner>/<repo>`.

## 0. ¿Va en una issue?

Cuando la issue nace de un hallazgo en una rama (un comentario de review, un
check de CI, una auditoría), primero mira de dónde viene
(`git log origin/<base>..HEAD` y el diff de esos commits):

- **Lo causó un commit de esta rama:** no va en una issue. Se arregla en la
  rama, aunque esté lejos de lo que pide la issue de la rama.
- **Tiene que ver con lo que la rama intenta arreglar** (el mismo bug por
  otro camino, un caso que el arreglo no cubre): tampoco va. Se arregla en
  la rama.
- **Es parte de otra issue:** no se crea ni se arregla en la rama. Se dice
  así: "no se corrige aquí porque es parte de #N", con el criterio de #N
  que lo cubre.
- **Nada de lo anterior:** está fuera de alcance. Sigue al paso 1.

En los dos primeros casos, devuelve el hallazgo a quien te llamó para que
lo arregle. No hay borrador.

## 1. Buscar duplicados

```bash
gh api -X GET search/issues \
  -f q='repo:<owner>/<repo> is:issue is:open <palabras clave>' \
  --jq '.items[] | "#\(.number) \(.title)"'
```

Si una cubre lo mismo, muéstrala y pregunta si se comenta ahí. Si cubre una
parte, se enlaza.

## 2. Clasificar

Infiere todo y déjalo editable en el borrador.

- **Tipo**, siempre uno: `bug`, `enhancement`, `spike` o `documentation`.
- **El resto**, con la taxonomía de `project.md`. Sin taxonomía, solo los
  labels que ya existen:

  ```bash
  npx @ramon-sg/github-rest label list
  ```

- **Nunca crear labels de pasada.** GitHub crea el label que no existe al
  crear la issue, así que antes del borrador compara con la lista. Si falta
  uno de los que el flujo espera (los de tipo, `P1` a `P4` y los de
  `labels` en `.agents/flow.json`), el borrador lo dice y ofrece crearlos
  todos de una vez, con el color y la descripción del flujo:

  ```bash
  npx @ramon-sg/issue-flow labels sync --dry-run   # qué faltan
  npx @ramon-sg/issue-flow labels sync             # solo con OK
  ```

  Un label que no está en esa lista no se crea: se propone sumarlo a
  `labels` en `.agents/flow.json` (no al `project.md`, que con
  `claude-repo-guard` el agente no puede escribir). Nada se crea sin OK.
- **Tamaño grande** (de días): se propone dividir antes de crearla.
- **Label de agente:** solo si `project.md` define uno y la issue cumple
  todas sus condiciones. Si falta una, no va, y el borrador dice cuál.

## 3. Redactar

Título y cuerpo en el idioma de las issues del repo (`project.md`; si no
dice nada, el de las issues abiertas). El slug de la rama va en inglés. El
estilo es el de `narrative-summary` si está instalada: oraciones cortas, voz
activa, sin relleno.

**Título:** la tarea o el síntoma, en 10 palabras o menos, sin la solución
ni punto final ("El detalle del pedido no se actualiza al volver").

**Bug** (150 palabras como máximo, sin contar los pasos, el error ni los
logs: en un bug son lo que más ayuda a resolverlo):

```markdown
**Qué falla:** <quién hace qué y qué ve, frente a lo esperado>.
**Por qué importa:** <una frase, con un número o un caso>.
**Hecho cuando:** <lo que se ve cuando funciona, por ejemplo "responde 401">.

**Cómo reproducirlo**
1. <paso>
2. <paso>

Error: `<texto exacto, copiado>`   (si hay un error; si no, se omite)

```
<log o stack trace, si hay; recortado a lo pertinente>
```

**Dónde mirar** (hipótesis, no hechos)
- `ruta/archivo.ts` — <por qué>

**Criterios de aceptación**
- [ ] <resultado observable>

**Slug de rama**
`<slug>`
```

**Feature, spike o documentación** (250 palabras como máximo):

```markdown
**Qué se pide:** <el resultado, para quién>.
**Por qué importa:** <el caso concreto que hoy no funciona>.
**Hecho cuando:** <el resultado observable principal>.

**Fuera de alcance**
- <lo que no se hace>

**Dónde mirar**
- `ruta/` — <patrón a imitar o pieza que cambia>

**Criterios de aceptación**
- [ ] <de 1 a 5, cada uno comprobable>

**Slug de rama**
`<slug>`
```

Reglas:

- En un bug, el test de regresión no se escribe como criterio: se da por
  hecho. Los criterios dicen lo observable.
- Cada criterio es observable ("`GET /api/orders/7` devuelve 404 para un
  pedido ajeno"), no una intención ("mejorar la seguridad").
- Nombra archivos, módulos o símbolos que se puedan buscar; evita mandar a
  leer documentos largos.
- **El cuerpo se basta solo:** nada de "como conversamos" ni rutas locales.
  En otro repo, los archivos de este van con su URL de GitHub.
- **Nunca** secretos, tokens, URLs firmadas ni datos personales.
- Si no cabe en el tope, son dos issues, o es una feature que necesita plan
  (`planning`, si está instalada).

Comprueba el cuerpo antes de mostrarlo:

```bash
bash <carpeta de esta skill>/check-issue.sh <archivo-del-cuerpo> <bug|feature>
```

Spike y documentación usan `feature`. Los topes salen de `project.md`.

**Slug de rama:** solo el slug, en inglés, en minúsculas, con guiones y de
40 caracteres como máximo; describe el cambio (`order-detail-refresh`). La
rama completa la arma `issue-flow` con la plantilla del repo
(`branch.template` en `.agents/flow.json`, por defecto
`<tipo>/<número>-<slug>`), con el número de la issue y el tipo del label
(`bug` → `fix`, `enhancement` → `feat`, `documentation` → `docs`, `spike` →
`spike`). Así el cuerpo se escribe antes de que la issue tenga número y no
queda viejo si cambia el label. A las issues que ya existen sin el bloque se
les agrega con `npx @ramon-sg/issue-flow issue branch --missing`.

## 4. Mostrar el borrador y esperar el OK

```
Repo:           <owner>/<repo>
Título:         <título>
Labels:         <tipo>, <los demás>
Faltan labels:  ninguno | <label> (con tu OK, `labels sync` los crea)
Rama:           <tipo>/<n>-<slug>   (slug de rama: <slug>)
Assignee:       <login>
Duplicados:     ninguno | #12 (parcial, enlazada)
Para un agente: sí | no (falta: <condición>) | el repo no usa ese label

<cuerpo>
```

## 5. Crear (REST)

```bash
body_file=$(mktemp "${TMPDIR:-/tmp}/issue-body.XXXXXX")   # o en el scratchpad
cat > "$body_file" <<'EOF'
<cuerpo>
EOF
npx @ramon-sg/github-rest issue create --title "<título>" --body-file "$body_file" \
  --label "<tipo>,<otro>" --assignee <login>
```

Es una sola llamada: el cuerpo no lleva el número, así que no hay nada que
reemplazar después. Devuelve el número y la URL. Si avisa que GitHub ignoró
un label o un assignee, dilo. Devuelve la URL y la rama
(`<tipo>/<número>-<slug>`).

## Adjuntar imágenes

La API de issues no acepta adjuntos. `attach-image.sh` sube la imagen y
devuelve el markdown (`--paste`, `--file <ruta>`, `--last-screenshot` o
`--clipboard`). Se sube **después** del OK, porque un adjunto de una issue
cancelada no se puede borrar. En el borrador se anuncia como
`[captura adjunta: <nombre>]`. Si no responde `201` (en la nube puede
estar bloqueado), crea la issue sin imagen y avisa.
