import { useCallback, useEffect, useState } from "react";
import type { ScenarioRunResult } from "../../core/types";
import { normalizeRunResult } from "../../core/execution";
export type ScenarioRun = ScenarioRunResult;

export function useScenarioRun(scenarioId?: string, source?: string, grep?: string, endpoint = "/api/scenarios") {
  const [result, setResult] = useState<ScenarioRun | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setResult(null); setError(null);
    if (!scenarioId) return;
    fetch(`${endpoint}/${encodeURIComponent(scenarioId)}`).then((response) => response.ok ? response.json() : null).then((value) => setResult(value ? normalizeRunResult(value) : null)).catch(() => null);
  }, [endpoint, scenarioId]);
  const run = useCallback(async () => {
    if (!scenarioId || source === undefined || running) return;
    setRunning(true); setError(null);
    try {
      const response = await fetch(`${endpoint}/${encodeURIComponent(scenarioId)}/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source, grep }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error ?? "Playwright execution failed");
      setResult(normalizeRunResult(value));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setRunning(false); }
  }, [endpoint, grep, running, scenarioId, source]);
  return { result, running, error, run };
}
