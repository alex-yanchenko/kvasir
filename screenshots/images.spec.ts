import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "@playwright/test";
import { captureKvasirOnPullRequest } from "./capture";
import { composeImages } from "./compose";

const imagesDir = path.resolve(import.meta.dirname, "../docs/images");
const stagingDir = `${imagesDir}.next`;
const previousDir = `${imagesDir}.previous`;

async function replaceImagesWithStagedSet(): Promise<void> {
  await rm(previousDir, { recursive: true, force: true });
  await rename(imagesDir, previousDir).catch((error: unknown) => {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  });
  try {
    await rename(stagingDir, imagesDir);
  } catch (error) {
    await rename(previousDir, imagesDir);
    throw new Error("The new images could not replace docs/images; the old set is back in place.", {
      cause: error,
    });
  }
  await rm(previousDir, { recursive: true, force: true });
}

test("store screenshots, README hero and social preview", async () => {
  const rawDir = await mkdtemp(path.join(tmpdir(), "kvasir-captures-"));
  await rm(stagingDir, { recursive: true, force: true });
  await mkdir(stagingDir, { recursive: true });
  try {
    const captures = await captureKvasirOnPullRequest(rawDir);
    const written = await composeImages(captures, stagingDir);
    await replaceImagesWithStagedSet();
    console.log(`wrote ${written.length} images to ${path.relative(process.cwd(), imagesDir)}`);
  } finally {
    await rm(rawDir, { recursive: true, force: true });
    await rm(stagingDir, { recursive: true, force: true });
  }
});
