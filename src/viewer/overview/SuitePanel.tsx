import { useMemo } from "react";
import type { ScenarioArtifact, ScenarioSuite } from "../../core/types";
import { useScenarioRun } from "../../hooks/scenario/use-scenario-run";
import { ScenarioRunPanel } from "./ScenarioRunPanel";
import { ScreenshotGallery } from "./ScreenshotGallery";

export function SuitePanel({ suite, endpoint, onClose, onSelect }: { suite: ScenarioSuite; endpoint?: string; onClose: () => void; onSelect: (id: string) => void }) {
  const run = useScenarioRun("__suite__", "", undefined, endpoint);
  const screenshots = useMemo<ScenarioArtifact[]>(() => run.result?.screenshots.map((item) => ({ ...item, type: "screenshot" })) ?? [], [run.result]);
  return <aside className="suite-panel" aria-label="Suite test runner">
    <button className="panel-close" onClick={onClose} aria-label="Close suite">×</button>
    <span className="eyebrow">Test suite</span><h2>{suite.name}</h2>
    <p>실행 가능한 시나리오를 선택하거나 프로젝트의 전체 Playwright 테스트를 실행합니다.</p>
    <ScenarioRunPanel result={run.result} running={run.running} error={run.error} onRun={run.run}/>
    <ScreenshotGallery screenshots={screenshots}/>
    <section className="suite-scenarios"><header><strong>Scenarios</strong><span>{suite.scenarios.length}</span></header><div>{suite.scenarios.map((scenario) => {
      const failures = scenario.nodes.filter((node) => node.status === "failed").length;
      return <button onClick={() => onSelect(scenario.id)} key={scenario.id}><i className={failures ? "failed" : "passed"}/><span><strong>{scenario.title}</strong><small>{scenario.nodes.length} steps · {failures ? `${failures} failed` : "ready"}</small></span><b>›</b></button>;
    })}</div></section>
  </aside>;
}
