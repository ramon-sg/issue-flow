// `issue start --free --no-repo-deny`: the repo's deny rules are out of the worktree's
// .claude/settings.json while Claude runs, hidden from git, and back when it exits.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startSandbox, WT } from "./start-helpers.mjs";

const SETTINGS = {
  permissions: { allow: ["Bash(npm test)"], deny: ["Edit(/.githooks/**)"] },
  attribution: { commit: "Co-Authored-By: x" },
  hooks: { SessionStart: [{ hooks: [{ type: "command", command: "npx issue-flow session" }] }] },
};
const ORIGINAL = `${JSON.stringify(SETTINGS, null, 2)}\n`;
const NOTE = join(".git", "issue-flow-sessions", "feat+214-odoo-refund-notice.repo-deny.json");

const sessions = (s) => s.claudeCalls().filter((call) => !call.args.includes("-p"));

// A sandbox whose main has the settings committed and pushed.
function guarded() {
  const s = startSandbox();
  mkdirSync(join(s.main, ".claude"), { recursive: true });
  writeFileSync(join(s.main, ".claude", "settings.json"), ORIGINAL);
  s.git(s.main, "add", ".claude/settings.json");
  s.git(s.main, "commit", "-q", "-m", "settings");
  s.git(s.main, "push", "-q", "origin", "main");
  return s;
}

// The git flag of the worktree's settings: "H" tracked, "S" skip-worktree.
const flagOf = (s, wt) => s.git(wt, "ls-files", "-v", ".claude/settings.json").slice(0, 1);

test("--no-repo-deny goes only with --free, and not with --plan, --cloud, --here nor --adopt", () => {
  const s = startSandbox();
  for (const [args, message] of [
    [["214", "--no-repo-deny"], /--no-repo-deny goes with --free\./],
    [["214", "--ask-permissions", "--no-repo-deny"], /--no-repo-deny goes with --free\./],
    [["214", "--plan", "--free", "--no-repo-deny"], /--plan does not go with .*--no-repo-deny/],
    [["214", "--cloud", "--no-repo-deny"], /--cloud does not go with --no-repo-deny/],
    [["214", "--adopt", "--no-repo-deny"], /--adopt does not go with --no-repo-deny/],
  ]) {
    const r = s.run(args);
    assert.equal(r.status, 2, args.join(" "));
    assert.match(r.err, message, args.join(" "));
    assert.deepEqual(s.ghCalls(), [], args.join(" "));
  }
});

test("--free --no-repo-deny: Claude runs without the repo's deny rules, the rest stays, and they come back after", () => {
  const s = guarded();
  const wt = join(s.main, WT);

  const r = s.run(["214", "--yes", "--free", "--no-repo-deny"]);
  const [session] = sessions(s);

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /Permissions: +none: no sandbox, no questions and no deny rules of the repo; yours still apply \(--free --no-repo-deny\)/);
  assert.match(r.out, /took out the deny rules of \.claude\/settings\.json for this session/);
  assert.deepEqual(session.args.slice(0, 3), ["--settings", '{"sandbox":{"enabled":false}}', "--dangerously-skip-permissions"]);
  assert.deepEqual(JSON.parse(session.settings), {
    permissions: { allow: ["Bash(npm test)"] },
    attribution: SETTINGS.attribution,
    hooks: SETTINGS.hooks,
  });
  assert.equal(session.status, "", "git must not see the change during the session");
  assert.equal(readFileSync(join(wt, ".claude", "settings.json"), "utf8"), ORIGINAL);
  assert.equal(flagOf(s, wt), "H");
  assert.equal(s.git(wt, "status", "--porcelain"), "");
  assert.equal(existsSync(join(s.main, NOTE)), false);
  assert.equal(readFileSync(join(s.main, ".claude", "settings.json"), "utf8"), ORIGINAL, "the main checkout is not touched");
});

test("--free alone leaves the repo's deny rules in place", () => {
  const s = guarded();

  const r = s.run(["214", "--yes", "--free"]);
  const [session] = sessions(s);

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /Permissions: +none: no sandbox and no questions; deny rules still apply \(--free\)/);
  assert.deepEqual(session.args.slice(0, 3), ["--settings", '{"sandbox":{"enabled":false}}', "--dangerously-skip-permissions"]);
  assert.equal(session.settings, ORIGINAL);
  assert.doesNotMatch(r.out, /took out the deny rules/);
});

test("if Claude changes the settings during the session, the deny rules go back on top of its change, with a warning", () => {
  const s = guarded();
  const wt = join(s.main, WT);
  const edited = '{"permissions":{"allow":["Bash(npm test)"]},"env":{"X":"1"}}\n';

  const r = s.run(["214", "--yes", "--free", "--no-repo-deny"], { env: { FAKE_CLAUDE_SETTINGS: edited } });

  assert.equal(r.status, 0, r.err);
  assert.match(r.err, /Claude changed \.claude\/settings\.json during the session: its deny rules are back on top of that change/);
  assert.deepEqual(JSON.parse(readFileSync(join(wt, ".claude", "settings.json"), "utf8")), {
    permissions: { allow: ["Bash(npm test)"], deny: ["Edit(/.githooks/**)"] },
    env: { X: "1" },
  });
  assert.equal(flagOf(s, wt), "H");
  assert.match(s.git(wt, "status", "--porcelain"), /M \.claude\/settings\.json/);
  assert.equal(existsSync(join(s.main, NOTE)), false);
});

test("rules a closed terminal left out come back on the next issue start, before Claude opens", () => {
  const s = guarded();
  const wt = join(s.main, WT);
  s.run(["214", "--yes", "--no-launch"]);
  const lifted = '{\n  "permissions": {\n    "allow": [\n      "Bash(npm test)"\n    ]\n  }\n}\n';
  writeFileSync(join(wt, ".claude", "settings.json"), lifted);
  s.git(wt, "update-index", "--skip-worktree", ".claude/settings.json");
  mkdirSync(join(s.main, ".git", "issue-flow-sessions"), { recursive: true });
  writeFileSync(join(s.main, NOTE), JSON.stringify({ workDir: wt, original: ORIGINAL, lifted }));

  const r = s.run(["214", "--yes"]);
  const [session] = sessions(s);

  assert.equal(r.status, 0, r.err);
  assert.equal(session.settings, ORIGINAL);
  assert.equal(flagOf(s, wt), "H");
  assert.equal(existsSync(join(s.main, NOTE)), false);
});

test("without a deny rule in the repo, --no-repo-deny says so and changes nothing", () => {
  const s = startSandbox();

  const r = s.run(["214", "--yes", "--free", "--no-repo-deny"]);

  assert.equal(r.status, 0, r.err);
  assert.match(r.out, /the repo has no \.claude\/settings\.json: there are no deny rules to take out\./);
  assert.equal(existsSync(join(s.main, NOTE)), false);
});

test("a note changed during the session is not trusted: the rules come back from what issue-flow kept", () => {
  const s = guarded();
  const wt = join(s.main, WT);
  const forged = JSON.stringify({ original: '{"hooks":{"SessionStart":[]}}\n', lifted: "x" });

  const r = s.run(["214", "--yes", "--free", "--no-repo-deny"], { env: { FAKE_CLAUDE_WRITE: join(s.main, NOTE), FAKE_CLAUDE_TEXT: forged } });

  assert.equal(r.status, 0, r.err);
  assert.equal(readFileSync(join(wt, ".claude", "settings.json"), "utf8"), ORIGINAL);
  assert.equal(existsSync(join(s.main, NOTE)), false);
});
