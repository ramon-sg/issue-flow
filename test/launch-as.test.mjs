// Tests of how the "resume" command repeats the way issue-flow was launched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { launchOf } from "../dist/launch-as.js";
import { again } from "../dist/start-state.js";

const AGENT = {
  bun: "bun/1.4.4 npm/? node/v26.3.0 darwin arm64",
  npm: "npm/11.11.0 node/v26.3.0 darwin arm64",
  pnpm: "pnpm/12.8.1 npm/? node/v26.3.0 darwin arm64",
  yarn: "yarn/1.22.22 npm/? node/v26.3.0 darwin arm64",
};

/** The resume command for an environment and flags. */
function command(manager, event, flags = {}, extra) {
  const env = {};
  if (manager !== null) env.npm_config_user_agent = AGENT[manager];
  if (event !== null) env.npm_lifecycle_event = event;
  return again({ number: 34, launchedAs: launchOf(env, flags) }, extra);
}

test("bun repeats `bun run <script>`, with the flags that came", () => {
  assert.equal(command("bun", "issue:start:free", { "no-repo-deny": true }), "bun run issue:start:free 34 --no-repo-deny");
});

test("npm needs `--` only when flags follow the number", () => {
  assert.equal(command("npm", "issue:start:free"), "npm run issue:start:free 34");
  assert.equal(command("npm", "issue:start", { free: true }), "npm run issue:start -- 34 --free");
  assert.equal(command("npm", "issue:start", {}, "--teleport"), "npm run issue:start -- 34 --teleport");
});

test("pnpm and yarn run the script by name", () => {
  assert.equal(command("pnpm", "issue:start:free"), "pnpm issue:start:free 34");
  assert.equal(command("yarn", "issue:start:free"), "yarn issue:start:free 34");
});

test("without the variables, or from someone else's script, it is the plain command", () => {
  assert.equal(command(null, null), "issue-flow issue start 34");
  assert.equal(command("npm", "test"), "issue-flow issue start 34");
  assert.equal(command("npm", "dev"), "issue-flow issue start 34");
  assert.equal(command("npm", null), "issue-flow issue start 34");
  assert.equal(command(null, "issue:start"), "issue-flow issue start 34");
});

test("only the flags that shape the run are repeated, in order", () => {
  const flags = { yes: true, new: true, free: true, "dry-run": true, branch: true, plan: true, resume: "x", "no-launch": true };
  assert.equal(command(null, null, flags), "issue-flow issue start 34 --free");
  assert.deepEqual(
    launchOf({}, { "ask-permissions": true, free: true, "no-repo-deny": true, namer: "claude", repo: "o/r", lang: "en" }).flags,
    ["--ask-permissions", "--free", "--no-repo-deny", "--namer", "claude", "-R", "o/r", "--lang", "en"],
  );
});

test("--free is not repeated when the script already is the free one", () => {
  const launch = launchOf({ npm_config_user_agent: AGENT.bun, npm_lifecycle_event: "issue:start:free" }, { free: true });
  assert.deepEqual(launch.flags, []);
});

test("--lang is repeated only as a flag, not from ISSUE_FLOW_LANG", () => {
  assert.equal(command(null, null, { lang: "en" }), "issue-flow issue start 34 --lang en");
  assert.equal(launchOf({ ISSUE_FLOW_LANG: "en" }, {}).flags.length, 0);
});

test("--cloud drops the permission flags and the free script, so the command does not fail", () => {
  assert.equal(command("bun", "issue:start:free", { free: true }, "--cloud"), "bun run issue:start 34 --cloud");
  assert.equal(command("npm", "issue:start:free", { free: true, "no-repo-deny": true }, "--cloud"), "npm run issue:start -- 34 --cloud");
  assert.equal(command("pnpm", "issue:start", { "ask-permissions": true, namer: "claude" }, "--cloud"), "pnpm issue:start 34 --namer claude --cloud");
  assert.equal(command(null, null, { "ask-permissions": true }, "--cloud"), "issue-flow issue start 34 --cloud");
  assert.equal(command(null, null, { free: true, "no-repo-deny": true, repo: "o/r" }, "--cloud"), "issue-flow issue start 34 -R o/r --cloud");
  assert.equal(command("bun", "issue:start:free", { free: true }, "--teleport"), "bun run issue:start:free 34 --teleport");
});
