import { Background, Controls, ReactFlow } from "@xyflow/react";
import type { ScenarioArtifact, ScenarioGraph, ScenarioNode } from "../../core/types";
import { scenarioNodeContext } from "../../core/scenario-acts";
import { screenshotsForNode } from "../../core/artifacts";
import type { DetailNode } from "../../hooks/graph/use-detail-graph";
import { useDetailGraph } from "../../hooks/graph/use-detail-graph";
import { facetColor, ScenarioGraphNode } from "../nodes/ScenarioGraphNode";
import { ScreenshotGallery } from "../overview/ScreenshotGallery";

const nodeTypes = { scenario: ScenarioGraphNode };
const json = (value: unknown) => JSON.stringify(value, null, 2);
export function ScenarioDetail({ graph, scenario, selected, screenshots = [], traceViewerEndpoint, onSelect, onOpenStory }: { graph: ScenarioGraph; scenario: ScenarioGraph; selected: ScenarioNode; screenshots?: ScenarioArtifact[]; traceViewerEndpoint?: string; onSelect: (id: string) => void; onOpenStory?: (storyId: string) => void }) {
  const { nodes, edges } = useDetailGraph(graph); const context = scenarioNodeContext(scenario, selected.id); const result = selected.latestResult ?? selected.resultHistory?.at(-1); const request = result?.api?.request; const response = result?.api?.response; const images = screenshotsForNode(selected.id, [...screenshots, ...(selected.artifacts ?? [])]).filter((item, index, all) => all.findIndex((candidate) => candidate.url === item.url) === index);
  return <div className="workspace">
    <section className="canvas"><ReactFlow<DetailNode> nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: .2 }} nodesDraggable={false} nodesConnectable={false} onNodeClick={(_, node) => onSelect(node.id)}><Background gap={24}/><Controls showInteractive={false}/></ReactFlow></section>
    <aside className="step-inspector">
      <nav className="scenario-breadcrumb" aria-label="Scenario hierarchy"><span>Scenario</span><b>›</b><span>Act {context.actIndex + 1}</span><b>›</b><strong>Step {context.stepIndex + 1}</strong></nav>
      <section className="act-strip"><small>Act {context.actIndex + 1} of {context.acts.length}</small><h3>{context.act?.title}</h3><div>{context.act?.nodes.map((node, index) => <button className={node.id === selected.id ? "active" : ""} onClick={() => onSelect(node.id)} key={node.id}>{index + 1}<span>{node.title}</span></button>)}</div></section>
      <span className="eyebrow">Selected step</span><h2>{selected.title}</h2><span className={`badge color-${facetColor(selected.kind)}`}>{selected.kind}</span><p>{selected.description ?? "이 단계에서 관찰된 입력과 출력을 확인합니다."}</p>
      <section className="step-flow"><h3>Flow</h3><div className="flow-columns"><article><small>Received from</small>{context.incoming.length ? context.incoming.map(({ edge, node }) => <button onClick={() => node && onSelect(node.id)} key={edge.id}><b>{node?.title}</b><span>{edge.response ? `HTTP ${edge.response}` : edge.label ?? node?.kind}</span></button>) : <p>Scenario 시작</p>}</article><article><small>Sends to</small>{context.outgoing.length ? context.outgoing.map(({ edge, node }) => <button onClick={() => node && onSelect(node.id)} key={edge.id}><b>{node?.title}</b><span>{edge.response ? `HTTP ${edge.response}` : edge.label ?? node?.kind}</span></button>) : <p>Scenario 종료</p>}</article></div></section>
      <section className="step-evidence"><h3>Result</h3>{request && <details open><summary>Request · {request.method}</summary><code>{request.url}</code><pre>{json({ headers: request.headers, body: request.bodyStored ? request.body : "not stored", step: result?.api?.step })}</pre></details>}{response && <details open><summary>Response · {response.status} {response.statusText}</summary><small>{response.branchId ?? "Undocumented"} · {response.durationMs} ms</small><pre>{json(response.body ?? "body not stored")}</pre></details>}{!!images.length && <ScreenshotGallery screenshots={images} traceViewerEndpoint={traceViewerEndpoint}/>} {!request && !response && !images.length && <p className="empty-evidence">아직 저장된 화면, 응답 또는 실행 결과가 없습니다.</p>}</section>
      {!!selected.testResults?.length && <section className="linked-results"><h3>Test results</h3>{selected.testResults.map((item) => <p className={item.status} key={item.id}><b>{item.type.toUpperCase()}</b><span>{item.status}{typeof item.metadata?.diffRatio === "number" ? ` · ${(item.metadata.diffRatio * 100).toFixed(2)}%` : ""}</span></p>)}</section>}
      {!!selected.relatedStories?.length && <section className="related-stories"><h3>Related stories</h3>{selected.relatedStories.map((storyId) => <button onClick={() => onOpenStory?.(storyId)} key={storyId}>{storyId}<span>Open component →</span></button>)}</section>}
      {!!result?.assertions?.length ? <><h3>Assertion results</h3><ul>{result.assertions.map((item, index) => <li key={index}>{item.status === "passed" ? "Passed" : "Failed"} · {item.message}{item.status === "failed" ? ` · expected ${json(item.expected)}, actual ${json(item.actual)}` : ""}</li>)}</ul></> : !!selected.assertions?.length && <><h3>Assertion definitions</h3><ul>{selected.assertions.map((item, index) => <li key={index}>{typeof item === "string" ? item : json(item)}</li>)}</ul></>}
      <dl>{Object.entries(selected.metadata ?? {}).map(([key,value]) => <div key={key}><dt>{key}</dt><dd><code>{String(value)}</code></dd></div>)}<div><dt>Status</dt><dd>{selected.status ?? "planned"}</dd></div></dl>{scenario.source && <footer><span>Source</span><code>{scenario.source}</code></footer>}
    </aside>
  </div>;
}
