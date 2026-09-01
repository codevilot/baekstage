import { lazy, Suspense, useEffect, useMemo, useRef } from "react";
import type { ForceGraphMethods } from "react-force-graph-2d";
import type { SchemaChange } from "../../schema/types";
import { useElementSize } from "../../hooks/layout/use-element-size";

type GraphStatus = SchemaChange["status"] | "context";
export type SchemaGraphNode = {
  id: string;
  label: string;
  subtitle: string;
  kind: string;
  status: GraphStatus;
  changeKey?: string;
  x?: number;
  y?: number;
  fx?: number;
  fy?: number;
};
export type SchemaGraphLink = {
  source: string | SchemaGraphNode;
  target: string | SchemaGraphNode;
  kind: "owns" | "references";
};

const ForceGraph2D = lazy(() => import("react-force-graph-2d")) as typeof import("react-force-graph-2d").default;
const colors: Record<GraphStatus, string> = { added: "#10b981", modified: "#f59e0b", removed: "#ef4444", context: "#94a3b8" };

function objectFor(change: SchemaChange) { return change.after ?? change.before!; }
function tableKey(value: string) { return `table:${value.includes(".") ? value : `public.${value}`}`; }
function displayName(change: SchemaChange) {
  const object = objectFor(change); const parentName = object.parent?.split(".").at(-1);
  return parentName && object.name.startsWith(`${parentName} `) ? object.name.slice(parentName.length + 1) : object.name;
}
function referencedTables(definition: string) {
  return [...definition.matchAll(/\bREFERENCES\s+(?:(?:"([^"]+)"|([\w$]+))\.)?(?:"([^"]+)"|([\w$]+))/giu)]
    .map((match) => `${match[1] ?? match[2] ?? "public"}.${match[3] ?? match[4]}`);
}

export function schemaGraphData(changes: SchemaChange[]) {
  const nodes = new Map<string, SchemaGraphNode>();
  const links = new Map<string, SchemaGraphLink>();
  const ensureContextTable = (qualifiedName: string) => {
    const id = tableKey(qualifiedName);
    if (!nodes.has(id)) nodes.set(id, { id, label: qualifiedName.split(".").at(-1)!, subtitle: qualifiedName, kind: "table", status: "context" });
    return id;
  };
  for (const change of changes) {
    const object = objectFor(change);
    const fieldCount = change.fields.length;
    nodes.set(change.key, { id: change.key, label: displayName(change), subtitle: object.kind === "table" && fieldCount ? `${fieldCount} column change${fieldCount === 1 ? "" : "s"}` : object.parent ?? object.schema, kind: object.kind, status: change.status, changeKey: change.key });
  }
  for (const change of changes) {
    const object = objectFor(change);
    if (object.parent) {
      const parent = ensureContextTable(object.parent);
      links.set(`owns:${parent}:${change.key}`, { source: parent, target: change.key, kind: "owns" });
    }
    for (const referenced of referencedTables(object.definition)) {
      const target = ensureContextTable(referenced);
      const source = object.parent ? ensureContextTable(object.parent) : object.kind === "table" ? change.key : undefined;
      if (source && source !== target) links.set(`references:${source}:${target}`, { source, target, kind: "references" });
    }
  }
  const graphNodes = [...nodes.values()]; const graphLinks = [...links.values()];
  const tables = graphNodes.filter((node) => node.kind === "table").sort((left, right) => left.id.localeCompare(right.id)); const columns = Math.max(1, Math.ceil(Math.sqrt(tables.length)));
  tables.forEach((node, index) => { node.fx = (index % columns) * 360; node.fy = Math.floor(index / columns) * 280; });
  for (const table of tables) {
    const children = graphLinks.filter((link) => link.kind === "owns" && endpointId(link.source) === table.id).map((link) => graphNodes.find((node) => node.id === endpointId(link.target))!).filter(Boolean);
    children.forEach((node, index) => { const angle = Math.PI * (.2 + .6 * ((index + 1) / (children.length + 1))); node.fx = (table.fx ?? 0) + Math.cos(angle) * 175; node.fy = (table.fy ?? 0) + Math.sin(angle) * 145; });
  }
  const unplaced = graphNodes.filter((node) => node.fx === undefined); unplaced.forEach((node, index) => { node.fx = (index % columns) * 360; node.fy = (Math.ceil(tables.length / columns) + Math.floor(index / columns)) * 280; });
  return { nodes: graphNodes, links: graphLinks };
}

function endpointId(value: string | SchemaGraphNode) { return typeof value === "string" ? value : value.id; }
function fit(context: CanvasRenderingContext2D, value: string, width: number) {
  if (context.measureText(value).width <= width) return value;
  let text = value;
  while (text && context.measureText(`${text}…`).width > width) text = text.slice(0, -1);
  return `${text}…`;
}
function drawNode(node: SchemaGraphNode, context: CanvasRenderingContext2D, scale: number, selectedKey?: string) {
  const selected = node.changeKey === selectedKey; const width = node.kind === "table" ? 112 : 92; const height = node.kind === "table" ? 38 : 30;
  const x = (node.x ?? 0) - width / 2, y = (node.y ?? 0) - height / 2;
  context.beginPath(); context.roundRect(x, y, width, height, 7); context.fillStyle = node.status === "context" ? "#f8fafc" : `${colors[node.status]}18`; context.fill();
  context.lineWidth = selected ? 3 / scale : 1.3 / scale; context.strokeStyle = selected ? "#2563eb" : colors[node.status]; context.stroke();
  context.fillStyle = "#0f172a"; context.font = `700 ${9 / scale}px Inter,sans-serif`; context.textAlign = "center"; context.textBaseline = "middle";
  context.fillText(fit(context, node.label, width - 14), node.x ?? 0, (node.y ?? 0) - 5 / scale);
  context.fillStyle = "#64748b"; context.font = `600 ${6.5 / scale}px Inter,sans-serif`; context.fillText(fit(context, `${node.kind} · ${node.subtitle}`, width - 14), node.x ?? 0, (node.y ?? 0) + 8 / scale);
}
function drawHitArea(node: SchemaGraphNode, color: string, context: CanvasRenderingContext2D) {
  const width = node.kind === "table" ? 116 : 96; const height = node.kind === "table" ? 42 : 34;
  context.fillStyle = color; context.fillRect((node.x ?? 0) - width / 2, (node.y ?? 0) - height / 2, width, height);
}

export function SchemaGraph({ changes, selectedKey, onSelect }: { changes: SchemaChange[]; selectedKey?: string; onSelect: (key: string) => void }) {
  const graph = useMemo(() => schemaGraphData(changes), [changes]);
  const graphRef = useRef<ForceGraphMethods<SchemaGraphNode, SchemaGraphLink> | undefined>(undefined);
  const { ref, width, height } = useElementSize<HTMLElement>();
  useEffect(() => { const instance = graphRef.current; if (!instance || !graph.nodes.length) return; instance.d3ReheatSimulation(); }, [graph]);
  return <section className="schema-graph" ref={ref} aria-label="Schema change graph">
    {!graph.nodes.length ? <div className="schema-empty"><strong>Schemas match</strong><p>선택한 두 revision 사이에 semantic schema 변경이 없습니다.</p></div> : <Suspense fallback={<div className="schema-graph-fallback">Preparing change graph…</div>}>
      <ForceGraph2D ref={graphRef} width={width} height={height} graphData={graph} backgroundColor="#ffffff" cooldownTicks={1} nodeLabel={(node) => `${node.label} · ${node.status}`} nodeCanvasObject={(node, context, scale) => drawNode(node, context, scale, selectedKey)} nodePointerAreaPaint={drawHitArea} nodeRelSize={1} enableNodeDrag enablePanInteraction enableZoomInteraction linkColor={(link) => link.kind === "references" ? "#6366f1" : "#cbd5e1"} linkWidth={(link) => link.kind === "references" ? 1.8 : 1} linkDirectionalArrowLength={(link) => link.kind === "references" ? 5 : 0} linkDirectionalArrowRelPos={1} linkLineDash={(link) => link.kind === "owns" ? [3, 3] : null} onNodeClick={(node) => node.changeKey && onSelect(node.changeKey)} onEngineStop={() => graphRef.current?.zoomToFit(350, 55)}/>
    </Suspense>}
    <div className="schema-graph-legend"><span className="added">Added</span><span className="modified">Modified</span><span className="removed">Removed</span><span className="context">Referenced context</span><i>→ Foreign Key</i></div>
  </section>;
}
