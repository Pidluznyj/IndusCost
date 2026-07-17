import React from "react";
import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/src/contexts/AuthContext";
import { LandingPage } from "@/src/components/LandingPage";

/** Rota pública inicial: landing para visitantes; redireciona usuários já autenticados. */
export const PublicLandingRoute: React.FC = () => {
  const auth = useAuth();

  if (auth.authLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Carregando…</p>
      </div>
    );
  }

  if (auth.authenticated) {
    return <Navigate to="/home" replace />;
  }

  return <LandingPage />;
};
