/**
 * Entry do formulário público de Satisfação.
 *
 * Bundle separado do app administrativo por construção (vite.config.ts →
 * rollupOptions.input.satisfaction). Nada aqui importa AuthProvider, sidebar,
 * React Router ou qualquer rota interna: o cliente que responde a pesquisa
 * recebe só este código.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SurveyApp } from "./SurveyApp.js";
import "./satisfaction-public.css";

const container = document.getElementById("satisfaction-root");

if (container) {
  createRoot(container).render(
    <StrictMode>
      <SurveyApp />
    </StrictMode>
  );
}
