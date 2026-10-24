// Fake claude for the tests: logs its arguments and stdin to FAKE_CLAUDE_LOG, then prints
// FAKE_CLAUDE_OUTPUT and exits with FAKE_CLAUDE_EXIT (0 by default).
import { appendFileSync, readFileSync } from "node:fs";

const input = readFileSync(0, "utf8");
appendFileSync(
  process.env.FAKE_CLAUDE_LOG,
  `${JSON.stringify({ args: process.argv.slice(2), input })}\n`,
);
process.stdout.write(process.env.FAKE_CLAUDE_OUTPUT ?? "");
process.exitCode = Number(process.env.FAKE_CLAUDE_EXIT ?? 0);
