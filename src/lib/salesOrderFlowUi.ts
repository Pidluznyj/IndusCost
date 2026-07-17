/**
 * Helpers browser-safe da tela Comercial → Fluxo de Pedidos (shell OP-64).
 */
import {
  COMMERCIAL_ACTIONS,
  COMMERCIAL_RESOURCE_KEYS,
} from "@/src/lib/commercialAccess.js";
import { HttpError } from "@/src/lib/http.js";
import type { PermissionChecker } from "@/src/lib/modulePermissions.js";

export const SALES_ORDER_FLOW_MODULE_ID = "sales-order-flow" as const;
export const SALES_ORDER_FLOW_ROUTE_PATH = "/commercial/sales-order-flow";
export const SALES_ORDER_FLOW_PAGE_TITLE = "Fluxo de Pedidos";
export const SALES_ORDER_FLOW_PAGE_SUBTITLE =
  "Kanban operacional dos pedidos de venda.";
export const SALES_ORDER_FLOW_BREADCRUMB = "Comercial / Fluxo de Pedidos";
export const SALES_ORDER_FLOW_VIEW_LEGACY_PERMISSION =
  "sales_orders.flow.view" as const;

export function canViewSalesOrderFlow(check: {
  canPerformAction?: (resourceKey: string, action: string) => boolean;
  hasPermission?: (permission: string) => boolean;
}): boolean {
  return Boolean(
    check.canPerformAction?.(
      COMMERCIAL_RESOURCE_KEYS.salesOrdersFlow,
      COMMERCIAL_ACTIONS.view
    ) || check.hasPermission?.(SALES_ORDER_FLOW_VIEW_LEGACY_PERMISSION)
  );
}

export function canAccessSalesOrderFlowModule(
  check: PermissionChecker
): boolean {
  return check.hasPermission(SALES_ORDER_FLOW_VIEW_LEGACY_PERMISSION);
}

export function classifySalesOrderFlowListError(error: unknown): {
  kind: "access_denied" | "feature_disabled" | "api_unavailable" | "generic";
  message: string;
} {
  if (error instanceof HttpError) {
    if (error.status === 403) {
      return {
        kind: "access_denied",
        message: "Você não possui permissão para consultar o Fluxo de Pedidos.",
      };
    }
    if (error.status === 404) {
      return {
        kind: "feature_disabled",
        message: "Fluxo de Pedidos não está habilitado neste ambiente.",
      };
    }
    if (error.status >= 500 || error.status === 0) {
      return {
        kind: "api_unavailable",
        message:
          "API do Fluxo de Pedidos indisponível. Tente novamente em instantes.",
      };
    }
    return {
      kind: "generic",
      message: error.message || "Erro ao carregar o Fluxo de Pedidos.",
    };
  }
  if (error instanceof TypeError) {
    return {
      kind: "api_unavailable",
      message:
        "API do Fluxo de Pedidos indisponível. Tente novamente em instantes.",
    };
  }
  return {
    kind: "generic",
    message:
      error instanceof Error
        ? error.message
        : "Erro ao carregar o Fluxo de Pedidos.",
  };
}
