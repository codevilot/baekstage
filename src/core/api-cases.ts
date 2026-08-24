import type { ScenarioApiCase, ScenarioNode } from "./types";

export function normalizeApiCases(node: ScenarioNode): ScenarioApiCase[] {
  if (node.cases?.length) return node.cases.map((item) => ({ ...item, setup: item.setup ?? { type: "request-only" } }));
  return [{ id: "default", title: node.title, request: node.request, assertions: node.assertions, setup: { type: "request-only" } }];
}
