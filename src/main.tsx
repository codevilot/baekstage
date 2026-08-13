import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ScenarioViewer } from "./viewer/ScenarioViewer";
import { dataFoundrySuite } from "./examples/data-foundry";
import "./styles.css";
import "./galaxy.css";
import "./viewer/status.css";
import "./viewer/overview/overview-panel.css";

createRoot(document.getElementById("root")!).render(<StrictMode><ScenarioViewer suite={dataFoundrySuite}/></StrictMode>);
