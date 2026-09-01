import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { ScenarioArtifact } from "../../core/types";
import { TraceSnapshotViewer } from "./TraceSnapshotViewer";

export function ScreenshotGallery({ screenshots, focusUrls, traceViewerEndpoint }: { screenshots: ScenarioArtifact[]; focusUrls?: Set<string>; traceViewerEndpoint?: string }) {
  const ordered = useMemo(() => [...screenshots].sort((a, b) => {
    const focus = Number(!!focusUrls?.has(b.url)) - Number(!!focusUrls?.has(a.url));
    return focus || Number(!!b.important) - Number(!!a.important);
  }), [focusUrls, screenshots]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [traceOpen, setTraceOpen] = useState(false);
  const [hovered, setHovered] = useState<ScenarioArtifact | null>(null);
  const [reviewed, setReviewed] = useState<Set<string>>(new Set());
  const selected = selectedIndex === null ? null : ordered[selectedIndex];
  const move = (offset: number) => { setTraceOpen(false); setSelectedIndex((current) => current === null ? 0 : (current + offset + ordered.length) % ordered.length); };
  useEffect(() => { setReviewed(new Set()); setSelectedIndex(null); setTraceOpen(false); }, [screenshots]);
  useEffect(() => {
    if (selectedIndex === null) return;
    const navigate = (event: KeyboardEvent) => {
      if (event.key === "Escape") traceOpen ? setTraceOpen(false) : setSelectedIndex(null);
      if (event.key === "ArrowLeft") move(-1);
      if (event.key === "ArrowRight") move(1);
    };
    window.addEventListener("keydown", navigate); return () => window.removeEventListener("keydown", navigate);
  }, [selectedIndex, ordered.length, traceOpen]);
  if (!ordered.length) return null;
  const nextUnreviewed = () => {
    const checked = new Set(reviewed);
    if (selected) checked.add(selected.url);
    setReviewed(checked);
    const start = selectedIndex ?? -1;
    for (let step = 1; step <= ordered.length; step += 1) {
      const index = (start + step) % ordered.length;
      if (!checked.has(ordered[index].url)) { setTraceOpen(false); setSelectedIndex(index); return; }
    }
  };
  return <section className="screenshot-gallery" aria-label="Playwright screenshots">
    <header><strong>Marked screenshots</strong><span>{reviewed.size}/{ordered.length} checked</span></header>
    <div className="screenshot-thumbnails">{ordered.map((item, index) => {
      const muted = !!focusUrls?.size && !focusUrls.has(item.url);
      return <button className={`${item.important ? "important" : ""} ${reviewed.has(item.url) ? "reviewed" : ""} ${muted ? "outbound-muted" : "outbound-active"}`} onMouseEnter={() => setHovered(item)} onMouseLeave={() => setHovered(null)} onClick={() => { setHovered(null); setTraceOpen(false); setSelectedIndex(index); }} key={`${item.url}-${index}`}><img src={item.url} alt={item.label}/>{item.nodeNumber && <mark title={item.nodeTitle}>#{item.nodeNumber}</mark>}<span>{item.important && "★ "}{item.category ?? "Screen"} · {item.label}</span><i>{reviewed.has(item.url) ? "✓" : muted ? "Same scenario" : focusUrls?.size ? "Selected node" : item.branch ?? item.nodeId ?? ""}</i></button>;
    })}</div>
    <button className="review-next" onClick={nextUnreviewed}>다음 미확인 스크린샷 →</button>
    {hovered && !selected && createPortal(<div className="baekstage-portal screenshot-hover-preview"><img src={hovered.url} alt=""/><span>{hovered.label}</span></div>, document.body)}
    {selected?.traceUrl && traceOpen && createPortal(<div className="baekstage-portal"><TraceSnapshotViewer artifact={selected} endpoint={traceViewerEndpoint} onClose={() => setTraceOpen(false)}/></div>, document.body)}
    {selected && !traceOpen && createPortal(<div className="baekstage-portal screenshot-lightbox" role="dialog" aria-modal="true" aria-label={selected.label} onClick={() => setSelectedIndex(null)}><button className="lightbox-close" aria-label="Close screenshot">×</button><button className="lightbox-arrow previous" onClick={(event) => { event.stopPropagation(); move(-1); }} aria-label="Previous screenshot">‹</button><figure onClick={(event) => event.stopPropagation()}><img src={selected.url} alt={selected.label}/><figcaption><b>{selected.nodeNumber ? `#${selected.nodeNumber} · ${selected.nodeTitle} · ` : ""}{selected.category ?? "Screenshot"}{selected.branch ? ` · ${selected.branch}` : ""}</b><span>{selected.label}</span><div><button onClick={() => move(-1)}>← 이전</button><em>{(selectedIndex ?? 0) + 1} / {ordered.length}</em><button onClick={() => move(1)}>다음 →</button></div>{selected.traceUrl && <button className="open-trace" onClick={() => setTraceOpen(true)}>Open interactive trace</button>}<button className="confirm-next" onClick={nextUnreviewed}>확인하고 다음 미확인 →</button></figcaption></figure><button className="lightbox-arrow next" onClick={(event) => { event.stopPropagation(); move(1); }} aria-label="Next screenshot">›</button></div>, document.body)}
  </section>;
}
