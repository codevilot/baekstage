import type { LegacyScenarioExecution, ScenarioExecution, ScenarioGraph, ScenarioNodeResult, ScenarioRunResult } from "./types";

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
  return mergeNodeResults(graph, result.nodeResults ?? []);
}

export function normalizeRunResult(value: Partial<ScenarioRunResult> & Pick<ScenarioRunResult, "scenarioId" | "status" | "finishedAt">): ScenarioRunResult {
  return { runId: value.runId ?? `legacy:${value.scenarioId}:${value.finishedAt}`, origin: value.origin ?? "playwright", screenshots: value.screenshots ?? [], output: value.output ?? "", startedAt: value.startedAt ?? value.finishedAt, ...value } as ScenarioRunResult;
}
