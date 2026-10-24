// Test helpers: a checkout whose origin says github.com/acme/widgets, a PATH with only node,
// git, the fake gh and (unless asked not to) the fake claude, and the compiled CLI.
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "dist", "cli.js");

export const ISSUES = "repos/acme/widgets/issues";

export function issue(number, extra = {}) {
  return {
    number,
    title: `Issue ${number}`,
    state: "open",
    body: "",
    html_url: `https://github.com/acme/widgets/issues/${number}`,
    node_id: `I_${number}`,
    labels: [],
    assignees: [],
    ...extra,
  };
}

function wrapper(dir, name, script) {
  writeFileSync(join(dir, name), `#!/bin/sh\nexec node "${join(HERE, script)}" "$@"\n`);
  chmodSync(join(dir, name), 0o755);
}

function which(command) {
  return execFileSync("sh", ["-c", `command -v ${command}`], { encoding: "utf8" }).trim();
}

export function sandbox() {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "issue-flow-")));
  const repo = join(tmp, "repo");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  execFileSync("git", ["-C", repo, "remote", "add", "origin", "https://github.com/acme/widgets.git"]);
  const bin = join(tmp, "bin");
  const noClaude = join(tmp, "bin-no-claude");
  for (const dir of [bin, noClaude]) {
    mkdirSync(dir);
    symlinkSync(process.execPath, join(dir, "node"));
    symlinkSync(which("git"), join(dir, "git"));
    wrapper(dir, "gh", "fake-gh.mjs");
  }
  wrapper(bin, "claude", "fake-claude.mjs");
  const routes = {};
  const files = {
    routes: join(tmp, "routes.json"),
    gh: join(tmp, "gh.jsonl"),
    claude: join(tmp, "claude.jsonl"),
  };
  const lines = (file) =>
    existsSync(file)
      ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line))
      : [];
  return {
    tmp,
    repo,
    route(key, body, status = 200) {
      routes[key] = { status, body };
    },
    config(value) {
      mkdirSync(join(repo, ".agents"), { recursive: true });
      writeFileSync(
        join(repo, ".agents", "flow.json"),
        typeof value === "string" ? value : JSON.stringify(value),
      );
    },
    ghCalls: () => lines(files.gh),
    claudeCalls: () => lines(files.claude),
    run(args, { claude, claudeExit, withoutClaude = false, env = {} } = {}) {
      writeFileSync(files.routes, JSON.stringify(routes));
      writeFileSync(files.gh, "");
      writeFileSync(files.claude, "");
      const r = spawnSync(process.execPath, [CLI, ...args], {
        cwd: repo,
        encoding: "utf8",
        env: {
          HOME: tmp,
          PATH: withoutClaude ? noClaude : bin,
          FAKE_GH_ROUTES: files.routes,
          FAKE_GH_LOG: files.gh,
          FAKE_CLAUDE_LOG: files.claude,
          ...(claude === undefined ? {} : { FAKE_CLAUDE_OUTPUT: claude }),
          ...(claudeExit === undefined ? {} : { FAKE_CLAUDE_EXIT: String(claudeExit) }),
          ...env,
        },
      });
      return {
        status: r.status,
        out: r.stdout,
        err: r.stderr,
        json: () => JSON.parse(r.stdout),
      };
    },
  };
}
