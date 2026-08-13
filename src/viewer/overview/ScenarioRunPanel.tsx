import type { ScenarioRun } from "../../hooks/scenario/use-scenario-run";

export function ScenarioRunPanel({ result, running, error, disabled, onRun }: { result: ScenarioRun | null; running: boolean; error: string | null; disabled?: boolean; onRun: () => void }) {
  return <section className="scenario-run-panel" aria-live="polite">
    <div><strong>Playwright run</strong>{result && <span className={result.status}>{result.status}</span>}</div>
    {result ? <small>마지막 실행: {new Date(result.finishedAt).toLocaleString()}</small> : <small>저장된 실행 결과가 없습니다.</small>}
    {error && <p>{error}</p>}
    <button onClick={onRun} disabled={disabled || running}>{running ? <><i/> Playwright 전체 실행 중…</> : result ? "전체 테스트 다시 실행" : "전체 Playwright 테스트 실행"}</button>
    {result?.output && result.status === "failed" && <details><summary>실패 로그 보기</summary><pre>{result.output}</pre></details>}
  </section>;
}
