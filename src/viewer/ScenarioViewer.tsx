import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import "@xyflow/react/dist/style.css";
import type { ApiAssertion, OpenApiCatalog, OpenApiOperation, ScenarioArtifact, ScenarioSuite, ScenarioViewerOptions } from "../core/types";
import { normalizeExecution, applyRunResult } from "../core/execution";
import { SuiteGalaxy } from "./SuiteGalaxy";
import { ScenarioRunPanel } from "./overview/ScenarioRunPanel";
import { SuitePanel } from "./overview/SuitePanel";
import { EdgeScreenshotPanel } from "./overview/EdgeScreenshotPanel";
import { NodeComposition } from "./overview/NodeComposition";
import { useScenarioRun } from "../hooks/scenario/use-scenario-run";
import { ApiCatalogView } from "./api/ApiCatalog";
import { ApiWorkbench } from "./api/ApiWorkbench";
import type { ApiRunResponse } from "../hooks/api/use-api-run";
import { ScenarioDetail } from "./detail/ScenarioDetail";
import { ScenarioNodePanel } from "./overview/ScenarioNodePanel";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import { useApiRun } from "../hooks/api/use-api-run";
import { normalizeApiCases } from "../core/api-cases";
import { useSuiteRun, type SuiteRunPolicy } from "../hooks/scenario/use-suite-run";

function scenarioName(title: string) {
  return title.replace(/^\d+\.\s*/, "");
}

const conceptCopy = {
  ko: [{ term: "Scenario", description: "검증할 하나의 사용자 흐름" }, { term: "Act", description: "Setup·UI·API 같은 업무 구간" }, { term: "Step", description: "흐름 안의 개별 행동 또는 결과" }, { term: "Result", description: "저장된 화면·요청·응답·assertion 결과" }],
  en: [{ term: "Scenario", description: "One user flow to verify" }, { term: "Act", description: "A phase such as Setup, UI, or API" }, { term: "Step", description: "An individual action or outcome" }, { term: "Result", description: "Saved screens, requests, responses, and assertions" }],
} as const;

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
      const matchers = runs.flatMap((run) => { const execution = normalizeExecution(run); return execution.adapter === "playwright" && execution.grep ? [execution.grep] : []; });
      return { id: `group:${runs.map((run) => run.id).join("+")}`, title: name, description: `${runs.length}개의 Playwright 실행을 상세 분기로 묶은 Scenario`, source: runs[0].source, execution: matchers.length ? { grep: matchers.join("|") } : undefined, nodes, edges };
    }),
  };
}

export function ScenarioViewer({ suite, catalog = { operations: [] }, options }: { suite: ScenarioSuite; catalog?: OpenApiCatalog; options?: ScenarioViewerOptions }) {
  const [language, setLanguage] = useState<keyof typeof conceptCopy>(() => { try { return localStorage.getItem("baekstage-language-v2") === "ko" ? "ko" : "en"; } catch { return "en"; } });
  useEffect(() => { try { localStorage.setItem("baekstage-language-v2", language); } catch {} }, [language]);
  const [runtimeSuite, setRuntimeSuite] = useState(suite); useEffect(() => setRuntimeSuite(suite), [suite]);
  const [view, setView] = useState<"map" | "scenario" | "catalog" | "runs">("map"); const [selectedOperation, setSelectedOperation] = useState<OpenApiOperation | null>(null);
  const groupedSuite = useMemo(() => groupScenarioRuns(runtimeSuite), [runtimeSuite]);
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [mapNodeId, setMapNodeId] = useState<string | null>(null);
  const [suiteOpen, setSuiteOpen] = useState(false);
  const [edgeScreenshots, setEdgeScreenshots] = useState<ScenarioArtifact[]>([]);
  const [allScreenshotsOpen, setAllScreenshotsOpen] = useState(false);
  const [maxDetailDepth, setMaxDetailDepth] = useState(3);
  const [detailStatus, setDetailStatus] = useState<"all" | "failed">("all");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(252);
  const [suiteRunPolicy, setSuiteRunPolicy] = useState<SuiteRunPolicy>("missing");
  const selectedScenario = groupedSuite.scenarios.find((scenario) => scenario.id === selectedScenarioId);
  const selectedExecution = selectedScenario ? normalizeExecution(selectedScenario) : undefined;
  const run = useScenarioRun(selectedScenario?.id, selectedExecution?.adapter === "playwright" ? selectedExecution.source : selectedScenario?.source, selectedExecution?.adapter === "playwright" ? selectedExecution.grep : undefined, options?.runnerEndpoint);
  useEffect(() => { if (!run.result?.nodeResults?.length) return; setRuntimeSuite((current) => ({ ...current, scenarios: current.scenarios.map((scenario) => scenario.id === run.result?.scenarioId ? applyRunResult(scenario, run.result) : scenario) })); }, [run.result]);
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
  const selectScenario = (id: string) => { setSuiteOpen(false); setEdgeScreenshots([]); setAllScreenshotsOpen(false); setSelectedOperation(null); setMapNodeId(null); setSelectedScenarioId(id); setSelectedNodeId(groupedSuite.scenarios.find((item) => item.id === id)?.nodes[0]?.id ?? null); };
  const selectScreenshots = (items: ScenarioArtifact[]) => { setAllScreenshotsOpen(false); setEdgeScreenshots(items); };
  const closePanels = () => { setSuiteOpen(false); setEdgeScreenshots([]); setAllScreenshotsOpen(false); setMapNodeId(null); setSelectedScenarioId(null); };
  const linkedScenario = selectedOperation ? runtimeSuite.scenarios.find((scenario) => scenario.nodes.some((node) => node.ref === selectedOperation.id)) : undefined;
  const linkedNode = linkedScenario?.nodes.find((node) => node.ref === selectedOperation?.id);
  const applyApiResult = (result: ApiRunResponse) => setRuntimeSuite((current) => ({ ...current, scenarios: current.scenarios.map((scenario) => scenario.id === result.scenarioId ? applyRunResult(scenario, result) : scenario) }));
  const applySuiteRunResult = useCallback((result: ApiRunResponse) => setRuntimeSuite((current) => ({ ...current, scenarios: current.scenarios.map((scenario) => scenario.id === result.scenarioId ? applyRunResult(scenario, result) : scenario) })), []);
  const suiteRun = useSuiteRun(options?.runnerEndpoint, applySuiteRunResult);
  const openApiNode = (ref: string, target: "catalog" | "current" = "catalog") => { const operation = catalog.operations.find((item) => item.id === ref); if (operation) { setSelectedOperation(operation); if (target === "catalog") setView("catalog"); } };
  const openScenarioNode = (scenarioId: string, nodeId: string) => { setSelectedScenarioId(scenarioId); setSelectedNodeId(nodeId); setEdgeScreenshots([]); setAllScreenshotsOpen(false); setView("scenario"); const node = groupedSuite.scenarios.find((item) => item.id === scenarioId)?.nodes.find((item) => item.id === nodeId); if (node?.kind === "api" && node.ref) openApiNode(node.ref, "current"); else setSelectedOperation(null); };
  const inspectMapNode = (scenarioId: string, nodeId: string) => { setSelectedScenarioId(scenarioId); setMapNodeId(nodeId); setEdgeScreenshots([]); setAllScreenshotsOpen(false); };
  const selectedApiNode = selectedScenario?.nodes.find((node) => node.kind === "api" && node.ref);
  const selectedApiOperation = catalog.operations.find((operation) => operation.id === selectedApiNode?.ref);
  const selectedApiCase = selectedApiNode ? normalizeApiCases(selectedApiNode)[0] : undefined;
  const apiRun = useApiRun(options?.apiRunnerEndpoint, applyApiResult);
  const activeRunning = selectedExecution?.adapter === "playwright" ? run.running : apiRun.running;
  const activeResult = selectedExecution?.adapter === "playwright" ? run.result : apiRun.result;
  const runSelectedScenario = () => {
    if (!selectedScenario) return;
    if (selectedExecution?.adapter === "playwright") run.run();
    else if (selectedApiNode && selectedApiOperation && selectedApiCase) {
      const request = { ...selectedApiNode.request, ...selectedApiCase.request, path: { ...selectedApiNode.request?.path, ...selectedApiCase.request?.path }, query: { ...selectedApiNode.request?.query, ...selectedApiCase.request?.query }, headers: { ...selectedApiNode.request?.headers, ...selectedApiCase.request?.headers } };
      apiRun.run({ sourceId: selectedApiOperation.sourceId, operationId: selectedApiOperation.id, scenarioId: selectedScenario.id, nodeId: selectedApiNode.id, caseId: selectedApiCase.id, expectedResponse: selectedApiCase.expectedResponse, environment: Object.keys(selectedApiOperation.environments ?? {})[0], path: request.path ?? {}, query: request.query ?? {}, headers: request.headers ?? { "Content-Type": "application/json" }, body: request.body, assertions: (selectedApiCase.assertions ?? []).filter((item): item is ApiAssertion => typeof item !== "string") });
    }
  };
  const runSelectedMapApi = () => { const node = selectedScenario?.nodes.find((item) => item.id === mapNodeId); if (node?.ref) openApiNode(node.ref, "current"); };

  return <main className={`baekstage-root ${sidebarOpen ? "sidebar-open" : "sidebar-collapsed"}`} style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}>
    <WorkspaceSidebar suite={groupedSuite} open={sidebarOpen} selectedId={selectedScenarioId} batch={{ policy: suiteRunPolicy, running: suiteRun.running, progress: suiteRun.progress }} onPolicy={setSuiteRunPolicy} onRunAll={() => void suiteRun.run(runtimeSuite.scenarios, suiteRunPolicy)} onStop={suiteRun.stop} onToggle={() => setSidebarOpen((current) => !current)} onResize={setSidebarWidth} onSelect={(id) => { setView("map"); selectScenario(id); }}/>
    <header><div><span className="eyebrow">Baekstage</span><h1>{groupedSuite.name}</h1><p>{selectedScenario?.description ?? "UI, API, service와 test result를 Scenario 흐름으로 탐색하세요."}</p><section className="concept-help" lang={language}><div className="language-switch" role="group" aria-label="Concept language"><button className={language === "en" ? "active" : ""} onClick={() => setLanguage("en")} aria-pressed={language === "en"}>English</button><button className={language === "ko" ? "active" : ""} onClick={() => setLanguage("ko")} aria-pressed={language === "ko"}>한국어</button></div><dl className="concept-glossary" aria-label="Baekstage concepts">{conceptCopy[language].map((concept) => <div key={concept.term}><dt>{concept.term}</dt><dd>{concept.description}</dd></div>)}</dl></section></div><nav className="workspace-tabs" aria-label="Workspace views">{(["map", "scenario", "catalog", "runs"] as const).map((item) => <button className={view === item ? "active" : ""} onClick={() => setView(item)} key={item}>{item[0].toUpperCase() + item.slice(1)}</button>)}</nav></header>
    {(view === "map" || (view === "scenario" && !selectedScenario)) && <div className="overview-workspace">
      <SuiteGalaxy suite={groupedSuite} selectedScenarioId={selectedScenarioId ?? undefined} selectedNodeId={mapNodeId ?? undefined} maxDetailDepth={maxDetailDepth} detailStatus={detailStatus} screenshots={screenshots} activeScreenshots={edgeScreenshots} onScreenshotsSelect={selectScreenshots} onSuiteSelect={() => { setSelectedScenarioId(null); setSuiteOpen(true); }} onScenarioSelect={selectScenario} onNodeSelect={inspectMapNode} onApiNodeSelect={openApiNode} onBackgroundClick={closePanels}/>
      <section className="galaxy-filters" aria-label="network graph filters"><div><span>Detail depth</span>{[0,1,2,3].map((depth) => <button className={maxDetailDepth === depth ? "active" : ""} onClick={() => setMaxDetailDepth(depth)} key={depth}>{depth === 0 ? "Main" : depth}</button>)}</div><div><span>Step status</span><button className={detailStatus === "all" ? "active" : ""} onClick={() => setDetailStatus("all")}>All</button><button className={detailStatus === "failed" ? "active" : ""} onClick={() => setDetailStatus("failed")}>Failed</button></div></section>
      {suiteOpen && <SuitePanel suite={groupedSuite} endpoint={options?.runnerEndpoint} onClose={() => setSuiteOpen(false)} onSelect={selectScenario}/>} 
      {!!edgeScreenshots.length && <EdgeScreenshotPanel screenshots={screenshots} outbound={edgeScreenshots} all={allScreenshotsOpen} traceViewerEndpoint={options?.traceViewerEndpoint} onBack={() => { setEdgeScreenshots([]); setAllScreenshotsOpen(false); }}/>} 
      {selectedScenario && mapNodeId && !edgeScreenshots.length && <ScenarioNodePanel scenario={selectedScenario} node={selectedScenario.nodes.find((node) => node.id === mapNodeId) ?? selectedScenario.nodes[0]} screenshots={screenshots} onBack={() => setMapNodeId(null)} onSelect={(nodeId) => setMapNodeId(nodeId)} onRunApi={runSelectedMapApi}/>}
      {selectedScenario && !mapNodeId && !edgeScreenshots.length && <aside className="floating-scenario-card" aria-label={`${selectedScenario.title} details`}>
        <div className="floating-scenario-heading"><span className="eyebrow">Selected scenario</span><button className="scenario-run-action" onClick={runSelectedScenario} disabled={activeRunning || (selectedExecution?.adapter === "playwright" ? !selectedExecution.source : !selectedApiOperation || !selectedApiCase)}>{activeRunning ? <><i/> Running</> : activeResult ? "Run again" : "Run"}</button></div><h2>{selectedScenario.title}</h2><p>{selectedScenario.description}</p>
        <div className="floating-scenario-stats four"><span>{runCount || 1}<small>Playwright runs</small></span><span className={failedCount ? "failed" : ""}>{failedCount}<small>Failed steps</small></span><span>{selectedScenario.nodes.length}<small>Test steps</small></span><button disabled={!screenshots.length} onClick={() => { setAllScreenshotsOpen(true); setEdgeScreenshots(screenshots); }}>{screenshots.length}<small>Screenshots</small></button></div>
        {selectedExecution?.adapter === "playwright" ? <ScenarioRunPanel result={run.result} running={run.running} error={run.error} disabled={!selectedExecution.source} hideAction onRun={run.run}/> : <section className="scenario-run-panel" aria-live="polite"><div><strong>API execution</strong>{apiRun.result && <span className={apiRun.result.status}>{apiRun.result.status}</span>}</div>{apiRun.result?.nodeResults?.[0]?.api?.response ? <small>1 / {selectedScenario.nodes.length} nodes executed · HTTP {apiRun.result.nodeResults[0].api.response.status} {apiRun.result.nodeResults[0].api.response.statusText} · {apiRun.result.nodeResults[0].api.response.durationMs} ms</small> : apiRun.result ? <small>1 / {selectedScenario.nodes.length} nodes executed · {apiRun.result.nodeResults?.[0]?.failureKind ?? "No HTTP response"}</small> : <small>Run은 기본 API case 1개를 실행합니다. 나머지 node는 planned 상태로 유지됩니다.</small>}{apiRun.error && <p>실행 결과를 저장하지 못했습니다: {apiRun.error}</p>}{apiRun.result?.nodeResults?.[0]?.assertions?.some((item) => item.status === "failed") && <details open><summary>실패한 assertion</summary>{apiRun.result.nodeResults[0].assertions.filter((item) => item.status === "failed").map((item, index) => <p key={index}>{item.message}<br/>expected: {String(item.expected)} · actual: {String(item.actual)}</p>)}</details>}</section>}
        <NodeComposition scenario={selectedScenario} screenshots={screenshots} onScreenshots={selectScreenshots} onNodeSelect={(nodeId) => inspectMapNode(selectedScenario.id, nodeId)}/>
        <footer><span>Source</span><code>{selectedScenario.source}</code></footer><small className="floating-card-hint">Canvas나 목록의 노드를 누르면 해당 노드의 screenshots를 확인합니다.</small>
      </aside>}
      {selectedOperation && <div className="overview-workbench"><ApiWorkbench operation={selectedOperation} scenario={linkedScenario} node={linkedNode} endpoint={options?.apiRunnerEndpoint} onResult={applyApiResult} onClose={() => setSelectedOperation(null)}/></div>}
    </div>}
    {view === "scenario" && selectedScenario && selectedScenario.nodes.length > 0 && <div className={`scenario-detail-workspace ${selectedOperation ? "with-workbench" : ""}`}><ScenarioDetail
      graph={selectedScenario} scenario={selectedScenario}
      screenshots={screenshots}
      selected={selectedScenario.nodes.find((node) => node.id === selectedNodeId) ?? selectedScenario.nodes[0]}
      onSelect={(id) => { const node = selectedScenario.nodes.find((item) => item.id === id); setSelectedNodeId(id); if (node?.kind === "api" && node.ref) openApiNode(node.ref, "current"); else setSelectedOperation(null); }}/>
      {selectedOperation && <ApiWorkbench
        operation={selectedOperation} scenario={linkedScenario} node={linkedNode}
        endpoint={options?.apiRunnerEndpoint} onResult={applyApiResult}
        onClose={() => setSelectedOperation(null)}/>
      }
    </div>}
    {view === "catalog" && <div className="catalog-workspace"><ApiCatalogView catalog={catalog} suite={runtimeSuite} selected={selectedOperation?.id} onSelect={setSelectedOperation}/>{selectedOperation && <ApiWorkbench operation={selectedOperation} scenario={linkedScenario} node={linkedNode} endpoint={options?.apiRunnerEndpoint} onResult={applyApiResult} onClose={() => setSelectedOperation(null)}/>}</div>}
    {view === "runs" && <section className="future-view"><h2>Runs</h2><p>Scenario 실행 기록을 통합할 수 있도록 마련된 화면입니다. 현재 실행 결과는 Map과 Catalog에 즉시 반영됩니다.</p></section>}
  </main>;
}
