import { readdir } from "node:fs/promises";
import path from "node:path";
import type { ScenarioGraph, ScenarioSuite } from "./core/types";
import { defineSuite } from "./core/scenario";

const ignoredDirectories = new Set([".baekstage", ".git", "dist", "dist-lib", "node_modules", "test-results"]);
const scenarioFile = /\.baekstage\.(?:ts|mts|js|mjs)$/;

export async function findScenarioFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    await Promise.all(entries.map(async (entry) => {
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) await visit(path.join(directory, entry.name));
      } else if (entry.isFile() && scenarioFile.test(entry.name)) found.push(path.join(directory, entry.name));
    }));
  }
  await visit(root);
  return found.sort();
}

function scenariosFromExport(value: unknown, file: string): ScenarioGraph[] {
  const scenarios = Array.isArray(value) ? value : [value];
  if (scenarios.some((item) => !item || typeof item !== "object")) {
    throw new Error(`${path.relative(process.cwd(), file)} must default-export a scenario or an array of scenarios`);
  }
  return scenarios as ScenarioGraph[];
}

export async function discoverSuite(
  root: string,
  configured: ScenarioSuite | undefined,
  load: (file: string) => Promise<unknown>,
): Promise<ScenarioSuite> {
  const files = await findScenarioFiles(root);
  const discovered = (await Promise.all(files.map(async (file) => scenariosFromExport(await load(file), file)))).flat();
  const scenarios = [...(configured?.scenarios ?? []), ...discovered];
  if (!scenarios.length) throw new Error("No scenarios found. Create a *.baekstage.ts file or configure suite.scenarios.");
  const seen = new Set<string>();
  for (const scenario of scenarios) {
    if (seen.has(scenario.id)) throw new Error(`Duplicate scenario id: ${scenario.id}`);
    seen.add(scenario.id);
  }
  return defineSuite({ name: configured?.name?.trim() || path.basename(root), generatedAt: configured?.generatedAt, scenarios });
}
