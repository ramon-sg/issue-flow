/**
 * @file `issue-flow labels sync [--update] [--dry-run] [--json]`: makes in GitHub the labels
 * of `labels` in `.agents/flow.json` that the repo lacks. Names compare ignoring case, as
 * GitHub does, so `Bug` counts as `bug` and is never renamed. A label that exists with
 * another color or description is only reported, unless `--update`. It never deletes. A
 * write that fails does not stop the rest: every label is reported, and it exits 1.
 */
import { createLabel, type Label, listLabels } from "@ramon-sg/github-rest";
import type { LabelSpec } from "../config.js";
import { emitJson, type Output } from "../output.js";

/**
 * What happened to one label: with `--dry-run`, `to-create` and `to-update` instead of
 * `created` and `updated`; `failed` when GitHub refused the write.
 */
export type LabelStatus = "created" | "updated" | "ok" | "differs" | "to-create" | "to-update" | "failed";

/** One label of the result. */
export interface LabelResult {
  name: string;
  status: LabelStatus;
  color: string;
  description: string;
  /** What GitHub has, when it differs. */
  found?: { color: string; description: string };
  /** Why the write failed. */
  error?: string;
}

/** The options of `labels sync`. */
export interface LabelsSyncOptions {
  repo: string;
  labels: Record<string, LabelSpec>;
  update: boolean;
  dryRun: boolean;
  json: boolean;
}

/** Width of the status column in the text output. */
const STATUS_WIDTH = 10;

/**
 * Whether a label in GitHub has the wanted color and description (colors ignore case).
 * @param found - The label in GitHub.
 * @param spec - The wanted one.
 * @returns True if they match.
 */
function matches(found: Label, spec: LabelSpec): boolean {
  return found.color.toLowerCase() === spec.color.toLowerCase() && found.description === spec.description;
}

/**
 * What to do with each label, before writing anything.
 * @param wanted - The labels of the config.
 * @param existing - The labels in GitHub.
 * @param update - Whether to fix the ones that differ.
 * @returns Each label with its status, as if every write worked, and its name in GitHub if it exists.
 */
export function planLabels(wanted: Record<string, LabelSpec>, existing: Label[], update: boolean): LabelResult[] {
  const byName = new Map(existing.map((label) => [label.name.toLowerCase(), label]));
  return Object.entries(wanted).map(([name, spec]) => {
    const found = byName.get(name.toLowerCase());
    const base = { name, color: spec.color, description: spec.description };
    if (found === undefined) return { ...base, status: "created" };
    if (matches(found, spec)) return { ...base, name: found.name, status: "ok" };
    return { ...base, name: found.name, status: update ? "updated" : "differs", found: { color: found.color, description: found.description } };
  });
}

/** The word of each status in the text output. */
const WORDS: Record<LabelStatus, string> = {
  created: "created",
  updated: "updated",
  ok: "ok",
  differs: "differs",
  "to-create": "to create",
  "to-update": "to update",
  failed: "failed",
};

/**
 * One line of the text output.
 * @param result - The label.
 * @returns The line.
 */
function line(result: LabelResult): string {
  const head = `${WORDS[result.status].padEnd(STATUS_WIDTH)}${result.name}`;
  if (result.error !== undefined) return `${head}: ${result.error}`;
  if (result.found === undefined) return head;
  const was = `${result.found.color} "${result.found.description}"`;
  const wanted = `${result.color} "${result.description}"`;
  return result.status === "differs" ? `${head}: has ${was}, the flow wants ${wanted} (--update fixes it)` : `${head}: ${was} → ${wanted}`;
}

/**
 * Writes one label and says how it went. A label that appeared in GitHub after the list
 * was read fails without `--update`, with a message that says to run it again.
 * @param repo - `owner/repo`.
 * @param result - The label, as planned.
 * @returns The label with its final status.
 */
async function write(repo: string, result: LabelResult): Promise<LabelResult> {
  try {
    await createLabel(repo, { name: result.name, color: result.color, description: result.description, force: result.status === "updated" });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const appeared = result.status === "created" && message.includes("already exists");
    return { ...result, status: "failed", error: appeared ? "it appeared in GitHub meanwhile: run labels sync again" : message };
  }
}

/**
 * Runs `labels sync`; see the file's header.
 * @param options - The repo, the labels and the flags.
 * @param out - Where to write.
 * @returns 0 when done; 1 if GitHub's list came back cut short (nothing is written then) or a write failed.
 * @throws GitHubError if GitHub fails to list the labels.
 * @example await labelsSync({ repo: "acme/widgets", labels, update: false, dryRun: true, json: false }, out)
 */
export async function labelsSync(options: LabelsSyncOptions, out: Output): Promise<number> {
  const { labels: existing, truncated } = await listLabels(options.repo);
  if (truncated) {
    out.stderr(`issue-flow: could not read every label of ${options.repo}; nothing written, so no label is made twice.\n`);
    return 1;
  }
  const results: LabelResult[] = [];
  for (const item of planLabels(options.labels, existing, options.update)) {
    const writes = item.status === "created" || item.status === "updated";
    // NOTE: one at a time, as GitHub asks of writes, to stay clear of its secondary rate limit.
    if (!writes) results.push(item);
    else if (options.dryRun) results.push({ ...item, status: item.status === "created" ? "to-create" : "to-update" });
    else results.push(await write(options.repo, item));
  }
  if (options.json) emitJson(out, { repo: options.repo, dryRun: options.dryRun, labels: results });
  else out.stdout(`${results.map(line).join("\n")}\n`);
  return results.some((result) => result.status === "failed") ? 1 : 0;
}
