import { useCallback, useRef, useState } from "react";
import type { ScenarioGraph, ScenarioRunResult } from "../../core/types";
import { normalizeExecution, normalizeRunResult } from "../../core/execution";

export type SuiteRunPolicy = "missing" | "all" | "confirm";
export type SuiteRunProgress = { completed: number; total: number; current?: string; failed: number; skipped: number };

export function useSuiteRun(endpoint = "/api/scenarios", onResult: (result: ScenarioRunResult) => void) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<SuiteRunProgress>({ completed: 0, total: 0, failed: 0, skipped: 0 });
  const controller = useRef<AbortController | null>(null);

  const stop = useCallback(() => controller.current?.abort(), []);
  const run = useCallback(async (scenarios: ScenarioGraph[], policy: SuiteRunPolicy) => {
    if (running) return;
    const runnable = scenarios.flatMap((scenario) => {
      const execution = normalizeExecution(scenario);
      return execution.adapter === "playwright" && execution.source !== undefined ? [{ scenario, execution }] : [];
    });
    const abort = new AbortController(); controller.current = abort; setRunning(true);
    let completed = 0; let failed = 0; let skipped = 0;
    setProgress({ completed, total: runnable.length, failed, skipped });
    try {
      for (const { scenario, execution } of runnable) {
        if (abort.signal.aborted) break;
        setProgress({ completed, total: runnable.length, current: scenario.title, failed, skipped });
        let previous: ScenarioRunResult | null = null;
        try {
          const response = await fetch(`${endpoint}/${encodeURIComponent(scenario.id)}`, { signal: abort.signal });
          if (response.ok) { previous = normalizeRunResult(await response.json()); onResult(previous); }
        } catch (error) { if (abort.signal.aborted) break; }
        const shouldRun = policy === "all" || !previous || (policy === "confirm" && window.confirm(`“${scenario.title}”에는 기존 실행 결과가 있습니다. 다시 실행할까요?`));
        if (!shouldRun) { skipped += 1; completed += 1; continue; }
        try {
          const response = await fetch(`${endpoint}/${encodeURIComponent(scenario.id)}/run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: execution.source, grep: execution.grep }), signal: abort.signal });
          const value = await response.json();
          if (!response.ok) throw new Error(value.error ?? "Playwright execution failed");
          const result = normalizeRunResult(value); onResult(result); if (result.status === "failed") failed += 1;
        } catch (error) { if (!abort.signal.aborted) failed += 1; }
        completed += 1;
      }
    } finally {
      setProgress({ completed, total: runnable.length, failed, skipped });
      controller.current = null; setRunning(false);
    }
  }, [endpoint, onResult, running]);
  return { running, progress, run, stop };
}
