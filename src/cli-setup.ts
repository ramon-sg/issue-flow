/**
 * @file The `apply` and `doctor` commands of the CLI, and `init` and `upgrade`, which run
 * `apply` now and say so: their flags turned into options.
 */
import type { Flags } from "./cli.js";
import { apply } from "./commands/apply.js";
import { doctor } from "./commands/doctor.js";
import { type Output, UsageError, warn } from "./output.js";

/** The setup commands. */
export const SETUP_COMMANDS = ["apply", "init", "upgrade", "doctor"];

/**
 * The names given with `--recipe`.
 * @param value - The flag.
 * @returns The names, or null without the flag.
 */
function recipesOf(value: string | undefined): string[] | null {
  return value === undefined ? null : value.split(",").map((name) => name.trim()).filter((name) => name !== "");
}

/**
 * Runs `issue-flow apply` or `doctor`. `init` is `apply` with its flags; `upgrade` is
 * `apply --yes` without recipes, as it never asked, so an `agent-kitchen` that still calls
 * it keeps working.
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
  if (command === "init" || command === "upgrade") warn(run.out, `${command} is now apply: run 'issue-flow apply'. ${command} goes away in 0.4.0.`);
  if (command === "upgrade") return apply({ cwd: run.cwd, yes: true, dryRun: flags["dry-run"] ?? false, json: false, recipes: [] }, run.out);
  return apply({ cwd: run.cwd, yes: flags.yes ?? false, dryRun: flags["dry-run"] ?? false, json: flags.json ?? false, recipes: recipesOf(flags.recipe) }, run.out);
}
