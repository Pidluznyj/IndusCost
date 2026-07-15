import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/src/contexts/AuthContext";
import { getSafeFirstAllowedPath } from "@/src/lib/resourceNavigationAccess";
import { NoPermissionsGranted } from "@/src/components/AccessDenied";

export const DefaultModuleRedirect: React.FC = () => {
  const auth = useAuth();
  const target = getSafeFirstAllowedPath({
    user: auth.authUser,
    checker: auth,
  });

  if (!target) {
    return <NoPermissionsGranted />;
  }

  return <Navigate to={target} replace />;
};
