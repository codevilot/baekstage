import { afterEach, describe, expect, it } from "vitest";
import { createServer as createHttpServer, type Server } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer as createViteServer, type ViteDevServer } from "vite";
import { parseOpenApiDocument } from "../openapi/catalog";
import { baekstagePlugin, resultAssetUrl } from "./scenario-plugin";
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
});

describe("Playwright result asset URLs", () => {
  it("cache-busts overwritten screenshots and traces with the run ID", () => {
    expect(resultAssetUrl("/scenario-results", "month-close", "1.png", "run/next")).toBe("/scenario-results/month-close/1.png?run=run%2Fnext");
  });
});
