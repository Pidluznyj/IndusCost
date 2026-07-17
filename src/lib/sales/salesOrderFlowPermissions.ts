/**
 * OP-63 — Matriz canônica de recursos do Fluxo de Pedidos.
 *
 * Reutiliza recursos oficiais de produção, fiscal e financeiro. Recursos
 * específicos existem apenas onde o Fluxo possui uma superfície própria.
 */

import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  COMMERCIAL_ACTIONS,
  COMMERCIAL_RESOURCE_KEYS,
} from "@/src/lib/commercialAccess.js";
import { FINANCE_MODULE_RESOURCE_KEYS } from "@/src/lib/financeModulesAccess.js";
import {
  OPERATIONS_ACTIONS,
  OPERATIONS_RESOURCE_KEYS,
} from "@/src/lib/operationsAccess.js";
import { authorizeRequireResource } from "@/src/lib/security/requireResource.js";

export type SalesOrderFlowResourceRequirement = {
  resourceKey: string;
  action: string;
};

export const SALES_ORDER_FLOW_RESOURCE_MATRIX = {
  kanban: {
    resourceKey: COMMERCIAL_RESOURCE_KEYS.salesOrdersFlow,
    action: COMMERCIAL_ACTIONS.view,
  },
  values: {
    resourceKey: COMMERCIAL_RESOURCE_KEYS.salesOrdersFlowValues,
    action: COMMERCIAL_ACTIONS.view,
  },
  production: {
    resourceKey: OPERATIONS_RESOURCE_KEYS.productionOrders,
    action: OPERATIONS_ACTIONS.view,
  },
  fiscal: {
    resourceKey: COMMERCIAL_RESOURCE_KEYS.salesOrdersInvoice,
    action: COMMERCIAL_ACTIONS.view,
  },
  financial: {
    resourceKey: FINANCE_MODULE_RESOURCE_KEYS.salesOrders,
    action: COMMERCIAL_ACTIONS.view,
  },
  inconsistencies: {
    resourceKey: COMMERCIAL_RESOURCE_KEYS.salesOrdersFlowInconsistencies,
    action: COMMERCIAL_ACTIONS.view,
  },
  timeline: {
    resourceKey: COMMERCIAL_RESOURCE_KEYS.salesOrdersFlowTimeline,
    action: COMMERCIAL_ACTIONS.view,
  },
  manualUpdate: {
    resourceKey: COMMERCIAL_RESOURCE_KEYS.salesOrdersFlowManagement,
    action: COMMERCIAL_ACTIONS.manage,
  },
  priority: {
    resourceKey: COMMERCIAL_RESOURCE_KEYS.salesOrdersFlowPriority,
    action: COMMERCIAL_ACTIONS.manage,
  },
  responsibility: {
    resourceKey: COMMERCIAL_RESOURCE_KEYS.salesOrdersFlowResponsibility,
    action: COMMERCIAL_ACTIONS.manage,
  },
  blocking: {
    resourceKey: COMMERCIAL_RESOURCE_KEYS.salesOrdersFlowBlocking,
    action: COMMERCIAL_ACTIONS.manage,
  },
  rebuild: {
    resourceKey: COMMERCIAL_RESOURCE_KEYS.salesOrdersFlowRebuild,
    action: COMMERCIAL_ACTIONS.execute,
  },
} as const satisfies Record<string, SalesOrderFlowResourceRequirement>;

export type SalesOrderFlowCapabilities = {
  canViewKanban: boolean;
  canViewValues: boolean;
  canViewProduction: boolean;
  canViewFiscal: boolean;
  canViewFinancial: boolean;
  canViewInconsistencies: boolean;
  canViewTimeline: boolean;
  canUpdateManually: boolean;
  canChangePriority: boolean;
  canAssignResponsible: boolean;
  canManageBlocking: boolean;
  canExecuteRebuild: boolean;
};

function allowed(
  user: AppAuthContext,
  requirement: SalesOrderFlowResourceRequirement
): boolean {
  return authorizeRequireResource(
    user,
    requirement.resourceKey,
    requirement.action,
    { legacyCompatMode: true }
  ).ok;
}

export function resolveSalesOrderFlowCapabilities(
  user: AppAuthContext
): SalesOrderFlowCapabilities {
  return {
    canViewKanban: allowed(user, SALES_ORDER_FLOW_RESOURCE_MATRIX.kanban),
    canViewValues: allowed(user, SALES_ORDER_FLOW_RESOURCE_MATRIX.values),
    canViewProduction: allowed(
      user,
      SALES_ORDER_FLOW_RESOURCE_MATRIX.production
    ),
    canViewFiscal: allowed(user, SALES_ORDER_FLOW_RESOURCE_MATRIX.fiscal),
    canViewFinancial: allowed(
      user,
      SALES_ORDER_FLOW_RESOURCE_MATRIX.financial
    ),
    canViewInconsistencies: allowed(
      user,
      SALES_ORDER_FLOW_RESOURCE_MATRIX.inconsistencies
    ),
    canViewTimeline: allowed(
      user,
      SALES_ORDER_FLOW_RESOURCE_MATRIX.timeline
    ),
    canUpdateManually: allowed(
      user,
      SALES_ORDER_FLOW_RESOURCE_MATRIX.manualUpdate
    ),
    canChangePriority: allowed(
      user,
      SALES_ORDER_FLOW_RESOURCE_MATRIX.priority
    ),
    canAssignResponsible: allowed(
      user,
      SALES_ORDER_FLOW_RESOURCE_MATRIX.responsibility
    ),
    canManageBlocking: allowed(
      user,
      SALES_ORDER_FLOW_RESOURCE_MATRIX.blocking
    ),
    canExecuteRebuild: allowed(
      user,
      SALES_ORDER_FLOW_RESOURCE_MATRIX.rebuild
    ),
  };
}

/**
 * Requisitos adicionais por campo do PATCH. O recurso manualUpdate continua
 * obrigatório na rota; estes requisitos impedem elevação entre ações.
 */
export function resolveSalesOrderFlowManagementRequirements(
  body: unknown
): SalesOrderFlowResourceRequirement[] {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return [];
  }
  const keys = new Set(Object.keys(body as Record<string, unknown>));
  const requirements: SalesOrderFlowResourceRequirement[] = [];

  if (keys.has("priority")) {
    requirements.push(SALES_ORDER_FLOW_RESOURCE_MATRIX.priority);
  }
  if (keys.has("responsibleUserId") || keys.has("responsibleArea")) {
    requirements.push(SALES_ORDER_FLOW_RESOURCE_MATRIX.responsibility);
  }
  if (
    keys.has("isBlocked") ||
    keys.has("blockReason") ||
    keys.has("expectedResolutionAt")
  ) {
    requirements.push(SALES_ORDER_FLOW_RESOURCE_MATRIX.blocking);
  }

  return requirements;
}
