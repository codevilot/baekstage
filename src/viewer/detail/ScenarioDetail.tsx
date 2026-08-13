import { Background, Controls, ReactFlow } from "@xyflow/react";
import type { ScenarioGraph, ScenarioNode } from "../../core/types";
import type { DetailNode } from "../../hooks/graph/use-detail-graph";
import { useDetailGraph } from "../../hooks/graph/use-detail-graph";
import { facetColor, ScenarioGraphNode } from "../nodes/ScenarioGraphNode";

const nodeTypes = { scenario: ScenarioGraphNode };
export function ScenarioDetail({ graph, scenario, selected, onSelect }: { graph: ScenarioGraph; scenario: ScenarioGraph; selected: ScenarioNode; onSelect: (id: string) => void }) {
  const { nodes, edges } = useDetailGraph(graph);
  return <div className="workspace"><section className="canvas"><ReactFlow<DetailNode> nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: .2 }} nodesDraggable={false} nodesConnectable={false} onNodeClick={(_, node) => onSelect(node.id)}><Background gap={24}/><Controls showInteractive={false}/></ReactFlow></section><aside><span className="eyebrow">Selected test step</span><h2>{selected.title}</h2><span className={`badge color-${facetColor(selected.kind)}`}>{selected.kind}</span><p>{selected.description ?? "설명이 없습니다."}</p>{!!selected.artifacts?.length && <section className="artifacts"><h3>Playwright artifacts</h3>{selected.artifacts.map((artifact) => artifact.type === "screenshot" ? <a href={artifact.url} target="_blank" rel="noreferrer" key={artifact.url}><img src={artifact.url} alt={artifact.label}/><span>{artifact.label}</span></a> : <a className="artifact-link" href={artifact.url} target="_blank" rel="noreferrer" key={artifact.url}>{artifact.label} ↗</a>)}</section>}<dl>{Object.entries(selected.metadata ?? {}).map(([key,value]) => <div key={key}><dt>{key}</dt><dd><code>{String(value)}</code></dd></div>)}<div><dt>Status</dt><dd>{selected.status ?? "planned"}</dd></div></dl>{!!selected.assertions?.length && <><h3>Assertions</h3><ul>{selected.assertions.map((item) => <li key={item}>✓ {item}</li>)}</ul></>}{scenario.source && <footer><span>Source</span><code>{scenario.source}</code></footer>}</aside></div>;
}
