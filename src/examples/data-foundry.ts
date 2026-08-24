import { defineSuite } from "../core/scenario";
import type { ScenarioGraph, ScenarioNode } from "../core/types";

const source = "tdp-web/e2e/kpi/kpi-sampling-full-stack.spec.ts";
const step = (id: string, title: string, kind: ScenarioNode["kind"] = "screen"): ScenarioNode => ({ id, title, kind, status: "passed" });
const screenStep = (scenarioId: string, id: string, title: string, url: string, kind: ScenarioNode["kind"] = "screen"): ScenarioNode => ({ ...step(id, title, kind), artifacts: [{ type: "screenshot", label: title, url, nodeId: id, scenarioId }] });

function samplingScenario(
  id: string,
  title: string,
  grep: string,
  before: Array<[string, string]>,
  after: Array<[string, string]>,
): ScenarioGraph {
  const nodes = [
    step("fixture", "KPI fixture", "fixture"),
    ...before.map(([nodeId, label]) => screenStep(id, nodeId, label, "/demo/kpi-before.png")),
    screenStep(id, "sampling-review", "Sampling Reviewer 판정", "/demo/sampling-review.png", "action"),
    ...after.map(([nodeId, label]) => screenStep(id, nodeId, label, "/demo/kpi-after.png")),
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
      screenStep(id, "kpi-before", `${subject} KPI 적용 전`, "/demo/kpi-before.png"),
      screenStep(id, "admin-leave", "Admin 소급 휴가 등록", "/demo/admin-leave.png", "action"),
      screenStep(id, "kpi-after", `${subject} KPI 적용 후`, "/demo/kpi-after.png", "outcome"),
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
    {
      id: "retry-failed-conversion", title: "실패한 Dataset 변환 다시 시도", description: "UI에서 실패한 변환을 다시 queue에 넣고 Worker 완료까지 추적합니다.",
      execution: { adapter: "api", request: { sourceId: "dataset-manager", operationId: "retryConversion" } },
      nodes: [
        { id: "failed-screen", title: "실패 내역 화면", kind: "screen", layer: "ui", status: "planned", ref: "storybook:console:conversion-banner--failed", artifacts: [{ type: "screenshot", label: "Dataset conversion failed", url: "/demo/conversion-failed.png", nodeId: "failed-screen", scenarioId: "retry-failed-conversion", important: true }] },
        { id: "retry-button", title: "Retry 버튼", kind: "action", layer: "ui", status: "planned" },
        { id: "retry-request", title: "변환 다시 시도", kind: "api", layer: "api", status: "planned", ref: "openapi:dataset-manager:POST:/conversion/jobs/{id}/retry", request: { path: { id: "abc-123" }, body: { force: false } }, assertions: [{ type: "status", equals: 200 }], cases: [
          { id: "accepted", title: "재시도 요청 성공", expectedResponse: "200", setup: { type: "request-only" }, request: { path: { id: "abc-123" }, body: { force: false } }, assertions: [{ type: "status", equals: 200 }, { type: "json-path", path: "$.status", equals: "queued" }] },
          { id: "invalid", title: "잘못된 요청", expectedResponse: "400", setup: { type: "request-only" }, request: { path: { id: "abc-123" }, body: { force: "invalid" } }, assertions: [{ type: "status", equals: 400 }] },
          { id: "not-found", title: "작업 없음", expectedResponse: "404", setup: { type: "request-only" }, request: { path: { id: "missing-job" }, body: { force: false } }, assertions: [{ type: "status", equals: 404 }, { type: "json-path", path: "$.code", equals: "JOB_NOT_FOUND" }] },
          { id: "already-running", title: "이미 실행 중", expectedResponse: "409", setup: { type: "request-only" }, request: { path: { id: "running-job" }, body: { force: false } }, assertions: [{ type: "status", equals: 409 }, { type: "json-path", path: "$.code", equals: "JOB_ALREADY_RUNNING" }] },
          { id: "queue-failure", title: "Queue 등록 실패", expectedResponse: "500", setup: { type: "external", description: "Queue 장애가 준비된 환경이 필요합니다." }, assertions: [{ type: "status", equals: 500 }] },
          { id: "unexpected-server-error", title: "예상하지 못한 서버 오류", setup: { type: "request-only" }, request: { path: { id: "failure" }, body: { force: false } } },
        ] },
        { id: "queue", title: "Queue 등록", kind: "service", layer: "service", status: "planned" },
        { id: "db-queued", title: "DB status = queued", kind: "database", layer: "database", status: "planned" },
        { id: "worker", title: "Worker 변환", kind: "action", layer: "worker", status: "planned" },
        { id: "complete", title: "완료 화면", kind: "outcome", layer: "ui", status: "planned", artifacts: [{ type: "screenshot", label: "Conversion complete", url: "/demo/conversion-complete.png", nodeId: "complete", scenarioId: "retry-failed-conversion" }] },
        { id: "already-running", title: "이미 실행 중 안내", kind: "screen", layer: "ui", status: "planned", artifacts: [{ type: "screenshot", label: "Job already running", url: "/demo/conversion-conflict.png", nodeId: "already-running", scenarioId: "retry-failed-conversion", important: true }] },
      ],
      edges: [...["failed-screen", "retry-button", "retry-request", "queue", "db-queued", "worker"].map((sourceId, index) => ({ id: `${sourceId}-next`, source: sourceId, target: ["retry-button", "retry-request", "queue", "db-queued", "worker", "complete"][index], ...(sourceId === "retry-request" ? { branch: true, response: "200" } : {}) })), { id: "retry-conflict", source: "retry-request", target: "already-running", branch: true, response: "409" }],
    },
  ],
});
