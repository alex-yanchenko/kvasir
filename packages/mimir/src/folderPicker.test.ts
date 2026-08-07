import { describe, it, expect, vi } from "vitest";
import { folderPickerCommand, pickFolder, type PickerRunner } from "./folderPicker";

describe("folderPickerCommand", () => {
  it("uses osascript on macOS with a fixed prompt", () => {
    expect(folderPickerCommand("darwin")).toEqual({
      command: "osascript",
      args: ["-e", 'POSIX path of (choose folder with prompt "Select your local repositories folder")'],
    });
  });

  it("uses zenity on Linux", () => {
    expect(folderPickerCommand("linux")).toEqual({
      command: "zenity",
      args: ["--file-selection", "--directory", "--title=Select your local repositories folder"],
    });
  });

  it("uses PowerShell's FolderBrowserDialog on Windows", () => {
    expect(folderPickerCommand("win32")).toEqual({
      command: "powershell",
      args: [
        "-NoProfile",
        "-Command",
        "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = 'Select your local repositories folder'; if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath }",
      ],
    });
  });

  it("returns null on a platform with no known dialog", () => {
    expect(folderPickerCommand("aix")).toBeNull();
  });
});

describe("pickFolder", () => {
  it("returns the trimmed chosen path on success", async () => {
    const run: PickerRunner = vi.fn().mockResolvedValue({ ok: true, stdout: "/Users/me/code\n" });
    expect(await pickFolder(run, "darwin")).toBe("/Users/me/code");
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith("osascript", [
      "-e",
      'POSIX path of (choose folder with prompt "Select your local repositories folder")',
    ]);
  });

  it("returns null when the reviewer cancels (non-zero exit)", async () => {
    const run: PickerRunner = vi.fn().mockResolvedValue({ ok: false, stdout: "" });
    expect(await pickFolder(run, "darwin")).toBeNull();
  });

  it("returns null when the dialog tool is missing (spawn throws) — falls back to typing", async () => {
    const run: PickerRunner = vi.fn().mockRejectedValue(new Error("spawn zenity ENOENT"));
    expect(await pickFolder(run, "linux")).toBeNull();
  });

  it("returns null on empty output", async () => {
    const run: PickerRunner = vi.fn().mockResolvedValue({ ok: true, stdout: "   \n" });
    expect(await pickFolder(run, "darwin")).toBeNull();
  });

  it("returns null without spawning on an unsupported platform", async () => {
    const run: PickerRunner = vi.fn();
    expect(await pickFolder(run, "aix")).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });
});
