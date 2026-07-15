import React from "react";
import { usePermissions } from "@/src/hooks/usePermissions";
import { PermissionDenied } from "@/src/components/security/PermissionDenied";
import {
  PERMISSION_DENIED_TAB_MESSAGE,
} from "@/src/lib/permissionsClient";
import { canViewResource } from "@/src/lib/resourceNavigationAccess";

type Props = {
  resourceKey: string;
  /** Quando false, não renderiza nada (aba inativa). */
  active: boolean;
  children: React.ReactNode;
  deniedMessage?: string;
};

/**
 * Conteúdo de aba: se ativa sem permissão, mostra mensagem amigável
 * (ex.: deep-link / estado antigo). Se inativa, não renderiza.
 */
export function ProtectedTab({
  resourceKey,
  active,
  children,
  deniedMessage = PERMISSION_DENIED_TAB_MESSAGE,
}: Props) {
  const { authUser } = usePermissions();

  if (!active) return null;

  if (!canViewResource(authUser, resourceKey)) {
    return (
      <PermissionDenied
        title="Aba sem permissão"
        message={deniedMessage}
        testId="protected-tab-denied"
      />
    );
  }

  return <>{children}</>;
}
