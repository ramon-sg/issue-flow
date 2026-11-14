/**
 * @file The Spanish messages. Its shape is the shape of every catalog: `en.ts` must match.
 * Messages are strings or functions that build one.
 */
/** A PR state of GitHub in Spanish. */
function stateWord(state: string): string {
  return state === "MERGED" ? "INTEGRADO" : state === "CLOSED" ? "CERRADO" : state;
}

export const es = {
  usage: {
    main: `Uso:
  issue-flow issue branch <n>... [--namer claude|title] [--json] [-R owner/repo]
  issue-flow issue branch --missing [--limit <n>] [--namer claude|title] [--dry-run | --yes] [--json] [-R owner/repo]
  issue-flow issue start <n> [--branch] [--dry-run | --yes] [--resume <rama> | --new] [--no-launch]
                             [--ask-permissions | --free [--no-repo-deny]] [--namer claude|title] [-R owner/repo]
  issue-flow issue start <n> --plan [--ask-permissions | --free] [--namer claude|title] [-R owner/repo]
  issue-flow issue start <n> --cloud | --here | --teleport | --adopt [...]
  issue-flow worktree setup [--only <paso>]
  issue-flow worktree teardown [--path <dir>]
  issue-flow worktree ports [--next]
  issue-flow worktree cleanup [--path <dir>]
  issue-flow worktree prune [--only <dir>] [--yes] [-R owner/repo]
  issue-flow pr worktree <n> [--no-setup] [-R owner/repo] [-- [<comando>...]]
  issue-flow adapter setup [--only <paso>] | issue [<url>] | archive [-R owner/repo]
  issue-flow session
  issue-flow hook worktree-create | worktree-remove
  issue-flow apply [--yes] [--dry-run] [--json] [--recipe <nombre>,...]
  issue-flow doctor [--json]
  issue-flow labels sync [--update] [--dry-run] [--json] [-R owner/repo]

En cualquier comando: [--lang es|en] elige el idioma de los mensajes (español por defecto;
ISSUE_FLOW_LANG=es|en lo fija para siempre).

El slug sale del bloque "Slug de rama" de la issue, luego de Claude y luego del título,
y la rama de la plantilla del repo (si encaja, se usa un bloque "Rama sugerida" antiguo).
--missing agrega el bloque del slug a cada issue abierta que no lo tenga, después de confirmar.

issue start crea la rama en un worktree (o, con --branch, en este checkout), el commit
inicial, el push, el PR en borrador y la asignación, después de confirmar, y abre
Claude: en modo auto si el repo tiene claude-repo-guard, con tus ajustes con
--ask-permissions, sin sandbox ni preguntas con --free, y además sin las reglas deny
del repo con --free --no-repo-deny. --plan imprime la rama y el prompt como JSON y
no cambia nada. issue start --help explica cada flag.

--cloud confirma aquí y abre una sesión cloud de Claude que empieza la issue allá.
--here, dentro de una sesión cloud, la empieza en este checkout y no abre nada. --teleport
trae al worktree la sesión cloud anotada en el PR. --adopt la empieza en el worktree
que otra herramienta (Orca, Paseo) acaba de crear, sin preguntar ni abrir Claude.

worktree ejecuta los pasos de "worktrees" en .agents/flow.json: setup prepara este worktree,
teardown lo limpia antes de que se vaya (pasos, puertos, Docker), ports imprime o mueve su
bloque de puertos, cleanup borra el Docker de los worktrees borrados, y prune borra los
worktrees cuyo PR se fusionó o se cerró, y luego adelanta la base local a la de origin (solo
si no se pierde nada: ni con cambios donde está checked out, ni con commits que origin no
tenga). session es el hook SessionStart de Claude Code.

pr worktree crea (o reutiliza) un worktree en la rama de un PR, para revisarlo y corregirlo;
con --, ejecuta el comando ahí (Claude si no das ninguno). adapter es lo que ejecutan Orca y
Paseo: setup cuando crean un worktree (sus pasos y, si vino de una issue, issue start
--adopt), issue para empezar uno a mano, y archive antes de borrarlo. hook implementa
WorktreeCreate y WorktreeRemove de Claude Code para claude --worktree.

apply deja el repo como esta versión lo necesita: .agents/flow.json (la primera vez, con
las recetas que sugieren sus archivos), issue-flow en esta versión y github-rest y los
scripts si faltan en package.json, y los hooks; no cambia ninguna otra versión, y rechaza
un issue-flow más nuevo o un rango. doctor los revisa. npx agent-kitchen apply ejecuta
apply en la versión que elige, junto con las skills, agent-cloud-kit y claude-repo-guard.
init y upgrade todavía ejecutan apply, con una advertencia, hasta la 0.4.0.

labels sync crea en GitHub las etiquetas que el flujo quiere ("labels" en .agents/flow.json:
los tipos de issue y P1 a P4 por defecto) que le faltan al repo. Los nombres no distinguen
mayúsculas y nunca se renombran ni se borran; --update también corrige el color y la
descripción de las que difieren.`,
    start: `Uso: issue-flow issue start <n> [flags]

Empieza la issue <n>: la rama (en un worktree, o en este checkout con --branch), el commit
inicial vacío, el push, el PR en borrador y la asignación, después de confirmar; luego abre
Claude ahí.

Flags:
  --dry-run            muestra lo que haría y no cambia nada
  -y, --yes            lo hace sin preguntar
  --branch             en este checkout en vez de un worktree
  --resume <rama>      toma esa rama de la issue
  --new                crea otra rama, aunque la issue ya tenga una
  --no-launch          deja todo listo y no abre Claude
  --namer claude|title quién nombra la rama cuando la issue no tiene bloque de slug
  -R owner/repo        otro repo distinto al del checkout
  --plan               imprime la rama y el prompt como JSON, y no cambia nada
  --cloud              abre una sesión cloud de Claude que empieza la issue allá
  --here               dentro de una sesión cloud, la empieza en este checkout
  --teleport           trae al worktree la sesión cloud anotada en el PR
  --adopt              la empieza en el worktree que Orca o Paseo acaba de crear
  --lang es|en         idioma de los mensajes (es por defecto, o ISSUE_FLOW_LANG)
  -h, --help           esta ayuda

Permisos del Claude que abre (uno como máximo):
  (ninguno)            modo auto si el repo tiene claude-repo-guard, si no tus ajustes
  --ask-permissions    tus ajustes: Claude pregunta antes de lo que no permiten
  --free               sin sandbox y sin preguntas, como claude:free
  --no-repo-deny       con --free: también sin las reglas deny de los ajustes del repo

Qué quita cada uno, y qué se queda:
  (ninguno), --ask-permissions
                       no quitan nada: el sandbox, las preguntas que hacen tus ajustes
                       y todas las reglas deny se quedan.
  --free               quita el sandbox y las preguntas. Todas las reglas deny se quedan:
                       las tuyas (~/.claude), las del repo (.claude/settings.json) y las
                       locales (.claude/settings.local.json).
  --free --no-repo-deny
                       además saca las reglas deny del .claude/settings.json del worktree
                       mientras Claude se ejecuta, y las vuelve a poner cuando termina; git
                       no ve el cambio mientras tanto. Tus reglas deny y las locales se
                       quedan, y también los hooks del repo, la atribución, CLAUDE.md, las
                       skills, los agentes y los servidores MCP. Si Claude cambia ese
                       archivo, las reglas vuelven a ponerse encima de su cambio, con una
                       advertencia para que lo revises. Si la terminal se cierra antes, el
                       siguiente issue start de la issue las vuelve a poner.

Desde los scripts del repo (issue:start, e issue:start:free, que agrega --free):
  npm run issue:start:free 42           npm pasa un número tal cual
  npm run issue:start -- 42 --free      pero se queda con los flags, salvo después de --
  pnpm issue:start 42 --free            pnpm, bun y yarn pasan todo
  bun run issue:start 42 --free
  yarn issue:start 42 --free
Un -- no estorba con ninguno: issue-flow lo quita.

issue:start:free no va con --ask-permissions, --cloud, --here ni --adopt: usa
issue:start para esos. --no-repo-deny va después, como cualquier flag:
  npm run issue:start:free -- 42 --no-repo-deny
  pnpm issue:start:free 42 --no-repo-deny`,
  },
  cli: {
    repoFlag: (flag: string): string => `-R espera owner/repo: ${flag}`,
    namer: (value: string): string => `--namer espera claude o title: ${value}`,
    flagNotWith: (flag: string, name: string): string => `--${flag} no va con ${name}.`,
    askOrFree: "usa --ask-permissions o --free, no los dos.",
    noRepoDenyNeedsFree: "--no-repo-deny va con --free.",
    startNeedsNumber: "issue start necesita un número de issue.",
    resumeWithNew: "--resume no va con --new.",
    planConflicts: "--plan no va con --branch, --dry-run, --yes, --resume, --new ni --no-repo-deny.",
    oneWay: (ways: string[]): string => `usa uno de --${ways.join(", --")}, no varios.`,
    wayNotWith: (way: string, other: string): string => `--${way} no va con --${other}.`,
    groupExpects: (group: string, commands: string[]): string => `${group} espera ${commands.join(", ")}.`,
    takesNoArguments: (command: string): string => `${command} no lleva argumentos.`,
    adapterArguments: (command: string): string =>
      command === "issue" ? `adapter ${command} lleva como mucho una URL.` : `adapter ${command} no lleva argumentos.`,
    prExpects: "pr espera worktree.",
    prNeedsNumber: "pr worktree necesita un número de PR.",
    labelsExpects: "labels espera sync.",
    missingCommand: "falta el comando.",
    unknownCommand: (words: string[]): string => `comando desconocido: ${words.join(" ")}`,
    yesOrDryRun: "usa --yes o --dry-run, no los dos.",
    limit: (value: string): string => `--limit espera un número positivo: ${value}`,
    missingNoNumbers: "--missing no lleva números de issue.",
    branchNeeds: "issue branch necesita números de issue, o --missing.",
    missingFlags: "--yes, --dry-run y --limit van con --missing.",
  },
  ask: {
    yesNo: "[s/N]",
  },
  start: {
    label: {
      issue: "Issue:",
      summary: "Resumen:",
      labels: "Etiquetas:",
      color: "Color:",
      mode: "Modo:",
      permissions: "Permisos:",
      actions: "Acciones:",
      note: "Nota:",
      found: "Encontrado:",
      planned: "Planeado:",
      branches: "Ramas:",
      newBranch: "Rama nueva:",
      branch: "Rama:",
      round: "Ronda:",
      session: "Sesión:",
      cloud: "Nube:",
    },
    none: "ninguno",
    no: "no",
    where: {
      both: "local y en origin",
      local: "solo local",
      origin: "solo en origin",
      deleted: "borrada",
    },
    branchText: (branch: string, where: string, own: number) => `${branch} (${where}, ${own} commits propios)`,
    branchPr: (text: string, number: number, state: string) => `${text}, PR #${number}, ${state}`,
    action: {
      cloud: "abrir la sesión cloud, que crea la rama, el commit, el PR y la asignación",
      rename: (current: string, branch: string) => `renombrar la rama ${current} a ${branch}`,
      create: (base: string) => `crear la rama desde origin/${base}`,
      createWorktree: "crear el worktree en la rama",
      checkout: "cambiar a la rama",
      emptyCommit: "commit vacío",
      push: "push",
      draftPr: (first: string) => `PR en borrador (${first})`,
      partOf: (number: number, prs: string) => `Part of #${number} en los PR abiertos (${prs})`,
      reopen: (number: number) => `reabrir el PR #${number}`,
      retitle: (number: number) => `actualizar el título del PR #${number}`,
      assign: (number: number) => `asignarte la #${number}`,
      noteSession: "anotar la sesión en el PR",
      onlySession: "ninguna: solo abrir la sesión",
      allDone: "ninguna: todo estaba hecho",
    },
    leftover: (merged: string, count: string, base: string) => `${merged} tiene ${count} commits que no están en ${base}`,
    found: {
      branch: (text: string) => `rama ${text}`,
      pr: (number: number, state: string) => `PR #${number}, ${state}`,
      prTitle: (current: string, expected: string) => `título del PR "${current}"; esperado "${expected}"`,
      worktree: (where: string) => `worktree en ${where}`,
    },
    round: (next: number, prs: string) => `${next} (ya integrado: ${prs})`,
    mode: {
      adopted: (dir: string) => `worktree adoptado en ${dir}`,
      here: "esta sesión (--here)",
      cloud: "cloud (la sesión crea la rama y el PR)",
      worktree: (where: string) => `worktree en ${where}`,
      branch: "rama en el checkout principal",
    },
    session: {
      teleportList: "cloud (la eliges de la lista de teleport)",
      teleported: (id: string) => `cloud ${id} (traída con teleport)`,
      resumed: " (ya existe, se retoma)",
      cloudNote: (url: string, command: string) => `la issue tiene una sesión cloud (${url}). Para traerla: ${command}`,
    },
    permissions: {
      free: "ninguno: sin sandbox ni preguntas; las reglas de denegación siguen (--free)",
      freeNoRepoDeny:
        "ninguno: sin sandbox, sin preguntas y sin las reglas de denegación del repo; las tuyas siguen (--free --no-repo-deny)",
      ask: "tu configuración (--ask-permissions)",
      noGuard: "tu configuración (claude-repo-guard no está instalado)",
      auto: "modo auto, con el contexto de claude-repo-guard",
    },
    question: {
      continue: "¿Seguir con este trabajo?",
      another: "¿Crear otra rama para la issue?",
      round: (prs: string) => `La issue ya tiene integrado: ${prs}. ¿Empezar una ronda nueva?`,
      start: "¿Empezar la issue?",
    },
    declined: "no se hizo nada.",
    declinedRound: "no se hizo nada. Si la issue ya está lista, ciérrala.",
    pick: {
      header: (number: number, count: number) => `La issue #${number} ya tiene ${count} ramas:\n`,
      other: (proposed: string) => `  n) otra rama nueva: ${proposed}\n`,
      which: (count: number) => `¿Cuál? [1-${count}/n] `,
    },
    error: {
      outsideCheckout: "ejecútalo dentro de un checkout del repo.",
      wrongOrigin: (origin: string, repo: string) =>
        `el origin de este checkout es ${origin}, no ${repo}: la rama se subiría a otro repo. Ejecútalo en un checkout de ${repo}.`,
      notOnGithub: "no está en GitHub",
      noIssue: (number: number, repo: string) => `la issue #${number} no existe en ${repo}.`,
      issueNotOpen: (number: number, state: string) => `la issue #${number} está ${state}; no se empieza.`,
      fetchFailed: "no se pudo hacer fetch de origin",
      claudeBranch: (branches: string) => `la issue tiene una rama de 'claude --worktree' (${branches}): abre esa sesión.`,
      noPropose: "no se pudo proponer una rama.",
      notHers: (branch: string, number: number, list: string) =>
        `la rama ${branch} no es de la issue #${number}. Sus ramas: ${list}`,
      listNone: "ninguna",
      manyYes: (count: number, list: string) => `la issue tiene ${count} ramas (${list}): elige con --resume <rama> o --new.`,
      openPrGone: (number: number, branch: string) =>
        `el PR #${number} sigue abierto y apunta a la rama ${branch}, que ya no está ni en local ni en origin. Recréala con 'git fetch origin pull/${number}/head:${branch}' o cierra ese PR y empieza de nuevo.`,
      staleRefs: (branch: string) =>
        `la rama ${branch} está en GitHub pero no en las refs locales de origin, que parecen viejas: ejecuta 'git fetch origin' e inténtalo de nuevo.`,
      checkedOut: (branch: string, at: string, command: string) =>
        `la issue ya tiene la rama ${branch} (en ${at}): sigue ahí con '${command}'.`,
      teleportNoBranch: (number: number, command: string) =>
        `la issue #${number} no tiene rama: empiézala con '${command}' (o sin flags).`,
      branchInWorktree: (branch: string, at: string) => `la rama ${branch} ya está en el worktree ${at}; ejecútalo sin --branch.`,
      dirtyMain: "el checkout principal tiene cambios sin commitear; haz commit o stash antes. No se hace stash.",
      dirExists: (dir: string, branch: string) => `${dir} ya existe y no es un worktree de ${branch}; revísalo a mano.`,
      worktreeFailed: (err: string, command: string) =>
        `no se pudo crear el worktree: ${err}. Si un sandbox lo detuvo, ejecuta en una terminal: ${command}`,
      mainNotOnBase: (base: string) => `el checkout principal no está en ${base}.`,
      baseAhead: (base: string) => `${base} local tiene commits que no están en origin/${base}; resuélvelo a mano.`,
      baseDiverged: (base: string) => `${base} local se separó de origin/${base}`,
      checkoutFailed: (branch: string) => `no se pudo cambiar a ${branch}`,
      createFailed: (branch: string) => `no se pudo crear ${branch}`,
      commitFailed: "no se pudo hacer el commit inicial",
      pushFailed: (branch: string) => `no se pudo hacer push de ${branch}`,
      deleteWorktreeFailed: (where: string) => `no se pudo borrar ${where} (su teardown ya corrió)`,
      baseCheckoutFailed: (base: string) => `no se pudo cambiar a ${base}`,
      deleteBranchFailed: (branch: string) => `no se pudo borrar ${branch}`,
      adoptInMain: "--adopt se ejecuta dentro de un worktree, no en el checkout principal.",
      adoptDetached: (root: string) => `el worktree ${root} no está en una rama; no se adopta.`,
      adoptMany: (count: number, list: string, command: string) =>
        `la issue ya tiene ${count} ramas (${list}): sigue ahí con '${command}' y borra este worktree.`,
      adoptOne: (branch: string, where: string, command: string) =>
        `la issue ya tiene la rama ${branch} (${where}): sigue ahí con '${command}' y borra este worktree.`,
      adoptAt: (at: string) => `en ${at}`,
      adoptLocal: "local, sin worktree",
      adoptOrigin: "solo en origin",
      adoptNotFresh: (current: string) =>
        `la rama ${current} está en origin o tiene commits propios: solo se adopta un worktree recién creado.`,
      adoptDirty: (root: string) => `el worktree ${root} tiene cambios sin commitear: solo se adopta un worktree recién creado.`,
      renameFailed: (current: string, branch: string) => `no se pudo renombrar ${current} a ${branch}.`,
      hereTaken: (branch: string, at: string, command: string) => `la rama ${branch} ya está en ${at}: sigue ahí con '${command}'.`,
      hereDirty: "este checkout tiene cambios sin commitear; haz commit o stash antes. No se hace stash.",
      cloudTaken: (branch: string, at: string, command: string) =>
        `la rama ${branch} ya está en ${at}: sigue ahí con '${command}', sin --cloud.`,
      cloudLocal: (branch: string) => `la rama ${branch} es solo local: haz push o sigue sin --cloud.`,
      hereCheckout: (branch: string) => `no se pudo dejar ${branch} en este checkout.`,
      hereLocalOnly: (branch: string) =>
        `la rama ${branch} es solo local (en otra máquina o checkout): haz push desde allá y ejecuta esto de nuevo.`,
      hereAhead: (branch: string) =>
        `la rama local ${branch} tiene commits que no están en origin; haz push o resuélvelo a mano.`,
      cloudBranchChars: (branch: string) =>
        `la rama ${branch} tiene caracteres que el prompt de la sesión cloud no puede llevar; renómbrala.`,
      cloudOpenFailed: "no se pudo abrir la sesión cloud.",
    },
    warn: {
      noTypeLabel: (number: number) => `la issue #${number} no tiene etiqueta de tipo.`,
      forks: (prs: string) => `la issue tiene PR desde un fork (${prs}): no se retoman desde aquí.`,
      manyDry: (count: number, list: string, command: string) =>
        `la issue ya tiene ${count} ramas (${list}): se propone una nueva. Para retomar una: ${command}.`,
      othersPartOf: (other: number, number: number) =>
        `no se pudo cambiar el PR #${other} a Part of #${number}; edítalo a mano.`,
      assignFailed: (number: number) => `no se pudo asignarte la issue #${number}.`,
      retitleFailed: (number: number) => `no se pudo actualizar el título del PR #${number}; edítalo a mano.`,
      badPattern: (pattern: string, file: string) => `se omite "${pattern}" de ${file}: no es un patrón válido.`,
      copyFailed: (file: string) => `no se pudo copiar ${file} al worktree.`,
      denyShared: "otra sesión usa este worktree: las reglas de denegación del repo se quedan.",
      noteSession: (pr: number) => `no se pudo anotar la sesión en el PR #${pr}.`,
      cloudBase: (base: string) => `el checkout principal no está en ${base}: la sesión clona su rama actual.`,
      noColor: "no se pudo colorear la sesión; se abre sin color.",
      lockTakeover: (reason: string) => `Se toma el lock de una sesión que ya no existe (${reason}).`,
      lockShared: "el worktree ya está bloqueado (¿hay otra sesión abierta?); se sigue sin bloquearlo.",
    },
    say: {
      ready: (number: number) => `Listo - issue #${number}`,
      openClaude: "Para abrir la sesión de Claude:",
      openCloud: "Para abrir la sesión cloud:",
      cloudOpen: (number: number) => `La sesión cloud está abierta - issue #${number}`,
      bringHere: "Para traerla aquí:",
      branchLabel: "Rama",
      prLabel: "PR",
      prDraft: "en borrador",
      prDraftOf: (number: number) => `#${number} (en borrador)`,
      planLabel: "Plan abierto",
      worktreeLabel: "Worktree",
      baseLabel: "Base",
      teleporting: (number: number) => `Trayendo la sesión cloud - issue #${number}`,
      sessionLabel: "Sesión",
      resumeLater: "Para retomarla después:",
      saved: (number: number) => `Sesión guardada - issue #${number}`,
      resume: "Para retomarla:",
      merged: (number: number) => `El PR se integró - issue #${number}`,
      branchGone: (branch: string) => `La rama local ${branch} ya no existe: no hay nada que borrar.`,
      keepShared: "Otra sesión usa el worktree: no se ofrece borrarlo.",
      keepDirty: (dir: string) => `${dir} tiene cambios sin commitear: no se borra nada.`,
      keepUnpushed: (branch: string) => `${branch} tiene commits que no están en origin: no se borra nada.`,
      ignoredToo: (files: string) => `Sus archivos ignorados también se van: ${files}.`,
      deleteWorktree: "¿Borrar el worktree y la rama local?",
      backToBase: (base: string) => `¿Volver a ${base} y borrar la rama local?`,
      readyPr: (number: number) => `Listo - PR #${number}`,
      goIn: "Para entrar:",
    },
  },
  credentials: {
    title: "git no tiene credenciales de GitHub",
    why: [
      "Las necesita para hablar con origin (fetch y push).",
      "issue-flow no deja que git pida usuario y contraseña: GitHub ya no acepta contraseñas.",
    ],
    fixLabel: "Para que git use tu sesión de gh (una sola vez):",
    runNow: "¿Ejecutarlo ahora?",
    noGh: "gh no está instalado",
    installGh: "Instálalo desde https://cli.github.com y vuelve a intentarlo.",
    failed: "gh auth setup-git no funcionó",
    loginLabel: "Si gh no tiene sesión, inicia una y vuelve a intentarlo:",
    done: "Listo: git usa tu sesión de gh. Se intenta de nuevo.",
  },
  git: {
    untracked: (branch: string): string =>
      `no se pudo hacer que ${branch} siga a origin/${branch} (¿.git/config es de solo lectura, como en un sandbox?); haz push con 'git push origin HEAD'.`,
    updateFetch: (base: string): string => `no se pudo traer ${base} de origin; ${base} local no se actualizó.`,
    updateAhead: (base: string): string => `${base} local tiene commits que no están en origin/${base}; no se actualizó.`,
    updateMove: (base: string): string => `no se pudo mover ${base} local a origin/${base}.`,
    updateDirty: (base: string, at: string): string =>
      `${base} está checked out en ${at} con cambios; no se actualizó. Ejecuta 'git pull --ff-only' ahí.`,
    updateMerge: (base: string, at: string): string => `no se pudo actualizar ${base} en ${at}; ejecuta 'git pull --ff-only' ahí.`,
    noCredentials: "git no tiene credenciales de GitHub: ejecuta 'gh auth setup-git' y vuelve a intentarlo.",
  },
  denyRepo: {
    noFile: (file: string): string => `el repo no tiene ${file}: no hay reglas de denegación que quitar.`,
    invalidJson: (file: string): string => `${file} no es un JSON válido: sus reglas de denegación se quedan.`,
    noRules: (file: string): string => `${file} no tiene reglas de denegación: no hay nada que quitar.`,
    lifted: (file: string): string => `se quitaron las reglas de denegación de ${file} para esta sesión; vuelven cuando Claude termine.`,
    unreadable: (note: string, file: string): string => `no se pudo leer ${note}; revisa las reglas de denegación de ${file} con git diff.`,
    brokenByClaude: (file: string): string =>
      `Claude dejó ${file} como JSON inválido, así que no se pudieron devolver sus reglas de denegación: arréglalo y agrégalas antes de hacer commit (git diff ${file}).`,
    changedByClaude: (file: string): string =>
      `Claude cambió ${file} durante la sesión: sus reglas de denegación volvieron encima de ese cambio; revísalo con git diff ${file}.`,
  },
  propose: {
    badSlug: (number: number, slug: string): string => `#${number}: "${slug}" en "Slug de rama" no es un slug válido; se propone otro.`,
    problem: (number: number, problem: string): string => `#${number}: ${problem}; se propone otro.`,
    prefixDiffers: (number: number, branch: string, type: string): string =>
      `#${number}: la rama sugerida ${branch} no empieza con ${type}/, el tipo de la issue; se usa igual.`,
    noValidName: (number: number): string => `#${number}: Claude no dio un nombre válido; se usa el título.`,
    fromTitle: (error: string, count: number): string => `${error}; se nombran ${count} issue(s) desde el título.`,
  },
  setup: {
    invalidJson: (path: string, detail: string): string => `${path} no es un JSON válido (${detail}); arréglalo y ejecuta de nuevo.`,
    notObject: (path: string): string => `${path} no es un objeto JSON; arréglalo y ejecuta de nuevo.`,
    hooksNotObject: (file: string): string => `${file}: "hooks" no es un objeto; arréglalo y ejecuta de nuevo.`,
    hooksNotList: (file: string, event: string): string => `${file}: hooks.${event} no es una lista de entradas; arréglalo y ejecuta de nuevo.`,
    movedHook: (event: string, from: string, to: string): string => `se movió el hook ${event} de ${from} a ${to}`,
    droppedCloud: (marker: string): string => `se quitó el hook SessionStart de ${marker}: lo ejecuta issue-flow session`,
    addedHook: (event: string): string => `se agregó el hook ${event}`,
    keptRest: (name: string, version: string, needed: string): string =>
      `se mantiene ${name} ${version} (las skills necesitan ${needed} o más reciente: súbelo)`,
    keptFree: (free: string, start: string): string =>
      `se mantiene scripts: ${free}, que se salta el ${start} del repo: haz que ejecute ese con --free, o bórralo`,
  },
  steps: {
    onlyExpects: (config: string, names: string, only: string): string =>
      `--only espera un paso de setup de ${config} (${names === "" ? "no tiene ninguno" : names}): ${only}`,
    stepFailed: (name: string, code: number | null, run: string, root: string): string =>
      `el paso "${name}" falló${code === null ? "" : ` (salida ${code})`}; ejecuta '${run}' en ${root}.`,
    mainCheckoutConfig: (config: string): string => `el ${config} del checkout principal`,
    sourceInvalid: (source: string, reason: string): string => `${source} no es válido: ${reason}; se usan los pasos del checkout principal.`,
    sourceDiffers: (source: string): string => `los pasos de setup salen de ${source}; los del checkout principal difieren (¿está atrasado? haz pull).`,
    waiting: "otro setup está preparando este worktree; se espera…",
    noSteps: (source: string): string => `no hay pasos de setup en ${source}; no se ejecutó nada.`,
    noFreeBlock: "no queda ningún bloque de puertos libre en esta máquina; borra worktrees que ya no uses.",
    lockTimeout: (seconds: number, root: string): string =>
      `otro setup lleva más de ${seconds} s en marcha; no se ejecutó nada. Ejecuta 'issue-flow worktree setup' en ${root} cuando termine.`,
    skipped: (name: string, base: string, run: string, root: string): string =>
      `se omite "${name}": este worktree tiene código que no está en origin/${base}. Revísalo y ejecuta '${run}' en ${root} si confías en él.`,
    dockerOff: "Docker no está en marcha; los contenedores del worktree se quedan. Inicia Docker y ejecuta 'issue-flow worktree cleanup'.",
    dockerFailed: (projects: string): string =>
      `no se pudieron borrar los proyectos de Docker ${projects}; mira qué los retiene con 'docker ps -a --filter label=com.docker.compose.project=<proyecto>'.`,
    stopping: (root: string): string => `se detienen las apps que corren en ${root}.`,
  },
  worktree: {
    insideCheckout: "ejecuta esto dentro de un checkout del repo.",
    teardownMain: "teardown es para worktrees, no para el checkout principal.",
    notOfRepo: (root: string): string => `${root} no es un worktree de este repo.`,
    noPorts: 'este repo no tiene puertos para worktrees: agrega "worktrees.ports" a .agents/flow.json.',
    portsMain: "los puertos son para worktrees, no para el checkout principal.",
    movedBlock: (base: number): string => `el worktree pasa al bloque ${base}: reinicia lo que corre en él.`,
    dockerOff: "Docker no está en marcha; no se limpió nada. Inícialo y ejecuta 'issue-flow worktree cleanup'.",
    deleted: (what: string): string => `borrado: ${what}`,
    dockerStuck: (project: string): string =>
      `no se pudo borrar ${project}; mira qué lo retiene con 'docker ps -a --filter label=com.docker.compose.project=${project}'.`,
    lockedGone: (path: string): string =>
      `bloqueado por una sesión de issue-flow que ya no existe, no se toca: ${path} (libéralo con: git worktree unlock ${path})`,
    inUse: (path: string): string => `en uso por una sesión de Claude, no se toca: ${path}`,
    locked: (lock: string, path: string): string => `bloqueado${lock === "" ? "" : ` (${lock})`}, no se toca: ${path}`,
    notWorktree: (path: string): string => `${path} no es un worktree.`,
    dirty: (state: string, path: string): string => `PR ${stateWord(state)}, pero con cambios sin commitear, no se borra: ${path}`,
    unpushed: (state: string, path: string): string => `PR ${stateWord(state)}, pero con commits que no están en origin, no se borra: ${path}`,
    candidate: (state: string, path: string, branch: string): string => `PR ${stateWord(state)}: ${path} (${branch})`,
    unread: (branches: string): string => `no se pudieron leer de GitHub los PR de ${branches}; se dejaron como estaban.`,
    none: "No hay worktrees que borrar.",
    confirm: "¿Borrar los worktrees de arriba con su rama local y su Docker?",
    deletedNothing: "No se borró nada.",
    changed: (path: string): string => `cambió desde la revisión, no se borra: ${path}`,
    removeFailed: (path: string): string =>
      `no se pudo borrar ${path} (su teardown ya corrió: su Docker y sus puertos ya no están); mira 'git -C ${path} status'.`,
    branchFailed: (branch: string): string => `no se pudo borrar la rama local ${branch}.`,
  },
  adapter: {
    orcaFailed: (root: string): string =>
      `no se pudo preguntar a Orca de qué issue viene este workspace. Si viene de una, ejecuta 'issue-flow adapter issue <url-de-la-issue>' en ${root}.`,
    startFailed: (message: string): string => `no se pudo empezar la issue del workspace: ${message}`,
    retry: (repo: string, number: number, root: string): string =>
      `para reintentar, ejecuta 'issue-flow adapter issue https://github.com/${repo}/issues/${number}' en ${root}`,
    notStarted: (number: number, message: string, retry: string): string => `la issue #${number} no se empezó (${message}); ${retry}.`,
    notIssue: (url: string, repo: string): string => `${url} no es una issue de ${repo}; no se hizo nada.`,
    mainCheckout: "una issue se empieza en un worktree, no en el checkout principal.",
    badConfig: "el .agents/flow.json del checkout principal no es válido; se limpia el Docker sin sus prefijos.",
    dockerFailed: (path: string): string => `no se pudo borrar el Docker de ${path}; ejecuta 'issue-flow worktree cleanup' más tarde.`,
  },
  hook: {
    noName: "el hook no recibió un nombre de worktree.",
    prName: (number: string, name: string): string => `para revisar un PR, ejecuta 'issue-flow pr worktree ${number}', no 'claude --worktree ${name}'.`,
    badName: (name: string): string => `el worktree no puede llamarse '${name}'.`,
    notCheckout: (dir: string): string => `${dir} no es un checkout de git.`,
    fetchFailed: (base: string): string => `no se pudo traer ${base}; se usa el origin/${base} local.`,
    noOrigin: (base: string): string => `no existe origin/${base}, y el worktree no se hace sobre otra base.`,
    makeFailed: (path: string, detail: string): string => `no se pudo hacer el worktree ${path}: ${detail}`,
    noPath: "el hook no recibió worktree_path; no se borra nada.",
    mainNever: "el checkout principal nunca se borra.",
    notOfRepo: (path: string): string => `${path} no es un worktree de este repo; no se borra nada.`,
    uncommitted: (path: string): string => `${path} tiene cambios sin commitear; se conserva. Míralos con 'git -C ${path} status'.`,
    deleteFailed: (path: string, detail: string): string => `no se pudo borrar ${path} (su teardown ya corrió): ${detail}`,
    keptBranch: (branch: string): string => `se conserva la rama ${branch}: tiene commits que no están en origin.`,
  },
  session: {
    noCloudKit: (bin: string, pkg: string): string =>
      `no corrió el setup del entorno (no existe ${bin}). En claude.ai, pon como script de setup del entorno: npx -y ${pkg}@1 setup. Vale para las sesiones nuevas.`,
    cloudFailed: (bin: string, root: string): string => `agent-cloud-kit session falló; ejecuta '${bin} session' en ${root} para ver por qué.`,
    direnvFailed: "no se pudo cargar el .envrc con direnv; la sesión se queda con el entorno que heredó.",
    unstarted: (number: number): string =>
      `la issue #${number} no se empezó: su rama no está publicada y no tiene PR en borrador. Antes de trabajar, ejecuta la skill start-issue (${number}).`,
    dockerFailed: (projects: string): string =>
      `no se pudo borrar el Docker de los worktrees borrados (${projects}); ejecuta 'issue-flow worktree cleanup' para ver por qué.`,
  },
  pr: {
    fetchFailed: (branch: string): string => `no se pudo traer ${branch} de origin`,
    elsewhere: (branch: string, where: string): string =>
      `${branch} está checked out en ${where}; revísala ahí, o cambia ese checkout a otra rama.`,
    makeFailed: (branch: string): string => `no se pudo hacer el worktree de ${branch}`,
    noFastForward: (branch: string): string => `la ${branch} local no avanza hasta origin/${branch}: ves otros commits que los del PR.`,
    noPr: (repo: string, number: number): string => `${repo} no tiene el PR #${number}.`,
    fork: (number: number): string =>
      `el PR #${number} viene de un fork y su rama no está en origin; haz checkout a mano en un worktree con 'gh pr checkout ${number}'.`,
    title: (number: number, url: string): string => `PR #${number}: ${url}`,
    notOpen: (state: string): string => `el PR está ${state === "closed" ? "cerrado" : state === "merged" ? "integrado" : state}.`,
    detached: "un HEAD suelto",
    wrongBranch: (path: string, current: string, branch: string): string =>
      `${path} está en ${current}, no en la rama del PR ${branch}; bórralo con 'git worktree remove ${path}'.`,
    notWorktree: (path: string): string => `${path} existe y no es un worktree de este repo.`,
    created: (branch: string): string => `Worktree en ${branch}: lo que hagas commit y push actualiza el PR.`,
    reusing: "El worktree ya existe; se reutiliza.",
    runFailed: (command: string, message: string): string => `no se pudo ejecutar ${command}: ${message}`,
  },
  apply: {
    unknownRecipe: (name: string, names: string): string => `receta desconocida ${name}; las que hay son ${names}.`,
    askRecipe: (name: string, description: string): string => `Receta ${name}: ${description} ¿Agregarla?`,
    notExact: (pinned: string, example: string, pkg: string): string =>
      `package.json tiene issue-flow ${pinned}, no una versión exacta: los hooks necesitan una. Fija una (como ${example}) y ejecuta 'npx ${pkg}@<esa versión> apply'.`,
    hookOf: (file: string): string => `un hook de ${file}`,
    newer: (where: string, found: string, ours: string, pkg: string): string =>
      `${where} tiene issue-flow ${found}, más reciente que este ${ours}; ejecuta 'npx ${pkg}@${found} apply', o instala primero si se subió package.json a mano.`,
    schemaAt: (version: string): string => `$schema en v${version}`,
    freshNew: "nuevo",
    freshPaseo: "nuevo, con las reglas de rama de paseo.json",
    keptKey: (key: string, now: string, says: string): string => `se mantiene ${key} ${now} (la receta dice ${says})`,
    keptStep: (name: string, key: string): string => `se mantiene el paso "${name}" de worktrees.${key}`,
    addedStep: (key: string, name: string): string => `worktrees.${key}: se agregó "${name}"`,
    writeFailed: (path: string, code: string, already: string): string =>
      `no se pudo escribir ${path} (${code}): dentro de una sesión de Claude el sandbox lo bloquea; ejecuta apply desde tu terminal.${already}`,
    alreadyWrote: (done: string[]): string => ` Ya escribió ${done.join(" y ")}; ejecutarlo de nuevo termina el resto.`,
    insideCheckout: "ejecuta apply dentro de un checkout del repo.",
    mainCheckout: (root: string): string => `ejecuta apply en el checkout principal, ${root}, no en un worktree.`,
    nothingWritten: "no se escribió nada: los archivos del repo sugieren recetas; pasa --yes para tomarlas, o --recipe para elegir.",
    passYes: "pasa --yes o --recipe",
    reviewCommit: "revisa el diff y haz commit",
    already: (version: string): string => `Ya está en issue-flow ${version}.`,
    writes: (version: string): string => `issue-flow ${version}:`,
    wouldWrite: (version: string): string => `issue-flow ${version} escribiría:`,
    next: (command: string | null): string => `Siguiente: ${command === null ? "" : `ejecuta '${command}', `}revisa el diff y haz commit.`,
  },
  doctor: {
    insideCheckout: "ejecuta doctor dentro de un checkout del repo.",
    filesName: "archivos",
    runAgentKitchen: "ejecuta npx agent-kitchen apply",
    runApply: (pkg: string): string => `ejecuta npx ${pkg} apply`,
    valid: "válido",
    staleSchema: (version: string, hint: string): string => `válido, pero su $schema no está en v${version}: ${hint}`,
    restMissing: (hint: string): string => `no está en package.json, y las skills lo llaman: ${hint}`,
    restOld: (found: string, needed: string): string => `${found}, y las skills necesitan ${needed} o más reciente: súbelo en package.json`,
    flowMissing: (hint: string): string => `no está en package.json: ${hint}`,
    flowOther: (found: string, ours: string, hint: string): string => `package.json tiene ${found}, esta es ${ours}: ${hint}`,
    hookName: (event: string): string => `hook ${event}`,
    hookMissing: (file: string, hint: string): string => `no está en ${file}: ${hint}`,
    hookAt: (found: string, ours: string, hint: string): string => `en ${found}, esta es ${ours}: ${hint}`,
  },
  labels: {
    status: {
      created: "creada",
      updated: "actualizada",
      ok: "ok",
      differs: "difiere",
      toCreate: "por crear",
      toUpdate: "por actualizar",
      failed: "falló",
    },
    differs: (found: string, wanted: string): string => `tiene ${found}, el flow quiere ${wanted} (--update lo arregla)`,
    appeared: "apareció en GitHub mientras tanto: ejecuta labels sync de nuevo",
    truncated: (repo: string): string => `no se pudieron leer todas las etiquetas de ${repo}; no se escribió nada, así no se crea ninguna dos veces.`,
  },
  branch: {
    noIssue: (number: number, repo: string): string => `la issue #${number} no existe en ${repo}.`,
    addBlock: (count: number): string => `¿Agregar el bloque "Slug de rama" a ${count} issue(s)?`,
    nothingWritten: "no se escribió nada: pasa --yes para agregar los bloques.",
    moreIssues: "GitHub tiene más issues de las que se leyeron; ejecútalo de nuevo después de esto.",
    jsonNeeds: "--missing --json necesita --dry-run o --yes: no hay terminal donde confirmar.",
    noType: (number: number): string => `#${number}: no tiene etiqueta de tipo, así que su rama no tiene tipo hasta que la tenga.`,
    leftAlone: (number: number): string => `#${number}: recibió un bloque de rama o se borró mientras tanto; se deja como está.`,
    added: (number: number): string => `#${number}: bloque agregado.`,
  },
  cantTellRepo:
    'no se sabe de qué repo se trata: ejecuta dentro de un checkout cuyo origin esté en GitHub, pasa -R owner/repo, o define GH_REPO o "repo" en .agents/flow.json.',
  initNowApply: (command: string): string => `${command} ahora es apply: ejecuta 'issue-flow apply'. ${command} desaparece en la 0.4.0.`,
  goingOn: (message: string): string => `${message}; se sigue con los valores por defecto.`,
  config: {
    notJson: (path: string, detail: string): string => `${path} no es un JSON válido: ${detail}`,
    notJsonObject: (path: string): string => `${path} debe ser un objeto JSON.`,
    unknownKey: (key: string, known: string): string => `clave desconocida "${key}". Conocidas: ${known}.`,
    nonEmptyString: (where: string): string => `"${where}" debe ser un texto no vacío.`,
    mustBeObject: (where: string): string => `"${where}" debe ser un objeto.`,
    mustBeBoolean: (where: string): string => `"${where}" debe ser true o false.`,
    branchType: (where: string): string => `"${where}" debe ser un tipo de rama en minúsculas, como "feat".`,
    templateNeeds: (missing: string[]): string => `"branch.template" necesita ${missing.join(" y ")}.`,
    namerChoice: '"branch.namer" debe ser "claude" o "title".',
    plansDirs: '"plans.dirs" debe ser una lista no vacía de carpetas relativas al repo.',
    colorOne: (where: string, colors: string): string => `"${where}" debe ser uno de ${colors}.`,
    labelName: (where: string, max: number): string => `"${where}" necesita un nombre de 1 a ${max} caracteres, sin espacios en los extremos.`,
    labelTwice: (name: string): string => `"labels" tiene "${name}" dos veces (los nombres ignoran mayúsculas).`,
    labelObjectOrNull: (where: string): string => `"${where}" debe ser un objeto o null.`,
    labelColor: (where: string): string => `"${where}.color" debe ser seis dígitos hexadecimales, sin #, como "1d76db".`,
    labelDescription: (where: string, max: number): string => `"${where}.description" debe ser un texto de hasta ${max} caracteres.`,
    repoFormat: '"repo" debe ser owner/repo.',
    stepsList: (where: string): string => `"${where}" debe ser una lista de pasos.`,
    stepObject: (at: string): string => `"${at}" debe ser un objeto con "name" y "run".`,
    stepName: (at: string): string => `"${at}.name" debe tener letras minúsculas, dígitos y guiones.`,
    stepTwice: (where: string, name: string): string => `"${where}" tiene dos pasos llamados "${name}".`,
    portCount: (key: string): string => `"worktrees.ports.${key}" debe ser un número entero positivo.`,
    portsShape: '"worktrees.ports" debe ser true, false o un objeto.',
    portsEven: '"worktrees.ports.blocks" debe ser par.',
    portsRange: (min: number, max: number): string => `"worktrees.ports" debe quedar entre ${min} y ${max}.`,
    dockerProjects: '"worktrees.dockerProjects" debe ser una lista de prefijos de proyectos de Compose (minúsculas, dígitos, - y _).',
  },
  namer: {
    notInPath: "claude no está en el PATH",
    failed: (message: string): string => `claude falló: ${message}`,
    exited: (status: string, detail: string): string => `claude terminó con ${status}: ${detail}`,
    aSignal: "una señal",
    noDetail: "sin detalle",
  },
  recipeDescription: (name: string, fallback: string): string =>
    ({
      bun: "Instala las dependencias con bun en cada worktree, solo cuando su código está en la rama base.",
      direnv:
        "Permite el .envrc de cada worktree cuyo código está en la rama base, para que direnv (y los secretos que carga, Infisical por ejemplo) funcione ahí.",
      "docker-compose":
        "Le da a cada worktree su propio proyecto de Docker Compose y su bloque de puertos: lo levanta en el setup (solo cuando su código está en la rama base) y lo baja con sus volúmenes en el teardown. El archivo compose toma sus puertos de ISSUE_FLOW_PORT_BASE.",
      npm: "Instala las dependencias con npm ci en cada worktree, solo cuando su código está en la rama base.",
      pnpm: "Instala las dependencias con pnpm en cada worktree, solo cuando su código está en la rama base.",
      "staging-main": "El trabajo empieza desde staging y los PR van allá; main solo recibe los releases.",
    })[name] ?? fallback,
  lang: {
    invalid: (source: string, value: string): string => `${source} espera es o en: ${value}`,
  },
};

/** The shape of a catalog. */
export type Messages = typeof es;
