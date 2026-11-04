/**
 * @file The Spanish messages. Its shape is the shape of every catalog: `en.ts` must match.
 * Messages are strings or functions that build one.
 */
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
      assign: (number: number) => `asignarte la #${number}`,
      noteSession: "anotar la sesión en el PR",
      onlySession: "ninguna: solo abrir la sesión",
      allDone: "ninguna: todo estaba hecho",
    },
    leftover: (merged: string, count: string, base: string) => `${merged} tiene ${count} commits que no están en ${base}`,
    found: {
      branch: (text: string) => `rama ${text}`,
      pr: (number: number, state: string) => `PR #${number}, ${state}`,
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
      fetchFailed: "no se pudo hacer fetch de origin.",
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
  lang: {
    invalid: (source: string, value: string): string => `${source} espera es o en: ${value}`,
  },
};

/** The shape of a catalog. */
export type Messages = typeof es;
