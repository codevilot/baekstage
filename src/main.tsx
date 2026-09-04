import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ScenarioViewer } from "./viewer/ScenarioViewer";
import { demoSuite } from "./examples/demo";
import "./styles.css";
import "./galaxy.css";
import "./viewer/status.css";
import "./viewer/overview/overview-panel.css";
import "./viewer/api/api.css";
import "./viewer/visual/visual.css";
import "./viewer/schema/schema.css";
import "./viewer/compose/compose.css";
import "./viewer/compose/editor.css";
import openapi from "./examples/demo-openapi.json";
import { parseOpenApiDocument } from "./openapi/catalog";

const demoBaseUrl = import.meta.env.VITE_BAEKSTAGE_DEMO_API_URL ?? "http://localhost:8080";
const catalog = parseOpenApiDocument({ id: "task-runner", title: "Task Runner Demo API", baseUrl: demoBaseUrl, environments: { Local: demoBaseUrl } }, openapi);
createRoot(document.getElementById("root")!).render(<StrictMode><ScenarioViewer suite={demoSuite} catalog={catalog}/></StrictMode>);
