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
  ask: {
    yesNo: "[y/N]",
  },
  start: {
    label: {
      issue: "Issue:",
      summary: "Summary:",
      labels: "Labels:",
      color: "Color:",
      mode: "Mode:",
      permissions: "Permissions:",
      actions: "Actions:",
      note: "Note:",
      found: "Found:",
      planned: "Planned:",
      branches: "Branches:",
      newBranch: "New branch:",
      branch: "Branch:",
      round: "Round:",
      session: "Session:",
      cloud: "Cloud:",
    },
    none: "none",
    no: "no",
    where: {
      both: "local and in origin",
      local: "only local",
      origin: "only in origin",
      deleted: "deleted",
    },
    branchText: (branch, where, own) => `${branch} (${where}, ${own} own commits)`,
    branchPr: (text, number, state) => `${text}, PR #${number}, ${state}`,
    action: {
      cloud: "open the cloud session, which makes the branch, the commit, the PR and the assignment",
      rename: (current, branch) => `rename the branch ${current} to ${branch}`,
      create: (base) => `create the branch from origin/${base}`,
      createWorktree: "create the worktree on the branch",
      checkout: "check out the branch",
      emptyCommit: "empty commit",
      push: "push",
      draftPr: (first) => `draft PR (${first})`,
      partOf: (number, prs) => `Part of #${number} in the open PRs (${prs})`,
      reopen: (number) => `reopen PR #${number}`,
      assign: (number) => `assign #${number} to @me`,
      noteSession: "note the session in the PR",
      onlySession: "none: only open the session",
      allDone: "none: everything was already done",
    },
    leftover: (merged, count, base) => `${merged} has ${count} commits that are not in ${base}`,
    found: {
      branch: (text) => `branch ${text}`,
      pr: (number, state) => `PR #${number}, ${state}`,
      worktree: (where) => `worktree at ${where}`,
    },
    round: (next, prs) => `${next} (already merged: PR ${prs})`,
    mode: {
      adopted: (dir) => `adopted worktree at ${dir}`,
      here: "this session (--here)",
      cloud: "cloud (the session makes the branch and the PR)",
      worktree: (where) => `worktree at ${where}`,
      branch: "branch in the main checkout",
    },
    session: {
      teleportList: "cloud (chosen from teleport's list)",
      teleported: (id) => `cloud ${id} (brought with teleport)`,
      resumed: " (exists, resumed)",
      cloudNote: (url, command) => `the issue has a cloud session (${url}). To bring it: ${command}`,
    },
    permissions: {
      free: "none: no sandbox and no questions; deny rules still apply (--free)",
      freeNoRepoDeny:
        "none: no sandbox, no questions and no deny rules of the repo; yours still apply (--free --no-repo-deny)",
      ask: "your settings (--ask-permissions)",
      noGuard: "your settings (claude-repo-guard is not installed)",
      auto: "auto mode, with claude-repo-guard's context",
    },
    question: {
      continue: "Continue with this work?",
      another: "Create another branch for the issue?",
      round: (prs) => `The issue already has merged PR ${prs}. Start a new round?`,
      start: "Start the issue?",
    },
    declined: "did nothing.",
    declinedRound: "did nothing. If the issue is done, close it.",
    pick: {
      header: (number, count) => `Issue #${number} already has ${count} branches:\n`,
      other: (proposed) => `  n) another new branch: ${proposed}\n`,
      which: (count) => `Which one? [1-${count}/n] `,
    },
    error: {
      outsideCheckout: "run this inside a checkout of the repo.",
      wrongOrigin: (origin, repo) =>
        `this checkout's origin is ${origin}, not ${repo}: the branch would be pushed to another repo. Run it in a checkout of ${repo}.`,
      notOnGithub: "not on GitHub",
      noIssue: (number, repo) => `issue #${number} does not exist in ${repo}.`,
      issueNotOpen: (number, state) => `issue #${number} is ${state}; not starting it.`,
      fetchFailed: "could not fetch origin.",
      claudeBranch: (branches) => `the issue has a 'claude --worktree' branch (${branches}): open that session instead.`,
      noPropose: "could not propose a branch.",
      notHers: (branch, number, list) => `branch ${branch} is not one of issue #${number}'s. Its branches: ${list}`,
      listNone: "none",
      manyYes: (count, list) => `the issue has ${count} branches (${list}): choose with --resume <branch> or --new.`,
      openPrGone: (number, branch) =>
        `PR #${number} is still open and points to branch ${branch}, which is gone locally and in origin. Recreate it with 'git fetch origin pull/${number}/head:${branch}' or close that PR and start again.`,
      staleRefs: (branch) =>
        `branch ${branch} is on GitHub but not in the local refs of origin, which look stale: run 'git fetch origin' and try again.`,
      checkedOut: (branch, at, command) =>
        `the issue already has branch ${branch} (at ${at}): continue there with '${command}'.`,
      teleportNoBranch: (number, command) =>
        `issue #${number} has no branch: start it with '${command}' (or without flags).`,
      branchInWorktree: (branch, at) => `branch ${branch} is already in the worktree ${at}; run without --branch.`,
      dirtyMain: "the main checkout has uncommitted changes; commit or stash them first. No stash is made.",
      dirExists: (dir, branch) => `${dir} already exists and is not a worktree of ${branch}; check it by hand.`,
      worktreeFailed: (err, command) =>
        `could not create the worktree: ${err}. If a sandbox stopped it, run in a terminal: ${command}`,
      mainNotOnBase: (base) => `the main checkout is not on ${base}.`,
      baseAhead: (base) => `local ${base} has commits that are not in origin/${base}; sort it out by hand.`,
      baseDiverged: (base) => `local ${base} diverged from origin/${base}`,
      checkoutFailed: (branch) => `could not check out ${branch}`,
      createFailed: (branch) => `could not create ${branch}`,
      commitFailed: "could not make the start commit",
      pushFailed: (branch) => `could not push ${branch}`,
      deleteWorktreeFailed: (where) => `could not delete ${where} (its teardown already ran)`,
      baseCheckoutFailed: (base) => `could not check out ${base}`,
      deleteBranchFailed: (branch) => `could not delete ${branch}`,
      adoptInMain: "--adopt runs inside a worktree, not in the main checkout.",
      adoptDetached: (root) => `the worktree ${root} is not on a branch; not adopting it.`,
      adoptMany: (count, list, command) =>
        `the issue already has ${count} branches (${list}): continue there with '${command}' and delete this worktree.`,
      adoptOne: (branch, where, command) =>
        `the issue already has branch ${branch} (${where}): continue there with '${command}' and delete this worktree.`,
      adoptAt: (at) => `at ${at}`,
      adoptLocal: "local, without a worktree",
      adoptOrigin: "only in origin",
      adoptNotFresh: (current) =>
        `branch ${current} is in origin or has commits of its own: only a just-made worktree is adopted.`,
      adoptDirty: (root) => `the worktree ${root} has uncommitted changes: only a just-made worktree is adopted.`,
      renameFailed: (current, branch) => `could not rename ${current} to ${branch}.`,
      hereTaken: (branch, at, command) => `branch ${branch} is already at ${at}: continue there with '${command}'.`,
      hereDirty: "this checkout has uncommitted changes; commit or stash them first. No stash is made.",
      cloudTaken: (branch, at, command) =>
        `branch ${branch} is already at ${at}: continue there with '${command}', without --cloud.`,
      cloudLocal: (branch) => `branch ${branch} is only local: push it or go on without --cloud.`,
      hereCheckout: (branch) => `could not leave ${branch} in this checkout.`,
      hereLocalOnly: (branch) =>
        `branch ${branch} is only local (on another machine or checkout): push it from there and run this again.`,
      hereAhead: (branch) =>
        `the local branch ${branch} has commits that are not in origin; push them or sort it out by hand.`,
      cloudBranchChars: (branch) =>
        `branch ${branch} has characters the cloud session's prompt cannot carry; rename it.`,
      cloudOpenFailed: "could not open the cloud session.",
    },
    warn: {
      noTypeLabel: (number) => `issue #${number} has no type label.`,
      forks: (prs) => `the issue has PRs from a fork (${prs}): they are not resumed from here.`,
      manyDry: (count, list, command) =>
        `the issue already has ${count} branches (${list}): proposing a new one. To resume one: ${command}.`,
      othersPartOf: (other, number) => `could not turn PR #${other} into Part of #${number}; edit it by hand.`,
      assignFailed: (number) => `could not assign issue #${number} to you.`,
      badPattern: (pattern, file) => `skipping "${pattern}" of ${file}: it is not a valid pattern.`,
      copyFailed: (file) => `could not copy ${file} to the worktree.`,
      denyShared: "another session uses this worktree: the repo's deny rules stay.",
      noteSession: (pr) => `could not note the session in PR #${pr}.`,
      cloudBase: (base) => `the main checkout is not on ${base}: the session clones its current branch.`,
      noColor: "could not color the session; it opens without a color.",
      lockTakeover: (reason) => `Taking over the lock of a session that is gone (${reason}).`,
      lockShared: "the worktree is already locked (is another session open?); going on without locking it.",
    },
    say: {
      ready: (number) => `Ready - issue #${number}`,
      openClaude: "To open the Claude session:",
      openCloud: "To open the cloud session:",
      cloudOpen: (number) => `The cloud session is open - issue #${number}`,
      bringHere: "To bring it here:",
      branchLabel: "Branch",
      prLabel: "PR",
      prDraft: "draft",
      planLabel: "Open plan",
      worktreeLabel: "Worktree",
      baseLabel: "Base",
      teleporting: (number) => `Bringing the cloud session - issue #${number}`,
      sessionLabel: "Session",
      resumeLater: "To resume it later:",
      saved: (number) => `The session is saved - issue #${number}`,
      resume: "To resume it:",
      merged: (number) => `The PR was merged - issue #${number}`,
      branchGone: (branch) => `The local branch ${branch} no longer exists: nothing to delete.`,
      keepShared: "Another session uses the worktree: not offering to delete it.",
      keepDirty: (dir) => `${dir} has uncommitted changes: deleting nothing.`,
      keepUnpushed: (branch) => `${branch} has commits that are not in origin: deleting nothing.`,
      ignoredToo: (files) => `Its ignored files go too: ${files}.`,
      deleteWorktree: "Delete the worktree and the local branch?",
      backToBase: (base) => `Go back to ${base} and delete the local branch?`,
      readyPr: (number) => `Ready - PR #${number}`,
      goIn: "To go in:",
    },
  },
  lang: {
    invalid: (source, value) => `${source} expects es or en: ${value}`,
  },
};
