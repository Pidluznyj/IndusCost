/**
 * Order Fulfillment Map — atendimento item a item (read-only).
 *
 * Separa três eixos:
 * - financeiro (CR / recebimento)
 * - operacional (atendimento por documento de saída)
 * - alertas técnicos (não somam carteira)
 *
 * Não usa cabeçalho de NF como valor do pedido.
 * Não inventa rateio de títulos CR por linha.
 */

import type { PortfolioReconciliationFactApiRow } from "./portfolioReconciliationApi.js";
import { parseAlertsJson } from "./portfolioReconciliationApi.js";
import {
  buildPortfolioDocumentLinkRows,
  buildPortfolioOrderItemRows,
  buildPortfolioReceivableTitleRows,
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

function pct(part: number, whole: number): number | null {
  if (!Number.isFinite(whole) || whole <= 0) return null;
  return round2((part / whole) * 100);
}

export function resolveFinancialStatus(input: {
  receivedValue: number;
  openReceivableValue: number;
  receivableTotalValue?: number | null;
  hasNfe: boolean;
  hasStockDocument: boolean;
  hasAllocation: boolean;
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

/**
 * Resolve status operacional a partir do atendimento itemizado.
 * Contrato: ver docs/finance/portfolio-order-fulfillment-map-requirements.md
 * (`OP_TOTALMENTE_ATENDIDO_COM_EXCEDENTE` — emissão dedicada na entrega seguinte;
 * excedente já aparece em alertas / surplusItems).
 */
export function resolveOperationalStatus(input: {
  hasNfe: boolean;
  hasStockDocument: boolean;
  hasItemAllocation: boolean;
  headerOnlyLink: boolean;
  totalOrderQuantity: number;
  attendedQuantity: number;
  remainingQuantity: number;
}): PortfolioOperationalStatus {
  if (input.headerOnlyLink && !input.hasItemAllocation) {
    return "OP_VINCULO_APENAS_CABECALHO";
  }
  if (input.hasStockDocument && !input.hasItemAllocation) {
    return "OP_DOCUMENTO_SEM_ITEMIZACAO";
  }
  if (input.attendedQuantity <= 0.000001) {
    return "OP_NAO_ATENDIDO";
  }
  if (
    input.totalOrderQuantity > 0 &&
    input.remainingQuantity <= 0.000001 &&
    input.attendedQuantity + 0.000001 >= input.totalOrderQuantity
  ) {
    return "OP_TOTALMENTE_ATENDIDO";
  }
  if (input.attendedQuantity > 0 && input.remainingQuantity > 0.000001) {
    return "OP_PARCIALMENTE_ATENDIDO";
  }
  if (input.attendedQuantity > 0) return "OP_TOTALMENTE_ATENDIDO";
  return "OP_NAO_ATENDIDO";
}

export type FulfillmentSummary = {
  orderValue: number;
  attributedOrderValue: number;
  totalOrderQuantity: number;
  attendedQuantity: number;
  remainingQuantity: number;
  fulfillmentPercent: number | null;
  receivableTotal: number;
  receivedValue: number;
  openReceivableValue: number;
  nfeHeaderTotal: number;
  nfeHeaderNotAttributed: number;
  isFullyFulfilledByItems: boolean;
  hasHeaderInflationRisk: boolean;
};

export type OrderItemCoverageRow = {
  salesOrderItemId: string | null;
  productExternalId: number | null;
  productCode: string | null;
  description: string | null;
  orderedQuantity: number;
  attendedQuantity: number;
  remainingQuantity: number;
  fulfillmentPercent: number | null;
  orderUnitValue: number;
  orderItemValue: number;
  attendedValueByOrderPrice: number;
  documentsUsed: Array<{
    nfeNumber: string | null;
    nfeExternalId: number | null;
    stockDocumentExternalId: number | null;
    allocatedQuantity: number;
  }>;
  alerts: string[];
};

export type StockDocumentCoverageRow = {
  nfeNumber: string | null;
  nfeExternalId: number | null;
  stockDocumentExternalId: number | null;
  date: string | null;
  nfeHeaderValue: number | null;
  valueAttributedToOrder: number;
  valueNotAttributedToOrder: number;
  matchedItems: Array<{
    productExternalId: number | null;
    allocatedQuantity: number;
    allocatedValueByOrderPrice: number;
  }>;
  unmatchedItems: Array<{
    productExternalId: number | null;
    stockQuantity: number | null;
    reason: string;
  }>;
  surplusItems: Array<{
    productExternalId: number | null;
    stockQuantity: number | null;
    stockItemValue: number | null;
  }>;
  alerts: string[];
};

export type ReceivableCoverageRow = {
  receivableId: number | null;
  dueDate: string | null;
  settlementDate: string | null;
  totalValue: number | null;
  receivedValue: number | null;
  openValue: number | null;
  sourceNfe: number | null;
  attributionStatus: "ORDER_AGGREGATE" | "TITLE_IDS_ONLY" | "UNAVAILABLE";
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
};

function collectTechnicalAlerts(args: {
  facts: readonly PortfolioReconciliationFactApiRow[];
  orderValue: number;
  nfeHeaderTotal: number;
  hasItemAllocation: boolean;
  headerOnlyLink: boolean;
  hasNfe: boolean;
  hasStockDocument: boolean;
  hasReceivable: boolean;
  paymentTermsAvailable: boolean | null | undefined;
  surplusProducts: boolean;
  productsOutsideOrder: boolean;
  priceMismatch: boolean;
  crWithoutSafeRateio: boolean;
}): PortfolioTechnicalAlert[] {
  const tags = new Set<PortfolioTechnicalAlert>();

  if (args.nfeHeaderTotal > args.orderValue + 0.05) {
    tags.add("NF_CABECALHO_MAIOR_PEDIDO");
  }
  if (args.priceMismatch) tags.add("DIVERGENCIA_PRECO");
  if (args.surplusProducts) tags.add("QUANTIDADE_EXCEDENTE_DOCUMENTO");
  if (args.productsOutsideOrder) tags.add("PRODUTO_FORA_DO_PEDIDO");
  if (args.crWithoutSafeRateio) tags.add("CR_SEM_RATEIO_SEGURO");
  if (
    (args.hasStockDocument || args.hasItemAllocation) &&
    !args.hasReceivable
  ) {
    tags.add("DOCUMENTO_SEM_CR");
  }
  if (args.paymentTermsAvailable !== true) {
    tags.add("SEM_CONDICAO_PAGAMENTO");
  }
  if (
    args.headerOnlyLink ||
    (args.hasNfe && !args.hasStockDocument && !args.hasItemAllocation) ||
    args.facts.some(
      (f) =>
        f.status === "HEADER_ONLY_LINK" ||
        f.status === "PARTIALLY_ALLOCATED" ||
        f.status === "AMBIGUOUS_ALLOCATION"
    )
  ) {
    tags.add("VINCULO_INCOMPLETO");
  }
  if (args.hasNfe && !args.hasStockDocument) {
    tags.add("NF_SEM_DOCUMENTO");
  }

  for (const fact of args.facts) {
    const st = fact.status ?? "";
    if (
      st === "OVER_LINKED_BY_HEADER" ||
      st === "AMBIGUOUS_ALLOCATION" ||
      st === "DATA_QUALITY_ISSUE" ||
      st === "QUANTITY_SURPLUS_IN_NFE"
    ) {
      tags.add("DIVERGENCIA_TECNICA");
    }
    for (const a of parseAlertsJson(fact.alertsJson)) {
      const u = a.toUpperCase();
      if (
        u.includes("OVER_LINKED") ||
        u.includes("AMBIGUOUS") ||
        u.includes("DATA_QUALITY") ||
        u.includes("SURPLUS")
      ) {
        tags.add("DIVERGENCIA_TECNICA");
      }
    }
  }

  return [...tags];
}

/**
 * Constrói o mapa de atendimento a partir dos fatos materializados (sem recalcular alocação).
 */
export function buildPortfolioOrderFulfillmentMap(args: {
  facts: readonly PortfolioReconciliationFactApiRow[];
  orderValue: number;
  paymentTermsAvailable?: boolean | null;
}): PortfolioOrderFulfillmentMap {
  const facts = args.facts;
  const orderValue = round2(Math.max(0, args.orderValue));

  const itemRows = buildPortfolioOrderItemRows(facts);
  const docLinks = buildPortfolioDocumentLinkRows(facts);
  const receivables = buildPortfolioReceivableTitleRows(facts);

  const orderProductIds = new Set(
    itemRows
      .map((i) => i.externalProductId)
      .filter((id): id is number => id != null)
  );

  // Docs usados por item
  const docsByItem = new Map<
    string,
    Array<{
      nfeNumber: string | null;
      nfeExternalId: number | null;
      stockDocumentExternalId: number | null;
      allocatedQuantity: number;
    }>
  >();
  const attendedValueByItem = new Map<string, number>();

  for (const fact of facts) {
    if (!fact.salesOrderItemId) continue;
    const qty = toNumber(fact.allocatedQuantity);
    if (qty <= 0) continue;
    const list = docsByItem.get(fact.salesOrderItemId) ?? [];
    const existing = list.find(
      (d) =>
        d.nfeExternalId === fact.nfeExternalId &&
        d.stockDocumentExternalId === fact.stockDocumentExternalId
    );
    if (existing) {
      existing.allocatedQuantity = round6(existing.allocatedQuantity + qty);
    } else {
      list.push({
        nfeNumber: fact.nfeNumber,
        nfeExternalId: fact.nfeExternalId,
        stockDocumentExternalId: fact.stockDocumentExternalId,
        allocatedQuantity: round6(qty),
      });
    }
    docsByItem.set(fact.salesOrderItemId, list);
    attendedValueByItem.set(
      fact.salesOrderItemId,
      round2(
        toNumber(attendedValueByItem.get(fact.salesOrderItemId)) +
          toNumber(fact.allocatedValueByOrderPrice)
      )
    );
  }

  const orderItemsCoverage: OrderItemCoverageRow[] = itemRows.map((row) => {
    const key = row.salesOrderItemId ?? "";
    const alerts: string[] = [...row.alerts];
    if (row.remainingQuantity > 0.000001 && row.allocatedQuantity > 0) {
      alerts.push("ATENDIMENTO_PARCIAL");
    }
    if (row.allocatedQuantity <= 0 && row.orderQuantity > 0) {
      alerts.push("NAO_ATENDIDO");
    }
    return {
      salesOrderItemId: row.salesOrderItemId,
      productExternalId: row.externalProductId,
      productCode: row.productSku,
      description: row.productDescription,
      orderedQuantity: row.orderQuantity,
      attendedQuantity: row.allocatedQuantity,
      remainingQuantity: row.remainingQuantity,
      fulfillmentPercent: pct(row.allocatedQuantity, row.orderQuantity),
      orderUnitValue: row.orderUnitPrice,
      orderItemValue: row.orderItemValue,
      attendedValueByOrderPrice: attendedValueByItem.get(key) ?? round2(row.allocatedQuantity * row.orderUnitPrice),
      documentsUsed: docsByItem.get(key) ?? [],
      alerts,
    };
  });

  const totalOrderQuantity = round6(
    orderItemsCoverage.reduce((s, r) => s + r.orderedQuantity, 0)
  );
  const attendedQuantity = round6(
    orderItemsCoverage.reduce((s, r) => s + r.attendedQuantity, 0)
  );
  const remainingQuantity = round6(
    orderItemsCoverage.reduce((s, r) => s + r.remainingQuantity, 0)
  );
  const attributedOrderValue = round2(
    orderItemsCoverage.reduce((s, r) => s + r.attendedValueByOrderPrice, 0)
  );

  // Documentos
  type DocAcc = {
    nfeNumber: string | null;
    nfeExternalId: number | null;
    stockDocumentExternalId: number | null;
    date: string | null;
    nfeHeaderValue: number | null;
    valueAttributedToOrder: number;
    matchedItems: StockDocumentCoverageRow["matchedItems"];
    unmatchedItems: StockDocumentCoverageRow["unmatchedItems"];
    surplusItems: StockDocumentCoverageRow["surplusItems"];
    alerts: Set<string>;
  };

  const docMap = new Map<string, DocAcc>();

  for (const link of docLinks) {
    const key = String(
      link.nfeExternalId ?? `stock:${link.stockDocumentExternalId}`
    );
    if (!docMap.has(key)) {
      docMap.set(key, {
        nfeNumber: link.nfeNumber,
        nfeExternalId: link.nfeExternalId,
        stockDocumentExternalId: link.stockDocumentExternalId,
        date: link.stockDocumentDate ?? link.nfeProcessedAt,
        nfeHeaderValue: link.nfeHeaderValue,
        valueAttributedToOrder: link.allocatedValueToOrder,
        matchedItems: [],
        unmatchedItems: [],
        surplusItems: [],
        alerts: new Set(link.alerts),
      });
    }
  }

  for (const fact of facts) {
    if (fact.nfeExternalId == null && fact.stockDocumentExternalId == null) continue;
    const key = String(
      fact.nfeExternalId ?? `stock:${fact.stockDocumentExternalId}`
    );
    let acc = docMap.get(key);
    if (!acc) {
      acc = {
        nfeNumber: fact.nfeNumber,
        nfeExternalId: fact.nfeExternalId,
        stockDocumentExternalId: fact.stockDocumentExternalId,
        date: fact.stockDocumentDate
          ? String(fact.stockDocumentDate).slice(0, 10)
          : null,
        nfeHeaderValue: fact.nfeHeaderValue,
        valueAttributedToOrder: 0,
        matchedItems: [],
        unmatchedItems: [],
        surplusItems: [],
        alerts: new Set(),
      };
      docMap.set(key, acc);
    }

    const qty = toNumber(fact.allocatedQuantity);
    if (qty > 0 && fact.externalProductId != null) {
      const existing = acc.matchedItems.find(
        (m) => m.productExternalId === fact.externalProductId
      );
      if (existing) {
        existing.allocatedQuantity = round6(existing.allocatedQuantity + qty);
        existing.allocatedValueByOrderPrice = round2(
          existing.allocatedValueByOrderPrice +
            toNumber(fact.allocatedValueByOrderPrice)
        );
      } else {
        acc.matchedItems.push({
          productExternalId: fact.externalProductId,
          allocatedQuantity: round6(qty),
          allocatedValueByOrderPrice: round2(
            toNumber(fact.allocatedValueByOrderPrice)
          ),
        });
      }
    }

    if (fact.status === "QUANTITY_SURPLUS_IN_NFE") {
      acc.surplusItems.push({
        productExternalId: fact.externalProductId,
        stockQuantity: fact.stockQuantity,
        stockItemValue: fact.stockItemValue,
      });
      acc.alerts.add("QUANTIDADE_EXCEDENTE_DOCUMENTO");
      if (
        fact.externalProductId != null &&
        !orderProductIds.has(fact.externalProductId)
      ) {
        acc.alerts.add("PRODUTO_FORA_DO_PEDIDO");
        acc.unmatchedItems.push({
          productExternalId: fact.externalProductId,
          stockQuantity: fact.stockQuantity,
          reason: "Produto não pertence ao pedido",
        });
      }
    }

    if (
      fact.externalProductId != null &&
      !orderProductIds.has(fact.externalProductId) &&
      toNumber(fact.stockQuantity) > 0 &&
      qty <= 0
    ) {
      acc.alerts.add("PRODUTO_FORA_DO_PEDIDO");
      if (
        !acc.unmatchedItems.some(
          (u) => u.productExternalId === fact.externalProductId
        )
      ) {
        acc.unmatchedItems.push({
          productExternalId: fact.externalProductId,
          stockQuantity: fact.stockQuantity,
          reason: "Produto fora do pedido",
        });
      }
    }

    if (fact.status === "PRICE_MISMATCH") {
      acc.alerts.add("DIVERGENCIA_PRECO");
    }
    if (fact.status === "HEADER_ONLY_LINK") {
      acc.alerts.add("VINCULO_APENAS_CABECALHO");
    }
  }

  const stockDocumentsCoverage: StockDocumentCoverageRow[] = [...docMap.values()].map(
    (acc) => {
      const header = toNumber(acc.nfeHeaderValue);
      const attributed = round2(acc.valueAttributedToOrder);
      const notAttributed = round2(Math.max(0, header - attributed));
      if (header > orderValue + 0.05) {
        acc.alerts.add("NF_CABECALHO_MAIOR_PEDIDO");
      }
      return {
        nfeNumber: acc.nfeNumber,
        nfeExternalId: acc.nfeExternalId,
        stockDocumentExternalId: acc.stockDocumentExternalId,
        date: acc.date,
        nfeHeaderValue: acc.nfeHeaderValue,
        valueAttributedToOrder: attributed,
        valueNotAttributedToOrder: notAttributed,
        matchedItems: acc.matchedItems,
        unmatchedItems: acc.unmatchedItems,
        surplusItems: acc.surplusItems,
        alerts: [...acc.alerts],
      };
    }
  );

  const nfeHeaderTotal = round2(
    [...new Map(
      stockDocumentsCoverage
        .filter((d) => d.nfeExternalId != null && d.nfeHeaderValue != null)
        .map((d) => [d.nfeExternalId!, toNumber(d.nfeHeaderValue)])
    ).values()].reduce((s, v) => s + v, 0)
  );
  const nfeHeaderNotAttributed = round2(
    Math.max(0, nfeHeaderTotal - attributedOrderValue)
  );

  const withCr = facts.find((f) => f.receivableTotalValue != null);
  const receivableTotal = toNumber(withCr?.receivableTotalValue ?? receivables.summary?.receivableTotalValue);
  const receivedValue = toNumber(withCr?.receivedValue ?? receivables.summary?.receivedValue);
  const openReceivableValue = toNumber(
    withCr?.openReceivableValue ?? receivables.summary?.openReceivableValue
  );

  const sourceNfeIds = [
    ...new Set(
      facts
        .map((f) => f.nfeExternalId)
        .filter((id): id is number => id != null)
    ),
  ];

  const receivablesCoverage: ReceivableCoverageRow[] = receivables.titles.map(
    (t) => ({
      receivableId: t.receivableId,
      dueDate: t.dueDate,
      settlementDate: t.settlementDate,
      totalValue: t.amount,
      receivedValue: t.received,
      openValue: t.open,
      sourceNfe: sourceNfeIds.length === 1 ? sourceNfeIds[0]! : null,
      attributionStatus:
        t.amount != null
          ? "ORDER_AGGREGATE"
          : t.receivableId != null
            ? "TITLE_IDS_ONLY"
            : "UNAVAILABLE",
    })
  );

  if (receivablesCoverage.length === 0 && receivableTotal > 0) {
    receivablesCoverage.push({
      receivableId: null,
      dueDate: null,
      settlementDate: null,
      totalValue: receivableTotal,
      receivedValue,
      openValue: openReceivableValue,
      sourceNfe: sourceNfeIds.length === 1 ? sourceNfeIds[0]! : null,
      attributionStatus: "ORDER_AGGREGATE",
    });
  }

  const hasItemAllocation = facts.some((f) => toNumber(f.allocatedQuantity) > 0);
  const headerOnlyLink = facts.some((f) => f.status === "HEADER_ONLY_LINK");
  const hasNfe = facts.some((f) => f.nfeExternalId != null);
  const hasStockDocument = facts.some((f) => f.stockDocumentExternalId != null);
  const hasReceivable = receivableTotal > 0.01 || openReceivableValue > 0.01 || receivedValue > 0.01;
  const surplusProducts = facts.some((f) => f.status === "QUANTITY_SURPLUS_IN_NFE");
  const productsOutsideOrder = stockDocumentsCoverage.some((d) =>
    d.unmatchedItems.some(
      (u) =>
        u.productExternalId != null && !orderProductIds.has(u.productExternalId)
    )
  );
  const priceMismatch = facts.some((f) => f.status === "PRICE_MISMATCH");
  // CR ligado sem alocação itemizada confiável
  const crWithoutSafeRateio =
    hasReceivable &&
    !hasItemAllocation &&
    (hasNfe || headerOnlyLink);

  const financialStatus = resolveFinancialStatus({
    receivedValue,
    openReceivableValue,
    receivableTotalValue: receivableTotal,
    hasNfe,
    hasStockDocument,
    hasAllocation: hasItemAllocation,
  });

  const operationalStatus = resolveOperationalStatus({
    hasNfe,
    hasStockDocument,
    hasItemAllocation,
    headerOnlyLink,
    totalOrderQuantity,
    attendedQuantity,
    remainingQuantity,
  });

  const technicalAlerts = collectTechnicalAlerts({
    facts,
    orderValue,
    nfeHeaderTotal,
    hasItemAllocation,
    headerOnlyLink,
    hasNfe,
    hasStockDocument,
    hasReceivable,
    paymentTermsAvailable: args.paymentTermsAvailable,
    surplusProducts,
    productsOutsideOrder,
    priceMismatch,
    crWithoutSafeRateio,
  });

  const isFullyFulfilledByItems =
    totalOrderQuantity > 0 && remainingQuantity <= 0.000001;
  const hasHeaderInflationRisk = nfeHeaderTotal > orderValue + 0.05;

  const fulfillmentPercent = pct(attendedQuantity, totalOrderQuantity);

  const fulfillmentSummary: FulfillmentSummary = {
    orderValue,
    attributedOrderValue,
    totalOrderQuantity,
    attendedQuantity,
    remainingQuantity,
    fulfillmentPercent,
    receivableTotal,
    receivedValue,
    openReceivableValue,
    nfeHeaderTotal,
    nfeHeaderNotAttributed,
    isFullyFulfilledByItems,
    hasHeaderInflationRisk,
  };

  const executiveConclusion = buildExecutiveConclusion({
    financialStatus,
    operationalStatus,
    technicalAlerts,
    fulfillmentSummary,
  });

  return {
    financialStatus,
    operationalStatus,
    technicalAlerts,
    fulfillmentSummary,
    orderItemsCoverage,
    stockDocumentsCoverage,
    receivablesCoverage,
    executiveConclusion,
  };
}

function buildExecutiveConclusion(args: {
  financialStatus: PortfolioFinancialStatus;
  operationalStatus: PortfolioOperationalStatus;
  technicalAlerts: readonly PortfolioTechnicalAlert[];
  fulfillmentSummary: FulfillmentSummary;
}): string {
  const fin =
    args.financialStatus === "FIN_RECEBIDO"
      ? "Financeiro: já recebido."
      : args.financialStatus === "FIN_CR_ABERTO"
        ? "Financeiro: CR aberto (pode haver baixa parcial)."
        : args.financialStatus === "FIN_FATURADO_SEM_CR"
          ? "Financeiro: faturado/documento sem CR."
          : "Financeiro: ainda sem CR.";

  const pctLabel =
    args.fulfillmentSummary.fulfillmentPercent != null
      ? `${args.fulfillmentSummary.fulfillmentPercent}%`
      : "sem quantidade";

  const op =
    args.operationalStatus === "OP_TOTALMENTE_ATENDIDO_COM_EXCEDENTE"
      ? `Atendimento: ${pctLabel} dos itens cobertos — com quantidade/produto excedente nos documentos (excedente não soma carteira).`
      : args.operationalStatus === "OP_TOTALMENTE_ATENDIDO"
        ? `Atendimento: ${pctLabel} dos itens do pedido cobertos por documento de saída (itemização).`
        : args.operationalStatus === "OP_PARCIALMENTE_ATENDIDO"
          ? `Atendimento: ${pctLabel} dos itens — ainda há saldo a atender.`
          : args.operationalStatus === "OP_VINCULO_APENAS_CABECALHO"
            ? "Atendimento: só vínculo de cabeçalho de NF — sem itemização confiável."
            : args.operationalStatus === "OP_DOCUMENTO_SEM_ITEMIZACAO"
              ? "Atendimento: há documento, mas sem alocação item a item."
              : "Atendimento: pedido ainda não atendido por documento de saída.";

  const alertParts: string[] = [];
  if (args.fulfillmentSummary.hasHeaderInflationRisk) {
    alertParts.push(
      `cabeçalho de NF (R$ ${args.fulfillmentSummary.nfeHeaderTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}) é maior que o pedido (R$ ${args.fulfillmentSummary.orderValue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}) — o cabeçalho não é o valor do pedido`
    );
  }
  if (args.technicalAlerts.includes("DIVERGENCIA_PRECO")) {
    alertParts.push("há divergência de preço documento vs pedido");
  }
  if (args.technicalAlerts.includes("PRODUTO_FORA_DO_PEDIDO")) {
    alertParts.push("há produto no documento fora do pedido");
  }
  if (args.technicalAlerts.includes("QUANTIDADE_EXCEDENTE_DOCUMENTO")) {
    alertParts.push("há quantidade excedente no documento");
  }
  if (args.technicalAlerts.includes("CR_SEM_RATEIO_SEGURO")) {
    alertParts.push("CR sem rateio itemizado seguro ao pedido");
  }

  const alerts =
    alertParts.length > 0
      ? `Alertas técnicos (não somam carteira): ${alertParts.join("; ")}.`
      : "Sem alertas técnicos críticos neste mapa.";

  return `${fin} ${op} ${alerts}`;
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
