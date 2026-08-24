import { randomUUID } from "node:crypto";
import { redactHeaders, redactUrl, redactValue } from "../core/security";
import { evaluateApiAssertions } from "../core/assertions";
import { classifyApiTest, matchResponseBranch } from "../core/api-response";
import type { ApiAssertion, OpenApiOperation, ScenarioApiCase, ScenarioArtifact, ScenarioRunResult } from "../core/types";
import type { ExecutionAdapter, ExecutionContext } from "./execution-adapter";
import { validateOpenApiSchema } from "./openapi-schema-validator";

export type ApiRunInput = {
  sourceId: string;
  operationId: string;
  environment?: string;
  path?: Record<string, unknown>;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
  body?: unknown;
  assertions?: ApiAssertion[];
  caseId?: string;
  expectedResponse?: string;
};
export type ApiSourceRuntime = { id: string; baseUrl?: string; environments?: Record<string, string> };

export class ApiExecutionError extends Error { constructor(message: string, public readonly status = 400) { super(message); } }

function buildPath(template: string, values: Record<string, unknown>) {
  const used = new Set<string>();
  const result = template.replace(/\{([^}]+)\}/g, (_, key: string) => { if (values[key] === undefined || values[key] === "") throw new ApiExecutionError(`Missing path parameter: ${key}`); used.add(key); return encodeURIComponent(String(values[key])); });
  if (Object.keys(values).some((key) => !used.has(key))) throw new ApiExecutionError("Request contains an unknown path parameter");
  return result;
}

async function responseBody(response: Response, limit: number) {
  if (Number(response.headers.get("content-length") ?? 0) > limit) throw new ApiExecutionError("Response exceeded the configured size limit", 502);
  if (!response.body) return "";
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > limit) { await reader.cancel(); throw new ApiExecutionError("Response exceeded the configured size limit", 502); } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const text = new TextDecoder().decode(bytes); if ((response.headers.get("content-type") ?? "").includes("json")) try { return JSON.parse(text); } catch { return text; } return text;
}

export class ApiExecutionAdapter implements ExecutionAdapter<ApiRunInput> {
  readonly id = "api";
  constructor(private readonly sources: ApiSourceRuntime[], private readonly operations: OpenApiOperation[], private readonly options: { timeoutMs?: number; maxResponseBytes?: number } = {}) {}
  async run(input: ApiRunInput, context: ExecutionContext): Promise<ScenarioRunResult> {
    const runId = randomUUID(); const startedAt = new Date().toISOString();
    const source = this.sources.find((item) => item.id === input.sourceId); if (!source) throw new ApiExecutionError("OpenAPI source is not allowed", 403);
    const operation = this.operations.find((item) => item.id === input.operationId && item.sourceId === source.id); if (!operation) throw new ApiExecutionError("OpenAPI operation is not allowed", 403);
    const base = input.environment ? source.environments?.[input.environment] : source.baseUrl ?? operation.baseUrl;
    if (!base) throw new ApiExecutionError("The selected source has no base URL");
    let baseUrl: URL; try { baseUrl = new URL(base); } catch { throw new ApiExecutionError("The configured base URL is invalid", 500); }
    if (!["http:", "https:"].includes(baseUrl.protocol)) throw new ApiExecutionError("Only HTTP(S) base URLs are supported", 500);
    const target = new URL(buildPath(operation.path, input.path ?? {}), `${baseUrl.toString().replace(/\/$/, "")}/`);
    if (target.origin !== baseUrl.origin) throw new ApiExecutionError("OpenAPI path cannot change the configured base URL origin", 500);
    const allowedQuery = new Set(operation.parameters.filter((item) => item.in === "query").map((item) => item.name));
    for (const [key, value] of Object.entries(input.query ?? {})) { if (!allowedQuery.has(key)) throw new ApiExecutionError(`Unknown query parameter: ${key}`); if (value !== undefined && value !== "") target.searchParams.set(key, String(value)); }
    const allowedHeaders = new Set(operation.parameters.filter((item) => item.in === "header").map((item) => item.name.toLowerCase())); allowedHeaders.add("content-type"); allowedHeaders.add("authorization"); allowedHeaders.add("cookie"); allowedHeaders.add("accept");
    const headers: Record<string, string> = {}; for (const [key, value] of Object.entries(input.headers ?? {})) { if (!allowedHeaders.has(key.toLowerCase())) throw new ApiExecutionError(`Unknown header: ${key}`); headers[key] = value; }
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 10_000); const started = Date.now();
    const observedRequest = { timestamp: startedAt, method: operation.method, url: redactUrl(target.toString()), headers: redactHeaders(headers) as Record<string, string>, bodyStored: false as const };
    const testCase: ScenarioApiCase | undefined = input.caseId || input.expectedResponse ? { id: input.caseId ?? "default", title: input.caseId ?? "Default", expectedResponse: input.expectedResponse } : undefined;
    const failureResult = (failureKind: "network-error" | "timeout" | "response-too-large", message: string): ScenarioRunResult => { const finishedAt = new Date().toISOString(); const artifacts: ScenarioArtifact[] = [{ type: "request", label: `${operation.method} ${operation.path}`, url: "", method: operation.method, requestUrl: observedRequest.url, nodeId: context.nodeId, scenarioId: context.scenarioId, redacted: true, runId, caseId: input.caseId }]; return { runId, origin: "api-replay", scenarioId: context.scenarioId, adapter: "api", status: "failed", screenshots: [], traces: [], artifacts, output: "", startedAt, finishedAt, nodeResults: context.nodeId ? [{ runId, origin: "api-replay", nodeId: context.nodeId, caseId: input.caseId, status: "failed", startedAt, finishedAt, error: message, failureKind, artifacts, api: { request: observedRequest } }] : [] }; };
    try {
      const response = await fetch(target, { method: operation.method, headers, body: input.body === undefined ? undefined : JSON.stringify(input.body), redirect: "manual", signal: controller.signal });
      if (response.status >= 300 && response.status < 400) throw new ApiExecutionError("Redirect responses are blocked", 502);
      const body = await responseBody(response, this.options.maxResponseBytes ?? 1_000_000); const durationMs = Date.now() - started;
      const responseHeaders = Object.fromEntries(response.headers.entries()); const assertionResults = evaluateApiAssertions(input.assertions ?? [], { status: response.status, durationMs, headers: responseHeaders, body });
      const matched = matchResponseBranch(operation, response.status); const validation = validateOpenApiSchema(matched.branch?.schema, operation.schemaComponents, body);
      const contentType = response.headers.get("content-type") ?? undefined; const storableBody = !contentType || contentType.includes("json") || contentType.startsWith("text/") ? redactValue(body) : undefined;
      const observedResponse = { status: response.status, statusText: response.statusText, durationMs, headers: redactHeaders(responseHeaders) as Record<string, string>, body: storableBody, contentType, documented: !!matched.branch, branchId: matched.branch?.id, matchType: matched.matchType, schemaValid: validation.valid, validationUnsupported: validation.unsupported, schemaErrors: validation.errors } as const;
      let verdict = classifyApiTest(observedResponse, testCase, assertionResults); const expectedContent = matched.branch?.contentTypes ?? []; if (expectedContent.length && !expectedContent.some((item) => observedResponse.contentType?.split(";")[0] === item)) verdict = { passed: false, failureKind: "invalid-content-type" }; const now = new Date().toISOString();
      const artifacts: ScenarioArtifact[] = [
        { type: "request", label: `${operation.method} ${operation.path}`, url: "", method: operation.method, requestUrl: observedRequest.url, nodeId: context.nodeId, scenarioId: context.scenarioId, redacted: true, mimeType: headers["content-type"] ?? headers["Content-Type"], runId, caseId: input.caseId },
        { type: "response", label: `${response.status} response`, url: "", httpStatus: response.status, durationMs, nodeId: context.nodeId, scenarioId: context.scenarioId, redacted: true, mimeType: response.headers.get("content-type") ?? undefined, runId, caseId: input.caseId },
      ];
      const testStatus = verdict.passed ? "passed" : verdict.failureKind === "validation-unsupported" ? "unsupported" : "failed"; return { runId, origin: "api-replay", scenarioId: context.scenarioId, adapter: "api", status: testStatus === "passed" ? "passed" : "failed", screenshots: [], traces: [], artifacts, output: "", startedAt, finishedAt: now, nodeResults: context.nodeId ? [{ runId, origin: "api-replay", nodeId: context.nodeId, caseId: input.caseId, status: testStatus, durationMs, startedAt, finishedAt: now, artifacts, assertions: assertionResults, api: { request: observedRequest, response: observedResponse }, failureKind: verdict.failureKind }] : [] };
    } catch (error) {
      if (error instanceof ApiExecutionError && error.message.includes("size limit")) return failureResult("response-too-large", error.message);
      if (error instanceof ApiExecutionError) throw error;
      if (error instanceof Error && error.name === "AbortError") return failureResult("timeout", "Request timed out");
      return failureResult("network-error", `Network request failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally { clearTimeout(timeout); }
  }
}
