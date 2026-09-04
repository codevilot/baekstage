import { afterEach, describe, expect, it } from "vitest";
import { createServer as createHttpServer, type Server } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { parseOpenApiDocument } from "../openapi/catalog";
import { baekstagePlugin, generatedCompositionSpec, generatedEditorSpec, generatedScenarioModule, playwrightStepNodeResults, resultAssetUrl } from "./scenario-plugin";
import type { ScenarioSuite } from "../core/types";

describe("Vite API runner integration", () => {
  let target: Server | undefined; let vite: ViteDevServer | undefined; const directories: string[] = [];
  afterEach(async () => { await vite?.close(); target?.close(); await Promise.all(directories.splice(0).map((item) => rm(item, { recursive: true }))); });
  it("validates scenario cases, persists redacted branch results, and serves history", async () => {
    target = createHttpServer((_req, res) => { res.writeHead(409, { "content-type": "application/json", "set-cookie": "session=secret" }); res.end(JSON.stringify({ code: "CONFLICT" })); }); await new Promise<void>((resolve) => target!.listen(0, "127.0.0.1", resolve)); const address = target.address(); const baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    const operation = parseOpenApiDocument({ id: "api", title: "API", baseUrl }, { openapi: "3.0.3", paths: { "/jobs/{id}": { post: { responses: { "409": { description: "Conflict", content: { "application/json": { schema: { type: "object", required: ["code"] } } } } } } } } }).operations[0];
    const suite: ScenarioSuite = { name: "Suite", scenarios: [{ id: "scenario", title: "Scenario", nodes: [{ id: "api-node", title: "API", kind: "api", ref: operation.id, cases: [{ id: "conflict", title: "Conflict", expectedResponse: "409", request: { path: { id: "conflict" } }, assertions: [{ type: "status", equals: 409 }] }] }], edges: [] }] };
    const root = await mkdtemp(path.join(tmpdir(), "baekstage-vite-")); directories.push(root); vite = await createViteServer({ root, configFile: false, logLevel: "silent", plugins: [baekstagePlugin({ projectRoot: root, resultRoot: path.join(root, "results"), maxRunsPerNode: 2, catalog: { operations: [operation] }, apiSources: [{ id: "api", baseUrl }], suite })], server: { host: "127.0.0.1", port: 0 } }); await vite.listen(); const info = vite.httpServer?.address(); const origin = `http://127.0.0.1:${typeof info === "object" && info ? info.port : 0}`;
    const response = await fetch(`${origin}/api/operations/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceId: "api", operationId: operation.id, scenarioId: "scenario", nodeId: "api-node", caseId: "conflict", path: { id: "conflict" }, headers: { Authorization: "Bearer top-secret" }, body: { password: "body-secret" } }) }); const result = await response.json(); expect(result.nodeResults[0]).toMatchObject({ status: "passed", caseId: "conflict", api: { response: { status: 409, branchId: `${operation.id}:response:409` } } });
    const history = await (await fetch(`${origin}/api/operations/history/scenario/api-node`)).json(); expect(history).toHaveLength(1); expect(JSON.stringify(history)).not.toContain("top-secret"); expect(JSON.stringify(history)).not.toContain("body-secret"); expect(JSON.stringify(history)).not.toContain("session=secret");
    const payload = { sourceId: "api", operationId: operation.id, scenarioId: "scenario", nodeId: "api-node", caseId: "conflict", path: { id: "conflict" } }; await Promise.all([1, 2, 3].map(() => fetch(`${origin}/api/operations/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }))); const directory = path.join(root, "results", "scenario", "api", "api-node"); await mkdir(directory, { recursive: true }); await writeFile(path.join(directory, "broken.json"), "{partial"); const retained = await (await fetch(`${origin}/api/operations/history/scenario/api-node`)).json(); expect(retained).toHaveLength(2); expect(retained[0].finishedAt <= retained[1].finishedAt).toBe(true);
    const traversal = await fetch(`${origin}/api/operations/history/${encodeURIComponent("../../outside")}/${encodeURIComponent("../node")}`); expect(traversal.status).toBe(200);
    const denied = await fetch(`${origin}/api/operations/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceId: "api", operationId: operation.id, scenarioId: "scenario", nodeId: "other" }) }); expect(denied.status).toBe(403);
  });

  it("runs a composition draft and only then writes its scenario files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "baekstage-compose-")); directories.push(root);
    const partFile = path.join(root, "login.baekstage.part.ts"); const runner = path.join(root, "fake-runner.mjs");
    await writeFile(partFile, 'export async function run(page) { await page.goto("/"); }');
    await writeFile(runner, 'console.log(JSON.stringify({ suites: [] }));');
    const suite: ScenarioSuite = { name: "Compose", parts: [{ id: "login", title: "Login", source: partFile, nodes: [{ id: "form", title: "Form", kind: "screen" }], edges: [] }], scenarios: [] };
    vite = await createViteServer({ root, configFile: false, logLevel: "silent", plugins: [baekstagePlugin({ projectRoot: root, resultRoot: path.join(root, "results"), command: process.execPath, commandArgs: [runner], suite })], server: { host: "127.0.0.1", port: 0 } });
    await vite.listen(); const info = vite.httpServer?.address(); const origin = `http://127.0.0.1:${typeof info === "object" && info ? info.port : 0}`;
    const response = await fetch(`${origin}/api/compositions/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "login-twice", title: "Login twice", items: [{ partId: "login", repeat: 2 }] }) });
    const value = await response.json(); expect(response.status, JSON.stringify(value)).toBe(201); expect(value.scenario.nodes).toHaveLength(2);
    const generated = path.join(root, "baekstage.generated", "login-twice");
    expect(await (await import("node:fs/promises")).readFile(path.join(generated, "scenario.spec.ts"), "utf8")).toContain("part1(page)");
    expect(await (await import("node:fs/promises")).readFile(path.join(generated, "baekstage.scenario.ts"), "utf8")).toContain("defineScenario");
    const edited = await fetch(`${origin}/api/scenario-editor/save`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "login-twice", title: "Login edited", definitionSource: value.scenario.definitionSource, execution: value.scenario.execution, edges: value.scenario.edges, items: [{ id: "login-part", type: "part", partId: "login", repeat: 3 }] }) });
    expect(edited.status, await edited.clone().text()).toBe(200); expect((await edited.json()).scenario.composition.items[0]).toMatchObject({ partId: "login", repeat: 3 });
    expect((await (await import("node:fs/promises")).readFile(path.join(generated, "scenario.spec.ts"), "utf8")).match(/part1\(page\)/g)).toHaveLength(3);
    const stableSpec = await (await import("node:fs/promises")).readFile(path.join(generated, "scenario.spec.ts"), "utf8");
    await writeFile(runner, "process.exit(1);");
    const rejected = await fetch(`${origin}/api/scenario-editor/save`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "login-twice", title: "Broken edit", items: [{ id: "login-part", type: "part", partId: "login" }], edges: [] }) });
    expect(rejected.status).toBe(422); expect(await (await import("node:fs/promises")).readFile(path.join(generated, "scenario.spec.ts"), "utf8")).toBe(stableSpec);
    const created = await fetch(`${origin}/api/scenario-editor/save`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: "manual-created", title: "Manual created", items: [{ id: "manual-start", type: "node", node: { id: "start", title: "Start", kind: "fixture" } }], edges: [] }) });
    expect(created.status).toBe(200); expect((await created.json()).scenario.nodes[0]).toMatchObject({ id: "start", title: "Start" });
    expect(await (await import("node:fs/promises")).readFile(path.join(root, "baekstage.generated", "manual-created", "baekstage.scenario.ts"), "utf8")).toContain("Manual created");
  });
});

describe("Playwright result asset URLs", () => {
  it("generates a same-page Playwright spec with repeated Part steps", () => {
    const file = "/repo/e2e/generated/scenario.spec.ts";
    const spec = generatedCompositionSpec({ id: "login-drag", title: "Login then drag", items: [{ partId: "login", inputs: { email: "user@example.com" }, expectations: { heading: "Home" } }, { partId: "drag", repeat: 2 }] }, [
      { id: "login", title: "Login", source: "/repo/e2e/parts/login.baekstage.part.ts", execute: "run", inputs: [{ id: "email", title: "Email", type: "string" }], expectations: [{ id: "heading", title: "Heading", type: "string" }], nodes: [], edges: [] },
      { id: "drag", title: "Drag", source: "/repo/e2e/parts/drag.baekstage.part.ts", execute: "perform", nodes: [], edges: [] },
    ], file);
    expect(spec).toContain('import { run as part1 } from "../parts/login.baekstage.part"');
    expect(spec).toContain('import { perform as part2 } from "../parts/drag.baekstage.part"');
    expect(spec.match(/part2\(page\)/g)).toHaveLength(2);
    expect(spec).toContain('"inputs":{"email":"user@example.com"}');
    expect(spec).toContain('"expectations":{"heading":"Home"}');
    expect(spec).toContain('test("Login then drag", async ({ page })');
    expect(generatedScenarioModule({ id: "x", title: "X", nodes: [], edges: [] })).toContain("defineScenario");
  });

  it("dispatches declared Part outcomes while legacy Parts remain one-argument calls", () => {
    const parts = [
      { id: "login", title: "Login", source: "/repo/login.baekstage.part.ts", outcomes: [{ id: "authenticated", title: "Authenticated" }, { id: "denied", title: "Denied" }], nodes: [], edges: [] },
      { id: "checkout", title: "Checkout", source: "/repo/checkout.baekstage.part.ts", nodes: [], edges: [] },
    ];
    const spec = generatedEditorSpec({ id: "branch", title: "Branch", items: [
      { id: "login-item", type: "part", partId: "login" },
      { id: "denied-node", type: "node", node: { id: "denied", title: "Denied", kind: "outcome" } },
      { id: "checkout-item", type: "part", partId: "checkout" },
    ], routes: [{ fromItemId: "login-item", outcome: "authenticated", toItemId: "checkout-item" }, { fromItemId: "login-item", outcome: "denied", toItemId: "denied-node" }] }, parts, "/repo/generated/scenario.spec.ts");
    expect(spec).toContain('if (outcome === "authenticated") current = "checkout-item"');
    expect(spec).toContain('else if (outcome === "denied") current = "denied-node"');
    expect(spec).toContain("Unexpected outcome");
    expect(spec).toContain("(page)); outcome = result?.outcome");
    expect(spec).toContain('case "denied-node"');
    expect(spec).toContain("baekstage-path:");
    expect(spec).toContain("executionPath.itemIds.push(current)");
    expect(spec).toContain("finally");
  });
  it("applies a completed terminal branch step without requiring an API request or outgoing edge", () => {
    const suite: ScenarioSuite = { name: "Branch", scenarios: [{ id: "branch", title: "Branch", nodes: [1, 2, 3, 4, 5].map((id) => ({ id: String(id), title: String(id), kind: "screen" as const })), edges: [{ id: "1-2", source: "1", target: "2" }, { id: "2-3", source: "2", target: "3" }, { id: "3-4", source: "3", target: "4", branch: true }, { id: "3-5", source: "3", target: "5", branch: true }] }] };
    const results = playwrightStepNodeResults([{ scenarioId: "branch", records: [{ marker: { id: "5" }, status: "passed", startedAt: "2026-01-01T00:00:00Z", finishedAt: "2026-01-01T00:00:01Z", durationMs: 1_000 }] }], suite, "run-branch");
    expect(results).toEqual([{ runId: "run-branch", origin: "playwright", nodeId: "5", caseId: undefined, status: "passed", durationMs: 1_000, startedAt: "2026-01-01T00:00:00Z", finishedAt: "2026-01-01T00:00:01Z", error: undefined }]);
  });

  it("cache-busts overwritten screenshots and traces with the run ID", () => {
    expect(resultAssetUrl("/scenario-results", "month-close", "1.png", "run/next")).toBe("/scenario-results/month-close/1.png?run=run%2Fnext");
  });

  it("serves a cache-busted screenshot as an image instead of the Vite HTML fallback", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "baekstage-result-assets-")); const resultRoot = path.join(root, "results"); let server: ViteDevServer | undefined;
    try {
      await mkdir(path.join(resultRoot, "month-close"), { recursive: true }); await writeFile(path.join(resultRoot, "month-close", "1.png"), Buffer.from([137, 80, 78, 71]));
      server = await createViteServer({ root, configFile: false, logLevel: "silent", plugins: [baekstagePlugin({ projectRoot: root, resultRoot })], server: { host: "127.0.0.1", port: 0 } }); await server.listen(); const address = server.httpServer?.address(); const origin = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
      const response = await fetch(`${origin}${resultAssetUrl("/scenario-results", "month-close", "1.png", "run/next")}`);
      expect(response.headers.get("content-type")).toBe("image/png"); expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([137, 80, 78, 71]);
    } finally { await server?.close(); await rm(root, { recursive: true, force: true }); }
  });
});
