/**
 * P11 — Guard de rota privada: mesmo view/resourceKey da sidebar (DTO efetivo).
 * Preserva a URL no address bar quando negado (AccessDenied sem Navigate).
 */

import React from "react";
import { Outlet, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { AccessDenied } from "@/src/components/AccessDenied";
import {
  evaluatePathViewAccess,
  navigationAccessContextFromAuth,
} from "@/src/lib/resourceNavigationAccess";

export const RequirePathViewAccess: React.FC = () => {
  const auth = useAuth();
  const location = useLocation();
  const ctx = navigationAccessContextFromAuth(auth);
  const decision = evaluatePathViewAccess(location.pathname, ctx);

  if (decision.reason === "loading") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Verificando acesso…</p>
      </div>
    );
  }

  if (!decision.allowed) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center p-6">
        <AccessDenied
          moduleId={decision.moduleId ?? undefined}
          intendedPath={decision.intendedPath ?? location.pathname}
          reason={decision.reason}
        />
      </div>
    );
  }

  return <Outlet />;
};
