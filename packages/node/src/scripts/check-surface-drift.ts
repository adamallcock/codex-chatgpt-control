import { validateSurfaceDrift } from "../testing/surface-drift.js";

const report = validateSurfaceDrift();

console.log([
  "Validated docs/surface drift gate:",
  `- ${report.commandCount} backend commands`,
  `- ${report.descriptorCount} command descriptors`,
  `- ${report.blockerKindCount} blocker kinds`,
  `- ${report.pythonCommandCount} Python-covered commands`,
  `- ${report.generatedDocsChecked} generated blocker doc sections`,
  `- ${report.docAnchorsChecked} doc anchors`
].join("\n"));
