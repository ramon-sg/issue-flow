// Helpers of the `issue start` tests: a bare origin and a clone whose origin says
// github.com/acme/widgets (git rewrites it to the bare one), the GitHub world of
// fake-github.mjs, the fake claude, and the compiled CLI.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "..", "dist", "cli.js");
const URL = "https://github.com/acme/widgets.git";

export const BODY = "Cuando un reclamo termina en reembolso, la API no le avisa a Odoo.\n\n**Slug de rama**\n`odoo-refund-notice`\n\n**Detalle**\nMás texto.";
export const BRANCH = "feat/214-odoo-refund-notice";
export const WT = ".claude/worktrees/feat+214-odoo-refund-notice";

const GIT_ENV = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

function which(command) {
  return execFileSync("sh", ["-c", `command -v ${command}`], { encoding: "utf8" }).trim();
}

function wrapper(dir, name, script) {
  writeFileSync(join(dir, name), `#!/bin/sh\nexec node "${join(HERE, script)}" "$@"\n`);
  chmodSync(join(dir, name), 0o755);
}

export function rawIssue(number, extra = {}) {
  return {
    number,
    title: "Avisar devoluciones a Odoo",
    state: "open",
    body: BODY,
    html_url: `https://github.com/acme/widgets/issues/${number}`,
    labels: [{ name: "enhancement" }, { name: "P1: urgent" }],
    assignees: [],
    ...extra,
  };
}

export function startSandbox() {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "issue-start-")));
  const origin = join(tmp, "origin.git");
  const main = join(tmp, "main");
  const g = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...GIT_ENV } }).trim();
  g(tmp, "init", "-q", "--bare", "-b", "main", origin);
  g(tmp, "init", "-q", "-b", "main", main);
  g(main, "remote", "add", "origin", URL);
  g(main, "config", `url.${origin}.insteadOf`, URL);
  writeFileSync(join(main, ".gitignore"), ".claude/worktrees/\n.local/\n");
  writeFileSync(join(main, ".worktreeinclude"), "# comment\n\n.local/credentials\n.local/keys/*.pem\nnotes.txt\n");
  g(main, "add", ".gitignore", ".worktreeinclude");
  g(main, "commit", "-q", "-m", "init");
  g(main, "push", "-q", "-u", "origin", "main");
  mkdirSync(join(main, ".local", "keys"), { recursive: true });
  writeFileSync(join(main, ".local", "credentials"), "ID=x\n");
  chmodSync(join(main, ".local", "credentials"), 0o600);
  writeFileSync(join(main, ".local", "keys", "a.pem"), "k\n");
  const bin = join(tmp, "bin");
  const noClaude = join(tmp, "bin-no-claude");
  for (const dir of [bin, noClaude]) {
    mkdirSync(dir);
    symlinkSync(process.execPath, join(dir, "node"));
    symlinkSync(which("git"), join(dir, "git"));
    symlinkSync(which("sh"), join(dir, "sh"));
    wrapper(dir, "gh", "fake-gh.mjs");
    wrapper(dir, "docker", "fake-docker.mjs");
  }
  wrapper(bin, "claude", "fake-claude.mjs");
  const files = {
    world: join(tmp, "world.json"),
    routes: join(tmp, "routes.json"),
    gh: join(tmp, "gh.jsonl"),
    claude: join(tmp, "claude.jsonl"),
    config: join(tmp, "claude-config"),
    docker: join(tmp, "docker.json"),
    dockerLog: join(tmp, "docker.jsonl"),
  };
  writeFileSync(files.docker, JSON.stringify({ running: true, items: [] }));
  const world = { repo: "acme/widgets", defaultBranch: "main", origin, login: "me", issues: { 214: rawIssue(214) }, pulls: [], nextPr: 900 };
  const lines = (file) => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)) : []);
  const sandbox = {
    tmp,
    main,
    origin,
    world,
    git: (cwd, ...args) => g(cwd, ...args),
    load() {
      Object.assign(world, JSON.parse(readFileSync(files.world, "utf8")));
      return world;
    },
    issue(number, extra) {
      world.issues[number] = rawIssue(number, extra);
    },
    pull(pull) {
      world.pulls.push({ state: "open", body: "", ...pull });
    },
    // A branch in origin, one commit ahead of main if `commit`, without a local copy.
    pushBranch(name, { commit = false, file = null } = {}) {
      const work = join(tmp, `push-${Math.random().toString(16).slice(2)}`);
      g(tmp, "clone", "-q", origin, work);
      g(work, "checkout", "-q", "-b", name);
      if (file !== null) {
        mkdirSync(dirname(join(work, file)), { recursive: true });
        writeFileSync(join(work, file), "x\n");
        g(work, "add", file);
      }
      if (commit || file !== null) g(work, "commit", "-q", "--allow-empty", "-m", `work on ${name}`);
      g(work, "push", "-q", "origin", name);
      return g(work, "rev-parse", "HEAD");
    },
    ghCalls: () => lines(files.gh),
    writes: () => lines(files.gh).filter((call) => call.method !== "GET" && call.path !== "graphql"),
    claudeCalls: () => lines(files.claude),
    sessionFiles: () => {
      const dir = join(main, ".git", "issue-flow-sessions");
      return existsSync(dir) ? execFileSync("ls", [dir], { encoding: "utf8" }).split("\n").filter(Boolean) : [];
    },
    run(args, options) {
      return sandbox.cli(["issue", "start", ...args], options);
    },
    // The Docker of fake-docker.mjs: items are { kind, id, project, dir }.
    docker: {
      get: () => JSON.parse(readFileSync(files.docker, "utf8")),
      set: (state) => writeFileSync(files.docker, JSON.stringify(state)),
      calls: () => lines(files.dockerLog),
    },
    stateDir: join(tmp, "state"),
    cli(args, { input = "", withoutClaude = false, env = {}, cwd = main } = {}) {
      writeFileSync(files.world, JSON.stringify(world, null, 2));
      writeFileSync(files.routes, "{}");
      writeFileSync(files.gh, "");
      writeFileSync(files.claude, "");
      writeFileSync(files.dockerLog, "");
      const r = spawnSync(process.execPath, [CLI, ...args], {
        cwd,
        encoding: "utf8",
        input,
        env: {
          ...GIT_ENV,
          HOME: tmp,
          PATH: withoutClaude ? noClaude : bin,
          FAKE_GH_WORLD: files.world,
          FAKE_GH_ROUTES: files.routes,
          FAKE_GH_LOG: files.gh,
          FAKE_CLAUDE_LOG: files.claude,
          CLAUDE_CONFIG_DIR: files.config,
          FAKE_DOCKER_STATE: files.docker,
          FAKE_DOCKER_LOG: files.dockerLog,
          ISSUE_FLOW_STATE_DIR: join(tmp, "state"),
          ...env,
        },
      });
      sandbox.load();
      return { status: r.status, out: r.stdout, err: r.stderr, all: `${r.stdout}${r.stderr}` };
    },
  };
  return sandbox;
}
