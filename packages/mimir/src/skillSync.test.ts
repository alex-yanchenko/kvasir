import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runSkillSync, SKILL_NAME, syncDecision } from "./skillSync";

describe("syncDecision", () => {
  it("leaves an uninstalled skill alone (sync never creates)", () => {
    expect(syncDecision(null, "content")).toBe("absent");
  });

  it("skips an up-to-date skill", () => {
    expect(syncDecision("same", "same")).toBe("current");
  });

  it("rewrites a drifted skill", () => {
    expect(syncDecision("old", "new")).toBe("write");
  });
});

describe("runSkillSync", () => {
  let skillsDir: string;

  beforeEach(() => {
    skillsDir = mkdtempSync(path.join(tmpdir(), "kvasir-skill-"));
  });

  afterEach(() => {
    rmSync(skillsDir, { recursive: true, force: true });
  });

  const target = (): string => path.join(skillsDir, SKILL_NAME, "SKILL.md");

  it("install writes the skill when absent", () => {
    expect(runSkillSync({ skillsDir, embedded: "CONTENT", mode: "install", env: {} })).toEqual({
      action: "installed",
      message: `installed ${SKILL_NAME} skill → ${target()}`,
    });
    expect(readFileSync(target(), "utf8")).toBe("CONTENT");
  });

  it("install overwrites an existing skill", () => {
    mkdirSync(path.dirname(target()), { recursive: true });
    writeFileSync(target(), "OLD");
    expect(runSkillSync({ skillsDir, embedded: "NEW", mode: "install", env: {} })).toEqual({
      action: "installed",
      message: `installed ${SKILL_NAME} skill → ${target()}`,
    });
    expect(readFileSync(target(), "utf8")).toBe("NEW");
  });

  it("install ignores the sync opt-out", () => {
    expect(
      runSkillSync({ skillsDir, embedded: "X", mode: "install", env: { KVASIR_SKILL_SYNC: "0" } }),
    ).toEqual({ action: "installed", message: `installed ${SKILL_NAME} skill → ${target()}` });
  });

  it("sync leaves an uninstalled skill untouched", () => {
    expect(runSkillSync({ skillsDir, embedded: "CONTENT", mode: "sync", env: {} })).toEqual({
      action: "absent",
      message: `${SKILL_NAME} skill not installed — run 'kvasir skill install'`,
    });
    expect(existsSync(target())).toBe(false);
  });

  it("sync is a no-op when already current", () => {
    mkdirSync(path.dirname(target()), { recursive: true });
    writeFileSync(target(), "SAME");
    expect(runSkillSync({ skillsDir, embedded: "SAME", mode: "sync", env: {} })).toEqual({
      action: "up-to-date",
      message: `${SKILL_NAME} skill up to date`,
    });
  });

  it("sync refreshes a drifted installed skill", () => {
    mkdirSync(path.dirname(target()), { recursive: true });
    writeFileSync(target(), "OLD");
    expect(runSkillSync({ skillsDir, embedded: "NEW", mode: "sync", env: {} })).toEqual({
      action: "updated",
      message: `refreshed ${SKILL_NAME} skill → ${target()}`,
    });
    expect(readFileSync(target(), "utf8")).toBe("NEW");
  });

  it("sync opts out on KVASIR_SKILL_SYNC=0 and never touches a drifted file", () => {
    mkdirSync(path.dirname(target()), { recursive: true });
    writeFileSync(target(), "OLD");
    expect(
      runSkillSync({ skillsDir, embedded: "NEW", mode: "sync", env: { KVASIR_SKILL_SYNC: "0" } }),
    ).toEqual({ action: "opted-out", message: "skill sync skipped (KVASIR_SKILL_SYNC=0)" });
    expect(readFileSync(target(), "utf8")).toBe("OLD");
  });

  it("returns a failure result (never throws) when the target cannot be written", () => {
    // Use a plain file as the skills dir so mkdir of <file>/kvasir fails (ENOTDIR).
    const notADirectory = path.join(skillsDir, "not-a-dir");
    writeFileSync(notADirectory, "x");
    const result = runSkillSync({ skillsDir: notADirectory, embedded: "X", mode: "install", env: {} });
    expect(result.action).toBe("failed");
    expect(result.message).toContain("skill install failed");
  });
});
