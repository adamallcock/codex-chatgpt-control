export type RiskLevel = "low" | "medium" | "high";

export const commandRisk = {
  "session.bootstrap": "low",
  "session.assertChatGPTHost": "low",
  "temporary.readState": "low",
  "temporary.ensureOn": "medium",
  "temporary.assertVerifiedOn": "low",
  "threads.search": "medium",
  "threads.open": "medium",
  "threads.new": "low",
  "messages.compose": "low",
  "messages.inspectComposer": "low",
  "messages.submit": "medium",
  "messages.ask": "medium",
  "messages.wait": "low",
  "messages.readLatest": "medium",
  "messages.waitAndRead": "medium",
  "files.attach": "medium",
  "files.verifyAttached": "low",
  "files.downloadLatest": "medium",
  "guards.assertSafeToSubmit": "low",
  "response.copy": "medium",
  "modes.set": "medium",
  "tools.select": "medium",
  "threads.delete": "high",
  "threads.archive": "high",
  "threads.share": "high",
  "settings.change": "high",
  "apps.connect": "high"
} as const;

export type KnownRiskCommand = keyof typeof commandRisk;

export function riskForCommand(command: string): RiskLevel {
  return (commandRisk as Record<string, RiskLevel | undefined>)[command] ?? "high";
}

export function isHighRiskCommand(command: string): boolean {
  return riskForCommand(command) === "high";
}
