import type { ScenarioSuite } from "../core/types";
import type { SuiteRunPolicy, SuiteRunProgress } from "../hooks/scenario/use-suite-run";

type Props = { suite: ScenarioSuite; open: boolean; selectedId?: string | null; batch: { policy: SuiteRunPolicy; running: boolean; progress: SuiteRunProgress }; onPolicy: (policy: SuiteRunPolicy) => void; onRunAll: () => void; onStop: () => void; onToggle: () => void; onResize: (width: number) => void; onSelect: (id: string) => void };

export function WorkspaceSidebar({ suite, open, selectedId, batch, onPolicy, onRunAll, onStop, onToggle, onResize, onSelect }: Props) {
  return <aside className={`workspace-sidebar ${open ? "open" : "collapsed"}`} aria-label="Scenario sidebar">
    <div className="sidebar-heading">
      {open && <div><span>Suite</span><strong>{suite.name}</strong></div>}
      <button onClick={onToggle} aria-label={open ? "Collapse scenario sidebar" : "Open scenario sidebar"} title={open ? "Collapse sidebar" : "Open scenarios"}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d={open ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"}/></svg>
      </button>
    </div>
    {open && <section className="sidebar-batch" aria-label="Run all scenarios">
      <label htmlFor="suite-run-policy">전체 실행 정책</label>
      <select id="suite-run-policy" value={batch.policy} disabled={batch.running} onChange={(event) => onPolicy(event.target.value as SuiteRunPolicy)}><option value="missing">미실행만 실행</option><option value="all">전체 다시 실행</option><option value="confirm">항목마다 확인</option></select>
      {batch.running ? <button className="stop" onClick={onStop}>중단</button> : <button onClick={onRunAll}>전체 실행</button>}
      {(batch.running || batch.progress.total > 0) && <div className="sidebar-progress" aria-live="polite"><progress value={batch.progress.completed} max={batch.progress.total || 1}/><span>{batch.progress.completed} / {batch.progress.total}{batch.progress.failed ? ` · 실패 ${batch.progress.failed}` : ""}{batch.progress.skipped ? ` · 건너뜀 ${batch.progress.skipped}` : ""}</span>{batch.running && batch.progress.current && <small title={batch.progress.current}>{batch.progress.current}</small>}</div>}
    </section>}
    {open && <nav aria-label="Scenarios"><small>Scenarios · {suite.scenarios.length}</small>{suite.scenarios.map((scenario, index) => {
      const failed = scenario.nodes.some((node) => node.status === "failed");
      const passed = !failed && scenario.nodes.some((node) => node.status === "passed");
      return <button className={selectedId === scenario.id ? "selected" : ""} onClick={() => onSelect(scenario.id)} aria-current={selectedId === scenario.id ? "page" : undefined} key={scenario.id}>
        <span>{index + 1}</span><strong>{scenario.title}</strong><i className={failed ? "failed" : passed ? "passed" : "planned"} aria-label={failed ? "Failed" : passed ? "Passed" : "Planned"}/>
      </button>;
    })}</nav>}
    {open && <div className="sidebar-resizer" role="separator" aria-label="Resize scenario sidebar" aria-orientation="vertical" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) { const left = event.currentTarget.parentElement?.getBoundingClientRect().left ?? 0; onResize(Math.min(420, Math.max(190, event.clientX - left))); } }} onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}/>} 
  </aside>;
}
