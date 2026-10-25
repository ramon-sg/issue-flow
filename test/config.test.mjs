// Tests of .agents/flow.json: defaults, partial sections and errors that name the key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ConfigError, DEFAULT_CONFIG, loadConfig, parseConfig, SESSION_COLORS } from "../dist/config.js";
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

test("each invalid value is an error that names its key", () => {
  for (const [raw, message] of [
    [{ branchTemplate: "x" }, /unknown key "branchTemplate"/],
    [{ branch: { namr: "title" } }, /unknown key "branch.namr"/],
    [{ branch: { template: "{type}/{slug}" } }, /"branch.template" needs \{number\}/],
    [{ branch: { namer: "gpt" } }, /"branch.namer" must be "claude" or "title"/],
    [{ branch: { types: { labels: { bug: "Fix" } } } }, /"branch.types.labels.bug" must be a lowercase/],
    [{ repo: "widgets" }, /"repo" must be owner\/repo/],
    [{ worktrees: { dir: "" } }, /"worktrees.dir" must be a non-empty string/],
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
