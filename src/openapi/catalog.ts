import type { OpenApiCatalog, OpenApiMedia, OpenApiOperation, OpenApiParameter, OpenApiResponse, OpenApiResponseBranch, OpenApiResponseHeader, ScenarioNode, ScenarioSuite } from "../core/types";

type RecordValue = Record<string, unknown>;
const methods = ["get", "post", "put", "patch", "delete", "options", "head", "trace"];
const record = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};

export function openApiOperationId(sourceId: string, method: string, path: string) {
  return `openapi:${sourceId}:${method.toUpperCase()}:${path}`;
}

function mediaEntries(content: unknown): OpenApiMedia[] {
  return Object.entries(record(content)).map(([contentType, raw]) => {
    const item = record(raw);
    const examples = record(item.examples);
    const firstExample = Object.values(examples)[0];
    return { contentType, schema: item.schema, example: item.example ?? record(firstExample).value };
  });
}

function parameters(values: unknown[]): OpenApiParameter[] {
  return values.map(record).filter((item) => ["path", "query", "header", "cookie"].includes(String(item.in))).map((item) => ({
    name: String(item.name ?? ""), in: item.in as OpenApiParameter["in"], required: Boolean(item.required), description: typeof item.description === "string" ? item.description : undefined, schema: item.schema, example: item.example,
  }));
}

function responseCategory(pattern: string): OpenApiResponseBranch["category"] {
  if (pattern === "default") return "default";
  return ({ "2": "success", "3": "redirect", "4": "client-error", "5": "server-error" } as const)[pattern[0] as "2" | "3" | "4" | "5"] ?? "default";
}

function responseHeaders(value: unknown): OpenApiResponseHeader[] {
  return Object.entries(record(value)).map(([name, raw]) => { const header = record(raw); return { name, description: typeof header.description === "string" ? header.description : undefined, required: Boolean(header.required), schema: header.schema, example: header.example }; });
}

function responseBranch(operationId: string, status: string, raw: unknown): OpenApiResponseBranch {
  const response = record(raw); const media = mediaEntries(response.content); const normalized = status.toLowerCase() === "default" ? "default" : status.toUpperCase();
  if (!/^(?:[1-5]\d\d|[1-5]XX|default)$/.test(normalized)) throw new Error(`Invalid OpenAPI response status pattern: ${status}`);
  return { id: `${operationId}:response:${normalized}`, statusPattern: normalized, category: responseCategory(normalized), title: typeof response.description === "string" ? response.description : `${normalized} response`, description: typeof response.description === "string" ? response.description : undefined, contentTypes: media.map((item) => item.contentType), schema: media[0]?.schema, example: media[0]?.example, headers: responseHeaders(response.headers) };
}

export function parseOpenApiDocument(source: { id: string; title: string; baseUrl?: string; environments?: Record<string, string> }, input: unknown): OpenApiCatalog {
  const document = record(input);
  if (!String(document.openapi ?? "").startsWith("3.")) throw new Error(`OpenAPI source '${source.id}' must be an OpenAPI 3.x document`);
  if (!document.paths || typeof document.paths !== "object") throw new Error(`OpenAPI source '${source.id}' does not contain paths`);
  const serverUrl = record((Array.isArray(document.servers) ? document.servers[0] : undefined)).url;
  const operations: OpenApiOperation[] = [];
  for (const [path, rawPath] of Object.entries(record(document.paths))) {
    const pathItem = record(rawPath); const shared = Array.isArray(pathItem.parameters) ? pathItem.parameters : [];
    for (const method of methods) {
      if (!pathItem[method]) continue;
      const operation = record(pathItem[method]);
      const operationRef = openApiOperationId(source.id, method, path); const rawResponses = record(operation.responses);
      const responses: OpenApiResponse[] = Object.entries(rawResponses).map(([status, raw]) => { const response = record(raw); return { status, description: typeof response.description === "string" ? response.description : undefined, media: mediaEntries(response.content) }; });
      const body = record(operation.requestBody);
      operations.push({
        id: operationRef, sourceId: source.id, sourceTitle: source.title, method: method.toUpperCase(), path,
        operationId: typeof operation.operationId === "string" ? operation.operationId : undefined,
        summary: typeof operation.summary === "string" ? operation.summary : undefined, description: typeof operation.description === "string" ? operation.description : undefined,
        tags: Array.isArray(operation.tags) && operation.tags.length ? operation.tags.map(String) : ["Other"], parameters: parameters([...shared, ...(Array.isArray(operation.parameters) ? operation.parameters : [])]),
        requestBody: Object.keys(body).length ? { required: Boolean(body.required), media: mediaEntries(body.content) } : undefined,
        responses, responseBranches: Object.entries(rawResponses).map(([status, raw]) => responseBranch(operationRef, status, raw)), schemaComponents: document.components,
        baseUrl: source.baseUrl ?? (typeof serverUrl === "string" ? serverUrl : undefined), environments: source.environments,
      });
    }
  }
  return { operations };
}

export function scenariosForOperation(suite: ScenarioSuite, operationId: string) {
  return suite.scenarios.filter((scenario) => scenario.nodes.some((node) => node.ref === operationId));
}

export function operationTestState(suite: ScenarioSuite, operationId: string): "unlinked" | "untested" | "passed" | "failed" | "schema-mismatch" {
  const nodes = suite.scenarios.flatMap((scenario) => scenario.nodes).filter((node) => node.ref === operationId);
  if (!nodes.length) return "unlinked";
  if (nodes.some((node) => node.metadata?.schemaMismatch)) return "schema-mismatch";
  if (nodes.some((node) => node.status === "failed")) return "failed";
  if (nodes.some((node) => node.status === "passed")) return "passed";
  return "untested";
}

export function apiNodeState(node: ScenarioNode, catalog: OpenApiCatalog): "documented" | "undocumented" | "untested" | "passed" | "failed" | "schema-mismatch" {
  if (!node.ref || !catalog.operations.some((operation) => operation.id === node.ref)) return "undocumented";
  if (node.metadata?.schemaMismatch) return "schema-mismatch";
  if (node.status === "passed" || node.status === "failed") return node.status;
  return node.status ? "untested" : "documented";
}
