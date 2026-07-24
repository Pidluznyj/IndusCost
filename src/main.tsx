import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { VersionWatcher } from "./components/VersionWatcher.tsx";
import App from "./App.tsx";
import { AuthProvider } from "./contexts/AuthContext.tsx";
import { installDevPerfBaselineClient } from "./lib/devPerfBaselineClient.ts";
import "./index.css";
import "./components/print/print-document.css";
import "./sales-order-print.css";
import "./reports-print.css";
import "./material-demand-print.css";
import "./proposal-print.css";
import "./cnpj-intelligence-print.css";
import "./project-executive-report-print.css";
import "./project-intake-form-print.css";
import "./components/finance/executive-report/finance-executive-report.css";
import "./components/finance/executive-report/finance-executive-report-print.css";
import "./components/finance/dre/finance-dre-print.css";

// PERFORMANCE 02 — observabilidade opcional (localStorage / VITE_PERF_BASELINE)
installDevPerfBaselineClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <VersionWatcher />
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
