**English** · [Español](README.md)

# issue-flow

An issue-to-PR workflow for any repo, locally and in Claude cloud sessions: it names the branch of each issue, creates its worktree with its own ports and Docker, opens the PR as a draft and cleans up when it is merged. It ships the skills that use that workflow.

> **Install in a repo:** `npx agent-kitchen apply`, which installs this workflow with its skills, the general skills, `agent-cloud-kit` and `claude-repo-guard`, and keeps them updated ([agent-kitchen](https://github.com/ramon-sg/agent-kitchen)). The package is `@ramon-sg/issue-flow` and the command is `issue-flow`; without the scope, `issue-flow` on npm is a different package.

## What you get

- **`issue-flow apply|doctor`:** leaves as its version requires, and checks, what the workflow puts in the repo: `.agents/flow.json` with its recipes, the dependencies and the hooks. `agent-kitchen` runs them.
- **`issue-flow issue branch <n>`:** proposes an issue's branch (with Claude by default, or from the title). With `--missing`, adds the branch slug to every open issue that lacks one.
- **`issue-flow labels sync`:** creates on GitHub the labels the workflow expects and the repo is missing: the type labels and `P1` to `P4`, with the same colors in every repo.
- **`issue-flow issue start <n>`:** creates the branch and the worktree, makes the initial commit, opens the draft PR, assigns the issue and opens Claude. With `--cloud`, it does this in a cloud session.
- **`issue-flow worktree setup|teardown|ports|cleanup|prune`:** prepares and cleans each worktree with the repo's steps, gives it a block of ports and deletes the worktrees whose PR is closed.
- **`issue-flow pr worktree <n>`:** opens a PR in its own worktree, on the PR's branch, so you can review it without dropping what you are doing.
- **`issue-flow adapter setup|issue|archive`:** what Orca and Paseo run when they create or delete a worktree.
- **`issue-flow session`:** the `SessionStart` hook; in the cloud it calls [`agent-cloud-kit`](https://github.com/ramon-sg/agent-cloud-kit).
- **`issue-flow hook worktree-create|worktree-remove`:** Claude Code's `WorktreeCreate` and `WorktreeRemove` hooks, for `claude --worktree`.
- **Skills:** `github-issues`, `start-issue`, `finish-pr`, `close-pr`, `pr-review-comments` and `pr-worktree`.

## Branch name

```sh
issue-flow issue branch 42 57           # proposes the branch of each issue, writes nothing
issue-flow issue branch --missing       # the branch of each open issue without a block, and adds it after confirming
issue-flow issue branch --missing --dry-run --json
```

The issue stores only the slug, in a block like this:

```markdown
**Slug de rama**
`cart-total-with-credit`
```

The number is the issue's and the type comes from the labels (or, if there are none, from the title prefix: `bug:` gives `fix`). That way the body is written before the issue has a number, in one go, and does not go stale if the label or the template changes. It is what GitHub, GitLab and Linear do: the branch is computed when it is created.

The branch is built from the repo's template, and the slug comes from, in this order:

1. **The "Slug de rama" block** of the issue.
2. **The old "Rama sugerida" block**, with the full branch (`fix/42-cart`), if it is `<prefix>/<n>-<slug>` of that issue. It is used as is, so older issues keep working; it is never written.
3. **Claude** (`claude -p`, a single call for all the issues): Claude proposes the slug in English and, if the issue has no type, picks it from the repo's list. Its answer is validated.
4. **The title**, if Claude is not available, fails or answers something unusable.

`--missing` adds the "Slug de rama" block after the first paragraph of each open issue without a block (neither new nor old), only with `--yes` or if you answer yes in the terminal; `--dry-run` never writes. Since it stores only the slug, it does not use the type Claude would pick: it shows the branch the issue will get and warns about the ones with no type label.

## Starting an issue

The four ways to start an issue (terminal, the skill in a session, Claude's cloud, Orca and Paseo), step by step: [docs/flujos.md](docs/flujos.md) (in Spanish).

```sh
issue-flow issue start 42              # worktree in .claude/worktrees/, draft PR and Claude
issue-flow issue start 42 --dry-run    # the summary, changing nothing (only runs git fetch)
issue-flow issue start 42 --yes --no-launch   # what the skill runs after your OK
issue-flow issue start 42 --plan       # one JSON line with the branch and the prompt, no side effects
```

What it does, in order:

1. **Reads the issue and its work:** stops if the issue is closed; runs `git fetch` and reads its PRs and branches with [`github-rest`](https://github.com/ramon-sg/github-rest), on GitHub and on this machine.
2. **Picks the branch:**
   - **No live branches:** creates a new one, named as `issue branch` does. If that name was already used in a merged batch, it adds `-2`, `-3`...
   - **With one:** resumes it.
   - **With several:** in the terminal it asks which one to follow. With `--yes` you have to choose with `--resume <branch>` or `--new`.
3. **Shows a summary and asks `[y/N]`.** An empty answer is no. In Spanish the question is `[s/N]`; in both languages `y`, `yes`, `s`, `si` and `sí` are accepted.
4. **Creates what is missing:**
   - the worktree, or with `--branch` the branch in this checkout;
   - the empty commit with `[skip ci]`, the push and the draft PR;
   - reopens the closed PR of a branch being resumed, and assigns you the issue;
   - if the resumed PR's title is not the one it would get today (the issue was renamed, or `start.prTitle` changed), the summary shows both and updates it.

   The PR says `Closes #n`, or `Part of #n` if the issue has another live branch; in that case the other open PRs that closed it also become `Part of`. The worktree gets the ignored files listed in `.worktreeinclude` (credentials, for example), like `claude --worktree`.
5. **Opens Claude in the same terminal** with a prompt and the priority's color.
   - Each branch keeps its session, so starting again resumes it.
   - While Claude runs, the worktree is locked (`git worktree lock`). If the lock belongs to an `issue-flow` that is no longer running, it takes it over.
6. **When you leave Claude:**
   - If the PR was merged and there is no unpushed work, it offers to delete the worktree and the branch.
   - If not, it says how to resume. The command repeats how you launched `issue-flow`: if it was `bun run issue:start:free 42`, that is the one it suggests, not `issue-flow issue start 42` (see [Language and closing messages](#language-and-closing-messages)).

**Permissions:** if the repo has [`claude-repo-guard`](https://github.com/ramon-sg/claude-repo-guard), Claude opens in auto mode with its context (the same as `claude:auto`). With `--ask-permissions` it opens with your settings, with `--free` without sandbox or prompts (like `claude:free`), and with `--free --no-repo-deny` also without the `deny` rules of the repo's `.claude/settings.json`, which come back when you leave ([what each mode removes](docs/flujos/terminal.md#opciones)). Without `claude-repo-guard`, it opens with your settings. `--plan` returns those same arguments in `claudeArgs`. The shortcut is `npm run issue:start:free 42`. With npm, the options go after `--` (`npm run issue:start -- 42 --free`); with pnpm, bun or yarn it is not needed. The table for each package manager is in [Flujos](docs/flujos.md#administradores). `issue-flow issue start --help` explains every option.

**git credentials:** fetch and push never ask for a username and password on the terminal. If git has no GitHub credentials, `issue-flow` says so and, on a terminal, offers to run `gh auth setup-git` (git then uses your `gh` session) and tries again. The cloud does not need it: its proxy authenticates git.

### With the cloud and other tools

```sh
issue-flow issue start 42 --cloud      # confirms here and opens a Claude session in the cloud
issue-flow issue start 42 --here       # inside that session: starts the issue in this checkout
issue-flow issue start 42 --teleport   # brings to the worktree the cloud session noted in the PR
issue-flow issue start 42 --adopt      # inside a worktree created by Orca or Paseo
```

- **`--cloud`** reads the issue, shows the summary and asks, just like locally. Then it runs `claude --cloud "/start-issue 42 --yes"` from the main checkout, without creating a branch or PR here: the session creates them with `--here`. If the issue has several branches, it passes the chosen one with `--resume <branch>` or `--new`. It stops if the branch is already open in a checkout or exists only locally, because the cloud would not see it.
- **`--here`** is for the skill inside a cloud session. It leaves this checkout on the branch (from `origin/<base>`, or from `origin/<branch>` if it already exists), makes the empty commit, the push, the draft PR and the assignment, and does not open Claude. If it runs in a session (`CLAUDE_CODE_REMOTE_SESSION_ID`), it notes its link in the PR body (`Cloud session: ...`); only one line is kept, the one of the latest session. It ends with a `Prompt: ...` line that the skill follows. It stops if there are uncommitted changes: it does not stash.
- **`--teleport`** resumes as usual (worktree, PR) and opens `claude --teleport` with the session noted in the PR, or with the list of sessions if there is none. Without `--teleport`, resuming opens the local session and the summary warns if there is one in the cloud.
- **`--adopt`** uses the worktree where it runs, which another tool created. It does not ask or open Claude. It renames its branch to the issue's and publishes; if the branch already carries the issue number (`fix/42-my-name`), it leaves it as is. If the worktree is already on a live branch of the issue, it resumes it. Otherwise it only adopts a freshly created worktree: it stops if its branch is on origin, has commits of its own or has uncommitted changes, or if the issue already has its branch elsewhere.

## Language and closing messages

What `issue-flow` prints in the terminal, `--help` included, comes out **in Spanish by default**. The language is chosen by the first of these that exists:

1. The `--lang es|en` option, valid on any subcommand.
2. The `ISSUE_FLOW_LANG=es|en` variable (empty counts as unset).
3. `es`.

`LANG` and `LC_ALL` are **not** read: on macOS they are usually `en_US.UTF-8` even if you speak Spanish. An unknown value is a usage error (exits with 2 and shows the valid values).

```sh
issue-flow --lang en issue start 42    # once, in English
export ISSUE_FLOW_LANG=en              # always, in this shell
```

Only the terminal changes. What is written to GitHub (the initial commit, the PR body, the comments, the labels) and what is read from there does not change, and neither does `--json`: its keys and texts are always the same.

**Closing messages.** What ends `issue start` and `pr worktree` (session saved, PR merged, ready to go in, or the error that stopped it) comes out as a short block: a status mark (`[ok]`, `[!]` or `[?]`), the data (branch, PR) and, alone on its line, the command to copy. Next to the block appears Kuro, the project's mascot, but only if the output is a terminal. In a pipe, in CI or with `art: false` in `.agents/flow.json`, the same block comes out without the drawing. Color shows only in a terminal, and `NO_COLOR` turns it off.

**Resume command.** It repeats the way you launched `issue-flow`, so you can copy it as is:

| You launched it with | It suggests |
|---|---|
| `bun run issue:start:free 34` | `bun run issue:start:free 34` |
| `npm run issue:start:free 34` | `npm run issue:start:free 34` (with other options, `npm run issue:start:free -- 34 --no-repo-deny`) |
| `pnpm issue:start:free 34` | `pnpm issue:start:free 34` |
| `yarn issue:start:free 34` | `yarn issue:start:free 34` |
| `issue-flow` or `npx` | `issue-flow issue start 34` |

The script form is used only with the scripts `apply` installs (`issue:start` and `issue:start:free`); a script of someone else's that calls `issue-flow` falls back to `issue-flow issue start <n>`. The options that define how the session runs are repeated (`--free`, `--ask-permissions`, `--no-repo-deny`, `--namer`, `-R`, and `--lang` if you passed it as an option) and the one-off ones are not (`--new`, `--branch`, `--yes`, `--dry-run`, `--resume`, `--no-launch`, `--plan`).

## Worktrees: prepare, clean and delete

```sh
issue-flow worktree setup              # runs the preparation steps in this worktree
issue-flow worktree setup --only deps  # just one
issue-flow worktree teardown           # its cleanup steps, its ports and its Docker
issue-flow worktree ports [--next]     # the first port of its block, or moves it to the next one
issue-flow worktree cleanup            # the Docker of the worktrees that no longer exist
issue-flow worktree prune              # deletes the worktrees whose PR was merged or closed, and updates the local base
```

What is specific to each repo (installing, building the database, starting Docker) are **steps** in `worktrees` of `.agents/flow.json`; `issue-flow` only runs them:

```json
{
  "worktrees": {
    "setup": [
      { "name": "deps", "run": "npm ci", "trusted": true, "once": true },
      { "name": "env", "run": "cp -n .env.example .env" }
    ],
    "teardown": [{ "name": "docker", "run": "docker compose -p acme-dev-$ISSUE_FLOW_DOCKER_SUFFIX down -v" }],
    "ports": true,
    "dockerProjects": ["acme-dev"]
  }
}
```

- **When they run:** `issue start` runs `setup` in each new worktree, after copying `.worktreeinclude`. The `session` hook runs it when Claude opens in a worktree. `teardown` runs before deleting a worktree, with `prune` or when cleaning up after the merge.
- **Where they come from:** from the `.agents/flow.json` of `origin/<base>`, never from the worktree. That way a branch cannot add commands to its own setup, and a main checkout that fell behind does not leave the worktree without its `install`. If the main checkout's steps are different, `issue-flow` says so. Without `origin/<base>`, or if the file is not valid there, it uses the main checkout's. Without steps, `worktree setup` and `issue start` say which file they read them from. In the cloud there is no other checkout: there the config is the session branch's. Teardown still uses the main checkout's config.
- **They can run more than once:** `issue start` and the `session` hook run the `setup` of the same worktree, so a step without `once` must be repeatable.
- **`trusted`:** the step runs only if the worktree's code is in `origin/<base>` and has no changes. It is meant for an install, which runs that branch's `package.json` scripts. In the cloud it always runs, because the machine is disposable.
- **`once`:** the step is not repeated once it has worked (it leaves a mark in the worktree's git dir).
- **Variables of each step:** `ISSUE_FLOW_WORKTREE`, `ISSUE_FLOW_MAIN_ROOT`, `ISSUE_FLOW_DOCKER_SUFFIX` and, with `ports`, `ISSUE_FLOW_PORT_BASE`.
- **Ports:** each worktree gets a fixed block. It comes from a hash of the machine and the folder, skips the blocks where something is listening or that another worktree on the machine registered, and is stored. macOS uses the first half of the range and the rest the second, so a laptop worktree does not collide with one on the server that Orca forwards.
- **Docker:** each worktree's Compose project is `<prefix>-$ISSUE_FLOW_DOCKER_SUFFIX`. `cleanup` deletes containers, volumes and networks of the projects with a prefix from `dockerProjects` whose folder is no longer a checkout. It never touches one without a suffix, the main checkout's.
- **Apps:** `teardown` stops the processes that listen on a port of the block and run inside the worktree (TERM to their group and, after 5 seconds, KILL). It never touches one from outside. It needs `lsof`.
- **`prune`** asks before deleting. It never touches a worktree with changes, with unpushed commits or locked by a Claude session, and checks each one again right before deleting it.

Docker names and port blocks come out the same as Abastio's.

## Reviewing a PR: `issue-flow pr worktree`

```sh
issue-flow pr worktree 42               # creates (or reuses) .claude/worktrees/pr-42 on the PR's branch
issue-flow pr worktree 42 -- claude     # and runs the command there; with `--` alone, opens Claude
issue-flow pr worktree 42 --no-setup    # without the setup steps
```

- The branch follows `origin`, so what you commit and push updates the PR. If you already have the branch locally, it advances to origin's when it can and warns if not.
- It copies `.worktreeinclude` and runs `setup`, but skips the `trusted` steps: the PR's code is not in the base branch yet. It says what to run once you have reviewed it.
- It never touches the main checkout: if the branch is open there or in another worktree, it stops. A PR from a fork is not opened, because its branch is not on origin.
- It is deleted with `issue-flow worktree prune` when the PR is merged or closed, like any worktree.

## Orca and Paseo: `issue-flow adapter`

`orca.yaml` and `paseo.json` only call the adapter, which leaves the worktree like one from `issue start`:

```yaml
# orca.yaml
setupAgentStartupPolicy: wait-for-setup
scripts:
  setup: npx @ramon-sg/issue-flow adapter setup
  archive: npx @ramon-sg/issue-flow adapter archive
```

```json
{ "worktree": { "setup": ["npx @ramon-sg/issue-flow adapter setup"], "teardown": "npx @ramon-sg/issue-flow adapter archive" } }
```

- **`setup [--only <step>]`:** copies `.worktreeinclude` (Paseo does not copy it), runs the `setup` steps and, without `--only`, starts the issue the worktree came from as `issue start <n> --adopt`. With Paseo the issue comes from the branch (`feat/42-x`, `42-x`); with Orca, from its CLI (`orca worktree current --json`). It always exits 0: if something fails, it says what to run.
- **`issue [<url>]`:** only starts the issue. With the URL at hand it exits with `issue start`'s code.
- **`archive`:** the worktree's `teardown`: steps, apps, ports and Docker. It always exits 0, because a failing archive cannot block the deletion. If git's link broke, it still deletes the folder's Docker with the config of the checkout named by `ORCA_ROOT_PATH` or `PASEO_SOURCE_CHECKOUT_PATH`.

## Claude Code hooks for `claude --worktree`

`issue-flow hook worktree-create` and `issue-flow hook worktree-remove` are the `WorktreeCreate` and `WorktreeRemove` hooks. With them, a `claude --worktree <name>` worktree gets the same as one from `issue start`, and is cleaned up when Claude deletes it. Claude only calls `WorktreeRemove` for the worktrees a `WorktreeCreate` hook made.

- **`worktree-create`:** creates `<worktrees.dir>/<name>` on the branch `worktree-<name>` from `origin/<base>` (the config's `baseBranch`), or reuses it. It copies `.worktreeinclude`, runs `setup` and prints only the path, which is what Claude reads. It rejects `pr-<n>`: that is what `pr worktree` is for.
- **`worktree-remove`:** runs `teardown` and deletes the folder, and the branch if all its commits are on origin. It keeps a worktree with uncommitted changes.

## Session hook: `issue-flow session`

It is Claude Code's `SessionStart` hook. What it prints reaches Claude as context, so the warnings go there. It never makes the session fail.

1. In a cloud session (`CLAUDE_CODE_REMOTE=true`), it runs `agent-cloud-kit session`. If it is not there, it says which setup script to put in claude.ai.
2. In a worktree (or in the cloud checkout), it runs the `setup` steps. The folder comes from the `cwd` Claude sends, which with `claude --worktree` is the worktree's, and if it is missing, from `CLAUDE_PROJECT_DIR`.
3. If a local worktree is on the branch of an issue that is not on origin, it warns that the issue was not started.
4. It deletes the Docker of the worktrees that no longer exist: Claude Code does not call the `WorktreeRemove` hook for worktrees that a `WorktreeCreate` hook did not make.
5. If there is a `.envrc` and `direnv`, it adds its environment to `CLAUDE_ENV_FILE`, so the session's commands have it.

## What the workflow leaves in the repo: `issue-flow apply`

`npx agent-kitchen apply` runs `apply` in the version it chooses and then moves the workflow's skills to the same tag. Running it by hand is useful to try the workflow in a repo without the rest.

```sh
npx @ramon-sg/issue-flow@<version> apply          # leaves the repo as that version requires
npx @ramon-sg/issue-flow@<version> apply --yes    # no questions, with the recipes the repo suggests
npx @ramon-sg/issue-flow apply --recipe docker-compose   # adds one more recipe later
npx @ramon-sg/issue-flow apply --dry-run          # only says what would change (--json for agent-kitchen)
npx @ramon-sg/issue-flow doctor                   # checks the repo is as apply leaves it (--json)
```

`apply` leaves the repo as the version it runs requires, and running it again changes nothing. The version is chosen by whoever updates, by choosing which one to run: `apply` does not change the version of any other package.

1. **`.agents/flow.json`:** if it does not exist, it creates it with this version's `$schema` and, if the repo has `paseo.json`, with its branch template and its types. That first time it proposes the recipes that the repo's files suggest (with `--yes`, all of them; with no terminal and no `--yes`, it writes nothing and says so). If it already exists, it does not ask: it runs this version's migrations, moves the `$schema` and adds the `--recipe` recipes.
2. **`package.json`:** `@ramon-sg/issue-flow` at this version, exact. `@ramon-sg/github-rest` and the `issue:start`, `issue:start:free`, `worktree:prune` and `pr:worktree` scripts only if missing (`issue:start:free` is not added if the repo has its own `issue:start`, which it would skip): a `github-rest` the repo already has stays, with a warning if it does not reach the version the skills need.
3. **`.claude/settings.json`:** the `SessionStart`, `WorktreeCreate` and `WorktreeRemove` hooks, pinned to this version and with 600 seconds. The `SessionStart` one runs `agent-cloud-kit session` in the cloud, so an `agent-cloud-kit` hook of its own is removed so it does not run twice.

It does not query npm, and never goes down a version: if the repo already has a newer issue-flow (for example, `package.json` bumped by hand before the `install`), or a range like `^0.2.6`, it stops and says what to run. `--json` gives `{ version, changes, kept, written, next }`. It exits 0 if it applied or there was nothing to do, and 1 if it refused or had to ask and could not.

**`doctor`** changes nothing. It checks the config and its `$schema`, the dependencies and that the hooks are at this version. Each problem says what fixes it: `npx agent-kitchen apply` if the repo pins another issue-flow (it also moves the skills), and `npx @ramon-sg/issue-flow apply` if the version is this one but its files fell behind.

**`init` and `upgrade`** keep working until 0.4.0, with a warning: `init` is `apply`, and `upgrade` is `apply --yes` without recipes, because it never asked.

### Recipes

Pieces of `flow.json` for what many repos share. `apply` offers, the first time, the ones the repo's files suggest; `--recipe a,b` picks others. A recipe only adds what is missing: a step with the same name or a key the repo already has is not touched.

| Recipe | Suggested by | What it adds |
|---|---|---|
| `npm`, `pnpm`, `bun` | Their lockfile | The `deps` step, `trusted`, which installs without changing the lockfile |
| `docker-compose` | `compose.yaml` or `docker-compose.yml` | A Compose project and a block of ports per worktree: `up -d` on prepare and `down -v` on cleanup. The compose takes its ports from `ISSUE_FLOW_PORT_BASE` |
| `direnv` | `.envrc` | `direnv allow` in each worktree, so they load their environment and secrets (Infisical, for example) |
| `staging-main` | Nothing: you ask for it | `baseBranch: "staging"`; `agent-kitchen` lets `claude-repo-guard` merge to `staging` |

The recipes' preparation steps are `trusted`: they run the worktree's code (the lockfile, the compose, the `.envrc`), so in a worktree with code that is not in the base branch, like `pr worktree`'s, they are skipped and the command says what to run once you have reviewed it.

## The workflow's skills

They live in `skills/` and `skills-catalog.json` lists them. They are installed with [`skills-manager`](https://github.com/ramon-sg/skills-manager), which copies them to the repo's `.agents/skills/` so they reach the cloud too. They are written in Spanish, answer in the language you write to them in, and call `npx @ramon-sg/issue-flow` and `npx @ramon-sg/github-rest`, which the repo has as dev dependencies. They always go with the scope: `issue-flow`, `github-rest` and `skills-manager` without the scope are other people's packages on npm, and `npx` would download and run them if the repo does not have its own installed.

| Skill | Category | What it is for | Also brings |
|---|---|---|---|
| `github-issues` | Issues | A short issue with a three-line header, verifiable criteria and its branch slug; checks duplicates and the word cap | - |
| `start-issue` | Issues | Starts an issue from a session with `issue-flow issue start`, locally, in a worktree or in the cloud | - |
| `finish-pr` | PRs | Audit, up-to-date documents, ready, review and CI, and the check that it can be merged; stops before the merge with a report of what is missing and how to clean up | `pr-review-comments` |
| `close-pr` | PRs | Runs `finish-pr` and, if it is ready, merges with a merge commit and cleans the branch and the worktree | `finish-pr` |
| `pr-review-comments` | PRs | Verifies each comment and check against the code, proposes a plan, applies what is approved and answers the threads | `github-issues` |
| `pr-worktree` | PRs | Reviews a PR in its worktree with `issue-flow pr worktree`, without touching the main checkout | `close-pr` |

`agent-kitchen` installs them with the catalog at the tag of the workflow's version and moves them with it. `finish-pr` (and with it `close-pr`) and `pr-worktree` use `code-audit`, from the [`agent-skills`](https://github.com/ramon-sg/agent-skills) catalog: `agent-kitchen` offers both.

**What is specific to each repo goes in `project.md`**, which each skill (except `pr-worktree`) creates from its template when installed: the labels and the assignee, which flow each issue follows, what runs without asking on close, which bots review and what counts as an approved review. That file belongs to the repo: `check` does not flag it and updates keep it.

**In the cloud** the skills do not use `gh pr` or `gh issue`, which go through GraphQL. Taking a PR out of draft and resolving a thread exist only in GraphQL, and the merge goes with `gh pr merge`, which Claude Code's auto mode reviews. Locally all three go with `gh`; in the cloud the skills stop and say so. If the sandbox blocks something, they do not retry another way: they show what to run in a terminal.

## Config: `.agents/flow.json`

Everything is optional; without the file the defaults apply. An unknown key is an error, so a typo does not pass silently. It is always read from the main checkout, also from a worktree. `schema.json` gives autocompletion in the editor:

```json
{
  "$schema": "https://raw.githubusercontent.com/ramon-sg/issue-flow/main/schema.json",
  "branch": {
    "template": "{type}/{number}-{slug}",
    "namer": "claude",
    "types": {
      "labels": { "bug": "fix", "enhancement": "feat", "documentation": "docs", "spike": "spike" },
      "titlePrefixes": { "bug:": "fix", "mejora:": "feat", "docs:": "docs", "spike:": "spike" }
    }
  }
}
```

| Key | Default | What for |
|---|---|---|
| `repo` | `-R`, `GH_REPO` or `origin` | The repo on GitHub |
| `baseBranch` | The repo's default branch | Where the work starts from |
| `branch.template` | `{type}/{number}-{slug}` | Branch name; needs `{number}` and `{slug}` |
| `branch.namer` | `claude` | `claude` or `title` |
| `branch.claudeModel` | `haiku` | `claude -p`'s model |
| `branch.types` | The ones above | Type by label and by prefix; each map replaces the default one |
| `worktrees.dir` | `.claude/worktrees` | Where the worktrees go |
| `worktrees.setup`, `worktrees.teardown` | None | Steps to prepare and clean a worktree (see above) |
| `worktrees.ports` | Off | `true` for blocks of 10 from 20000, or `{ start, blockSize, blocks }` |
| `worktrees.dockerProjects` | None | Prefixes of the worktrees' Compose projects |
| `start.commitMessage` | `chore: empieza el trabajo en la issue #{number} [skip ci]` | Initial empty commit |
| `start.prBody` | `{keyword} #{number}`, the issue's URL (`{url}`) and "En progreso." | Draft PR body |
| `start.prTitle` | The issue's title | Draft PR title; `{number}` and `{title}` are the issue's |
| `start.prLanguage` | Off | Language of the PRs when it is not the issues' (`"English"`): the PR opens as `Issue #{number}` and the prompt asks for a title in that language |
| `start.prompt`, `start.resumePrompt` | Summarize the issue and follow `start-issue`, or resume from `{plan}` | Prompt Claude opens with |
| `start.summaryPrompt`, `start.summaryPlanPrompt` | Summarize and wait | `--plan`'s prompt |
| `start.cloudPrompt` | `/start-issue {number} --yes{flags}` | What `--cloud` asks the session; `{flags}` is `--new` or `--resume <branch>` |
| `plans.dirs` | `docs/plans`, `docs/specs` | Where to look for the issue's plan: what the branch touched, or the document whose `prs:` names its PR |
| `art` | `true` | `false` turns off Kuro in the closing messages. It shows only in a terminal; `NO_COLOR` turns off color |
| `colors` | `critical-path` and `P1:` red, `P2:` orange, `P3:` yellow, `P4:` cyan | Session color by label prefix; the first match wins |
| `labels` | The 8 below | Labels `labels sync` creates; the repo's are added to the default (see below) |

## Labels: `issue-flow labels sync`

```sh
npx @ramon-sg/issue-flow labels sync --dry-run   # what it would do
npx @ramon-sg/issue-flow labels sync             # creates the missing ones
npx @ramon-sg/issue-flow labels sync --update    # also fixes color and description
```

Creates on GitHub the `labels` the repo does not have. Names are compared case-insensitively, as GitHub does: a `Bug` counts as `bug` and is never renamed. One that exists with another color or description is only reported, except with `--update`. It never deletes. `--json` gives the list with each one's status: `created`, `updated`, `ok`, `differs`, or `to-create` and `to-update` with `--dry-run`. If GitHub rejects one, it carries on with the rest, marks it `failed` and exits 1.

| Label | Color | Description |
|---|---|---|
| `bug` | `d73a4a` | Something isn't working |
| `enhancement` | `a2eeef` | New feature or request |
| `documentation` | `0075ca` | Improvements or additions to documentation |
| `spike` | `fbca04` | Time-boxed research before building |
| `P1: urgent` | `B60205` | Breaks production or blocks work |
| `P2: important` | `F9D0C4` | Real impact, with some slack |
| `P3: minor` | `FEF2C0` | Default when in doubt |
| `P4: low` | `BFDADC` | Nice-to-have |

The first three are GitHub's, with their colors and texts. Unlike `branch.types` and `colors`, what the repo sets is **added** to the default: a name replaces the default one with that name, and `null` removes it. The repo's taxonomy goes here and not in `github-issues`' `project.md`, because with `claude-repo-guard` the agent cannot write to `.agents/skills/`:

```json
{
  "labels": {
    "area:api": { "color": "1d76db", "description": "packages/api" },
    "size:S": { "color": "c5def5", "description": "Menos de 1 día" },
    "spike": null
  }
}
```

## Development

```sh
npm install && npm test
```

It uses [`github-rest`](https://github.com/ramon-sg/github-rest) to talk to GitHub through REST only (GraphQL is blocked in the cloud) and [`skills-manager`](https://github.com/ramon-sg/skills-manager) to install the skills. The skills' tests check that the catalog and the folders match, that none names the project it came from, that every `issue-flow` command they name exists, `github-issues`' script and a full install with `skills-manager`. The general skills (`planning`, `code-audit`, ...) are in [`agent-skills`](https://github.com/ramon-sg/agent-skills).

## Publishing a version

A version is a `vX.Y.Z` release on GitHub, with the same number as `package.json`. When it is published, GitHub Actions runs the tests and publishes to npm with provenance (`.github/workflows/publish.yml`). The tag is also the version of the workflow's skills: `agent-kitchen` installs the catalog at the workflow version's tag, so the CLI and its skills always go together.

1. A PR that bumps `version` in `package.json`.
2. After the merge, a `v<version>` release on that `main` commit.

The workflow stops if the tag does not match `package.json`.

**The first version (0.1.0) goes by hand**, because npm only lets you set up publishing from GitHub on a package that already exists:

1. From `main`, logged in to npm (`npm login`): `npm publish --provenance=false`. Provenance is only generated inside a CI.
2. On npmjs.com, set up publishing from GitHub (trusted publishing) for `publish.yml`.
3. Push the `v0.1.0` tag without creating a release: the skills and the `$schema` need it, and a release would publish the same version again and fail.

From 0.2.0 on, each version is a release and the workflow publishes it.

## License

MIT
