import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ScenarioGraph } from "./core/types";
import { discoverSuite, findScenarioFiles } from "./scenario-discovery";

const roots: string[] = [];
const scenario = (id: string): ScenarioGraph => ({ id, title: id, nodes: [{ id: "start", title: "Start", kind: "fixture" }], edges: [] });

describe("scenario discovery", () => {
  afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true }))));

  it("finds baekstage files recursively and ignores generated directories", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "baekstage-discovery-")); roots.push(root);
    await mkdir(path.join(root, "e2e")); await mkdir(path.join(root, "node_modules")); await mkdir(path.join(root, ".next-baekstage")); await mkdir(path.join(root, ".worktrees"));
    await writeFile(path.join(root, "e2e", "signup.baekstage.ts"), "export default {}");
    await writeFile(path.join(root, "e2e", "signup.bs.ts"), "export default {}");
    await writeFile(path.join(root, "node_modules", "hidden.baekstage.ts"), "export default {}");
    await writeFile(path.join(root, ".next-baekstage", "generated.baekstage.ts"), "export default {}");
    await writeFile(path.join(root, ".worktrees", "checkout.baekstage.ts"), "export default {}");
    expect((await findScenarioFiles(root)).map((file) => path.relative(root, file))).toEqual(["e2e/signup.baekstage.ts"]);
  });

  it("combines configured and discovered scenarios", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "baekstage-discovery-")); roots.push(root);
    const file = path.join(root, "signup.baekstage.ts"); await writeFile(file, "export default {}");
    const suite = await discoverSuite(root, { name: "App", scenarios: [scenario("configured")] }, async () => scenario("signup"));
    expect(suite.scenarios.map(({ id }) => id)).toEqual(["configured", "signup"]);
  });

  it("rejects duplicate scenario ids", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "baekstage-discovery-")); roots.push(root);
    await writeFile(path.join(root, "duplicate.baekstage.ts"), "export default {}");
    await expect(discoverSuite(root, { name: "App", scenarios: [scenario("same")] }, async () => scenario("same"))).rejects.toThrow("Duplicate scenario id: same");
  });
});
