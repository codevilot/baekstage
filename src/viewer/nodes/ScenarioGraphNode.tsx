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
    <div className="node-meta"><small>{data.kind}</small>{data.status === "failed" && <span>FAILED</span>}</div>
    <strong>{data.title}</strong>{typeof data.metadata?.route === "string" && <code>{data.metadata.route}</code>}
    <Handle type="source" position={Position.Right}/>
  </div>;
}
