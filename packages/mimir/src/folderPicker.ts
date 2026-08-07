/**
 * Native OS folder picker, spawned by the bridge (deterministic local code) ONLY when the
 * extension explicitly asks for it — never by the Claude model, never unprompted. Returns
 * the reviewer's chosen absolute path, or null when they cancel or no dialog tool is
 * available (headless / SSH), in which case the caller falls back to a typed path.
 *
 * Security: the command and its prompt are FIXED literals — nothing caller-, PR-, or
 * model-supplied reaches the argv, so there is no injection surface. The returned path is
 * still untrusted input; the caller validates it (checkoutPathSafe + isDir/isUsableClone)
 * exactly as a typed one. This module never touches the filesystem or git.
 *
 * The Bun.spawn glue is injected (PickerRunner) so the platform command + parse logic stay
 * unit-testable on node without popping a real dialog.
 */

/** A native folder-chooser invocation: the binary plus its fixed arguments. */
export interface PickerCommand {
  readonly command: string;
  readonly args: readonly string[];
}

/** Outcome of running a PickerCommand. `ok` is true only when the reviewer confirmed a
 * choice (zero exit); a cancel is a non-zero exit (ok:false). A MISSING tool never reaches
 * here — the runner rejects, and pickFolder catches that as "no dialog available". */
interface PickerResult {
  readonly ok: boolean;
  readonly stdout: string;
}

/** The native folder-chooser for a platform, or null where none is known (caller falls back
 * to a typed path). Every prompt/title/description is a fixed literal — no interpolation. */
export function folderPickerCommand(platform: NodeJS.Platform): PickerCommand | null {
  switch (platform) {
    case "darwin": {
      return {
        command: "osascript",
        args: ["-e", 'POSIX path of (choose folder with prompt "Select your local repositories folder")'],
      };
    }
    case "linux": {
      return {
        command: "zenity",
        args: ["--file-selection", "--directory", "--title=Select your local repositories folder"],
      };
    }
    case "win32": {
      return {
        command: "powershell",
        args: [
          "-NoProfile",
          "-Command",
          "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = 'Select your local repositories folder'; if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath }",
        ],
      };
    }
    default: {
      return null;
    }
  }
}

/** Injected spawn. Resolves ok:true + the chosen path on confirm, ok:false on a user cancel
 * (non-zero exit). A missing tool / spawn failure REJECTS — pickFolder catches that and
 * treats it as "no dialog available". */
export type PickerRunner = (command: string, args: readonly string[]) => Promise<PickerResult>;

/** Surface the native folder chooser and return the picked absolute path, or null when
 * cancelled / unavailable. Never throws — an absent tool or spawn error becomes null so the
 * caller falls back to a typed path. */
export async function pickFolder(
  run: PickerRunner,
  platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
  const picker = folderPickerCommand(platform);
  if (!picker) return null;
  let result: PickerResult;
  try {
    result = await run(picker.command, picker.args);
  } catch {
    return null;
  }
  if (!result.ok) return null;
  const chosen = result.stdout.trim();
  return chosen.length > 0 ? chosen : null;
}
