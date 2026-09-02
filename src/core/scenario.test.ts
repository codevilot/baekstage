import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { defineConfig } from "../config";
import { DOM_SNAPSHOT_CONTENT_TYPE, markElementScreenshot, markScreenshot, readDomSnapshotMark, readScreenshotMark, screenshotMarkName } from "../playwright/mark-screenshot";
import { artifactMatchesEdge, screenshotsForNode } from "./artifacts";
import { defineScenario, filterScenario, mergeResult } from "./scenario";

const graph = defineScenario({
  id: "sample",
  title: "Sample",
  nodes: [
    { id: "fixture", title: "Fixture", kind: "fixture" },
    { id: "admin", title: "Admin screen", kind: "screen", facets: { role: ["Admin"] } },
    { id: "customer", title: "Customer screen", kind: "screen", facets: { role: ["Customer"] } },
  ],
  edges: [
    { id: "a", source: "fixture", target: "admin" },
    { id: "b", source: "fixture", target: "customer" },
  ],
});

describe("scenario graph", () => {
  it("round-trips marked screenshot metadata", () => {
    const mark = { label: "Approval", nodeId: "review", category: "Checkpoint", important: true };
    expect(readScreenshotMark(screenshotMarkName(mark))).toEqual(mark);
  });

  it("captures and marks a locator without requiring Playwright at runtime", async () => {
    const calls: string[] = [];
    await markElementScreenshot(
      { screenshot: async () => new Uint8Array([1, 2, 3]) },
      { attach: async (name) => { calls.push(name); } },
      { label: "Order total", nodeId: "total-after", target: "[data-testid=order-total]" },
    );
    expect(readScreenshotMark(calls[0])).toMatchObject({ nodeId: "total-after", target: "[data-testid=order-total]" });
  });

  it("attaches a DOM snapshot beside a marked page screenshot", async () => {
    const calls: Array<{ name: string; contentType: string; body: unknown }> = [];
    await markScreenshot(
      { evaluate: async <Result,>() => ({ version: 1 as const, url: "https://app.test/review", title: "Review", html: "<!doctype html><p>Loading</p>" }) as Result, screenshot: async () => new Uint8Array([1, 2, 3]) },
      { attach: async (name, options) => { calls.push({ name, ...options }); } },
      { label: "Loading review", nodeId: "loading" },
    );
    expect(calls).toHaveLength(2);
    expect(calls[0].contentType).toBe(DOM_SNAPSHOT_CONTENT_TYPE);
    expect(readDomSnapshotMark(calls[0].name)).toMatchObject({ nodeId: "loading" });
    expect(readScreenshotMark(calls[1].name)).toMatchObject({ nodeId: "loading" });
  });

  it("does not attach unmarked screenshots to a root edge", () => {
    const plain = { label: "debug", url: "/debug.png", type: "screenshot" as const };
    expect(artifactMatchesEdge(plain, null, "bronze")).toBe(false);
    expect(artifactMatchesEdge({ ...plain, nodeId: "bronze" }, null, "bronze")).toBe(true);
  });

  it("keeps same-named nodes separated by scenario id", () => {
    const shot = { label: "customer", url: "/customer.png", type: "screenshot" as const, scenarioId: "lifecycle-2", nodeId: "customer" };
    const lifecycle2 = { id: "lifecycle-2:projection-customer", source: "lifecycle-2:projection", target: "lifecycle-2:customer" };
    const lifecycle3 = { id: "lifecycle-3:projection-customer", source: "lifecycle-3:projection", target: "lifecycle-3:customer" };
    expect(artifactMatchesEdge(shot, lifecycle2, lifecycle2.target)).toBe(true);
    expect(artifactMatchesEdge(shot, lifecycle3, lifecycle3.target)).toBe(false);
  });

  it("opens only screenshots directly marked for the selected node", () => {
    const shots = [
      { label: "before", url: "/before.png", type: "screenshot" as const, nodeId: "total-before" },
      { label: "after", url: "/after.png", type: "screenshot" as const, nodeId: "total-after" },
    ];
    expect(screenshotsForNode("total-before", shots).map((shot) => shot.label)).toEqual(["before"]);
  });
  it("removes dangling edges when arbitrary facets are filtered", () => {
    const visible = filterScenario(graph, { role: new Set(["Admin"]) });
    expect(visible.nodes.map((node) => node.id)).toEqual(["fixture", "admin"]);
    expect(visible.edges.map((edge) => edge.id)).toEqual(["a"]);
  });

  it("supports project-defined facet names without core changes", () => {
    const custom = { ...graph, nodes: graph.nodes.map((node) => ({ ...node, facets: { browser: ["webkit"], tenant: ["enterprise-a"] } })) };
    expect(filterScenario(custom, { browser: new Set(["webkit"]) }).nodes).toHaveLength(3);
    expect(filterScenario(custom, { browser: new Set(["chromium"]) }).nodes).toHaveLength(0);
  });

  it("merges Playwright results without mutating the definition", () => {
    const result = mergeResult(graph, { id: "admin", status: "passed", artifacts: [] });
    expect(result.nodes[1].status).toBe("passed");
    expect(graph.nodes[1].status).toBeUndefined();
  });

  it("rejects edges to unknown nodes", () => {
    expect(() => defineScenario({ id: "bad", title: "Bad", nodes: [], edges: [{ id: "x", source: "missing", target: "also-missing" }] })).toThrow("Unknown edge source");
  });

  it("keeps the standalone config typed without changing its value", () => {
    const config = { suite: { name: "Smoke", scenarios: [graph] }, server: { port: 4173 } };
    expect(defineConfig(config)).toBe(config);
  });

  it("scopes every published stylesheet to Baekstage", async () => {
    const files = ["src/styles.css", "src/galaxy.css", "src/viewer/status.css", "src/viewer/overview/overview-panel.css"];
    for (const file of files) expect(await readFile(file, "utf8")).toMatch(/^@scope \(\.baekstage-root, \.baekstage-portal\)/);
  });
});
