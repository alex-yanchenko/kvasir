import { execFileSync } from "node:child_process";
import path from "node:path";
import { assertKvasirPortFree } from "./port";

export default async function buildExtensionWhenPortIsFree(): Promise<void> {
  await assertKvasirPortFree();
  execFileSync("pnpm", ["build"], { cwd: path.resolve(import.meta.dirname, ".."), stdio: "inherit" });
}
