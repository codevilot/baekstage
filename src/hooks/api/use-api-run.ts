import { useState } from "react";
import type { ApiAssertion, ScenarioRunResult } from "../../core/types";

export type WorkbenchInput = { sourceId: string; operationId: string; scenarioId: string; nodeId: string; caseId?: string; expectedResponse?: string; environment?: string; path: Record<string, unknown>; query: Record<string, unknown>; headers: Record<string, string>; body?: unknown; assertions: ApiAssertion[] };
export type ApiRunResponse = ScenarioRunResult;

export function useApiRun(endpoint = "/api/operations", onResult?: (result: ApiRunResponse) => void) {
  const [result, setResult] = useState<ApiRunResponse | null>(null); const [history, setHistory] = useState<ApiRunResponse[]>([]); const [running, setRunning] = useState(false); const [error, setError] = useState<string | null>(null);
  const run = async (input: WorkbenchInput) => {
    setRunning(true); setError(null);
    try { const response = await fetch(`${endpoint}/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) }); const value = await response.json(); if (!response.ok) throw new Error(value.error ?? "API request failed"); setResult(value); setHistory((items) => [...items.filter((item) => item.runId !== value.runId), value]); onResult?.(value); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setRunning(false); }
  };
  const loadHistory = async (scenarioId: string, nodeId: string) => { try { const response = await fetch(`${endpoint}/history/${encodeURIComponent(scenarioId)}/${encodeURIComponent(nodeId)}`); if (response.ok) setHistory(await response.json()); } catch {} };
  return { result, history, running, error, run, loadHistory, clear: () => { setResult(null); setError(null); } };
}
