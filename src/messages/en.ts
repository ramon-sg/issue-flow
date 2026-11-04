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
      fetchFailed: "could not fetch origin",
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
      prDraftOf: (number) => `#${number} (draft)`,
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
  credentials: {
    title: "git has no GitHub credentials",
    why: [
      "It needs them to talk to origin (fetch and push).",
      "issue-flow does not let git ask for a username and password: GitHub no longer takes passwords.",
    ],
    fixLabel: "To make git use your gh session (once):",
    runNow: "Run it now?",
    noGh: "gh is not installed",
    installGh: "Install it from https://cli.github.com and try again.",
    failed: "gh auth setup-git did not work",
    loginLabel: "If gh is not logged in, log in and try again:",
    done: "Done: git uses your gh session. Trying again.",
  },
  git: {
    untracked: (branch) =>
      `could not make ${branch} track origin/${branch} (is .git/config read-only, as in a sandbox?); push with 'git push origin HEAD'.`,
    updateFetch: (base) => `could not fetch ${base} from origin; local ${base} was not updated.`,
    updateAhead: (base) => `local ${base} has commits that are not in origin/${base}; it was not updated.`,
    updateMove: (base) => `could not move local ${base} to origin/${base}.`,
    updateDirty: (base, at) =>
      `${base} is checked out in ${at} with changes; it was not updated. Run 'git pull --ff-only' there.`,
    updateMerge: (base, at) => `could not update ${base} in ${at}; run 'git pull --ff-only' there.`,
    noCredentials: "git has no GitHub credentials: run 'gh auth setup-git' and try again.",
  },
  denyRepo: {
    noFile: (file) => `the repo has no ${file}: there are no deny rules to take out.`,
    invalidJson: (file) => `${file} is not valid JSON: its deny rules stay.`,
    noRules: (file) => `${file} has no deny rules: nothing to take out.`,
    lifted: (file) => `took out the deny rules of ${file} for this session; they come back when Claude exits.`,
    unreadable: (note, file) => `could not read ${note}; check the deny rules of ${file} with git diff.`,
    brokenByClaude: (file) =>
      `Claude left ${file} as invalid JSON, so its deny rules could not be put back: fix it and add them before committing (git diff ${file}).`,
    changedByClaude: (file) =>
      `Claude changed ${file} during the session: its deny rules are back on top of that change; review it with git diff ${file}.`,
  },
  propose: {
    badSlug: (number, slug) => `#${number}: "${slug}" in "Slug de rama" is not a valid slug; proposing another.`,
    problem: (number, problem) => `#${number}: ${problem}; proposing another.`,
    prefixDiffers: (number, branch, type) =>
      `#${number}: the suggested branch ${branch} does not start with ${type}/, the issue's type; using it anyway.`,
    noValidName: (number) => `#${number}: Claude gave no valid name; using the title.`,
    fromTitle: (error, count) => `${error}; naming ${count} issue(s) from the title.`,
  },
  setup: {
    invalidJson: (path, detail) => `${path} is not valid JSON (${detail}); fix it and run again.`,
    notObject: (path) => `${path} is not a JSON object; fix it and run again.`,
    hooksNotObject: (file) => `${file}: "hooks" is not an object; fix it and run again.`,
    hooksNotList: (file, event) => `${file}: hooks.${event} is not a list of entries; fix it and run again.`,
    movedHook: (event, from, to) => `moved the ${event} hook from ${from} to ${to}`,
    droppedCloud: (marker) => `dropped the ${marker} SessionStart hook: issue-flow session runs it`,
    addedHook: (event) => `added the ${event} hook`,
    keptRest: (name, version, needed) => `kept ${name} ${version} (the skills need ${needed} or newer: raise it)`,
    keptFree: (free, start) =>
      `kept scripts: ${free}, which skips the repo's own ${start}: make it run that one with --free, or delete it`,
  },
  steps: {
    onlyExpects: (config, names, only) => `--only expects a setup step of ${config} (${names === "" ? "it has none" : names}): ${only}`,
    stepFailed: (name, code, run, root) =>
      `step "${name}" failed${code === null ? "" : ` (exit ${code})`}; run '${run}' in ${root}.`,
    mainCheckoutConfig: (config) => `the main checkout's ${config}`,
    sourceInvalid: (source, reason) => `${source} is not valid: ${reason}; using the main checkout's steps.`,
    sourceDiffers: (source) => `the setup steps come from ${source}; the main checkout's differ (is it behind? pull it).`,
    waiting: "another setup is preparing this worktree; waiting for it…",
    noSteps: (source) => `no setup steps in ${source}; nothing ran.`,
    noFreeBlock: "no block of ports is free on this machine; delete worktrees you no longer use.",
    lockTimeout: (seconds, root) =>
      `another setup has been running for over ${seconds} s; nothing ran. Run 'issue-flow worktree setup' in ${root} when it ends.`,
    skipped: (name, base, run, root) =>
      `skipped "${name}": this worktree has code that is not in origin/${base}. Check it and run '${run}' in ${root} if you trust it.`,
    dockerOff: "Docker is not running; the worktree's containers stay. Start Docker and run 'issue-flow worktree cleanup'.",
    dockerFailed: (projects) =>
      `could not delete the Docker projects ${projects}; see what holds them with 'docker ps -a --filter label=com.docker.compose.project=<project>'.`,
    stopping: (root) => `stopping the apps that run in ${root}.`,
  },
  worktree: {
    insideCheckout: "run this inside a checkout of the repo.",
    teardownMain: "teardown is for worktrees, not the main checkout.",
    notOfRepo: (root) => `${root} is not a worktree of this repo.`,
    noPorts: 'this repo has no ports for worktrees: add "worktrees.ports" to .agents/flow.json.',
    portsMain: "ports are for worktrees, not the main checkout.",
    movedBlock: (base) => `the worktree moves to block ${base}: restart what runs in it.`,
    dockerOff: "Docker is not running; nothing was cleaned. Start it and run 'issue-flow worktree cleanup'.",
    deleted: (what) => `deleted: ${what}`,
    dockerStuck: (project) =>
      `could not delete ${project}; see what holds it with 'docker ps -a --filter label=com.docker.compose.project=${project}'.`,
    lockedGone: (path) =>
      `locked by an issue-flow session that is gone, not touched: ${path} (free it with: git worktree unlock ${path})`,
    inUse: (path) => `in use by a Claude session, not touched: ${path}`,
    locked: (lock, path) => `locked${lock === "" ? "" : ` (${lock})`}, not touched: ${path}`,
    notWorktree: (path) => `${path} is not a worktree.`,
    dirty: (state, path) => `PR ${state}, but with uncommitted changes, not deleted: ${path}`,
    unpushed: (state, path) => `PR ${state}, but with commits that are not in origin, not deleted: ${path}`,
    candidate: (state, path, branch) => `PR ${state}: ${path} (${branch})`,
    unread: (branches) => `could not read the PRs of ${branches} from GitHub; they were left alone.`,
    none: "No worktrees to delete.",
    confirm: "Delete the worktrees above with their local branch and their Docker?",
    deletedNothing: "Deleted nothing.",
    changed: (path) => `changed since the check, not deleted: ${path}`,
    removeFailed: (path) =>
      `could not delete ${path} (its teardown already ran: its Docker and ports are gone); see 'git -C ${path} status'.`,
    branchFailed: (branch) => `could not delete the local branch ${branch}.`,
  },
  adapter: {
    orcaFailed: (root) =>
      `could not ask Orca which issue this workspace came from. If it came from one, run 'issue-flow adapter issue <issue-url>' in ${root}.`,
    startFailed: (message) => `could not start the workspace's issue: ${message}`,
    retry: (repo, number, root) =>
      `to retry, run 'issue-flow adapter issue https://github.com/${repo}/issues/${number}' in ${root}`,
    notStarted: (number, message, retry) => `issue #${number} was not started (${message}); ${retry}.`,
    notIssue: (url, repo) => `${url} is not an issue of ${repo}; nothing done.`,
    mainCheckout: "an issue starts in a worktree, not in the main checkout.",
    badConfig: "the main checkout's .agents/flow.json is not valid; cleaning the Docker without its prefixes.",
    dockerFailed: (path) => `could not delete the Docker of ${path}; run 'issue-flow worktree cleanup' later.`,
  },
  hook: {
    noName: "the hook got no worktree name.",
    prName: (number, name) => `to review a PR, run 'issue-flow pr worktree ${number}', not 'claude --worktree ${name}'.`,
    badName: (name) => `the worktree name cannot be '${name}'.`,
    notCheckout: (dir) => `${dir} is not a git checkout.`,
    fetchFailed: (base) => `could not fetch ${base}; using the local origin/${base}.`,
    noOrigin: (base) => `there is no origin/${base}, and the worktree is not made on another base.`,
    makeFailed: (path, detail) => `could not make the worktree ${path}: ${detail}`,
    noPath: "the hook got no worktree_path; deleting nothing.",
    mainNever: "the main checkout is never deleted.",
    notOfRepo: (path) => `${path} is not a worktree of this repo; deleting nothing.`,
    uncommitted: (path) => `${path} has uncommitted changes; kept. See them with 'git -C ${path} status'.`,
    deleteFailed: (path, detail) => `could not delete ${path} (its teardown already ran): ${detail}`,
    keptBranch: (branch) => `kept the branch ${branch}: it has commits that are not in origin.`,
  },
  session: {
    noCloudKit: (bin, pkg) =>
      `the environment setup did not run (there is no ${bin}). In claude.ai, set the environment's setup script to: npx -y ${pkg}@1 setup. It applies to new sessions.`,
    cloudFailed: (bin, root) => `agent-cloud-kit session failed; run '${bin} session' in ${root} to see why.`,
    direnvFailed: "could not load the .envrc with direnv; the session keeps the environment it inherited.",
    unstarted: (number) =>
      `issue #${number} was not started: its branch is not published and has no draft PR. Before working, run the start-issue skill (${number}).`,
    dockerFailed: (projects) =>
      `could not delete the Docker of deleted worktrees (${projects}); run 'issue-flow worktree cleanup' to see why.`,
  },
  pr: {
    fetchFailed: (branch) => `could not fetch ${branch} from origin`,
    elsewhere: (branch, where) =>
      `${branch} is checked out in ${where}; review it there, or switch that checkout to another branch.`,
    makeFailed: (branch) => `could not make the worktree of ${branch}`,
    noFastForward: (branch) => `the local ${branch} does not move forward to origin/${branch}: you see other commits than the PR's.`,
    noPr: (repo, number) => `${repo} has no PR #${number}.`,
    fork: (number) =>
      `PR #${number} comes from a fork and its branch is not in origin; check it out by hand in a worktree with 'gh pr checkout ${number}'.`,
    title: (number, url) => `PR #${number}: ${url}`,
    notOpen: (state) => `the PR is ${state}.`,
    detached: "a detached HEAD",
    wrongBranch: (path, current, branch) =>
      `${path} is on ${current}, not on the PR's branch ${branch}; delete it with 'git worktree remove ${path}'.`,
    notWorktree: (path) => `${path} exists and is not a worktree of this repo.`,
    created: (branch) => `Worktree on ${branch}: what you commit and push updates the PR.`,
    reusing: "The worktree already exists; reusing it.",
    runFailed: (command, message) => `could not run ${command}: ${message}`,
  },
  apply: {
    unknownRecipe: (name, names) => `unknown recipe ${name}; there are ${names}.`,
    askRecipe: (name, description) => `Recipe ${name}: ${description} Add it?`,
    notExact: (pinned, example, pkg) =>
      `package.json has issue-flow ${pinned}, not an exact version: the hooks need one. Pin one (such as ${example}) and run 'npx ${pkg}@<that version> apply'.`,
    hookOf: (file) => `a hook of ${file}`,
    newer: (where, found, ours, pkg) =>
      `${where} has issue-flow ${found}, newer than this ${ours}; run 'npx ${pkg}@${found} apply', or install first if package.json was bumped by hand.`,
    schemaAt: (version) => `$schema at v${version}`,
    freshNew: "new",
    freshPaseo: "new, with the branch rules of paseo.json",
    keptKey: (key, now, says) => `kept ${key} ${now} (the recipe says ${says})`,
    keptStep: (name, key) => `kept the "${name}" step of worktrees.${key}`,
    addedStep: (key, name) => `worktrees.${key}: added "${name}"`,
    writeFailed: (path, code, already) =>
      `could not write ${path} (${code}): inside a Claude session the sandbox blocks it; run apply from your terminal.${already}`,
    alreadyWrote: (done) => ` It already wrote ${done.join(" and ")}; running it again finishes the rest.`,
    insideCheckout: "run apply inside a checkout of the repo.",
    mainCheckout: (root) => `run apply in the main checkout, ${root}, not in a worktree.`,
    nothingWritten: "nothing written: the repo's files suggest recipes; pass --yes to take them, or --recipe to pick.",
    passYes: "pass --yes or --recipe",
    reviewCommit: "review the diff and commit it",
    already: (version) => `Already at issue-flow ${version}.`,
    writes: (version) => `issue-flow ${version}:`,
    wouldWrite: (version) => `issue-flow ${version} would write:`,
    next: (command) => `Next: ${command === null ? "" : `run '${command}', `}review the diff and commit it.`,
  },
  doctor: {
    insideCheckout: "run doctor inside a checkout of the repo.",
    filesName: "files",
    runAgentKitchen: "run npx agent-kitchen apply",
    runApply: (pkg) => `run npx ${pkg} apply`,
    valid: "valid",
    staleSchema: (version, hint) => `valid, but its $schema is not at v${version}: ${hint}`,
    restMissing: (hint) => `not in package.json, and the skills call it: ${hint}`,
    restOld: (found, needed) => `${found}, and the skills need ${needed} or newer: raise it in package.json`,
    flowMissing: (hint) => `not in package.json: ${hint}`,
    flowOther: (found, ours, hint) => `package.json has ${found}, this is ${ours}: ${hint}`,
    hookName: (event) => `${event} hook`,
    hookMissing: (file, hint) => `not in ${file}: ${hint}`,
    hookAt: (found, ours, hint) => `at ${found}, this is ${ours}: ${hint}`,
  },
  labels: {
    status: {
      created: "created",
      updated: "updated",
      ok: "ok",
      differs: "differs",
      toCreate: "to create",
      toUpdate: "to update",
      failed: "failed",
    },
    differs: (found, wanted) => `has ${found}, the flow wants ${wanted} (--update fixes it)`,
    appeared: "it appeared in GitHub meanwhile: run labels sync again",
    truncated: (repo) => `could not read every label of ${repo}; nothing written, so no label is made twice.`,
  },
  branch: {
    noIssue: (number, repo) => `issue #${number} does not exist in ${repo}.`,
    addBlock: (count) => `Add the "Slug de rama" block to ${count} issue(s)?`,
    nothingWritten: "nothing written: pass --yes to add the blocks.",
    moreIssues: "GitHub has more issues than were read; run it again after this.",
    jsonNeeds: "--missing --json needs --dry-run or --yes: there is no terminal to confirm in.",
    noType: (number) => `#${number}: it has no type label, so its branch has no type until it gets one.`,
    leftAlone: (number) => `#${number}: it got a branch block or was deleted meanwhile; left alone.`,
    added: (number) => `#${number}: block added.`,
  },
  cantTellRepo:
    'can\'t tell which repo this is: run inside a checkout whose origin is on GitHub, pass -R owner/repo, set GH_REPO or "repo" in .agents/flow.json.',
  initNowApply: (command) => `${command} is now apply: run 'issue-flow apply'. ${command} goes away in 0.4.0.`,
  goingOn: (message) => `${message}; going on with the defaults.`,
  config: {
    notJson: (path, detail) => `${path} is not valid JSON: ${detail}`,
    notJsonObject: (path) => `${path} must be a JSON object.`,
    unknownKey: (key, known) => `unknown key "${key}". Known: ${known}.`,
    nonEmptyString: (where) => `"${where}" must be a non-empty string.`,
    mustBeObject: (where) => `"${where}" must be an object.`,
    mustBeBoolean: (where) => `"${where}" must be true or false.`,
    branchType: (where) => `"${where}" must be a lowercase branch type such as "feat".`,
    templateNeeds: (missing) => `"branch.template" needs ${missing.join(" and ")}.`,
    namerChoice: '"branch.namer" must be "claude" or "title".',
    plansDirs: '"plans.dirs" must be a non-empty list of folders relative to the repo.',
    colorOne: (where, colors) => `"${where}" must be one of ${colors}.`,
    labelName: (where, max) => `"${where}" needs a name of 1 to ${max} characters, without spaces at the ends.`,
    labelTwice: (name) => `"labels" has "${name}" twice (names ignore case).`,
    labelObjectOrNull: (where) => `"${where}" must be an object or null.`,
    labelColor: (where) => `"${where}.color" must be six hex digits, without #, such as "1d76db".`,
    labelDescription: (where, max) => `"${where}.description" must be a string of up to ${max} characters.`,
    repoFormat: '"repo" must be owner/repo.',
    stepsList: (where) => `"${where}" must be a list of steps.`,
    stepObject: (at) => `"${at}" must be an object with "name" and "run".`,
    stepName: (at) => `"${at}.name" must be lowercase letters, digits and dashes.`,
    stepTwice: (where, name) => `"${where}" has two steps named "${name}".`,
    portCount: (key) => `"worktrees.ports.${key}" must be a positive whole number.`,
    portsShape: '"worktrees.ports" must be true, false or an object.',
    portsEven: '"worktrees.ports.blocks" must be even.',
    portsRange: (min, max) => `"worktrees.ports" must stay between ${min} and ${max}.`,
    dockerProjects: '"worktrees.dockerProjects" must be a list of Compose project prefixes (lowercase letters, digits, - and _).',
  },
  namer: {
    notInPath: "claude is not in the PATH",
    failed: (message) => `claude failed: ${message}`,
    exited: (status, detail) => `claude exited with ${status}: ${detail}`,
    aSignal: "a signal",
    noDetail: "no detail",
  },
  recipeDescription: (_name, fallback) => fallback,
  lang: {
    invalid: (source, value) => `${source} expects es or en: ${value}`,
  },
};
