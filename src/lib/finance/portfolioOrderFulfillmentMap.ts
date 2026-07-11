/**
 * Order Fulfillment Map — motor puro read-only de atendimento item a item.
 *
 * Reutiliza `buildPortfolioReconciliationFacts` / alocação existente quando a entrada
 * traz pedido + documentos. Quando há fatos materializados, deriva o mapa deles
 * (não recalcula de forma contraditória).
 *
 * Cabeçalho de NF nunca aumenta valor atribuído ao pedido.
 * Excedente e produto fora do pedido ficam separados.
 *
 * Contrato: docs/finance/portfolio-order-fulfillment-map-requirements.md
 */

import {
  buildPortfolioReconciliationFacts,
  pricesMismatch,
  type PortfolioReconciliationSnapshot,
  type SnapshotNfe,
  type SnapshotNfeLink,
  type SnapshotOrder,
  type SnapshotOrderItem,
  type SnapshotStockDocument,
  type SnapshotStockItem,
} from "./portfolioReconciliationAllocationEngine.js";
import type { PortfolioReconciliationFactApiRow } from "./portfolioReconciliationApi.js";
import { parseAlertsJson } from "./portfolioReconciliationApi.js";
import {
  buildPortfolioReceivableTitleRows,
  portfolioFactDraftToApiRow,
} from "./portfolioReconciliationOrderTrace.js";

export type PortfolioFinancialStatus =
  | "FIN_RECEBIDO"
  | "FIN_CR_ABERTO"
  | "FIN_FATURADO_SEM_CR"
  | "FIN_SEM_CR";

export type PortfolioOperationalStatus =
  | "OP_TOTALMENTE_ATENDIDO"
  | "OP_TOTALMENTE_ATENDIDO_COM_EXCEDENTE"
  | "OP_PARCIALMENTE_ATENDIDO"
  | "OP_NAO_ATENDIDO"
  | "OP_DOCUMENTO_SEM_ITEMIZACAO"
  | "OP_VINCULO_APENAS_CABECALHO";

export type PortfolioTechnicalAlert =
  | "NF_CABECALHO_MAIOR_PEDIDO"
  | "DIVERGENCIA_PRECO"
  | "QUANTIDADE_EXCEDENTE_DOCUMENTO"
  | "PRODUTO_FORA_DO_PEDIDO"
  | "ITEM_DO_PEDIDO_NAO_ATENDIDO"
  | "CR_SEM_RATEIO_SEGURO"
  | "DOCUMENTO_SEM_CR"
  | "SEM_CONDICAO_PAGAMENTO"
  | "VINCULO_INCOMPLETO"
  | "DIVERGENCIA_TECNICA"
  | "NF_SEM_DOCUMENTO"
  | "PEDIDO_ANTIGO_SEM_EVOLUCAO";

export type FulfillmentOrderInput = {
  id: string;
  orderCode?: string | null;
  totalNetValue: number;
  externalSalesOrderId?: number | null;
  issueDate?: Date | string | null;
  customerNameSnapshot?: string | null;
};

export type FulfillmentOrderItemInput = {
  id: string;
  externalProductId: number;
  quantity: number;
  unitPrice: number;
  productSkuSnapshot?: string | null;
  productNameSnapshot?: string | null;
  totalNetValue?: number | null;
  externalSalesOrderItemId?: number | null;
};

export type FulfillmentNfeLinkInput = {
  salesOrderId: string;
  nfeExternalId: number;
  nfeNumber?: string | null;
  dataProcessamento?: Date | string | null;
};

export type FulfillmentNfeInput = {
  id?: string;
  externalId: number;
  numero?: string | null;
  valorLiquido?: number | null;
};

export type FulfillmentStockItemInput = {
  id: string;
  externalProductId: number;
  quantity: number;
  unitValue: number;
};

export type FulfillmentStockDocumentInput = {
  id: string;
  externalId: number;
  idNfe: number | null;
  dataDocumento?: Date | string | null;
  items: FulfillmentStockItemInput[];
};

export type FulfillmentReceivableInput = {
  receivableId?: number | null;
  dueDate?: string | null;
  settlementDate?: string | null;
  totalValue?: number | null;
  receivedValue?: number | null;
  openValue?: number | null;
  sourceNfe?: number | null;
};

export type BuildOrderFulfillmentMapInput = {
  order?: FulfillmentOrderInput | null;
  orderItems?: readonly FulfillmentOrderItemInput[];
  reconciliationFacts?: readonly PortfolioReconciliationFactApiRow[];
  nfeLinks?: readonly FulfillmentNfeLinkInput[];
  nfes?: readonly FulfillmentNfeInput[];
  stockDocuments?: readonly FulfillmentStockDocumentInput[];
  stockDocumentItems?: readonly (FulfillmentStockItemInput & {
    stockDocumentId?: string;
    stockDocumentExternalId?: number | null;
    nfeExternalId?: number | null;
  })[];
  receivables?: readonly FulfillmentReceivableInput[];
  /** Valor oficial do pedido quando não há `order.totalNetValue`. */
  orderValue?: number | null;
  paymentTermsAvailable?: boolean | null;
  runId?: string;
};

export type FulfillmentDocumentUsed = {
  nfeNumber: string | null;
  nfeExternalId: number | null;
  stockDocumentExternalId: number | null;
  allocatedQuantity: number;
};

export type OrderItemCoverageRow = {
  salesOrderItemId: string | null;
  externalProductId: number | null;
  /** Alias legado UI */
  productExternalId: number | null;
  productCode: string | null;
  description: string | null;
  orderedQuantity: number;
  attendedQuantityCapped: number;
  /** Alias legado UI */
  attendedQuantity: number;
  remainingQuantity: number;
  excessQuantityForThisProduct: number;
  fulfillmentPercentCapped: number | null;
  /** Alias legado UI */
  fulfillmentPercent: number | null;
  orderUnitValue: number;
  orderItemValue: number;
  attendedValueByOrderPrice: number;
  documentsUsed: FulfillmentDocumentUsed[];
  alerts: string[];
};

export type StockDocumentMatchedItem = {
  productExternalId: number | null;
  allocatedQuantity: number;
  allocatedValueByOrderPrice: number;
};

export type StockDocumentSurplusItem = {
  productExternalId: number | null;
  stockQuantity: number | null;
  stockItemValue: number | null;
};

export type StockDocumentOutsideItem = {
  productExternalId: number | null;
  stockQuantity: number | null;
  stockItemValue: number | null;
  reason: string;
};

export type StockDocumentCoverageRow = {
  nfeNumber: string | null;
  nfeExternalId: number | null;
  stockDocumentExternalId: number | null;
  date: string | null;
  nfeHeaderValue: number | null;
  documentTotalValue: number | null;
  valueAttributedToOrder: number;
  valueNotAttributedToOrder: number;
  matchedItems: StockDocumentMatchedItem[];
  surplusItems: StockDocumentSurplusItem[];
  itemsOutsideOrder: StockDocumentOutsideItem[];
  /** Alias legado */
  unmatchedItems: StockDocumentOutsideItem[];
  alerts: string[];
};

export type ReceivableCoverageRow = {
  receivableId: number | null;
  receivableIds: number[];
  dueDate: string | null;
  dueDates: string[];
  settlementDate: string | null;
  settlementDates: string[];
  totalValue: number | null;
  receivedValue: number | null;
  openValue: number | null;
  sourceNfe: number | null;
  attributionStatus: "ORDER_AGGREGATE" | "TITLE_IDS_ONLY" | "UNAVAILABLE";
};

export type FulfillmentSummary = {
  orderValue: number;
  attributedOrderValueByOrderPrice: number;
  /** Alias legado */
  attributedOrderValue: number;
  totalOrderedQuantity: number;
  /** Alias legado */
  totalOrderQuantity: number;
  totalAttendedQuantityCapped: number;
  /** Alias legado */
  attendedQuantity: number;
  totalRemainingQuantity: number;
  /** Alias legado */
  remainingQuantity: number;
  totalExcessQuantity: number;
  fulfillmentPercent: number | null;
  receivableTotalValue: number;
  /** Alias legado */
  receivableTotal: number;
  receivedValue: number;
  openReceivableValue: number;
  nfeHeaderTotalValue: number;
  /** Alias legado */
  nfeHeaderTotal: number;
  nfeHeaderAttributedToOrderValue: number;
  nfeHeaderNotAttributedToOrderValue: number;
  /** Alias legado */
  nfeHeaderNotAttributed: number;
  isFullyFulfilledByItems: boolean;
  hasExcessQuantity: boolean;
  hasHeaderInflationRisk: boolean;
  hasProductsOutsideOrder: boolean;
};

export type PortfolioOrderFulfillmentMap = {
  financialStatus: PortfolioFinancialStatus;
  operationalStatus: PortfolioOperationalStatus;
  technicalAlerts: PortfolioTechnicalAlert[];
  fulfillmentSummary: FulfillmentSummary;
  orderItemsCoverage: OrderItemCoverageRow[];
  stockDocumentsCoverage: StockDocumentCoverageRow[];
  receivablesCoverage: ReceivableCoverageRow[];
  executiveConclusion: string;
  evidenceWarnings: string[];
};

function toNumber(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return value;
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}

function round6(n: number): number {
  return Number(n.toFixed(6));
}

function pctCapped(part: number, whole: number): number | null {
  if (!Number.isFinite(whole) || whole <= 0) return null;
  return round2(Math.min(100, (part / whole) * 100));
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toIsoDate(value: Date | string | null | undefined): string | null {
  const d = toDate(value);
  if (!d) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function docKey(nfeExternalId: number | null, stockDocumentExternalId: number | null): string {
  return `${nfeExternalId ?? "n"}::${stockDocumentExternalId ?? "d"}`;
}

function isAllocationStatus(status: string | null | undefined): boolean {
  return (
    status === "ITEM_ALLOCATED" ||
    status === "PRICE_MISMATCH" ||
    status === "FULLY_ALLOCATED" ||
    status === "PARTIALLY_ALLOCATED"
  );
}

function isSurplusStatus(status: string | null | undefined): boolean {
  return status === "QUANTITY_SURPLUS_IN_NFE";
}

function isOutsideOrderFact(fact: PortfolioReconciliationFactApiRow): boolean {
  if (fact.status === "STOCK_PRODUCT_NOT_IN_ORDER") return true;
  if (fact.status !== "DATA_QUALITY_ISSUE") return false;
  const rule =
    fact.traceJson &&
    typeof fact.traceJson === "object" &&
    "rule" in fact.traceJson
      ? String((fact.traceJson as { rule?: string }).rule ?? "")
      : "";
  return rule === "STOCK_PRODUCT_NOT_IN_ORDER";
}

function resolveFacts(input: BuildOrderFulfillmentMapInput): {
  facts: PortfolioReconciliationFactApiRow[];
  evidenceWarnings: string[];
} {
  const warnings: string[] = [];
  if (input.reconciliationFacts && input.reconciliationFacts.length > 0) {
    return { facts: [...input.reconciliationFacts], evidenceWarnings: warnings };
  }

  const order = input.order;
  const orderItems = input.orderItems ?? [];
  if (!order || orderItems.length === 0) {
    warnings.push(
      "Sem fatos materializados e sem pedido/itens suficientes para rodar o motor de alocação."
    );
    return { facts: [], evidenceWarnings: warnings };
  }

  const stockDocuments = (input.stockDocuments ?? []).map((doc): SnapshotStockDocument => ({
    id: doc.id,
    externalId: doc.externalId,
    idNfe: doc.idNfe,
    dataDocumento: toDate(doc.dataDocumento) ?? undefined,
    items: doc.items.map(
      (it): SnapshotStockItem => ({
        id: it.id,
        externalProductId: it.externalProductId,
        quantity: it.quantity,
        unitValue: it.unitValue,
      })
    ),
  }));

  // Itens soltos (quando API passa stockDocumentItems sem agrupar)
  if ((input.stockDocumentItems?.length ?? 0) > 0 && stockDocuments.length === 0) {
    const byDoc = new Map<string, SnapshotStockDocument>();
    for (const it of input.stockDocumentItems!) {
      const key = String(it.stockDocumentExternalId ?? it.stockDocumentId ?? "unknown");
      let doc = byDoc.get(key);
      if (!doc) {
        doc = {
          id: it.stockDocumentId ?? `doc-${key}`,
          externalId: it.stockDocumentExternalId ?? 0,
          idNfe: it.nfeExternalId ?? null,
          items: [],
        };
        byDoc.set(key, doc);
      }
      doc.items.push({
        id: it.id,
        externalProductId: it.externalProductId,
        quantity: it.quantity,
        unitValue: it.unitValue,
      });
    }
    stockDocuments.push(...byDoc.values());
  }

  const snapshotOrder: SnapshotOrder = {
    id: order.id,
    externalSalesOrderId: order.externalSalesOrderId ?? null,
    orderCode: order.orderCode ?? "",
    issueDate: toDate(order.issueDate),
    customerNameSnapshot: order.customerNameSnapshot ?? null,
    totalNetValue: order.totalNetValue,
    items: orderItems.map(
      (it): SnapshotOrderItem => ({
        id: it.id,
        externalProductId: it.externalProductId,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        productSkuSnapshot: it.productSkuSnapshot ?? null,
        productNameSnapshot: it.productNameSnapshot ?? null,
        totalNetValue: it.totalNetValue ?? null,
        externalSalesOrderItemId: it.externalSalesOrderItemId ?? null,
      })
    ),
  };

  const nfeLinks: SnapshotNfeLink[] = (input.nfeLinks ?? []).map((l) => ({
    salesOrderId: l.salesOrderId,
    nfeExternalId: l.nfeExternalId,
    nfeNumber: l.nfeNumber ?? null,
    dataProcessamento: toDate(l.dataProcessamento),
  }));

  const nfes: SnapshotNfe[] = (input.nfes ?? []).map((n) => ({
    id: n.id ?? `nfe-${n.externalId}`,
    externalId: n.externalId,
    numero: n.numero ?? null,
    valorLiquido: n.valorLiquido ?? null,
  }));

  // Se há docs sem links, sintetiza links por idNfe
  if (nfeLinks.length === 0 && stockDocuments.some((d) => d.idNfe != null)) {
    const seen = new Set<number>();
    for (const doc of stockDocuments) {
      if (doc.idNfe == null || seen.has(doc.idNfe)) continue;
      seen.add(doc.idNfe);
      const nfe = nfes.find((n) => n.externalId === doc.idNfe);
      nfeLinks.push({
        salesOrderId: order.id,
        nfeExternalId: doc.idNfe,
        nfeNumber: nfe?.numero ?? null,
        dataProcessamento: toDate(doc.dataDocumento),
      });
    }
  }

  const snapshot: PortfolioReconciliationSnapshot = {
    orders: [snapshotOrder],
    nfeLinks,
    nfes,
    stockDocuments,
  };

  const built = buildPortfolioReconciliationFacts({
    runId: input.runId ?? "fulfillment-map-preview",
    mode: "preview",
    snapshot,
  });

  const facts = built.facts.map((draft, idx) =>
    portfolioFactDraftToApiRow(draft, `ff-${idx}`)
  );
  return { facts, evidenceWarnings: warnings };
}

export function classifyFinancialStatus(input: {
  receivedValue: number;
  openReceivableValue: number;
  receivableTotalValue?: number | null;
  hasNfe?: boolean;
  hasStockDocument?: boolean;
  hasAllocation?: boolean;
}): PortfolioFinancialStatus {
  const received = toNumber(input.receivedValue);
  const open = toNumber(input.openReceivableValue);
  const receivableTotal = toNumber(input.receivableTotalValue);
  const hasCr = receivableTotal > 0.01 || open > 0.01 || received > 0.01;

  if (hasCr && open <= 0.01 && received > 0.01) return "FIN_RECEBIDO";
  if (hasCr && open > 0.01) return "FIN_CR_ABERTO";
  if (
    !hasCr &&
    (input.hasNfe || input.hasStockDocument || input.hasAllocation)
  ) {
    return "FIN_FATURADO_SEM_CR";
  }
  return "FIN_SEM_CR";
}

/** @deprecated use classifyFinancialStatus */
export const resolveFinancialStatus = classifyFinancialStatus;

export function classifyOperationalStatus(input: {
  hasNfe: boolean;
  hasStockDocument: boolean;
  hasItemAllocation: boolean;
  headerOnlyLink: boolean;
  totalOrderedQuantity: number;
  totalAttendedQuantityCapped: number;
  totalRemainingQuantity: number;
  hasExcessQuantity: boolean;
}): PortfolioOperationalStatus {
  if (input.headerOnlyLink && !input.hasItemAllocation) {
    return "OP_VINCULO_APENAS_CABECALHO";
  }
  if (input.hasStockDocument && !input.hasItemAllocation) {
    return "OP_DOCUMENTO_SEM_ITEMIZACAO";
  }
  if (input.totalAttendedQuantityCapped <= 0.000001) {
    return "OP_NAO_ATENDIDO";
  }
  const fully =
    input.totalOrderedQuantity > 0 &&
    input.totalRemainingQuantity <= 0.000001 &&
    input.totalAttendedQuantityCapped + 0.000001 >= input.totalOrderedQuantity;
  if (fully) {
    return input.hasExcessQuantity
      ? "OP_TOTALMENTE_ATENDIDO_COM_EXCEDENTE"
      : "OP_TOTALMENTE_ATENDIDO";
  }
  if (input.totalAttendedQuantityCapped > 0 && input.totalRemainingQuantity > 0.000001) {
    return "OP_PARCIALMENTE_ATENDIDO";
  }
  if (input.totalAttendedQuantityCapped > 0) {
    return input.hasExcessQuantity
      ? "OP_TOTALMENTE_ATENDIDO_COM_EXCEDENTE"
      : "OP_TOTALMENTE_ATENDIDO";
  }
  return "OP_NAO_ATENDIDO";
}

/** @deprecated use classifyOperationalStatus */
export function resolveOperationalStatus(input: {
  hasNfe: boolean;
  hasStockDocument: boolean;
  hasItemAllocation: boolean;
  headerOnlyLink: boolean;
  totalOrderQuantity: number;
  attendedQuantity: number;
  remainingQuantity: number;
  hasExcessQuantity?: boolean;
}): PortfolioOperationalStatus {
  return classifyOperationalStatus({
    hasNfe: input.hasNfe,
    hasStockDocument: input.hasStockDocument,
    hasItemAllocation: input.hasItemAllocation,
    headerOnlyLink: input.headerOnlyLink,
    totalOrderedQuantity: input.totalOrderQuantity,
    totalAttendedQuantityCapped: input.attendedQuantity,
    totalRemainingQuantity: input.remainingQuantity,
    hasExcessQuantity: Boolean(input.hasExcessQuantity),
  });
}

export function detectTechnicalAlerts(input: {
  orderValue: number;
  attributedOrderValueByOrderPrice: number;
  nfeHeaderTotalValue: number;
  hasItemAllocation: boolean;
  headerOnlyLink: boolean;
  hasNfe: boolean;
  hasStockDocument: boolean;
  hasReceivable: boolean;
  paymentTermsAvailable?: boolean | null;
  hasExcessQuantity: boolean;
  hasProductsOutsideOrder: boolean;
  priceMismatch: boolean;
  crWithoutSafeRateio: boolean;
  hasUnattendedOrderItems: boolean;
  facts?: readonly PortfolioReconciliationFactApiRow[];
}): PortfolioTechnicalAlert[] {
  const tags = new Set<PortfolioTechnicalAlert>();
  const facts = input.facts ?? [];

  if (
    input.nfeHeaderTotalValue >
    Math.max(input.attributedOrderValueByOrderPrice, input.orderValue) + 0.05
  ) {
    tags.add("NF_CABECALHO_MAIOR_PEDIDO");
  } else if (input.nfeHeaderTotalValue > input.orderValue + 0.05) {
    tags.add("NF_CABECALHO_MAIOR_PEDIDO");
  }

  if (input.priceMismatch) tags.add("DIVERGENCIA_PRECO");
  if (input.hasExcessQuantity) tags.add("QUANTIDADE_EXCEDENTE_DOCUMENTO");
  if (input.hasProductsOutsideOrder) tags.add("PRODUTO_FORA_DO_PEDIDO");
  if (input.hasUnattendedOrderItems) tags.add("ITEM_DO_PEDIDO_NAO_ATENDIDO");
  if (input.crWithoutSafeRateio) tags.add("CR_SEM_RATEIO_SEGURO");
  if ((input.hasStockDocument || input.hasItemAllocation) && !input.hasReceivable) {
    tags.add("DOCUMENTO_SEM_CR");
  }
  if (input.paymentTermsAvailable !== true) {
    tags.add("SEM_CONDICAO_PAGAMENTO");
  }
  if (
    input.headerOnlyLink ||
    (input.hasNfe && !input.hasStockDocument && !input.hasItemAllocation) ||
    facts.some(
      (f) =>
        f.status === "HEADER_ONLY_LINK" ||
        f.status === "PARTIALLY_ALLOCATED" ||
        f.status === "AMBIGUOUS_ALLOCATION"
    )
  ) {
    tags.add("VINCULO_INCOMPLETO");
  }
  if (input.hasNfe && !input.hasStockDocument && !input.hasItemAllocation) {
    tags.add("NF_SEM_DOCUMENTO");
  }
  for (const f of facts) {
    const st = f.status ?? "";
    if (
      st === "OVER_LINKED_BY_HEADER" ||
      st === "DATA_QUALITY_ISSUE" ||
      st === "AMBIGUOUS_ALLOCATION"
    ) {
      tags.add("DIVERGENCIA_TECNICA");
    }
    for (const a of parseAlertsJson(f.alertsJson)) {
      const u = a.toUpperCase();
      if (
        u.includes("OVER_LINKED") ||
        u.includes("DATA_QUALITY") ||
        u.includes("AMBIGUOUS") ||
        u.includes("DIVERGENCIA")
      ) {
        tags.add("DIVERGENCIA_TECNICA");
      }
    }
  }

  return [...tags];
}

export function buildOrderItemsCoverage(input: {
  facts: readonly PortfolioReconciliationFactApiRow[];
  orderItems?: readonly FulfillmentOrderItemInput[];
  excessByProduct?: Map<number, number>;
}): OrderItemCoverageRow[] {
  const facts = input.facts;
  const byItem = new Map<
    string,
    {
      salesOrderItemId: string | null;
      externalProductId: number | null;
      productCode: string | null;
      description: string | null;
      orderedQuantity: number;
      attendedQuantityCapped: number;
      orderUnitValue: number;
      orderItemValue: number;
      documentsUsed: Map<string, FulfillmentDocumentUsed>;
      alerts: Set<string>;
    }
  >();

  const seedFromOrderItems = () => {
    for (const it of input.orderItems ?? []) {
      byItem.set(it.id, {
        salesOrderItemId: it.id,
        externalProductId: it.externalProductId,
        productCode: it.productSkuSnapshot ?? null,
        description: it.productNameSnapshot ?? null,
        orderedQuantity: round6(it.quantity),
        attendedQuantityCapped: 0,
        orderUnitValue: round6(it.unitPrice),
        orderItemValue: round2(
          it.totalNetValue != null && Number.isFinite(it.totalNetValue)
            ? it.totalNetValue
            : it.quantity * it.unitPrice
        ),
        documentsUsed: new Map(),
        alerts: new Set(),
      });
    }
  };
  seedFromOrderItems();

  for (const fact of facts) {
    const itemId = fact.salesOrderItemId;
    if (!itemId) continue;
    let row = byItem.get(itemId);
    if (!row) {
      row = {
        salesOrderItemId: itemId,
        externalProductId: fact.externalProductId,
        productCode: fact.productSkuSnapshot,
        description: fact.productNameSnapshot,
        orderedQuantity: round6(toNumber(fact.orderQuantity)),
        attendedQuantityCapped: 0,
        orderUnitValue: round6(toNumber(fact.orderUnitPrice)),
        orderItemValue: round2(toNumber(fact.orderItemValue)),
        documentsUsed: new Map(),
        alerts: new Set(),
      };
      byItem.set(itemId, row);
    }

    const qty = toNumber(fact.allocatedQuantity);
    if (qty > 0 && (isAllocationStatus(fact.status) || fact.status === "PRICE_MISMATCH")) {
      // Cap: never exceed ordered quantity (motor de alocação já limita; reforço aqui)
      const room = Math.max(0, row.orderedQuantity - row.attendedQuantityCapped);
      const add = round6(Math.min(qty, room));
      row.attendedQuantityCapped = round6(row.attendedQuantityCapped + add);

      const key = docKey(fact.nfeExternalId, fact.stockDocumentExternalId);
      const existing = row.documentsUsed.get(key);
      if (existing) {
        existing.allocatedQuantity = round6(existing.allocatedQuantity + add);
      } else {
        row.documentsUsed.set(key, {
          nfeNumber: fact.nfeNumber,
          nfeExternalId: fact.nfeExternalId,
          stockDocumentExternalId: fact.stockDocumentExternalId,
          allocatedQuantity: add,
        });
      }
    }

    if (fact.status === "PRICE_MISMATCH") row.alerts.add("DIVERGENCIA_PRECO");
    if (isSurplusStatus(fact.status)) row.alerts.add("QUANTIDADE_EXCEDENTE_DOCUMENTO");
  }

  const excessByProduct = input.excessByProduct ?? new Map<number, number>();

  return [...byItem.values()]
    .map((row) => {
      const remaining = round6(
        Math.max(0, row.orderedQuantity - row.attendedQuantityCapped)
      );
      const excess =
        row.externalProductId != null
          ? round6(excessByProduct.get(row.externalProductId) ?? 0)
          : 0;
      const fulfillmentPercentCapped = pctCapped(
        row.attendedQuantityCapped,
        row.orderedQuantity
      );
      const alerts = [...row.alerts];
      if (remaining > 0.000001) alerts.push("ITEM_DO_PEDIDO_NAO_ATENDIDO");
      if (excess > 0.000001) alerts.push("QUANTIDADE_EXCEDENTE_DOCUMENTO");

      return {
        salesOrderItemId: row.salesOrderItemId,
        externalProductId: row.externalProductId,
        productExternalId: row.externalProductId,
        productCode: row.productCode,
        description: row.description,
        orderedQuantity: row.orderedQuantity,
        attendedQuantityCapped: row.attendedQuantityCapped,
        attendedQuantity: row.attendedQuantityCapped,
        remainingQuantity: remaining,
        excessQuantityForThisProduct: excess,
        fulfillmentPercentCapped,
        fulfillmentPercent: fulfillmentPercentCapped,
        orderUnitValue: row.orderUnitValue,
        orderItemValue: row.orderItemValue,
        attendedValueByOrderPrice: round2(
          row.attendedQuantityCapped * row.orderUnitValue
        ),
        documentsUsed: [...row.documentsUsed.values()],
        alerts: [...new Set(alerts)],
      } satisfies OrderItemCoverageRow;
    })
    .sort((a, b) =>
      String(a.externalProductId ?? "").localeCompare(String(b.externalProductId ?? ""))
    );
}

export function buildStockDocumentsCoverage(input: {
  facts: readonly PortfolioReconciliationFactApiRow[];
  orderUnitPriceByProduct: Map<number, number>;
}): {
  rows: StockDocumentCoverageRow[];
  excessByProduct: Map<number, number>;
  totalExcessQuantity: number;
  hasProductsOutsideOrder: boolean;
  priceMismatch: boolean;
} {
  const facts = input.facts;
  type Acc = {
    nfeNumber: string | null;
    nfeExternalId: number | null;
    stockDocumentExternalId: number | null;
    date: string | null;
    nfeHeaderValue: number | null;
    documentTotalValue: number;
    valueAttributedToOrder: number;
    matchedItems: Map<number, StockDocumentMatchedItem>;
    surplusItems: StockDocumentSurplusItem[];
    itemsOutsideOrder: StockDocumentOutsideItem[];
    alerts: Set<string>;
  };

  const byDoc = new Map<string, Acc>();
  const excessByProduct = new Map<number, number>();
  let totalExcessQuantity = 0;
  let hasProductsOutsideOrder = false;
  let priceMismatch = false;

  const ensure = (fact: PortfolioReconciliationFactApiRow): Acc => {
    const key = docKey(fact.nfeExternalId, fact.stockDocumentExternalId);
    let acc = byDoc.get(key);
    if (!acc) {
      acc = {
        nfeNumber: fact.nfeNumber,
        nfeExternalId: fact.nfeExternalId,
        stockDocumentExternalId: fact.stockDocumentExternalId,
        date:
          toIsoDate(fact.stockDocumentDate) ??
          toIsoDate(fact.nfeProcessedAt),
        nfeHeaderValue:
          fact.nfeHeaderValue != null ? round2(toNumber(fact.nfeHeaderValue)) : null,
        documentTotalValue: 0,
        valueAttributedToOrder: 0,
        matchedItems: new Map(),
        surplusItems: [],
        itemsOutsideOrder: [],
        alerts: new Set(),
      };
      byDoc.set(key, acc);
    }
    if (fact.nfeNumber) acc.nfeNumber = fact.nfeNumber;
    if (fact.nfeHeaderValue != null) {
      acc.nfeHeaderValue = round2(toNumber(fact.nfeHeaderValue));
    }
    return acc;
  };

  for (const fact of facts) {
    if (
      fact.nfeExternalId == null &&
      fact.stockDocumentExternalId == null &&
      !isOutsideOrderFact(fact) &&
      !isSurplusStatus(fact.status) &&
      toNumber(fact.allocatedQuantity) <= 0
    ) {
      continue;
    }

    // Skip pure order-item rows without document
    if (
      fact.stockDocumentExternalId == null &&
      fact.nfeExternalId == null &&
      fact.status !== "HEADER_ONLY_LINK" &&
      fact.status !== "OVER_LINKED_BY_HEADER"
    ) {
      continue;
    }

    const acc = ensure(fact);
    const productId = fact.externalProductId;
    const stockQty = toNumber(fact.stockQuantity);
    const stockValue = toNumber(fact.stockItemValue);
    if (stockQty > 0) {
      acc.documentTotalValue = round2(acc.documentTotalValue + stockValue);
    }

    const allocatedQty = toNumber(fact.allocatedQuantity);
    if (allocatedQty > 0 && productId != null) {
      const orderUnit =
        input.orderUnitPriceByProduct.get(productId) ?? toNumber(fact.orderUnitPrice);
      const attributed = round2(allocatedQty * orderUnit);
      acc.valueAttributedToOrder = round2(acc.valueAttributedToOrder + attributed);
      const existing = acc.matchedItems.get(productId);
      if (existing) {
        existing.allocatedQuantity = round6(existing.allocatedQuantity + allocatedQty);
        existing.allocatedValueByOrderPrice = round2(
          existing.allocatedValueByOrderPrice + attributed
        );
      } else {
        acc.matchedItems.set(productId, {
          productExternalId: productId,
          allocatedQuantity: allocatedQty,
          allocatedValueByOrderPrice: attributed,
        });
      }
    }

    if (fact.status === "PRICE_MISMATCH" || (fact.priceDifferenceUnit != null && Math.abs(toNumber(fact.priceDifferenceUnit)) > 0.005)) {
      priceMismatch = true;
      acc.alerts.add("DIVERGENCIA_PRECO");
    }
    if (
      productId != null &&
      fact.stockUnitValue != null &&
      fact.orderUnitPrice != null &&
      pricesMismatch(toNumber(fact.orderUnitPrice), toNumber(fact.stockUnitValue))
    ) {
      priceMismatch = true;
      acc.alerts.add("DIVERGENCIA_PRECO");
    }

    if (isSurplusStatus(fact.status)) {
      const surplusQty =
        toNumber(
          (fact.traceJson &&
          typeof fact.traceJson === "object" &&
          "surplusQuantity" in (fact.traceJson as object)
            ? Number((fact.traceJson as { surplusQuantity?: number }).surplusQuantity)
            : null) ?? stockQty
        ) || stockQty;
      totalExcessQuantity = round6(totalExcessQuantity + surplusQty);
      if (productId != null) {
        excessByProduct.set(
          productId,
          round6((excessByProduct.get(productId) ?? 0) + surplusQty)
        );
      }
      acc.surplusItems.push({
        productExternalId: productId,
        stockQuantity: surplusQty,
        stockItemValue: stockValue || null,
      });
      acc.alerts.add("QUANTIDADE_EXCEDENTE_DOCUMENTO");
    }

    if (isOutsideOrderFact(fact) && productId != null) {
      hasProductsOutsideOrder = true;
      acc.itemsOutsideOrder.push({
        productExternalId: productId,
        stockQuantity: stockQty || null,
        stockItemValue: stockValue || null,
        reason: "PRODUTO_FORA_DO_PEDIDO",
      });
      acc.alerts.add("PRODUTO_FORA_DO_PEDIDO");
    }

    if (fact.status === "HEADER_ONLY_LINK") {
      acc.alerts.add("VINCULO_INCOMPLETO");
    }
    if (fact.status === "OVER_LINKED_BY_HEADER") {
      acc.alerts.add("NF_CABECALHO_MAIOR_PEDIDO");
    }
  }

  const rows: StockDocumentCoverageRow[] = [...byDoc.values()]
    .filter(
      (acc) =>
        acc.stockDocumentExternalId != null ||
        acc.nfeExternalId != null ||
        acc.matchedItems.size > 0 ||
        acc.surplusItems.length > 0 ||
        acc.itemsOutsideOrder.length > 0
    )
    .map((acc) => {
      const header = acc.nfeHeaderValue ?? 0;
      const attributed = acc.valueAttributedToOrder;
      // Cabeçalho nunca aumenta o atribuído; valor fora = max(header - attributed, docTotal - attributed, 0)
      const notAttributed = round2(
        Math.max(0, Math.max(header, acc.documentTotalValue) - attributed)
      );
      return {
        nfeNumber: acc.nfeNumber,
        nfeExternalId: acc.nfeExternalId,
        stockDocumentExternalId: acc.stockDocumentExternalId,
        date: acc.date,
        nfeHeaderValue: acc.nfeHeaderValue,
        documentTotalValue: round2(acc.documentTotalValue) || null,
        valueAttributedToOrder: attributed,
        valueNotAttributedToOrder: notAttributed,
        matchedItems: [...acc.matchedItems.values()],
        surplusItems: acc.surplusItems,
        itemsOutsideOrder: acc.itemsOutsideOrder,
        unmatchedItems: acc.itemsOutsideOrder,
        alerts: [...acc.alerts],
      };
    })
    .sort((a, b) =>
      String(a.nfeExternalId ?? a.stockDocumentExternalId ?? "").localeCompare(
        String(b.nfeExternalId ?? b.stockDocumentExternalId ?? "")
      )
    );

  return {
    rows,
    excessByProduct,
    totalExcessQuantity,
    hasProductsOutsideOrder,
    priceMismatch,
  };
}

export function buildReceivablesCoverage(input: {
  facts: readonly PortfolioReconciliationFactApiRow[];
  receivables?: readonly FulfillmentReceivableInput[];
}): ReceivableCoverageRow[] {
  if (input.receivables && input.receivables.length > 0) {
    return input.receivables.map((r) => ({
      receivableId: r.receivableId ?? null,
      receivableIds: r.receivableId != null ? [r.receivableId] : [],
      dueDate: r.dueDate ?? null,
      dueDates: r.dueDate ? [r.dueDate] : [],
      settlementDate: r.settlementDate ?? null,
      settlementDates: r.settlementDate ? [r.settlementDate] : [],
      totalValue: r.totalValue ?? null,
      receivedValue: r.receivedValue ?? null,
      openValue: r.openValue ?? null,
      sourceNfe: r.sourceNfe ?? null,
      attributionStatus:
        r.totalValue != null ? ("ORDER_AGGREGATE" as const) : ("UNAVAILABLE" as const),
    }));
  }

  const built = buildPortfolioReceivableTitleRows(input.facts);
  if (built.titles.length === 0) {
    const first = input.facts.find(
      (f) =>
        toNumber(f.receivableTotalValue) > 0 ||
        toNumber(f.receivedValue) > 0 ||
        toNumber(f.openReceivableValue) > 0
    );
    if (!first) return [];
    return [
      {
        receivableId: null,
        receivableIds: [],
        dueDate: null,
        dueDates: [],
        settlementDate: null,
        settlementDates: [],
        totalValue: first.receivableTotalValue,
        receivedValue: first.receivedValue,
        openValue: first.openReceivableValue,
        sourceNfe: first.nfeExternalId,
        attributionStatus: "ORDER_AGGREGATE",
      },
    ];
  }

  return built.titles.map((t) => ({
    receivableId: t.receivableId,
    receivableIds: t.receivableId != null ? [t.receivableId] : [],
    dueDate: t.dueDate,
    dueDates: t.dueDate ? [t.dueDate] : [],
    settlementDate: t.settlementDate,
    settlementDates: t.settlementDate ? [t.settlementDate] : [],
    totalValue: t.amount,
    receivedValue: t.received,
    openValue: t.open,
    sourceNfe: t.sourceNfeExternalId ?? null,
    attributionStatus: built.summary.attributionStatus,
  }));
}

export function buildFulfillmentExecutiveConclusion(input: {
  financialStatus: PortfolioFinancialStatus;
  operationalStatus: PortfolioOperationalStatus;
  technicalAlerts: readonly PortfolioTechnicalAlert[];
  fulfillmentSummary: FulfillmentSummary;
}): string {
  const fin =
    input.financialStatus === "FIN_RECEBIDO"
      ? "Financeiro: já recebido."
      : input.financialStatus === "FIN_CR_ABERTO"
        ? "Financeiro: CR aberto (pode haver baixa parcial)."
        : input.financialStatus === "FIN_FATURADO_SEM_CR"
          ? "Financeiro: faturado/documento sem CR."
          : "Financeiro: ainda sem CR.";

  const pctLabel =
    input.fulfillmentSummary.fulfillmentPercent != null
      ? `${input.fulfillmentSummary.fulfillmentPercent}%`
      : "sem quantidade";

  const op =
    input.operationalStatus === "OP_TOTALMENTE_ATENDIDO_COM_EXCEDENTE"
      ? `Atendimento: ${pctLabel} dos itens cobertos — com quantidade/produto excedente nos documentos (excedente não soma carteira).`
      : input.operationalStatus === "OP_TOTALMENTE_ATENDIDO"
        ? `Atendimento: ${pctLabel} dos itens do pedido cobertos por documento de saída (itemização).`
        : input.operationalStatus === "OP_PARCIALMENTE_ATENDIDO"
          ? `Atendimento: ${pctLabel} dos itens — ainda há saldo a atender.`
          : input.operationalStatus === "OP_VINCULO_APENAS_CABECALHO"
            ? "Atendimento: só vínculo de cabeçalho de NF — sem itemização confiável."
            : input.operationalStatus === "OP_DOCUMENTO_SEM_ITEMIZACAO"
              ? "Atendimento: há documento, mas sem alocação item a item."
              : "Atendimento: pedido ainda não atendido por documento de saída.";

  const alertParts: string[] = [];
  if (input.fulfillmentSummary.hasHeaderInflationRisk) {
    alertParts.push(
      `cabeçalho de NF (R$ ${input.fulfillmentSummary.nfeHeaderTotalValue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}) é maior que o valor atribuído/pedido — o cabeçalho não é o valor do pedido`
    );
  }
  if (input.technicalAlerts.includes("DIVERGENCIA_PRECO")) {
    alertParts.push("há divergência de preço documento vs pedido");
  }
  if (input.technicalAlerts.includes("PRODUTO_FORA_DO_PEDIDO")) {
    alertParts.push("há produto no documento fora do pedido");
  }
  if (input.technicalAlerts.includes("QUANTIDADE_EXCEDENTE_DOCUMENTO")) {
    alertParts.push("há quantidade excedente no documento");
  }
  if (input.technicalAlerts.includes("CR_SEM_RATEIO_SEGURO")) {
    alertParts.push("CR sem rateio itemizado seguro ao pedido");
  }

  const alerts =
    alertParts.length > 0
      ? `Alertas técnicos (não somam carteira): ${alertParts.join("; ")}.`
      : "Sem alertas técnicos críticos neste mapa.";

  return `${fin} ${op} ${alerts}`;
}

export function buildOrderFulfillmentMap(
  input: BuildOrderFulfillmentMapInput
): PortfolioOrderFulfillmentMap {
  const { facts, evidenceWarnings } = resolveFacts(input);

  const orderValue = round2(
    toNumber(
      input.orderValue ??
        input.order?.totalNetValue ??
        facts.find((f) => f.orderItemValue != null)?.orderItemValue
    ) ||
      facts.reduce((s, f) => {
        // Prefer explicit order total from unique item values once
        return s;
      }, 0)
  );

  // Prefer sum of distinct order items for orderValue fallback
  let resolvedOrderValue = orderValue;
  if (resolvedOrderValue <= 0 && (input.orderItems?.length ?? 0) > 0) {
    resolvedOrderValue = round2(
      input.orderItems!.reduce(
        (s, it) =>
          s +
          (it.totalNetValue != null && Number.isFinite(it.totalNetValue)
            ? it.totalNetValue
            : it.quantity * it.unitPrice),
        0
      )
    );
  }
  if (resolvedOrderValue <= 0) {
    const seenItems = new Set<string>();
    let sum = 0;
    for (const f of facts) {
      const id = f.salesOrderItemId;
      if (!id || seenItems.has(id)) continue;
      seenItems.add(id);
      sum += toNumber(f.orderItemValue);
    }
    resolvedOrderValue = round2(sum);
  }

  const orderUnitPriceByProduct = new Map<number, number>();
  for (const it of input.orderItems ?? []) {
    orderUnitPriceByProduct.set(it.externalProductId, it.unitPrice);
  }
  for (const f of facts) {
    if (f.externalProductId != null && !orderUnitPriceByProduct.has(f.externalProductId)) {
      orderUnitPriceByProduct.set(f.externalProductId, toNumber(f.orderUnitPrice));
    }
  }

  const docsBuilt = buildStockDocumentsCoverage({ facts, orderUnitPriceByProduct });
  const orderItemsCoverage = buildOrderItemsCoverage({
    facts,
    orderItems: input.orderItems,
    excessByProduct: docsBuilt.excessByProduct,
  });
  const receivablesCoverage = buildReceivablesCoverage({
    facts,
    receivables: input.receivables,
  });

  const totalOrderedQuantity = round6(
    orderItemsCoverage.reduce((s, r) => s + r.orderedQuantity, 0)
  );
  const totalAttendedQuantityCapped = round6(
    orderItemsCoverage.reduce((s, r) => s + r.attendedQuantityCapped, 0)
  );
  const totalRemainingQuantity = round6(
    orderItemsCoverage.reduce((s, r) => s + r.remainingQuantity, 0)
  );
  const attributedOrderValueByOrderPrice = round2(
    orderItemsCoverage.reduce((s, r) => s + r.attendedValueByOrderPrice, 0)
  );
  // Nunca deixa atribuído passar do valor do pedido
  const attributedCapped = round2(
    Math.min(attributedOrderValueByOrderPrice, resolvedOrderValue || attributedOrderValueByOrderPrice)
  );

  const nfeHeaderIds = new Set<number>();
  let nfeHeaderTotalValue = 0;
  for (const f of facts) {
    if (f.nfeExternalId == null || f.nfeHeaderValue == null) continue;
    if (nfeHeaderIds.has(f.nfeExternalId)) continue;
    nfeHeaderIds.add(f.nfeExternalId);
    nfeHeaderTotalValue = round2(nfeHeaderTotalValue + toNumber(f.nfeHeaderValue));
  }
  for (const n of input.nfes ?? []) {
    if (nfeHeaderIds.has(n.externalId)) continue;
    if (n.valorLiquido == null) continue;
    nfeHeaderIds.add(n.externalId);
    nfeHeaderTotalValue = round2(nfeHeaderTotalValue + toNumber(n.valorLiquido));
  }

  const nfeHeaderAttributedToOrderValue = attributedCapped;
  const nfeHeaderNotAttributedToOrderValue = round2(
    Math.max(0, nfeHeaderTotalValue - attributedCapped)
  );

  const receivableFact = facts.find(
    (f) =>
      toNumber(f.receivableTotalValue) > 0 ||
      toNumber(f.receivedValue) > 0 ||
      toNumber(f.openReceivableValue) > 0
  );
  let receivableTotalValue = toNumber(receivableFact?.receivableTotalValue);
  let receivedValue = toNumber(receivableFact?.receivedValue);
  let openReceivableValue = toNumber(receivableFact?.openReceivableValue);
  if (input.receivables && input.receivables.length > 0) {
    receivableTotalValue = round2(
      input.receivables.reduce((s, r) => s + toNumber(r.totalValue), 0)
    );
    receivedValue = round2(
      input.receivables.reduce((s, r) => s + toNumber(r.receivedValue), 0)
    );
    openReceivableValue = round2(
      input.receivables.reduce((s, r) => s + toNumber(r.openValue), 0)
    );
  }

  const hasItemAllocation = facts.some((f) => toNumber(f.allocatedQuantity) > 0);
  const hasNfe = facts.some((f) => f.nfeExternalId != null) || (input.nfes?.length ?? 0) > 0;
  const hasStockDocument =
    facts.some((f) => f.stockDocumentExternalId != null) ||
    (input.stockDocuments?.length ?? 0) > 0;
  const headerOnlyLink = facts.some(
    (f) => f.status === "HEADER_ONLY_LINK" && toNumber(f.allocatedQuantity) <= 0
  );
  const hasReceivable =
    receivableTotalValue > 0.01 || receivedValue > 0.01 || openReceivableValue > 0.01;
  const hasExcessQuantity = docsBuilt.totalExcessQuantity > 0.000001;
  const isFullyFulfilledByItems =
    totalOrderedQuantity > 0 && totalRemainingQuantity <= 0.000001;
  const hasHeaderInflationRisk =
    nfeHeaderTotalValue > attributedCapped + 0.05 ||
    nfeHeaderTotalValue > resolvedOrderValue + 0.05;
  const hasUnattendedOrderItems = orderItemsCoverage.some(
    (r) => r.remainingQuantity > 0.000001
  );
  const crWithoutSafeRateio =
    hasReceivable &&
    receivablesCoverage.some(
      (r) =>
        r.attributionStatus === "TITLE_IDS_ONLY" ||
        r.attributionStatus === "UNAVAILABLE" ||
        (r.receivableIds.length > 1 && r.totalValue == null)
    );

  const financialStatus = classifyFinancialStatus({
    receivedValue,
    openReceivableValue,
    receivableTotalValue,
    hasNfe,
    hasStockDocument,
    hasAllocation: hasItemAllocation,
  });

  const operationalStatus = classifyOperationalStatus({
    hasNfe,
    hasStockDocument,
    hasItemAllocation,
    headerOnlyLink,
    totalOrderedQuantity,
    totalAttendedQuantityCapped,
    totalRemainingQuantity,
    hasExcessQuantity,
  });

  const technicalAlerts = detectTechnicalAlerts({
    orderValue: resolvedOrderValue,
    attributedOrderValueByOrderPrice: attributedCapped,
    nfeHeaderTotalValue,
    hasItemAllocation,
    headerOnlyLink,
    hasNfe,
    hasStockDocument,
    hasReceivable,
    paymentTermsAvailable: input.paymentTermsAvailable,
    hasExcessQuantity,
    hasProductsOutsideOrder: docsBuilt.hasProductsOutsideOrder,
    priceMismatch: docsBuilt.priceMismatch,
    crWithoutSafeRateio,
    hasUnattendedOrderItems,
    facts,
  });

  const fulfillmentPercent = pctCapped(
    totalAttendedQuantityCapped,
    totalOrderedQuantity
  );

  const fulfillmentSummary: FulfillmentSummary = {
    orderValue: resolvedOrderValue,
    attributedOrderValueByOrderPrice: attributedCapped,
    attributedOrderValue: attributedCapped,
    totalOrderedQuantity,
    totalOrderQuantity: totalOrderedQuantity,
    totalAttendedQuantityCapped,
    attendedQuantity: totalAttendedQuantityCapped,
    totalRemainingQuantity,
    remainingQuantity: totalRemainingQuantity,
    totalExcessQuantity: docsBuilt.totalExcessQuantity,
    fulfillmentPercent,
    receivableTotalValue,
    receivableTotal: receivableTotalValue,
    receivedValue,
    openReceivableValue,
    nfeHeaderTotalValue,
    nfeHeaderTotal: nfeHeaderTotalValue,
    nfeHeaderAttributedToOrderValue,
    nfeHeaderNotAttributedToOrderValue,
    nfeHeaderNotAttributed: nfeHeaderNotAttributedToOrderValue,
    isFullyFulfilledByItems,
    hasExcessQuantity,
    hasHeaderInflationRisk,
    hasProductsOutsideOrder: docsBuilt.hasProductsOutsideOrder,
  };

  const executiveConclusion = buildFulfillmentExecutiveConclusion({
    financialStatus,
    operationalStatus,
    technicalAlerts,
    fulfillmentSummary,
  });

  if (hasHeaderInflationRisk) {
    evidenceWarnings.push(
      "Soma de cabeçalhos de NF maior que o valor atribuído ao pedido — cabeçalho não entra na carteira."
    );
  }
  if (docsBuilt.hasProductsOutsideOrder) {
    evidenceWarnings.push(
      "Há produtos em documentos de saída que não pertencem a este pedido."
    );
  }
  if (hasExcessQuantity) {
    evidenceWarnings.push(
      "Há quantidade excedente nos documentos em relação ao saldo do pedido."
    );
  }

  return {
    financialStatus,
    operationalStatus,
    technicalAlerts,
    fulfillmentSummary,
    orderItemsCoverage,
    stockDocumentsCoverage: docsBuilt.rows,
    receivablesCoverage,
    executiveConclusion,
    evidenceWarnings,
  };
}

/**
 * Adapter para API/detalhe: fatos materializados + valor oficial do pedido.
 * @deprecated prefer buildOrderFulfillmentMap
 */
export function buildPortfolioOrderFulfillmentMap(args: {
  facts: readonly PortfolioReconciliationFactApiRow[];
  orderValue: number;
  paymentTermsAvailable?: boolean | null;
}): PortfolioOrderFulfillmentMap {
  return buildOrderFulfillmentMap({
    reconciliationFacts: args.facts,
    orderValue: args.orderValue,
    paymentTermsAvailable: args.paymentTermsAvailable,
  });
}

export const FINANCIAL_STATUS_LABEL: Record<PortfolioFinancialStatus, string> = {
  FIN_RECEBIDO: "Já recebido",
  FIN_CR_ABERTO: "CR aberto",
  FIN_FATURADO_SEM_CR: "Faturado sem CR",
  FIN_SEM_CR: "Sem CR",
};

export const OPERATIONAL_STATUS_LABEL: Record<PortfolioOperationalStatus, string> = {
  OP_TOTALMENTE_ATENDIDO: "Totalmente atendido",
  OP_TOTALMENTE_ATENDIDO_COM_EXCEDENTE: "Totalmente atendido (com excedente)",
  OP_PARCIALMENTE_ATENDIDO: "Parcialmente atendido",
  OP_NAO_ATENDIDO: "Não atendido",
  OP_DOCUMENTO_SEM_ITEMIZACAO: "Documento sem itemização",
  OP_VINCULO_APENAS_CABECALHO: "Vínculo só de cabeçalho",
};

export const TECHNICAL_ALERT_LABEL: Record<string, string> = {
  NF_CABECALHO_MAIOR_PEDIDO: "NF maior que pedido",
  DIVERGENCIA_PRECO: "Divergência de preço",
  QUANTIDADE_EXCEDENTE_DOCUMENTO: "Quantidade excedente no documento",
  PRODUTO_FORA_DO_PEDIDO: "Produto fora do pedido",
  ITEM_DO_PEDIDO_NAO_ATENDIDO: "Item do pedido não atendido",
  CR_SEM_RATEIO_SEGURO: "CR sem rateio seguro",
  DOCUMENTO_SEM_CR: "Documento sem CR",
  SEM_CONDICAO_PAGAMENTO: "Sem condição de pagamento",
  VINCULO_INCOMPLETO: "Vínculo incompleto",
  DIVERGENCIA_TECNICA: "Divergência técnica",
  NF_SEM_DOCUMENTO: "NF sem documento",
  PEDIDO_ANTIGO_SEM_EVOLUCAO: "Pedido antigo sem evolução",
};
