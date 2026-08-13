export type ScenarioNodeKind = "fixture" | "action" | "screen" | "api" | "database" | "assertion" | "outcome";
export type ScenarioNodeStatus = "planned" | "running" | "passed" | "failed" | "skipped";

export type ScenarioArtifact = {
  label: string;
  url: string;
  type: "screenshot" | "trace" | "json";
  nodeId?: string;
  scenarioId?: string;
  edgeId?: string;
  fromNodeId?: string;
  toNodeId?: string;
  category?: string;
  branch?: string;
  important?: boolean;
  checkpoint?: boolean;
  traceUrl?: string;
  nodeNumber?: number;
  nodeTitle?: string;
  target?: string;
};

export type ScenarioNode = {
  id: string;
  title: string;
  description?: string;
  kind: ScenarioNodeKind;
  facets?: Record<string, string[]>;
  metadata?: Record<string, unknown>;
  status?: ScenarioNodeStatus;
  assertions?: string[];
  artifacts?: ScenarioArtifact[];
};

export type ScenarioEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
  branch?: boolean;
};

export type ScenarioGraph = {
  id: string;
  title: string;
  description?: string;
  source?: string;
  execution?: { grep?: string };
  nodes: ScenarioNode[];
  edges: ScenarioEdge[];
};

export type ScenarioSuite = {
  name: string;
  generatedAt?: string;
  scenarios: ScenarioGraph[];
};

export type ScenarioViewerOptions = {
  connectBy?: string[];
  primaryFacet?: string;
  runnerEndpoint?: string;
  traceViewerEndpoint?: string;
};
