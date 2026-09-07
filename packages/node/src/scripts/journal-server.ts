#!/usr/bin/env node
import { startJournalRpcServer } from "../operations/journal-rpc-server.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let stateRoot: string | undefined;
  let directory: string | undefined;
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (value === undefined || (option !== "--state-root" && option !== "--directory")) throw new Error();
    if (option === "--state-root") {
      if (stateRoot !== undefined) throw new Error();
      stateRoot = value;
    } else {
      if (directory !== undefined) throw new Error();
      directory = value;
    }
  }
  if (stateRoot === undefined || directory === undefined) throw new Error();
  const server = await startJournalRpcServer({ stateRoot, directory });
  // The private descriptor contains authentication material. It is never printed.
  process.stdout.write(`${JSON.stringify({ status: "ready", transport: "file" })}\n`);
  const stop = () => {
    void server.close().then(() => { process.exitCode = 0; }, () => { process.exitCode = 2; });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

void main().catch(() => {
  process.stderr.write("Journal authority startup failed. Supply absolute --state-root and a new private --directory.\n");
  process.exitCode = 2;
});
