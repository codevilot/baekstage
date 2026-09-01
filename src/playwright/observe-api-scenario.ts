import type { NetworkStepMarker, ObservedNetworkRecord, ObservedPlaywrightStep } from "../core/types";
import { redactHeaders, redactText, redactUrl, redactValue } from "../core/security";

type RequestLike = { method(): string; url(): string; headers(): Record<string, string>; postDataJSON?(): unknown; failure?(): { errorText?: string } | null };
type ResponseLike = { request(): RequestLike; status(): number; statusText(): string; headers(): Record<string, string>; body(): Promise<Uint8Array> };
type PageLike = { on(event: "request" | "response" | "requestfailed", listener: (...args: any[]) => void): void; off?(event: string, listener: (...args: any[]) => void): void };
type TestInfoLike = { title?: string; attach(name: string, options: { body: any; contentType: string }): Promise<void> };
export type NetworkFilter = string | { url?: string; method?: string; sourceId?: string };
export type ObserveApiScenarioOptions = { scenarioId: string; maxResponseBytes?: number; includeRequestBody?: boolean; include?: NetworkFilter[]; exclude?: NetworkFilter[]; redactKeys?: string[]; flushTimeoutMs?: number };
export type NetworkStepOptions = Omit<NetworkStepMarker, "id"> & { id: string };
export type BaekstageNetworkFixture = { records: ObservedNetworkRecord[]; steps: ObservedPlaywrightStep[]; step<T>(marker: string | NetworkStepOptions, action: () => Promise<T>): Promise<T>; markNode(nodeId: string): Promise<void>; flush(): Promise<void> };
export const NETWORK_ATTACHMENT_PREFIX = "baekstage-network:";
export const STEP_ATTACHMENT_PREFIX = "baekstage-steps:";
const activePages = new WeakSet<object>();

function globMatch(pattern: string, value: string) { const escaped = pattern.replace(/\*\*/g, "\0").replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\0/g, ".*"); return new RegExp(`^${escaped}$`).test(value); }
function filterMatches(filter: NetworkFilter, method: string, url: string) { if (typeof filter === "string") return globMatch(filter, url); return (!filter.method || filter.method.toUpperCase() === method.toUpperCase()) && (!filter.url || globMatch(filter.url, url)); }

export function observeApiScenario(page: PageLike, testInfo: TestInfoLike, options: ObserveApiScenarioOptions): BaekstageNetworkFixture {
  if (activePages.has(page as object)) throw new Error("Baekstage network observation is already active for this page");
  activePages.add(page as object);
  const records: ObservedNetworkRecord[] = []; const steps: ObservedPlaywrightStep[] = []; const pending = new Set<Promise<void>>(); const inFlight = new Set<RequestLike>(); const started = new WeakMap<RequestLike, number>(); const byRequest = new WeakMap<RequestLike, ObservedNetworkRecord>(); const activeSteps: NetworkStepMarker[] = [];
  let flushed: Promise<void> | undefined; let markCursor = 0;
  const sourceIds = options.include?.flatMap((item) => typeof item === "object" && item.sourceId ? [item.sourceId] : []) ?? [];
  const onRequest = (request: RequestLike) => {
    const rawUrl = request.url(); const method = request.method(); const excluded = options.exclude?.some((item) => filterMatches(item, method, rawUrl)) ?? false; const includedFilters = options.include?.filter((item) => typeof item === "string" || item.url || item.method) ?? []; const included = !includedFilters.length || includedFilters.some((item) => filterMatches(item, method, rawUrl));
    let body: unknown; let bodyStored = false; if (options.includeRequestBody) try { body = redactValue(request.postDataJSON?.(), options.redactKeys); bodyStored = body !== undefined; } catch {}
    started.set(request, Date.now()); inFlight.add(request); const record: ObservedNetworkRecord = { request: { timestamp: new Date().toISOString(), method, url: redactUrl(rawUrl), headers: redactHeaders(request.headers()) as Record<string, string>, body, bodyStored, bodyStorageReason: bodyStored ? "stored" : options.includeRequestBody ? "unavailable" : "disabled" }, step: activeSteps.at(-1), matchStatus: excluded || !included ? "ignored" : undefined, includeSourceIds: sourceIds.length ? sourceIds : undefined };
    records.push(record); byRequest.set(request, record);
  };
  const captureResponse = async (response: ResponseLike) => { const request = response.request(); const record = byRequest.get(request); if (!record) return; const headers = response.headers(); const contentType = headers["content-type"] ?? ""; let body: unknown; try { const bytes = await response.body(); if (bytes.byteLength <= (options.maxResponseBytes ?? 250_000) && /(^|[+/])json\b/i.test(contentType)) body = redactValue(JSON.parse(new TextDecoder().decode(bytes)), options.redactKeys); } catch {} record.response = { status: response.status(), statusText: response.statusText(), durationMs: Date.now() - (started.get(request) ?? Date.now()), headers: redactHeaders(headers) as Record<string, string>, body, contentType }; inFlight.delete(request); };
  const onResponse = (response: ResponseLike) => { const task = captureResponse(response).finally(() => pending.delete(task)); pending.add(task); };
  const onFailed = (request: RequestLike) => { const record = byRequest.get(request); if (record) record.error = request.failure?.()?.errorText ?? "Network request failed"; inFlight.delete(request); };
  page.on("request", onRequest); page.on("response", onResponse); page.on("requestfailed", onFailed);
  const attachmentName = (prefix: string) => `${prefix}${encodeURIComponent(JSON.stringify({ scenarioId: options.scenarioId }))}`;
  const flush = () => flushed ??= (async () => { page.off?.("request", onRequest); const deadline = Date.now() + (options.flushTimeoutMs ?? 1_000); while ((inFlight.size || pending.size) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10)); page.off?.("response", onResponse); page.off?.("requestfailed", onFailed); activePages.delete(page as object); await Promise.allSettled([...pending]); const safeRecords = redactValue(records, options.redactKeys); const safeSteps = redactValue(steps, options.redactKeys); await testInfo.attach(attachmentName(NETWORK_ATTACHMENT_PREFIX), { body: Buffer.from(JSON.stringify(safeRecords)), contentType: "application/json" }); await testInfo.attach(attachmentName(STEP_ATTACHMENT_PREFIX), { body: Buffer.from(JSON.stringify(safeSteps)), contentType: "application/json" }); })();
  return { records, steps, async step<T>(marker: string | NetworkStepOptions, action: () => Promise<T>) { const value: NetworkStepMarker = typeof marker === "string" ? { id: marker } : marker; const startedAt = new Date(); const startedMs = Date.now(); activeSteps.push(value); try { const result = await action(); const finishedAt = new Date(); steps.push({ marker: value, status: "passed", startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), durationMs: Date.now() - startedMs }); return result; } catch (error) { const finishedAt = new Date(); steps.push({ marker: value, status: "failed", startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(), durationMs: Date.now() - startedMs, error: redactText(error instanceof Error ? error.message : String(error)) }); throw error; } finally { activeSteps.splice(activeSteps.lastIndexOf(value), 1); } }, async markNode(nodeId: string) { for (const record of records.slice(markCursor)) if (!record.step) record.step = { id: `mark:${nodeId}`, toNodeId: nodeId }; markCursor = records.length; }, flush };
}

export function createBaekstageTest(base: any, options: Omit<ObserveApiScenarioOptions, "scenarioId"> & { scenarioIdFromTest?: (test: { title: string }) => string } = {}) {
  return base.extend({ baekstage: async ({ page }: { page: PageLike }, use: (fixture: BaekstageNetworkFixture) => Promise<void>, testInfo: TestInfoLike) => { const observer = observeApiScenario(page, testInfo, { ...options, scenarioId: options.scenarioIdFromTest?.({ title: testInfo.title ?? "" }) ?? testInfo.title ?? "unknown-scenario" }); try { await use(observer); } finally { await observer.flush(); } } });
}

export function readNetworkAttachmentName(name: string) { if (!name.startsWith(NETWORK_ATTACHMENT_PREFIX)) return null; try { return JSON.parse(decodeURIComponent(name.slice(NETWORK_ATTACHMENT_PREFIX.length))) as { scenarioId: string }; } catch { return null; } }
export function readStepAttachmentName(name: string) { if (!name.startsWith(STEP_ATTACHMENT_PREFIX)) return null; try { return JSON.parse(decodeURIComponent(name.slice(STEP_ATTACHMENT_PREFIX.length))) as { scenarioId: string }; } catch { return null; } }
