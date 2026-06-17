import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.tsx";
import { AuthProvider } from "./contexts/AuthContext.tsx";
import "./index.css";
import "./components/print/print-document.css";
import "./sales-order-print.css";
import "./reports-print.css";
import "./material-demand-print.css";
import "./proposal-print.css";
import "./cnpj-intelligence-print.css";
import "./project-executive-report-print.css";
import "./components/finance/executive-report/finance-executive-report.css";
import "./components/finance/executive-report/finance-executive-report-print.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
