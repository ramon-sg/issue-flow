// Tests of `issue-flow labels sync` against the fake gh.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CONFIG } from "../dist/config.js";
import { sandbox } from "./helpers.mjs";

const LIST = "GET repos/acme/widgets/labels?per_page=100&page=1";
const CREATE = "POST repos/acme/widgets/labels";

/** The labels of GitHub's default set that the flow also wants, as GitHub returns them. */
const GITHUB_DEFAULTS = ["bug", "enhancement", "documentation"].map((name) => ({ name, ...DEFAULT_CONFIG.labels[name] }));

const writes = (s) => s.ghCalls().filter((call) => call.method !== "GET");

test("creates only the labels the repo lacks, with their color and description", () => {
  const s = sandbox();
  s.route(LIST, GITHUB_DEFAULTS);
  s.route(CREATE, {}, 201);

  const r = s.run(["labels", "sync"]);

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(
    writes(s).map((call) => call.body),
    ["spike", "P1: urgent", "P2: important", "P3: minor", "P4: low"].map((name) => ({ name, ...DEFAULT_CONFIG.labels[name] })),
  );
  assert.match(r.out, /^ok {8}bug$/m);
  assert.match(r.out, /^created {3}spike$/m);
});

test("with every label there, it writes nothing", () => {
  const s = sandbox();
  s.route(LIST, Object.entries(DEFAULT_CONFIG.labels).map(([name, spec]) => ({ name, ...spec, color: spec.color.toLowerCase() })));

  const r = s.run(["labels", "sync", "--json"]);

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(writes(s), []);
  assert.ok(r.json().labels.every((label) => label.status === "ok"));
});

test("a label with another color is reported, and fixed only with --update, under GitHub's name", () => {
  const s = sandbox();
  s.config({ labels: Object.fromEntries(Object.keys(DEFAULT_CONFIG.labels).filter((name) => name !== "documentation").map((name) => [name, null])) });
  s.route(LIST, [{ name: "Documentation", color: "d8b82c", description: "README y guías" }]);
  s.route(CREATE, { message: "Validation Failed", errors: [{ code: "already_exists" }] }, 422);
  s.route("PATCH repos/acme/widgets/labels/Documentation", {});

  const report = s.run(["labels", "sync"]);
  const reportWrites = writes(s);
  const fixed = s.run(["labels", "sync", "--update", "--json"]);

  assert.equal(report.status, 0, report.err);
  assert.deepEqual(reportWrites, []);
  assert.match(report.out, /^differs {3}Documentation: has d8b82c "README y guías", the flow wants 0075ca .*--update fixes it/m);
  assert.equal(fixed.status, 0, fixed.err);
  assert.deepEqual(fixed.json().labels.map((label) => [label.name, label.status]), [["Documentation", "updated"]]);
  assert.deepEqual(writes(s).map((call) => [call.method, call.path]), [
    ["POST", "repos/acme/widgets/labels"],
    ["PATCH", "repos/acme/widgets/labels/Documentation"],
  ]);
  assert.equal(writes(s)[0].body.name, "Documentation");
});

test("--dry-run says what it would do and writes nothing", () => {
  const s = sandbox();
  s.route(LIST, []);

  const r = s.run(["labels", "sync", "--dry-run"]);

  assert.equal(r.status, 0, r.err);
  assert.deepEqual(writes(s), []);
  assert.match(r.out, /^to create spike$/m);
  assert.ok(s.run(["labels", "sync", "--dry-run", "--json"]).json().labels.every((label) => label.status === "to-create"));
});

test("a write that fails is reported with the others, and it exits 1", () => {
  const s = sandbox();
  s.config({ labels: { spike: null, "P1: urgent": null, "P2: important": null, "P3: minor": null, "P4: low": null, "area:api": { color: "1d76db" } } });
  s.route(LIST, GITHUB_DEFAULTS);
  s.route(CREATE, { message: "Forbidden" }, 403);

  const r = s.run(["labels", "sync", "--json"]);

  assert.equal(r.status, 1);
  assert.deepEqual(r.json().labels.map((label) => [label.name, label.status]), [
    ["bug", "ok"],
    ["enhancement", "ok"],
    ["documentation", "ok"],
    ["area:api", "failed"],
  ]);
  assert.match(r.json().labels[3].error, /Forbidden/);
});

test("a label that appears after the list was read fails with a message to run it again", () => {
  const s = sandbox();
  s.config({ labels: Object.fromEntries(Object.keys(DEFAULT_CONFIG.labels).filter((name) => name !== "spike").map((name) => [name, null])) });
  s.route(LIST, []);
  s.route(CREATE, { message: "Validation Failed", errors: [{ code: "already_exists" }] }, 422);

  const r = s.run(["labels", "sync"]);

  assert.equal(r.status, 1);
  assert.equal(r.out, "failed    spike: it appeared in GitHub meanwhile: run labels sync again\n");
});

test("labels the repo adds are made too, and a null one is left out", () => {
  const s = sandbox();
  s.config({ labels: { spike: null, "area:api": { color: "1d76db", description: "API" } } });
  s.route(LIST, []);

  const r = s.run(["labels", "sync", "--dry-run", "--json"]);

  const names = r.json().labels.map((label) => label.name);
  assert.ok(names.includes("area:api"));
  assert.ok(!names.includes("spike"));
});

test("a list cut short writes nothing and fails", () => {
  const s = sandbox();
  s.route(LIST, Array.from({ length: 100 }, (_, index) => ({ name: `l${index}`, color: "ededed", description: "" })));

  const r = s.run(["labels", "sync"]);

  assert.equal(r.status, 1);
  assert.match(r.err, /could not read every label/);
  assert.deepEqual(writes(s), []);
});

test("bad usage exits 2", () => {
  const s = sandbox();

  assert.equal(s.run(["labels"]).status, 2);
  assert.equal(s.run(["labels", "sync", "extra"]).status, 2);
  assert.equal(s.run(["labels", "sync", "--yes"]).status, 2);
});
