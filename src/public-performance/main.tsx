/**
 * Entry do portal público de Desempenho e Cultura.
 *
 * Bundle separado do app administrativo (vite.config.ts → rollupOptions.input.performance),
 * no mesmo padrão da Satisfação: nada aqui importa AuthProvider, sidebar, React Router ou
 * rota interna. Quem responde pelo celular recebe só este código.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PerformancePortalPage } from "../components/hrPerformance/PerformancePortalPage.js";

const container = document.getElementById("performance-root");

if (container) {
  createRoot(container).render(
    <StrictMode>
      <PerformancePortalPage />
    </StrictMode>
  );
}
