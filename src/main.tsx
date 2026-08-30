import React from "react";
import ReactDOM from "react-dom/client";
import "./theme/index.css";
import "./i18n";
import App from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
