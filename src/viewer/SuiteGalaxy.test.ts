import { describe, expect, it } from "vitest";
import type { ScenarioSuite } from "../core/types";
import { makeNetwork } from "./SuiteGalaxy";

const suite: ScenarioSuite = {
  name: "Review suite",
  scenarios: [
    { id: "payroll", title: "Monthly Payroll Review", source: "payroll.baekstage.ts", nodes: [{ id: "open", title: "Open review", kind: "screen" }, { id: "close", title: "Close month", kind: "action" }], edges: [{ id: "open-close", source: "open", target: "close" }] },
    { id: "health", title: "Manager health", source: "health.baekstage.ts", nodes: [{ id: "status", title: "Status", kind: "screen" }], edges: [] },
  ],
};

describe("SuiteGalaxy network", () => {
  it("starts with scenario summaries and expands only the selected scenario", () => {
    const overview = makeNetwork(suite, 3, "all", []);
    expect(overview.nodes.map((node) => node.id)).toEqual(["root", "scenario:payroll", "scenario:health"]);

    const expanded = makeNetwork(suite, 3, "all", [], "payroll");
    expect(expanded.nodes.map((node) => node.id)).toEqual(expect.arrayContaining(["root", "scenario:payroll", "scenario:payroll:open", "scenario:payroll:close", "scenario:health"]));
    expect(expanded.nodes.some((node) => node.id === "scenario:health:status")).toBe(false);
  });

  it("styles only the latest traversed edge as the successful path", () => {
    const routed: ScenarioSuite = { name: "Run", scenarios: [{ ...suite.scenarios[0], latestRun: { runId: "run", status: "passed", finishedAt: "now", executionPath: { itemIds: [], nodeIds: ["open", "close"], edgeIds: ["open-close"], outcomes: {} } }, nodes: suite.scenarios[0].nodes.map((node) => ({ ...node, status: "passed" as const })) }] };
    const expanded = makeNetwork(routed, 3, "all", [], "payroll");
    expect(expanded.links.find((link) => typeof link.source !== "string" ? link.source.id.endsWith(":open") : link.source.endsWith(":open"))).toMatchObject({ executed: true, color: "#10b981", width: 2.2 });
  });
});
