import { useMemo, useState } from "react";
import "@xyflow/react/dist/style.css";
import type { ScenarioArtifact, ScenarioSuite, ScenarioViewerOptions } from "../core/types";
import { SuiteGalaxy } from "./SuiteGalaxy";
import { ScenarioRunPanel } from "./overview/ScenarioRunPanel";
import { SuitePanel } from "./overview/SuitePanel";
import { EdgeScreenshotPanel } from "./overview/EdgeScreenshotPanel";
import { NodeComposition } from "./overview/NodeComposition";
import { useScenarioRun } from "../hooks/scenario/use-scenario-run";

function scenarioName(title: string) {
  return title.replace(/^\d+\.\s*/, "");
}

function groupScenarioRuns(suite: ScenarioSuite): ScenarioSuite {
  const groups = new Map<string, ScenarioSuite["scenarios"]>();
  for (const scenario of suite.scenarios) {
    const name = scenarioName(scenario.title);
    groups.set(name, [...(groups.get(name) ?? []), scenario]);
  }
  return {
    ...suite,
    scenarios: [...groups].map(([name, runs]) => {
      if (runs.length === 1) return { ...runs[0], title: name };
      const nodes = runs.flatMap((run) => [
        { id: `${run.id}:run`, title: run.title, description: `${name}의 독립 Playwright 실행`, kind: "fixture" as const, status: run.nodes.some((node) => node.status === "failed") ? "failed" as const : "passed" as const, metadata: { scenarioId: run.id } },
        ...run.nodes.map((node) => ({ ...node, id: `${run.id}:${node.id}`, metadata: { ...node.metadata, scenarioId: run.id } })),
      ]);
      const edges = runs.flatMap((run) => {
        const incoming = new Set(run.edges.map((edge) => edge.target));
        const roots = run.nodes.filter((node) => !incoming.has(node.id));
        return [
          ...roots.map((node) => ({ id: `${run.id}:run-${node.id}`, source: `${run.id}:run`, target: `${run.id}:${node.id}`, label: "run" })),
          ...run.edges.map((edge) => ({ ...edge, id: `${run.id}:${edge.id}`, source: `${run.id}:${edge.source}`, target: `${run.id}:${edge.target}` })),
        ];
      });
      const matchers = runs.flatMap((run) => run.execution?.grep ? [run.execution.grep] : []);
      return { id: `group:${runs.map((run) => run.id).join("+")}`, title: name, description: `${runs.length}개의 Playwright 실행을 상세 분기로 묶은 Scenario`, source: runs[0].source, execution: matchers.length ? { grep: matchers.join("|") } : undefined, nodes, edges };
    }),
  };
}

export function ScenarioViewer({ suite, options }: { suite: ScenarioSuite; options?: ScenarioViewerOptions }) {
  const groupedSuite = useMemo(() => groupScenarioRuns(suite), [suite]);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [suiteOpen, setSuiteOpen] = useState(false);
  const [edgeScreenshots, setEdgeScreenshots] = useState<ScenarioArtifact[]>([]);
  const [allScreenshotsOpen, setAllScreenshotsOpen] = useState(false);
  const [maxDetailDepth, setMaxDetailDepth] = useState(3);
  const [detailStatus, setDetailStatus] = useState<"all" | "failed">("all");
  const selectedScenario = groupedSuite.scenarios.find((scenario) => scenario.id === selectedScenarioId);
  const run = useScenarioRun(selectedScenario?.id, selectedScenario?.source, selectedScenario?.execution?.grep, options?.runnerEndpoint);
  const screenshots = useMemo(() => {
    const scenarioIds = new Set([selectedScenario?.id, ...(selectedScenario?.nodes.flatMap((node) => typeof node.metadata?.scenarioId === "string" ? [node.metadata.scenarioId] : []) ?? [])]);
    const runtime = run.result?.screenshots.filter((item) => !item.scenarioId || scenarioIds.has(item.scenarioId)).map((item) => ({ ...item, type: "screenshot" as const })) ?? [];
    const items = [...(selectedScenario?.nodes.flatMap((node) => node.artifacts?.filter((artifact) => artifact.type === "screenshot") ?? []) ?? []), ...runtime];
    return items.map((artifact) => {
      const index = selectedScenario?.nodes.findIndex((node) => {
        const owner = node.metadata?.scenarioId;
        const sameRun = !artifact.scenarioId || !owner || owner === artifact.scenarioId;
        return sameRun && (node.id === artifact.nodeId || node.id.endsWith(`:${artifact.nodeId}`));
      }) ?? -1;
      const node = index >= 0 ? selectedScenario?.nodes[index] : undefined;
      return node ? { ...artifact, nodeNumber: index + 1, nodeTitle: node.title } : artifact;
    });
  }, [run.result, selectedScenario]);
  const failedCount = selectedScenario?.nodes.filter((node) => node.status === "failed").length ?? 0;
  const runCount = selectedScenario?.nodes.filter((node) => node.metadata?.scenarioId).length ?? 0;
  const selectScenario = (id: string) => { setSuiteOpen(false); setEdgeScreenshots([]); setAllScreenshotsOpen(false); setSelectedScenarioId(id); };
  const selectScreenshots = (items: ScenarioArtifact[]) => { setAllScreenshotsOpen(false); setEdgeScreenshots(items); };
  const closePanels = () => { setSuiteOpen(false); setEdgeScreenshots([]); setAllScreenshotsOpen(false); setSelectedScenarioId(null); };

  return <main className="baekstage-root">
    <header><div><span className="eyebrow">Baekstage</span><h1>{groupedSuite.name}</h1><p>{selectedScenario?.description ?? "Network에서 시나리오를 선택해 연결된 test step을 확인하세요."}</p></div></header>
    <div className="overview-workspace">
      <SuiteGalaxy suite={groupedSuite} selectedScenarioId={selectedScenarioId ?? undefined} maxDetailDepth={maxDetailDepth} detailStatus={detailStatus} screenshots={screenshots} activeScreenshots={edgeScreenshots} onScreenshotsSelect={selectScreenshots} onSuiteSelect={() => { setSelectedScenarioId(null); setSuiteOpen(true); }} onScenarioSelect={selectScenario} onBackgroundClick={closePanels}/>
      <section className="galaxy-filters" aria-label="network graph filters"><div><span>Detail depth</span>{[0,1,2,3].map((depth) => <button className={maxDetailDepth === depth ? "active" : ""} onClick={() => setMaxDetailDepth(depth)} key={depth}>{depth === 0 ? "Main" : depth}</button>)}</div><div><span>Step status</span><button className={detailStatus === "all" ? "active" : ""} onClick={() => setDetailStatus("all")}>All</button><button className={detailStatus === "failed" ? "active" : ""} onClick={() => setDetailStatus("failed")}>Failed</button></div></section>
      {suiteOpen && <SuitePanel suite={groupedSuite} endpoint={options?.runnerEndpoint} onClose={() => setSuiteOpen(false)} onSelect={selectScenario}/>} 
      {!!edgeScreenshots.length && <EdgeScreenshotPanel screenshots={screenshots} outbound={edgeScreenshots} all={allScreenshotsOpen} traceViewerEndpoint={options?.traceViewerEndpoint} onBack={() => { setEdgeScreenshots([]); setAllScreenshotsOpen(false); }}/>} 
      {selectedScenario && !edgeScreenshots.length && <aside className="floating-scenario-card" aria-label={`${selectedScenario.title} details`}>
        <span className="eyebrow">Selected scenario</span><h2>{selectedScenario.title}</h2><p>{selectedScenario.description}</p>
        <div className="floating-scenario-stats four"><span>{runCount || 1}<small>Playwright runs</small></span><span className={failedCount ? "failed" : ""}>{failedCount}<small>Failed steps</small></span><span>{selectedScenario.nodes.length}<small>Test steps</small></span><button disabled={!screenshots.length} onClick={() => { setAllScreenshotsOpen(true); setEdgeScreenshots(screenshots); }}>{screenshots.length}<small>Screenshots</small></button></div>
        <ScenarioRunPanel result={run.result} running={run.running} error={run.error} disabled={!selectedScenario.source} onRun={run.run}/>
        <NodeComposition scenario={selectedScenario} screenshots={screenshots} onScreenshots={selectScreenshots}/>
        <footer><span>Source</span><code>{selectedScenario.source}</code></footer><small className="floating-card-hint">Canvas나 목록의 노드를 누르면 해당 노드의 screenshots를 확인합니다.</small>
      </aside>}
    </div>
  </main>;
}
