import { useEffect, useRef, useState } from "react";
import type { ScenarioArtifact, ScenarioGraph, ScenarioNode } from "../../core/types";
import { scenarioNodeContext } from "../../core/scenario-acts";
import { screenshotsForNode } from "../../core/artifacts";

const json = (value: unknown) => JSON.stringify(value, null, 2);
export function ScenarioNodePanel({ scenario, node, screenshots, onBack, onSelect, onRunApi }: { scenario: ScenarioGraph; node: ScenarioNode; screenshots: ScenarioArtifact[]; onBack: () => void; onSelect: (nodeId: string) => void; onRunApi?: () => void }) {
  const panelRef = useRef<HTMLElement>(null);
  const [preview, setPreview] = useState<ScenarioArtifact | null>(null);
  const context = scenarioNodeContext(scenario, node.id); const result = node.latestResult ?? node.resultHistory?.at(-1); const request = result?.api?.request; const response = result?.api?.response; const images = screenshotsForNode(node.id, [...screenshots, ...(node.artifacts ?? [])]).filter((item, index, all) => all.findIndex((candidate) => candidate.url === item.url) === index);
  const nodeIndex = scenario.nodes.findIndex((item) => item.id === node.id);
  const previous = nodeIndex > 0 ? scenario.nodes[nodeIndex - 1] : undefined;
  const next = nodeIndex >= 0 ? scenario.nodes[nodeIndex + 1] : undefined;
  useEffect(() => { setPreview(null); panelRef.current?.scrollTo({ top: 0, behavior: "auto" }); }, [node.id]);
  useEffect(() => {
    const navigate = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input,textarea,select,[contenteditable=true]") || preview) return;
      const destination = event.key === "ArrowLeft" ? previous : event.key === "ArrowRight" ? next : undefined;
      if (!destination) return;
      event.preventDefault(); onSelect(destination.id);
    };
    window.addEventListener("keydown", navigate);
    return () => window.removeEventListener("keydown", navigate);
  }, [next, onSelect, preview, previous]);
  return <aside ref={panelRef} className="floating-scenario-card scenario-node-panel" aria-label={`${node.title} node details`}>
    <button className="node-detail-back" onClick={onBack} aria-label="Back to selected scenario" title="Back to selected scenario"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button>
    <span className="eyebrow">{scenario.title}</span><div className="node-act-label">Act {context.actIndex + 1} · {context.act?.title} / Step {context.stepIndex + 1}</div><h2>{node.title}</h2><p>{node.description ?? "이 단계에서 주고받은 값과 화면을 확인합니다."}</p>{node.kind === "api" && onRunApi && <button className="node-api-action" onClick={onRunApi}>Run API</button>}
    <nav className="node-act-steps" aria-label="Act steps">{context.act?.nodes.map((item, index) => <button className={item.id === node.id ? "active" : ""} onClick={() => onSelect(item.id)} key={item.id}><b>{index + 1}</b><span>{item.title}</span></button>)}</nav>
    <section className="step-flow"><h3>Scenario flow</h3><div className="flow-columns"><article><small>Received from</small>{context.incoming.length ? context.incoming.map(({ edge, node: source }) => <button onClick={() => source && onSelect(source.id)} key={edge.id}><b>{source?.title}</b><span>{edge.response ? `HTTP ${edge.response}` : edge.label ?? source?.kind}</span></button>) : <p>Scenario 시작</p>}</article><article><small>Sends to</small>{context.outgoing.length ? context.outgoing.map(({ edge, node: target }) => <button onClick={() => target && onSelect(target.id)} key={edge.id}><b>{target?.title}</b><span>{edge.response ? `HTTP ${edge.response}` : edge.label ?? target?.kind}</span></button>) : <p>Scenario 종료</p>}</article></div></section>
    <section className="step-evidence"><h3>Result</h3>{request && <details open><summary>Request · {request.method}</summary><code>{request.url}</code><pre>{json({ headers: request.headers, body: request.bodyStored ? request.body : "not stored" })}</pre></details>}{response && <details open><summary>Response · {response.status} {response.statusText}</summary><small>{response.branchId ?? "Undocumented"} · {response.durationMs} ms</small><pre>{json(response.body ?? "body not stored")}</pre></details>}{images.map((artifact) => <button className="screen-evidence" onClick={() => setPreview(artifact)} key={artifact.url}><img src={artifact.url} alt={artifact.label}/><span>Screen · {artifact.label}</span></button>)}{!request && !response && !images.length && <p className="empty-evidence">아직 저장된 화면, 응답 또는 실행 결과가 없습니다.</p>}</section>
    {!!result?.assertions?.length && <section className="node-assertions"><h3>Assertions</h3>{result.assertions.map((assertion, index) => <p className={assertion.status} key={index}><b>{assertion.status}</b> {assertion.message}{assertion.status === "failed" && <small>expected {json(assertion.expected)} · actual {json(assertion.actual)}</small>}</p>)}</section>}
    <nav className="step-navigation" aria-label="Scenario step navigation"><button disabled={!previous} onClick={() => previous && onSelect(previous.id)}><span>← 이전 단계</span><b>{previous?.title ?? "Scenario 시작"}</b></button><button disabled={!next} onClick={() => next && onSelect(next.id)}><span>다음 단계 →</span><b>{next?.title ?? "Scenario 종료"}</b></button></nav>
    <footer><span>Status</span><code>{node.status ?? "planned"}{result?.failureKind ? ` · ${result.failureKind}` : ""}</code></footer>
    {preview && <section className="result-image-preview"><button className="node-detail-back" onClick={() => setPreview(null)} aria-label="Back to node result" title="Back to result"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg></button><span className="eyebrow">Screenshot</span><h2>{preview.label}</h2><img src={preview.url} alt={preview.label}/><a href={preview.url} target="_blank" rel="noreferrer">Open original</a></section>}
  </aside>;
}
