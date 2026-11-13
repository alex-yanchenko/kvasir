import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "@playwright/test";
import { captureKvasirOnPullRequest } from "./capture";
import { composeImages } from "./compose";

const imagesDir = path.resolve(import.meta.dirname, "../docs/images");
const stagingDir = `${imagesDir}.next`;

async function replaceImagesWithStagedSet(): Promise<void> {
  await rm(imagesDir, { recursive: true, force: true });
  await rename(stagingDir, imagesDir);
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
