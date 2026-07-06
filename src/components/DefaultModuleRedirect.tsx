import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/src/contexts/AuthContext";
import { getFirstAllowedModulePath } from "@/src/lib/modulePermissions";
import { NoPermissionsGranted } from "@/src/components/AccessDenied";

export const DefaultModuleRedirect: React.FC = () => {
  const auth = useAuth();
  const target = getFirstAllowedModulePath(auth);

  if (!target) {
    return <NoPermissionsGranted />;
  }

  return <Navigate to={target} replace />;
};
