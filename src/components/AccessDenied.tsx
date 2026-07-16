import React from "react";
import { Link, useLocation } from "react-router-dom";
import { ShieldOff } from "lucide-react";
import {
  MODULE_LABELS,
  type AppModuleId,
} from "@/src/lib/modulePermissions";
import {
  getSafeFirstAllowedPath,
  navigationAccessContextFromAuth,
  type PathViewDecision,
} from "@/src/lib/resourceNavigationAccess";
import { useAuth } from "@/src/contexts/AuthContext";

export type AccessDeniedProps = {
  moduleId?: AppModuleId;
  title?: string;
  description?: string;
  /** URL pedida — permanece no browser; link de fallback guarda `from` no state. */
  intendedPath?: string;
  reason?: PathViewDecision["reason"];
};

export const AccessDenied: React.FC<AccessDeniedProps> = ({
  moduleId,
  title = "Acesso não autorizado",
  description,
  intendedPath,
  reason,
}) => {
  const auth = useAuth();
  const location = useLocation();
  const ctx = navigationAccessContextFromAuth(auth);
  const fallbackPath = getSafeFirstAllowedPath(ctx);
  const areaName = moduleId ? MODULE_LABELS[moduleId] : "esta área";
  const fromPath = intendedPath ?? location.pathname;

  const defaultDescription =
    reason === "unmapped"
      ? "Esta URL não corresponde a nenhum módulo liberado. Solicite ao administrador a liberação necessária."
      : reason === "session_error"
        ? "Não foi possível validar sua sessão. Faça login novamente."
        : `Você não tem permissão para acessar ${areaName}. Solicite ao administrador a liberação necessária.`;

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-8 max-w-xl mx-auto text-center space-y-4">
      <div className="mx-auto h-12 w-12 rounded-xl bg-amber-100 flex items-center justify-center">
        <ShieldOff className="h-6 w-6 text-amber-800" />
      </div>
      <div>
        <h2 className="text-lg font-bold text-amber-950">{title}</h2>
        <p className="text-sm text-amber-900/90 mt-2 leading-relaxed">
          {description ?? defaultDescription}
        </p>
        {fromPath ? (
          <p className="text-xs text-amber-800/70 mt-2 break-all">
            URL solicitada: {fromPath}
          </p>
        ) : null}
      </div>
      {fallbackPath ? (
        <Link
          to={fallbackPath}
          state={{ from: fromPath }}
          className="inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          Ir para área permitida
        </Link>
      ) : (
        <p className="text-sm text-amber-900 font-medium">
          Seu usuário não possui permissões liberadas. Solicite acesso ao administrador.
        </p>
      )}
    </div>
  );
};

export const NoPermissionsGranted: React.FC = () => (
  <div className="min-h-[50vh] flex items-center justify-center p-6">
    <AccessDenied
      title="Nenhuma permissão liberada"
      description="Seu usuário não possui permissões liberadas. Solicite acesso ao administrador."
    />
  </div>
);
