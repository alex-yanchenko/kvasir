#!/usr/bin/env bun
/**
 * Deterministically assemble a review from a draft and push it to the mailbox.
 * The model writes a draft (title + steps with repoDir/file/locator/body/detail);
 * this resolves the verifiable parts via git — owner/name, head sha, file
 * existence, real line numbers — so a wrong path or snippet fails LOUD here
 * instead of 404-ing a blob link later. IO only; the pure logic is in
 * src/review-build.ts.
 *
 *   kvasir build <draft.json>   →  prints the ?kvasir= link on success
 */
import { homedir } from "node:os";
import path from "node:path";
import { KVASIR_PORT } from "@kvasir/runes/port";
import { type Review } from "@kvasir/runes/review";
import { z } from "zod";
import { DraftSchema, type RepoContext, resolveStep, ReviewBuildError } from "../src/reviewBuild";

const PORT = KVASIR_PORT;

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

async function main(): Promise<void> {
  const draftPath = process.argv[2];
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
    response = await fetch(`http://localhost:${PORT}/push`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-kvasir": "1" },
      body: JSON.stringify(review),
    });
  } catch (error) {
    throw new ReviewBuildError(
      `cannot reach the mailbox on :${PORT} — is the kvasir channel running? (${String(error)})`,
    );
  }
  const text = await response.text();
  if (response.ok) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new ReviewBuildError(`/push returned non-JSON on ${response.status}: ${text.slice(0, 200)}`);
    }
    console.log(PushResponse.parse(parsed).url);
    return;
  }
  throw new ReviewBuildError(`/push returned ${response.status}: ${text}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
