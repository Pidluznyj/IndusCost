import React from "react";
import { Outlet } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { AuthLoginPage } from "@/src/components/AuthLoginPage";

export const RequireAuth: React.FC = () => {
  const { authLoading, authenticated, authError, loadMe } = useAuth();

  if (authLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Verificando sessão…</p>
      </div>
    );
  }

  if (!authenticated) {
    if (authError) {
      return <AuthLoginPage networkError={authError} onRetry={() => void loadMe()} />;
    }
    return <AuthLoginPage />;
  }

  return <Outlet />;
};
