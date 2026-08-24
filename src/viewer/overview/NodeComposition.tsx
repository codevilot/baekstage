import type { ScenarioArtifact, ScenarioGraph } from "../../core/types";
import { screenshotsForNode } from "../../core/artifacts";

export function NodeComposition({ scenario, screenshots, onScreenshots, onNodeSelect }: { scenario: ScenarioGraph; screenshots: ScenarioArtifact[]; onScreenshots: (items: ScenarioArtifact[]) => void; onNodeSelect?: (nodeId: string) => void }) {
  return <section className="node-composition" aria-label="Scenario node composition">
    <header><strong>Node composition</strong><span>{scenario.nodes.length}</span></header>
    <div>{scenario.nodes.map((node, index) => {
      const outgoing = scenario.edges.filter((edge) => edge.source === node.id);
      const captures = screenshotsForNode(node.id, screenshots);
      const result = node.latestResult ?? node.resultHistory?.at(-1);
      const response = result?.api?.response;
      const targets = outgoing.flatMap((edge) => scenario.nodes.find((item) => item.id === edge.target)?.title ?? []);
      const owner = typeof node.metadata?.scenarioId === "string" ? `${node.metadata.scenarioId} · ` : "";
      return <button onClick={() => onNodeSelect ? onNodeSelect(node.id) : captures.length && onScreenshots(captures)} key={node.id}>
        <i className={node.status ?? "planned"}>{index + 1}</i><span><strong>{node.title}</strong><small>{owner}{node.kind} · {targets.length ? `→ ${targets.join(", ")}` : "end node"}</small></span><b className={result?.status}>{response ? `HTTP ${response.status}` : result ? result.status : captures.length ? `${captures.length} ▣` : "—"}</b>
      </button>;
    })}</div>
  </section>;
}
