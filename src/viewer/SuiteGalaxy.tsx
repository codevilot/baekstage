import { lazy, Suspense, useEffect, useMemo, useRef } from "react";
import type { ForceGraphMethods } from "react-force-graph-2d";
import type { ScenarioArtifact, ScenarioSuite } from "../core/types";
import { useElementSize } from "../hooks/layout/use-element-size";
import { artifactMatchesEdge, screenshotsForNode } from "../core/artifacts";

type NetworkNode = { id: string; graphNodeId?: string; label: string; subtitle?: string; kind: "root" | "scenario" | "step"; scenarioId?: string; color: string; size: number; failed?: boolean; passed?: boolean; stepNumber?: number; x?: number; y?: number; fx?: number; fy?: number };
type NetworkLink = { source: string | NetworkNode; target: string | NetworkNode; color: string; width: number; screenshots?: ScenarioArtifact[] };
const ForceGraph2D = lazy(() => import("react-force-graph-2d")) as typeof import("react-force-graph-2d").default;

function nodeColor(kind: string, failed: boolean) {
  if (failed) return "#ef4444";
  return ({ fixture: "#94a3b8", action: "#f59e0b", screen: "#22d3ee", database: "#10b981", assertion: "#a78bfa", outcome: "#60a5fa", api: "#f472b6" } as Record<string, string>)[kind] ?? "#64748b";
}

function edgeShots(shots: ScenarioArtifact[], edge: { id: string; source: string; target: string } | null, target: string) {
  return shots.filter((shot) => artifactMatchesEdge(shot, edge, target));
}

function makeNetwork(suite: ScenarioSuite, depthLimit: number, status: "all" | "failed", screenshots: ScenarioArtifact[], selectedId?: string) {
  const nodes: NetworkNode[] = [{ id: "root", label: suite.name, kind: "root", color: "#f8fafc", size: 5 }];
  const links: NetworkLink[] = [];
  for (const scenario of suite.scenarios) {
    const rootId = `scenario:${scenario.id}`;
    const failed = scenario.nodes.some((node) => node.status === "failed");
    const runCount = scenario.nodes.filter((node) => node.metadata?.scenarioId).length || 1;
    const failedCount = scenario.nodes.filter((node) => node.status === "failed").length;
    nodes.push({ id: rootId, label: scenario.title, subtitle: `${runCount} run · ${scenario.nodes.length} steps${failedCount ? ` · ${failedCount} failed` : ""}`, kind: "scenario", scenarioId: scenario.id, color: failed ? "#ef4444" : "#3b82f6", size: 5, failed });
    links.push({ source: "root", target: rootId, color: failed ? "#ef4444" : "#334155", width: failed ? 2 : 1.2 });
    if (!depthLimit) continue;
    const depths = new Map(scenario.nodes.map((node) => [node.id, 1]));
    for (let pass = 0; pass < scenario.nodes.length; pass += 1) for (const edge of scenario.edges) {
      const next = (depths.get(edge.source) ?? 1) + 1;
      if (next < (depths.get(edge.target) ?? Infinity)) depths.set(edge.target, next);
    }
    const visible = new Set(scenario.nodes.filter((node) => (depths.get(node.id) ?? 1) <= depthLimit && (status === "all" || node.status === "failed")).map((node) => node.id));
    const failurePath = new Set(scenario.nodes.filter((node) => node.status === "failed").map((node) => node.id));
    for (let pass = 0; pass < scenario.nodes.length; pass += 1) for (const edge of scenario.edges) if (failurePath.has(edge.target)) failurePath.add(edge.source);
    for (const [index, node] of scenario.nodes.entries()) if (visible.has(node.id)) nodes.push({ id: `${rootId}:${node.id}`, graphNodeId: node.id, label: node.title, kind: "step", scenarioId: scenario.id, color: nodeColor(node.kind, node.status === "failed"), size: 7, failed: node.status === "failed", passed: node.status === "passed", stepNumber: index + 1 });
    for (const node of scenario.nodes) if (visible.has(node.id)) {
      const parents = scenario.edges.filter((edge) => edge.target === node.id && visible.has(edge.source));
      const failingRoute = failurePath.has(node.id);
      for (const edge of parents.length ? parents : [null]) links.push({ source: edge ? `${rootId}:${edge.source}` : rootId, target: `${rootId}:${node.id}`, color: failingRoute ? "#ef4444" : "#334155", width: failingRoute ? 1.7 : .7, screenshots: edgeShots(screenshots, edge, node.id) });
    }
  }
  if (selectedId) {
    const selectedScenario = suite.scenarios.find((scenario) => scenario.id === selectedId);
    const rootId = `scenario:${selectedId}`;
    const levels = new Map<string, number>([[rootId, 0]]);
    if (selectedScenario) for (let pass = 0; pass < selectedScenario.nodes.length + 1; pass += 1) for (const link of links) {
      const source = endpointId(link.source), target = endpointId(link.target), sourceLevel = levels.get(source);
      if (sourceLevel !== undefined && target.startsWith(`${rootId}:`)) levels.set(target, Math.max(levels.get(target) ?? 0, sourceLevel + 1));
    }
    const columns = new Map<number, NetworkNode[]>();
    nodes.filter((node) => node.scenarioId === selectedId).forEach((node) => { const level = levels.get(node.id) ?? 0; columns.set(level, [...(columns.get(level) ?? []), node]); });
    [...columns].forEach(([level, items]) => items.forEach((node, index) => { node.fx = level * 125; node.fy = (index - (items.length - 1) / 2) * 72; }));
  }
  const layer = { step: 0, scenario: 1, root: 2 };
  nodes.sort((left, right) => layer[left.kind] - layer[right.kind]);
  return { nodes, links };
}

function endpointId(value: string | NetworkNode) { return typeof value === "string" ? value : value.id; }

function fitText(context: CanvasRenderingContext2D, value: string, maxWidth: number) {
  if (context.measureText(value).width <= maxWidth) return value;
  let text = value;
  while (text.length && context.measureText(`${text}…`).width > maxWidth) text = text.slice(0, -1);
  return `${text}…`;
}

function drawNode(node: NetworkNode, context: CanvasRenderingContext2D, scale: number, selected?: string, activeNodeIds = new Set<string>()) {
  const active = selected ? node.kind === "root" || node.scenarioId === selected : !activeNodeIds.size || activeNodeIds.has(node.id);
  const radius = node.size;
  context.globalAlpha = active ? 1 : .16;
  context.beginPath(); context.arc(node.x ?? 0, node.y ?? 0, radius, 0, Math.PI * 2);
  context.fillStyle = node.kind === "root" ? "#e2e8f0" : node.kind === "step" ? "#111827" : node.color; context.fill();
  context.lineWidth = (node.failed || node.passed) ? 2 / scale : 1 / scale;
  context.strokeStyle = node.failed ? "#ef4444" : node.passed ? "#10b981" : "rgba(255,255,255,.45)"; context.stroke();
  if (node.kind === "step" && node.stepNumber) {
    context.fillStyle = "#f8fafc"; context.font = `800 ${7 / scale}px Inter,sans-serif`;
    context.textAlign = "center"; context.textBaseline = "middle";
    context.fillText(String(node.stepNumber), node.x ?? 0, node.y ?? 0);
  }
  if (node.kind === "step" && scale < 1.15) { context.globalAlpha = 1; return; }
  const fontSize = (node.kind === "scenario" ? 12 : 10) / scale;
  context.font = `${node.kind === "scenario" ? 700 : 500} ${fontSize}px Inter, sans-serif`;
  const visibleLabel = fitText(context, node.label, 180 / scale);
  const labelWidth = context.measureText(visibleLabel).width;
  const labelX = (node.x ?? 0) + radius + 5 / scale;
  const labelY = (node.y ?? 0) - (node.kind === "scenario" ? 13 : 6) / scale;
  if (node.kind === "scenario") {
    context.fillStyle = "rgba(8,13,24,.88)";
    context.strokeStyle = node.failed ? "rgba(239,68,68,.8)" : "rgba(148,163,184,.32)";
    context.lineWidth = 1 / scale;
    context.beginPath(); context.roundRect(labelX - 4 / scale, labelY - 4 / scale, labelWidth + 12 / scale, 34 / scale, 5 / scale); context.fill(); context.stroke();
  }
  context.fillStyle = "#f8fafc"; context.textAlign = "left"; context.textBaseline = "top";
  context.fillText(visibleLabel, labelX, labelY);
  if (node.subtitle) { context.font = `500 ${8 / scale}px Inter, sans-serif`; context.fillStyle = node.failed ? "#fca5a5" : "#94a3b8"; context.fillText(fitText(context, node.subtitle, 180 / scale), labelX, labelY + 17 / scale); }
  context.globalAlpha = 1;
}

function drawHitArea(node: NetworkNode, color: string, context: CanvasRenderingContext2D, scale: number) {
  const x = node.x ?? 0, y = node.y ?? 0;
  context.fillStyle = color;
  if (node.kind === "scenario" || node.kind === "root") {
    context.beginPath();
    context.roundRect(x - 11 / scale, y - 18 / scale, 210 / scale, 46 / scale, 7 / scale);
    context.fill();
    return;
  }
  context.beginPath(); context.arc(x, y, Math.max(9 / scale, 6), 0, Math.PI * 2); context.fill();
}

function linkCenter(link: NetworkLink) {
  if (typeof link.source === "string" || typeof link.target === "string") return null;
  if (link.source.x === undefined || link.source.y === undefined || link.target.x === undefined || link.target.y === undefined) return null;
  return { x: (link.source.x + link.target.x) / 2, y: (link.source.y + link.target.y) / 2 };
}

function drawLinkMarker(link: NetworkLink, context: CanvasRenderingContext2D, scale: number, activeUrls: Set<string>) {
  if (!link.screenshots?.length) return;
  const center = linkCenter(link); if (!center) return;
  const active = !activeUrls.size || link.screenshots.some((item) => activeUrls.has(item.url));
  if (!active) {
    const width = 25 / scale, height = 18 / scale;
    context.globalAlpha = .62;
    context.fillStyle = "rgba(15,23,42,.94)"; context.strokeStyle = "#64748b"; context.lineWidth = 1 / scale;
    context.beginPath(); context.roundRect(center.x - width / 2, center.y - height / 2, width, height, 4 / scale); context.fill(); context.stroke();
    context.fillStyle = "#cbd5e1"; context.font = `700 ${8 / scale}px Inter,sans-serif`; context.textAlign = "center"; context.textBaseline = "middle";
    context.fillText(`▣ ${link.screenshots.length}`, center.x, center.y);
    context.globalAlpha = 1;
    return;
  }
  const width = 25 / scale, height = 18 / scale;
  context.fillStyle = "rgba(15,23,42,.94)"; context.strokeStyle = "#facc15"; context.lineWidth = 1.5 / scale;
  context.beginPath(); context.roundRect(center.x - width / 2, center.y - height / 2, width, height, 4 / scale); context.fill(); context.stroke();
  context.fillStyle = "#facc15"; context.font = `700 ${8 / scale}px Inter,sans-serif`; context.textAlign = "center"; context.textBaseline = "middle";
  context.fillText(`▣ ${link.screenshots.length}`, center.x, center.y);
  context.globalAlpha = 1;
}

function drawLinkHitArea(link: NetworkLink, color: string, context: CanvasRenderingContext2D, scale: number) {
  if (!link.screenshots?.length) return;
  const center = linkCenter(link); if (!center) return;
  context.fillStyle = color; context.fillRect(center.x - 16 / scale, center.y - 12 / scale, 32 / scale, 24 / scale);
}

export function SuiteGalaxy({ suite, selectedScenarioId, maxDetailDepth, detailStatus, screenshots = [], activeScreenshots = [], onScreenshotsSelect, onSuiteSelect, onScenarioSelect, onBackgroundClick }: { suite: ScenarioSuite; selectedScenarioId?: string; maxDetailDepth: number; detailStatus: "all" | "failed"; screenshots?: ScenarioArtifact[]; activeScreenshots?: ScenarioArtifact[]; onScreenshotsSelect: (items: ScenarioArtifact[]) => void; onSuiteSelect: () => void; onScenarioSelect: (id: string) => void; onBackgroundClick: () => void }) {
  const data = useMemo(() => makeNetwork(suite, maxDetailDepth, detailStatus, screenshots, selectedScenarioId), [suite, maxDetailDepth, detailStatus, screenshots, selectedScenarioId]);
  const activeUrls = useMemo(() => new Set(activeScreenshots.map((item) => item.url)), [activeScreenshots]);
  const activeNodeIds = useMemo(() => new Set(data.links.filter((link) => link.screenshots?.some((item) => activeUrls.has(item.url))).flatMap((link) => [endpointId(link.source), endpointId(link.target)])), [activeUrls, data.links]);
  const graphRef = useRef<ForceGraphMethods<NetworkNode, NetworkLink> | undefined>(undefined);
  const needsInitialFit = useRef(true);
  const { ref, width, height } = useElementSize<HTMLElement>();
  useEffect(() => { needsInitialFit.current = true; graphRef.current?.d3Force("charge")?.strength(-90); }, [data]);
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    if (!selectedScenarioId) { needsInitialFit.current = true; graph.d3ReheatSimulation(); return; }
    const frame = requestAnimationFrame(() => graph.zoomToFit(420, 105, (node) => node.scenarioId === selectedScenarioId));
    return () => cancelAnimationFrame(frame);
  }, [data.nodes, selectedScenarioId]);
  const activeLink = (link: NetworkLink) => {
    if (selectedScenarioId) return [endpointId(link.source), endpointId(link.target)].some((id) => id === `scenario:${selectedScenarioId}` || id.startsWith(`scenario:${selectedScenarioId}:`));
    if (activeUrls.size) return link.screenshots?.some((item) => activeUrls.has(item.url)) ?? false;
    return true;
  };
  const selectNode = (node: NetworkNode) => {
    if (node.kind === "root") return onSuiteSelect();
    if (node.kind === "step") {
      const captures = screenshotsForNode(node.graphNodeId ?? node.id, screenshots);
      if (captures.length) return onScreenshotsSelect(captures);
      return;
    }
    if (node.scenarioId) onScenarioSelect(node.scenarioId);
  };
  const changeZoom = (factor: number) => {
    const graph = graphRef.current;
    if (graph) graph.zoom(Math.max(.25, Math.min(16, graph.zoom() * factor)), 220);
  };
  const showOverview = () => { onBackgroundClick(); graphRef.current?.zoomToFit(550, 65); };
  const fitAfterLayout = () => {
    if (needsInitialFit.current && !selectedScenarioId) {
      needsInitialFit.current = false;
      graphRef.current?.zoomToFit(650, 65);
    }
  };
  return <section ref={ref} className="galaxy" aria-label="All scenarios network graph">
    <div className="galaxy-legend"><span><i className="main-dot"/>Suite</span><span><i className="scenario-dot"/>Scenario</span><span><i className="failed-dot"/>Failed</span></div>
    <nav className="network-zoom" aria-label="Graph zoom controls"><button onClick={() => changeZoom(1.35)} aria-label="Zoom in">+</button><button onClick={() => changeZoom(1 / 1.35)} aria-label="Zoom out">−</button><button onClick={showOverview} aria-label="Show all scenarios" title="전체 시나리오 보기"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5M5.5 10v10h13V10M9.5 20v-6h5v6"/></svg></button></nav>
    <Suspense fallback={null}><ForceGraph2D ref={graphRef} width={width} height={height} graphData={data} backgroundColor="#080d18" cooldownTicks={selectedScenarioId ? 1 : 120} d3AlphaDecay={selectedScenarioId ? 1 : .045} d3VelocityDecay={.38} enableNodeDrag={false} enableZoomInteraction enablePanInteraction nodeLabel="label" nodeRelSize={1} nodeCanvasObject={(node, context, scale) => drawNode(node, context, scale, selectedScenarioId, activeNodeIds)} nodePointerAreaPaint={drawHitArea} linkColor={(link) => activeLink(link) ? link.color : "rgba(51,65,85,.07)"} linkWidth={(link) => activeLink(link) ? link.width : .18} linkDirectionalArrowLength={0} linkCanvasObjectMode={() => "after"} linkCanvasObject={(link, context, scale) => drawLinkMarker(link, context, scale, activeUrls)} linkPointerAreaPaint={drawLinkHitArea} onLinkClick={(link) => link.screenshots?.length && onScreenshotsSelect(link.screenshots)} onEngineStop={fitAfterLayout} onNodeClick={selectNode} onBackgroundClick={onBackgroundClick}/></Suspense>
  </section>;
}
