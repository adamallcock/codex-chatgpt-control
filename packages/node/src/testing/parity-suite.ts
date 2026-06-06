import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const PARITY_SUITE_SCHEMA_VERSION = "chatgpt.browser_control.parity_suite.v1";

type EvidencePaths = {
  fixtures?: string[];
  sourceFiles?: string[];
  nodeTests?: string[];
  pythonTests?: string[];
  docs?: string[];
};

type ParitySurface = EvidencePaths & {
  id: string;
  summary: string;
};

type BackendCommandCoverage = EvidencePaths & {
  surface: string;
};

type ParityGate = {
  id: string;
  cwd: string;
  command: string;
  ciRequired?: boolean;
};

type ParitySuiteMatrix = {
  schemaVersion: string;
  contractVersion: string;
  surfaces: ParitySurface[];
  backendCommands: Record<string, BackendCommandCoverage>;
  gates: ParityGate[];
};

type ContractManifest = {
  fixtures: Array<{ file: string; case: string; schema: string }>;
};

export type ParitySuiteReport = {
  surfaceCount: number;
  fixtureCount: number;
  commandCount: number;
  gateCount: number;
  manifestFixtures: string[];
  coveredFixtures: string[];
  sourceCommands: string[];
  coveredCommands: string[];
};

export function validateParitySuite(packageRootInput: URL | string = defaultPackageRoot()): ParitySuiteReport {
  const packageRoot = toPath(packageRootInput);
  const repoRoot = resolve(packageRoot, "..", "..");
  const pythonRoot = resolve(packageRoot, "..", "python");
  const contractRoot = join(packageRoot, "contracts", "v1");
  const matrixPath = join(contractRoot, "parity-suite.json");
  const manifestPath = join(contractRoot, "manifest.json");
  const matrix = readJson<ParitySuiteMatrix>(matrixPath);
  const manifest = readJson<ContractManifest>(manifestPath);
  const errors: string[] = [];

  if (matrix.schemaVersion !== PARITY_SUITE_SCHEMA_VERSION) {
    errors.push(`parity-suite.json has unsupported schemaVersion ${String(matrix.schemaVersion)}.`);
  }

  const surfaceIds = new Set(matrix.surfaces.map(surface => surface.id));
  if (surfaceIds.size !== matrix.surfaces.length) {
    errors.push("parity-suite.json contains duplicate surface ids.");
  }

  const manifestFixtures = sortedUnique(manifest.fixtures.map(fixture => fixture.file));
  const sourceCommands = readBackendCommands(join(packageRoot, "src", "backend", "protocol.ts"));
  const coveredFixtures = sortedUnique([
    ...matrix.surfaces.flatMap(surface => surface.fixtures ?? []),
    ...Object.values(matrix.backendCommands).flatMap(command => command.fixtures ?? [])
  ]);
  const coveredCommands = sortedUnique(Object.keys(matrix.backendCommands));

  compareSets("fixture coverage", coveredFixtures, manifestFixtures, errors);
  compareSets("backend command coverage", coveredCommands, sourceCommands, errors);
  validateSurfaces(matrix.surfaces, surfaceIds, manifestFixtures, packageRoot, pythonRoot, repoRoot, errors);
  validateCommands(matrix.backendCommands, surfaceIds, manifestFixtures, packageRoot, pythonRoot, repoRoot, errors);
  validateGates(matrix.gates, packageRoot, repoRoot, errors);

  if (errors.length > 0) {
    throw new Error(`Parity suite validation failed:\n- ${errors.join("\n- ")}`);
  }

  return {
    surfaceCount: matrix.surfaces.length,
    fixtureCount: manifestFixtures.length,
    commandCount: sourceCommands.length,
    gateCount: matrix.gates.length,
    manifestFixtures,
    coveredFixtures,
    sourceCommands,
    coveredCommands
  };
}

function validateSurfaces(
  surfaces: ParitySurface[],
  surfaceIds: Set<string>,
  manifestFixtures: string[],
  packageRoot: string,
  pythonRoot: string,
  repoRoot: string,
  errors: string[]
): void {
  for (const surface of surfaces) {
    const label = `surface ${surface.id}`;
    if (surface.summary.length === 0) errors.push(`${label} must include a summary.`);
    validateEvidence(label, surface, surfaceIds, manifestFixtures, packageRoot, pythonRoot, repoRoot, errors);
  }
}

function validateCommands(
  commands: Record<string, BackendCommandCoverage>,
  surfaceIds: Set<string>,
  manifestFixtures: string[],
  packageRoot: string,
  pythonRoot: string,
  repoRoot: string,
  errors: string[]
): void {
  for (const [command, coverage] of Object.entries(commands)) {
    const label = `backend command ${command}`;
    if (!surfaceIds.has(coverage.surface)) {
      errors.push(`${label} references unknown surface ${coverage.surface}.`);
    }
    validateEvidence(label, coverage, surfaceIds, manifestFixtures, packageRoot, pythonRoot, repoRoot, errors);
    if ((coverage.nodeTests ?? []).length === 0) errors.push(`${label} must include nodeTests evidence.`);
    if ((coverage.pythonTests ?? []).length === 0) errors.push(`${label} must include pythonTests evidence.`);
    if ((coverage.docs ?? []).length === 0) errors.push(`${label} must include docs evidence.`);
  }
}

function validateEvidence(
  label: string,
  evidence: EvidencePaths,
  _surfaceIds: Set<string>,
  manifestFixtures: string[],
  packageRoot: string,
  pythonRoot: string,
  repoRoot: string,
  errors: string[]
): void {
  for (const fixture of evidence.fixtures ?? []) {
    if (!manifestFixtures.includes(fixture)) {
      errors.push(`${label} references unknown fixture ${fixture}.`);
    }
    assertExists(`${label} fixture ${fixture}`, join(packageRoot, "contracts", "v1", "fixtures", fixture), errors);
  }
  for (const sourceFile of evidence.sourceFiles ?? []) {
    assertExists(`${label} source ${sourceFile}`, join(packageRoot, sourceFile), errors);
  }
  for (const nodeTest of evidence.nodeTests ?? []) {
    assertExists(`${label} node test ${nodeTest}`, join(packageRoot, nodeTest), errors);
  }
  for (const pythonTest of evidence.pythonTests ?? []) {
    assertExists(`${label} python test ${pythonTest}`, join(pythonRoot, pythonTest), errors);
  }
  for (const doc of evidence.docs ?? []) {
    if (!existsAtAny([join(packageRoot, doc), join(repoRoot, doc)])) {
      errors.push(`${label} docs ${doc} does not exist.`);
    }
  }
}

function validateGates(gates: ParityGate[], packageRoot: string, repoRoot: string, errors: string[]): void {
  const ids = new Set<string>();
  const packageJson = readJson<{ scripts?: Record<string, string> }>(join(packageRoot, "package.json"));
  const workflowText = readWorkflowText(join(repoRoot, ".github", "workflows"));

  for (const gate of gates) {
    if (ids.has(gate.id)) errors.push(`gate ${gate.id} is duplicated.`);
    ids.add(gate.id);
    assertExists(`gate ${gate.id} cwd ${gate.cwd}`, join(repoRoot, gate.cwd), errors);
    const script = npmRunScriptName(gate.command);
    if (script !== undefined && packageJson.scripts?.[script] === undefined) {
      errors.push(`gate ${gate.id} references missing npm script ${script}.`);
    }
    if (gate.ciRequired !== false && !workflowText.includes(gate.command)) {
      errors.push(`gate ${gate.id} command is missing from chatgpt-sdk-parity.yml: ${gate.command}`);
    }
  }
}

function readWorkflowText(workflowsDir: string): string {
  if (!existsSync(workflowsDir)) return "";
  return readdirSync(workflowsDir)
    .filter(file => /\.(ya?ml)$/i.test(file))
    .map(file => readFileSync(join(workflowsDir, file), "utf8"))
    .join("\n");
}

function readBackendCommands(protocolPath: string): string[] {
  const sourceText = readFileSync(protocolPath, "utf8");
  const sourceFile = ts.createSourceFile(protocolPath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const commands: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name)
          && declaration.name.text === "backendCommands"
          && declaration.initializer !== undefined
        ) {
          const array = unwrapConstAssertion(declaration.initializer);
          if (!ts.isArrayLiteralExpression(array)) {
            throw new Error("backendCommands must be declared as an array literal.");
          }
          for (const element of array.elements) {
            if (!ts.isStringLiteral(element)) {
              throw new Error("backendCommands may only contain string literals.");
            }
            commands.push(element.text);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  if (commands.length === 0) throw new Error("Unable to find backendCommands in backend protocol source.");
  return sortedUnique(commands);
}

function unwrapConstAssertion(node: ts.Expression): ts.Expression {
  if (ts.isAsExpression(node)) return unwrapConstAssertion(node.expression);
  return node;
}

function compareSets(label: string, actual: string[], expected: string[], errors: string[]): void {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const missing = expected.filter(item => !actualSet.has(item));
  const extra = actual.filter(item => !expectedSet.has(item));
  if (missing.length > 0) errors.push(`${label} missing: ${missing.join(", ")}`);
  if (extra.length > 0) errors.push(`${label} extra: ${extra.join(", ")}`);
}

function assertExists(label: string, path: string, errors: string[]): void {
  if (!existsSync(path)) errors.push(`${label} does not exist at ${path}.`);
}

function existsAtAny(paths: string[]): boolean {
  return paths.some(path => existsSync(path));
}

function npmRunScriptName(command: string): string | undefined {
  const match = command.match(/^npm run ([^\s]+)$/);
  if (match !== null) return match[1];
  if (command === "npm test") return "test";
  return undefined;
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
