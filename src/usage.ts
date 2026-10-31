/**
 * @file The usage text of the CLI, printed with `--help` and after a usage error.
 */

/** Usage text. */
export const USAGE = `Usage:
  issue-flow issue branch <n>... [--namer claude|title] [--json] [-R owner/repo]
  issue-flow issue branch --missing [--limit <n>] [--namer claude|title] [--dry-run | --yes] [--json] [-R owner/repo]
  issue-flow issue start <n> [--branch] [--dry-run | --yes] [--resume <branch> | --new] [--no-launch]
                             [--ask-permissions | --free] [--namer claude|title] [-R owner/repo]
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
  issue-flow init [--yes] [--recipe <name>,...]
  issue-flow doctor [--json]
  issue-flow upgrade [--dry-run]
  issue-flow labels sync [--update] [--dry-run] [--json] [-R owner/repo]

The slug comes from the issue's "Slug de rama" block, then from Claude, then from the title,
and the branch from the repo's template (an older "Rama sugerida" block is used if it fits).
--missing adds the slug block to every open issue without a block, after confirming.

issue start makes the branch in a worktree (or, with --branch, in this checkout), the
start commit, the push, the draft PR and the assignment, after confirming, and opens
Claude: in auto mode if the repo has claude-repo-guard, with your settings with
--ask-permissions, and with no sandbox nor questions with --free. --plan prints the branch
and the prompt as JSON and changes nothing.

--cloud confirms here and opens a Claude cloud session that starts the issue there.
--here, inside a cloud session, starts it in this checkout and opens nothing. --teleport
brings the cloud session noted in the PR to the worktree. --adopt starts it in the
worktree another tool (Orca, Paseo) just made, without asking nor opening Claude.

worktree runs the steps of "worktrees" in .agents/flow.json: setup prepares this worktree,
teardown cleans it before it goes (steps, ports, Docker), ports prints or moves its block
of ports, cleanup deletes the Docker of deleted worktrees, and prune deletes the worktrees
whose PR was merged or closed. session is the SessionStart hook of Claude Code.

pr worktree makes (or reuses) a worktree on a PR's own branch, to review and fix it; with
--, it runs the command there (Claude if none). adapter is what Orca and Paseo run: setup
when they make a worktree (its steps and, if it came from an issue, issue start --adopt),
issue to start one by hand, and archive before they delete it. hook implements Claude
Code's WorktreeCreate and WorktreeRemove for claude --worktree.

init sets the flow up in the repo: .agents/flow.json (with the recipes its files suggest),
the dev dependencies and scripts, and the hooks. doctor checks them at this version, and
upgrade moves them to this version. npx agent-kitchen runs the three, along with the
skills, claude-cloud and claude-repo-guard.

labels sync makes in GitHub the labels the flow wants ("labels" in .agents/flow.json: the
issue types and P1 to P4 by default) that the repo lacks. Names ignore case and are never
renamed nor deleted; --update also fixes the color and description of those that differ.`;
