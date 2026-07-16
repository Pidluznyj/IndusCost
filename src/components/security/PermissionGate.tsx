import React from "react";
import { useAuth } from "@/src/contexts/AuthContext";
import { PermissionDenied } from "@/src/components/security/PermissionDenied";
import {
  canPerformAction,
  navigationAccessContextFromAuth,
} from "@/src/lib/resourceNavigationAccess";
import type { UiPermissionAction } from "@/src/lib/actionPermissionAccess";
import { cn } from "@/src/lib/utils";

export type PermissionGateMode = "hide" | "disable" | "deny";

type Props = {
  resourceKey: string;
  /** Action do contrato (default view). Mutações devem passar action explícita. */
  action?: UiPermissionAction;
  mode?: PermissionGateMode;
  children: React.ReactNode;
  fallback?: React.ReactNode;
  deniedTitle?: string;
  deniedMessage?: string;
  className?: string;
  disabledClassName?: string;
};

/**
 * Gate visual P13: resourceKey + action via DTO efetivo.
 * Backend permanece a autoridade; esconder botão não substitui API guard (P14).
 */
export function PermissionGate({
  resourceKey,
  action = "view",
  mode = "hide",
  children,
  fallback = null,
  deniedTitle,
  deniedMessage,
  className,
  disabledClassName,
}: Props) {
  const auth = useAuth();
  const ctx = navigationAccessContextFromAuth(auth);
  const allowed = canPerformAction(resourceKey, action, ctx);

  if (allowed) {
    if (className) {
      return <div className={className}>{children}</div>;
    }
    return <>{children}</>;
  }

  if (mode === "hide") {
    return <>{fallback}</>;
  }

  if (mode === "deny") {
    return (
      <PermissionDenied
        title={deniedTitle}
        message={deniedMessage}
        className={className}
      />
    );
  }

  return (
    <div
      className={cn("pointer-events-none opacity-50", disabledClassName, className)}
      aria-disabled="true"
      data-testid="permission-gate-disabled"
    >
      {children}
    </div>
  );
}
