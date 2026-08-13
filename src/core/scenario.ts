import type { ScenarioEdge, ScenarioGraph, ScenarioNode, ScenarioSuite } from "./types";

export function defineScenario(input: ScenarioGraph): ScenarioGraph {
  validateScenario(input);
  return input;
}

export function defineSuite(input: ScenarioSuite): ScenarioSuite {
  if (!input.name.trim()) throw new Error("Suite name is required");
  if (!input.scenarios.length) throw new Error("A suite needs at least one scenario");
  input.scenarios.forEach(validateScenario);
  return input;
}

export function filterScenario(graph: ScenarioGraph, selected: Record<string, Set<string>>): ScenarioGraph {
  const nodes = graph.nodes.filter((node) => Object.entries(selected).every(([key, values]) => {
    if (values.size === 0 || !node.facets?.[key]?.length) return true;
    return node.facets[key].some((value) => values.has(value));
  }));
  const visible = new Set(nodes.map((node) => node.id));
  return {
    ...graph,
    nodes,
    edges: graph.edges.filter((edge) => visible.has(edge.source) && visible.has(edge.target)),
  };
}

export function validateScenario(graph: ScenarioGraph): void {
  if (!graph.id.trim() || !graph.title.trim()) throw new Error("Scenario id and title are required");
  const ids = new Set<string>();
  for (const node of graph.nodes) {
    if (ids.has(node.id)) throw new Error(`Duplicate node id: ${node.id}`);
    ids.add(node.id);
  }
  for (const edge of graph.edges) validateEdge(edge, ids);
}

function validateEdge(edge: ScenarioEdge, ids: Set<string>): void {
  if (!ids.has(edge.source)) throw new Error(`Unknown edge source: ${edge.source}`);
  if (!ids.has(edge.target)) throw new Error(`Unknown edge target: ${edge.target}`);
}

export function mergeResult(graph: ScenarioGraph, result: Pick<ScenarioNode, "id" | "status" | "artifacts">): ScenarioGraph {
  if (!graph.nodes.some((node) => node.id === result.id)) throw new Error(`Unknown result node: ${result.id}`);
  return {
    ...graph,
    nodes: graph.nodes.map((node) => node.id === result.id ? { ...node, ...result } : node),
  };
}
