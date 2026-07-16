#!/usr/bin/env bun
// Contributor convenience: run the walkthrough build flow straight from source
// (`bun run scripts/buildReview.ts <draft.json>`) without compiling the binary.
// The installed `kvasir build` uses the same runBuild via the compiled entry.
import { runBuild } from "../src/runBuild";

try {
  console.log(await runBuild(process.argv[2]));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
