#!/usr/bin/env node
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { root: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") {
      args.root = path.resolve(argv[++i]);
    } else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/validate-plugin-layout.mjs [--root <repo-root>]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function detectRoot(explicitRoot) {
  const candidates = [
    explicitRoot,
    path.resolve(SCRIPT_DIR, ".."),
    path.resolve(SCRIPT_DIR, "../../../..")
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "plugins/codex-chatgpt-control/.codex-plugin/plugin.json"))) {
      return candidate;
    }
  }
  throw new Error("Could not find repo root with plugins/codex-chatgpt-control");
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function pngDimensions(file) {
  const data = await readFile(file);
  const pngSignature = "89504e470d0a1a0a";
  assert(data.subarray(0, 8).toString("hex") === pngSignature, `${file} is not a valid PNG`);
  return {
    width: data.readUInt32BE(16),
    height: data.readUInt32BE(20)
  };
}

async function listTextFiles(root) {
  const out = [];
  const textExts = new Set([".json", ".md", ".mjs", ".yaml", ".yml", ".svg", ".txt"]);
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile() && textExts.has(path.extname(entry.name))) out.push(full);
    }
  }
  await visit(root);
  return out;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function assertReferencedAsset(pluginRoot, ref, label, minSquareSize) {
  assert(typeof ref === "string" && ref.length > 0, `${label} must be a relative asset path`);
  assert(!path.isAbsolute(ref), `${label} must not be an absolute path`);
  const relativePath = ref.startsWith("./") ? ref.slice(2) : ref;
  assert(relativePath.startsWith("assets/"), `${label} must reference an asset under ./assets/`);
  assert(!relativePath.split(/[\\/]/).includes(".."), `${label} must not traverse out of plugin assets`);
  const fullPath = path.join(pluginRoot, relativePath);
  assert(existsSync(fullPath), `${label} asset is missing: ${ref}`);

  const ext = path.extname(relativePath);
  assert([".png", ".svg"].includes(ext), `${label} must be a PNG or SVG asset`);
  if (ext === ".png") {
    const { width, height } = await pngDimensions(fullPath);
    assert(width === height, `${label} PNG must be square`);
    assert(width >= minSquareSize, `${label} PNG must be at least ${minSquareSize}x${minSquareSize}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = detectRoot(args.root);
  const pluginRoot = path.join(root, "plugins/codex-chatgpt-control");
  const releaseCanary = path.join(pluginRoot, "runtime/node/codex-chatgpt-control-release-canary.bundle.mjs");
  const marketplacePath = path.join(root, ".agents/plugins/marketplace.json");
  const manifestPath = path.join(pluginRoot, ".codex-plugin/plugin.json");
  const releasePackagePath = existsSync(path.join(root, "tools/public-export/root/package.json"))
    ? path.join(root, "tools/public-export/root/package.json")
    : path.join(root, "package.json");

  const requiredFiles = [
    marketplacePath,
    manifestPath,
    path.join(pluginRoot, "agents/openai.yaml"),
    path.join(pluginRoot, "runtime/import-chatgpt-control.mjs"),
    path.join(pluginRoot, "runtime/node/codex-chatgpt-control.bundle.mjs"),
    path.join(pluginRoot, "runtime/node/codex-chatgpt-control-backend.mjs"),
    path.join(pluginRoot, "runtime/node/codex-chatgpt-control-live-smoke.bundle.mjs"),
    path.join(pluginRoot, "runtime/node/codex-chatgpt-control-release-canary.bundle.mjs"),
    path.join(pluginRoot, "skills/codex-chatgpt-control/SKILL.md"),
    path.join(pluginRoot, "skills/chatgpt-delegate/SKILL.md"),
    path.join(pluginRoot, "skills/chatgpt-pro-consult/SKILL.md")
  ];
  for (const file of requiredFiles) {
    assert(existsSync(file), `Missing required plugin file: ${path.relative(root, file)}`);
  }

  execFileSync(process.execPath, [
    "--input-type=module",
    "--eval",
    `process.argv = undefined; await import(${JSON.stringify(pathToFileURL(releaseCanary).href)});`
  ], { stdio: "pipe" });

  const marketplace = await readJson(marketplacePath);
  assert(marketplace.name === "codex-chatgpt-control", "Marketplace name must be codex-chatgpt-control");
  const entry = marketplace.plugins?.find(plugin => plugin.name === "codex-chatgpt-control");
  assert(entry, "Marketplace must include codex-chatgpt-control entry");
  assert(entry.source?.path === "./plugins/codex-chatgpt-control", "Marketplace plugin path is incorrect");
  assert(entry.policy?.installation === "AVAILABLE", "Marketplace installation policy must be AVAILABLE");
  assert(entry.policy?.authentication === "ON_INSTALL", "Marketplace authentication policy must be ON_INSTALL");

  const manifest = await readJson(manifestPath);
  const releasePackage = await readJson(releasePackagePath);
  assert(manifest.name === "codex-chatgpt-control", "Plugin manifest name mismatch");
  assert(typeof manifest.version === "string", "Plugin manifest version must be a string");
  assert(manifest.version.split("+", 1)[0] === releasePackage.version, "Plugin base version must match the release package version");
  assert(/^\d+\.\d+\.\d+-(?:alpha|beta|rc)\.\d+\+codex\.[a-z0-9-]+$/.test(manifest.version), "Plugin version must contain exactly one +codex.<cachebuster> suffix");
  assert(manifest.skills === "./skills/", "Plugin manifest must point at ./skills/");
  assert(!manifest.mcpServers, "V1 plugin must not declare MCP servers");
  assert(!manifest.apps, "V1 plugin must not declare apps");
  assert(manifest.interface?.defaultPrompt?.length <= 3, "Plugin defaultPrompt must contain at most 3 entries");
  await assertReferencedAsset(pluginRoot, manifest.interface?.logo, "Plugin logo", 256);
  await assertReferencedAsset(pluginRoot, manifest.interface?.composerIcon, "Plugin composerIcon", 64);

  const skillRoot = path.join(pluginRoot, "skills");
  const expectedSkills = ["chatgpt-delegate", "chatgpt-pro-consult", "codex-chatgpt-control"];
  const actualSkills = (await readdir(skillRoot, { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
  assert(JSON.stringify(actualSkills) === JSON.stringify(expectedSkills), `Plugin skill inventory mismatch: ${actualSkills.join(", ")}`);

  const broadSkill = await readFile(path.join(skillRoot, "codex-chatgpt-control/SKILL.md"), "utf8");
  const delegateSkill = await readFile(path.join(skillRoot, "chatgpt-delegate/SKILL.md"), "utf8");
  const proSkill = await readFile(path.join(skillRoot, "chatgpt-pro-consult/SKILL.md"), "utf8");
  validateSkillFrontmatter(broadSkill, "codex-chatgpt-control");
  validateSkillFrontmatter(delegateSkill, "chatgpt-delegate");
  validateSkillFrontmatter(proSkill, "chatgpt-pro-consult");
  assert(broadSkill.includes("name: codex-chatgpt-control"), "Broad skill frontmatter missing name");
  assert(delegateSkill.includes("name: chatgpt-delegate"), "Delegate skill frontmatter missing name");
  assert(proSkill.includes("name: chatgpt-pro-consult"), "Pro skill frontmatter missing name");
  assert(broadSkill.includes("../../runtime/import-chatgpt-control.mjs"), "Broad skill must use plugin runtime loader");
  assert(delegateSkill.includes("../../runtime/import-chatgpt-control.mjs"), "Delegate skill must use plugin runtime loader");
  assert(proSkill.includes("../../runtime/import-chatgpt-control.mjs"), "Pro skill must use plugin runtime loader");
  assert(!proSkill.includes("~/.codex/skills/"), "Pro skill must not depend on an installed skill runtime");

  const agentMetadata = await readFile(path.join(pluginRoot, "agents/openai.yaml"), "utf8");
  assert(agentMetadata.includes('$codex-chatgpt-control'), "agents/openai.yaml default_prompt must explicitly invoke $codex-chatgpt-control");

  const pluginFiles = await listTextFiles(pluginRoot);
  for (const file of pluginFiles) {
    const text = await readFile(file, "utf8");
    assert(!text.includes("[TODO:"), `TODO marker found in ${path.relative(root, file)}`);
  }

  console.log(`Plugin layout is valid at ${pluginRoot}`);
}

function validateSkillFrontmatter(text, expectedName) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  assert(match, `${expectedName} skill must begin with YAML frontmatter`);
  const frontmatter = match[1];
  const rootKeys = frontmatter.split(/\r?\n/)
    .filter(line => /^[A-Za-z][A-Za-z0-9_-]*\s*:/.test(line))
    .map(line => line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:/)?.[1])
    .filter(Boolean);
  assert(JSON.stringify(rootKeys.sort()) === JSON.stringify(["description", "name"]), `${expectedName} skill frontmatter may contain only name and description`);
  assert(new RegExp(`^name:\\s*${expectedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m").test(frontmatter), `${expectedName} skill frontmatter name mismatch`);
  assert(/^description:\s*\S.+$/m.test(frontmatter), `${expectedName} skill frontmatter requires a non-empty description`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
