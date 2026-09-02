import { useState } from "react";
import type { ScenarioArtifact } from "../../core/types";

function viewerUrl(traceUrl: string, endpoint: string) {
  const absolute = new URL(traceUrl, window.location.href).href;
  return `${endpoint.replace(/\/$/, "")}/index.html?trace=${encodeURIComponent(absolute)}`;
}

export function TraceSnapshotViewer({ artifact, endpoint = "/trace-viewer", onClose }: { artifact: ScenarioArtifact; endpoint?: string; onClose: () => void }) {
  const [fullTrace, setFullTrace] = useState(false);
  if (!artifact.traceUrl && !artifact.domSnapshotUrl) return null;
  const localHost = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  const canUseTrace = !!artifact.traceUrl && (window.isSecureContext || localHost);
  const showingDom = !!artifact.domSnapshotUrl && !fullTrace;
  const source = showingDom ? artifact.domSnapshotUrl : canUseTrace ? viewerUrl(artifact.traceUrl!, endpoint) : undefined;
  return <div className="trace-snapshot-viewer" role="dialog" aria-modal="true" aria-label={`Interactive snapshot: ${artifact.label}`}>
    <header><div><strong>Interactive DOM snapshot</strong><span>{artifact.label}</span></div>{artifact.domSnapshotUrl && canUseTrace && <button onClick={() => setFullTrace((value) => !value)}>{fullTrace ? "DOM snapshot" : "Full Playwright trace"}</button>}<button onClick={onClose} aria-label="Close trace viewer">×</button></header>
    {source ? <iframe src={source} sandbox={showingDom ? "" : undefined} title={`${showingDom ? "DOM snapshot" : "Playwright trace"} for ${artifact.label}`}/> : <p>Interactive trace requires HTTPS or localhost. Run this scenario again with a Baekstage DOM snapshot enabled.</p>}
  </div>;
}
