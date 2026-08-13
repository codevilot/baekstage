import type { ScenarioArtifact, ScenarioGraph } from "../../core/types";
import { screenshotsForNode } from "../../core/artifacts";

export function NodeComposition({ scenario, screenshots, onScreenshots }: { scenario: ScenarioGraph; screenshots: ScenarioArtifact[]; onScreenshots: (items: ScenarioArtifact[]) => void }) {
  return <section className="node-composition" aria-label="Scenario node composition">
    <header><strong>Node composition</strong><span>{scenario.nodes.length}</span></header>
    <div>{scenario.nodes.map((node, index) => {
      const outgoing = scenario.edges.filter((edge) => edge.source === node.id);
      const captures = screenshotsForNode(node.id, screenshots);
      const targets = outgoing.flatMap((edge) => scenario.nodes.find((item) => item.id === edge.target)?.title ?? []);
      const owner = typeof node.metadata?.scenarioId === "string" ? `${node.metadata.scenarioId} · ` : "";
      return <button onClick={() => captures.length && onScreenshots(captures)} disabled={!captures.length} key={node.id}>
        <i className={node.status ?? "planned"}>{index + 1}</i><span><strong>{node.title}</strong><small>{owner}{node.kind} · {targets.length ? `→ ${targets.join(", ")}` : "end node"}</small></span><b>{captures.length ? `${captures.length} ▣` : "—"}</b>
      </button>;
    })}</div>
  </section>;
}
