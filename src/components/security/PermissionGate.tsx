import React from "react";
import { usePermissions } from "@/src/hooks/usePermissions";
import { PermissionDenied } from "@/src/components/security/PermissionDenied";
import type { PermissionAction } from "@/src/lib/permissionsClient";
import { cn } from "@/src/lib/utils";

export type PermissionGateMode = "hide" | "disable" | "deny";

type Props = {
  resourceKey: string;
  action?: PermissionAction;
  mode?: PermissionGateMode;
  children: React.ReactNode;
  fallback?: React.ReactNode;
  deniedTitle?: string;
  deniedMessage?: string;
  className?: string;
  disabledClassName?: string;
};

/**
 * Gate visual de permissão. Backend continua sendo a fonte de segurança.
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
  const { canView, canExecute, canManage } = usePermissions();
  const allowed =
    action === "view"
      ? canView(resourceKey)
      : action === "execute"
        ? canExecute(resourceKey)
        : canManage(resourceKey);

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

  // disable
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
