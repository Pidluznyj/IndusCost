import React from "react";
import { Navigate } from "react-router-dom";

/** Catch-all autenticado: entra sempre na home (tela inicial do sistema). */
export const DefaultModuleRedirect: React.FC = () => {
  return <Navigate to="/home" replace />;
};
