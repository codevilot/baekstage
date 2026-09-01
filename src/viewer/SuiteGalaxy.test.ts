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
});
