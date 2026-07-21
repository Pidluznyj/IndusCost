/**
 * OP-02 — Tipos do motor canônico operacional de Pedidos de Venda.
 *
 * Contexto:
 * - OPERATIONAL: exclusão de MISSING_CONFIRMED (flag) — telas, cards, PDFs, Excel, dashboards.
 * - HISTORICAL_AUDIT: inclui MISSING_CONFIRMED — detalhe por ID, auditoria, investigação.
 *
 * O frontend NÃO escolhe o contexto por query param; o servidor decide.
 */

export type SalesOrderOperationalContext = "OPERATIONAL" | "HISTORICAL_AUDIT";

/** Definições oficiais das métricas (documentação viva). */
export const SALES_ORDER_OPERATIONAL_METRIC_DEFINITIONS = {
  orderCount:
    "count de SalesOrder IDs únicos da população operacional",
  soldAmount:
    "soma de SalesOrder.totalNetValue de cada SalesOrder único (valor comercial oficial)",
  itemCount:
    "soma de SalesOrder.totalItems dos pedidos únicos (regra da listagem)",
  averageTicket:
    "soldAmount / orderCount (computeTicketAverage)",
  invoicedNfeAmount:
    "soma de NF válidas vinculadas, agregadas por salesOrderId antes da combinação",
  balanceToInvoice:
    "max(0, soldAmount do pedido − total NF válida do pedido)",
  margin:
    "fórmula canônica do motor de margem (salesMarginRulesEngine) — não recalcular fora dele",
} as const;

export type SalesOrderOperationalMetricKey =
  keyof typeof SALES_ORDER_OPERATIONAL_METRIC_DEFINITIONS;

export type SalesOrderOperationalPopulationObservability = {
  context: SalesOrderOperationalContext;
  populationCount: number;
  uniqueIdCount: number;
  beforePresenceCount: number | null;
  afterPresenceCount: number | null;
  excludedMissingConfirmedCount: number | null;
  itemCount: number | null;
  nfeCount: number | null;
  receivableCount: number | null;
  elapsedMs: number | null;
  filtersApplied: Record<string, unknown>;
};

export type SalesOrderOperationalOrderFact = {
  salesOrderId: string;
  totalNetValue: number;
  totalItems: number;
  invoicedNfeAmount: number;
  receivableOpenAmount?: number;
  receivableSettledAmount?: number;
};

export type SalesOrderOperationalMetrics = {
  orderCount: number;
  soldAmount: number;
  itemCount: number;
  averageTicket: number;
  invoicedNfeAmount: number;
  balanceToInvoice: number;
};
