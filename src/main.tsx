import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ScenarioViewer } from "./viewer/ScenarioViewer";
import { dataFoundrySuite } from "./examples/data-foundry";
import "./styles.css";
import "./galaxy.css";
import "./viewer/status.css";
import "./viewer/overview/overview-panel.css";
import "./viewer/api/api.css";
import openapi from "./examples/data-foundry-openapi.json";
import { parseOpenApiDocument } from "./openapi/catalog";

declare const __BAEKSTAGE_LOCAL_DEMO__: boolean;

const demoBaseUrl = import.meta.env.VITE_BAEKSTAGE_DEMO_API_URL ?? "http://localhost:8080";
const catalog = parseOpenApiDocument({ id: "dataset-manager", title: "Dataset Manager API", baseUrl: demoBaseUrl, environments: { Local: demoBaseUrl } }, openapi);
const suite = __BAEKSTAGE_LOCAL_DEMO__ ? { ...dataFoundrySuite, name: `${dataFoundrySuite.name} · Local demo`, scenarios: dataFoundrySuite.scenarios.map((scenario) => ({ ...scenario, source: "e2e/fixtures/data-foundry-kpi-demo.spec.ts", execution: { adapter: "playwright" as const, source: "e2e/fixtures/data-foundry-kpi-demo.spec.ts", grep: scenario.id === "retry-failed-conversion" ? "R-01" : scenario.execution && "grep" in scenario.execution ? scenario.execution.grep : undefined } })) } : dataFoundrySuite;
createRoot(document.getElementById("root")!).render(<StrictMode><ScenarioViewer suite={suite} catalog={catalog}/></StrictMode>);
