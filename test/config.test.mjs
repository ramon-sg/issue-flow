// Tests of .agents/flow.json: defaults, partial sections and errors that name the key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ConfigError } from "../dist/config-base.js";
import { DEFAULT_CONFIG, loadConfig, parseConfig, SESSION_COLORS } from "../dist/config.js";
import { sandbox } from "./helpers.mjs";

test("without the file, every default applies", () => {
  const s = sandbox();

  assert.deepEqual(loadConfig(s.repo), DEFAULT_CONFIG);
  assert.deepEqual(loadConfig(s.tmp), DEFAULT_CONFIG);
});

test("a partial section keeps the other defaults, and a type map replaces the default whole", () => {
  const config = parseConfig({
    $schema: "./schema.json",
    repo: "acme/widgets",
    branch: { namer: "title", types: { labels: { tipo: "feat" } } },
    start: { commitMessage: "chore: start #{number}" },
  });

  assert.equal(config.repo, "acme/widgets");
  assert.equal(config.branch.namer, "title");
  assert.equal(config.branch.template, DEFAULT_CONFIG.branch.template);
  assert.deepEqual(config.branch.types.labels, { tipo: "feat" });
  assert.deepEqual(config.branch.types.titlePrefixes, DEFAULT_CONFIG.branch.types.titlePrefixes);
  assert.equal(config.start.commitMessage, "chore: start #{number}");
  assert.equal(config.start.prBody, DEFAULT_CONFIG.start.prBody);
});

test("plans and colors: a given value replaces the default, and dirs lose a trailing slash", () => {
  const config = parseConfig({ plans: { dirs: ["notes/plans/"] }, colors: { "prio:high": "pink" } });

  assert.deepEqual(config.plans.dirs, ["notes/plans"]);
  assert.deepEqual(config.colors, { "prio:high": "pink" });
  assert.deepEqual(parseConfig({}).colors, DEFAULT_CONFIG.colors);
});

test("worktrees: steps with their flags, ports on with true or a range, and the defaults off", () => {
  const config = parseConfig({
    worktrees: {
      setup: [{ name: "deps", run: "npm ci", trusted: true, once: true }, { name: "env", run: "./env.sh" }],
      teardown: [{ name: "docker", run: "docker compose down" }],
      ports: true,
      dockerProjects: ["acme-dev"],
    },
  });

  assert.deepEqual(config.worktrees.setup, [
    { name: "deps", run: "npm ci", trusted: true, once: true },
    { name: "env", run: "./env.sh", trusted: false, once: false },
  ]);
  assert.deepEqual(config.worktrees.teardown, [{ name: "docker", run: "docker compose down", trusted: false, once: false }]);
  assert.deepEqual(config.worktrees.ports, { start: 20000, blockSize: 10, blocks: 1000 });
  assert.equal(config.worktrees.dir, ".claude/worktrees");
  assert.deepEqual(parseConfig({ worktrees: { ports: { start: 30000 } } }).worktrees.ports, { start: 30000, blockSize: 10, blocks: 1000 });
  assert.equal(parseConfig({ worktrees: { ports: false } }).worktrees.ports, null);
  assert.deepEqual(parseConfig({}).worktrees, { dir: ".claude/worktrees", setup: [], teardown: [], ports: null, dockerProjects: [] });
});

test("each invalid value is an error that names its key", () => {
  for (const [raw, message] of [
    [{ branchTemplate: "x" }, /unknown key "branchTemplate"/],
    [{ branch: { namr: "title" } }, /unknown key "branch.namr"/],
    [{ branch: { template: "{type}/{slug}" } }, /"branch.template" needs \{number\}/],
    [{ branch: { namer: "gpt" } }, /"branch.namer" must be "claude" or "title"/],
    [{ branch: { types: { labels: { bug: "Fix" } } } }, /"branch.types.labels.bug" must be a lowercase/],
    [{ repo: "widgets" }, /"repo" must be owner\/repo/],
    [{ worktrees: { dir: "" } }, /"worktrees.dir" must be a non-empty string/],
    [{ worktrees: { setup: {} } }, /"worktrees.setup" must be a list of steps/],
    [{ worktrees: { setup: [{ name: "Deps", run: "x" }] } }, /"worktrees.setup\[0\].name" must be lowercase/],
    [{ worktrees: { setup: [{ name: "deps" }] } }, /"worktrees.setup\[0\].run" must be a non-empty string/],
    [{ worktrees: { setup: [{ name: "a", run: "x" }, { name: "a", run: "y" }] } }, /has two steps named "a"/],
    [{ worktrees: { setup: [{ name: "a", run: "x", trusted: "yes" }] } }, /"worktrees.setup\[0\].trusted" must be true or false/],
    [{ worktrees: { teardown: [{ name: "a", run: "x", once: true }] } }, /unknown key "worktrees.teardown\[0\].once"/],
    [{ worktrees: { ports: { blocks: 3 } } }, /"worktrees.ports.blocks" must be even/],
    [{ worktrees: { ports: { start: 80 } } }, /"worktrees.ports" must stay between 1024/],
    [{ worktrees: { ports: { start: 65000, blockSize: 10, blocks: 100 } } }, /must stay between/],
    [{ worktrees: { ports: { blockSize: 1.5 } } }, /"worktrees.ports.blockSize" must be a positive whole number/],
    [{ worktrees: { ports: "yes" } }, /"worktrees.ports" must be true, false or an object/],
    [{ worktrees: { dockerProjects: ["Acme"] } }, /"worktrees.dockerProjects" must be a list/],
    [{ start: { prompt: "" } }, /"start.prompt" must be a non-empty string/],
    [{ plans: { dirs: [] } }, /"plans.dirs" must be a non-empty list/],
    [{ plans: { dirs: ["/abs"] } }, /"plans.dirs" must be a non-empty list of folders relative/],
    [{ plans: { folders: ["x"] } }, /unknown key "plans.folders"/],
    [{ colors: { "P1:": "crimson" } }, /"colors.P1:" must be one of red, blue/],
    [[], /must be a JSON object/],
  ]) {
    assert.throws(() => parseConfig(raw), (error) => error instanceof ConfigError && message.test(error.message), JSON.stringify(raw));
  }
});

test("a file that is not JSON is a ConfigError", () => {
  const s = sandbox();
  s.config("{ nope");

  assert.throws(() => loadConfig(s.repo), /flow.json is not valid JSON/);
});

test("schema.json has the same keys and defaults as the code", async () => {
  const { readFileSync } = await import("node:fs");
  const schema = JSON.parse(readFileSync(new URL("../schema.json", import.meta.url), "utf8"));
  const props = schema.properties;

  assert.deepEqual(Object.keys(props).filter((key) => key !== "$schema"), Object.keys(DEFAULT_CONFIG));
  for (const section of ["branch", "worktrees", "start"]) {
    assert.deepEqual(Object.keys(props[section].properties), Object.keys(DEFAULT_CONFIG[section]), section);
    for (const [key, value] of Object.entries(DEFAULT_CONFIG[section])) {
      if (typeof value === "string") assert.equal(props[section].properties[key].default, value, `${section}.${key}`);
    }
  }
  assert.deepEqual(props.branch.properties.namer.enum, ["claude", "title"]);
  assert.deepEqual(props.plans.properties.dirs.default, DEFAULT_CONFIG.plans.dirs);
  assert.deepEqual(props.colors.default, DEFAULT_CONFIG.colors);
  assert.deepEqual(props.colors.additionalProperties.enum, SESSION_COLORS);
});
