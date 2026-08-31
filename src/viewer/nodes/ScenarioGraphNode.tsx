import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { DetailNode } from "../../hooks/graph/use-detail-graph";

const colors = ["blue", "orange", "violet", "cyan", "rose", "green"];
export function facetColor(value?: string) {
  if (!value) return "slate";
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

export function ScenarioGraphNode({ data, selected }: NodeProps<DetailNode>) {
  return <div className={`graph-node color-${facetColor(data.kind)} status-${data.status ?? "planned"} kind-${data.kind} ${selected ? "selected" : ""}`}>
    <Handle type="target" position={Position.Left}/>
    <div className="node-meta"><small>{data.layer ?? data.kind}</small>{data.status === "failed" && <span>TEST FAILED</span>}{data.status === "passed" && <span>PASSED</span>}</div>
    <strong>{data.title}</strong><code>{[data.latestResult?.api?.response ? `HTTP ${data.latestResult.api.response.status}` : "", typeof data.metadata?.durationMs === "number" ? `${data.metadata.durationMs} ms` : "", data.artifacts?.length ? `${data.artifacts.length} artifacts` : "", data.ref?.startsWith("openapi:") ? "OpenAPI linked" : ""].filter(Boolean).join(" · ")}</code>{typeof data.metadata?.route === "string" && <code>{data.metadata.route}</code>}
    {!!data.testResults?.length && <div className="node-test-results">{data.testResults.map((item) => <span className={item.status} key={item.id}>{item.type} · {item.status}</span>)}</div>}
    <Handle type="source" position={Position.Right}/>
  </div>;
}
