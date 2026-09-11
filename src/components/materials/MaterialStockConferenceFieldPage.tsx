/**
 * Shell de campo / QR-ready — Conferência de estoque sem sidebar nem abas.
 * Autenticado; reutiliza a mesma página operacional em shellMode="locked".
 */
import React from "react";
import { UnauthorizedAccessGate } from "@/src/components/UnauthorizedAccessGate";
import { MaterialStockConferencePage } from "@/src/components/materials/MaterialStockConferencePage";
import { usePermissions } from "@/src/hooks/usePermissions";
import { MATERIALS_UI_SECTIONS } from "@/src/lib/moduleTabResources";
import { useAuthorizedTabs } from "@/src/hooks/useAuthorizedTabs";

export function MaterialStockConferenceFieldPage() {
  const permissions = usePermissions();
  const canViewModule = permissions.canViewModule("materials");
  const { visibleTabs, isEmpty } = useAuthorizedTabs({
    tabs: MATERIALS_UI_SECTIONS,
    requestedId: "stockConference",
  });
  const canStockConference = visibleTabs.some((t) => t.id === "stockConference");

  if (!canViewModule || isEmpty || !canStockConference) {
    return <UnauthorizedAccessGate forceDenied />;
  }

  return (
    <div
      className="min-h-dvh bg-background px-3 py-4 sm:px-4"
      data-testid="stock-conference-field-shell"
      data-shell="locked"
    >
      <MaterialStockConferencePage shellMode="locked" />
    </div>
  );
}
