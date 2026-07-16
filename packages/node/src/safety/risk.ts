export type RiskLevel = "low" | "medium" | "high";

export const commandRisk = {
  "session.bootstrap": "low",
  "experience.detect": "low",
  "experience.open": "medium",
  "configuration.inspect": "low",
  "configuration.apply": "medium",
  "work.start": "medium",
  "work.status": "medium",
  "work.wait": "low",
  "work.steer": "medium",
  "work.readLatest": "medium",
  "threads.search": "medium",
  "threads.open": "medium",
  "threads.new": "low",
  "messages.compose": "low",
  "messages.submit": "medium",
  "messages.ask": "medium",
  "messages.wait": "low",
  "messages.readLatest": "medium",
  "messages.status": "medium",
  "messages.waitAndRead": "medium",
  "artifacts.listLatest": "medium",
  "artifacts.wait": "low",
  "artifacts.downloadLatest": "medium",
  "files.preflight": "low",
  "files.attach": "medium",
  "files.downloadLatest": "medium",
  "projects.sources.list": "low",
  "projects.sources.planAdd": "low",
  "projects.sources.add": "medium",
  "response.copy": "medium",
  "modes.set": "medium",
  "modes.get": "low",
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
