import React from "react";
import { useAuth } from "@/src/contexts/AuthContext";
import { PermissionDenied } from "@/src/components/security/PermissionDenied";
import { PERMISSION_DENIED_TAB_MESSAGE } from "@/src/lib/permissionsClient";
import {
  canViewTabResource,
  navigationAccessContextFromAuth,
} from "@/src/lib/resourceNavigationAccess";

type Props = {
  resourceKey: string;
  /** Quando false, não renderiza nada (aba inativa). */
  active: boolean;
  children: React.ReactNode;
  deniedMessage?: string;
};

/**
 * Conteúdo de aba (P12): view via DTO efetivo.
 * Ativa sem permissão → PermissionDenied (não CSS-only).
 * Inativa → null.
 */
export function ProtectedTab({
  resourceKey,
  active,
  children,
  deniedMessage = PERMISSION_DENIED_TAB_MESSAGE,
}: Props) {
  const auth = useAuth();
  const ctx = navigationAccessContextFromAuth(auth);

  if (!active) return null;

  if (!canViewTabResource(resourceKey, ctx)) {
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
