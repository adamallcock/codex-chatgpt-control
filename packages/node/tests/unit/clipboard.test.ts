import { describe, expect, it } from "vitest";
import { clipboardReadCommandsForPlatform } from "../../src/browser/clipboard.js";

describe("clipboard read command selection", () => {
  it("uses pbpaste on macOS", () => {
    expect(clipboardReadCommandsForPlatform("darwin")).toEqual([
      { command: "pbpaste", args: [] }
    ]);
  });

  it("uses PowerShell Get-Clipboard on Windows", () => {
    expect(clipboardReadCommandsForPlatform("win32")).toEqual([
      { command: "powershell.exe", args: ["-NoProfile", "-Command", "Get-Clipboard -Raw"] }
    ]);
  });

  it("prefers X11 tools on Linux without a Wayland session", () => {
    expect(clipboardReadCommandsForPlatform("linux", {}).map(entry => entry.command)).toEqual([
      "xclip",
      "xsel",
      "wl-paste"
    ]);
  });

  it("prefers wl-paste on Linux under Wayland", () => {
    expect(clipboardReadCommandsForPlatform("linux", { WAYLAND_DISPLAY: "wayland-0" }).map(entry => entry.command)).toEqual([
      "wl-paste",
      "xclip",
      "xsel"
    ]);
  });

  it("returns no candidates on unsupported platforms", () => {
    expect(clipboardReadCommandsForPlatform("freebsd")).toEqual([]);
  });
});
