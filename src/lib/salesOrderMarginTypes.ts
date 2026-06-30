/**
 * Contrato do motor único de margem de venda (Pedidos de Venda e consumidores).
 * Tipos puros — sem Prisma, sem React.
 */

export type SalesOrderMarginStatus =
  | "OK"
  | "SEM_PRODUTO_VINCULADO"
  | "SEM_CUSTO"
  | "RECEITA_INVALIDA"
  | "CUSTO_ZERO"
  | "ITEM_CANCELADO"
  | "MARGEM_NEGATIVA"
  | "REVISAR_DADOS";

export type SalesOrderMarginSummaryStatus = SalesOrderMarginStatus | "PARTIAL" | "OK";

export type SalesOrderMarginCostCoverageStatus = "FULL" | "PARTIAL" | "NONE";

/** Cobertura da receita vendida usada no cálculo de margem agregada. */
export type SalesOrderMarginCoveragePayload = {
  totalSalesRevenueInScope: number;
  marginRevenueCovered: number;
  marginRevenueUncovered: number;
  marginCoveragePercent: number | null;
  itemsTotal: number;
  itemsWithCost: number;
  itemsWithoutCost: number;
  costCoverageStatus: SalesOrderMarginCostCoverageStatus;
};

export type SalesOrderCostSource =
  | "SALES_ORDER_ITEM_SNAPSHOT"
  | "HISTORICAL_SNAPSHOT"
  | "LIVE_PRODUCT_COST"
  | "RECALCULATED_CURRENT_COST"
  | "OFFICIAL_FINAL_COST"
  | "CURRENT_ENGINEERING_COST"
  | "CURRENT_COST"
  | "MANUAL_COST"
  | "MISSING_COST";

/** Classificação interna da margem quanto ao congelamento do custo (payload/API). */
export type SalesOrderMarginCostMode = "HISTORICAL_FROZEN" | "LIVE_ESTIMATE" | "MISSING";

export type SalesOrderCostConfidence = "HIGH" | "MEDIUM" | "LOW" | "MISSING";

export type SalesOrderMarginStatusSeverity = "success" | "warning" | "danger" | "neutral";

export type SalesOrderMarginItemInput = {
  salesOrderItemId?: string;
  productId?: string | null;
  externalProductId?: string | number | null;
  productSku?: string | null;
  productCode?: string | null;
  productName?: string | null;

  quantity: number;
  netUnitPrice?: number | null;
  netTotalValue?: number | null;

  itemStatus?: string | number | null;
  isCanceled?: boolean;

  unitCost?: number | null;
  costSource?: SalesOrderCostSource;
  costConfidence?: SalesOrderCostConfidence;
  marginCostMode?: SalesOrderMarginCostMode;
};

export type SalesOrderMarginItemResult = {
  salesOrderItemId?: string;
  productId?: string | null;
  productSku?: string | null;
  productName?: string | null;

  quantity: number;

  netUnitRevenue: number | null;
  netRevenue: number;

  unitCost: number | null;
  totalCost: number | null;

  marginValue: number | null;
  marginPercent: number | null;
  markup: number | null;

  status: SalesOrderMarginStatus;
  statusLabel: string;
  statusSeverity: SalesOrderMarginStatusSeverity;

  costSource: SalesOrderCostSource;
  costConfidence: SalesOrderCostConfidence;
  /** Indica se a margem usa custo congelado da linha ou estimativa atual. */
  marginCostMode?: SalesOrderMarginCostMode;

  notes: string[];
};

export type SalesOrderMarginSummary = SalesOrderMarginCoveragePayload & {
  itemsCount: number;
  validItemsCount: number;
  ignoredItemsCount: number;

  netRevenue: number;
  totalCost: number;
  marginValue: number;
  marginPercent: number | null;
  markup: number | null;

  hasMissingCost: boolean;
  hasMissingProduct: boolean;
  hasNegativeMargin: boolean;
  hasInvalidRevenue: boolean;

  status: SalesOrderMarginSummaryStatus;
};

/** Payload de margem por item exposto nos endpoints internos de Pedidos de Venda. */
export type SalesOrderItemMarginPayload = {
  netRevenue: number;
  unitCost: number | null;
  totalCost: number | null;
  marginValue: number | null;
  marginPercent: number | null;
  markup: number | null;
  status: SalesOrderMarginStatus;
  statusLabel: string;
  statusSeverity: SalesOrderMarginStatusSeverity;
  costSource: SalesOrderCostSource;
  costConfidence: SalesOrderCostConfidence;
  /** Indica se a margem usa custo congelado da linha ou estimativa atual. */
  marginCostMode?: SalesOrderMarginCostMode;
  productResolutionSource:
    | "LOCAL_PRODUCT_ID"
    | "EXTERNAL_PRODUCT_ID"
    | "SKU"
    | "RAW_NOMUS_CODE"
    | "NOT_FOUND";
  notes: string[];
};

/** Payload consolidado de margem por pedido nos endpoints internos. */
export type SalesOrderMarginSummaryPayload = SalesOrderMarginCoveragePayload & {
  netRevenue: number;
  totalCost: number;
  marginValue: number;
  marginPercent: number | null;
  markup: number | null;
  itemsCount: number;
  validItemsCount: number;
  ignoredItemsCount: number;
  hasMissingCost: boolean;
  hasMissingProduct: boolean;
  hasNegativeMargin: boolean;
  hasInvalidRevenue: boolean;
  status: SalesOrderMarginSummaryStatus;
  statusLabel: string;
  statusSeverity: SalesOrderMarginStatusSeverity;
};
