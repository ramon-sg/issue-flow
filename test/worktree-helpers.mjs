// Helpers of the tests of the adapters, `pr worktree` and the worktree hooks: the config,
// steps that log where they ran, and real processes that listen on a port.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

// Writes .agents/flow.json in the main checkout, committed and pushed.
export function flow(s, config) {
  mkdirSync(join(s.main, ".agents"), { recursive: true });
  writeFileSync(join(s.main, ".agents", "flow.json"), JSON.stringify(config));
  s.git(s.main, "add", ".agents/flow.json");
  s.git(s.main, "commit", "-q", "-m", "flow");
  s.git(s.main, "push", "-q", "origin", "main");
}

// A step that appends its name and the folder it ran in to $LOG, and prints to stdout.
export const logStep = (name) => ({ name, run: `echo "${name} $PWD" >> "$LOG"; echo "output of ${name}"` });

export const withLog = (s, env = {}) => ({ LOG: join(s.tmp, "steps.log"), ...env });

// The lines the steps logged: "<name> <folder>".
export function logged(s) {
  const file = join(s.tmp, "steps.log");
  return existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
}

// A program that prints a fixed text (a fake Orca CLI), or fails if `text` is null.
export function fakeProgram(s, name, text) {
  const file = join(s.tmp, name);
  writeFileSync(file, text === null ? "#!/bin/sh\nexit 3\n" : `#!/bin/sh\necho '${text}'\n`, { mode: 0o755 });
  return file;
}

// A node process in its own group, in `cwd`, that listens on `port` until it is killed.
// With `parent`, the one listening is a child of the returned process, as a dev server's
// apps are, so only a signal to the whole group stops the returned one. With `onTerm`, the
// listener writes that file when it gets SIGTERM, and then exits; with `ignoreTerm`, it
// ignores SIGTERM.
// With `childCwd`, the listening child runs there and the parent in `cwd`.
export async function listener(cwd, port, { parent = false, onTerm = null, ignoreTerm = false, childCwd = cwd } = {}) {
  const exit = ignoreTerm ? "" : "process.exit(0);";
  const term = onTerm === null && !ignoreTerm ? "" : `process.on("SIGTERM", () => { ${onTerm === null ? "" : `require("fs").writeFileSync(${JSON.stringify(onTerm)}, "");`} ${exit} });`;
  const listen = `${term} require("net").createServer().listen(${port}, "127.0.0.1")`;
  const code = parent
    ? `require("child_process").spawn(process.execPath, ["-e", ${JSON.stringify(listen)}], { cwd: ${JSON.stringify(childCwd)}, stdio: "ignore" }); setInterval(() => {}, 1000)`
    : listen;
  const child = spawn(process.execPath, ["-e", code], {
    cwd,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  for (let tries = 0; tries < 100; tries += 1) {
    const open = await new Promise((resolve) => {
      const socket = connect({ port, host: "127.0.0.1" });
      socket.once("connect", () => resolve(socket.destroy() || true));
      socket.once("error", () => resolve(false));
    });
    if (open) return child.pid;
    await sleep(50);
  }
  throw new Error(`nothing listens on ${port}`);
}

// Whether a process is alive.
export function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
