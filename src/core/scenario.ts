import type { ScenarioEditDraft, ScenarioEdge, ScenarioGraph, ScenarioNode, ScenarioPart, ScenarioPartUse, ScenarioPartVariable, ScenarioSuite } from "./types";

export function defineScenario(input: ScenarioGraph): ScenarioGraph {
  validateScenario(input);
  return input;
}

export function defineSuite(input: ScenarioSuite): ScenarioSuite {
  if (!input.name.trim()) throw new Error("Suite name is required");
  if (!input.scenarios.length && !input.parts?.length) throw new Error("A suite needs at least one scenario or Part");
  input.scenarios.forEach(validateScenario);
  input.parts?.forEach(validatePart);
  return input;
}

export function definePart(input: ScenarioPart): ScenarioPart {
  validatePart(input);
  return input;
}

export function validatePart(part: ScenarioPart): void {
  if (!part.id.trim() || !part.title.trim()) throw new Error("Part id and title are required");
  if (!/^[a-zA-Z_$][\w$]*$/.test(part.execute ?? "run")) throw new Error(`Invalid Part execute export: ${part.execute}`);
  for (const [label, values] of [["input", part.inputs], ["expectation", part.expectations]] as const) {
    const ids = new Set<string>(); for (const value of values ?? []) { if (!value.id.trim() || ids.has(value.id)) throw new Error(`Invalid or duplicate Part ${label}: ${value.id}`); ids.add(value.id); }
  }
  const outcomes = new Set<string>(); for (const outcome of part.outcomes ?? []) { if (!outcome.id.trim() || outcomes.has(outcome.id)) throw new Error(`Invalid or duplicate Part outcome: ${outcome.id}`); outcomes.add(outcome.id); }
  validateScenario({ id: part.id, title: part.title, nodes: part.nodes, edges: part.edges });
}

function validVariableValue(value: unknown, variable: ScenarioPartVariable) {
  if (value === undefined) return !variable.required || variable.defaultValue !== undefined;
  if (variable.required && variable.type === "string" && (typeof value !== "string" || !value.trim())) return false;
  if (variable.type === "json") { try { JSON.stringify(value); return true; } catch { return false; } }
  return typeof value === variable.type && (variable.type !== "number" || Number.isFinite(value));
}

function validatePartItem(item: Extract<ScenarioEditDraft["items"][number], { type: "part" }>, part: ScenarioPart) {
  for (const [field, declarations] of [["inputs", part.inputs], ["expectations", part.expectations]] as const) {
    const values = item[field] ?? {};
    const declared = new Map((declarations ?? []).map((variable) => [variable.id, variable]));
    for (const id of Object.keys(values)) if (declared.size && !declared.has(id)) throw new Error(`Unknown Part ${field.slice(0, -1)} '${id}' in ${part.id}`);
    for (const variable of declarations ?? []) {
      const value = values[variable.id] ?? variable.defaultValue;
      if (!validVariableValue(value, variable)) throw new Error(`Invalid ${field.slice(0, -1)} '${variable.id}' in Part ${part.id}; expected ${variable.type}${variable.required ? " (required)" : ""}`);
    }
  }
}

export function scenarioEditWarnings(draft: ScenarioEditDraft, parts: ScenarioPart[] = []): string[] {
  const warnings: string[] = [];
  const next = new Map<string, string[]>(); const routed = new Set((draft.routes ?? []).map((route) => route.fromItemId));
  draft.items.forEach((item, index) => { next.set(item.id, routed.has(item.id) ? (draft.routes ?? []).filter((route) => route.fromItemId === item.id).map((route) => route.toItemId) : draft.items[index + 1] ? [draft.items[index + 1].id] : []); });
  const visiting = new Set<string>(), visited = new Set<string>(); let cyclic = false;
  const visit = (id: string) => { if (visiting.has(id)) { cyclic = true; return; } if (visited.has(id)) return; visiting.add(id); for (const target of next.get(id) ?? []) visit(target); visiting.delete(id); visited.add(id); };
  for (const item of draft.items) visit(item.id);
  if (cyclic) warnings.push("분기 경로에 순환이 있습니다. 실행은 안전을 위해 100번 전환 후 중단됩니다.");
  const byId = new Map(parts.map((part) => [part.id, part]));
  for (const item of draft.items) if (item.type === "part") {
    const routes = (draft.routes ?? []).filter((route) => route.fromItemId === item.id); if (!routes.length) continue;
    const missing = (byId.get(item.partId)?.outcomes ?? []).filter((outcome) => !routes.some((route) => route.outcome === outcome.id));
    if (missing.length) warnings.push(`${byId.get(item.partId)?.title ?? item.partId}: ${missing.map((outcome) => outcome.title).join(", ")} outcome 경로가 없으며 반환 시 테스트가 실패합니다.`);
  }
  return warnings;
}

/** Compose reusable parts into one graph. Node ids are namespaced per occurrence,
 * and terminal nodes are connected to the next part's root nodes. */
export function composeScenario(input: Omit<ScenarioGraph, "nodes" | "edges"> & { parts: ScenarioPartUse[] }): ScenarioGraph {
  if (!input.parts.length) throw new Error("A composed scenario needs at least one Part");
  const nodes: ScenarioNode[] = [];
  const edges: ScenarioEdge[] = [];
  let previousLeaves: string[] = [];
  input.parts.forEach(({ part, repeat = 1 }, useIndex) => {
    validatePart(part);
    if (!Number.isInteger(repeat) || repeat < 1 || repeat > 100) throw new Error(`Part repeat must be between 1 and 100: ${part.id}`);
    for (let repeatIndex = 0; repeatIndex < repeat; repeatIndex += 1) {
      const prefix = `${part.id}-${useIndex + 1}-${repeatIndex + 1}`;
      const incoming = new Set(part.edges.map((edge) => edge.target));
      const outgoing = new Set(part.edges.map((edge) => edge.source));
      const roots = part.nodes.filter((node) => !incoming.has(node.id)).map((node) => `${prefix}:${node.id}`);
      const leaves = part.nodes.filter((node) => !outgoing.has(node.id)).map((node) => `${prefix}:${node.id}`);
      nodes.push(...part.nodes.map((node) => ({ ...node, id: `${prefix}:${node.id}`, metadata: { ...node.metadata, partId: part.id, partTitle: part.title, partOccurrence: useIndex + 1, repeat: repeatIndex + 1 } })));
      edges.push(...part.edges.map((edge) => ({ ...edge, id: `${prefix}:${edge.id}`, source: `${prefix}:${edge.source}`, target: `${prefix}:${edge.target}` })));
      for (const source of previousLeaves) for (const target of roots) edges.push({ id: `compose:${source}->${target}`, source, target, label: "next Part" });
      previousLeaves = leaves;
    }
  });
  const { parts: _parts, ...scenario } = input;
  const result = { ...scenario, composition: { items: input.parts.map(({ part, repeat, inputs, expectations }, index) => ({ id: `part-${index + 1}`, type: "part" as const, partId: part.id, repeat, inputs, expectations })) }, nodes, edges };
  validateScenario(result);
  return result;
}

/** Materialize editor items while keeping Part references and manual Nodes distinct. */
export function materializeScenario(draft: ScenarioEditDraft, parts: ScenarioPart[]): ScenarioGraph {
  if (!draft.items.length) throw new Error("A scenario needs at least one Part or Node");
  const itemIds = new Set<string>();
  for (const item of draft.items) { if (!item.id.trim() || itemIds.has(item.id)) throw new Error(`Invalid or duplicate composition item id: ${item.id}`); itemIds.add(item.id); }
  const byId = new Map(parts.map((part) => [part.id, part])); const nodes: ScenarioNode[] = [];
  const partEdges: ScenarioEdge[] = [];
  const bounds = new Map<string, { roots: string[]; leaves: string[]; type: "part" | "node" }>();
  for (const item of draft.items) {
    if (item.type === "node") { nodes.push({ ...item.node }); bounds.set(item.id, { roots: [item.node.id], leaves: [item.node.id], type: "node" }); continue; }
    const part = byId.get(item.partId); if (!part) throw new Error(`Unknown Part: ${item.partId}`); validatePart(part); validatePartItem(item, part);
    const repeat = item.repeat ?? 1; if (!Number.isInteger(repeat) || repeat < 1 || repeat > 20) throw new Error(`Part repeat must be between 1 and 20: ${part.id}`);
    let roots: string[] = [], previousLeaves: string[] = [];
    for (let index = 0; index < repeat; index += 1) {
      const prefix = `${item.id}${repeat > 1 ? `-${index + 1}` : ""}`; const incoming = new Set(part.edges.map((edge) => edge.target)); const outgoing = new Set(part.edges.map((edge) => edge.source));
      nodes.push(...part.nodes.map((node) => ({ ...node, id: `${prefix}:${node.id}`, metadata: { ...node.metadata, partId: part.id, partTitle: part.title, compositionItemId: item.id, repeat: index + 1 } })));
      partEdges.push(...part.edges.map((edge) => ({ ...edge, id: `${prefix}:${edge.id}`, source: `${prefix}:${edge.source}`, target: `${prefix}:${edge.target}` })));
      const currentRoots = part.nodes.filter((node) => !incoming.has(node.id)).map((node) => `${prefix}:${node.id}`), currentLeaves = part.nodes.filter((node) => !outgoing.has(node.id)).map((node) => `${prefix}:${node.id}`);
      if (!index) roots = currentRoots;
      for (const source of previousLeaves) for (const target of currentRoots) partEdges.push({ id: `compose:${source}->${target}`, source, target, label: "repeat" });
      previousLeaves = currentLeaves;
    }
    bounds.set(item.id, { roots, leaves: previousLeaves, type: "part" });
  }
  const nodeIds = new Set(nodes.map((node) => node.id));
  const partNodeIds = new Set(nodes.filter((node) => node.metadata?.compositionItemId).map((node) => node.id));
  const retained = (draft.edges ?? []).filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target) && !String(edge.id).startsWith("compose:") && !(partNodeIds.has(edge.source) && partNodeIds.has(edge.target)));
  const edgeKeys = new Set([...retained, ...partEdges].map((edge) => `${edge.source}->${edge.target}`)); const edges = [...retained, ...partEdges];
  const routes = draft.routes ?? [];
  const routeKeys = new Set<string>();
  for (const route of routes) {
    const routeKey = `${route.fromItemId}:${route.outcome}`; if (routeKeys.has(routeKey)) throw new Error(`Duplicate route for Part outcome: ${routeKey}`); routeKeys.add(routeKey);
    const from = bounds.get(route.fromItemId), to = bounds.get(route.toItemId); if (!from || !to) throw new Error(`Unknown scenario route: ${route.fromItemId} -> ${route.toItemId}`);
    const partItem = draft.items.find((item) => item.id === route.fromItemId); const part = partItem?.type === "part" ? byId.get(partItem.partId) : undefined;
    if (!part?.outcomes?.some((outcome) => outcome.id === route.outcome)) throw new Error(`Unknown Part outcome: ${route.outcome}`);
    for (const source of from.leaves) for (const target of to.roots) edges.push({ id: `route:${route.fromItemId}:${route.outcome}:${route.toItemId}:${source}->${target}`, source, target, label: route.outcome, branch: true });
  }
  const routedItems = new Set(routes.map((route) => route.fromItemId));
  for (let index = 1; index < draft.items.length; index += 1) {
    const previousItem = draft.items[index - 1], currentItem = draft.items[index]; if (routedItems.has(previousItem.id)) continue;
    const previous = bounds.get(previousItem.id)!, current = bounds.get(currentItem.id)!;
    if (previous.type === "node" && current.type === "node") continue;
    for (const source of previous.leaves) for (const target of current.roots) if (!edgeKeys.has(`${source}->${target}`)) edges.push({ id: `compose:${source}->${target}`, source, target, label: "next" });
  }
  const graph: ScenarioGraph = { id: draft.id, title: draft.title, description: draft.description, execution: draft.execution, definitionSource: draft.definitionSource, composition: { items: draft.items.map((item) => item.type === "part" ? { ...item } : { id: item.id, type: "node", nodeId: item.node.id }), routes }, nodes, edges };
  validateScenario(graph); return graph;
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
