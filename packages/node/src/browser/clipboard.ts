import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function readSystemClipboard(): Promise<string | undefined> {
  if (typeof process === "undefined") {
    return undefined;
  }

  if (process.platform === "win32") {
    return readWindowsClipboard();
  }

  if (process.platform !== "darwin") {
    return undefined;
  }

  try {
    const { stdout } = await execFileAsync("pbpaste", [], { timeout: 2000, maxBuffer: 10 * 1024 * 1024 });
    return stdout;
  } catch {
    return undefined;
  }
}

async function readWindowsClipboard(): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-Command",
      "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-Clipboard -Raw"
    ], { timeout: 2000, maxBuffer: 10 * 1024 * 1024, encoding: "utf8" });
    return stdout.length > 0 ? stdout.replace(/\r\n$/, "\n") : undefined;
  } catch {
    return undefined;
  }
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
