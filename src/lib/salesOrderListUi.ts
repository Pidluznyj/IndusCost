/**
 * Formatação e labels da listagem de Pedidos de Venda — apenas apresentação.
 */
import type { PermissionChecker } from "./modulePermissions.js";
import { formatCompactCurrency, formatFullCurrency } from "./formatFinancialMetric.js";

import type {
  SalesOrderItemMarginPayload,
  SalesOrderMarginSummaryPayload,
} from "./salesOrderMarginTypes.js";
export const SALES_ORDER_MARGIN_ECONOMICS_PERMISSIONS = [
  "products.tab.cost",
  "costs.view",
] as const;

/** Acesso à tela Comercial → Pedidos de Venda (listagem, gráficos e Resultado). */
export const SALES_ORDER_MODULE_VIEW_PERMISSIONS = ["sales_orders.view"] as const;

export function canViewSalesOrderModule(check: PermissionChecker): boolean {
  return SALES_ORDER_MODULE_VIEW_PERMISSIONS.some((key) => check.hasPermission(key));
}

export function canViewSalesOrderMarginEconomics(check: PermissionChecker): boolean {
  return SALES_ORDER_MARGIN_ECONOMICS_PERMISSIONS.some((key) => check.hasPermission(key));
}

export const SALES_ORDER_LIST_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Rascunho",
  READY_TO_SEND: "Pronto para envio",
  SENT_TO_NOMUS: "Enviado ao Nomus",
  CANCELLED: "Cancelado",
  ERROR: "Erro",
};

export function formatSalesOrderDisplayCode(code: string | null | undefined): string {
  if (!code?.trim()) return "—";
  const normalized = code.trim().replace(/\s+/g, " ");
  const pdMatch = normalized.match(/^PD[-\s]?(\d+)$/i);
  if (pdMatch) {
    return `PD ${pdMatch[1]}`;
  }
  return normalized;
}

export function formatSalesOrderListIssueDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("pt-BR");
}

export function formatSalesOrderListNetValue(value: unknown): {
  display: string;
  title: string;
} {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return { display: "—", title: "—" };
  }
  const compact = formatCompactCurrency(n);
  const full = formatFullCurrency(n);
  return {
    display: compact,
    title: full,
  };
}

export function formatSalesOrderListItemsCount(count: number | null | undefined): {
  display: string;
  title: string;
} {
  if (count == null || !Number.isFinite(count)) {
    return { display: "—", title: "Itens não informados" };
  }
  const label = `${count} item${count === 1 ? "" : "s"}`;
  return {
    display: String(count),
    title: `${label} no pedido`,
  };
}

export function resolveSalesOrderListCustomerName(input: {
  companyName?: string | null;
  tradeName?: string | null;
}): string {
  const name = input.tradeName?.trim() || input.companyName?.trim();
  return name || "Cliente não informado";
}

export function buildSalesOrderListCustomerMeta(input: {
  proposalNumber?: number | null;
  externalProposalCode?: string | null;
}): string | null {
  const parts: string[] = [];
  if (input.proposalNumber != null && Number.isFinite(input.proposalNumber)) {
    parts.push(`Proposta #${input.proposalNumber}`);
  }
  if (input.externalProposalCode?.trim()) {
    parts.push(`Nomus CP ${input.externalProposalCode.trim()}`);
  }
  if (parts.length === 0) return null;
  return parts.join(" · ");
}

export function resolveSalesOrderListMarginTextClass(
  summary: SalesOrderMarginSummaryPayload | null | undefined
): string {
  if (!summary) return "text-muted-foreground";
  if (summary.hasNegativeMargin || summary.status === "MARGEM_NEGATIVA") {
    return "text-red-700 dark:text-red-400 font-semibold";
  }
  if (
    summary.hasMissingCost ||
    summary.hasMissingProduct ||
    summary.status === "SEM_CUSTO" ||
    summary.status === "SEM_PRODUTO_VINCULADO" ||
    summary.status === "PARTIAL"
  ) {
    return "text-amber-800 dark:text-amber-300 font-medium";
  }
  if (summary.status === "OK") {
    return "text-emerald-800 dark:text-emerald-300 font-semibold";
  }
  return "text-foreground font-medium";
}

export type SalesOrderMarginTooltipProps = {
  summary?: SalesOrderMarginSummaryPayload | null;
  itemMargins?: Array<Pick<SalesOrderItemMarginPayload, "costSource"> | null | undefined>;
};

export {
  buildOfficialSalesOrderMarginTooltipText,
  buildSalesOrderMarginTooltipText,
} from "./salesOrderMarginDisplay.js";
