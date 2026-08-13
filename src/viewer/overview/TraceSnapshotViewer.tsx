import type { ScenarioArtifact } from "../../core/types";

function viewerUrl(traceUrl: string, endpoint: string) {
  const absolute = new URL(traceUrl, window.location.href).href;
  return `${endpoint.replace(/\/$/, "")}/index.html?trace=${encodeURIComponent(absolute)}`;
}

export function TraceSnapshotViewer({ artifact, endpoint = "/trace-viewer", onClose }: { artifact: ScenarioArtifact; endpoint?: string; onClose: () => void }) {
  if (!artifact.traceUrl) return null;
  return <div className="trace-snapshot-viewer" role="dialog" aria-modal="true" aria-label={`Interactive snapshot: ${artifact.label}`}>
    <header><div><strong>Interactive DOM snapshot</strong><span>{artifact.label}</span></div><button onClick={onClose} aria-label="Close trace viewer">×</button></header>
    <iframe src={viewerUrl(artifact.traceUrl, endpoint)} title={`Playwright trace for ${artifact.label}`}/>
  </div>;
}
