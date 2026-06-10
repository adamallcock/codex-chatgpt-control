import path from "node:path";

export type HostPathPlatform = NodeJS.Platform | "browser" | "unknown";

export function isHostAbsolutePath(value: string, platform: HostPathPlatform = currentHostPathPlatform()): boolean {
  if (value.length === 0) return false;
  if (usesWindowsPathSemantics(value, platform)) return isFullyQualifiedWindowsPath(value);
  return path.posix.isAbsolute(value);
}

export function resolveForHostPath(value: string, platform: HostPathPlatform = currentHostPathPlatform()): string {
  if (!isHostAbsolutePath(value, platform)) {
    throw new Error(`File attachment path must be absolute for the backend host: ${value}`);
  }
  return usesWindowsPathSemantics(value, platform) ? path.win32.resolve(value) : path.posix.resolve(value);
}

export function basenameForHostPath(value: string, platform: HostPathPlatform = currentHostPathPlatform()): string {
  return usesWindowsPathSemantics(value, platform) ? path.win32.basename(value) : path.posix.basename(value);
}

function isFullyQualifiedWindowsPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\[^\\]+\\[^\\]+[\\/]/.test(value);
}

function currentHostPathPlatform(): HostPathPlatform {
  const candidate = globalThis.process?.platform;
  return typeof candidate === "string" ? candidate as HostPathPlatform : "unknown";
}

function usesWindowsPathSemantics(value: string, platform: HostPathPlatform): boolean {
  if (platform === "win32") return true;
  if (platform === "linux" || platform === "darwin" || platform === "freebsd" || platform === "openbsd" || platform === "aix" || platform === "sunos") return false;
  return isFullyQualifiedWindowsPath(value);
}
