// `kvasir build <draft.json>` — deterministically assemble a review from a draft
// and push it to the mailbox. The model writes a draft (title + steps with
// repoDir/file/locator/body/detail); this resolves the verifiable parts via git —
// owner/name, head sha, file existence, real line numbers — so a wrong path or
// snippet fails LOUD here instead of 404-ing a blob link later. IO only; the pure
// resolution logic lives in ./reviewBuild. Returns the pushed walkthrough's link.

import { homedir } from "node:os";
import path from "node:path";
import { KVASIR_PORT } from "@kvasir/runes/port";
import type { Review } from "@kvasir/runes/review";
import { z } from "zod";
import { DraftSchema, type RepoContext, resolveStep, ReviewBuildError } from "./reviewBuild";

const expandHome = (input: string): string =>
  input.startsWith("~/") ? path.resolve(homedir(), input.slice(2)) : path.resolve(input);

function git(args: string[], cwd: string): string {
  const proc = Bun.spawnSync(["git", "-C", cwd, ...args]);
  if (proc.exitCode === 0) return proc.stdout.toString();
  throw new ReviewBuildError(`git ${args.join(" ")} failed in ${cwd}: ${proc.stderr.toString().trim()}`);
}

function repoContext(repoDirectory: string, file: string, stepNo: number): RepoContext {
  const directory = expandHome(repoDirectory);
  const remote = git(["remote", "get-url", "origin"], directory).trim();
  const sha = git(["rev-parse", "HEAD"], directory).trim();
  // The exact sha keeps line numbers matching the code that was read; it must be
  // on a remote, or GitHub has no such commit and the blob link 404s.
  const onRemote = git(["branch", "-r", "--contains", sha], directory).trim();
  if (onRemote === "") {
    throw new ReviewBuildError(
      `step ${stepNo}: commit ${sha.slice(0, 8)} (in ${directory}) is not pushed to any remote — push it so the blob link resolves`,
    );
  }
  const probe = Bun.spawnSync(["git", "-C", directory, "show", `${sha}:${file}`]);
  if (probe.exitCode === 0) return { remote, sha, content: probe.stdout.toString() };
  throw new ReviewBuildError(
    `step ${stepNo}: file not found at ${sha.slice(0, 8)}: ${file} (in ${directory})`,
  );
}

const PushResponse = z.object({ id: z.string(), url: z.string() });

/** Assemble the review from the draft at `draftPath` and push it. Returns the
 * `?kvasir=` link on success; throws ReviewBuildError (never process.exit) so the
 * entry can translate it to an exit code and tests can assert the message. */
export async function runBuild(draftPath: string | undefined): Promise<string> {
  if (!draftPath) throw new ReviewBuildError("usage: kvasir build <draft.json>");
  const raw: unknown = JSON.parse(await Bun.file(draftPath).text());
  const draft = DraftSchema.parse(raw); // throws a ZodError naming the bad field

  const review: Review = {
    version: 1,
    title: draft.title,
    ...(draft.source === undefined ? {} : { source: draft.source }),
    steps: draft.steps.map((step, index) =>
      resolveStep(step, repoContext(step.repoDir, step.file, index + 1), index),
    ),
  };

  let response: Response;
  try {
    response = await fetch(`http://localhost:${KVASIR_PORT}/push`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-kvasir": "1" },
      body: JSON.stringify(review),
    });
  } catch (error) {
    throw new ReviewBuildError(
      `cannot reach the mailbox on :${KVASIR_PORT} — is the kvasir channel running? (${String(error)})`,
    );
  }
  const responseText = await response.text();
  if (!response.ok) {
    throw new ReviewBuildError(`/push returned ${response.status}: ${responseText}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new ReviewBuildError(
      `/push returned non-JSON on ${response.status}: ${responseText.slice(0, 200)}`,
    );
  }
  return PushResponse.parse(parsed).url;
}
