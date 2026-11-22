// settings-hooks: the hook commands are built with the repo's runner.
import assert from "node:assert/strict";
import test from "node:test";
import { en } from "../dist/messages/en.js";
import { hookCommand, ourHookCommands, registerHooks } from "../dist/settings-hooks.js";

const NPX = "npx --yes @ramon-sg/issue-flow@0.6.0 hook worktree-create";

test("hookCommand builds the command with the runner", () => {
  assert.equal(hookCommand("SessionStart", "node", "0.6.0"), "npx --yes @ramon-sg/issue-flow@0.6.0 session # runs agent-cloud-kit session in the cloud");
  assert.equal(hookCommand("WorktreeCreate", "bun", "0.6.0"), "bun x --bun @ramon-sg/issue-flow@0.6.0 hook worktree-create");
});

test("registerHooks rewrites a hook of another runner at the same version, once", () => {
  const settings = { hooks: { WorktreeCreate: [{ hooks: [{ type: "command", command: NPX }] }] } };
  const first = registerHooks(settings, "bun", "0.6.0", en);
  assert.equal(first.settings.hooks.WorktreeCreate[0].hooks[0].command, "bun x --bun @ramon-sg/issue-flow@0.6.0 hook worktree-create");
  assert.ok(first.changes.includes(en.setup.rewroteHook("WorktreeCreate", "bun")));
  const second = registerHooks(first.settings, "bun", "0.6.0", en);
  assert.deepEqual(second.changes, []);
});

test("ourHookCommands lists the commands of our hooks", () => {
  const { settings } = registerHooks(null, "node", "0.6.0", en);
  assert.deepEqual(ourHookCommands(settings).sort(), ["WorktreeCreate", "WorktreeRemove", "SessionStart"].map((e) => hookCommand(e, "node", "0.6.0")).sort());
  assert.deepEqual(ourHookCommands(null), []);
});

test("registerHooks rewrites the bunx hooks older versions wrote to bun x, without adding another", () => {
  const OLD = "bunx --bun @ramon-sg/issue-flow@0.6.0 hook worktree-create";
  const settings = { hooks: { WorktreeCreate: [{ hooks: [{ type: "command", command: OLD, timeout: 600 }] }], WorktreeRemove: [{ hooks: [{ type: "command", command: "bunx --bun @ramon-sg/issue-flow@0.5.0 hook worktree-remove" }] }] } };
  const first = registerHooks(settings, "bun", "0.6.0", en);
  assert.deepEqual(ourHookCommands(settings).sort(), [OLD, "bunx --bun @ramon-sg/issue-flow@0.5.0 hook worktree-remove"].sort());
  assert.deepEqual(first.settings.hooks.WorktreeCreate, [{ hooks: [{ type: "command", command: "bun x --bun @ramon-sg/issue-flow@0.6.0 hook worktree-create", timeout: 600 }] }]);
  assert.deepEqual(first.settings.hooks.WorktreeRemove, [{ hooks: [{ type: "command", command: "bun x --bun @ramon-sg/issue-flow@0.6.0 hook worktree-remove" }] }]);
  assert.ok(first.changes.includes(en.setup.rewroteHook("WorktreeCreate", "bun")));
  assert.ok(first.changes.includes(en.setup.movedHook("WorktreeRemove", "0.5.0", "0.6.0")));
  assert.doesNotMatch(JSON.stringify(first.settings), /bunx/);
  assert.deepEqual(registerHooks(first.settings, "bun", "0.6.0", en).changes, []);
});
