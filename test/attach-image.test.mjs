// Tests of skills/github-issues/attach-image.sh: which repo it uploads to when --repo is not
// given. A fake gh writes the path it was asked for and fails, so nothing is uploaded.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "skills", "github-issues", "attach-image.sh");

// Runs the script in a checkout whose origin is `url`, and returns the repo it asked gh for.
function askedRepo(url, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), "attach-image-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "gh"), `#!/bin/sh\necho "$2" > "${join(dir, "asked")}"\nexit 1\n`, { mode: 0o755 });
  const repo = join(dir, "repo");
  mkdirSync(repo);
  spawnSync("git", ["init", "-q"], { cwd: repo });
  spawnSync("git", ["remote", "add", "origin", url], { cwd: repo });
  spawnSync("git", ["config", "url.https://example.com/.insteadOf", "https://github.com/"], { cwd: repo });
  writeFileSync(join(repo, "shot.png"), "not really a png");
  const { GH_REPO: _ignored, ...base } = process.env;
  spawnSync("bash", [SCRIPT, "--file", "shot.png", "--no-optimize"], {
    cwd: repo,
    env: { ...base, PATH: `${bin}:${process.env.PATH}`, ...env },
  });
  return readFileSync(join(dir, "asked"), "utf8").trim();
}

test("the repo comes from the stored origin URL, also through the cloud's git proxy", () => {
  assert.equal(askedRepo("https://github.com/acme/widgets.git"), "repos/acme/widgets");
  assert.equal(askedRepo("git@github.com:acme/widgets.git"), "repos/acme/widgets");
  assert.equal(askedRepo("ssh://git@github.com/acme/widgets"), "repos/acme/widgets");
  assert.equal(askedRepo("http://local_proxy@127.0.0.1:41234/git/acme/widgets"), "repos/acme/widgets");
});

test("GH_REPO wins over the origin, with or without its host", () => {
  assert.equal(askedRepo("https://github.com/acme/widgets.git", { GH_REPO: "other/gadgets" }), "repos/other/gadgets");
  assert.equal(askedRepo("https://github.com/acme/widgets.git", { GH_REPO: "github.com/other/gadgets" }), "repos/other/gadgets");
});
