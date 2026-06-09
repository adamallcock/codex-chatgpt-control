import path from "node:path";

export type HostPathPlatform = NodeJS.Platform;

export function isHostAbsolutePath(value: string, platform: HostPathPlatform = process.platform): boolean {
  if (value.length === 0) return false;
  if (platform === "win32") return isFullyQualifiedWindowsPath(value);
  return path.posix.isAbsolute(value);
}

export function resolveForHostPath(value: string, platform: HostPathPlatform = process.platform): string {
  if (!isHostAbsolutePath(value, platform)) {
    throw new Error(`File attachment path must be absolute for the backend host: ${value}`);
  }
  return platform === "win32" ? path.win32.resolve(value) : path.posix.resolve(value);
}

export function basenameForHostPath(value: string, platform: HostPathPlatform = process.platform): string {
  return platform === "win32" ? path.win32.basename(value) : path.posix.basename(value);
}

function isFullyQualifiedWindowsPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\]+\\[^\\]+[\\/]/.test(value);
}
