/**
 * Formatação e labels da listagem de Pedidos de Venda — apenas apresentação.
 */
import type { PermissionChecker } from "./modulePermissions.js";
import { formatCompactCurrency, formatFullCurrency } from "./formatFinancialMetric.js";
import {
  formatSalesOrderMarginMoney,
  formatSalesOrderMarginPercent,
} from "./salesOrderMarginDisplay.js";
import type { SalesOrderMarginSummaryPayload } from "./salesOrderMarginTypes.js";

/** Permissões que liberam margem/custo na listagem (dados internos de engenharia). */
export const SALES_ORDER_MARGIN_ECONOMICS_PERMISSIONS = [
  "products.tab.cost",
  "costs.view",
] as const;

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

export function buildSalesOrderMarginTooltipText(
  summary: SalesOrderMarginSummaryPayload | null | undefined
): string {
  if (!summary) {
    return "Margem do pedido\n\nMargem não calculada para este pedido.";
  }

  const lines: string[] = [
    "Margem do pedido",
    "",
    "Receita líquida: valor líquido vendido do pedido.",
    "Custo estimado: soma do custo oficial atual dos produtos vinculados aos itens.",
    "Margem R$: Receita líquida − Custo estimado.",
    "Margem %: Margem R$ ÷ Receita líquida.",
    "",
    "A margem percentual do pedido é ponderada pelo valor da receita, não é média simples das margens dos itens.",
    "",
    `Receita líquida: ${formatSalesOrderMarginMoney(summary.netRevenue)}`,
    `Custo estimado: ${formatSalesOrderMarginMoney(summary.totalCost)}`,
    `Margem R$: ${formatSalesOrderMarginMoney(summary.marginValue)}`,
    `Margem %: ${formatSalesOrderMarginPercent(summary.marginPercent)}`,
  ];

  if (
    Number.isFinite(summary.netRevenue) &&
    Number.isFinite(summary.totalCost) &&
    summary.netRevenue > 0
  ) {
    lines.push(
      "",
      `Fórmula: (${formatSalesOrderMarginMoney(summary.netRevenue)} − ${formatSalesOrderMarginMoney(summary.totalCost)}) ÷ ${formatSalesOrderMarginMoney(summary.netRevenue)}`
    );
  }

  if (summary.hasMissingCost) {
    lines.push("", "Este pedido possui itens sem custo cadastrado. A margem pode estar incompleta.");
  }
  if (summary.hasMissingProduct) {
    lines.push(
      "",
      "Existem itens sem vínculo com produto local. Revise o cadastro para calcular a margem corretamente."
    );
  }
  if (summary.hasNegativeMargin) {
    lines.push("", "Atenção: o custo estimado é maior que a receita líquida do pedido.");
  }

  return lines.join("\n");
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
