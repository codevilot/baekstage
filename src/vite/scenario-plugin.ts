import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import { DOM_SNAPSHOT_CONTENT_TYPE, type DomSnapshot, readDomSnapshotMark, readScreenshotMark } from "../playwright/mark-screenshot";
import type { ApiAssertion, ObservedNetworkRecord, ObservedPlaywrightStep, OpenApiCatalog, ScenarioNodeResult, ScenarioRunResult, ScenarioSuite } from "../core/types";
import { ApiExecutionAdapter, ApiExecutionError, type ApiRunInput, type ApiSourceRuntime } from "./api-execution-adapter";
import { PlaywrightExecutionAdapter } from "./playwright-execution-adapter";
import { normalizeApiCases } from "../core/api-cases";
import { redactEvidence, redactText } from "../core/security";
import { readNetworkAttachmentName, readStepAttachmentName } from "../playwright/observe-api-scenario";
import { matchNetworkOperation } from "../openapi/network-match";
import { matchResponseBranch, classifyApiTest, matchObservedApiCase } from "../core/api-response";
import { evaluateApiAssertions } from "../core/assertions";
import { validateOpenApiSchema } from "./openapi-schema-validator";
import { StorybookVisualPlatform, WorktreePlatformError, WorktreeStorybookManager, listGitWorktrees } from "../visual/platform";
import type { SchemaSourceConfig, StorybookSourceConfig } from "../config";
import { SchemaPlatform, SchemaPlatformError } from "../schema/platform";

type Item = Record<string, unknown>;
type Shot = { label: string; url: string; traceUrl?: string; domSnapshotUrl?: string; scenarioId?: string; nodeId?: string; edgeId?: string; fromNodeId?: string; toNodeId?: string; category?: string; branch?: string; important?: boolean; checkpoint?: boolean; target?: string };
export type BaekstagePluginOptions = {
  workspaceRoot?: string;
  projectRoot: string;
  resultRoot?: string;
  apiBase?: string;
  assetBase?: string;
  traceViewerBase?: string;
  command?: string;
  commandArgs?: string[];
  env?: Record<string, string>;
  catalog?: OpenApiCatalog;
  apiSources?: ApiSourceRuntime[];
  apiTimeoutMs?: number;
  apiMaxResponseBytes?: number;
  suite?: ScenarioSuite;
  maxRunsPerNode?: number;
  redactKeys?: string[];
  storybookSources?: StorybookSourceConfig[];
  visual?: { viewport?: { width: number; height: number }; deviceScaleFactor?: number; locale?: string; timezoneId?: string; threshold?: number };
  schemaSources?: SchemaSourceConfig[];
  schemaRecentCommits?: number;
};

const cleanBase = (value: string) => `/${value.replace(/^\/+|\/+$/g, "")}`;
export const resultAssetUrl = (assetBase: string, scenarioId: string, name: string, runId: string) => `${assetBase}/${scenarioId}/${name}?run=${encodeURIComponent(runId)}`;
export function playwrightStepNodeResults(observations: Array<{ scenarioId: string; records: ObservedPlaywrightStep[] }>, suite: ScenarioSuite | undefined, runId: string): ScenarioNodeResult[] {
  const results: ScenarioNodeResult[] = [];
  for (const observation of observations) {
    const scenario = suite?.scenarios.find((item) => item.id === observation.scenarioId);
    if (!scenario) continue;
    for (const record of observation.records) {
      const nodeId = record.marker.toNodeId ?? record.marker.id;
      const node = scenario.nodes.find((item) => item.id === nodeId);
      if (!node || node.kind === "api") continue;
      results.push({ runId, origin: "playwright", nodeId, caseId: record.marker.caseId, status: record.status, durationMs: record.durationMs, startedAt: record.startedAt, finishedAt: record.finishedAt, error: record.error });
    }
  }
  return results;
}
function json(res: import("node:http").ServerResponse, status: number, value: unknown) { res.writeHead(status, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(value)); }
async function requestBody(req: import("node:http").IncomingMessage, limit = 1_000_000) { if (Number(req.headers["content-length"] ?? 0) > limit) throw new ApiExecutionError("Request body exceeded the configured size limit", 413); const chunks: Buffer[] = []; let size = 0; for await (const chunk of req) { const value = Buffer.from(chunk); size += value.length; if (size > limit) throw new ApiExecutionError("Request body exceeded the configured size limit", 413); chunks.push(value); } return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
function attachmentGroups(value: unknown, found: Item[][] = []) {
  if (!value || typeof value !== "object") return found;
  if (Array.isArray(value)) { value.forEach((item) => attachmentGroups(item, found)); return found; }
  const record = value as Item;
  if (Array.isArray(record.attachments) && record.attachments.length) found.push(record.attachments as Item[]);
  Object.entries(record).filter(([key]) => key !== "attachments").forEach(([, item]) => attachmentGroups(item, found));
  return found;
}
function run(command: string, args: string[], cwd: string, customEnv: Record<string, string>) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...customEnv } });
    let stdout = "", stderr = "";
    child.stdout.on("data", (data) => { stdout += data; }); child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", reject); child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}
function failureOutput(report: unknown, fallback: string) {
  const messages = new Set<string>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) return value.forEach(visit);
    const record = value as Item;
    if (typeof record.message === "string" && ("stack" in record || "location" in record)) messages.add([record.message, typeof record.stack === "string" ? record.stack.split("\n").slice(1, 5).join("\n") : ""].filter(Boolean).join("\n"));
    Object.entries(record).filter(([key]) => !["config", "metadata", "attachments"].includes(key)).forEach(([, item]) => visit(item));
  };
  visit(report); return [...messages].join("\n\n") || fallback.slice(-2000) || "Playwright exited without an error message.";
}
async function copyAttachment(item: Item, destination: string) {
  if (typeof item.path === "string" && existsSync(item.path)) await copyFile(item.path, destination);
  else if (typeof item.body === "string") await writeFile(destination, Buffer.from(item.body, "base64"));
  else return false;
  return true;
}

async function attachmentText(item: Item) {
  if (typeof item.path === "string" && existsSync(item.path)) return readFile(item.path, "utf8");
  if (typeof item.body === "string") return Buffer.from(item.body, "base64").toString("utf8");
}

export function baekstagePlugin(options: BaekstagePluginOptions): Plugin {
  const projectRoot = path.resolve(options.projectRoot);
  const workspaceRoot = path.resolve(options.workspaceRoot ?? projectRoot);
  const resultRoot = path.resolve(options.resultRoot ?? ".scenario-results");
  const apiBase = cleanBase(options.apiBase ?? "/api/scenarios");
  const assetBase = cleanBase(options.assetBase ?? "/scenario-results");
  const traceBase = cleanBase(options.traceViewerBase ?? "/trace-viewer");
  const catalog = options.catalog ?? { operations: [] };
  const apiAdapter = new ApiExecutionAdapter(options.apiSources ?? [], catalog.operations, { timeoutMs: options.apiTimeoutMs, maxResponseBytes: options.apiMaxResponseBytes });
  const visualPlatform = new StorybookVisualPlatform(workspaceRoot, options.storybookSources ?? [], options.visual);
  const worktreeManager = new WorktreeStorybookManager(workspaceRoot);
  const schemaPlatform = new SchemaPlatform(workspaceRoot, options.schemaSources ?? [], options.schemaRecentCommits);
  if (!existsSync(projectRoot)) throw new Error(`Playwright projectRoot does not exist: ${projectRoot}`);
  async function saveArtifacts(id: string, report: unknown, runId: string) {
    const directory = path.join(resultRoot, id); await mkdir(directory, { recursive: true });
    const screenshots: Shot[] = [], traces: Array<{ label: string; url: string }> = [], networks: Array<{ scenarioId: string; records: ObservedNetworkRecord[] }> = [], steps: Array<{ scenarioId: string; records: ObservedPlaywrightStep[] }> = [];
    let domSnapshotIndex = 0;
    for (const group of attachmentGroups(report)) {
      const domSnapshots = new Map<string, string[]>();
      for (const item of group.filter((entry) => String(entry.contentType) === DOM_SNAPSHOT_CONTENT_TYPE)) {
        const mark = readDomSnapshotMark(String(item.name ?? ""));
        if (!mark) continue;
        try {
          const snapshot = JSON.parse(await attachmentText(item) ?? "") as DomSnapshot;
          if (snapshot.version !== 1 || typeof snapshot.html !== "string") continue;
          const name = `dom-${++domSnapshotIndex}.html`;
          await writeFile(path.join(directory, name), snapshot.html, "utf8");
          const key = JSON.stringify(mark); const urls = domSnapshots.get(key) ?? [];
          urls.push(resultAssetUrl(assetBase, id, name, runId)); domSnapshots.set(key, urls);
        } catch {}
      }
      for (const item of group) { const name = String(item.name ?? ""); const networkMeta = readNetworkAttachmentName(name); const stepMeta = readStepAttachmentName(name); if (!networkMeta && !stepMeta) continue; try { let raw = ""; if (typeof item.path === "string" && existsSync(item.path)) raw = await readFile(item.path, "utf8"); else if (typeof item.body === "string") { try { raw = Buffer.from(item.body, "base64").toString("utf8"); JSON.parse(raw); } catch { raw = item.body; } } const records = redactEvidence(JSON.parse(raw), options.redactKeys); if (!Array.isArray(records)) continue; if (networkMeta) networks.push({ scenarioId: networkMeta.scenarioId, records }); else if (stepMeta) steps.push({ scenarioId: stepMeta.scenarioId, records }); } catch {} }
      const trace = group.find((item) => item.name === "trace" || String(item.contentType).includes("zip"));
      let traceUrl: string | undefined;
      if (trace) { const name = `trace-${traces.length + 1}.zip`; if (await copyAttachment(trace, path.join(directory, name))) { traceUrl = resultAssetUrl(assetBase, id, name, runId); traces.push({ label: String(trace.name ?? "Trace"), url: traceUrl }); } }
      for (const item of group.filter((entry) => String(entry.contentType).startsWith("image/"))) {
        const extension = String(item.contentType).includes("jpeg") ? "jpg" : "png"; const name = `${screenshots.length + 1}.${extension}`;
        if (!await copyAttachment(item, path.join(directory, name))) continue;
        const rawLabel = String(item.name ?? `Screenshot ${screenshots.length + 1}`); const mark = readScreenshotMark(rawLabel);
        const snapshotUrls = mark ? domSnapshots.get(JSON.stringify(mark)) : undefined;
        screenshots.push({ label: mark?.label ?? rawLabel, url: resultAssetUrl(assetBase, id, name, runId), traceUrl, domSnapshotUrl: snapshotUrls?.shift(), ...(mark ?? {}) });
      }
    }
    return { screenshots, traces, networks, steps };
  }
  function observedNodeResults(networks: Array<{ scenarioId: string; records: ObservedNetworkRecord[] }>, runId: string, startedAt: string, finishedAt: string): ScenarioNodeResult[] {
    const results: ScenarioNodeResult[] = [];
    for (const observation of networks) for (const record of observation.records) {
      if (record.matchStatus === "ignored") continue;
      const matchedOperation = matchNetworkOperation(catalog.operations, record.request.method, record.request.url, { operationId: record.step?.operationId, sourceId: record.step?.sourceId, includeSourceIds: record.includeSourceIds });
      const scenario = options.suite?.scenarios.find((item) => item.id === observation.scenarioId); const hintedNode = record.step?.toNodeId ? scenario?.nodes.find((item) => item.id === record.step?.toNodeId && item.kind === "api") : undefined; const nodes = hintedNode ? [hintedNode] : scenario?.nodes.filter((node) => node.ref === matchedOperation.operation?.id) ?? []; if (nodes.length !== 1) continue; const node = nodes[0];
      if (!matchedOperation.operation || matchedOperation.status !== "matched") { results.push({ runId, origin: "playwright", nodeId: node.id, status: "failed", startedAt, finishedAt, failureKind: "undocumented-response", error: matchedOperation.reason, api: { request: record.request, operationMatch: matchedOperation.status, operationCandidates: matchedOperation.candidates?.map((item) => item.id), step: record.step, caseMatch: "observed-only" } }); continue; }
      if (!record.response) { results.push({ runId, origin: "playwright", nodeId: node.id, status: "failed", startedAt, finishedAt, failureKind: "network-error", error: record.error ?? "Network request failed", api: { request: record.request, operationMatch: "matched", step: record.step, caseMatch: "observed-only" } }); continue; }
      const match = matchResponseBranch(matchedOperation.operation, record.response.status); const caseMatch = matchObservedApiCase(normalizeApiCases(node), matchedOperation.operation, record.request, record.response.status, match.matchType, record.step?.caseId); const testCase = caseMatch.testCase; const assertions = (testCase?.assertions ?? []).filter((item): item is ApiAssertion => typeof item !== "string"); const assertionResults = evaluateApiAssertions(assertions, { status: record.response.status, durationMs: record.response.durationMs, headers: record.response.headers, body: record.response.body }); const validation = validateOpenApiSchema(match.branch?.schema, matchedOperation.operation.schemaComponents, record.response.body);
      const response = { ...record.response, documented: !!match.branch, branchId: match.branch?.id, matchType: match.matchType, schemaValid: validation.valid, validationUnsupported: validation.unsupported, schemaErrors: validation.errors }; const verdict = classifyApiTest(response, testCase, assertionResults);
      const ambiguous = caseMatch.status === "ambiguous"; results.push({ runId, origin: "playwright", nodeId: node.id, caseId: testCase?.id, status: !ambiguous && verdict.passed ? "passed" : "failed", durationMs: response.durationMs, startedAt, finishedAt, assertions: assertionResults, failureKind: ambiguous ? "unexpected-status" : verdict.failureKind, error: ambiguous ? `Ambiguous API case: ${caseMatch.candidates?.map((item) => item.id).join(", ")}` : undefined, api: { request: record.request, response, operationMatch: "matched", step: record.step, caseMatch: caseMatch.status } });
    }
    return results;
  }
  async function execute(id: string, source?: string, grep?: string): Promise<ScenarioRunResult> {
    const runId = randomUUID(); const startedAt = new Date().toISOString();
    let relative: string | undefined;
    if (source) { const candidate = source.startsWith(`${path.basename(projectRoot)}/`) ? source.slice(path.basename(projectRoot).length + 1) : source; const target = path.resolve(projectRoot, candidate); if (!target.startsWith(`${projectRoot}${path.sep}`) || !existsSync(target)) throw new Error("Playwright source is outside projectRoot or does not exist"); relative = path.relative(projectRoot, target); }
    const command = options.command ?? "npm";
    const prefix = options.commandArgs ?? ["exec", "--", "playwright", "test"];
    const result = await run(command, [...prefix, ...(relative ? [relative] : []), "--reporter=json", "--trace=on", ...(grep ? ["--grep", grep] : [])], projectRoot, options.env ?? {});
    const start = result.stdout.indexOf("{"); const end = result.stdout.lastIndexOf("}"); let report: unknown = {};
    if (start >= 0 && end > start) try { report = JSON.parse(result.stdout.slice(start, end + 1)); } catch { report = {}; }
    const captured = await saveArtifacts(id, report, runId); const finishedAt = new Date().toISOString(); const nodeResults = [...playwrightStepNodeResults(captured.steps, options.suite, runId), ...observedNodeResults(captured.networks, runId, startedAt, finishedAt)]; const manifest: ScenarioRunResult = { runId, origin: "playwright", scenarioId: id, adapter: "playwright", status: result.code === 0 && !nodeResults.some((item) => item.status === "failed") ? "passed" : "failed", screenshots: captured.screenshots, traces: captured.traces, nodeResults, output: result.code === 0 ? "" : redactText(failureOutput(report, result.stderr)), startedAt, finishedAt };
    await mkdir(path.join(resultRoot, id), { recursive: true }); await atomicJson(path.join(resultRoot, id, "manifest.json"), manifest); for (const nodeId of new Set(nodeResults.map((item) => item.nodeId))) await saveHistoryRun(manifest, nodeId); return manifest;
  }
  const playwrightAdapter = new PlaywrightExecutionAdapter(execute);
  const safeSegment = (value: string) => encodeURIComponent(value).replaceAll("%", "_");
  const historyWrites = new Map<string, Promise<void>>();
  async function atomicJson(file: string, value: unknown) { if (path.basename(file) !== "manifest.json" && existsSync(file)) throw new Error("Run ID already exists"); const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`; await writeFile(temporary, JSON.stringify(redactEvidence(value, options.redactKeys), null, 2), { flag: "wx" }); await rename(temporary, file); }
  function historyDirectory(scenarioId: string, nodeId: string) { return path.join(resultRoot, safeSegment(scenarioId), "api", safeSegment(nodeId)); }
  async function saveHistoryRun(result: ScenarioRunResult, nodeId: string) { const directory = historyDirectory(result.scenarioId, nodeId); const previous = historyWrites.get(directory) ?? Promise.resolve(); const current = previous.catch(() => {}).then(async () => { await mkdir(directory, { recursive: true }); await atomicJson(path.join(directory, `${safeSegment(result.runId)}.json`), result); const files = (await readdir(directory)).filter((file) => file.endsWith(".json")); const max = Math.max(1, options.maxRunsPerNode ?? 50); if (files.length > max) { const ordered = await Promise.all(files.map(async (file) => ({ file, time: (await stat(path.join(directory, file))).mtimeMs }))); for (const item of ordered.sort((a, b) => a.time - b.time).slice(0, files.length - max)) await unlink(path.join(directory, item.file)); } }); historyWrites.set(directory, current); try { await current; } finally { if (historyWrites.get(directory) === current) historyWrites.delete(directory); } }
  async function apiHistory(scenarioId: string, nodeId: string) { const directory = historyDirectory(scenarioId, nodeId); if (!existsSync(directory)) return []; const files = (await readdir(directory)).filter((file) => file.endsWith(".json")); const results: ScenarioRunResult[] = []; for (const file of files) try { results.push(redactEvidence(JSON.parse(await readFile(path.join(directory, file), "utf8")), options.redactKeys)); } catch {} return results.sort((left, right) => left.finishedAt.localeCompare(right.finishedAt)); }
  return { name: "baekstage", configureServer(server) {
    server.middlewares.use("/api/schema", async (req, res) => {
      try {
        const url = new URL(req.url ?? "/", "http://baekstage.local");
        if (req.method === "GET" && url.pathname === "/sources") return json(res, 200, schemaPlatform.sourceList());
        if (req.method === "GET" && url.pathname === "/references") return json(res, 200, await schemaPlatform.references());
        if (req.method === "POST" && url.pathname === "/compare") return json(res, 200, await schemaPlatform.compare(await requestBody(req)));
        return json(res, 405, { error: "Method not allowed" });
      } catch (error) { return error instanceof SchemaPlatformError ? json(res, error.status, { code: error.code, error: error.message }) : error instanceof ApiExecutionError || error instanceof SyntaxError ? json(res, error instanceof ApiExecutionError ? error.status : 400, { code: "SCHEMA_REQUEST_INVALID", error: "Schema comparison request is invalid" }) : json(res, 500, { code: "SCHEMA_INTERNAL_ERROR", error: "Schema comparison failed" }); }
    });
    server.middlewares.use("/api/storybook", async (req, res) => {
      try {
        const url = new URL(req.url ?? "/", "http://baekstage.local");
        if (req.method === "GET" && url.pathname === "/sources") return json(res, 200, await visualPlatform.sourceList());
        if (req.method === "GET" && url.pathname === "/commits") return json(res, 200, await visualPlatform.recentCommits());
        if (req.method === "GET" && url.pathname === "/changed-files") return json(res, 200, await visualPlatform.changedFiles(url.searchParams.get("base") ?? "HEAD"));
        if (req.method === "GET" && url.pathname === "/stories") return json(res, 200, await visualPlatform.stories(url.searchParams.get("source") ?? ""));
        if (req.method === "GET" && url.pathname === "/branches") { const branches = await worktreeManager.branches(); return json(res, 200, { branches, worktrees: await listGitWorktrees(workspaceRoot), warnings: worktreeManager.warnings() }); }
        if (req.method === "POST" && url.pathname === "/worktrees") return json(res, 201, await worktreeManager.create((await requestBody(req)).branch));
        if (req.method === "POST" && url.pathname === "/worktrees/start") { const input = await requestBody(req); const running = await worktreeManager.start(input.branch); const created = { id: `branch:${input.branch}`, title: input.branch, branch: input.branch, url: running.url }; visualPlatform.addSource(created); return json(res, 200, created); }
        if (req.method === "POST" && url.pathname === "/worktrees/start-revision") { const input = await requestBody(req); const running = await worktreeManager.startRevision(input.reference ?? "HEAD"); const created = { id: `revision:${running.sha}`, title: `${running.reference} · ${running.sha.slice(0, 7)}`, branch: running.branch, url: running.url }; visualPlatform.addSource(created); return json(res, 200, created); }
        if (req.method === "POST" && url.pathname === "/worktrees/stop") { const input = await requestBody(req); await worktreeManager.stop(input.branch); return json(res, 200, { stopped: true }); }
        if (req.method === "DELETE" && url.pathname === "/worktrees") return json(res, 200, await worktreeManager.remove((await requestBody(req)).branch));
        if (req.method === "POST" && url.pathname === "/capture") return json(res, 200, await visualPlatform.capture(await requestBody(req)));
        if (req.method === "POST" && url.pathname === "/capture-many") { const input = await requestBody(req); if (!Array.isArray(input.items)) return json(res, 400, { error: "items must be an array" }); return json(res, 200, await visualPlatform.captureMany(input.items, input.concurrency ?? 4)); }
        return json(res, 405, { error: "Method not allowed" });
      } catch (error) { return error instanceof WorktreePlatformError ? json(res, error.status, { code: error.code, error: error.message }) : error instanceof ApiExecutionError || error instanceof SyntaxError ? json(res, error instanceof ApiExecutionError ? error.status : 400, { code: "WORKTREE_REQUEST_INVALID", error: "Worktree request is invalid" }) : json(res, 500, { code: "WORKTREE_INTERNAL_ERROR", error: error instanceof Error ? error.message : "Worktree operation failed" }); }
    });
    server.middlewares.use("/api/reviews", async (req, res) => {
      try {
        const url = new URL(req.url ?? "/", "http://baekstage.local");
        if (req.method === "GET" && url.pathname === "/annotations") return json(res, 200, await visualPlatform.annotations(url.searchParams.get("storyId") ?? undefined));
        if (req.method === "POST" && url.pathname === "/annotations") return json(res, 201, await visualPlatform.createAnnotation(await requestBody(req)));
        const annotation = url.pathname.match(/^\/annotations\/([^/]+)$/);
        if (req.method === "PATCH" && annotation) return json(res, 200, await visualPlatform.updateAnnotation(decodeURIComponent(annotation[1]), await requestBody(req)));
        if (req.method === "POST" && url.pathname === "/decision") { const input = await requestBody(req); return json(res, 200, input.status === "approved" ? await visualPlatform.approve(input.storyId, input.buildId, input.branch, input.author) : await visualPlatform.review({ storyId: input.storyId, buildId: input.buildId, status: input.status, author: input.author })); }
        return json(res, 405, { error: "Method not allowed" });
      } catch (error) { return json(res, 500, { error: error instanceof Error ? error.message : String(error) }); }
    });
    server.middlewares.use("/baekstage-assets", (req, res, next) => { const assetRoot = path.join(workspaceRoot, ".baekstage"); const file = path.resolve(assetRoot, `.${req.url}`); if (!file.startsWith(`${assetRoot}${path.sep}`) || !existsSync(file)) return next(); readFile(file).then((data) => { res.writeHead(200, { "content-type": file.endsWith(".json") ? "application/json" : "image/png", "cache-control": "no-store" }); res.end(data); }).catch(next); });
    server.middlewares.use("/api/catalog", (req, res) => req.method === "GET" ? json(res, 200, catalog) : json(res, 405, { error: "Method not allowed" }));
    server.middlewares.use("/api/operations", async (req, res) => {
      try {
        const history = req.url?.match(/^\/history\/([^/]+)\/([^/?]+)/); if (req.method === "GET" && history) return json(res, 200, await apiHistory(decodeURIComponent(history[1]), decodeURIComponent(history[2])));
        if (req.method !== "POST" || req.url !== "/run") return json(res, 405, { error: "Method not allowed" });
        const input = await requestBody(req) as ApiRunInput & { scenarioId?: string; nodeId?: string };
        if (!input.scenarioId || !input.nodeId) return json(res, 400, { error: "scenarioId and nodeId are required" });
        const scenario = options.suite?.scenarios.find((item) => item.id === input.scenarioId); const node = scenario?.nodes.find((item) => item.id === input.nodeId);
        if (options.suite && (!node || node.kind !== "api" || node.ref !== input.operationId)) return json(res, 403, { error: "Scenario API node is not allowed for this operation" });
        const testCase = node ? normalizeApiCases(node).find((item) => item.id === (input.caseId ?? "default")) : undefined;
        if (node && !testCase) return json(res, 400, { error: "API case is not defined" });
        if (testCase?.setup && testCase.setup.type !== "request-only") return json(res, 409, { error: `Case setup '${testCase.setup.type}' is not automatically reproducible` });
        const request = testCase?.request; const assertions = (testCase?.assertions ?? []).filter((item): item is ApiAssertion => typeof item !== "string");
        const runInput: ApiRunInput = { ...input, path: { ...request?.path, ...input.path }, query: { ...request?.query, ...input.query }, headers: { ...request?.headers, ...input.headers }, body: input.body ?? request?.body, assertions: node ? assertions : input.assertions, expectedResponse: testCase?.expectedResponse ?? input.expectedResponse, caseId: testCase?.id ?? input.caseId };
        const result = await apiAdapter.run(runInput, { scenarioId: input.scenarioId, nodeId: input.nodeId }); await saveHistoryRun(result, input.nodeId); return json(res, 200, redactEvidence(result, options.redactKeys));
      } catch (error) {
        const status = error instanceof ApiExecutionError ? error.status : 500;
        return json(res, status, { error: error instanceof ApiExecutionError ? error.message : "API request execution failed" });
      }
    });
    const traceRoot = path.join(projectRoot, "node_modules/playwright-core/lib/vite/traceViewer");
    server.middlewares.use(traceBase, (req, res, next) => { const relative = req.url === "/" ? "/index.html" : req.url?.split("?")[0] ?? "/index.html"; const file = path.resolve(traceRoot, `.${relative}`); if (!file.startsWith(`${traceRoot}${path.sep}`) || !existsSync(file)) return next(); const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".ttf": "font/ttf" }; readFile(file).then((data) => { res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" }); res.end(data); }).catch(next); });
    server.middlewares.use(assetBase, (req, res, next) => { const relative = req.url?.split("?")[0] ?? "/"; const file = path.resolve(resultRoot, `.${relative}`); if (!file.startsWith(`${resultRoot}${path.sep}`) || !existsSync(file)) return next(); readFile(file).then((data) => { res.writeHead(200, { "content-type": file.endsWith(".zip") ? "application/zip" : file.endsWith(".html") ? "text/html; charset=utf-8" : file.endsWith(".jpg") ? "image/jpeg" : file.endsWith(".json") ? "application/json" : "image/png", ...(file.endsWith(".html") ? { "content-security-policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data: http: https:; font-src data: http: https:" } : {}), "access-control-allow-origin": "*", "cache-control": "no-store" }); res.end(data); }).catch(next); });
    server.middlewares.use(apiBase, async (req, res) => { try { const match = req.url?.match(/^\/([^/]+)(?:\/run)?/); const id = match?.[1]; if (!id) return json(res, 400, { error: "Scenario id is required" }); if (req.method === "GET") { const file = path.join(resultRoot, id, "manifest.json"); return json(res, 200, existsSync(file) ? JSON.parse(await readFile(file, "utf8")) : null); } if (req.method === "POST" && req.url?.endsWith("/run")) { const input = await requestBody(req); return json(res, 200, await playwrightAdapter.run({ source: input.source, grep: input.grep }, { scenarioId: id })); } json(res, 405, { error: "Method not allowed" }); } catch (error) { json(res, 500, { error: error instanceof Error ? error.message : String(error) }); } });
    return () => worktreeManager.close();
  }};
}
