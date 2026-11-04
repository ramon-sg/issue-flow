// Tests of the terminal's language: how it is chosen, that both catalogs have the same
// shape, and that --lang goes with any command without changing --json.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startSandbox } from "./start-helpers.mjs";
import { resolveLang } from "../dist/lang.js";
import { messages } from "../dist/messages/index.js";

test("the language is --lang, then ISSUE_FLOW_LANG, then Spanish; LANG is not read", () => {
  assert.equal(resolveLang(undefined, {}), "es");
  assert.equal(resolveLang(undefined, { LANG: "en_US.UTF-8" }), "es");
  assert.equal(resolveLang(undefined, { ISSUE_FLOW_LANG: "en" }), "en");
  assert.equal(resolveLang("es", { ISSUE_FLOW_LANG: "en" }), "es");
  assert.equal(resolveLang(undefined, { ISSUE_FLOW_LANG: "" }), "es");
});

test("an unknown language is a usage error that names the two", () => {
  assert.throws(() => resolveLang("fr", {}), /es or en/);
  assert.throws(() => resolveLang(undefined, { ISSUE_FLOW_LANG: "fr" }), /ISSUE_FLOW_LANG expects es or en: fr/);
});

// Every path of a catalog with the typeof of its leaf.
function shape(value, path = "") {
  if (typeof value === "object" && value !== null)
    return Object.entries(value).flatMap(([key, item]) => shape(item, `${path}.${key}`));
  return [`${path}: ${typeof value}`];
}

test("the Spanish and English catalogs have the same keys, with the same kind of value", () => {
  assert.deepEqual(shape(messages("en")).sort(), shape(messages("es")).sort());
});

test("--lang goes with any command, and --json is the same in both languages", () => {
  const s = startSandbox();

  const es = s.cli(["doctor", "--json", "--lang", "es"]);
  const en = s.cli(["doctor", "--json", "--lang", "en"]);

  assert.equal(es.err, "");
  assert.equal(es.out, en.out);
  assert.equal(es.status, en.status);
});

test("--lang with an unknown language stops with 2, in Spanish", () => {
  const s = startSandbox();

  const r = s.cli(["doctor", "--lang", "fr"]);

  assert.equal(r.status, 2);
  assert.match(r.err, /--lang espera es o en: fr/);
});

test("--help is in Spanish by default, and issue start --help keeps the npm examples", () => {
  const s = startSandbox();

  const r = s.cli(["--help"], { env: { ISSUE_FLOW_LANG: undefined } });
  const start = s.cli(["issue", "start", "--help"], { env: { ISSUE_FLOW_LANG: undefined } });

  assert.equal(r.status, 0);
  assert.match(r.out, /^Uso:/);
  assert.match(start.out, /npm run issue:start:free 42/);
});

test("--help with ISSUE_FLOW_LANG=en is the English text, and both mention --lang", () => {
  const s = startSandbox();

  const en = s.cli(["--help"]);
  const es = s.cli(["--help", "--lang", "es"]);

  assert.equal(`${en.out}`, `${messages("en").usage.main}\n`);
  assert.match(en.out, /^Usage:/);
  assert.match(en.out, /\[--lang es\|en\]/);
  assert.match(es.out, /\[--lang es\|en\]/);
});

test("issue start --help in Spanish names --free, --no-repo-deny and the npm note", () => {
  const s = startSandbox();

  const r = s.cli(["issue", "start", "--help"], { env: { ISSUE_FLOW_LANG: "es" } });

  assert.match(r.out, /^Uso: issue-flow issue start <n> \[flags\]/);
  assert.match(r.out, /--free/);
  assert.match(r.out, /--no-repo-deny/);
  assert.match(r.out, /npm run issue:start -- 42 --free/);
});

test("every flag of issue start has its own line in both languages of its help", async () => {
  const { COMMAND_FLAGS } = await import("../dist/cli-flags.js");
  for (const lang of ["es", "en"])
    for (const flag of COMMAND_FLAGS.start)
      assert.match(messages(lang).usage.start, new RegExp(`^ {2}(-\\w, )?--${flag}\\b`, "m"), `--${flag} in ${lang}`);
});

test("every flag of the CLI is in the main help, in both languages", async () => {
  const { OPTIONS } = await import("../dist/cli-flags.js");
  for (const lang of ["es", "en"])
    for (const [flag, { short }] of Object.entries(OPTIONS))
      if (flag !== "help") assert.match(messages(lang).usage.main, new RegExp(`--${flag}\\b|-${short}\\b`), `--${flag} in ${lang}`);
});

test("a usage error is in the language of the terminal, with its help", () => {
  const s = startSandbox();

  const es = s.cli(["issue", "start", "--free", "--ask-permissions", "42"], { env: { ISSUE_FLOW_LANG: "es" } });
  const en = s.cli(["issue", "start", "--free", "--ask-permissions", "42"]);

  assert.equal(es.status, 2);
  assert.match(es.err, /usa --ask-permissions o --free, no los dos\.\nUso: issue-flow issue start/);
  assert.match(en.err, /use --ask-permissions or --free, not both\.\nUsage: issue-flow issue start/);
});
