import type { ScenarioSuite } from "../core/types";

export function WorkspaceSidebar({ suite, open, selectedId, onToggle, onResize, onSelect }: { suite: ScenarioSuite; open: boolean; selectedId?: string | null; onToggle: () => void; onResize: (width: number) => void; onSelect: (id: string) => void }) {
  return <aside className={`workspace-sidebar ${open ? "open" : "collapsed"}`} aria-label="Scenario sidebar">
    <div className="sidebar-heading">
      {open && <div><span>Suite</span><strong>{suite.name}</strong></div>}
      <button onClick={onToggle} aria-label={open ? "Collapse scenario sidebar" : "Open scenario sidebar"} title={open ? "Collapse sidebar" : "Open scenarios"}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d={open ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"}/></svg>
      </button>
    </div>
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
