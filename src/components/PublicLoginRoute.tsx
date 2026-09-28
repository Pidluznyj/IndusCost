import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { AuthLoginPage } from "@/src/components/AuthLoginPage";
import { COMMERCIAL_POLICY_ROUTE, PASSWORD_CHANGE_ROUTE } from "@/src/components/RequireAuth";

type LoginLocationState = {
  authError?: string | null;
};

/** Rota pública de login. Troca obrigatória vai direto à tela de senha, sem passar pelo /home. */
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
    if (auth.authUser?.mustChangePassword) {
      return <Navigate to={PASSWORD_CHANGE_ROUTE} replace />;
    }
    if (auth.authUser?.commercialPolicyAcceptanceRequired) {
      return <Navigate to={COMMERCIAL_POLICY_ROUTE} replace />;
    }
    return <Navigate to="/home" replace />;
  }

  return (
    <AuthLoginPage
      authNotice={state?.authError ?? auth.authError}
      onRetrySessionCheck={() => void auth.loadMe()}
    />
  );
};
