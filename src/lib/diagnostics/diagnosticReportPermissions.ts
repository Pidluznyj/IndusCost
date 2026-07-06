/**
 * Permissões frontend — Gerar Relatório Analisável (sem imports .server).
 */
import type { AuthContextValue } from "@/src/contexts/AuthContext";
import type { DiagnosticScope } from "./chatgptDiagnosticTypes.js";
import { COMMISSIONS_AUDIT_VIEW_PERMISSIONS } from "../commissionsPermissions.js";
import { PRODUCTION_COST_TABLE_VIEW_PERMISSIONS } from "../productionCostTablesUi.js";

const DIAGNOSTIC_REPORT_BASE_PERMISSIONS = [
  ...PRODUCTION_COST_TABLE_VIEW_PERMISSIONS,
  ...COMMISSIONS_AUDIT_VIEW_PERMISSIONS,
  "pricing.view",
  "settings.price_tables.view",
  "settings.view",
] as const;

export function canGenerateDiagnosticReport(
  auth: Pick<AuthContextValue, "hasAnyPermission">,
  scope: DiagnosticScope
): boolean {
  switch (scope) {
    case "SYSTEM":
      return auth.hasAnyPermission([...DIAGNOSTIC_REPORT_BASE_PERMISSIONS]);
    case "PRODUCT_ENGINEERING":
      return auth.hasAnyPermission([...PRODUCTION_COST_TABLE_VIEW_PERMISSIONS]);
    case "PUBLISHED_PRICE":
      return auth.hasAnyPermission(["pricing.view", "settings.price_tables.view"]);
    case "COMMISSION_RECEIPT_CLOSING":
      return auth.hasAnyPermission([...COMMISSIONS_AUDIT_VIEW_PERMISSIONS]);
    case "SALES_ORDER":
    case "COST_TO_CASH":
      return auth.hasAnyPermission([...DIAGNOSTIC_REPORT_BASE_PERMISSIONS]);
    default:
      return auth.hasAnyPermission([...DIAGNOSTIC_REPORT_BASE_PERMISSIONS]);
  }
}
