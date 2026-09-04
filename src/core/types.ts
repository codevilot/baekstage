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
  /** Route taken by a generated scenario. Absent for legacy or hand-written specs. */
  executionPath?: ScenarioExecutionPath;
  output: string;
  startedAt: string;
  finishedAt: string;
};

export type ScenarioExecutionPath = {
  itemIds: string[];
  nodeIds: string[];
  edgeIds: string[];
  outcomes: Record<string, string>;
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
  /** Persistent editor layout. Part items are reusable references; node items are
   * scenario-local documentation/observation nodes and do not execute code. */
  composition?: ScenarioComposition;
  /** Definition file attached by discovery. */
  definitionSource?: string;
  /** Runtime-only summary used to highlight the most recent path on the Map. */
  latestRun?: Pick<ScenarioRunResult, "runId" | "status" | "finishedAt" | "executionPath">;
  nodes: ScenarioNode[];
  edges: ScenarioEdge[];
};

/** A reusable, executable portion of a scenario. Part definitions are discovered
 * from `*.baekstage.part.*` files and run in sequence on the same Playwright page. */
export type ScenarioPart = {
  id: string;
  title: string;
  description?: string;
  /** Named export in the part module. Defaults to `run`. */
  execute?: string;
  /** Filled by discovery; normally omitted by authors. */
  source?: string;
  /** Values supplied by each Part instance to drive reusable actions. */
  inputs?: ScenarioPartVariable[];
  /** Expected values supplied by each instance and asserted by its Playwright function. */
  expectations?: ScenarioPartVariable[];
  /** Named business outcomes reserved for scenario-level routing. Assertion failures remain test failures. */
  outcomes?: ScenarioPartOutcome[];
  nodes: ScenarioNode[];
  edges: ScenarioEdge[];
};

export type ScenarioPartVariable = {
  id: string;
  title: string;
  type: "string" | "number" | "boolean" | "json";
  description?: string;
  required?: boolean;
  defaultValue?: unknown;
};

export type ScenarioPartOutcome = { id: string; title: string; description?: string; verdict?: "continue" | "passed" | "failed" };
export type ScenarioPartRunOptions = { inputs: Record<string, unknown>; expectations: Record<string, unknown> };
export type ScenarioPartRunResult = { outcome?: string; values?: Record<string, unknown> };

export type ScenarioPartUse = {
  part: ScenarioPart;
  repeat?: number;
  inputs?: Record<string, unknown>;
  expectations?: Record<string, unknown>;
};

export type ScenarioCompositionDraft = {
  id: string;
  title: string;
  description?: string;
  items: Array<{ partId: string; repeat?: number; inputs?: Record<string, unknown>; expectations?: Record<string, unknown> }>;
  routes?: ScenarioCompositionRoute[];
};

export type ScenarioCompositionItem =
  | { id: string; type: "part"; partId: string; repeat?: number; inputs?: Record<string, unknown>; expectations?: Record<string, unknown> }
  | { id: string; type: "node"; nodeId: string };

export type ScenarioCompositionRoute = { fromItemId: string; outcome: string; toItemId: string };
export type ScenarioComposition = { items: ScenarioCompositionItem[]; routes?: ScenarioCompositionRoute[] };

export type ScenarioEditDraft = {
  id: string;
  title: string;
  description?: string;
  items: Array<
    | { id: string; type: "part"; partId: string; repeat?: number; inputs?: Record<string, unknown>; expectations?: Record<string, unknown> }
    | { id: string; type: "node"; node: ScenarioNode }
  >;
  /** Original edges are retained for existing manual nodes. */
  edges?: ScenarioEdge[];
  routes?: ScenarioCompositionRoute[];
  execution?: ScenarioExecution | LegacyScenarioExecution;
  definitionSource?: string;
};

export type ScenarioSuite = {
  name: string;
  generatedAt?: string;
  parts?: ScenarioPart[];
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
  composerEndpoint?: string;
  editorEndpoint?: string;
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
