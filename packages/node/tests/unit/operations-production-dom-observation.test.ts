import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { PageLike } from "../../src/types.js";
import { inspectComposerText } from "../../src/dom/composer-text.js";
import { createProductionOperationPrimitives } from "../../src/operations/production-primitives.js";
import { createChatGPTAttachmentProvider } from "../../src/operations/production-chatgpt-attachments.js";
import type { OperationTargetBindingV1 } from "../../src/operations/types.js";
import type { SubmissionAttachmentRequest } from "../../src/operations/submission.js";
import { DomNode, element } from "../helpers/dom-tree.js";

const operationId = "11111111-1111-4111-8111-111111111111";
const digest = (domain: string, material: unknown): string =>
  `hmac-sha256:${createHash("sha256").update(`${domain}:${JSON.stringify(material)}`).digest("hex")}`;
const requestDigest = digest("request", "fixture");
const targetBindingDigest = digest("target", "fixture");
const target: OperationTargetBindingV1 = {
  providerId: "chatgpt", browserId: "chrome", tabId: "tab-1", coordinationScope: "process",
  evidenceProfile: {
    providerIdentity: "required", stableTabId: "required", stableConversationId: "unavailable",
    stableUserTurnId: "unavailable", authoritativeTabClaim: "unavailable", replacementTabRecovery: false
  }
};
const attachmentRequest: SubmissionAttachmentRequest = {
  operationId, requestDigest, targetBindingDigest, surface: "chat",
  manifest: { count: 0, identities: [], orderPolicy: "exact" }
};

function fileInput(attributes: Record<string, string> = {}, value: unknown = "", files?: unknown): DomNode {
  const input = element("input", { type: "file", ...attributes });
  input.value = value;
  input.files = files;
  return input;
}

function domPage(composer: DomNode, ...extraNodes: DomNode[]): PageLike {
  const document = new DomNode("#document", {}, [element("form", {}, composer, ...extraNodes)]);
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", { getComputedStyle: (node: DomNode) => node.style });
  return {
    evaluate: async (fn, argument) => fn(argument!),
    getByRole: () => ({
      count: async () => 1, isVisible: async () => true,
      evaluate: async fn => fn(composer as unknown as Element)
    })
  };
}

async function attachmentStatuses(page: PageLike): Promise<string[]> {
  const base = createProductionOperationPrimitives({ evidenceDigest: digest, operationId, requestDigest });
  const identityDigest = digest("identity", "fixture");
  const provider = createChatGPTAttachmentProvider({
    evidenceDigest: digest, files: [{ sourcePath: "/private/tmp/fixture.txt",
      manifest: { displayName: "fixture.txt", bytes: 4, contentSha256: "a".repeat(64) },
      proof: { device: "1", inode: "2", size: "4", modifiedNs: "3", changedNs: "4" }
    }], identityDigest: () => identityDigest,
    revalidateFile: async () => undefined
  });
  return [
    (await base.submission!.observeAttachments!(attachmentRequest, page, target)).status,
    (await provider.observeAttachments({ ...attachmentRequest,
      manifest: { count: 1, orderPolicy: "exact", identities: [{ identityDigest, ordinal: 0 }] }
    }, page, target)).status
  ];
}

afterEach(() => vi.unstubAllGlobals());

describe("production attachment evaluators against linked composer DOM", () => {
  it("proves the live empty FileList bridge variant without treating upload controls or icons as files", async () => {
    const page = domPage(element("div", { contenteditable: "true" }), fileInput(),
      element("button", { "aria-label": "Add files and more", "aria-haspopup": "menu" },
        element("span", { class: "file-icon" }, "Add files")));
    expect(await attachmentStatuses(page)).toEqual(["absent", "absent"]);
  });

  it.each([
    ["nonempty redacted value", "C:\\fakepath\\fixture.txt"],
    ["unavailable value", undefined]
  ])("does not invent emptiness from an unavailable FileList and %s", async (_label, value) => {
    const page = domPage(element("div", { contenteditable: "true" }), fileInput({}, value));
    // Do not let the helper's optional default replace deliberately unavailable evidence.
    (globalThis.document as unknown as DomNode).firstChild!.firstChild!.nextSibling!.value = value;
    expect((await attachmentStatuses(page)).every(status => status !== "absent")).toBe(true);
  });

  it("accepts a unique general input alongside a proven-empty image input", async () => {
    const page = domPage(element("div", { contenteditable: "true" }),
      fileInput({ id: "upload-files" }), fileInput({ accept: "image/*" }));
    expect(await attachmentStatuses(page)).toEqual(["absent", "absent"]);
  });

  it("shares localized opener labels between empty checks and the attachment provider", async () => {
    const page = domPage(element("div", { contenteditable: "true" }), fileInput(),
      element("button", { class: "file-upload", "aria-label": "Añadir fotos y archivos" }));
    expect(await attachmentStatuses(page)).toEqual(["absent", "absent"]);
  });

  it.each([
    { length: undefined }, { length: -1 }, { length: Number.NaN }, { length: 1, item: () => null }
  ])("rejects malformed or incomplete FileList evidence", async files => {
    const page = domPage(element("div", { contenteditable: "true" }), fileInput({}, "", files));
    expect((await attachmentStatuses(page)).every(status => status !== "absent")).toBe(true);
  });

  it.each(["nonempty", "unreadable", "disabled-nonempty"])("blocks a %s alternate image input", async kind => {
    const image = fileInput({ accept: "image/*" }, kind === "unreadable" ? "" : "C:\\fakepath\\image.png");
    if (kind === "unreadable") image.value = undefined;
    if (kind === "disabled-nonempty") image.disabled = true;
    const page = domPage(element("div", { contenteditable: "true" }), fileInput({ id: "upload-files" }), image);
    expect((await attachmentStatuses(page)).every(status => status !== "absent")).toBe(true);
  });

  it.each([
    element("div", { "data-testid": "attachment-chip" }, "fixture.txt"),
    element("button", { "data-file-name": "fixture.txt" }, "fixture.txt"),
    element("button", { "aria-label": "Remove file" }),
    element("div", { role: "progressbar" }),
    element("button", { "aria-label": "Add files" }, element("div", { role: "progressbar" }))
  ])("does not report an empty manifest when a tile, removal control, or pending upload exists", async evidence => {
    const page = domPage(element("div", { contenteditable: "true" }), fileInput(), evidence);
    expect((await attachmentStatuses(page)).every(status => status !== "absent")).toBe(true);
  });

  it("rejects duplicate general inputs and selected files even without tile metadata", async () => {
    const composer = element("div", { contenteditable: "true" });
    expect((await attachmentStatuses(domPage(composer, fileInput(), fileInput()))).every(status => status !== "absent")).toBe(true);
    const files = { length: 1, item: () => ({ name: "fixture.txt", size: 4 }) };
    expect((await attachmentStatuses(domPage(composer, fileInput({}, "C:\\fakepath\\fixture.txt", files))))
      .every(status => status !== "absent")).toBe(true);
  });

  it("fails closed when the composer traversal exceeds its node budget", async () => {
    const nodes = Array.from({ length: 4096 }, () => element("span"));
    const page = domPage(element("div", { contenteditable: "true" }), fileInput(), ...nodes);
    expect((await attachmentStatuses(page)).every(status => status !== "absent")).toBe(true);
  });
});

describe("production composer text evaluator", () => {
  const cases: Array<[string, DomNode, string]> = [
    ["paragraphs", element("div", {}, element("p", {}, "first"), element("p", {}, "second")), "first\nsecond"],
    ["nested native blocks", element("div", {}, "first", element("div", {}, "second")), "first\nsecond"],
    ["blank and trailing paragraphs", element("div", {}, element("p", {}, "first"), element("p", {}, element("br")), element("p", {}, "second"), element("p", {}, element("br"))), "first\n\nsecond\n"],
    ["leading and consecutive blank blocks", element("div", {}, element("div", {}, element("br")), element("div", {}, element("br")), element("div", {}, "last")), "\n\nlast"],
    ["hard breaks", element("div", {}, element("p", {}, "first", element("br"), "second")), "first\nsecond"],
    ["real trailing hard break and editor caret sentinel", element("div", {}, element("p", {}, "first", element("br"), element("br", { class: "ProseMirror-trailingBreak" }))), "first\n"],
    ["empty composer", element("div", {}, element("p", {}, element("br", { class: "ProseMirror-trailingBreak" }))), ""],
    ["inline formatting", element("div", {}, element("p", {}, element("strong", {}, "first"), " second")), "first second"]
  ];

  it.each(cases)("preserves %s in the actual staging callback", async (_name, composer, prompt) => {
    composer.value = ""; // Chrome's synthetic contenteditable value is not authoritative.
    const page = domPage(composer);
    const primitives = createProductionOperationPrimitives({ evidenceDigest: digest, operationId, requestDigest, desiredComposerText: prompt });
    const result = await primitives.staging!.readCurrent!({
      operationId, requestDigest, targetBindingDigest, page, target, kind: "composer_set",
      actionId: "22222222-2222-4222-8222-222222222222", desiredStateDigest: digest("staging-desired", { requestDigest, kind: "composer_set" }),
      signal: new AbortController().signal, deadlineAt: Date.now() + 10_000
    });
    expect(result.status).toBe("satisfied");
    expect(inspectComposerText(composer as unknown as Element)).toBe(prompt);
  });

  it("uses the native textarea value and preserves whitespace", () => {
    const textarea = element("textarea", {}, "stale child text");
    textarea.value = " first\n\nsecond\n";
    expect(inspectComposerText(textarea as unknown as Element)).toBe(textarea.value);
  });

  it("keeps real text drift distinct from matching paragraph boundaries", async () => {
    const composer = element("div", {}, element("p", {}, "firstsecond"));
    const primitives = createProductionOperationPrimitives({ evidenceDigest: digest, operationId, requestDigest, desiredComposerText: "first\nsecond" });
    const result = await primitives.staging!.readCurrent!({
      operationId, requestDigest, targetBindingDigest, page: domPage(composer), target, kind: "composer_set",
      actionId: "22222222-2222-4222-8222-222222222222", desiredStateDigest: digest("staging-desired", { requestDigest, kind: "composer_set" }),
      signal: new AbortController().signal, deadlineAt: Date.now() + 10_000
    });
    expect(result.status).toBe("not_satisfied");
  });

  it("bounds text volume, node volume, and malformed cyclic trees before serialization", () => {
    const large = element("div", {}, "x".repeat(8 * 1024 * 1024 + 1));
    expect(inspectComposerText(large as unknown as Element)).toBeUndefined();
    const many = element("div", {}, ...Array.from({ length: 4096 }, () => element("span")));
    expect(inspectComposerText(many as unknown as Element)).toBeUndefined();
    const cyclic = element("div");
    cyclic.firstChild = cyclic;
    expect(inspectComposerText(cyclic as unknown as Element)).toBeUndefined();
  });
});
