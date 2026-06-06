import { validateParitySuite } from "../testing/parity-suite.js";

const report = validateParitySuite();

console.log([
  `Validated polyglot parity suite:`,
  `- ${report.surfaceCount} surfaces`,
  `- ${report.fixtureCount} contract fixtures`,
  `- ${report.commandCount} backend commands`,
  `- ${report.gateCount} deterministic gates`
].join("\n"));
