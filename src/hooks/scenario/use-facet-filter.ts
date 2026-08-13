import { useMemo, useState } from "react";
import { filterScenario } from "../../core/scenario";
import type { ScenarioGraph } from "../../core/types";

export function useFacetFilter(scenario: ScenarioGraph) {
  const facets = useMemo(() => {
    const values = new Map<string, Set<string>>();
    for (const node of scenario.nodes) for (const [key, items] of Object.entries(node.facets ?? {})) {
      const current = values.get(key) ?? new Set<string>();
      items.forEach((item) => current.add(item));
      values.set(key, current);
    }
    return [...values].map(([key, items]) => ({ key, values: [...items] }));
  }, [scenario]);
  const [selected, setSelected] = useState<Record<string, Set<string>>>({});
  const graph = useMemo(() => filterScenario(scenario, selected), [scenario, selected]);
  const toggle = (key: string, value: string) => setSelected((current) => {
    const next = { ...current, [key]: new Set(current[key] ?? []) };
    if (next[key].has(value)) next[key].delete(value); else next[key].add(value);
    return next;
  });
  return { facets, selected, graph, toggle, reset: () => setSelected({}) };
}
