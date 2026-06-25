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

export type SalesOrderCostSource =
  | "HISTORICAL_SNAPSHOT"
  | "OFFICIAL_FINAL_COST"
  | "CURRENT_ENGINEERING_COST"
  | "CURRENT_COST"
  | "MANUAL_COST"
  | "MISSING_COST";

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

  notes: string[];
};

export type SalesOrderMarginSummary = {
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
