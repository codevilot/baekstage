import { useState } from "react";
import { createPortal } from "react-dom";
import { FiPlus } from "react-icons/fi";
import type { ScenarioSuite } from "../core/types";
import type { SuiteRunPolicy, SuiteRunProgress } from "../hooks/scenario/use-suite-run";

type Props = { suite: ScenarioSuite; open: boolean; selectedId?: string | null; batch: { policy: SuiteRunPolicy; running: boolean; progress: SuiteRunProgress }; onPolicy: (policy: SuiteRunPolicy) => void; onRunAll: (policy: SuiteRunPolicy) => void; onStop: () => void; onToggle: () => void; onResize: (width: number) => void; onSelect: (id: string) => void; onAdd?: () => void };

const policies: Array<{ value: SuiteRunPolicy; title: string; description: string }> = [
  { value: "missing", title: "미실행만 실행", description: "기존 결과가 있는 Scenario는 건너뛰고, 아직 실행하지 않은 Scenario만 실행합니다." },
  { value: "all", title: "전체 다시 실행", description: "기존 결과와 관계없이 모든 Scenario를 Run again 합니다." },
  { value: "confirm", title: "기존 결과마다 확인", description: "기존 결과가 있는 Scenario마다 Run again 또는 건너뛰기를 확인합니다." },
];

export function WorkspaceSidebar({ suite, open, selectedId, batch, onPolicy, onRunAll, onStop, onToggle, onResize, onSelect, onAdd }: Props) {
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [draftPolicy, setDraftPolicy] = useState<SuiteRunPolicy>(batch.policy);
  const openConfirmation = () => { setDraftPolicy(batch.policy); setConfirmationOpen(true); };
  const applyPolicy = () => { onPolicy(draftPolicy); setConfirmationOpen(false); onRunAll(draftPolicy); };

  return <><aside className={`workspace-sidebar ${open ? "open" : "collapsed"}`} aria-label="Scenario sidebar">
    <div className="sidebar-heading">
      {open && <div><span>Suite</span><strong>{suite.name}</strong></div>}
      <button onClick={onToggle} aria-label={open ? "Collapse scenario sidebar" : "Open scenario sidebar"} title={open ? "Collapse sidebar" : "Open scenarios"}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d={open ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"}/></svg>
      </button>
    </div>
    {open && <section className="sidebar-batch" aria-label="Run all scenarios">
      <label>전체 실행 정책</label>
      <span>{policies.find((policy) => policy.value === batch.policy)?.title}</span>
      {batch.running ? <button className="stop" onClick={onStop}>중단</button> : <button onClick={openConfirmation}>전체 실행</button>}
      {(batch.running || batch.progress.total > 0) && <div className="sidebar-progress" aria-live="polite"><progress value={batch.progress.completed} max={batch.progress.total || 1}/><span>{batch.progress.completed} / {batch.progress.total}{batch.progress.failed ? ` · 실패 ${batch.progress.failed}` : ""}{batch.progress.skipped ? ` · 건너뜀 ${batch.progress.skipped}` : ""}</span>{batch.running && batch.progress.current && <small title={batch.progress.current}>{batch.progress.current}</small>}</div>}
    </section>}
    {open && <nav aria-label="Scenarios"><div className="sidebar-scenario-heading"><small>Scenarios · {suite.scenarios.length}</small>{onAdd && <button className="sidebar-scenario-add" onClick={onAdd} aria-label="시나리오 추가" title="새 시나리오"><FiPlus aria-hidden="true"/></button>}</div>{suite.scenarios.map((scenario, index) => {
      const failed = scenario.nodes.some((node) => node.status === "failed");
      const passed = !failed && scenario.nodes.some((node) => node.status === "passed");
      return <button className={selectedId === scenario.id ? "selected" : ""} onClick={() => onSelect(scenario.id)} aria-current={selectedId === scenario.id ? "page" : undefined} key={scenario.id}>
        <span>{index + 1}</span><strong>{scenario.title}</strong><i className={failed ? "failed" : passed ? "passed" : "planned"} aria-label={failed ? "Failed" : passed ? "Passed" : "Planned"}/>
      </button>;
    })}</nav>}
    {open && <div className="sidebar-resizer" role="separator" aria-label="Resize scenario sidebar" aria-orientation="vertical" onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) { const left = event.currentTarget.parentElement?.getBoundingClientRect().left ?? 0; onResize(Math.min(420, Math.max(190, event.clientX - left))); } }} onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}/>} 
  </aside>
  {confirmationOpen && createPortal(<div className="suite-run-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmationOpen(false); }}>
    <section className="suite-run-modal" role="dialog" aria-modal="true" aria-labelledby="suite-run-modal-title">
      <header><div><span>Suite execution</span><h2 id="suite-run-modal-title">전체 실행 범위를 확인해 주세요</h2></div><button aria-label="Close suite execution dialog" onClick={() => setConfirmationOpen(false)}>×</button></header>
      <p>기존 실행 결과가 있는 Scenario를 Run again 할지 건너뛸지 선택합니다.</p>
      <fieldset>
        <legend>실행 정책</legend>
        {policies.map((policy) => <label className={draftPolicy === policy.value ? "selected" : ""} key={policy.value}>
          <input type="radio" name="suite-run-policy" value={policy.value} checked={draftPolicy === policy.value} onChange={() => setDraftPolicy(policy.value)}/>
          <span><strong>{policy.title}</strong><small>{policy.description}</small></span>
        </label>)}
      </fieldset>
      <footer><button className="secondary" onClick={() => setConfirmationOpen(false)}>취소</button><button className="primary" onClick={applyPolicy}>적용 후 실행</button></footer>
    </section>
  </div>, document.body)}
  </>;
}
