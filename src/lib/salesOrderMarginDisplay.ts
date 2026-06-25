/**
 * Formatação e labels de exibição de margem de Pedidos de Venda.
 * Sem cálculo de margem — apenas apresentação do payload do backend.
 */
import { formatCurrency, formatNumber } from "./utils.js";
import type {
  SalesOrderCostSource,
  SalesOrderItemMarginPayload,
  SalesOrderMarginStatusSeverity,
  SalesOrderMarginSummaryPayload,
  SalesOrderMarginSummaryStatus,
} from "./salesOrderMarginTypes.js";

export function formatSalesOrderMarginMoney(value: unknown): string {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return formatCurrency(n, 2);
}

export function formatSalesOrderMarginPercent(value: unknown): string {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${formatNumber(n, 2)}%`;
}

export function formatSalesOrderMarkup(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return `${formatNumber(n, 2)}x`;
}

export const SALES_ORDER_COST_SOURCE_LABEL: Record<SalesOrderCostSource, string> = {
  OFFICIAL_FINAL_COST: "Custo oficial da engenharia",
  CURRENT_ENGINEERING_COST: "Custo parcial da engenharia",
  CURRENT_COST: "Custo atual do cadastro",
  HISTORICAL_SNAPSHOT: "Snapshot histórico de custo",
  MANUAL_COST: "Custo manual",
  MISSING_COST: "Custo indisponível",
};

export function formatSalesOrderCostSourceLabel(
  source: SalesOrderCostSource | undefined | null
): string {
  if (!source) return "—";
  return SALES_ORDER_COST_SOURCE_LABEL[source] ?? source;
}

export function resolveSalesOrderMarginSupportText(
  summary?: Pick<SalesOrderMarginSummaryPayload, "status"> | null,
  itemMargins?: Array<Pick<SalesOrderItemMarginPayload, "costSource"> | undefined>
): string {
  const sources = new Set(
    (itemMargins ?? [])
      .map((row) => row?.costSource)
      .filter((s): s is SalesOrderCostSource => Boolean(s))
  );

  if (sources.has("HISTORICAL_SNAPSHOT")) {
    return "Margem calculada com base em snapshot histórico de custo do produto.";
  }
  if (sources.has("CURRENT_ENGINEERING_COST")) {
    return "Margem calculada com custo parcial da engenharia de produtos (BOM incompleta).";
  }
  if (sources.has("OFFICIAL_FINAL_COST") || sources.size === 0) {
    return "Margem calculada com base no custo oficial atual do produto no IndusCost.";
  }
  if (sources.has("CURRENT_COST")) {
    return "Margem calculada com base no custo atual do cadastro do produto.";
  }
  if (summary?.status === "SEM_CUSTO" || sources.has("MISSING_COST")) {
    return "Margem incompleta: há itens sem custo oficial disponível.";
  }
  return "Margem calculada com base no custo oficial atual do produto no IndusCost.";
}

export function salesOrderMarginSeverityBadgeClass(
  severity: SalesOrderMarginStatusSeverity | undefined
): string {
  switch (severity) {
    case "success":
      return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300";
    case "danger":
      return "bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300";
    case "warning":
      return "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200";
    case "neutral":
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function salesOrderMarginSummaryStatusBadgeClass(
  status: SalesOrderMarginSummaryStatus | undefined
): string {
  switch (status) {
    case "OK":
      return salesOrderMarginSeverityBadgeClass("success");
    case "MARGEM_NEGATIVA":
    case "RECEITA_INVALIDA":
      return salesOrderMarginSeverityBadgeClass("danger");
    case "PARTIAL":
    case "SEM_CUSTO":
    case "SEM_PRODUTO_VINCULADO":
    case "CUSTO_ZERO":
      return salesOrderMarginSeverityBadgeClass("warning");
    case "REVISAR_DADOS":
    case "ITEM_CANCELADO":
      return salesOrderMarginSeverityBadgeClass("neutral");
    default:
      return salesOrderMarginSeverityBadgeClass("neutral");
  }
}

export function buildSalesOrderMarginAlerts(
  summary?: SalesOrderMarginSummaryPayload | null
): string[] {
  if (!summary) return [];
  const alerts: string[] = [];
  if (summary.hasMissingCost) {
    alerts.push(
      "Este pedido possui itens sem custo cadastrado. A margem pode estar incompleta."
    );
  }
  if (summary.hasMissingProduct) {
    alerts.push(
      "Existem itens do Nomus sem vínculo com produto local. Revise o cadastro para calcular margem."
    );
  }
  if (summary.hasNegativeMargin) {
    alerts.push(
      "Atenção: este pedido possui item vendido abaixo do custo estimado."
    );
  }
  if (summary.hasInvalidRevenue) {
    alerts.push("Há itens com receita líquida inválida. Revise os dados do pedido.");
  }
  return alerts;
}

export function pickSalesOrderListMarginPercent(
  summary?: SalesOrderMarginSummaryPayload | null,
  legacyPercent?: unknown
): string {
  if (summary?.marginPercent != null && Number.isFinite(summary.marginPercent)) {
    return formatSalesOrderMarginPercent(summary.marginPercent);
  }
  if (legacyPercent == null || legacyPercent === "") return "—";
  const legacy = Number(legacyPercent);
  if (Number.isFinite(legacy)) return formatSalesOrderMarginPercent(legacy);
  return "—";
}

export function pickSalesOrderListMarginValue(
  summary?: SalesOrderMarginSummaryPayload | null,
  legacyValue?: unknown
): string {
  if (summary && Number.isFinite(summary.marginValue)) {
    return formatSalesOrderMarginMoney(summary.marginValue);
  }
  if (legacyValue == null || legacyValue === "") return "—";
  const legacy = Number(legacyValue);
  if (Number.isFinite(legacy)) return formatSalesOrderMarginMoney(legacy);
  return "—";
}
