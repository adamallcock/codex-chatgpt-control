import { existsSync } from "node:fs";
import { posix, win32 } from "node:path";
import process from "node:process";

/**
 * Resolve npm without asking Node to execute a Windows .cmd shim directly.
 * Node 24 rejects that spawn shape with EINVAL when shell execution is off.
 */
export function npmInvocation(args, options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const execPath = options.execPath ?? process.execPath;
  const pathExists = options.existsSync ?? existsSync;
  const pathApi = platform === "win32" ? win32 : posix;
  const candidates = [
    env.npm_execpath,
    pathApi.join(pathApi.dirname(execPath), "node_modules", "npm", "bin", "npm-cli.js")
  ];
  const npmCli = candidates.find(candidate =>
    typeof candidate === "string" && candidate.length > 0 && pathExists(candidate)
  );

  if (npmCli !== undefined) {
    return { program: execPath, args: [npmCli, ...args] };
  }
  if (platform === "win32") {
    throw new Error(
      "Unable to locate npm-cli.js. Run this command through npm or set npm_execpath."
    );
  }
  return { program: "npm", args: [...args] };
}
