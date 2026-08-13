import { useState } from "react";
import type { ScenarioSuite } from "../../core/types";

export function useScenarioSelection(suite: ScenarioSuite) {
  const [scenarioId, setScenarioId] = useState(suite.scenarios[0].id);
  const [selectedNodeId, setSelectedNodeId] = useState(suite.scenarios[0].nodes[0].id);
  const scenario = suite.scenarios.find((item) => item.id === scenarioId) ?? suite.scenarios[0];
  const changeScenario = (id: string) => {
    const next = suite.scenarios.find((item) => item.id === id);
    if (!next) return;
    setScenarioId(id);
    setSelectedNodeId(next.nodes[0].id);
  };
  return { scenario, selectedNodeId, setSelectedNodeId, changeScenario };
}
