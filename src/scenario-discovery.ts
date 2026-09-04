import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { ScenarioGraph, ScenarioPart, ScenarioSuite } from "./core/types";
import { defineSuite, validatePart } from "./core/scenario";

const ignoredDirectories = new Set([".baekstage", ".git", ".worktrees", "dist", "dist-lib", "node_modules", "out", "playwright-report", "test-results"]);
const defaultIncludes = [
  "**/*.baekstage.ts",
  "**/*.baekstage.mts",
  "**/*.baekstage.js",
  "**/*.baekstage.mjs",
  "**/baekstage.scenario.ts",
  "**/baekstage.scenario.mts",
  "**/baekstage.scenario.js",
  "**/baekstage.scenario.mjs",
  "**/*.baekstage.scenario.ts",
  "**/*.baekstage.scenario.mts",
  "**/*.baekstage.scenario.js",
  "**/*.baekstage.scenario.mjs",
];
const defaultPartIncludes = [
  "**/*.baekstage.part.ts", "**/*.baekstage.part.mts", "**/*.baekstage.part.js", "**/*.baekstage.part.mjs",
  "**/baekstage.part.ts", "**/baekstage.part.mts", "**/baekstage.part.js", "**/baekstage.part.mjs",
];

export type ScenarioDiscoveryOptions = { include?: string[]; exclude?: string[]; ignorePermissionErrors?: boolean };

function normalizePath(value: string) {
  return value.replaceAll("\\", "/").replace(/^\.\//, "");
}

function globExpression(pattern: string) {
  const normalized = normalizePath(pattern);
  let expression = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === "*" && normalized[index + 1] === "*") {
      index += 1;
      if (normalized[index + 1] === "/") {
        index += 1;
        expression += "(?:.*/)?";
      } else expression += ".*";
    } else if (character === "*") expression += "[^/]*";
    else if (character === "?") expression += "[^/]";
    else expression += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  return new RegExp(`${expression}$`);
}

export function matchesScenarioDefinition(
  relativePath: string,
  options: ScenarioDiscoveryOptions = {},
) {
  const normalized = normalizePath(relativePath);
  const includes = (options.include?.length ? options.include : defaultIncludes).map(globExpression);
  return includes.some((pattern) => pattern.test(normalized));
}

export function matchesPartDefinition(relativePath: string) {
  const normalized = normalizePath(relativePath);
  return defaultPartIncludes.map(globExpression).some((pattern) => pattern.test(normalized));
}

function isPermissionError(error: unknown) {
  return error instanceof Error && "code" in error && ["EACCES", "EPERM"].includes(String(error.code));
}

export async function findScenarioFiles(root: string, options: ScenarioDiscoveryOptions = {}): Promise<string[]> {
  const found: string[] = [];
  const excluded = new Set((options.exclude ?? []).map((item) => normalizePath(item).replace(/\/$/, "")));
  async function visit(directory: string): Promise<void> {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) {
      if (options.ignorePermissionErrors && isPermissionError(error)) return;
      throw error;
    }
    await Promise.all(entries.map(async (entry) => {
      if (entry.isDirectory()) {
        const child = path.join(directory, entry.name);
        const relative = path.relative(root, child).replaceAll("\\", "/");
        if (!ignoredDirectories.has(entry.name) && !entry.name.startsWith(".next") && !excluded.has(entry.name) && !excluded.has(relative)) await visit(child);
      } else if (entry.isFile()) {
        const file = path.join(directory, entry.name);
        const relative = normalizePath(path.relative(root, file));
        if (!matchesPartDefinition(relative) && matchesScenarioDefinition(relative, options)) found.push(file);
      }
    }));
  }
  await visit(root);
  return found.sort();
}

export async function findPartFiles(root: string, options: Pick<ScenarioDiscoveryOptions, "exclude" | "ignorePermissionErrors"> = {}): Promise<string[]> {
  return findFiles(root, matchesPartDefinition, options);
}

async function findFiles(root: string, matches: (relative: string) => boolean, options: Pick<ScenarioDiscoveryOptions, "exclude" | "ignorePermissionErrors">): Promise<string[]> {
  const found: string[] = [];
  const excluded = new Set((options.exclude ?? []).map((item) => normalizePath(item).replace(/\/$/, "")));
  async function visit(directory: string): Promise<void> {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) { if (options.ignorePermissionErrors && isPermissionError(error)) return; throw error; }
    await Promise.all(entries.map(async (entry) => {
      if (entry.isDirectory()) {
        const child = path.join(directory, entry.name); const relative = normalizePath(path.relative(root, child));
        if (!ignoredDirectories.has(entry.name) && !entry.name.startsWith(".next") && !excluded.has(entry.name) && !excluded.has(relative)) await visit(child);
      } else if (entry.isFile()) {
        const file = path.join(directory, entry.name);
        if (matches(normalizePath(path.relative(root, file)))) found.push(file);
      }
    }));
  }
  await visit(root);
  return found.sort();
}

function resolveDefinitionRelativeSource(scenario: ScenarioGraph, file: string): ScenarioGraph {
  const execution = scenario.execution;
  const playwrightExecution = execution && "adapter" in execution && execution.adapter === "playwright" ? execution : undefined;
  const source = playwrightExecution?.source ?? scenario.source;
  if (!source?.startsWith("./") && !source?.startsWith("../")) return { ...scenario, definitionSource: file };
  const resolved = path.resolve(path.dirname(file), source);
  if (playwrightExecution) {
    return { ...scenario, definitionSource: file, execution: { ...playwrightExecution, source: resolved } };
  }
  return { ...scenario, definitionSource: file, source: resolved };
}

async function scenarioEdits(root: string) {
  const directory = path.join(root, ".baekstage", "scenario-edits");
  try {
    const files = (await readdir(directory)).filter((file) => file.endsWith(".json")); const edits = new Map<string, ScenarioGraph>();
    for (const file of files) try { const graph = JSON.parse(await readFile(path.join(directory, file), "utf8")) as ScenarioGraph; if (graph?.id) edits.set(graph.id, graph); } catch {}
    return edits;
  } catch (error) { if (isPermissionError(error) || (error instanceof Error && "code" in error && error.code === "ENOENT")) return new Map<string, ScenarioGraph>(); throw error; }
}

function scenariosFromExport(value: unknown, file: string): ScenarioGraph[] {
  const scenarios = Array.isArray(value) ? value : [value];
  if (scenarios.some((item) => !item || typeof item !== "object")) {
    throw new Error(`${path.relative(process.cwd(), file)} must default-export a scenario or an array of scenarios`);
  }
  return (scenarios as ScenarioGraph[]).map((scenario) => resolveDefinitionRelativeSource(scenario, file));
}

export async function discoverSuite(
  root: string,
  configured: ScenarioSuite | undefined,
  load: (file: string) => Promise<unknown>,
  options: ScenarioDiscoveryOptions = {},
): Promise<ScenarioSuite> {
  const files = await findScenarioFiles(root, options);
  const discovered = (await Promise.all(files.map(async (file) => scenariosFromExport(await load(file), file)))).flat();
  const partFiles = await findPartFiles(root, options);
  const discoveredParts = (await Promise.all(partFiles.map(async (file) => {
    const value = await load(file);
    if (!value || typeof value !== "object") throw new Error(`${path.relative(process.cwd(), file)} must default-export a ScenarioPart`);
    const part = { ...(value as ScenarioPart), source: file };
    validatePart(part);
    return part;
  })));
  const edits = await scenarioEdits(root);
  const baseScenarios = [...(configured?.scenarios ?? []), ...discovered]; const baseIds = new Set(baseScenarios.map((scenario) => scenario.id));
  const scenarios = [...baseScenarios.map((scenario) => edits.get(scenario.id) ?? scenario), ...[...edits.values()].filter((scenario) => !baseIds.has(scenario.id))];
  const seen = new Set<string>();
  for (const scenario of scenarios) {
    if (seen.has(scenario.id)) throw new Error(`Duplicate scenario id: ${scenario.id}`);
    seen.add(scenario.id);
  }
  const parts = [...(configured?.parts ?? []), ...discoveredParts];
  if (!scenarios.length && !parts.length) throw new Error("No scenarios or Parts found. Create a matching definition file or configure suite.scenarios/suite.parts.");
  const seenParts = new Set<string>();
  for (const part of parts) { if (seenParts.has(part.id)) throw new Error(`Duplicate Part id: ${part.id}`); seenParts.add(part.id); }
  return defineSuite({ name: configured?.name?.trim() || path.basename(root), generatedAt: configured?.generatedAt, parts, scenarios });
}
