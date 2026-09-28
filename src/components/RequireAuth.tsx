import React from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";

/** Rota única do ciclo de senha do próprio usuário (obrigatória e voluntária). */
export const PASSWORD_CHANGE_ROUTE = "/security/change-password";
/** Aceite da Política Comercial vigente. Só depois da senha pessoal. */
export const COMMERCIAL_POLICY_ROUTE = "/security/commercial-policy";

export const RequireAuth: React.FC = () => {
  const { authLoading, authenticated, authError, authUser } = useAuth();
  const location = useLocation();

  if (authLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Verificando sessão…</p>
      </div>
    );
  }

  if (!authenticated) {
    return (
      <Navigate
        to="/login"
        replace
        state={{
          from: location,
          authError: authError ?? undefined,
        }}
      />
    );
  }

  // Troca obrigatória pendente: nenhuma outra tela autenticada abre. É UX —
  // o bloqueio real das APIs é do backend (passwordChangeRequiredGuard), então
  // voltar no histórico ou digitar a URL na mão não contorna nada.
  if (authUser?.mustChangePassword && location.pathname !== PASSWORD_CHANGE_ROUTE) {
    return <Navigate to={PASSWORD_CHANGE_ROUTE} replace />;
  }
  if (
    !authUser?.mustChangePassword &&
    authUser?.commercialPolicyAcceptanceRequired &&
    location.pathname !== COMMERCIAL_POLICY_ROUTE
  ) {
    return <Navigate to={COMMERCIAL_POLICY_ROUTE} replace />;
  }

  return <Outlet />;
};
