/**
 * Exclusão operacional: pedidos cancelados/erro e ausentes confirmados
 * não alimentam Contas a Receber (previsão FIN-08 nem CR vinculado).
 */
import {
  isNomusOpsExcludeMissingSalesOrdersEnabled,
  isNomusSourceOperationallyPresent,
  mergeSalesOrderOperationalPresenceWhere,
} from "./nomus/nomusSourcePresencePolicy.js";
import { isCancelledSalesOrderStatus } from "./salesOrderDashboardRules.js";
import { extractFinanceArOrderCodeHint } from "./financeAccountsReceivableTitles.js";

export const SALES_ORDER_STATUSES_EXCLUDED_FROM_OPERATIONAL_AR = [
  "CANCELLED",
  "ERROR",
] as const;

export function isSalesOrderStatusExcludedFromOperationalReceivables(
  status: string | null | undefined
): boolean {
  const normalized = (status ?? "").trim().toUpperCase();
  if (isCancelledSalesOrderStatus(normalized)) return true;
  return normalized === "ERROR";
}

/**
 * Pedido pode alimentar CR operacional / previsão FIN-08?
 * CANCELLED/ERROR: nunca.
 * MISSING_CONFIRMED: não, quando a flag de exclusão de pedidos está on.
 */
export function shouldIncludeSalesOrderInOperationalReceivables(input: {
  status?: string | null;
  sourcePresenceStatus?: string | null;
  env?: Record<string, string | undefined>;
}): boolean {
  if (isSalesOrderStatusExcludedFromOperationalReceivables(input.status)) {
    return false;
  }
  if (!isNomusOpsExcludeMissingSalesOrdersEnabled(input.env)) {
    return true;
  }
  return isNomusSourceOperationallyPresent(input.sourcePresenceStatus);
}

/** Prisma where fragment: exclui CANCELLED/ERROR + presença operacional de pedidos. */
export function buildSalesOrderExcludedFromOperationalArWhere(
  options?: {
    env?: Record<string, string | undefined>;
    includeConfirmedMissing?: boolean;
  }
): Record<string, unknown> {
  const statusWhere = {
    status: { notIn: [...SALES_ORDER_STATUSES_EXCLUDED_FROM_OPERATIONAL_AR] },
  };
  return mergeSalesOrderOperationalPresenceWhere(statusWhere, {
    env: options?.env,
    includeConfirmedMissing: options?.includeConfirmedMissing,
  }) as Record<string, unknown>;
}

export function normalizeFinanceArOrderCodeKey(
  orderCode: string | null | undefined
): string | null {
  const hint = extractFinanceArOrderCodeHint(orderCode);
  if (!hint) return null;
  return hint.replace(/\s+/g, " ").toUpperCase();
}

/** CR menciona Pedido excluído (descrição / orderCode enriquecido)? */
export function isFinanceArRowLinkedToExcludedOrderCode(
  row: {
    description?: string | null;
    orderCode?: string | null;
    comments?: string | null;
  },
  excludedOrderCodes: ReadonlySet<string>
): boolean {
  if (excludedOrderCodes.size === 0) return false;
  for (const part of [row.orderCode, row.description, row.comments]) {
    const key = normalizeFinanceArOrderCodeKey(part);
    if (key && excludedOrderCodes.has(key)) return true;
  }
  return false;
}

export function isFinanceArRowLinkedToExcludedInvoice(
  row: { sourceInvoiceId?: number | null },
  excludedInvoiceIds: ReadonlySet<number>
): boolean {
  if (row.sourceInvoiceId == null || excludedInvoiceIds.size === 0) return false;
  return excludedInvoiceIds.has(row.sourceInvoiceId);
}

export function isFinanceArExcludedByCancelledSalesOrder(
  row: {
    description?: string | null;
    orderCode?: string | null;
    comments?: string | null;
    sourceInvoiceId?: number | null;
  },
  exclusion: {
    invoiceIds: ReadonlySet<number>;
    orderCodes: ReadonlySet<string>;
  }
): boolean {
  if (isFinanceArRowLinkedToExcludedInvoice(row, exclusion.invoiceIds)) return true;
  if (isFinanceArRowLinkedToExcludedOrderCode(row, exclusion.orderCodes)) return true;
  return false;
}
