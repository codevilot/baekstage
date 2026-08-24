import type { ScenarioGraph, ScenarioNode } from "./types";

export type ScenarioAct = { id: string; title: string; nodes: ScenarioNode[] };
const actKey = (node: ScenarioNode) => typeof node.metadata?.act === "string" ? node.metadata.act : node.kind === "fixture" ? "Setup" : node.layer === "api" || node.kind === "api" ? "API" : ["service", "database", "worker", "external"].includes(node.layer ?? node.kind) ? "Backend" : ["assertion", "outcome"].includes(node.kind) ? "Verification" : "UI";

export function scenarioActs(graph: ScenarioGraph): ScenarioAct[] {
  const acts: ScenarioAct[] = [];
  for (const node of graph.nodes) { const title = actKey(node); const current = acts.at(-1); if (current?.title === title) current.nodes.push(node); else acts.push({ id: `act-${acts.length + 1}`, title, nodes: [node] }); }
  return acts;
}

export function scenarioNodeContext(graph: ScenarioGraph, nodeId: string) {
  const acts = scenarioActs(graph); const actIndex = acts.findIndex((act) => act.nodes.some((node) => node.id === nodeId)); const act = acts[actIndex]; const stepIndex = act?.nodes.findIndex((node) => node.id === nodeId) ?? -1;
  return { acts, act, actIndex, stepIndex, incoming: graph.edges.filter((edge) => edge.target === nodeId).map((edge) => ({ edge, node: graph.nodes.find((node) => node.id === edge.source) })), outgoing: graph.edges.filter((edge) => edge.source === nodeId).map((edge) => ({ edge, node: graph.nodes.find((node) => node.id === edge.target) })) };
}
