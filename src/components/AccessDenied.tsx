import React from "react";
import type { AppModuleId } from "@/src/lib/modulePermissions";
import type { PathViewDecision } from "@/src/lib/resourceNavigationAccess";
import { UnauthorizedAccessGate } from "@/src/components/UnauthorizedAccessGate";

export type AccessDeniedProps = {
  moduleId?: AppModuleId;
  title?: string;
  description?: string;
  /** URL pedida — permanece no browser até o OK do modal. */
  intendedPath?: string;
  reason?: PathViewDecision["reason"];
};

/**
 * PERM-39 — rota/módulo negado: bloqueia conteúdo + modal + OK → primeira rota permitida.
 * Props legadas (title/description/moduleId) são ignoradas no fluxo modal canônico.
 */
export const AccessDenied: React.FC<AccessDeniedProps> = ({
  intendedPath,
}) => {
  return <UnauthorizedAccessGate intendedPath={intendedPath} />;
};

export { NoPermissionsGranted } from "@/src/components/NoPermissionsGranted";
