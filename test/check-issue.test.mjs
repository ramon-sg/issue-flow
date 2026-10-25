// Tests of skills/github-issues/check-issue.sh: the shape of an issue body and its word cap,
// which a repo can change in the skill's project.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL = join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "github-issues");

// A copy of the skill, so a project.md can be written next to the script.
function skillCopy() {
  const dir = join(mkdtempSync(join(tmpdir(), "check-issue-")), "github-issues");
  cpSync(SKILL, dir, { recursive: true });
  return dir;
}

// A bug body with the three-line header and `words` words of description.
function bugBody(words, { header = "**Qué falla:**" } = {}) {
  return [
    `${header} ${"palabra ".repeat(words).trim()}.`,
    "**Por qué importa:** bloquea.",
    "**Hecho cuando:** responde 200.",
    "",
    "**Criterios de aceptación**",
    "- [ ] Responde 200.",
    "",
    "**Slug de rama**",
    "`order-detail-refresh`",
    "",
  ].join("\n");
}

function check(dir, body, kind = "bug") {
  const file = join(dir, "..", "body.md");
  writeFileSync(file, body);
  return spawnSync("bash", [join(dir, "check-issue.sh"), file, kind], { encoding: "utf8" });
}

test("a bug over the skill's cap fails, and passes when project.md raises the cap", () => {
  const dir = skillCopy();
  const body = bugBody(200);

  const strict = check(dir, body);
  writeFileSync(join(dir, "project.md"), "# github-issues\n\n## Topes\n\n| Tipo | Palabras |\n|---|---|\n| bug | 400 |\n| feature | 250 |\n");
  const raised = check(dir, body);

  assert.equal(strict.status, 1);
  assert.match(strict.stdout, /el tope de 'bug' es 150/);
  assert.equal(raised.status, 0, raised.stdout);
  assert.match(raised.stdout, /^OK: bug, \d+ palabras, 1 criterios\./);
});

test("a body whose header does not start with its label fails", () => {
  const dir = skillCopy();

  const r = check(dir, bugBody(5, { header: "**Qué se pide:**" }));

  assert.equal(r.status, 1);
  assert.match(r.stdout, /La línea 1 de la cabecera debe empezar con '\*\*Qué falla:\*\*'/);
});
