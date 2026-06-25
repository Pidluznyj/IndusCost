import type {
  SalesOrderMarginItemInput,
  SalesOrderMarginStatus,
  SalesOrderMarginStatusSeverity,
} from "./salesOrderMarginTypes.js";

export const SALES_ORDER_MARGIN_STATUS_LABEL: Record<SalesOrderMarginStatus, string> = {
  OK: "Margem calculada",
  SEM_PRODUTO_VINCULADO: "Sem produto vinculado",
  SEM_CUSTO: "Custo indisponível",
  RECEITA_INVALIDA: "Receita líquida inválida",
  CUSTO_ZERO: "Custo zerado",
  ITEM_CANCELADO: "Item cancelado",
  MARGEM_NEGATIVA: "Margem negativa",
  REVISAR_DADOS: "Revisar dados",
};

export const SALES_ORDER_MARGIN_STATUS_SEVERITY: Record<
  SalesOrderMarginStatus,
  SalesOrderMarginStatusSeverity
> = {
  OK: "success",
  SEM_PRODUTO_VINCULADO: "warning",
  SEM_CUSTO: "warning",
  RECEITA_INVALIDA: "danger",
  CUSTO_ZERO: "warning",
  ITEM_CANCELADO: "neutral",
  MARGEM_NEGATIVA: "danger",
  REVISAR_DADOS: "warning",
};

/** Status de item que não entram na margem consolidada ponderada. */
export const SALES_ORDER_MARGIN_CONSOLIDATION_EXCLUDED: ReadonlySet<SalesOrderMarginStatus> =
  new Set([
    "ITEM_CANCELADO",
    "RECEITA_INVALIDA",
    "SEM_CUSTO",
    "CUSTO_ZERO",
    "SEM_PRODUTO_VINCULADO",
    "REVISAR_DADOS",
  ]);

const CANCELED_STATUS_TOKENS = new Set([
  "CANCELADO",
  "CANCELADA",
  "CANCELLED",
  "CANCELED",
  "ANULADO",
  "ANULADA",
]);

export function resolveSalesOrderMarginStatusMeta(status: SalesOrderMarginStatus): {
  statusLabel: string;
  statusSeverity: SalesOrderMarginStatusSeverity;
} {
  return {
    statusLabel: SALES_ORDER_MARGIN_STATUS_LABEL[status],
    statusSeverity: SALES_ORDER_MARGIN_STATUS_SEVERITY[status],
  };
}

export function isSalesOrderMarginItemCanceled(input: SalesOrderMarginItemInput): boolean {
  if (input.isCanceled === true) return true;
  if (input.itemStatus == null || input.itemStatus === "") return false;
  const raw = String(input.itemStatus).trim().toUpperCase();
  return CANCELED_STATUS_TOKENS.has(raw);
}

export function hasSalesOrderMarginProductLink(input: SalesOrderMarginItemInput): boolean {
  if (input.productId) return true;
  if (input.externalProductId != null && String(input.externalProductId).trim() !== "") return true;
  if (input.productSku?.trim()) return true;
  if (input.productCode?.trim()) return true;
  return false;
}

export function isSalesOrderMarginConsolidationEligible(status: SalesOrderMarginStatus): boolean {
  return !SALES_ORDER_MARGIN_CONSOLIDATION_EXCLUDED.has(status);
}
