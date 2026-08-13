import type { ScenarioArtifact, ScenarioEdge } from "./types";

function matches(value?: string, candidate?: string) {
  return !!value && !!candidate && (candidate === value || candidate.endsWith(`:${value}`));
}

function inScenario(artifact: ScenarioArtifact, candidates: Array<string | undefined>) {
  if (!artifact.scenarioId) return true;
  const scoped = candidates.filter((candidate): candidate is string => !!candidate && candidate.includes(":"));
  if (!scoped.length) return true;
  return scoped.some((candidate) => candidate === artifact.scenarioId
    || candidate.startsWith(`${artifact.scenarioId}:`)
    || candidate.includes(`:${artifact.scenarioId}:`)
    || candidate.endsWith(`:${artifact.scenarioId}`));
}

export function artifactMatchesEdge(artifact: ScenarioArtifact, edge: ScenarioEdge | null, targetId: string) {
  if (!inScenario(artifact, [edge?.id, edge?.source, edge?.target, targetId])) return false;
  if (artifact.edgeId) return matches(artifact.edgeId, edge?.id);
  if (artifact.fromNodeId && artifact.toNodeId) return matches(artifact.fromNodeId, edge?.source) && matches(artifact.toNodeId, edge?.target);
  return matches(artifact.nodeId, targetId);
}

export function screenshotsForNode(nodeId: string, screenshots: ScenarioArtifact[]) {
  return screenshots.filter((artifact) => matches(artifact.nodeId ?? artifact.toNodeId, nodeId));
}
