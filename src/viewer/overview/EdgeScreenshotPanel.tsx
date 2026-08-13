import type { ScenarioArtifact } from "../../core/types";
import { ScreenshotGallery } from "./ScreenshotGallery";

function transitionLabel(items: ScenarioArtifact[]) {
  const first = items[0];
  if (first?.fromNodeId && first.toNodeId) return `${first.fromNodeId} → ${first.toNodeId}`;
  return first?.edgeId ?? first?.nodeId ?? "Transition";
}

export function EdgeScreenshotPanel({ screenshots, outbound, all = false, traceViewerEndpoint, onBack }: { screenshots: ScenarioArtifact[]; outbound: ScenarioArtifact[]; all?: boolean; traceViewerEndpoint?: string; onBack: () => void }) {
  const outboundUrls = new Set(outbound.map((item) => item.url));
  return <aside className="floating-scenario-card edge-screenshot-view" aria-label="Transition screenshots">
    <button className="edge-back" onClick={onBack}>← Selected scenario</button>
    <span className="eyebrow">{all ? "Scenario screenshots" : "Node screenshots"}</span>
    <h2>{all ? "All screenshots" : transitionLabel(outbound)}</h2>
    <p>{all ? "이 시나리오에서 기록된 전체 화면입니다." : "선택한 노드의 화면은 선명하게, 같은 시나리오의 나머지 화면은 흐리게 표시합니다."}</p>
    <div className="outbound-count"><strong>{outbound.length}</strong><span>{all ? "Scenario screenshots" : "Selected node"}</span><small>{screenshots.length} total</small></div>
    <ScreenshotGallery screenshots={screenshots} focusUrls={all ? undefined : outboundUrls} traceViewerEndpoint={traceViewerEndpoint}/>
  </aside>;
}
