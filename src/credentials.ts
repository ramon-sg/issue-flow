/**
 * @file git commands that talk to origin (fetch, push). git never asks for a username and
 * password here (see `git`); when it fails for lack of them, this says so with Kuro and, on
 * a terminal, offers to run `gh auth setup-git`, which makes git use gh's session, and then
 * tries once more.
 */
import { spawnSync } from "node:child_process";
import { confirm } from "./ask.js";
import { show } from "./banner.js";
import type { FlowConfig } from "./config.js";
import { git, type GitResult, lacksCredentials } from "./git.js";
import type { Output } from "./output.js";

/** The command that gives git gh's session. */
export const SETUP_GIT = "gh auth setup-git";

/**
 * Explains that git has no GitHub credentials and, on a terminal, offers to run
 * `gh auth setup-git`.
 * @param out - Where to write and ask.
 * @param config - The repo's config, or null without one.
 * @returns True if it ran and worked, so the git command can be tried again.
 */
async function offerSetup(out: Output, config: FlowConfig | null): Promise<boolean> {
  const t = out.t.credentials;
  show(out, { mood: "error", title: t.title, lines: t.why, next: { label: t.fixLabel, command: SETUP_GIT } }, config, "stderr");
  if (!out.interactive || !(await confirm(out, t.runNow))) return false;
  const run = spawnSync("gh", ["auth", "setup-git"], { stdio: "inherit" });
  if (run.error !== undefined) {
    show(out, { mood: "error", title: t.noGh, lines: [t.installGh] }, config, "stderr");
    return false;
  }
  if (run.status !== 0) {
    show(out, { mood: "error", title: t.failed, next: { label: t.loginLabel, command: "gh auth login" } }, config, "stderr");
    return false;
  }
  show(out, { mood: "ok", title: t.done }, config, "stderr");
  return true;
}

/**
 * Runs a git command that talks to origin. If it fails for lack of credentials, it explains
 * why with Kuro, offers to set them up and, if that worked, runs it once more. A failure
 * already explained comes back with an empty `err`, so the caller does not say it again.
 * @param out - Where to write and ask.
 * @param config - The repo's config, or null without one.
 * @param cwd - Where to run git.
 * @param args - The arguments.
 * @returns The result.
 * @example await fromOrigin(out, config, root, ["fetch", "-q", "origin"])
 */
export async function fromOrigin(out: Output, config: FlowConfig | null, cwd: string, args: string[]): Promise<GitResult> {
  const result = git(cwd, args);
  if (result.ok || !lacksCredentials(result)) return result;
  if (await offerSetup(out, config)) return git(cwd, args);
  return { ...result, err: "" };
}
