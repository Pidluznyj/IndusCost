/**
 * Adapter OrderToCashAuditFact → PortfolioReconciliationFactApiRow.
 * Agrupa evidência item×doc sem somar CR linha a linha (CR só no 1º fato do pedido).
 * Mantém o motor de maturidade; não recalcula alocação.
 */

import type { PortfolioReconciliationFactApiRow } from "./portfolioReconciliationApi.js";
import type { PortfolioMaturityStatus } from "./portfolioMaturityClassification.js";
import type { PortfolioMaturityOrderRow } from "./portfolioMaturityAnalytics.js";

export const ORDER_TO_CASH_AUDIT_INTELLIGENCE_SOURCE = "order_to_cash_audit";

export const ORDER_TO_CASH_AUDIT_CHAIN_DISCLAIMER =
  "Pedido de venda não é caixa confirmado. CR confirma financeiro. Baixa confirma caixa.";

/** Fact O2C mínimo para o adapter (números já convertidos). */
export type OrderToCashAuditFactAdapterInput = {
  id: string;
  runId: string;
  salesOrderId: string | null;
  externalSalesOrderId: number | null;
  orderCode: string | null;
  orderIssueDate: Date | string | null;
  orderExpectedDeliveryDate: Date | string | null;
  orderNetValue: number | null;
  orderTotalValue?: number | null;
  customerId: string | null;
  externalCustomerId: number | null;
  customerName: string | null;
  sellerName?: string | null;
  externalSellerId?: string | null;
  paymentConditionName?: string | null;
  salesOrderItemId: string | null;
  externalSalesOrderItemId: number | null;
  externalProductId: number | null;
  productCode: string | null;
  sku: string | null;
  productName: string | null;
  orderedQuantity: number | null;
  orderUnitPrice: number | null;
  orderItemTotalValue: number | null;
  stockDocumentId: string | null;
  stockDocumentExternalId: number | null;
  stockDocumentItemId?: string | null;
  stockDocumentDate: Date | string | null;
  stockDocumentItemQuantity: number | null;
  stockDocumentItemUnitValue?: number | null;
  stockDocumentItemTotalValue?: number | null;
  quantityUsedForOrder: number | null;
  allocatedValueByOrderPrice: number | null;
  allocatedValueByDocumentPrice?: number | null;
  priceDifferenceValue?: number | null;
  nfeId?: string | null;
  nfeExternalId: number | null;
  nfeNumber: string | null;
  nfeSerie?: string | null;
  nfeKey?: string | null;
  nfeProcessedAt?: Date | string | null;
  nfeIssueDate?: Date | string | null;
  nfeHeaderValue: number | null;
  receivableIdsJson?: unknown;
  receivableTotalValue: number | null;
  receivableOpenValue: number | null;
  receivableReceivedValue: number | null;
  receivableDueDatesJson?: unknown;
  receivableSettlementDatesJson?: unknown;
  paymentDueDate?: Date | string | null;
  paymentSettlementDate?: Date | string | null;
  orderToCashStage: string | null;
  confidenceLabel: string | null;
  alertsJson: unknown;
  hasDeliveryDelay?: boolean;
  hasMissingStockDocument?: boolean;
  hasPartialFulfillment?: boolean;
  hasExcessQuantity?: boolean;
  hasProductOutsideOrder?: boolean;
  hasNfeHeaderGreaterThanOrder?: boolean;
  hasPriceMismatch?: boolean;
  hasDocumentWithoutReceivable?: boolean;
  hasPaymentConditionMissing?: boolean;
  hasOverdueReceivable?: boolean;
};

export function mapOrderToCashStageToMaturityStatus(
  stage: string | null | undefined
): PortfolioMaturityStatus | null {
  const s = String(stage ?? "")
    .trim()
    .toUpperCase();
  switch (s) {
    case "RECEBIDO":
      return "RECEBIDO";
    case "CR_ABERTO":
      return "CR_ABERTO";
    case "NF_SEM_CR":
      return "FATURADO_SEM_CR";
    case "PEDIDO_FUTURO_SAUDAVEL":
      return "CARTEIRA_FUTURA_PROVAVEL";
    case "PEDIDO_PROXIMO_ATENCAO":
      return "CARTEIRA_PRESENTE_ATENCAO";
    case "PEDIDO_ATRASADO_SEM_DOCUMENTO":
    case "BLOQUEADO_REVISAO":
      return "CARTEIRA_VENCIDA_BLOQUEADA";
    default:
      return null;
  }
}

function parseAlerts(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    try {
      return parseAlerts(JSON.parse(value));
    } catch {
      return value.trim() ? [value.trim()] : [];
    }
  }
  return [];
}

function collectAlerts(fact: OrderToCashAuditFactAdapterInput): string[] {
  const alerts = new Set(parseAlerts(fact.alertsJson));
  if (fact.hasDeliveryDelay) alerts.add("ENTREGA_PREVISTA_VENCIDA_SEM_DOCUMENTO");
  if (fact.hasMissingStockDocument) alerts.add("ENTREGA_PREVISTA_VENCIDA_SEM_DOCUMENTO");
  if (fact.hasPaymentConditionMissing) alerts.add("SEM_CONDICAO_PAGAMENTO");
  if (fact.hasPartialFulfillment) alerts.add("DOCUMENTO_PARCIAL");
  if (fact.hasExcessQuantity) alerts.add("DOCUMENTO_COM_EXCEDENTE");
  if (fact.hasNfeHeaderGreaterThanOrder) alerts.add("NF_CABECALHO_MAIOR_PEDIDO");
  if (fact.hasProductOutsideOrder) alerts.add("PRODUTO_FORA_DO_PEDIDO");
  if (fact.hasOverdueReceivable) alerts.add("CR_VENCIDO");
  if (fact.hasDocumentWithoutReceivable) alerts.add("DOCUMENTO_SEM_CR");
  if (fact.hasPriceMismatch) alerts.add("DIVERGENCIA_PRECO");
  return [...alerts];
}

function mapConfidence(label: string | null): string {
  const u = String(label ?? "")
    .trim()
    .toUpperCase();
  if (u === "ALTA" || u === "HIGH") return "HIGH";
  if (u === "MEDIA" || u === "MÉDIA" || u === "MEDIUM") return "MEDIUM";
  if (u === "BAIXA" || u === "LOW") return "LOW";
  if (u === "MUITO_BAIXA" || u === "BLOCKED") return "BLOCKED";
  return "MEDIUM";
}

function mapFactStatus(stage: string | null): string {
  const mapped = mapOrderToCashStageToMaturityStatus(stage);
  if (mapped === "RECEBIDO") return "RECEIVED";
  if (mapped === "CR_ABERTO") return "MATCHED";
  if (mapped === "FATURADO_SEM_CR") return "PARTIALLY_ALLOCATED";
  if (mapped === "CARTEIRA_FUTURA_PROVAVEL") return "ORDER_ONLY";
  if (mapped === "CARTEIRA_PRESENTE_ATENCAO") return "ORDER_ONLY";
  if (mapped === "CARTEIRA_VENCIDA_BLOQUEADA") return "ORDER_ONLY";
  return "ORDER_ONLY";
}

function orderKey(fact: OrderToCashAuditFactAdapterInput): string {
  return (
    fact.salesOrderId ??
    (fact.externalSalesOrderId != null
      ? `ext:${fact.externalSalesOrderId}`
      : fact.orderCode ?? fact.id)
  );
}

/**
 * Converte facts O2C → shape Portfolio.
 * CR/recebido/aberto ficam só no primeiro fato de cada pedido (evita duplicidade).
 */
export function adaptOrderToCashAuditFactsToPortfolioFacts(
  facts: readonly OrderToCashAuditFactAdapterInput[]
): PortfolioReconciliationFactApiRow[] {
  const crAssigned = new Set<string>();
  const out: PortfolioReconciliationFactApiRow[] = [];

  for (const fact of facts) {
    const key = orderKey(fact);
    const isFirstCrCarrier = !crAssigned.has(key);
    if (isFirstCrCarrier) crAssigned.add(key);

    const allocatedQty = fact.quantityUsedForOrder ?? fact.orderedQuantity ?? 0;
    const hasAlloc = allocatedQty > 0 || (fact.allocatedValueByOrderPrice ?? 0) > 0;
    const orderTotal = fact.orderNetValue ?? fact.orderTotalValue ?? null;

    out.push({
      id: fact.id,
      runId: fact.runId,
      customerId: fact.customerId,
      customerExternalId: fact.externalCustomerId,
      customerNameSnapshot: fact.customerName,
      salesOrderId: fact.salesOrderId,
      externalSalesOrderId: fact.externalSalesOrderId,
      orderCode: fact.orderCode,
      orderIssueDate: fact.orderIssueDate,
      expectedDeliveryDate: fact.orderExpectedDeliveryDate,
      salesOrderItemId: fact.salesOrderItemId,
      externalSalesOrderItemId: fact.externalSalesOrderItemId,
      externalProductId: fact.externalProductId,
      productSkuSnapshot: fact.sku ?? fact.productCode,
      productNameSnapshot: fact.productName,
      orderQuantity: fact.orderedQuantity,
      orderUnitPrice: fact.orderUnitPrice,
      orderItemValue: fact.orderItemTotalValue,
      nomusNfeId: fact.nfeId ?? null,
      nfeExternalId: fact.nfeExternalId,
      nfeNumber: fact.nfeNumber,
      nfeSerie: fact.nfeSerie ?? null,
      nfeKey: fact.nfeKey ?? null,
      nfeProcessedAt: fact.nfeProcessedAt ?? fact.nfeIssueDate ?? null,
      nfeHeaderValue: fact.nfeHeaderValue,
      stockDocumentId: fact.stockDocumentId,
      stockDocumentExternalId: fact.stockDocumentExternalId,
      stockDocumentItemId: fact.stockDocumentItemId ?? null,
      stockDocumentItemExternalId: null,
      stockDocumentDate: fact.stockDocumentDate,
      stockQuantity: fact.stockDocumentItemQuantity,
      stockUnitValue: fact.stockDocumentItemUnitValue ?? null,
      stockItemValue: fact.stockDocumentItemTotalValue ?? null,
      allocatedQuantity: hasAlloc ? allocatedQty || 1 : 0,
      allocatedValueByOrderPrice: fact.allocatedValueByOrderPrice,
      allocatedValueByStockPrice: fact.allocatedValueByDocumentPrice ?? null,
      remainingOrderQuantityAfterAllocation: null,
      remainingOrderValueAfterAllocation: null,
      priceDifferenceUnit: null,
      priceDifferenceTotal: fact.priceDifferenceValue ?? null,
      receivableIdsJson: isFirstCrCarrier ? fact.receivableIdsJson ?? null : null,
      receivableTotalValue: isFirstCrCarrier ? fact.receivableTotalValue : null,
      receivedValue: isFirstCrCarrier ? fact.receivableReceivedValue : null,
      openReceivableValue: isFirstCrCarrier ? fact.receivableOpenValue : null,
      dueDatesJson: isFirstCrCarrier
        ? fact.receivableDueDatesJson ??
          (fact.paymentDueDate ? [fact.paymentDueDate] : null)
        : null,
      settlementDatesJson: isFirstCrCarrier
        ? fact.receivableSettlementDatesJson ??
          (fact.paymentSettlementDate ? [fact.paymentSettlementDate] : null)
        : null,
      forecastSource: fact.paymentDueDate
        ? "RECEIVABLE"
        : fact.orderExpectedDeliveryDate
          ? "EXPECTED_DELIVERY"
          : "ORDER",
      forecastDate:
        fact.paymentDueDate ?? fact.orderExpectedDeliveryDate ?? fact.orderIssueDate,
      forecastValue: isFirstCrCarrier
        ? (fact.receivableOpenValue ?? fact.receivableTotalValue ?? orderTotal)
        : orderTotal,
      confidenceLevel: mapConfidence(fact.confidenceLabel),
      status: mapFactStatus(fact.orderToCashStage),
      alertsJson: collectAlerts(fact),
      traceJson: {
        source: ORDER_TO_CASH_AUDIT_INTELLIGENCE_SOURCE,
        orderToCashStage: fact.orderToCashStage,
        orderTotal,
        sellerName: fact.sellerName ?? null,
        paymentConditionName: fact.paymentConditionName ?? null,
        hasPaymentConditionMissing: Boolean(fact.hasPaymentConditionMissing),
      },
    });
  }

  return out;
}

export function readOrderToCashStageFromPortfolioFact(
  fact: PortfolioReconciliationFactApiRow
): string | null {
  const t = fact.traceJson;
  if (t && typeof t === "object" && !Array.isArray(t)) {
    const stage = (t as Record<string, unknown>).orderToCashStage;
    if (typeof stage === "string" && stage.trim()) return stage.trim();
  }
  return null;
}

/**
 * Preferência do estágio O2C materializado sobre a reclassificação heurística.
 */
export function applyOrderToCashStageStatusOverrides(
  rows: readonly PortfolioMaturityOrderRow[],
  facts: readonly PortfolioReconciliationFactApiRow[]
): PortfolioMaturityOrderRow[] {
  const stageByOrder = new Map<string, string>();
  for (const fact of facts) {
    const stage = readOrderToCashStageFromPortfolioFact(fact);
    if (!stage) continue;
    const key =
      fact.salesOrderId ??
      (fact.externalSalesOrderId != null
        ? `ext:${fact.externalSalesOrderId}`
        : fact.orderCode ?? fact.id);
    if (!stageByOrder.has(key)) stageByOrder.set(key, stage);
  }

  return rows.map((row) => {
    const key =
      row.salesOrderId ??
      (row.externalSalesOrderId != null
        ? `ext:${row.externalSalesOrderId}`
        : row.orderCode);
    const stage = stageByOrder.get(key) ?? null;
    const mapped = mapOrderToCashStageToMaturityStatus(stage);
    if (!mapped || mapped === row.statusPrincipal) return row;

    const tags = new Set(row.tagsAlerta);
    if (stage === "PEDIDO_ATRASADO_SEM_DOCUMENTO") {
      tags.add("PEDIDO_ANTIGO_SEM_EVOLUCAO");
    }
    if (stage === "NF_SEM_CR") tags.add("DOCUMENTO_SEM_CR");
    if (stage === "BLOQUEADO_REVISAO") tags.add("DIVERGENCIA_TECNICA");

    return {
      ...row,
      statusPrincipal: mapped,
      tagsAlerta: [...tags],
      mainReason: `${row.mainReason} · estágio O2C: ${stage}`,
    };
  });
}

/** Enrichments leves a partir dos próprios facts O2C (seller / condição). */
export function buildEnrichmentsFromOrderToCashFacts(
  facts: readonly OrderToCashAuditFactAdapterInput[]
): Map<
  string,
  {
    salesOrderId: string;
    sellerName: string | null;
    sellerExternalId: number | null;
    sellerId: string | null;
    paymentTerms: string | null;
    paymentMethod: string | null;
    orderValue: number | null;
    companyId: string | null;
    updatedAt: Date | string | null;
  }
> {
  const map = new Map<
    string,
    {
      salesOrderId: string;
      sellerName: string | null;
      sellerExternalId: number | null;
      sellerId: string | null;
      paymentTerms: string | null;
      paymentMethod: string | null;
      orderValue: number | null;
      companyId: string | null;
      updatedAt: Date | string | null;
    }
  >();

  for (const fact of facts) {
    if (!fact.salesOrderId) continue;
    if (map.has(fact.salesOrderId)) continue;
    const sellerExtRaw = fact.externalSellerId;
    const sellerExtNum =
      sellerExtRaw != null && /^\d+$/.test(String(sellerExtRaw).trim())
        ? Number(sellerExtRaw)
        : null;
    map.set(fact.salesOrderId, {
      salesOrderId: fact.salesOrderId,
      sellerName: fact.sellerName ?? null,
      sellerExternalId: sellerExtNum,
      sellerId: null,
      paymentTerms: fact.paymentConditionName ?? null,
      paymentMethod: null,
      orderValue: fact.orderNetValue ?? fact.orderTotalValue ?? null,
      companyId: null,
      updatedAt: null,
    });
  }
  return map;
}
