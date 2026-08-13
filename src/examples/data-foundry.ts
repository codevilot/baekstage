import { defineSuite } from "../core/scenario";
import type { ScenarioGraph, ScenarioNode } from "../core/types";

const source = "tdp-web/e2e/kpi/kpi-sampling-full-stack.spec.ts";
const step = (id: string, title: string, kind: ScenarioNode["kind"] = "screen"): ScenarioNode => ({ id, title, kind, status: "passed" });

function samplingScenario(
  id: string,
  title: string,
  grep: string,
  before: Array<[string, string]>,
  after: Array<[string, string]>,
): ScenarioGraph {
  const nodes = [
    step("fixture", "KPI fixture", "fixture"),
    ...before.map(([nodeId, label]) => step(nodeId, label)),
    step("sampling-review", "Sampling Reviewer 판정", "action"),
    ...after.map(([nodeId, label]) => step(nodeId, label)),
  ];
  const beforeIds = before.map(([nodeId]) => nodeId);
  const afterIds = after.map(([nodeId]) => nodeId);
  return {
    id, title, source, execution: { grep }, nodes,
    edges: [
      ...beforeIds.map((target) => ({ id: `fixture-${target}`, source: "fixture", target })),
      ...beforeIds.map((sourceId) => ({ id: `${sourceId}-review`, source: sourceId, target: "sampling-review" })),
      ...afterIds.map((target) => ({ id: `review-${target}`, source: "sampling-review", target, branch: true })),
    ],
  };
}

function leaveScenario(id: string, title: string, file: string, grep: string, subject: string): ScenarioGraph {
  return {
    id, title, source: `tdp-web/e2e/kpi/${file}`, execution: { grep },
    nodes: [
      step("fixture", "하루 미작업 + 하루 작업 fixture", "fixture"),
      step("kpi-before", `${subject} KPI 적용 전`),
      step("admin-leave", "Admin 소급 휴가 등록", "action"),
      step("kpi-after", `${subject} KPI 적용 후`, "outcome"),
    ],
    edges: [
      { id: "fixture-before", source: "fixture", target: "kpi-before" },
      { id: "before-leave", source: "kpi-before", target: "admin-leave" },
      { id: "leave-after", source: "admin-leave", target: "kpi-after", branch: true },
    ],
  };
}

export const dataFoundrySuite = defineSuite({
  name: "Data Foundry KPI scenarios",
  scenarios: [
    samplingScenario("sampling-collector", "Sampling 확인 후 Collector KPI 변화", "D-01", [["collector-before", "Collector KPI 적용 전"], ["leaderboard-before", "Leaderboard 적용 전"]], [["collector-after", "Collector KPI 적용 후"], ["leaderboard-after", "Leaderboard 적용 후"]]),
    samplingScenario("sampling-curator-good", "Sampling Good Review 후 Curator KPI 변화", "J-05", [["curator-before", "Curator KPI 적용 전"]], [["curator-after", "Curator KPI 적용 후"]]),
    samplingScenario("sampling-curator-bad", "Sampling Bad Review 후 KPI 변화", "J-04", [["curator-before", "Curator KPI 적용 전"], ["collector-before", "Collector KPI 적용 전"], ["leaderboard-before", "Leaderboard 적용 전"]], [["curator-after", "Curator KPI 적용 후"], ["collector-after", "Collector KPI 적용 후"], ["leaderboard-after", "Leaderboard 적용 후"]]),
    leaveScenario("collector-leave", "Collector KPI에 소급 휴가 적용", "collector-leave-kpi-full-stack.spec.ts", "A-01", "Collector"),
    leaveScenario("curator-leave", "Curator KPI에 소급 휴가 적용", "curator-leave-kpi-full-stack.spec.ts", "B-02", "Curator"),
  ],
});
