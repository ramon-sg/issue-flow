// Tests of .agents/flow.json: defaults, partial sections and errors that name the key.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ConfigError, DEFAULT_CONFIG, loadConfig, parseConfig } from "../dist/config.js";
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

test("each invalid value is an error that names its key", () => {
  for (const [raw, message] of [
    [{ branchTemplate: "x" }, /unknown key "branchTemplate"/],
    [{ branch: { namr: "title" } }, /unknown key "branch.namr"/],
    [{ branch: { template: "{type}/{slug}" } }, /"branch.template" needs \{number\}/],
    [{ branch: { namer: "gpt" } }, /"branch.namer" must be "claude" or "title"/],
    [{ branch: { types: { labels: { bug: "Fix" } } } }, /"branch.types.labels.bug" must be a lowercase/],
    [{ repo: "widgets" }, /"repo" must be owner\/repo/],
    [{ worktrees: { dir: "" } }, /"worktrees.dir" must be a non-empty string/],
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
});
