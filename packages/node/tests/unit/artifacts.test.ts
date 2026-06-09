import { readFile, stat, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { downloadLatestArtifact, listLatestArtifacts, waitForArtifact } from "../../src/commands/artifacts.js";
import { readLatest } from "../../src/commands/messages.js";
import type { PageLike } from "../../src/types.js";

describe("generated image artifacts", () => {
  it("detects a visible image artifact without treating it as assistant text", async () => {
    const html = readFileSync("tests/fixtures/chat-generated-image-artifact.html", "utf8");
    const page = fixturePage(html);

    const artifact = await listLatestArtifacts({ page }, {});
    const latestText = await readLatest({ page }, { format: "all" });

    expect(artifact.ok).toBe(true);
    expect(artifact.data?.count).toBe(1);
    expect(artifact.data?.latest).toMatchObject({
      kind: "image",
      index: 0,
      alt: "Generated image of a golden dog on grass",
      width: 1024,
      height: 1024,
      downloadAvailable: true,
      selectorProvenance: "main generated image"
    });
    expect(latestText.ok).toBe(false);
    expect(latestText.status).toBe("not_found");
  });

  it("waits for an image artifact even when assistant turn count stays zero", async () => {
    const empty = "<main><div data-message-author-role='user'>Create an image.</div></main>";
    const generated = readFileSync("tests/fixtures/chat-generated-image-artifact.html", "utf8");
    let reads = 0;
    const page: PageLike = {
      content: async () => {
        reads += 1;
        return reads < 2 ? empty : generated;
      },
      waitForTimeout: async () => {},
      title: async () => "Image Request",
      url: () => "https://chatgpt.com/c/mock"
    };

    const result = await waitForArtifact({ page }, {
      afterArtifactCount: 0,
      requireDownload: true,
      timeoutMs: 100,
      stableMs: 0,
      pollMs: 1
    });

    expect(result.ok).toBe(true);
    expect(result.data?.complete).toBe(true);
    expect(result.data?.count).toBe(1);
    expect(result.context.assistantTurnCount).toBe(0);
  });

  it("can save the latest visible image data URL when no browser download event fires", async () => {
    const destDir = await mkdtemp(join(tmpdir(), "chatgpt-control-artifact-download-"));
    const html = readFileSync("tests/fixtures/chat-generated-image-artifact.html", "utf8");
    const page = fixturePage(html);

    const result = await downloadLatestArtifact({ page }, {
      destDir,
      prefer: "visible_image_source",
      timeoutMs: 100
    });

    expect(result.ok).toBe(true);
    expect(result.data?.suggestedFilename).toMatch(/^generated-image-\d+\.png$/);
    expect(result.data?.bytes).toBeGreaterThan(0);
    await expect(stat(result.data?.path ?? "")).resolves.toBeTruthy();
    await expect(readFile(result.data?.path ?? "", "utf8")).resolves.toBe("image-bytes");
  });

  it("classifies a stalled artifact DOM probe when no content fallback is available", async () => {
    const page: PageLike = {
      evaluate: async () => new Promise(() => {}),
      title: async () => "Image Request",
      url: () => "https://chatgpt.com/c/mock"
    };

    const result = await listLatestArtifacts({ page }, { kind: "image", timeoutMs: 20 });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("blocked");
    expect(result.blocker).toMatchObject({
      kind: "artifact_selector_drift",
      code: "artifact_dom_timeout"
    });
  });

  it("saves the latest raster image from the pageAssets bridge capability", async () => {
    const destDir = await mkdtemp(join(tmpdir(), "chatgpt-control-page-assets-download-"));
    const sourceDir = await mkdtemp(join(tmpdir(), "chatgpt-control-page-assets-source-"));
    const sourcePath = join(sourceDir, "asset");
    await writeFile(sourcePath, "page-asset-bytes");
    const page = pageWithAssets(sourcePath);

    const result = await downloadLatestArtifact({ page }, {
      destDir,
      prefer: "visible_image_source",
      timeoutMs: 100
    });

    expect(result.ok).toBe(true);
    expect(result.data?.suggestedFilename).toMatch(/^generated-image-\d+\.png$/);
    await expect(readFile(result.data?.path ?? "", "utf8")).resolves.toBe("page-asset-bytes");
  });

  it("lists generated image artifacts from pageAssets when DOM detection returns none", async () => {
    const page = pageWithAssets("/tmp/not-used");

    const result = await listLatestArtifacts({ page }, { kind: "image", timeoutMs: 100 });

    expect(result.ok).toBe(true);
    expect(result.data?.latest).toMatchObject({
      kind: "image",
      downloadAvailable: true,
      selectorProvenance: "pageAssets image inventory"
    });
    expect(result.data?.latest?.src).toBeUndefined();
  });

  it("reopens a stalled ChatGPT conversation in a bridge-owned tab for pageAssets export", async () => {
    const destDir = await mkdtemp(join(tmpdir(), "chatgpt-control-fresh-tab-download-"));
    const sourceDir = await mkdtemp(join(tmpdir(), "chatgpt-control-fresh-tab-source-"));
    const sourcePath = join(sourceDir, "asset");
    await writeFile(sourcePath, "fresh-tab-asset-bytes");
    const conversationUrl = "https://chatgpt.com/c/mock-image-thread";
    const stalledPage: PageLike = {
      content: async () => "<main></main>",
      title: async () => "Image Request",
      url: () => conversationUrl
    };
    const freshPage = pageWithAssets(sourcePath, conversationUrl);
    let openedUrl: string | undefined;
    let closed = false;
    freshPage.goto = async url => {
      openedUrl = String(url);
    };
    freshPage.close = async () => {
      closed = true;
    };

    const result = await downloadLatestArtifact({
      page: stalledPage,
      browser: {
        tabs: {
          new: async () => freshPage
        }
      }
    }, {
      destDir,
      prefer: "visible_image_source",
      timeoutMs: 100
    });

    expect(result.ok).toBe(true);
    expect(openedUrl).toBe(conversationUrl);
    expect(closed).toBe(true);
    await expect(readFile(result.data?.path ?? "", "utf8")).resolves.toBe("fresh-tab-asset-bytes");
  });

  it("lists generated image artifacts from a fresh bridge-owned tab when DOM inspection stalls", async () => {
    const conversationUrl = "https://chatgpt.com/c/mock-image-thread";
    const stalledPage: PageLike = {
      evaluate: async () => new Promise(() => {}),
      title: async () => "Image Request",
      url: () => conversationUrl
    };
    const freshPage = pageWithAssets("/tmp/not-used", conversationUrl);
    let closed = false;
    freshPage.close = async () => {
      closed = true;
    };

    const result = await listLatestArtifacts({
      page: stalledPage,
      browser: {
        tabs: {
          new: async () => freshPage
        }
      }
    }, {
      kind: "image",
      timeoutMs: 20
    });

    expect(result.ok).toBe(true);
    expect(result.data?.latest).toMatchObject({
      kind: "image",
      downloadAvailable: true,
      selectorProvenance: "pageAssets image inventory"
    });
    expect(result.data?.latest?.src).toBeUndefined();
    expect(closed).toBe(true);
  });
});

function fixturePage(html: string): PageLike {
  return {
    content: async () => html,
    title: async () => "Image Request",
    url: () => "https://chatgpt.com/c/mock"
  };
}

function pageWithAssets(sourcePath: string, url = "https://chatgpt.com/c/mock"): PageLike {
  return {
    content: async () => "<main></main>",
    title: async () => "Image Request",
    url: () => url,
    playwright: {
      waitForTimeout: async () => {}
    },
    capabilities: {
      get: async id => {
        if (id !== "pageAssets") return undefined;
        return {
          list: async () => ({
            id: "inventory-1",
            assets: [
              {
                id: "asset-1",
                kind: "image",
                name: "content",
                url: "https://chatgpt.com/backend-api/estuary/content?id=file_mock"
              }
            ]
          }),
          bundle: async () => ({
            assets: [
              {
                contentType: "image/png",
                id: "asset-1",
                kind: "image",
                name: "content",
                path: sourcePath,
                url: "https://chatgpt.com/backend-api/estuary/content?id=file_mock"
              }
            ]
          })
        };
      }
    }
  };
}
