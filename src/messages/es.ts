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
  lang: {
    invalid: (source: string, value: string): string => `${source} espera es o en: ${value}`,
  },
};

/** The shape of a catalog. */
export type Messages = typeof es;
