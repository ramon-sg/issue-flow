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
