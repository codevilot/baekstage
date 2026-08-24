import type { ApiFailureKind, AssertionResult, ObservedApiRequest, OpenApiOperation, OpenApiResponseBranch, ObservedApiResponse, ScenarioApiCase, ScenarioEdge, ScenarioGraph, ScenarioNodeResult } from "./types";

export function statusPatternMatches(pattern: string, status: number) {
  const normalized = pattern.toUpperCase();
  if (/^\d{3}$/.test(normalized)) return Number(normalized) === status;
  if (/^[1-5]XX$/.test(normalized)) return Math.floor(status / 100) === Number(normalized[0]);
  return normalized === "DEFAULT";
}

export function matchResponseBranch(operation: OpenApiOperation, status: number): { branch?: OpenApiResponseBranch; matchType: ObservedApiResponse["matchType"] } {
  const exact = operation.responseBranches.find((branch) => /^\d{3}$/.test(branch.statusPattern) && Number(branch.statusPattern) === status);
  if (exact) return { branch: exact, matchType: "exact" };
  const range = operation.responseBranches.find((branch) => /^[1-5]XX$/.test(branch.statusPattern) && statusPatternMatches(branch.statusPattern, status));
  if (range) return { branch: range, matchType: "range" };
  const fallback = operation.responseBranches.find((branch) => branch.statusPattern === "default");
  return fallback ? { branch: fallback, matchType: "default" } : { matchType: "undocumented" };
}

export function classifyApiTest(response: ObservedApiResponse, testCase: ScenarioApiCase | undefined, assertions: AssertionResult[]): { passed: boolean; failureKind?: ApiFailureKind } {
  if (!response.documented) return { passed: false, failureKind: "undocumented-response" };
  if (testCase?.expectedResponse) {
    const expected = testCase.expectedResponse;
    const matches = expected.toLowerCase() === "default" ? response.matchType === "default" : statusPatternMatches(expected, response.status);
    if (!matches) return { passed: false, failureKind: "unexpected-status" };
  } else if (response.status < 200 || response.status >= 300) return { passed: false, failureKind: "unexpected-status" };
  if (response.validationUnsupported) return { passed: false, failureKind: "validation-unsupported" };
  if (response.schemaValid === false) return { passed: false, failureKind: "schema-mismatch" };
  if (assertions.some((item) => item.status === "failed")) return { passed: false, failureKind: "assertion-failed" };
  return { passed: true };
}

export function matchApiCase(cases: ScenarioApiCase[], status: number, matchType: ObservedApiResponse["matchType"]) {
  return cases.find((item) => /^\d{3}$/.test(item.expectedResponse ?? "") && statusPatternMatches(item.expectedResponse!, status))
    ?? cases.find((item) => /^[1-5]XX$/i.test(item.expectedResponse ?? "") && statusPatternMatches(item.expectedResponse!, status))
    ?? (matchType === "default" ? cases.find((item) => item.expectedResponse?.toLowerCase() === "default") : undefined);
}

function comparable(value: unknown) { return typeof value === "string" && value.startsWith("$") ? undefined : value; }
function subset(expected: unknown, actual: unknown): boolean {
  if (comparable(expected) === undefined) return true;
  if (Array.isArray(expected)) return Array.isArray(actual) && expected.length === actual.length && expected.every((item, index) => subset(item, actual[index]));
  if (expected && typeof expected === "object") return !!actual && typeof actual === "object" && Object.entries(expected as Record<string, unknown>).every(([key, item]) => subset(item, (actual as Record<string, unknown>)[key]));
  return Object.is(expected, actual) || String(expected) === String(actual);
}
function requestMatches(testCase: ScenarioApiCase, request: ObservedApiRequest, operation: OpenApiOperation) {
  const definition = testCase.request; if (!definition) return true;
  let url: URL; try { url = new URL(request.url); } catch { return false; }
  const names = [...operation.path.matchAll(/\{([^}]+)\}/g)].map((item) => item[1]); const paths = [operation.path]; if (operation.baseUrl) try { const base = new URL(operation.baseUrl).pathname.replace(/\/$/, ""); if (base) paths.push(`${base}/${operation.path.replace(/^\//, "")}`); } catch {} const values = paths.map((candidate) => url.pathname.match(new RegExp(`^${candidate.split(/\{[^}]+\}/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("([^/]+)")}/?$`))?.slice(1)).find(Boolean) ?? [];
  const actualPath = Object.fromEntries(names.map((name, index) => [name, decodeURIComponent(values[index] ?? "")])); const actualQuery = Object.fromEntries(url.searchParams);
  return subset(definition.path, actualPath) && subset(definition.query, actualQuery) && (!request.bodyStored || subset(definition.body, request.body));
}
export function matchObservedApiCase(cases: ScenarioApiCase[], operation: OpenApiOperation, request: ObservedApiRequest, status: number, matchType: ObservedApiResponse["matchType"], caseIdHint?: string): { testCase?: ScenarioApiCase; status: "matched" | "ambiguous" | "observed-only"; candidates?: ScenarioApiCase[] } {
  if (caseIdHint) { const hinted = cases.filter((item) => item.id === caseIdHint); return hinted.length === 1 ? { testCase: hinted[0], status: "matched" } : { status: "observed-only" }; }
  const exactCases = cases.filter((item) => /^\d{3}$/.test(item.expectedResponse ?? "") && statusPatternMatches(item.expectedResponse!, status)); const rangeCases = cases.filter((item) => /^[1-5]XX$/i.test(item.expectedResponse ?? "") && statusPatternMatches(item.expectedResponse!, status)); const defaultCases = matchType === "default" ? cases.filter((item) => item.expectedResponse?.toLowerCase() === "default") : []; const branchCases = exactCases.length ? exactCases : rangeCases.length ? rangeCases : defaultCases;
  if (branchCases.length === 1) return { testCase: branchCases[0], status: "matched" };
  const requestCases = branchCases.filter((item) => requestMatches(item, request, operation));
  return requestCases.length === 1 ? { testCase: requestCases[0], status: "matched" } : requestCases.length > 1 || branchCases.length > 1 ? { status: "ambiguous", candidates: requestCases.length ? requestCases : branchCases } : { status: "observed-only" };
}

export type ResponseBranchCoverage = { branch: OpenApiResponseBranch; connected: boolean; hasCase: boolean; tested: boolean; latest?: ScenarioNodeResult; status: "passed" | "failed" | "untested" };
export function responseBranchCoverage(operation: OpenApiOperation, graph: ScenarioGraph | undefined, nodeId: string | undefined, additionalResults: ScenarioNodeResult[] = []): ResponseBranchCoverage[] {
  const node = graph?.nodes.find((item) => item.id === nodeId);
  return operation.responseBranches.map((branch) => {
    const matchingCases = node?.cases?.filter((item) => item.expectedResponse && (item.expectedResponse.toLowerCase() === branch.statusPattern.toLowerCase())) ?? [];
    const results = [...(node?.resultHistory ?? []), ...additionalResults].filter((result, index, all) => all.findIndex((item) => item.runId === result.runId) === index).filter((result) => result.api?.response?.branchId === branch.id);
    const latest = results.at(-1);
    const connected = graph?.edges.some((edge) => edge.source === nodeId && edge.response?.toLowerCase() === branch.statusPattern.toLowerCase()) ?? false;
    return { branch, connected, hasCase: matchingCases.length > 0, tested: results.length > 0, latest, status: latest ? latest.status === "passed" ? "passed" : "failed" : "untested" };
  });
}

export function validateResponseEdges(graph: ScenarioGraph, operations: OpenApiOperation[]) {
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const edge of graph.edges.filter((item) => item.response)) {
    const source = graph.nodes.find((node) => node.id === edge.source);
    if (source?.kind !== "api") { warnings.push(`Scenario edge "${edge.id}" uses response ${edge.response}, but its source is not an API node.`); continue; }
    const operation = operations.find((item) => item.id === source.ref);
    if (!operation?.responseBranches.some((branch) => branch.statusPattern.toLowerCase() === edge.response?.toLowerCase())) warnings.push(`Scenario edge "${edge.id}" references response ${edge.response}, but ${source.ref ?? source.id} does not document it.`);
    const key = `${edge.source}:${edge.response?.toLowerCase()}`; if (seen.has(key)) warnings.push(`Scenario node "${edge.source}" connects response ${edge.response} more than once.`); seen.add(key);
  }
  return warnings;
}
