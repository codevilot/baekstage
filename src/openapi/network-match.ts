import type { NetworkMatchStatus, OpenApiOperation } from "../core/types";

function decodedPath(value: string) { return value.split("/").map((part) => { try { return decodeURIComponent(part); } catch { return part; } }).join("/").replace(/\/+$/, "") || "/"; }
function joinPath(base: string, operation: string) { return `${base.replace(/\/+$/, "")}/${operation.replace(/^\/+/, "")}`; }
function pathPattern(template: string) { return new RegExp(`^${decodedPath(template).split(/\{[^}]+\}/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^/]+")}/?$`); }
function operationPaths(operation: OpenApiOperation) {
  const paths = new Set([operation.path]);
  if (operation.baseUrl) try { const base = new URL(operation.baseUrl); if (base.pathname !== "/") paths.add(joinPath(base.pathname, operation.path)); } catch {}
  return [...paths];
}
function candidateMatches(operation: OpenApiOperation, method: string, url: URL) {
  if (operation.method !== method.toUpperCase()) return false;
  if (operation.baseUrl) try { if (new URL(operation.baseUrl).origin !== url.origin) return false; } catch { return false; }
  return operationPaths(operation).some((item) => pathPattern(item).test(decodedPath(url.pathname)));
}

export type NetworkOperationMatch = { operation?: OpenApiOperation; status: NetworkMatchStatus; candidates?: OpenApiOperation[]; reason?: string };
export function matchNetworkOperation(operations: OpenApiOperation[], method: string, requestUrl: string, hints: { operationId?: string; sourceId?: string; includeSourceIds?: string[]; ignored?: boolean } = {}): NetworkOperationMatch {
  if (hints.ignored) return { status: "ignored", reason: "Excluded by observer filter" };
  let url: URL; try { url = new URL(requestUrl); } catch { return { status: "undocumented", reason: "Invalid request URL" }; }
  let allowed = operations;
  if (hints.includeSourceIds?.length) allowed = allowed.filter((item) => hints.includeSourceIds!.includes(item.sourceId));
  if (hints.sourceId) allowed = allowed.filter((item) => item.sourceId === hints.sourceId);
  if (hints.operationId) {
    const hinted = allowed.filter((item) => item.id === hints.operationId || item.operationId === hints.operationId);
    if (hinted.length === 1 && candidateMatches(hinted[0], method, url)) return { operation: hinted[0], status: "matched" };
    if (hinted.length > 1) return { status: "ambiguous", candidates: hinted, reason: "Operation hint resolves to multiple operations" };
    return { status: "undocumented", reason: "Operation hint does not match method, origin, or path" };
  }
  const matches = allowed.filter((operation) => candidateMatches(operation, method, url));
  return matches.length === 1 ? { operation: matches[0], status: "matched" } : matches.length > 1 ? { status: "ambiguous", candidates: matches, reason: "Multiple OpenAPI operations match" } : { status: "undocumented", reason: "No OpenAPI operation matches" };
}
