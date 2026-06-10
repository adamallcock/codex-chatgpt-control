import { describe, expect, it } from "vitest";
import { describeCommand } from "../../src/commands/registry.js";

describe("command registry descriptors", () => {
  it("shows the complete demo-safe askWithFiles surface", () => {
    const descriptor = describeCommand("askWithFiles");

    expect(descriptor?.args).toMatchObject({
      files: "absolute local file paths to attach before submitting",
      mode: "optional visible mode selection, e.g. { model: \"Pro\" } or { intelligence: \"Pro\", modelVersion: \"5.4\" }",
      existingTab: "true or explicit policy to claim a user-open Chrome tab instead of opening a replacement"
    });
    expect(descriptor?.examples.join("\n")).toContain("mode: { model: \"Pro\" }");
    expect(descriptor?.examples.join("\n")).toContain("files:");
  });

  it("shows the callable modes.set shape", () => {
    const descriptor = describeCommand("modes.set");

    expect(descriptor?.args).toMatchObject({
      effort: "visible legacy effort label such as Thinking or Extended",
      intelligence: "visible intelligence label such as Medium, High, Extra High, or Pro",
      model: "visible model label such as Pro, GPT-5.5, or another available model",
      modelVersion: "visible nested model version such as 5.5, 5.4, 4.5, or o3"
    });
    expect(descriptor?.examples.join("\n")).toContain("chatgpt.modes.set({ model: \"Pro\" })");
    expect(descriptor?.examples.join("\n")).toContain("chatgpt.modes.set({ intelligence: \"Pro\", modelVersion: \"5.4\" })");
    expect(descriptor?.examples.join("\n")).toContain("chatgpt.modes.set({ effort: \"Thinking\" })");
  });
});
