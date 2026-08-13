import { useMemo } from "react";
import { MarkerType, type Edge, type Node } from "@xyflow/react";
import type { ScenarioGraph, ScenarioNode } from "../../core/types";

export type DetailNode = Node<ScenarioNode, "scenario">;

function layout(graph: ScenarioGraph): DetailNode[] {
  const incoming = new Map<string, string[]>();
  graph.edges.forEach((edge) => incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source]));
  const depths = new Map<string, number>();
  const depth = (id: string): number => {
    if (depths.has(id)) return depths.get(id)!;
    const parents = incoming.get(id) ?? [];
    const value = parents.length ? Math.max(...parents.map(depth)) + 1 : 0;
    depths.set(id, value);
    return value;
  };
  const rows = new Map<number, number>();
  return graph.nodes.map((data) => {
    const column = depth(data.id);
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    return { id: data.id, type: "scenario", data, position: { x: column * 285, y: row * 150 } };
  });
}

function graphEdges(graph: ScenarioGraph): Edge[] {
  return graph.edges.map((edge) => {
    const failed = graph.nodes.find((node) => node.id === edge.target)?.status === "failed";
    const color = failed ? "#e42939" : edge.branch ? "#f59e0b" : "#94a3b8";
    return { ...edge, type: "smoothstep", animated: edge.label === "propagates", markerEnd: { type: MarkerType.ArrowClosed, color }, style: { stroke: color, strokeWidth: failed ? 2.5 : edge.branch ? 2 : 1.5 }, labelStyle: { fontSize: 10, fontWeight: 700, fill: "#64748b" } };
  });
}

export function useDetailGraph(graph: ScenarioGraph) {
  return { nodes: useMemo(() => layout(graph), [graph]), edges: useMemo(() => graphEdges(graph), [graph]) };
}
