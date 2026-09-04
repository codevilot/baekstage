import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import { DOM_SNAPSHOT_CONTENT_TYPE, type DomSnapshot, readDomSnapshotMark, readScreenshotMark } from "../playwright/mark-screenshot";
import type { ApiAssertion, ObservedNetworkRecord, ObservedPlaywrightStep, OpenApiCatalog, ScenarioCompositionDraft, ScenarioEditDraft, ScenarioGraph, ScenarioNodeResult, ScenarioPart, ScenarioRunResult, ScenarioSuite } from "../core/types";
import { composeScenario, materializeScenario } from "../core/scenario";
import { resolveExecutionPath } from "../core/execution";
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
  /** Root used for scenario discovery and persisted editor overlays. */
  definitionRoot?: string;
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
const importPath = (from: string, target: string) => {
  let relative = path.relative(path.dirname(from), target).replaceAll("\\", "/");
  if (!relative.startsWith(".")) relative = `./${relative}`;
  return relative.replace(/\.(?:[cm]?[jt]s)$/, "");
};
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const EXECUTION_PATH_ATTACHMENT_PREFIX = "baekstage-path:";
export function readExecutionPathAttachmentName(name: string) { if (!name.startsWith(EXECUTION_PATH_ATTACHMENT_PREFIX)) return null; try { return JSON.parse(decodeURIComponent(name.slice(EXECUTION_PATH_ATTACHMENT_PREFIX.length))) as { scenarioId: string }; } catch { return null; } }
export function generatedCompositionSpec(draft: ScenarioCompositionDraft, parts: ScenarioPart[], file: string) {
  const byId = new Map(parts.map((part) => [part.id, part]));
  const imports = draft.items.map((item, index) => {
    const part = byId.get(item.partId)!;
    return `import { ${part.execute ?? "run"} as part${index + 1} } from ${JSON.stringify(importPath(file, part.source!))};`;
  });
  const calls = draft.items.flatMap((item, index) => {
    const part = byId.get(item.partId)!; const repeat = item.repeat ?? 1;
    const defaults = (variables: ScenarioPart["inputs"] | ScenarioPart["expectations"], values: Record<string, unknown> | undefined) => ({ ...Object.fromEntries((variables ?? []).filter((variable) => variable.defaultValue !== undefined).map((variable) => [variable.id, variable.defaultValue])), ...values });
    const options = { inputs: defaults(part.inputs, item.inputs), expectations: defaults(part.expectations, item.expectations) };
    const args = part.inputs?.length || part.expectations?.length || item.inputs || item.expectations ? `page, ${JSON.stringify(options)}` : "page";
    return Array.from({ length: repeat }, (_, repeatIndex) => `  await test.step(${JSON.stringify(`${part.title}${repeat > 1 ? ` ${repeatIndex + 1}/${repeat}` : ""}`)}, async () => { await part${index + 1}(${args}); });`);
  });
  return [`import { test } from "@playwright/test";`, ...imports, "", `test(${JSON.stringify(draft.title)}, async ({ page }) => {`, ...calls, "});", ""].join("\n");
}

/** Generates the executable view of an editor draft. Manual Nodes are graph-only;
 * when outcome routes exist they act as named waypoints in the dispatcher. */
export function generatedEditorSpec(draft: ScenarioEditDraft, parts: ScenarioPart[], file: string) {
  const partItems = draft.items.filter((item): item is Extract<ScenarioEditDraft["items"][number], { type: "part" }> => item.type === "part");
  const byId = new Map(parts.map((part) => [part.id, part]));
  const aliases = new Map<string, string>();
  const imports = partItems.map((item, index) => {
    const part = byId.get(item.partId)!; const alias = `part${index + 1}`; aliases.set(item.id, alias);
    return `import { ${part.execute ?? "run"} as ${alias} } from ${JSON.stringify(importPath(file, part.source!))};`;
  });
  const nextById = new Map(draft.items.map((item, index) => [item.id, draft.items[index + 1]?.id]));
  const routesById = new Map<string, NonNullable<ScenarioEditDraft["routes"]>>();
  for (const route of draft.routes ?? []) routesById.set(route.fromItemId, [...(routesById.get(route.fromItemId) ?? []), route]);
  const cases = draft.items.map((item) => {
    const outgoing = routesById.get(item.id) ?? [];
    const transition = outgoing.length
      ? `${outgoing.map((route, index) => `${index ? "else " : ""}if (outcome === ${JSON.stringify(route.outcome)}) current = ${JSON.stringify(route.toItemId)};`).join(" ")} else throw new Error(\`Unexpected outcome '\${outcome ?? "undefined"}' from Part ${item.type === "part" ? item.partId : item.id}\`);`
      : `current = ${JSON.stringify(nextById.get(item.id))};`;
    if (item.type === "node") return `      case ${JSON.stringify(item.id)}: {\n        let outcome: string | undefined;\n        ${transition}\n        break;\n      }`;
    const part = byId.get(item.partId)!; const alias = aliases.get(item.id)!; const repeat = item.repeat ?? 1;
    const defaults = (variables: ScenarioPart["inputs"] | ScenarioPart["expectations"], values: Record<string, unknown> | undefined) => ({ ...Object.fromEntries((variables ?? []).filter((variable) => variable.defaultValue !== undefined).map((variable) => [variable.id, variable.defaultValue])), ...values });
    const options = { inputs: defaults(part.inputs, item.inputs), expectations: defaults(part.expectations, item.expectations) };
    const args = part.inputs?.length || part.expectations?.length || item.inputs || item.expectations ? `page, ${JSON.stringify(options)}` : "page";
    const calls = Array.from({ length: repeat }, (_, repeatIndex) => outgoing.length
      ? `        { const result = await test.step(${JSON.stringify(`${part.title}${repeat > 1 ? ` ${repeatIndex + 1}/${repeat}` : ""}`)}, async () => (${alias} as (...args: any[]) => Promise<{ outcome?: string } | void>)(${args})); outcome = result?.outcome; }`
      : `        await test.step(${JSON.stringify(`${part.title}${repeat > 1 ? ` ${repeatIndex + 1}/${repeat}` : ""}`)}, async () => { await ${alias}(${args}); });`).join("\n");
    const recordOutcome = outgoing.length ? `\n        if (outcome) executionPath.outcomes[${JSON.stringify(item.id)}] = outcome;` : "";
    return `      case ${JSON.stringify(item.id)}: {\n        let outcome: string | undefined;\n${calls}${recordOutcome}\n        ${transition}\n        break;\n      }`;
  });
  return [
    `import { test } from "@playwright/test";`, ...imports, "",
    `test(${JSON.stringify(draft.title)}, async ({ page }, testInfo) => {`,
    `  let current: string | undefined = ${JSON.stringify(draft.items[0]?.id)};`,
    "  const executionPath: { itemIds: string[]; outcomes: Record<string, string> } = { itemIds: [], outcomes: {} };",
    "  let transitions = 0;",
    "  try { while (current) {",
    `    if (++transitions > 100) throw new Error("Scenario route exceeded 100 transitions");`,
    "    executionPath.itemIds.push(current);",
    "    switch (current) {", ...cases,
    `      default: throw new Error(\`Unknown scenario item: \${current}\`);`,
    "    }", "  } } finally {",
    `    await testInfo.attach(${JSON.stringify(`${EXECUTION_PATH_ATTACHMENT_PREFIX}${encodeURIComponent(JSON.stringify({ scenarioId: draft.id }))}`)}, { body: JSON.stringify(executionPath), contentType: "application/json" });`,
    "  }", "});", "",
  ].join("\n");
}
export function generatedScenarioModule(graph: ScenarioGraph) {
  return `import { defineScenario } from "baekstage";\n\nexport default defineScenario(${JSON.stringify({ ...graph, definitionSource: undefined }, null, 2)});\n`;
}
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
  const definitionRoot = path.resolve(options.definitionRoot ?? workspaceRoot);
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
    const screenshots: Shot[] = [], traces: Array<{ label: string; url: string }> = [], networks: Array<{ scenarioId: string; records: ObservedNetworkRecord[] }> = [], steps: Array<{ scenarioId: string; records: ObservedPlaywrightStep[] }> = [], paths: Array<{ scenarioId: string; path: { itemIds: string[]; outcomes: Record<string, string> } }> = [];
    let domSnapshotIndex = 0;
    for (const group of attachmentGroups(report)) {
      const domSnapshots = new Map<string, string[]>();
      for (const item of group) {
        const meta = readExecutionPathAttachmentName(String(item.name ?? "")); if (!meta) continue;
        try { const value = JSON.parse(await attachmentText(item) ?? ""); if (Array.isArray(value.itemIds) && value.itemIds.every((id: unknown) => typeof id === "string")) paths.push({ scenarioId: meta.scenarioId, path: { itemIds: value.itemIds, outcomes: value.outcomes && typeof value.outcomes === "object" ? value.outcomes : {} } }); } catch {}
      }
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
    return { screenshots, traces, networks, steps, paths };
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
    const captured = await saveArtifacts(id, report, runId); const finishedAt = new Date().toISOString(); const nodeResults = [...playwrightStepNodeResults(captured.steps, options.suite, runId), ...observedNodeResults(captured.networks, runId, startedAt, finishedAt)]; const scenario = options.suite?.scenarios.find((item) => item.id === id); const rawPath = captured.paths.filter((item) => item.scenarioId === id).at(-1)?.path; const executionPath = scenario && rawPath ? resolveExecutionPath(scenario, rawPath) : undefined; const manifest: ScenarioRunResult = { runId, origin: "playwright", scenarioId: id, adapter: "playwright", status: result.code === 0 && !nodeResults.some((item) => item.status === "failed") ? "passed" : "failed", screenshots: captured.screenshots, traces: captured.traces, nodeResults, executionPath, output: result.code === 0 ? "" : redactText(failureOutput(report, result.stderr)), startedAt, finishedAt };
    await mkdir(path.join(resultRoot, id), { recursive: true }); await atomicJson(path.join(resultRoot, id, "manifest.json"), manifest); for (const nodeId of new Set(nodeResults.map((item) => item.nodeId))) await saveHistoryRun(manifest, nodeId); return manifest;
  }
  const playwrightAdapter = new PlaywrightExecutionAdapter(execute);
  const safeSegment = (value: string) => encodeURIComponent(value).replaceAll("%", "_");
  const historyWrites = new Map<string, Promise<void>>();
  async function atomicJson(file: string, value: unknown) { if (path.basename(file) !== "manifest.json" && existsSync(file)) throw new Error("Run ID already exists"); const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`; await writeFile(temporary, JSON.stringify(redactEvidence(value, options.redactKeys), null, 2), { flag: "wx" }); await rename(temporary, file); }
  async function atomicReplaceJson(file: string, value: unknown) { const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`; await writeFile(temporary, JSON.stringify(redactEvidence(value, options.redactKeys), null, 2), { flag: "wx" }); await rename(temporary, file); }
  async function atomicReplaceText(file: string, value: string) { const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`; try { await writeFile(temporary, value, { flag: "wx" }); await rename(temporary, file); } catch (error) { await unlink(temporary).catch(() => {}); throw error; } }
  function historyDirectory(scenarioId: string, nodeId: string) { return path.join(resultRoot, safeSegment(scenarioId), "api", safeSegment(nodeId)); }
  async function saveHistoryRun(result: ScenarioRunResult, nodeId: string) { const directory = historyDirectory(result.scenarioId, nodeId); const previous = historyWrites.get(directory) ?? Promise.resolve(); const current = previous.catch(() => {}).then(async () => { await mkdir(directory, { recursive: true }); await atomicJson(path.join(directory, `${safeSegment(result.runId)}.json`), result); const files = (await readdir(directory)).filter((file) => file.endsWith(".json")); const max = Math.max(1, options.maxRunsPerNode ?? 50); if (files.length > max) { const ordered = await Promise.all(files.map(async (file) => ({ file, time: (await stat(path.join(directory, file))).mtimeMs }))); for (const item of ordered.sort((a, b) => a.time - b.time).slice(0, files.length - max)) await unlink(path.join(directory, item.file)); } }); historyWrites.set(directory, current); try { await current; } finally { if (historyWrites.get(directory) === current) historyWrites.delete(directory); } }
  async function apiHistory(scenarioId: string, nodeId: string) { const directory = historyDirectory(scenarioId, nodeId); if (!existsSync(directory)) return []; const files = (await readdir(directory)).filter((file) => file.endsWith(".json")); const results: ScenarioRunResult[] = []; for (const file of files) try { results.push(redactEvidence(JSON.parse(await readFile(path.join(directory, file), "utf8")), options.redactKeys)); } catch {} return results.sort((left, right) => left.finishedAt.localeCompare(right.finishedAt)); }
  return { name: "baekstage", configureServer(server) {
    server.middlewares.use("/api/scenario-editor", async (req, res) => {
      let draftFile: string | undefined;
      try {
        if (req.method !== "POST" || req.url !== "/save") return json(res, 405, { error: "Method not allowed" });
        const draft = await requestBody(req) as ScenarioEditDraft;
        if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(draft.id ?? "") || !draft.title?.trim()) return json(res, 400, { error: "A valid scenario id and title are required" });
        const currentScenario = options.suite?.scenarios.find((scenario) => scenario.id === draft.id);
        const definitionSource = currentScenario?.definitionSource;
        const safeDraft = { ...draft, definitionSource, execution: currentScenario?.execution };
        const parts = options.suite?.parts ?? []; let graph = materializeScenario(safeDraft, parts); const files: string[] = [];
        const partItems = draft.items.filter((item): item is Extract<ScenarioEditDraft["items"][number], { type: "part" }> => item.type === "part");
        const firstPart = partItems.length ? parts.find((part) => part.id === partItems[0].partId) : undefined;
        if (partItems.some((item) => !parts.find((part) => part.id === item.partId)?.source)) return json(res, 400, { error: "Edited Parts must come from discovered part files" });
        const existingGenerated = !!definitionSource?.replaceAll("\\", "/").includes("/baekstage.generated/");
        const creating = !currentScenario;
        const generatedDirectory = existingGenerated ? path.dirname(definitionSource!) : creating ? path.join(firstPart?.source ? path.dirname(firstPart.source) : definitionRoot, "baekstage.generated", draft.id) : undefined;
        if (creating && generatedDirectory && existsSync(generatedDirectory)) return json(res, 409, { error: `Scenario '${draft.id}' already exists` });
        let result: ScenarioRunResult | undefined;
        if (partItems.length) {
          const draftDirectory = path.join(path.dirname(firstPart!.source!), ".baekstage-drafts"); await mkdir(draftDirectory, { recursive: true });
          draftFile = path.join(draftDirectory, `${draft.id}-${randomUUID()}.spec.ts`);
          await writeFile(draftFile, generatedEditorSpec(draft, parts, draftFile), "utf8");
          result = await playwrightAdapter.run({ source: draftFile, grep: `^${escapeRegex(draft.title)}$` }, { scenarioId: draft.id });
          await unlink(draftFile).catch(() => {}); draftFile = undefined;
          if (result.status !== "passed") return json(res, 422, { result, error: "실행에 실패하여 시나리오 파일을 저장하지 않았습니다." });
          const directory = generatedDirectory ?? path.join(path.dirname(firstPart!.source!), ".baekstage-generated", draft.id);
          await mkdir(directory, { recursive: true }); const spec = path.join(directory, "scenario.spec.ts");
          await atomicReplaceText(spec, generatedEditorSpec(draft, parts, spec)); files.push(path.relative(workspaceRoot, spec));
          graph = { ...graph, execution: { adapter: "playwright", source: spec, grep: `^${escapeRegex(draft.title)}$` } };
        }
        if (generatedDirectory) { await mkdir(generatedDirectory, { recursive: true }); const generatedDefinition = definitionSource ?? path.join(generatedDirectory, "baekstage.scenario.ts"); graph = { ...graph, definitionSource: generatedDefinition }; await atomicReplaceText(generatedDefinition, generatedScenarioModule({ ...graph, execution: graph.execution && "adapter" in graph.execution && graph.execution.adapter === "playwright" ? { ...graph.execution, source: "./scenario.spec.ts" } : graph.execution })); files.push(path.relative(workspaceRoot, generatedDefinition)); }
        else { const editDirectory = path.join(definitionRoot, ".baekstage", "scenario-edits"); await mkdir(editDirectory, { recursive: true }); const editFile = path.join(editDirectory, `${draft.id}.json`); await atomicReplaceJson(editFile, graph); files.push(path.relative(workspaceRoot, editFile)); }
        const index = options.suite?.scenarios.findIndex((scenario) => scenario.id === graph.id) ?? -1;
        if (options.suite && index >= 0) options.suite.scenarios[index] = graph; else options.suite?.scenarios.push(graph);
        return json(res, 200, { scenario: graph, result, files });
      } catch (error) { if (draftFile) await unlink(draftFile).catch(() => {}); return json(res, 500, { error: error instanceof Error ? error.message : String(error) }); }
    });
    server.middlewares.use("/api/compositions", async (req, res) => {
      let draftFile: string | undefined;
      try {
        if (req.method !== "POST" || req.url !== "/run") return json(res, 405, { error: "Method not allowed" });
        const draft = await requestBody(req) as ScenarioCompositionDraft;
        if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(draft.id ?? "")) return json(res, 400, { error: "Scenario id must use lowercase letters, numbers, and hyphens" });
        if (!draft.title?.trim() || !Array.isArray(draft.items) || !draft.items.length) return json(res, 400, { error: "Title and at least one Part are required" });
        const parts = options.suite?.parts ?? []; const byId = new Map(parts.map((part) => [part.id, part]));
        const selected = draft.items.map((item) => byId.get(item.partId));
        if (selected.some((part) => !part?.source)) return json(res, 400, { error: "Every selected Part must come from a discovered part file" });
        if (draft.items.some((item) => !Number.isInteger(item.repeat ?? 1) || (item.repeat ?? 1) < 1 || (item.repeat ?? 1) > 20)) return json(res, 400, { error: "Part repeat must be between 1 and 20" });
        const base = path.join(path.dirname(selected[0]!.source!), "baekstage.generated");
        const destination = path.join(base, draft.id); const finalSpec = path.join(destination, "scenario.spec.ts");
        if (existsSync(destination)) return json(res, 409, { error: `Scenario '${draft.id}' already exists` });
        const draftDirectory = path.join(path.dirname(selected[0]!.source!), ".baekstage-drafts"); await mkdir(draftDirectory, { recursive: true });
        draftFile = path.join(draftDirectory, `${draft.id}-${randomUUID()}.spec.ts`);
        await writeFile(draftFile, generatedCompositionSpec(draft, parts, draftFile), "utf8");
        const result = await playwrightAdapter.run({ source: draftFile, grep: `^${escapeRegex(draft.title)}$` }, { scenarioId: draft.id });
        if (result.status !== "passed") { await unlink(draftFile).catch(() => {}); return json(res, 422, { result, error: "실행에 실패하여 시나리오 파일을 저장하지 않았습니다." }); }
        const graph = composeScenario({ id: draft.id, title: draft.title.trim(), description: draft.description?.trim(), execution: { adapter: "playwright", source: "./scenario.spec.ts", grep: `^${escapeRegex(draft.title)}$` }, parts: draft.items.map((item) => ({ part: byId.get(item.partId)!, repeat: item.repeat, inputs: item.inputs, expectations: item.expectations })) });
        await mkdir(destination, { recursive: true });
        await atomicReplaceText(finalSpec, generatedCompositionSpec(draft, parts, finalSpec));
        await atomicReplaceText(path.join(destination, "baekstage.scenario.ts"), generatedScenarioModule(graph));
        await unlink(draftFile).catch(() => {});
        const runtimeScenario = { ...graph, definitionSource: path.join(destination, "baekstage.scenario.ts"), execution: { ...graph.execution as Extract<NonNullable<ScenarioGraph["execution"]>, { adapter: "playwright" }>, source: finalSpec } };
        options.suite?.scenarios.push(runtimeScenario);
        return json(res, 201, { scenario: runtimeScenario, result, files: [path.relative(workspaceRoot, finalSpec), path.relative(workspaceRoot, path.join(destination, "baekstage.scenario.ts"))] });
      } catch (error) { if (draftFile) await unlink(draftFile).catch(() => {}); return json(res, 500, { error: error instanceof Error ? error.message : String(error) }); }
    });
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
