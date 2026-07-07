import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ClipboardReadCommand = {
  command: string;
  args: string[];
};

/**
 * Ordered clipboard-read command candidates for a platform. The first command that
 * succeeds wins; callers fall back to DOM extraction when none do. Linux ordering
 * prefers Wayland's wl-paste only when a Wayland session is detectable, otherwise the
 * X11 tools go first so plain X sessions do not pay a doomed wl-paste attempt.
 */
export function clipboardReadCommandsForPlatform(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined> = {}
): ClipboardReadCommand[] {
  if (platform === "darwin") {
    return [{ command: "pbpaste", args: [] }];
  }
  if (platform === "win32") {
    return [{ command: "powershell.exe", args: ["-NoProfile", "-Command", "Get-Clipboard -Raw"] }];
  }
  if (platform === "linux") {
    const waylandCommand: ClipboardReadCommand = { command: "wl-paste", args: ["--no-newline"] };
    const x11Commands: ClipboardReadCommand[] = [
      { command: "xclip", args: ["-selection", "clipboard", "-o"] },
      { command: "xsel", args: ["--clipboard", "--output"] }
    ];
    const isWayland = typeof env.WAYLAND_DISPLAY === "string" && env.WAYLAND_DISPLAY.length > 0;
    return isWayland ? [waylandCommand, ...x11Commands] : [...x11Commands, waylandCommand];
  }
  return [];
}

export async function readSystemClipboard(): Promise<string | undefined> {
  if (typeof process === "undefined") {
    return undefined;
  }

  for (const { command, args } of clipboardReadCommandsForPlatform(process.platform, process.env)) {
    try {
      const { stdout } = await execFileAsync(command, args, { timeout: 2000, maxBuffer: 10 * 1024 * 1024 });
      return stdout;
    } catch {
      // Missing tool or empty clipboard: try the next candidate.
    }
  }

  return undefined;
}

export async function waitForClipboardChange(
  before: string | undefined,
  timeoutMs: number,
  pollMs = 150
): Promise<string | undefined> {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const current = await readSystemClipboard();
    if (current !== undefined && current.length > 0 && current !== before) {
      return current;
    }

    await new Promise(resolve => setTimeout(resolve, pollMs));
  }

  return undefined;
}
