// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import type { ScenarioGraph } from "../../core/types";

vi.mock("@xyflow/react", () => ({ Background: () => null, Controls: () => null, ReactFlow: ({ children }: any) => <div>{children}</div>, MarkerType: { ArrowClosed: "closed" } }));
vi.mock("../nodes/ScenarioGraphNode", () => ({ facetColor: () => "blue", ScenarioGraphNode: () => null }));
import { ScenarioDetail } from "./ScenarioDetail";

afterEach(cleanup);
describe("Scenario act inspector", () => {
  it("shows hierarchy, flow, request/response and screen evidence", async () => { const graph: ScenarioGraph = { id: "retry", title: "Retry", source: "retry.spec.ts", nodes: [{ id: "button", title: "Retry button", kind: "action", layer: "ui" }, { id: "api", title: "POST retry", kind: "api", layer: "api", status: "passed", latestResult: { runId: "run", origin: "playwright", nodeId: "api", status: "passed", api: { request: { timestamp: "now", method: "POST", url: "http://api/jobs/one/retry", headers: {}, bodyStored: false }, response: { status: 409, statusText: "Conflict", durationMs: 12, headers: {}, body: { code: "ALREADY_RUNNING" }, documented: true, branchId: "response:409", matchType: "exact" } } } }, { id: "message", title: "Conflict message", kind: "screen", layer: "ui" }], edges: [{ id: "request", source: "button", target: "api" }, { id: "conflict", source: "api", target: "message", response: "409" }] }; const onSelect = vi.fn(); render(<ScenarioDetail graph={graph} scenario={graph} selected={graph.nodes[1]} screenshots={[{ type: "screenshot", label: "Conflict screen", url: "/screen.png", nodeId: "api" }]} onSelect={onSelect}/>); expect(screen.getByLabelText("Scenario hierarchy")).toHaveTextContent("Act 2"); expect(screen.getByText("Received from").parentElement).toHaveTextContent("Retry button"); expect(screen.getByText("Sends to").parentElement).toHaveTextContent("HTTP 409"); expect(screen.getByText("Request · POST")).toBeVisible(); expect(screen.getByText(/not stored/)).toBeVisible(); expect(screen.getByText("Response · 409 Conflict")).toBeVisible(); await userEvent.click(screen.getByAltText("Conflict screen")); expect(screen.getByRole("button", { name: "Back to node result" })).toBeVisible(); await userEvent.click(screen.getByRole("button", { name: "Back to node result" })); await userEvent.click(screen.getByText("Conflict message")); expect(onSelect).toHaveBeenCalledWith("message"); });
});
