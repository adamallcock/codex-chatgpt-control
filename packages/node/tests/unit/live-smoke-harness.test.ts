import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { filterScenarios, requiredFailures, runScenario, writeReport } from "../../src/scripts/live-smoke/harness.js";
import {
  chatActiveSelection,
  generatedFileAskCanProceed,
  optionalScenarios,
  requiredScenarios,
  restoreChatExperience,
  restoreWorkEffort,
  restoreWorkConfiguration,
  workMutationCandidate
} from "../../src/scripts/live-smoke/scenarios.js";
import type { ConfigurationInspectionData } from "../../src/types.js";
import type { LiveSmokeScenario } from "../../src/scripts/live-smoke/types.js";
import type { LiveSmokeScenarioResult } from "../../src/scripts/live-smoke/types.js";

function result(name: string, status: LiveSmokeScenarioResult["status"], required: boolean): LiveSmokeScenarioResult {
  return {
    name,
    status,
    required,
    startedAt: "2026-06-05T00:00:00.000Z",
    endedAt: "2026-06-05T00:00:00.000Z",
    durationMs: 0
  };
}

describe("live smoke harness", () => {
  it("reports only required non-passing scenarios as required failures", () => {
    expect(requiredFailures([
      result("pass", "pass", true),
      result("skip-optional", "skip", false),
      result("fail-required", "fail", true),
      result("skip-required", "skip", true)
    ]).map(item => item.name)).toEqual(["fail-required", "skip-required"]);
  });

  it("filters scenarios by comma-separated name", () => {
    const scenarios = [
      scenario("new-ask-read"),
      scenario("copy-latest"),
      scenario("attach-one-file")
    ];

    expect(filterScenarios(scenarios, "copy-latest, attach-one-file").map(item => item.name)).toEqual([
      "copy-latest",
      "attach-one-file"
    ]);
  });

  it("uses a separate tool-scoped browser for cleanup without exposing it to scenario behavior", async () => {
    const behaviorFinalize = vi.fn(async () => undefined);
    const cleanupFinalize = vi.fn(async () => undefined);
    const seenBrowsers: unknown[] = [];
    const liveScenario: LiveSmokeScenario = {
      name: "separate-cleanup-browser",
      required: true,
      enabled: () => true,
      run: async context => {
        seenBrowsers.push(context.browser);
        return result("separate-cleanup-browser", "pass", true);
      }
    };
    const behaviorBrowser = { tabs: { finalize: behaviorFinalize } };
    const cleanupBrowser = { tabs: { finalize: cleanupFinalize } };

    const observed = await runScenario(liveScenario, {
      agent: {},
      browser: behaviorBrowser,
      cleanupBrowser,
      reportDir: "/tmp/reports"
    });

    expect(seenBrowsers).toEqual([behaviorBrowser]);
    expect(cleanupFinalize).toHaveBeenCalledWith({ keep: [] });
    expect(behaviorFinalize).not.toHaveBeenCalled();
    expect(observed.cleanup).toEqual({ attempted: true, ok: true });
  });

  it("falls back to closing only exact controlled tabs created by the scenario", async () => {
    const existingClose = vi.fn(async () => undefined);
    const createdClose = vi.fn(async () => undefined);
    const pages = new Map([
      ["existing-tab", { id: "existing-tab", close: existingClose }]
    ]);
    const behaviorBrowser = {
      tabs: {
        list: async () => [...pages.values()],
        get: async (id: string) => pages.get(id)!,
        new: async () => ({ id: "unused" })
      }
    };
    const liveScenario: LiveSmokeScenario = {
      name: "exact-tab-diff-cleanup",
      required: true,
      enabled: () => true,
      run: async () => {
        pages.set("created-tab", { id: "created-tab", close: createdClose });
        return result("exact-tab-diff-cleanup", "pass", true);
      }
    };

    const observed = await runScenario(liveScenario, {
      agent: {},
      browser: behaviorBrowser,
      reportDir: "/tmp/reports"
    });

    expect(existingClose).not.toHaveBeenCalled();
    expect(createdClose).toHaveBeenCalledTimes(1);
    expect(observed.cleanup).toEqual({ attempted: true, ok: true, closedTabCount: 1 });
  });

  it("registers long-response scenarios as explicit opt-in checks", () => {
    const partial = optionalScenarios.find(item => item.name === "long-response-partial-short-timeout");
    const stop = optionalScenarios.find(item => item.name === "stop-control-detection");

    expect(partial?.required).toBe(false);
    expect(stop?.required).toBe(false);
    expect(partial?.enabled({ agent: {}, reportDir: "/tmp/reports", env: {} })).toBe(false);
    expect(stop?.enabled({ agent: {}, reportDir: "/tmp/reports", env: {} })).toBe(false);
    expect(partial?.enabled({ agent: {}, reportDir: "/tmp/reports", env: { CHATGPT_E2E_LONG_PARTIAL: "1" } })).toBe(true);
    expect(stop?.enabled({ agent: {}, reportDir: "/tmp/reports", env: { CHATGPT_E2E_STOP_CONTROL: "1" } })).toBe(true);
  });

  it("registers the Chat and Work expansion as required live coverage", () => {
    const expansion = requiredScenarios.find(item => item.name === "chat-work-expansion");

    expect(expansion?.required).toBe(true);
    expect(expansion?.enabled({ agent: {}, reportDir: "/tmp/reports", env: {} })).toBe(true);
  });

  it("accepts the current simplified Chat effort axis for release verification", () => {
    const inspection = {
      experience: "chat",
      selectorProfile: "chat_simplified_v1",
      availableAxes: ["effort"],
      active: { effort: "High" },
      options: {},
      verified: true,
      evidence: []
    } as ConfigurationInspectionData;

    expect(chatActiveSelection(inspection)).toEqual({ effort: "High" });
  });

  it("keeps configuration mutation opt-in and restoration-oriented", () => {
    const mutation = optionalScenarios.find(item => item.name === "configuration-mutate-restore");

    expect(mutation?.required).toBe(false);
    expect(mutation?.enabled({ agent: {}, reportDir: "/tmp/reports", env: {} })).toBe(false);
    expect(mutation?.enabled({
      agent: {},
      reportDir: "/tmp/reports",
      env: { CHATGPT_E2E_CONFIGURATION_MUTATION: "1" }
    })).toBe(true);
  });

  it("chooses an observed speed or model alternative when effort exposes only its current value", () => {
    const inspection = workInspection("Light");
    inspection.options = {
      effort: [{ id: "light", label: "Light", selected: true }],
      model: [{ id: "sol", label: "GPT-5.6 Sol", selected: true }, { id: "terra", label: "GPT-5.6 Terra", selected: false }],
      speed: [{ id: "standard", label: "Standard", selected: true }, { id: "fast", label: "Fast", selected: false }]
    };
    expect(workMutationCandidate(inspection)).toEqual({ axis: "speed", original: "Standard", alternative: "Fast" });
    delete inspection.options.speed;
    expect(workMutationCandidate(inspection)).toEqual({ axis: "model", original: "GPT-5.6 Sol", alternative: "GPT-5.6 Terra" });
    inspection.options.model![1]!.disabled = true;
    expect(workMutationCandidate(inspection)).toBeUndefined();
  });

  it("restores every originally observed axis after a model or speed mutation", async () => {
    const desired = { model: "GPT-5.6 Sol", effort: "Light", speed: "Standard" };
    const applied: unknown[] = [];
    let reads = 0;
    const restored = await restoreWorkConfiguration({
      apply: async args => { applied.push(args.desired); return {
        ok: true, status: "ok", data: { requested: args.desired, selected: [], before: workInspection("High"), after: workInspection("Light"), verified: true },
        warnings: [], context: { timestamp: "2026-09-06T00:00:00.000Z" }
      }; },
      inspect: async () => { reads++; const data = workInspection(reads === 1 ? "High" : "Light"); return {
        ok: true, status: "ok", data, warnings: [], context: { timestamp: "2026-09-06T00:00:00.000Z" }
      }; }
    }, desired, { attempts: 2, sleep: async () => undefined });
    expect(restored).toMatchObject({ verified: true, attempts: 2, observedSelection: desired });
    expect(applied).toEqual([desired, desired]);
  });

  it("retries restoration until an independent Work inspection verifies the original effort", async () => {
    const applied: string[] = [];
    const sleeps: number[] = [];
    let inspections = 0;
    const restored = await restoreWorkEffort({
      apply: async args => {
        applied.push(args.desired.effort!);
        return {
          ok: true,
          status: "ok",
          data: {
            requested: args.desired,
            selected: [],
            before: workInspection("Light"),
            after: workInspection("Extra High"),
            verified: true
          },
          warnings: [],
          context: { timestamp: "2026-08-17T00:00:00.000Z" }
        };
      },
      inspect: async () => {
        inspections += 1;
        const active = inspections === 1 ? "Light" : "Extra High";
        return {
          ok: true,
          status: "ok",
          data: workInspection(active),
          warnings: [],
          context: { timestamp: "2026-08-17T00:00:00.000Z" }
        };
      }
    }, "Extra High", {
      attempts: 3,
      delayMs: 750,
      sleep: async milliseconds => { sleeps.push(milliseconds); }
    });

    expect(restored).toMatchObject({
      verified: true,
      attempts: 2,
      observedEffort: "Extra High"
    });
    expect(applied).toEqual(["Extra High", "Extra High"]);
    expect(sleeps).toEqual([750]);
  });

  it("recognizes an idempotent Chat restore after the first click has an uncertain postcondition", async () => {
    const opened: string[] = [];
    const sleeps: number[] = [];
    let detections = 0;
    const restored = await restoreChatExperience({
      detect: async () => {
        detections += 1;
        const visibleExperience = detections === 1 ? "work" : "chat";
        return {
          ok: true,
          status: "ok",
          data: {
            experience: visibleExperience,
            selectorProfile: visibleExperience === "chat" ? "chat_simplified_v1" : "work_advanced_v1",
            confidence: "high",
            evidence: []
          },
          warnings: [],
          context: { timestamp: "2026-08-17T00:00:00.000Z" }
        };
      },
      open: async args => {
        opened.push(args.experience);
        return {
          ok: false,
          status: "blocked",
          warnings: [],
          blocker: {
            kind: "selector_drift",
            code: "experience_postcondition_unverified",
            message: "The click completed but the immediate read was inconclusive.",
            resumable: true
          },
          context: { timestamp: "2026-08-17T00:00:00.000Z" }
        };
      }
    }, {
      attempts: 3,
      delayMs: 750,
      sleep: async milliseconds => { sleeps.push(milliseconds); }
    });

    expect(restored).toMatchObject({
      verified: true,
      attempts: 2,
      observedExperience: "chat"
    });
    expect(opened).toEqual(["chat"]);
    expect(sleeps).toEqual([750]);
  });

  it("lets artifact verification decide a settled partial generated-file response", () => {
    expect(generatedFileAskCanProceed({
      ok: false,
      status: "partial",
      data: { prompt: "generated file probe", complete: false, generationActive: false },
      warnings: [],
      context: { timestamp: "2026-07-17T00:00:00.000Z" }
    })).toBe(true);
    expect(generatedFileAskCanProceed({
      ok: false,
      status: "partial",
      data: { prompt: "generated file probe", complete: false, generationActive: true },
      warnings: [],
      context: { timestamp: "2026-07-17T00:00:00.000Z" }
    })).toBe(false);
  });

  it("redacts command content in persisted live-smoke reports", async () => {
    const dir = await mkdtemp(join(tmpdir(), "chatgpt-live-report-"));
    const reportPath = await writeReport(dir, [{
      ...result("copy-markdown", "pass", true),
      command: {
        ok: true,
        status: "ok",
        data: {
          text: "private@example.com",
          markdown: "## Secret",
          html: "<p>secret</p>"
        },
        warnings: ["private@example.com"],
        context: { timestamp: "2026-06-05T00:00:00.000Z", title: "private@example.com" }
      }
    }]);

    const body = await readFile(reportPath, "utf8");
    expect(body).toContain("\"name\": \"copy-markdown\"");
    expect(body).toContain("\"status\": \"pass\"");
    expect(body).toContain("[redacted:");
    expect(body).not.toContain("private@example.com");
    expect(body).not.toContain("## Secret");
    expect(body).not.toContain("<p>secret</p>");
  });
});

function scenario(name: string): LiveSmokeScenario {
  return {
    name,
    required: true,
    enabled: () => true,
    run: async () => result(name, "pass", true)
  };
}

function workInspection(effort: string): ConfigurationInspectionData {
  return {
    experience: "work",
    selectorProfile: "work_advanced_v1",
    availableAxes: ["model", "effort", "speed"],
    active: { model: "GPT-5.6 Sol", effort, speed: "Standard" },
    options: {},
    verified: true,
    evidence: []
  };
}
