/**
 * @file The `init`, `doctor` and `upgrade` commands of the CLI: their flags turned into
 * options.
 */
import type { Flags } from "./cli.js";
import { doctor } from "./commands/doctor.js";
import { init } from "./commands/init.js";
import { upgrade } from "./commands/upgrade.js";
import { type Output, UsageError } from "./output.js";

/** The setup commands. */
export const SETUP_COMMANDS = ["init", "doctor", "upgrade"];

/**
 * Runs `issue-flow init`, `doctor` or `upgrade`.
 * @param command - The command.
 * @param flags - The flags, already checked to be the command's own.
 * @param rest - The positionals after it.
 * @param run - Where it writes and runs.
 * @returns The exit code.
 * @throws UsageError with arguments; what the command throws.
 * @example await runSetupCommand("doctor", {}, [], { out, cwd })
 */
export async function runSetupCommand(command: string, flags: Flags, rest: string[], run: { out: Output; cwd: string }): Promise<number> {
  if (rest.length > 0) throw new UsageError(`${command} takes no arguments.`);
  if (command === "doctor") return doctor(run.cwd, flags.json ?? false, run.out);
  if (command === "upgrade") return upgrade({ cwd: run.cwd, dryRun: flags["dry-run"] ?? false }, run.out);
  const recipes = flags.recipe === undefined ? null : flags.recipe.split(",").map((name) => name.trim()).filter((name) => name !== "");
  return init({ cwd: run.cwd, yes: flags.yes ?? false, recipes }, run.out);
}
