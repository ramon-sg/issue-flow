// Fake claude for the tests: logs its arguments, stdin, folder and the worktree's lock to
// FAKE_CLAUDE_LOG, then prints FAKE_CLAUDE_OUTPUT and exits with FAKE_CLAUDE_EXIT (0 by
// default). Like the real one, `--session-id <id>` saves the session under
// CLAUDE_CONFIG_DIR. FAKE_CLAUDE_MERGE=<n> marks that PR merged in FAKE_GH_WORLD, as if it
// was merged during the session.
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
// NOTE: only the naming call (`--output-format`) reads stdin, as a session would not.
const input = args.includes("--output-format") ? readFileSync(0, "utf8") : "";
let lock = null;
try {
  const list = execFileSync("git", ["worktree", "list", "--porcelain"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  const here = list.split("\n\n").find((entry) => entry.startsWith(`worktree ${process.cwd()}\n`));
  lock = /^locked ?(.*)$/m.exec(here ?? "")?.[1] ?? null;
} catch {}
appendFileSync(process.env.FAKE_CLAUDE_LOG, `${JSON.stringify({ args, input, cwd: process.cwd(), lock })}\n`);
const session = args.indexOf("--session-id");
if (session !== -1 && process.env.CLAUDE_CONFIG_DIR) {
  mkdirSync(join(process.env.CLAUDE_CONFIG_DIR, "projects", "p"), { recursive: true });
  writeFileSync(join(process.env.CLAUDE_CONFIG_DIR, "projects", "p", `${args[session + 1]}.jsonl`), "");
}
if (process.env.FAKE_CLAUDE_MERGE && !args.includes("-p")) {
  const world = JSON.parse(readFileSync(process.env.FAKE_GH_WORLD, "utf8"));
  const pull = world.pulls.find((item) => item.number === Number(process.env.FAKE_CLAUDE_MERGE));
  pull.state = "merged";
  writeFileSync(process.env.FAKE_GH_WORLD, JSON.stringify(world, null, 2));
}
process.stdout.write(process.env.FAKE_CLAUDE_OUTPUT ?? "");
process.exitCode = Number(process.env.FAKE_CLAUDE_EXIT ?? 0);
