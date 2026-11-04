/** @file The English messages: the text the CLI always had. */
import type { Messages } from "./es.js";

export const en: Messages = {
  usage: {
    main: `Usage:
  issue-flow issue branch <n>... [--namer claude|title] [--json] [-R owner/repo]
  issue-flow issue branch --missing [--limit <n>] [--namer claude|title] [--dry-run | --yes] [--json] [-R owner/repo]
  issue-flow issue start <n> [--branch] [--dry-run | --yes] [--resume <branch> | --new] [--no-launch]
                             [--ask-permissions | --free [--no-repo-deny]] [--namer claude|title] [-R owner/repo]
  issue-flow issue start <n> --plan [--ask-permissions | --free] [--namer claude|title] [-R owner/repo]
  issue-flow issue start <n> --cloud | --here | --teleport | --adopt [...]
  issue-flow worktree setup [--only <step>]
  issue-flow worktree teardown [--path <dir>]
  issue-flow worktree ports [--next]
  issue-flow worktree cleanup [--path <dir>]
  issue-flow worktree prune [--only <dir>] [--yes] [-R owner/repo]
  issue-flow pr worktree <n> [--no-setup] [-R owner/repo] [-- [<command>...]]
  issue-flow adapter setup [--only <step>] | issue [<url>] | archive [-R owner/repo]
  issue-flow session
  issue-flow hook worktree-create | worktree-remove
  issue-flow apply [--yes] [--dry-run] [--json] [--recipe <name>,...]
  issue-flow doctor [--json]
  issue-flow labels sync [--update] [--dry-run] [--json] [-R owner/repo]

On any command: [--lang es|en] picks the language of the messages (Spanish by default;
ISSUE_FLOW_LANG=es|en sets it for good).

The slug comes from the issue's "Slug de rama" block, then from Claude, then from the title,
and the branch from the repo's template (an older "Rama sugerida" block is used if it fits).
--missing adds the slug block to every open issue without a block, after confirming.

issue start makes the branch in a worktree (or, with --branch, in this checkout), the
start commit, the push, the draft PR and the assignment, after confirming, and opens
Claude: in auto mode if the repo has claude-repo-guard, with your settings with
--ask-permissions, with no sandbox nor questions with --free, and also without the repo's
deny rules with --free --no-repo-deny. --plan prints the branch and the prompt as JSON and
changes nothing. issue start --help explains each flag.

--cloud confirms here and opens a Claude cloud session that starts the issue there.
--here, inside a cloud session, starts it in this checkout and opens nothing. --teleport
brings the cloud session noted in the PR to the worktree. --adopt starts it in the
worktree another tool (Orca, Paseo) just made, without asking nor opening Claude.

worktree runs the steps of "worktrees" in .agents/flow.json: setup prepares this worktree,
teardown cleans it before it goes (steps, ports, Docker), ports prints or moves its block
of ports, cleanup deletes the Docker of deleted worktrees, and prune deletes the worktrees
whose PR was merged or closed, then moves the local base forward to origin's (only if
nothing is lost: not with changes where it is checked out, nor with commits not in
origin). session is the SessionStart hook of Claude Code.

pr worktree makes (or reuses) a worktree on a PR's own branch, to review and fix it; with
--, it runs the command there (Claude if none). adapter is what Orca and Paseo run: setup
when they make a worktree (its steps and, if it came from an issue, issue start --adopt),
issue to start one by hand, and archive before they delete it. hook implements Claude
Code's WorktreeCreate and WorktreeRemove for claude --worktree.

apply leaves the repo as this version needs it: .agents/flow.json (the first time, with
the recipes its files suggest), issue-flow at this version and github-rest and the scripts
if missing in package.json, and the hooks; it changes no other version, and refuses a newer
issue-flow or a range. doctor checks them. npx agent-kitchen apply runs apply at the version
it picks, along with the skills, agent-cloud-kit and claude-repo-guard. init and upgrade still
run apply, with a warning, until 0.4.0.

labels sync makes in GitHub the labels the flow wants ("labels" in .agents/flow.json: the
issue types and P1 to P4 by default) that the repo lacks. Names ignore case and are never
renamed nor deleted; --update also fixes the color and description of those that differ.`,
    start: `Usage: issue-flow issue start <n> [flags]

Starts issue <n>: the branch (in a worktree, or in this checkout with --branch), the empty
start commit, the push, the draft PR and the assignment, after confirming; then it opens
Claude there.

Flags:
  --dry-run            show what it would do and change nothing
  -y, --yes            do it without asking
  --branch             in this checkout instead of a worktree
  --resume <branch>    take that branch of the issue
  --new                make another branch, even if the issue has one
  --no-launch          leave everything ready and do not open Claude
  --namer claude|title who names the branch when the issue has no slug block
  -R owner/repo        another repo than the checkout's
  --plan               print the branch and the prompt as JSON, and change nothing
  --cloud              open a Claude cloud session that starts the issue there
  --here               inside a cloud session, start it in this checkout
  --teleport           bring the cloud session noted in the PR to the worktree
  --adopt              start it in the worktree Orca or Paseo just made
  --lang es|en         language of the messages (es by default, or ISSUE_FLOW_LANG)
  -h, --help           this help

Permissions of the Claude it opens (one at most):
  (none)               auto mode if the repo has claude-repo-guard, else your settings
  --ask-permissions    your settings: Claude asks before what they do not allow
  --free               no sandbox and no questions, as claude:free
  --no-repo-deny       with --free: also without the deny rules of the repo's settings

What each one takes away, and what stays:
  (none), --ask-permissions
                       take nothing away: the sandbox, the questions your settings ask
                       and every deny rule stay.
  --free               takes away the sandbox and the questions. Every deny rule stays:
                       yours (~/.claude), the repo's (.claude/settings.json) and the
                       local ones (.claude/settings.local.json).
  --free --no-repo-deny
                       also takes the deny rules out of the worktree's
                       .claude/settings.json while Claude runs, and puts them back when it
                       exits; git does not see the change meanwhile. Your deny rules and the
                       local ones stay, and so do the repo's hooks, attribution, CLAUDE.md,
                       skills, agents and MCP servers. If Claude changes that file, the
                       rules go back on top of its change, with a warning to review it. If
                       the terminal closes first, the next issue start of the issue puts
                       them back.

From the repo's scripts (issue:start, and issue:start:free, which adds --free):
  npm run issue:start:free 42           npm passes a number on as it is
  npm run issue:start -- 42 --free      but keeps the flags for itself, unless after --
  pnpm issue:start 42 --free            pnpm, bun and yarn pass everything on
  bun run issue:start 42 --free
  yarn issue:start 42 --free
A -- does no harm with any of them: issue-flow drops it.

issue:start:free does not go with --ask-permissions, --cloud, --here nor --adopt: use
issue:start for those. --no-repo-deny goes after it, as any flag:
  npm run issue:start:free -- 42 --no-repo-deny
  pnpm issue:start:free 42 --no-repo-deny`,
  },
  cli: {
    repoFlag: (flag) => `-R expects owner/repo: ${flag}`,
    namer: (value) => `--namer expects claude or title: ${value}`,
    flagNotWith: (flag, name) => `--${flag} does not go with ${name}.`,
    askOrFree: "use --ask-permissions or --free, not both.",
    noRepoDenyNeedsFree: "--no-repo-deny goes with --free.",
    startNeedsNumber: "issue start needs one issue number.",
    resumeWithNew: "--resume does not go with --new.",
    planConflicts: "--plan does not go with --branch, --dry-run, --yes, --resume, --new nor --no-repo-deny.",
    oneWay: (ways) => `use one of --${ways.join(", --")}, not several.`,
    wayNotWith: (way, other) => `--${way} does not go with --${other}.`,
    groupExpects: (group, commands) => `${group} expects ${commands.join(", ")}.`,
    takesNoArguments: (command) => `${command} takes no arguments.`,
    adapterArguments: (command) =>
      command === "issue" ? `adapter ${command} takes at most one URL.` : `adapter ${command} takes no arguments.`,
    prExpects: "pr expects worktree.",
    prNeedsNumber: "pr worktree needs one PR number.",
    labelsExpects: "labels expects sync.",
    missingCommand: "missing the command.",
    unknownCommand: (words) => `unknown command: ${words.join(" ")}`,
    yesOrDryRun: "use --yes or --dry-run, not both.",
    limit: (value) => `--limit expects a positive number: ${value}`,
    missingNoNumbers: "--missing takes no issue numbers.",
    branchNeeds: "issue branch needs issue numbers, or --missing.",
    missingFlags: "--yes, --dry-run and --limit go with --missing.",
  },
  lang: {
    invalid: (source, value) => `${source} expects es or en: ${value}`,
  },
};
