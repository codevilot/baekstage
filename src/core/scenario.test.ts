import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { defineConfig } from "../config";
import { DOM_SNAPSHOT_CONTENT_TYPE, markElementScreenshot, markScreenshot, readDomSnapshotMark, readScreenshotMark, screenshotMarkName } from "../playwright/mark-screenshot";
import { artifactMatchesEdge, screenshotsForNode } from "./artifacts";
import { composeScenario, definePart, defineScenario, filterScenario, materializeScenario, mergeResult, scenarioEditWarnings } from "./scenario";

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

  it("composes and repeats reusable Parts with namespaced nodes", () => {
    const login = definePart({ id: "login", title: "Login", nodes: [{ id: "form", title: "Form", kind: "screen" }, { id: "done", title: "Done", kind: "outcome" }], edges: [{ id: "submit", source: "form", target: "done" }] });
    const drag = definePart({ id: "drag", title: "Drag", nodes: [{ id: "start", title: "Start", kind: "action" }, { id: "end", title: "End", kind: "outcome" }], edges: [{ id: "move", source: "start", target: "end" }] });
    const composed = composeScenario({ id: "login-drag", title: "Login and drag", parts: [{ part: login }, { part: drag, repeat: 2 }] });
    expect(composed.nodes.map((node) => node.id)).toEqual(["login-1-1:form", "login-1-1:done", "drag-2-1:start", "drag-2-1:end", "drag-2-2:start", "drag-2-2:end"]);
    expect(composed.edges.filter((edge) => edge.label === "next Part")).toHaveLength(2);
    expect(composed.nodes[2].metadata).toMatchObject({ partId: "drag", partOccurrence: 2, repeat: 1 });
  });

  it("keeps manual Nodes distinct while materializing reusable Part instances", () => {
    const part = definePart({ id: "login", title: "Login", nodes: [{ id: "form", title: "Form", kind: "screen" }], edges: [] });
    const result = materializeScenario({ id: "editable", title: "Editable", items: [
      { id: "node-a", type: "node", node: { id: "a", title: "A", kind: "fixture" } },
      { id: "node-b", type: "node", node: { id: "b", title: "B", kind: "action" } },
      { id: "login-instance", type: "part", partId: "login", repeat: 2 },
    ], edges: [{ id: "manual-branch", source: "a", target: "b", branch: true }] }, [part]);
    expect(result.edges.filter((edge) => edge.source === "a" && edge.target === "b")).toEqual([expect.objectContaining({ id: "manual-branch", branch: true })]);
    expect(result.nodes.filter((node) => node.metadata?.partId === "login")).toHaveLength(2);
    expect(new Set(result.edges.map((edge) => edge.id)).size).toBe(result.edges.length);
    expect(result.composition?.items).toEqual([expect.objectContaining({ type: "node", nodeId: "a" }), expect.objectContaining({ type: "node", nodeId: "b" }), expect.objectContaining({ type: "part", partId: "login", repeat: 2 })]);
  });

  it("turns Part outcomes into labeled graph branches and suppresses the default next edge", () => {
    const part = definePart({ id: "login", title: "Login", outcomes: [{ id: "authenticated", title: "Authenticated" }, { id: "denied", title: "Denied" }], nodes: [{ id: "result", title: "Result", kind: "outcome" }], edges: [] });
    const result = materializeScenario({ id: "routed", title: "Routed", items: [
      { id: "login-item", type: "part", partId: "login" },
      { id: "success-item", type: "node", node: { id: "success", title: "Success", kind: "screen" } },
      { id: "denied-item", type: "node", node: { id: "denied", title: "Denied", kind: "outcome" } },
    ], routes: [
      { fromItemId: "login-item", outcome: "authenticated", toItemId: "success-item" },
      { fromItemId: "login-item", outcome: "denied", toItemId: "denied-item" },
    ] }, [part]);
    expect(result.edges.filter((edge) => edge.branch).map((edge) => edge.label)).toEqual(["authenticated", "denied"]);
    expect(result.edges.some((edge) => edge.source === "login-item:result" && edge.label === "next")).toBe(false);
    expect(result.composition?.routes).toHaveLength(2);
  });

  it("validates Part variables and duplicate routes without breaking undeclared legacy options", () => {
    const typed = definePart({ id: "typed", title: "Typed", inputs: [{ id: "email", title: "Email", type: "string", required: true }], nodes: [{ id: "done", title: "Done", kind: "outcome" }], edges: [] });
    expect(() => materializeScenario({ id: "missing", title: "Missing", items: [{ id: "part", type: "part", partId: "typed" }] }, [typed])).toThrow("expected string (required)");
    expect(() => materializeScenario({ id: "wrong", title: "Wrong", items: [{ id: "part", type: "part", partId: "typed", inputs: { email: 3 } }] }, [typed])).toThrow("expected string");
    const legacy = definePart({ id: "legacy", title: "Legacy", nodes: [{ id: "done", title: "Done", kind: "outcome" }], edges: [] });
    expect(materializeScenario({ id: "legacy-options", title: "Legacy options", items: [{ id: "part", type: "part", partId: "legacy", inputs: { custom: true } }] }, [legacy]).nodes).toHaveLength(1);
    const routed = definePart({ ...legacy, outcomes: [{ id: "done", title: "Done" }] });
    expect(() => materializeScenario({ id: "duplicate", title: "Duplicate", items: [{ id: "part", type: "part", partId: "legacy" }, { id: "end", type: "node", node: { id: "end", title: "End", kind: "outcome" } }], routes: [{ fromItemId: "part", outcome: "done", toItemId: "end" }, { fromItemId: "part", outcome: "done", toItemId: "end" }] }, [routed])).toThrow("Duplicate route");
  });

  it("warns about cyclic outcome routes while retaining guarded runtime support", () => {
    const draft = { id: "cycle", title: "Cycle", items: [{ id: "a", type: "part" as const, partId: "a" }, { id: "b", type: "part" as const, partId: "b" }], routes: [{ fromItemId: "a", outcome: "next", toItemId: "b" }, { fromItemId: "b", outcome: "again", toItemId: "a" }] };
    expect(scenarioEditWarnings(draft)).toEqual([expect.stringContaining("순환")]);
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
