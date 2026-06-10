import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { backendCommands } from "../backend/protocol.js";
import { commandDescriptors, type CommandDescriptor } from "../commands/registry.js";
import { explainCommandBlocker } from "../diagnostics/blockers.js";

const POLICY_SCHEMA_VERSION = "chatgpt.browser_control.surface_drift_policy.v1";
const GENERATED_BLOCKERS_START = "<!-- surface-drift:blocker-kind-coverage:start -->";
const GENERATED_BLOCKERS_END = "<!-- surface-drift:blocker-kind-coverage:end -->";

type DatedExemption = {
  date: string;
  reason: string;
};

type CommandExemption = DatedExemption & {
  command: string;
};

type DescriptorExemption = DatedExemption & {
  descriptor: string;
};

type DocAnchor = {
  id: string;
  paths: string[];
  terms: string[];
};

type SurfaceDriftPolicy = {
  schemaVersion: string;
  backendCommandDescriptorExemptions: CommandExemption[];
  descriptorBackendCommandExemptions: DescriptorExemption[];
  backendDispatchExemptions: CommandExemption[];
  pythonFacadeExemptions: CommandExemption[];
  generatedBlockerDocs: string[];
  docAnchors: DocAnchor[];
};

export type SurfaceCommandDescriptor = Pick<CommandDescriptor, "name" | "blockers">;

export type SurfaceBlockerExplanation = {
  kind: string;
  title: string;
  category: string;
  severity: string;
  userActionRequired: boolean;
  nextCommands: string[];
};

export type SurfaceDriftModel = {
  backendCommands: string[];
  backendCapabilityCommands: string[];
  backendDispatchCommands: string[];
  commandDescriptors: SurfaceCommandDescriptor[];
  commandDescriptorFixtureNames: string[];
  paritySuiteCommands: string[];
  pythonCommands: string[];
  blockerKinds: string[];
  blockerExplanationFixtureKinds: string[];
  blockerExplanations: SurfaceBlockerExplanation[];
  docs: Record<string, string>;
  policy: SurfaceDriftPolicy;
};

export type SurfaceDriftReport = {
  commandCount: number;
  descriptorCount: number;
  blockerKindCount: number;
  pythonCommandCount: number;
  generatedDocsChecked: number;
  docAnchorsChecked: number;
};

export type SurfaceDriftValidationResult = {
  ok: boolean;
  errors: string[];
  report: SurfaceDriftReport;
};

export function validateSurfaceDrift(packageRootInput: URL | string = defaultPackageRoot()): SurfaceDriftReport {
  const result = validateSurfaceDriftModel(collectSurfaceDriftModel(packageRootInput));
  if (!result.ok) {
    throw new Error(`Surface drift validation failed:\n- ${result.errors.join("\n- ")}`);
  }
  return result.report;
}

export function collectSurfaceDriftModel(packageRootInput: URL | string = defaultPackageRoot()): SurfaceDriftModel {
  const packageRoot = toPath(packageRootInput);
  const contractRoot = join(packageRoot, "contracts", "v1");
  const policy = readJson<SurfaceDriftPolicy>(join(contractRoot, "surface-drift-policy.json"));
  const repoRoot = resolve(packageRoot, "..", "..");
  const pythonRoot = resolvePythonRoot(packageRoot);
  const blockerKinds = readBlockerKinds(join(packageRoot, "src", "types.ts"));
  const descriptorFixture = readJson<{ result?: Array<{ name: string }> }>(join(contractRoot, "fixtures", "command-descriptors.json"));
  const capabilitiesFixture = readJson<{ commands?: string[]; result?: { commands?: string[] } }>(join(contractRoot, "fixtures", "backend-capabilities.json"));
  const blockerProfilesFixture = readJson<{ result?: { profiles?: Array<{ kind: string }> } }>(join(contractRoot, "fixtures", "blocker-explanation-profiles.json"));
  const paritySuite = readJson<{ backendCommands?: Record<string, unknown> }>(join(contractRoot, "parity-suite.json"));
  const docs = collectDocs(packageRoot, policy, pythonRoot);

  return {
    backendCommands: [...backendCommands],
    backendCapabilityCommands: capabilitiesFixture.commands ?? capabilitiesFixture.result?.commands ?? [],
    backendDispatchCommands: readBackendDispatchCommands(join(packageRoot, "src", "backend", "session.ts")),
    commandDescriptors: commandDescriptors().map(descriptor => ({ name: descriptor.name, blockers: [...descriptor.blockers] })),
    commandDescriptorFixtureNames: (descriptorFixture.result ?? []).map(descriptor => descriptor.name),
    paritySuiteCommands: Object.keys(paritySuite.backendCommands ?? {}),
    pythonCommands: pythonRoot === undefined ? [] : readPythonCommands(pythonRoot, backendCommands),
    blockerKinds,
    blockerExplanationFixtureKinds: (blockerProfilesFixture.result?.profiles ?? []).map(profile => profile.kind),
    blockerExplanations: blockerKinds.map(kind => {
      const explanation = explainCommandBlocker({ kind: kind as never, message: `Synthetic ${kind} blocker for surface drift validation.` });
      return {
        kind,
        title: explanation.title,
        category: explanation.category,
        severity: explanation.severity,
        userActionRequired: explanation.userActionRequired,
        nextCommands: [...explanation.nextCommands]
      };
    }),
    docs,
    policy: normalizePolicyForLayout(policy, repoRoot)
  };
}

export function validateSurfaceDriftModel(model: SurfaceDriftModel): SurfaceDriftValidationResult {
  const errors: string[] = [];
  const backendCommandsSet = new Set(model.backendCommands);
  const descriptorNames = sortedUnique(model.commandDescriptors.map(descriptor => descriptor.name));
  const descriptorNameSet = new Set(descriptorNames);
  const blockerKindSet = new Set(model.blockerKinds);
  const backendDescriptorExemptions = new Set(model.policy.backendCommandDescriptorExemptions.map(exemption => exemption.command));
  const descriptorBackendExemptions = new Set(model.policy.descriptorBackendCommandExemptions.map(exemption => exemption.descriptor));
  const backendDispatchExemptions = new Set(model.policy.backendDispatchExemptions.map(exemption => exemption.command));
  const pythonFacadeExemptions = new Set(model.policy.pythonFacadeExemptions.map(exemption => exemption.command));

  validatePolicy(model, errors);
  compareSets("backend capabilities fixture commands", model.backendCapabilityCommands, model.backendCommands, errors);
  compareSets("command descriptor fixture names", model.commandDescriptorFixtureNames, descriptorNames, errors);
  compareSets("parity-suite backend command coverage", model.paritySuiteCommands, model.backendCommands, errors);
  compareSets(
    "blocker explanation profile fixture kinds",
    model.blockerExplanationFixtureKinds,
    model.blockerKinds,
    errors
  );

  for (const command of model.backendCommands) {
    if (!descriptorNameSet.has(command) && !backendDescriptorExemptions.has(command)) {
      errors.push(`backend command ${command} is missing from command descriptors and has no exemption`);
    }
    if (!model.backendDispatchCommands.includes(command) && !backendDispatchExemptions.has(command)) {
      errors.push(`backend command ${command} is missing from backend dispatch and has no exemption`);
    }
    if (!model.pythonCommands.includes(command) && !pythonFacadeExemptions.has(command)) {
      errors.push(`backend command ${command} is missing from Python facade coverage and has no exemption`);
    }
  }

  for (const descriptor of model.commandDescriptors) {
    if (!backendCommandsSet.has(descriptor.name) && !descriptorBackendExemptions.has(descriptor.name)) {
      errors.push(`command descriptor ${descriptor.name} is not a backend command and has no exemption`);
    }
    for (const blocker of descriptor.blockers) {
      if (!blockerKindSet.has(blocker)) {
        errors.push(`command descriptor ${descriptor.name} references unknown blocker ${blocker}`);
      }
    }
  }

  for (const explanation of model.blockerExplanations) {
    if (!blockerKindSet.has(explanation.kind)) {
      errors.push(`blocker explanation references unknown kind ${explanation.kind}`);
    }
    if (explanation.kind !== "unknown" && explanation.title === "Unknown blocker") {
      errors.push(`blocker kind ${explanation.kind} falls back to the unknown blocker explanation`);
    }
    for (const nextCommand of explanation.nextCommands) {
      if (!backendCommandsSet.has(nextCommand) && !descriptorNameSet.has(nextCommand)) {
        errors.push(`blocker kind ${explanation.kind} references unknown next command ${nextCommand}`);
      }
    }
  }

  const expectedBlockerSection = generatedBlockerCoverageSection(model.blockerExplanations);
  let generatedDocsChecked = 0;
  for (const docPath of model.policy.generatedBlockerDocs) {
    const text = model.docs[docPath];
    if (text === undefined) continue;
    generatedDocsChecked += 1;
    if (normalizeLineEndings(extractGeneratedBlockerCoverage(text)) !== expectedBlockerSection) {
      errors.push(`generated blocker coverage section is stale in ${docPath}`);
    }
  }
  if (generatedDocsChecked === 0) {
    errors.push("no generated blocker coverage docs were found");
  }

  let docAnchorsChecked = 0;
  for (const anchor of model.policy.docAnchors) {
    const existingPaths = anchor.paths.filter(path => model.docs[path] !== undefined);
    if (existingPaths.length === 0) {
      errors.push(`doc anchor ${anchor.id} has no existing checked paths`);
      continue;
    }
    for (const docPath of existingPaths) {
      const text = model.docs[docPath];
      if (text === undefined) continue;
      docAnchorsChecked += anchor.terms.length;
      for (const term of anchor.terms) {
        if (!text.includes(term)) {
          errors.push(`doc anchor ${anchor.id} missing ${term} in ${docPath}`);
        }
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    report: {
      commandCount: model.backendCommands.length,
      descriptorCount: descriptorNames.length,
      blockerKindCount: model.blockerKinds.length,
      pythonCommandCount: model.pythonCommands.length,
      generatedDocsChecked,
      docAnchorsChecked
    }
  };
}

export function generatedBlockerCoverageSection(explanations: SurfaceBlockerExplanation[]): string {
  return [
    GENERATED_BLOCKERS_START,
    "## Blocker Kind Coverage",
    "",
    "This section is checked by `npm run docs:drift`. Keep it aligned with `BlockerKind`, `explainCommandBlocker(...)`, command descriptors, and public troubleshooting coverage.",
    "",
    ...explanations.map(explanation => `- \`${explanation.kind}\`: ${explanation.title} (category: \`${explanation.category}\`, severity: \`${explanation.severity}\`, user action: ${explanation.userActionRequired ? "yes" : "no"})`),
    GENERATED_BLOCKERS_END
  ].join("\n");
}

function collectDocs(packageRoot: string, policy: SurfaceDriftPolicy, pythonRoot: string | undefined): Record<string, string> {
  const paths = new Set<string>([
    ...policy.generatedBlockerDocs,
    ...policy.docAnchors.flatMap(anchor => anchor.paths)
  ]);
  const docs: Record<string, string> = {};
  for (const docPath of paths) {
    const absolutePath = resolveDocPath(packageRoot, docPath, pythonRoot);
    if (absolutePath === undefined) continue;
    if (existsSync(absolutePath) && statSync(absolutePath).isFile()) {
      docs[docPath] = readFileSync(absolutePath, "utf8");
    }
  }
  return docs;
}

function resolveDocPath(packageRoot: string, docPath: string, pythonRoot: string | undefined): string | undefined {
  const pythonPrefix = "$pythonRoot/";
  if (docPath.startsWith(pythonPrefix)) {
    if (pythonRoot === undefined) return undefined;
    return join(pythonRoot, docPath.slice(pythonPrefix.length));
  }
  return resolve(packageRoot, docPath);
}

function extractGeneratedBlockerCoverage(text: string): string | undefined {
  const start = text.indexOf(GENERATED_BLOCKERS_START);
  const end = text.indexOf(GENERATED_BLOCKERS_END);
  if (start < 0 || end < start) return undefined;
  return text.slice(start, end + GENERATED_BLOCKERS_END.length);
}

function normalizeLineEndings(text: string | undefined): string | undefined {
  return text?.replace(/\r\n?/g, "\n");
}

function validatePolicy(model: SurfaceDriftModel, errors: string[]): void {
  const policy = model.policy;
  if (policy.schemaVersion !== POLICY_SCHEMA_VERSION) {
    errors.push(`surface-drift-policy.json has unsupported schemaVersion ${String(policy.schemaVersion)}`);
  }

  const backendCommandsSet = new Set(model.backendCommands);
  const descriptorNames = new Set(model.commandDescriptors.map(descriptor => descriptor.name));
  const commandExemptionGroups: Array<[string, CommandExemption[], Set<string>]> = [
    ["backendCommandDescriptorExemptions", policy.backendCommandDescriptorExemptions, backendCommandsSet],
    ["backendDispatchExemptions", policy.backendDispatchExemptions, backendCommandsSet],
    ["pythonFacadeExemptions", policy.pythonFacadeExemptions, backendCommandsSet]
  ];

  for (const [group, exemptions, allowedCommands] of commandExemptionGroups) {
    validateUniqueExemptions(group, exemptions.map(exemption => exemption.command), errors);
    for (const exemption of exemptions) {
      validateDatedExemption(`${group}.${exemption.command}`, exemption, errors);
      if (!allowedCommands.has(exemption.command)) {
        errors.push(`${group}.${exemption.command} does not reference a backend command`);
      }
    }
  }

  validateUniqueExemptions(
    "descriptorBackendCommandExemptions",
    policy.descriptorBackendCommandExemptions.map(exemption => exemption.descriptor),
    errors
  );
  for (const exemption of policy.descriptorBackendCommandExemptions) {
    validateDatedExemption(`descriptorBackendCommandExemptions.${exemption.descriptor}`, exemption, errors);
    if (!descriptorNames.has(exemption.descriptor)) {
      errors.push(`descriptorBackendCommandExemptions.${exemption.descriptor} does not reference a command descriptor`);
    }
  }

  const docAnchorIds = policy.docAnchors.map(anchor => anchor.id);
  validateUniqueExemptions("docAnchors", docAnchorIds, errors);
  for (const anchor of policy.docAnchors) {
    if (anchor.paths.length === 0) errors.push(`doc anchor ${anchor.id} must include at least one path`);
    if (anchor.terms.length === 0) errors.push(`doc anchor ${anchor.id} must include at least one term`);
  }
}

function validateDatedExemption(label: string, exemption: DatedExemption, errors: string[]): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(exemption.date)) {
    errors.push(`${label} must include a YYYY-MM-DD date`);
  }
  if (exemption.reason.trim().length < 12) {
    errors.push(`${label} must include a concrete reason`);
  }
}

function validateUniqueExemptions(label: string, values: string[], errors: string[]): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) errors.push(`${label} contains duplicate entry ${value}`);
    seen.add(value);
  }
}

function compareSets(label: string, actual: string[], expected: string[], errors: string[]): void {
  const actualSorted = sortedUnique(actual);
  const expectedSorted = sortedUnique(expected);
  const actualSet = new Set(actualSorted);
  const expectedSet = new Set(expectedSorted);
  const missing = expectedSorted.filter(item => !actualSet.has(item));
  const extra = actualSorted.filter(item => !expectedSet.has(item));
  if (missing.length > 0) errors.push(`${label} missing: ${missing.join(", ")}`);
  if (extra.length > 0) errors.push(`${label} extra: ${extra.join(", ")}`);
}

function normalizePolicyForLayout(policy: SurfaceDriftPolicy, repoRoot: string): SurfaceDriftPolicy {
  if (existsSync(join(repoRoot, "packages", "node")) && !existsSync(join(repoRoot, "tools", "public-export"))) {
    return {
      ...policy,
      generatedBlockerDocs: policy.generatedBlockerDocs.filter(path => !path.includes("tools/public-export")),
      docAnchors: policy.docAnchors.map(anchor => ({
        ...anchor,
        paths: anchor.paths.filter(path => !path.includes("tools/public-export"))
      }))
    };
  }
  return policy;
}

function readBlockerKinds(typesPath: string): string[] {
  const text = readFileSync(typesPath, "utf8");
  const match = text.match(/export type BlockerKind =([\s\S]*?);/);
  if (match === null || match[1] === undefined) {
    throw new Error("Unable to find BlockerKind union in src/types.ts.");
  }
  return [...match[1].matchAll(/"([^"]+)"/g)].map(item => {
    const kind = item[1];
    if (kind === undefined) throw new Error("Unable to parse BlockerKind literal.");
    return kind;
  });
}

function readBackendDispatchCommands(sessionPath: string): string[] {
  const text = readFileSync(sessionPath, "utf8");
  const match = text.match(/switch \(request\.command\) \{([\s\S]*?)\n  \}/);
  if (match === null || match[1] === undefined) {
    throw new Error("Unable to find backend command dispatch switch.");
  }
  return sortedUnique([...match[1].matchAll(/case "([^"]+)":/g)].map(item => {
    const command = item[1];
    if (command === undefined) throw new Error("Unable to parse backend dispatch command.");
    return command;
  }));
}

function readPythonCommands(pythonRoot: string, knownBackendCommands: readonly string[]): string[] {
  const known = new Set<string>(knownBackendCommands);
  const commands = new Set<string>();
  for (const path of pythonFiles(pythonRoot)) {
    const text = readFileSync(path, "utf8");
    for (const pattern of [
      /command_result\([^,\n]+,\s*"([^"]+)"/g,
      /request_backend\([^,\n]+,\s*"([^"]+)"/g,
      /async_request_backend\([^,\n]+,\s*"([^"]+)"/g,
      /self\.request\("([^"]+)"/g,
      /self\.stream\("([^"]+)"/g,
      /"([^"]+)"\s*:\s*"([^"]+)"/g
    ]) {
      for (const match of text.matchAll(pattern)) {
        const command = match[2] ?? match[1];
        if (command !== undefined && known.has(command)) {
          commands.add(command);
        }
      }
    }
  }
  return sortedUnique([...commands]);
}

function pythonFiles(root: string): string[] {
  const result: string[] = [];
  const visit = (path: string): void => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const entryPath = join(path, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__pycache__" || entry.name.endsWith(".egg-info")) continue;
        visit(entryPath);
      } else if (entry.isFile() && entry.name.endsWith(".py")) {
        result.push(entryPath);
      }
    }
  };
  visit(root);
  return result;
}

function resolvePythonRoot(packageRoot: string): string | undefined {
  const repoRoot = resolve(packageRoot, "..", "..");
  const candidates = [
    join(repoRoot, "packages", "python"),
    resolve(packageRoot, "..", "python"),
    join(repoRoot, "packages", "python"),
    resolve(packageRoot, "..", "python")
  ];
  return candidates.find(path => existsSync(path) && statSync(path).isDirectory());
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function toPath(input: URL | string): string {
  if (input instanceof URL) return fileURLToPath(input);
  return input;
}

function defaultPackageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
}
