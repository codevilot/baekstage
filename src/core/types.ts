export type ScenarioNodeKind = "fixture" | "action" | "screen" | "api" | "service" | "database" | "worker" | "external" | "assertion" | "outcome";
export type ScenarioNodeStatus = "planned" | "running" | "passed" | "failed" | "skipped" | "unsupported";

export type ScenarioArtifactType = "screenshot" | "trace" | "json" | "request" | "response" | "log" | "database-diff" | "metric" | "video" | "file";

export type TestType = "e2e" | "api" | "component" | "visual";
export type TestStatus = "idle" | "running" | "passed" | "failed" | "skipped" | "changed" | "approved" | "rejected";

/** Engine-neutral result consumed by the graph and review surfaces. */
export type TestResult = {
  id: string;
  type: TestType;
  suiteId?: string;
  scenarioId?: string;
  stepId?: string;
  status: TestStatus;
  duration?: number;
  artifacts?: ScenarioArtifact[];
  metadata?: Record<string, unknown>;
};

export type StorybookStory = {
  id: string;
  sourceId: string;
  /** Story source reported by Storybook's index.json (usually relative to the Storybook app root). */
  sourcePath?: string;
  title: string;
  name: string;
  component: string;
  tags: string[];
  previewUrl: string;
};

export type VisualDiff = {
  changedPixels: number;
  totalPixels: number;
  diffRatio: number;
  baselineImage: string;
  currentImage: string;
  diffImage: string;
};

export type VisualBuild = {
  id: string;
  repository: string;
  branch: string;
  commitSha?: string;
  baseBranch?: string;
  baseCommitSha?: string;
  workingTreeDirty?: boolean;
  createdAt: string;
};

export type ReviewStatus = "changed" | "approved" | "rejected";
export type AnnotationComment = { id: string; author: string; body: string; createdAt: string };
export type Annotation = {
  id: string;
  storyId: string;
  branch?: string;
  buildId?: string;
  x?: number;
  y?: number;
  selector?: string;
  elementPath?: string;
  comment: string;
  comments: AnnotationComment[];
  status: "open" | "resolved";
  createdAt: string;
};

export type VisualReview = { storyId: string; buildId: string; status: ReviewStatus; updatedAt: string; author?: string };

export type ScenarioArtifact = {
  label: string;
  url: string;
  type: ScenarioArtifactType;
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
  domSnapshotUrl?: string;
  nodeNumber?: number;
  nodeTitle?: string;
  target?: string;
  mimeType?: string;
  httpStatus?: number;
  durationMs?: number;
  method?: string;
  requestUrl?: string;
  redacted?: boolean;
  runId?: string;
  caseId?: string;
};

export type ApiRequestDefinition = {
  sourceId?: string;
  operationId?: string;
  path?: Record<string, unknown>;
  query?: Record<string, unknown>;
  headers?: Record<string, string>;
  body?: unknown;
};

export type ApiCaseSetup =
  | { type: "request-only" }
  | { type: "fixture"; fixtureId: string }
  | { type: "playwright"; source: string; grep?: string }
  | { type: "external"; description: string };

export type ScenarioApiCase = {
  id: string;
  title: string;
  expectedResponse?: string;
  request?: ApiRequestDefinition;
  assertions?: ScenarioAssertion[];
  setup?: ApiCaseSetup;
};

export type ScenarioExecution =
  | { adapter: "playwright"; source?: string; grep?: string }
  | { adapter: "api"; request: ApiRequestDefinition }
  | { adapter: "command"; command: string; args?: string[] };

export type LegacyScenarioExecution = { grep?: string };

export type ApiAssertion =
  | { type: "status"; equals: number }
  | { type: "json-path"; path: string; equals: unknown }
  | { type: "exists"; path: string }
  | { type: "duration"; lessThanMs: number }
  | { type: "content-type"; includes: string };

export type ScenarioAssertion = string | ApiAssertion;

export type AssertionResult = {
  assertion: ApiAssertion;
  status: "passed" | "failed";
  message: string;
  expected?: unknown;
  actual?: unknown;
};

export type ApiFailureKind = "unexpected-status" | "undocumented-response" | "schema-mismatch" | "validation-unsupported" | "assertion-failed" | "network-error" | "timeout" | "response-too-large" | "invalid-content-type";
export type ApiBranchMatchType = "exact" | "range" | "default" | "undocumented";

export type ObservedApiRequest = {
  timestamp: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: unknown;
  bodyStored: boolean;
  bodyStorageReason?: "stored" | "disabled" | "unavailable";
};

export type ObservedApiResponse = {
  status: number;
  statusText: string;
  durationMs: number;
  headers: Record<string, string>;
  body?: unknown;
  contentType?: string;
  documented: boolean;
  branchId?: string;
  matchType: ApiBranchMatchType;
  schemaValid?: boolean;
  validationUnsupported?: boolean;
  schemaErrors?: string[];
};

export type NetworkMatchStatus = "matched" | "ambiguous" | "undocumented" | "ignored";
export type NetworkStepMarker = { id: string; fromNodeId?: string; toNodeId?: string; edgeId?: string; operationId?: string; caseId?: string; sourceId?: string };
export type ObservedPlaywrightStep = { marker: NetworkStepMarker; status: "passed" | "failed"; startedAt: string; finishedAt: string; durationMs: number; error?: string };
export type ApiExecutionEvidence = { request: ObservedApiRequest; response?: ObservedApiResponse; operationMatch?: NetworkMatchStatus; operationCandidates?: string[]; step?: NetworkStepMarker; caseMatch?: "matched" | "ambiguous" | "observed-only" };
export type ObservedNetworkRecord = { request: ObservedApiRequest; response?: Omit<ObservedApiResponse, "documented" | "matchType">; error?: string; step?: NetworkStepMarker; matchStatus?: NetworkMatchStatus; includeSourceIds?: string[] };

export type ScenarioNodeResult = {
  runId: string;
  nodeId: string;
  origin: "playwright" | "api-replay";
  caseId?: string;
  status: ScenarioNodeStatus;
  durationMs?: number;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  artifacts?: ScenarioArtifact[];
  assertions?: AssertionResult[];
  api?: ApiExecutionEvidence;
  failureKind?: ApiFailureKind;
};

export type ScenarioRunResult = {
  runId: string;
  scenarioId: string;
  origin: "playwright" | "api-replay";
  status: "passed" | "failed";
  adapter?: ScenarioExecution["adapter"];
  nodeResults?: ScenarioNodeResult[];
  screenshots: Array<Omit<ScenarioArtifact, "type">>;
  traces?: Array<{ label: string; url: string }>;
  artifacts?: ScenarioArtifact[];
  output: string;
  startedAt: string;
  finishedAt: string;
};

export type ScenarioNode = {
  id: string;
  title: string;
  description?: string;
  kind: ScenarioNodeKind;
  facets?: Record<string, string[]>;
  metadata?: Record<string, unknown>;
  ref?: string;
  layer?: "ui" | "api" | "service" | "database" | "worker" | "external";
  request?: ApiRequestDefinition;
  cases?: ScenarioApiCase[];
  status?: ScenarioNodeStatus;
  assertions?: ScenarioAssertion[];
  artifacts?: ScenarioArtifact[];
  latestResult?: ScenarioNodeResult;
  resultHistory?: ScenarioNodeResult[];
  /** Storybook states and engine-neutral results linked to this E2E/API step. */
  relatedStories?: string[];
  testResults?: TestResult[];
};

export type ScenarioEdge = {
  id: string;
  source: string;
  target: string;
  label?: string;
  branch?: boolean;
  response?: string;
};

export type ScenarioGraph = {
  id: string;
  title: string;
  description?: string;
  source?: string;
  execution?: ScenarioExecution | LegacyScenarioExecution;
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
  catalogEndpoint?: string;
  apiRunnerEndpoint?: string;
  storybookEndpoint?: string;
  reviewEndpoint?: string;
  schemaEndpoint?: string;
};

export type OpenApiParameter = { name: string; in: "path" | "query" | "header" | "cookie"; required?: boolean; description?: string; schema?: unknown; example?: unknown };
export type OpenApiMedia = { contentType: string; schema?: unknown; example?: unknown };
export type OpenApiResponse = { status: string; description?: string; media?: OpenApiMedia[] };
export type OpenApiResponseHeader = { name: string; description?: string; required?: boolean; schema?: unknown; example?: unknown };
export type OpenApiResponseBranchCategory = "success" | "redirect" | "client-error" | "server-error" | "default";
export type OpenApiResponseBranch = {
  id: string;
  statusPattern: string;
  category: OpenApiResponseBranchCategory;
  title: string;
  description?: string;
  contentTypes: string[];
  schema?: unknown;
  example?: unknown;
  headers?: OpenApiResponseHeader[];
};
export type OpenApiOperation = {
  id: string;
  sourceId: string;
  sourceTitle: string;
  method: string;
  path: string;
  operationId?: string;
  summary?: string;
  description?: string;
  tags: string[];
  parameters: OpenApiParameter[];
  requestBody?: { required?: boolean; media: OpenApiMedia[] };
  responses: OpenApiResponse[];
  responseBranches: OpenApiResponseBranch[];
  schemaComponents?: unknown;
  baseUrl?: string;
  environments?: Record<string, string>;
};
export type OpenApiCatalog = { operations: OpenApiOperation[]; errors?: Array<{ sourceId: string; message: string }> };
