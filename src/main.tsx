import React from "react";
import ReactDOM from "react-dom/client";
import "ag-grid-community/styles/ag-grid.css";
import "ag-grid-community/styles/ag-theme-quartz.css";
import "./theme/index.css";
import "./i18n";
import { registerModelInspectCommand } from "@/stores/model";
import App from "./App";

// Engine-owned commands (ADR-029): route model.inspect to the shared HyperFormula engine.
registerModelInspectCommand();

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
