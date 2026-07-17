import React from "react";
import { useAuth } from "@/src/contexts/AuthContext";
import { UnauthorizedAccessGate } from "@/src/components/UnauthorizedAccessGate";
import {
  canViewTabResource,
  navigationAccessContextFromAuth,
} from "@/src/lib/resourceNavigationAccess";

type Props = {
  resourceKey: string;
  /** Quando false, não renderiza nada (aba inativa). */
  active: boolean;
  children: React.ReactNode;
  /** @deprecated PERM-39 usa modal canônico; mantido por compat de assinatura. */
  deniedMessage?: string;
};

/**
 * Conteúdo de aba (P12): view via DTO efetivo.
 * Ativa sem permissão → modal PERM-39 (não CSS-only / sem Navigate silencioso).
 * Inativa → null.
 */
export function ProtectedTab({
  resourceKey,
  active,
  children,
}: Props) {
  const auth = useAuth();
  const ctx = navigationAccessContextFromAuth(auth);

  if (!active) return null;

  if (!canViewTabResource(resourceKey, ctx)) {
    return <UnauthorizedAccessGate forceDenied />;
  }

  return <>{children}</>;
}
