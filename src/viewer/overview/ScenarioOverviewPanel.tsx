import type { ScenarioGraph } from "../../core/types";

export function ScenarioOverviewPanel({ scenario, onClose, onOpen }: { scenario: ScenarioGraph; onClose: () => void; onOpen: () => void }) {
  const failed = scenario.nodes.filter((node) => node.status === "failed");
  const facets = new Map<string, Set<string>>();
  for (const node of scenario.nodes) for (const [key, values] of Object.entries(node.facets ?? {})) {
    const current = facets.get(key) ?? new Set<string>();
    values.forEach((value) => current.add(value));
    facets.set(key, current);
  }
  return <aside className="overview-panel">
    <button className="panel-close" aria-label="Close scenario details" onClick={onClose}>×</button>
    <span className="eyebrow">Scenario summary</span><h2>{scenario.title}</h2>
    <span className={`scenario-state ${failed.length ? "failed" : "passed"}`}>{failed.length ? `${failed.length} FAILED` : "NO FAILURES"}</span>
    <p>{scenario.description ?? "설명이 없습니다."}</p>
    <dl><div><dt>Nodes</dt><dd>{scenario.nodes.length}</dd></div><div><dt>Branches</dt><dd>{scenario.edges.filter((edge) => edge.branch).length}</dd></div></dl>
    {[...facets].map(([key, values]) => <section key={key}><h3>{key}</h3><div className="panel-chips">{[...values].map((value) => <span key={value}>{value}</span>)}</div></section>)}
    {failed.length > 0 && <section><h3>Failed nodes</h3><ul>{failed.map((node) => <li key={node.id}>{node.title}</li>)}</ul></section>}
    <button className="panel-open" onClick={onOpen}>상세 Graph 열기 →</button>
  </aside>;
}
