import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ScenarioGraph } from "./core/types";
import { discoverSuite, findPartFiles, findScenarioFiles, matchesPartDefinition, matchesScenarioDefinition } from "./scenario-discovery";

const roots: string[] = [];
const scenario = (id: string): ScenarioGraph => ({ id, title: id, nodes: [{ id: "start", title: "Start", kind: "fixture" }], edges: [] });

describe("scenario discovery", () => {
  afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true }))));

  it("finds baekstage files recursively and ignores generated directories", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "baekstage-discovery-")); roots.push(root);
    await mkdir(path.join(root, "e2e")); await mkdir(path.join(root, "node_modules")); await mkdir(path.join(root, ".next-baekstage")); await mkdir(path.join(root, ".worktrees"));
    await writeFile(path.join(root, "e2e", "signup.baekstage.ts"), "export default {}");
    await mkdir(path.join(root, "e2e", "checkout"));
    await writeFile(path.join(root, "e2e", "checkout", "baekstage.scenario.ts"), "export default {}");
    await writeFile(path.join(root, "e2e", "checkout", "baekstage.spec.ts"), "export default {}");
    await writeFile(path.join(root, "e2e", "signup.bs.ts"), "export default {}");
    await writeFile(path.join(root, "node_modules", "hidden.baekstage.ts"), "export default {}");
    await writeFile(path.join(root, ".next-baekstage", "generated.baekstage.ts"), "export default {}");
    await writeFile(path.join(root, ".worktrees", "checkout.baekstage.ts"), "export default {}");
    expect((await findScenarioFiles(root)).map((file) => path.relative(root, file))).toEqual([
      "e2e/checkout/baekstage.scenario.ts",
      "e2e/signup.baekstage.ts",
    ]);
  });

  it("supports semantic definition names through discovery include globs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "baekstage-discovery-")); roots.push(root);
    await mkdir(path.join(root, "month-close"));
    await mkdir(path.join(root, "checkout"));
    await writeFile(path.join(root, "month-close", "scenario.ts"), "export default {}");
    await writeFile(path.join(root, "month-close", "journey.spec.ts"), "export default {}");
    await writeFile(path.join(root, "checkout", "checkout.scenario.ts"), "export default {}");
    expect((await findScenarioFiles(root, { include: ["**/scenario.ts", "**/*.scenario.ts"] })).map((file) => path.relative(root, file))).toEqual([
      "checkout/checkout.scenario.ts",
      "month-close/scenario.ts",
    ]);
  });

  it("matches default and custom definition paths for CLI live discovery", () => {
    expect(matchesScenarioDefinition("checkout/baekstage.scenario.ts")).toBe(true);
    expect(matchesScenarioDefinition("checkout/baekstage.spec.ts")).toBe(false);
    expect(matchesScenarioDefinition("month-close/scenario.ts", { include: ["**/scenario.ts"] })).toBe(true);
    expect(matchesPartDefinition("parts/login.baekstage.part.ts")).toBe(true);
  });

  it("discovers Part files separately and records their executable source", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "baekstage-discovery-")); roots.push(root);
    await writeFile(path.join(root, "login.baekstage.part.ts"), "export default {}");
    await writeFile(path.join(root, "checkout.baekstage.ts"), "export default {}");
    expect((await findPartFiles(root)).map((file) => path.basename(file))).toEqual(["login.baekstage.part.ts"]);
    const suite = await discoverSuite(root, undefined, async (file) => file.endsWith(".part.ts") ? ({ id: "login", title: "Login", nodes: [{ id: "form", title: "Form", kind: "screen" }], edges: [] }) : scenario("checkout"));
    expect(suite.parts).toEqual([expect.objectContaining({ id: "login", source: path.join(root, "login.baekstage.part.ts") })]);
  });

  it("can start a Compose-only workspace from Parts", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "baekstage-discovery-")); roots.push(root);
    await writeFile(path.join(root, "login.baekstage.part.ts"), "export default {}");
    const suite = await discoverSuite(root, undefined, async () => ({ id: "login", title: "Login", nodes: [{ id: "form", title: "Form", kind: "screen" }], edges: [] }));
    expect(suite.scenarios).toEqual([]); expect(suite.parts).toHaveLength(1);
  });

  it("reapplies persisted UI edits without overwriting the authored definition", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "baekstage-discovery-")); roots.push(root);
    await writeFile(path.join(root, "checkout.baekstage.ts"), "export default {}");
    await mkdir(path.join(root, ".baekstage", "scenario-edits"), { recursive: true });
    await writeFile(path.join(root, ".baekstage", "scenario-edits", "checkout.json"), JSON.stringify({ ...scenario("checkout"), title: "Edited checkout" }));
    const suite = await discoverSuite(root, undefined, async () => scenario("checkout"));
    expect(suite.scenarios[0].title).toBe("Edited checkout");
  });

  it("combines configured and discovered scenarios", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "baekstage-discovery-")); roots.push(root);
    const file = path.join(root, "signup.baekstage.ts"); await writeFile(file, "export default {}");
    const suite = await discoverSuite(root, { name: "App", scenarios: [scenario("configured")] }, async () => scenario("signup"));
    expect(suite.scenarios.map(({ id }) => id)).toEqual(["configured", "signup"]);
  });

  it("resolves a Playwright source relative to its scenario definition", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "baekstage-discovery-")); roots.push(root);
    const directory = path.join(root, "month-close"); await mkdir(directory);
    const file = path.join(directory, "baekstage.scenario.ts"); await writeFile(file, "export default {}");
    const suite = await discoverSuite(root, undefined, async () => ({
      ...scenario("month-close"),
      execution: { adapter: "playwright", source: "./baekstage.spec.ts", grep: "month close" },
    }));
    expect(suite.scenarios[0].execution).toEqual({
      adapter: "playwright",
      source: path.join(directory, "baekstage.spec.ts"),
      grep: "month close",
    });
  });

  it("supports custom excluded directory names and root-relative paths", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "baekstage-discovery-")); roots.push(root);
    await mkdir(path.join(root, "apps", "ignored"), { recursive: true });
    await mkdir(path.join(root, "private"));
    await mkdir(path.join(root, "included"));
    await writeFile(path.join(root, "apps", "ignored", "app.baekstage.ts"), "export default {}");
    await writeFile(path.join(root, "private", "private.baekstage.ts"), "export default {}");
    await writeFile(path.join(root, "included", "included.baekstage.ts"), "export default {}");
    expect((await findScenarioFiles(root, { exclude: ["apps/ignored", "private"] })).map((file) => path.relative(root, file))).toEqual(["included/included.baekstage.ts"]);
  });

  it("rejects duplicate scenario ids", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "baekstage-discovery-")); roots.push(root);
    await writeFile(path.join(root, "duplicate.baekstage.ts"), "export default {}");
    await expect(discoverSuite(root, { name: "App", scenarios: [scenario("same")] }, async () => scenario("same"))).rejects.toThrow("Duplicate scenario id: same");
  });
});
