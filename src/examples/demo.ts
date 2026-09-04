import { definePart, defineSuite, materializeScenario } from "../core/scenario";
import type { ScenarioGraph, ScenarioNode, ScenarioPart } from "../core/types";

const source = "e2e/fixtures/demo-flow.spec.ts";
const step = (id: string, title: string, kind: ScenarioNode["kind"] = "screen"): ScenarioNode => ({ id, title, kind, status: "passed" });

function stateChangeScenario(id: string, title: string, grep: string, before: string, action: string, after: string): ScenarioGraph {
  return {
    id,
    title,
    source,
    execution: { grep },
    nodes: [step("fixture", "Create demo data", "fixture"), step("before", before), step("action", action, "action"), step("after", after, "outcome")],
    edges: [
      { id: "fixture-before", source: "fixture", target: "before" },
      { id: "before-action", source: "before", target: "action" },
      { id: "action-after", source: "action", target: "after", branch: true },
    ],
  };
}

const demoParts: ScenarioPart[] = [
  definePart({ id: "sign-in", title: "Sign in", description: "테스트 고객으로 로그인하고 홈 화면을 엽니다.", source: "e2e/parts/sign-in.baekstage.part.ts", inputs: [{ id: "email", title: "로그인 이메일", type: "string", required: true, defaultValue: "tester@example.com" }], expectations: [{ id: "heading", title: "로그인 후 제목", type: "string", defaultValue: "Home" }], outcomes: [{ id: "authenticated", title: "로그인 성공", verdict: "continue" }, { id: "denied", title: "로그인 거절", verdict: "failed" }], nodes: [step("form", "Login form"), step("submit", "Submit credentials", "action"), step("home", "Home ready", "outcome")], edges: [{ id: "form-submit", source: "form", target: "submit" }, { id: "submit-home", source: "submit", target: "home" }] }),
  definePart({ id: "open-cart", title: "Open cart", description: "헤더에서 장바구니 화면으로 이동합니다.", source: "e2e/parts/open-cart.baekstage.part.ts", nodes: [step("button", "Cart button", "action"), step("cart", "Cart screen")], edges: [{ id: "open", source: "button", target: "cart" }] }),
  definePart({ id: "drag-card", title: "Drag card", description: "카드를 목적 영역으로 드래그합니다.", source: "e2e/parts/drag-card.baekstage.part.ts", nodes: [step("card", "Select card", "action"), step("drop", "Drop card", "action"), step("done", "Position saved", "assertion")], edges: [{ id: "drag", source: "card", target: "drop" }, { id: "verify", source: "drop", target: "done" }] }),
  definePart({ id: "sign-out", title: "Sign out", description: "현재 사용자 세션을 종료합니다.", source: "e2e/parts/sign-out.baekstage.part.ts", nodes: [step("menu", "Account menu", "action"), step("logout", "Sign out", "action")], edges: [{ id: "logout", source: "menu", target: "logout" }] }),
];

const checkoutMixed = materializeScenario({
  id: "checkout-success", title: "Complete checkout", description: "재사용 Part와 시나리오 전용 Node를 함께 사용하는 편집 예제입니다.", execution: { grep: "C-01" },
  items: [
    { id: "login-part", type: "part", partId: "sign-in", inputs: { email: "customer@acme.test" }, expectations: { heading: "Store home" } },
    { id: "cart-part", type: "part", partId: "open-cart" },
    { id: "manual-submit", type: "node", node: step("submit-order", "Submit order", "action") },
    { id: "manual-confirm", type: "node", node: step("order-confirmed", "Order confirmed", "outcome") },
  ],
  edges: [{ id: "submit-confirmed", source: "submit-order", target: "order-confirmed" }],
}, demoParts);

export const demoSuite = defineSuite({
  name: "Acme Commerce test scenarios",
  parts: demoParts,
  scenarios: [
    checkoutMixed,
    stateChangeScenario("payment-declined", "Handle a declined payment", "C-02", "Payment form ready", "Submit declined card", "Decline message shown"),
    stateChangeScenario("apply-discount", "Apply a discount code", "C-03", "Cart at regular price", "Apply discount", "Discounted total shown"),
    stateChangeScenario("cancel-order", "Cancel an order", "C-04", "Order processing", "Cancel order", "Order cancelled"),
    stateChangeScenario("restock-item", "Restock an unavailable item", "C-05", "Item out of stock", "Add inventory", "Item available"),
    {
      id: "retry-failed-export",
      title: "Retry a failed export",
      description: "Retry a generic background export and follow it through the queue.",
      execution: { adapter: "api", request: { sourceId: "task-runner", operationId: "retryExport" } },
      nodes: [
        { id: "failed-screen", title: "Failed export", kind: "screen", layer: "ui", status: "planned", ref: "storybook:demo:export-banner--failed" },
        { id: "retry-button", title: "Select retry", kind: "action", layer: "ui", status: "planned" },
        { id: "retry-request", title: "Retry export", kind: "api", layer: "api", status: "planned", ref: "openapi:task-runner:POST:/exports/{id}/retry", request: { path: { id: "demo-123" }, body: { force: false } }, assertions: [{ type: "status", equals: 200 }], cases: [
          { id: "accepted", title: "Retry accepted", expectedResponse: "200", setup: { type: "request-only" }, request: { path: { id: "demo-123" }, body: { force: false } }, assertions: [{ type: "status", equals: 200 }, { type: "json-path", path: "$.status", equals: "queued" }] },
          { id: "invalid", title: "Invalid request", expectedResponse: "400", setup: { type: "request-only" }, request: { path: { id: "demo-123" }, body: { force: "invalid" } }, assertions: [{ type: "status", equals: 400 }] },
          { id: "not-found", title: "Export not found", expectedResponse: "404", setup: { type: "request-only" }, request: { path: { id: "missing-export" }, body: { force: false } }, assertions: [{ type: "status", equals: 404 }, { type: "json-path", path: "$.code", equals: "EXPORT_NOT_FOUND" }] },
          { id: "already-running", title: "Export already running", expectedResponse: "409", setup: { type: "request-only" }, request: { path: { id: "running-export" }, body: { force: false } }, assertions: [{ type: "status", equals: 409 }, { type: "json-path", path: "$.code", equals: "EXPORT_ALREADY_RUNNING" }] },
          { id: "queue-failure", title: "Queue unavailable", expectedResponse: "500", setup: { type: "external", description: "Requires a demo environment with a disabled queue." }, assertions: [{ type: "status", equals: 500 }] },
          { id: "unexpected-server-error", title: "Unexpected server error", setup: { type: "request-only" }, request: { path: { id: "failure" }, body: { force: false } } },
        ] },
        { id: "queue", title: "Queue task", kind: "service", layer: "service", status: "planned" },
        { id: "db-queued", title: "Save queued status", kind: "database", layer: "database", status: "planned" },
        { id: "worker", title: "Generate export", kind: "action", layer: "worker", status: "planned" },
        { id: "complete", title: "Export ready", kind: "outcome", layer: "ui", status: "planned" },
        { id: "already-running", title: "Already running notice", kind: "screen", layer: "ui", status: "planned" },
      ],
      edges: [...["failed-screen", "retry-button", "retry-request", "queue", "db-queued", "worker"].map((sourceId, index) => ({ id: `${sourceId}-next`, source: sourceId, target: ["retry-button", "retry-request", "queue", "db-queued", "worker", "complete"][index], ...(sourceId === "retry-request" ? { branch: true, response: "200" } : {}) })), { id: "retry-conflict", source: "retry-request", target: "already-running", branch: true, response: "409" }],
    },
  ],
});
