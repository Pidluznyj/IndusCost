import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { AuthLoginPage } from "@/src/components/AuthLoginPage";

type LoginLocationState = {
  from?: { pathname: string; search?: string; hash?: string };
  authError?: string | null;
};

/** Rota pública de login; redireciona se a sessão já estiver ativa. */
export const PublicLoginRoute: React.FC = () => {
  const auth = useAuth();
  const location = useLocation();
  const state = (location.state ?? null) as LoginLocationState | null;

  if (auth.authLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Verificando sessão…</p>
      </div>
    );
  }

  if (auth.authenticated) {
    const from = state?.from;
    if (from) {
      return (
        <Navigate
          to={`${from.pathname}${from.search ?? ""}${from.hash ?? ""}`}
          replace
        />
      );
    }
    return <Navigate to="/home" replace />;
  }

  return (
    <AuthLoginPage
      networkError={state?.authError ?? auth.authError}
      onRetry={() => void auth.loadMe()}
      redirectAfterLogin={state?.from}
    />
  );
};
