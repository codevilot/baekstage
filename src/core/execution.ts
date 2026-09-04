import type { LegacyScenarioExecution, ScenarioExecution, ScenarioExecutionPath, ScenarioGraph, ScenarioNodeResult, ScenarioRunResult } from "./types";

export function normalizeExecution(graph: Pick<ScenarioGraph, "source" | "execution">): ScenarioExecution {
  const execution = graph.execution;
  if (execution && "adapter" in execution) return execution;
  return { adapter: "playwright", source: graph.source, grep: (execution as LegacyScenarioExecution | undefined)?.grep };
}

export function mergeNodeResults(graph: ScenarioGraph, results: ScenarioNodeResult[]): ScenarioGraph {
  const byId = new Map(results.map((result) => [result.nodeId, result]));
  return { ...graph, nodes: graph.nodes.map((node) => {
    const result = byId.get(node.id);
    if (!result) return node;
    const history = [...(node.resultHistory ?? []).filter((item) => item.runId !== result.runId), result];
    const artifacts = [...(node.artifacts ?? []), ...(result.artifacts ?? [])].filter((artifact, index, all) => all.findIndex((item) => item.runId === artifact.runId && item.type === artifact.type && item.label === artifact.label) === index);
    return { ...node, status: result.status, artifacts, latestResult: result, resultHistory: history, metadata: { ...node.metadata, durationMs: result.durationMs, assertionResults: result.assertions, error: result.error } };
  }) };
}

export function applyRunResult(graph: ScenarioGraph, result: ScenarioRunResult): ScenarioGraph {
  const pathResults: ScenarioNodeResult[] = result.executionPath?.nodeIds.map((nodeId, index, all) => ({
    runId: result.runId,
    origin: "playwright",
    nodeId,
    status: result.status === "failed" && index === all.length - 1 ? "failed" : "passed",
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    error: result.status === "failed" && index === all.length - 1 ? result.output : undefined,
  })) ?? [];
  const reset = result.executionPath ? { ...graph, nodes: graph.nodes.map((node) => ({ ...node, status: "skipped" as const })) } : graph;
  const merged = mergeNodeResults(reset, [...pathResults, ...(result.nodeResults ?? [])]);
  return { ...merged, latestRun: { runId: result.runId, status: result.status, finishedAt: result.finishedAt, executionPath: result.executionPath } };
}

export function resolveExecutionPath(graph: ScenarioGraph, raw: { itemIds: string[]; outcomes?: Record<string, string> }): ScenarioExecutionPath {
  const itemByNode = new Map<string, string>();
  for (const item of graph.composition?.items ?? []) {
    if (item.type === "node") itemByNode.set(item.nodeId, item.id);
    else for (const node of graph.nodes) if (node.metadata?.compositionItemId === item.id) itemByNode.set(node.id, item.id);
  }
  const visited = new Set(raw.itemIds);
  const nodeIds = graph.nodes.filter((node) => visited.has(itemByNode.get(node.id) ?? "")).map((node) => node.id);
  const transitions = new Set(raw.itemIds.slice(1).map((item, index) => `${raw.itemIds[index]}->${item}`));
  const edgeIds = graph.edges.filter((edge) => {
    const source = itemByNode.get(edge.source), target = itemByNode.get(edge.target);
    return !!source && !!target && (source === target ? visited.has(source) : transitions.has(`${source}->${target}`));
  }).map((edge) => edge.id);
  return { itemIds: [...raw.itemIds], nodeIds, edgeIds, outcomes: { ...(raw.outcomes ?? {}) } };
}

export function normalizeRunResult(value: Partial<ScenarioRunResult> & Pick<ScenarioRunResult, "scenarioId" | "status" | "finishedAt">): ScenarioRunResult {
  return { runId: value.runId ?? `legacy:${value.scenarioId}:${value.finishedAt}`, origin: value.origin ?? "playwright", screenshots: value.screenshots ?? [], output: value.output ?? "", startedAt: value.startedAt ?? value.finishedAt, ...value } as ScenarioRunResult;
}
