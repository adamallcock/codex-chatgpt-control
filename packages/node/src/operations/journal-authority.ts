import type { OperationJournal } from "./journal.js";

/**
 * The journal authority owns durable state, process locks and its root key.
 * Local callers retain the existing synchronous cryptographic API; remote
 * authorities resolve the same bounded values asynchronously. Browser action
 * capabilities never cross this boundary.
 */
type AuthorityMethods = Pick<OperationJournal,
  "create" | "append" | "load" | "submitRequestDigest" |
  "controlRequestDigest" | "evidenceDigest" | "handleFromState" | "validateHandle"
>;

export type OperationJournalAuthority = {
  [Method in keyof AuthorityMethods]: (
    ...args: Parameters<AuthorityMethods[Method]>
  ) => ReturnType<AuthorityMethods[Method]> | Promise<Awaited<ReturnType<AuthorityMethods[Method]>>>;
};
