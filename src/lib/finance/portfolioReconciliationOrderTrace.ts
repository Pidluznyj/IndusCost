/**
 * View-model read-only de rastreabilidade por pedido (drawer Conciliação de Carteira).
 * Agrega fatos materializados — não recalcula alocação nem grava dados.
 */

import {
  aggregateFactsToOrderRows,
  parseAlertsJson,
  parseIdListJson,
  sanitizeTraceJson,
  serializeRunMeta,
  type PortfolioReconciliationFactApiRow,
  type PortfolioReconciliationOrderRow,
  type PortfolioReconciliationRunMeta,
} from "./portfolioReconciliationApi.js";

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

function statusPriority(status: string): number {
  const order = [
    "DATA_QUALITY_ISSUE",
    "AMBIGUOUS_ALLOCATION",
    "PRICE_MISMATCH",
    "QUANTITY_SURPLUS_IN_NFE",
    "OVER_LINKED_BY_HEADER",
    "PARTIALLY_ALLOCATED",
    "HEADER_ONLY_LINK",
    "ORDER_ONLY",
    "ITEM_ALLOCATED",
    "FULLY_ALLOCATED",
    "RECEIVABLE_CONFIRMED",
    "RECEIVED",
  ];
  const idx = order.indexOf(status);
  return idx >= 0 ? idx : 50;
}

function pickDominantStatus(current: string | null, next: string | null): string {
  const a = current ?? "ORDER_ONLY";
  const b = next ?? "ORDER_ONLY";
  return statusPriority(a) <= statusPriority(b) ? a : b;
}

export type PortfolioOrderItemTraceRow = {
  salesOrderItemId: string | null;
  externalProductId: number | null;
  productSku: string | null;
  productDescription: string | null;
  orderQuantity: number;
  orderUnitPrice: number;
  orderItemValue: number;
  allocatedQuantity: number;
  remainingQuantity: number;
  status: string;
  alerts: string[];
};

export type PortfolioDocumentLinkTraceRow = {
  nfeNumber: string | null;
  nfeExternalId: number | null;
  nfeProcessedAt: string | null;
  nfeHeaderValue: number | null;
  stockDocumentExternalId: number | null;
  stockDocumentDate: string | null;
  allocatedValueToOrder: number;
  surplusOrUnallocatedValue: number;
  headerOnly: boolean;
  alerts: string[];
  productsAllocated: number[];
  productsSurplus: number[];
};

export type PortfolioAllocationTraceRow = {
  factId: string;
  externalProductId: number | null;
  productSku: string | null;
  nfeExternalId: number | null;
  nfeNumber: string | null;
  stockDocumentExternalId: number | null;
  orderQuantity: number | null;
  documentQuantity: number | null;
  allocatedQuantity: number | null;
  orderUnitPrice: number | null;
  documentUnitPrice: number | null;
  unitDifference: number | null;
  totalDifference: number | null;
  allocatedValueByOrderPrice: number | null;
  allocatedValueByStockPrice: number | null;
  status: string | null;
  alerts: string[];
};

export type PortfolioReceivableTraceRow = {
  receivableId: number | null;
  label: string;
  amount: number | null;
  dueDate: string | null;
  settlementDate: string | null;
  received: number | null;
  open: number | null;
  status: string;
};

export type PortfolioTimelineTraceEvent = {
  at: string;
  kind: string;
  label: string;
};

export type PortfolioTechnicalTrace = {
  salesOrderId: string | null;
  externalSalesOrderId: number | null;
  orderCode: string | null;
  customerExternalId: number | null;
  nfeExternalIds: number[];
  stockDocumentExternalIds: number[];
  receivableIds: number[];
  links: Array<{ from: string; to: string; via: string }>;
  sanitizedTraces: Array<{
    factId: string;
    status: string | null;
    confidenceLevel: string;
    trace: Record<string, unknown> | null;
  }>;
};

export type PortfolioOrderTraceViewModel = {
  salesOrderId: string;
  run: ReturnType<typeof serializeRunMeta> | null;
  order: PortfolioReconciliationOrderRow | null;
  header: {
    order: PortfolioReconciliationOrderRow | null;
    orderIssueDate: string | null;
    expectedDeliveryDate: string | null;
    externalSalesOrderId: number | null;
    primaryAlerts: string[];
  };
  orderItems: PortfolioOrderItemTraceRow[];
  documentLinks: PortfolioDocumentLinkTraceRow[];
  allocations: PortfolioAllocationTraceRow[];
  receivableTitles: PortfolioReceivableTraceRow[];
  receivablesSummary: {
    receivableIds: number[];
    receivableTotalValue: number;
    receivedValue: number;
    openReceivableValue: number;
  } | null;
  timeline: PortfolioTimelineTraceEvent[];
  technical: PortfolioTechnicalTrace;
  managerNotes: string[];
  alertas: string[];
  /** Compatibilidade com payload anterior do drawer. */
  items: PortfolioOrderItemTraceRow[];
  linkedNfes: PortfolioDocumentLinkTraceRow[];
  stockDocuments: Array<{
    stockDocumentId: string | null;
    stockDocumentExternalId: number | null;
    stockDocumentDate: string | null;
    nfeExternalId: number | null;
  }>;
  allocatedItems: PortfolioAllocationTraceRow[];
  receivables: {
    receivableIds: number[];
    receivableTotalValue: number;
    receivedValue: number;
    openReceivableValue: number;
    dueDates: unknown;
    settlementDates: unknown;
  } | null;
  traces: PortfolioTechnicalTrace["sanitizedTraces"];
};

export function buildPortfolioOrderManagerNotes(
  facts: readonly PortfolioReconciliationFactApiRow[],
  order: PortfolioReconciliationOrderRow | null
): string[] {
  const notes: string[] = [];
  if (!facts.length) return notes;

  if (order) {
    notes.push(
      `Pedido ${order.pedido ?? "—"} com valor materializado de R$ ${order.valorPedido.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (soma dos itens do pedido, não a soma dos cabeçalhos de NF).`
    );
  }

  const nfeNumbers = new Map<number, string | null>();
  const headerSumByNfe = new Map<number, number>();
  for (const fact of facts) {
    if (fact.nfeExternalId == null) continue;
    nfeNumbers.set(fact.nfeExternalId, fact.nfeNumber);
    if (fact.nfeHeaderValue != null && !headerSumByNfe.has(fact.nfeExternalId)) {
      headerSumByNfe.set(fact.nfeExternalId, toNumber(fact.nfeHeaderValue));
    }
  }
  if (nfeNumbers.size > 0) {
    const labels = [...nfeNumbers.entries()]
      .map(([id, num]) => num ?? String(id))
      .join(", ");
    notes.push(`NFs vinculadas: ${labels}.`);
  }

  const headerTotal = [...headerSumByNfe.values()].reduce((s, v) => s + v, 0);
  if (order && headerTotal > 0) {
    notes.push(
      `Soma dos cabeçalhos das NFs = R$ ${headerTotal.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} — este total não é o valor do pedido.`
    );
  }

  const byNfeProduct = new Map<string, PortfolioReconciliationFactApiRow[]>();
  for (const fact of facts) {
    if (fact.nfeExternalId == null || fact.externalProductId == null) continue;
    if ((fact.allocatedQuantity ?? 0) <= 0 && fact.status !== "QUANTITY_SURPLUS_IN_NFE") {
      continue;
    }
    const key = `${fact.nfeExternalId}:${fact.externalProductId}`;
    const list = byNfeProduct.get(key) ?? [];
    list.push(fact);
    byNfeProduct.set(key, list);
  }

  const mismatchByNfe = new Map<number, number[]>();
  for (const fact of facts) {
    if (fact.status !== "PRICE_MISMATCH" || fact.nfeExternalId == null) continue;
    if (fact.externalProductId == null) continue;
    const list = mismatchByNfe.get(fact.nfeExternalId) ?? [];
    if (!list.includes(fact.externalProductId)) list.push(fact.externalProductId);
    mismatchByNfe.set(fact.nfeExternalId, list);
  }
  for (const [nfeId, products] of mismatchByNfe) {
    const sample = facts.find(
      (f) =>
        f.nfeExternalId === nfeId &&
        f.status === "PRICE_MISMATCH" &&
        (f.allocatedQuantity ?? 0) > 0
    );
    const nfeLabel = nfeNumbers.get(nfeId) ?? String(nfeId);
    const orderUnit = sample?.orderUnitPrice;
    const docUnit = sample?.stockUnitValue;
    notes.push(
      `NF ${nfeLabel} atende produto(s) ${products.join(", ")} em quantidade` +
        (orderUnit != null && docUnit != null
          ? `, com preço documento ${docUnit} vs pedido ${orderUnit}.`
          : ", com divergência de preço.")
    );
  }

  for (const fact of facts) {
    if (fact.status !== "ITEM_ALLOCATED" && fact.status !== "PARTIALLY_ALLOCATED") continue;
    if (fact.nfeExternalId == null || fact.externalProductId == null) continue;
    if ((fact.allocatedQuantity ?? 0) <= 0) continue;
    const orderQty = toNumber(fact.orderQuantity);
    const allocated = toNumber(fact.allocatedQuantity);
    const docQty = toNumber(fact.stockQuantity);
    if (orderQty > 0 && docQty > allocated && allocated === orderQty) {
      const nfeLabel = nfeNumbers.get(fact.nfeExternalId) ?? String(fact.nfeExternalId);
      notes.push(
        `NF ${nfeLabel} atende produto ${fact.externalProductId} parcialmente até o saldo do pedido (alocado ${allocated} de ${docQty} no documento; saldo do pedido ${orderQty}).`
      );
    }
  }

  const surplusLater = facts.filter((f) => f.status === "QUANTITY_SURPLUS_IN_NFE");
  if (surplusLater.length > 0) {
    const byNfe = new Map<number, number[]>();
    for (const fact of surplusLater) {
      if (fact.nfeExternalId == null || fact.externalProductId == null) continue;
      const list = byNfe.get(fact.nfeExternalId) ?? [];
      if (!list.includes(fact.externalProductId)) list.push(fact.externalProductId);
      byNfe.set(fact.nfeExternalId, list);
    }
    for (const [nfeId, products] of byNfe) {
      const nfeLabel = nfeNumbers.get(nfeId) ?? String(nfeId);
      notes.push(
        `NF ${nfeLabel} não consome novamente itens já atendidos (excedente em produto(s) ${products.join(", ")}).`
      );
    }
  }

  return notes;
}

export function buildPortfolioOrderItemRows(
  facts: readonly PortfolioReconciliationFactApiRow[]
): PortfolioOrderItemTraceRow[] {
  type Acc = {
    salesOrderItemId: string | null;
    externalProductId: number | null;
    productSku: string | null;
    productDescription: string | null;
    orderQuantity: number;
    orderUnitPrice: number;
    orderItemValue: number;
    allocatedQuantity: number;
    remainingQuantity: number | null;
    status: string;
    alerts: Set<string>;
  };

  const map = new Map<string, Acc>();

  for (const fact of facts) {
    const key = fact.salesOrderItemId;
    if (!key) continue;

    let acc = map.get(key);
    if (!acc) {
      acc = {
        salesOrderItemId: fact.salesOrderItemId,
        externalProductId: fact.externalProductId,
        productSku: fact.productSkuSnapshot,
        productDescription: fact.productNameSnapshot,
        orderQuantity: toNumber(fact.orderQuantity),
        orderUnitPrice: toNumber(fact.orderUnitPrice),
        orderItemValue: toNumber(fact.orderItemValue),
        allocatedQuantity: 0,
        remainingQuantity: null,
        status: fact.status ?? "ORDER_ONLY",
        alerts: new Set(),
      };
      map.set(key, acc);
    }

    if (fact.orderQuantity != null) acc.orderQuantity = toNumber(fact.orderQuantity);
    if (fact.orderUnitPrice != null) acc.orderUnitPrice = toNumber(fact.orderUnitPrice);
    if (fact.orderItemValue != null) acc.orderItemValue = toNumber(fact.orderItemValue);
    if (!acc.productSku && fact.productSkuSnapshot) acc.productSku = fact.productSkuSnapshot;
    if (!acc.productDescription && fact.productNameSnapshot) {
      acc.productDescription = fact.productNameSnapshot;
    }

    acc.allocatedQuantity += toNumber(fact.allocatedQuantity);
    if (fact.remainingOrderQuantityAfterAllocation != null) {
      const rem = toNumber(fact.remainingOrderQuantityAfterAllocation);
      acc.remainingQuantity =
        acc.remainingQuantity == null ? rem : Math.min(acc.remainingQuantity, rem);
    }
    acc.status = pickDominantStatus(acc.status, fact.status);
    for (const a of parseAlertsJson(fact.alertsJson)) acc.alerts.add(a);
  }

  return [...map.values()]
    .map((acc) => {
      const remaining =
        acc.remainingQuantity != null
          ? acc.remainingQuantity
          : Math.max(0, acc.orderQuantity - acc.allocatedQuantity);
      return {
        salesOrderItemId: acc.salesOrderItemId,
        externalProductId: acc.externalProductId,
        productSku: acc.productSku,
        productDescription: acc.productDescription,
        orderQuantity: round6(acc.orderQuantity),
        orderUnitPrice: round6(acc.orderUnitPrice),
        orderItemValue: round2(acc.orderItemValue),
        allocatedQuantity: round6(acc.allocatedQuantity),
        remainingQuantity: round6(remaining),
        status: acc.status,
        alerts: [...acc.alerts],
      };
    })
    .sort((a, b) => (a.externalProductId ?? 0) - (b.externalProductId ?? 0));
}

export function buildPortfolioDocumentLinkRows(
  facts: readonly PortfolioReconciliationFactApiRow[]
): PortfolioDocumentLinkTraceRow[] {
  type Acc = {
    nfeNumber: string | null;
    nfeExternalId: number | null;
    nfeProcessedAt: string | null;
    nfeHeaderValue: number | null;
    stockDocumentExternalId: number | null;
    stockDocumentDate: string | null;
    allocatedValueToOrder: number;
    surplusOrUnallocatedValue: number;
    headerOnly: boolean;
    alerts: Set<string>;
    productsAllocated: Set<number>;
    productsSurplus: Set<number>;
  };

  const map = new Map<string, Acc>();

  for (const fact of facts) {
    if (fact.nfeExternalId == null && fact.stockDocumentExternalId == null) continue;
    const key = String(
      fact.nfeExternalId ?? `stock:${fact.stockDocumentExternalId ?? fact.stockDocumentId}`
    );
    let acc = map.get(key);
    if (!acc) {
      acc = {
        nfeNumber: fact.nfeNumber,
        nfeExternalId: fact.nfeExternalId,
        nfeProcessedAt: toIsoDate(fact.nfeProcessedAt),
        nfeHeaderValue: fact.nfeHeaderValue,
        stockDocumentExternalId: fact.stockDocumentExternalId,
        stockDocumentDate: toIsoDate(fact.stockDocumentDate),
        allocatedValueToOrder: 0,
        surplusOrUnallocatedValue: 0,
        headerOnly: fact.status === "HEADER_ONLY_LINK",
        alerts: new Set(),
        productsAllocated: new Set(),
        productsSurplus: new Set(),
      };
      map.set(key, acc);
    }

    if (!acc.nfeNumber && fact.nfeNumber) acc.nfeNumber = fact.nfeNumber;
    if (!acc.nfeProcessedAt) acc.nfeProcessedAt = toIsoDate(fact.nfeProcessedAt);
    if (acc.nfeHeaderValue == null && fact.nfeHeaderValue != null) {
      acc.nfeHeaderValue = fact.nfeHeaderValue;
    }
    if (!acc.stockDocumentExternalId && fact.stockDocumentExternalId != null) {
      acc.stockDocumentExternalId = fact.stockDocumentExternalId;
    }
    if (!acc.stockDocumentDate) acc.stockDocumentDate = toIsoDate(fact.stockDocumentDate);
    if (fact.status === "HEADER_ONLY_LINK") acc.headerOnly = true;

    acc.allocatedValueToOrder += toNumber(fact.allocatedValueByOrderPrice);
    if (fact.status === "QUANTITY_SURPLUS_IN_NFE" || fact.status === "OVER_LINKED_BY_HEADER") {
      acc.surplusOrUnallocatedValue +=
        toNumber(fact.stockItemValue) || toNumber(fact.allocatedValueByStockPrice);
    }
    if (fact.externalProductId != null && (fact.allocatedQuantity ?? 0) > 0) {
      acc.productsAllocated.add(fact.externalProductId);
    }
    if (fact.externalProductId != null && fact.status === "QUANTITY_SURPLUS_IN_NFE") {
      acc.productsSurplus.add(fact.externalProductId);
    }
    for (const a of parseAlertsJson(fact.alertsJson)) acc.alerts.add(a);
  }

  return [...map.values()]
    .map((acc) => ({
      nfeNumber: acc.nfeNumber,
      nfeExternalId: acc.nfeExternalId,
      nfeProcessedAt: acc.nfeProcessedAt,
      nfeHeaderValue: acc.nfeHeaderValue,
      stockDocumentExternalId: acc.stockDocumentExternalId,
      stockDocumentDate: acc.stockDocumentDate,
      allocatedValueToOrder: round2(acc.allocatedValueToOrder),
      surplusOrUnallocatedValue: round2(acc.surplusOrUnallocatedValue),
      headerOnly: acc.headerOnly,
      alerts: [...acc.alerts],
      productsAllocated: [...acc.productsAllocated].sort((a, b) => a - b),
      productsSurplus: [...acc.productsSurplus].sort((a, b) => a - b),
    }))
    .sort((a, b) => (a.nfeExternalId ?? 0) - (b.nfeExternalId ?? 0));
}

export function buildPortfolioAllocationRows(
  facts: readonly PortfolioReconciliationFactApiRow[]
): PortfolioAllocationTraceRow[] {
  return facts
    .filter(
      (fact) =>
        fact.allocatedQuantity != null ||
        fact.stockDocumentItemId != null ||
        fact.status === "QUANTITY_SURPLUS_IN_NFE" ||
        fact.status === "PRICE_MISMATCH" ||
        fact.status === "ITEM_ALLOCATED"
    )
    .map((fact) => ({
      factId: fact.id,
      externalProductId: fact.externalProductId,
      productSku: fact.productSkuSnapshot,
      nfeExternalId: fact.nfeExternalId,
      nfeNumber: fact.nfeNumber,
      stockDocumentExternalId: fact.stockDocumentExternalId,
      orderQuantity: fact.orderQuantity,
      documentQuantity: fact.stockQuantity,
      allocatedQuantity: fact.allocatedQuantity,
      orderUnitPrice: fact.orderUnitPrice,
      documentUnitPrice: fact.stockUnitValue,
      unitDifference: fact.priceDifferenceUnit,
      totalDifference: fact.priceDifferenceTotal,
      allocatedValueByOrderPrice: fact.allocatedValueByOrderPrice,
      allocatedValueByStockPrice: fact.allocatedValueByStockPrice,
      status: fact.status,
      alerts: parseAlertsJson(fact.alertsJson),
    }));
}

export function buildPortfolioReceivableTitleRows(
  facts: readonly PortfolioReconciliationFactApiRow[]
): {
  titles: PortfolioReceivableTraceRow[];
  summary: PortfolioOrderTraceViewModel["receivablesSummary"];
  raw: PortfolioOrderTraceViewModel["receivables"];
} {
  const withCr = facts.find((f) => f.receivableTotalValue != null);
  if (!withCr) {
    return { titles: [], summary: null, raw: null };
  }

  const ids = parseIdListJson(withCr.receivableIdsJson);
  const dueDates = Array.isArray(withCr.dueDatesJson) ? withCr.dueDatesJson : [];
  const settlements = Array.isArray(withCr.settlementDatesJson)
    ? withCr.settlementDatesJson
    : [];

  const titles: PortfolioReceivableTraceRow[] = ids.map((id, idx) => {
    const due =
      typeof dueDates[idx] === "string"
        ? String(dueDates[idx]).slice(0, 10)
        : toIsoDate(dueDates[idx] as string | null);
    const settle =
      typeof settlements[idx] === "string"
        ? String(settlements[idx]).slice(0, 10)
        : toIsoDate(settlements[idx] as string | null);
    const status = settle ? "RECEIVED" : due ? "OPEN" : "UNKNOWN";
    return {
      receivableId: id,
      label: `Título ${id}`,
      amount: null,
      dueDate: due,
      settlementDate: settle,
      received: null,
      open: null,
      status,
    };
  });

  if (titles.length === 0) {
    titles.push({
      receivableId: null,
      label: "CR agregado do pedido",
      amount: toNumber(withCr.receivableTotalValue),
      dueDate:
        typeof dueDates[0] === "string"
          ? String(dueDates[0]).slice(0, 10)
          : toIsoDate(dueDates[0] as string | null),
      settlementDate:
        typeof settlements[0] === "string"
          ? String(settlements[0]).slice(0, 10)
          : toIsoDate(settlements[0] as string | null),
      received: toNumber(withCr.receivedValue),
      open: toNumber(withCr.openReceivableValue),
      status: toNumber(withCr.openReceivableValue) <= 0 ? "RECEIVED" : "OPEN",
    });
  } else {
    // Totais só no resumo — títulos individuais sem rateio inventado.
    for (const title of titles) {
      title.amount = null;
      title.received = null;
      title.open = null;
    }
  }

  const summary = {
    receivableIds: ids,
    receivableTotalValue: toNumber(withCr.receivableTotalValue),
    receivedValue: toNumber(withCr.receivedValue),
    openReceivableValue: toNumber(withCr.openReceivableValue),
  };

  return {
    titles,
    summary,
    raw: {
      ...summary,
      dueDates: withCr.dueDatesJson ?? null,
      settlementDates: withCr.settlementDatesJson ?? null,
    },
  };
}

export function buildPortfolioOrderTimeline(
  facts: readonly PortfolioReconciliationFactApiRow[]
): PortfolioTimelineTraceEvent[] {
  const events: Array<PortfolioTimelineTraceEvent & { sort: number }> = [];
  const first = facts[0];
  if (first) {
    const orderAt = toIsoDate(first.orderIssueDate);
    if (orderAt) {
      events.push({
        at: orderAt,
        kind: "ORDER_ISSUE",
        label: `Emissão do pedido ${first.orderCode ?? ""}`.trim(),
        sort: 1,
      });
    }
    const deliveryAt = toIsoDate(first.expectedDeliveryDate);
    if (deliveryAt) {
      events.push({
        at: deliveryAt,
        kind: "ORDER_DELIVERY",
        label: "Entrega prevista",
        sort: 2,
      });
    }
  }

  const seenNfe = new Set<string>();
  const seenStock = new Set<string>();
  const seenDue = new Set<string>();
  const seenSettle = new Set<string>();

  for (const fact of facts) {
    if (fact.nfeExternalId != null) {
      const key = String(fact.nfeExternalId);
      if (!seenNfe.has(key)) {
        seenNfe.add(key);
        const at = toIsoDate(fact.nfeProcessedAt) ?? toIsoDate(fact.stockDocumentDate);
        if (at) {
          events.push({
            at,
            kind: "NFE",
            label: `NF emitida ${fact.nfeNumber ?? fact.nfeExternalId}`,
            sort: 3,
          });
        }
      }
    }
    if (fact.stockDocumentExternalId != null) {
      const key = String(fact.stockDocumentExternalId);
      if (!seenStock.has(key)) {
        seenStock.add(key);
        const at = toIsoDate(fact.stockDocumentDate);
        if (at) {
          events.push({
            at,
            kind: "STOCK_DOCUMENT",
            label: `Documento de estoque ${fact.stockDocumentExternalId}`,
            sort: 4,
          });
        }
      }
    }
    if (Array.isArray(fact.dueDatesJson)) {
      for (const due of fact.dueDatesJson) {
        const at =
          typeof due === "string" ? due.slice(0, 10) : due ? toIsoDate(due as string) : null;
        if (at && !seenDue.has(at)) {
          seenDue.add(at);
          events.push({ at, kind: "RECEIVABLE_DUE", label: `Vencimento CR ${at}`, sort: 5 });
        }
      }
    }
    if (Array.isArray(fact.settlementDatesJson)) {
      for (const settle of fact.settlementDatesJson) {
        const at =
          typeof settle === "string"
            ? settle.slice(0, 10)
            : settle
              ? toIsoDate(settle as string)
              : null;
        if (at && !seenSettle.has(at)) {
          seenSettle.add(at);
          events.push({ at, kind: "RECEIVABLE_SETTLED", label: `Recebimento ${at}`, sort: 6 });
        }
      }
    }
  }

  const seen = new Set<string>();
  return events
    .filter((e) => {
      const key = `${e.kind}:${e.at}:${e.label}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.at.localeCompare(b.at) || a.sort - b.sort)
    .map(({ at, kind, label }) => ({ at, kind, label }));
}

export function buildPortfolioTechnicalTrace(
  salesOrderId: string,
  facts: readonly PortfolioReconciliationFactApiRow[]
): PortfolioTechnicalTrace {
  const first = facts[0];
  const nfeExternalIds = [
    ...new Set(facts.map((f) => f.nfeExternalId).filter((v): v is number => v != null)),
  ].sort((a, b) => a - b);
  const stockDocumentExternalIds = [
    ...new Set(
      facts.map((f) => f.stockDocumentExternalId).filter((v): v is number => v != null)
    ),
  ].sort((a, b) => a - b);
  const receivableIds = [
    ...new Set(facts.flatMap((f) => parseIdListJson(f.receivableIdsJson))),
  ].sort((a, b) => a - b);

  const links: PortfolioTechnicalTrace["links"] = [];
  for (const nfeId of nfeExternalIds) {
    links.push({
      from: `pedido:${first?.orderCode ?? salesOrderId}`,
      to: `nfe:${nfeId}`,
      via: "vínculo pedido↔NF",
    });
  }
  for (const fact of facts) {
    if (fact.nfeExternalId != null && fact.stockDocumentExternalId != null) {
      const link = {
        from: `nfe:${fact.nfeExternalId}`,
        to: `estoque:${fact.stockDocumentExternalId}`,
        via: "documento de estoque da NF",
      };
      if (!links.some((l) => l.from === link.from && l.to === link.to)) links.push(link);
    }
  }
  for (const id of receivableIds) {
    links.push({
      from: `pedido:${first?.orderCode ?? salesOrderId}`,
      to: `cr:${id}`,
      via: "contas a receber vinculadas",
    });
  }

  const sanitizedTraces = facts
    .map((fact) => ({
      factId: fact.id,
      status: fact.status,
      confidenceLevel: fact.confidenceLevel,
      trace: sanitizeTraceJson(fact.traceJson),
    }))
    .filter((t) => t.trace != null);

  return {
    salesOrderId: first?.salesOrderId ?? salesOrderId,
    externalSalesOrderId: first?.externalSalesOrderId ?? null,
    orderCode: first?.orderCode ?? null,
    customerExternalId: first?.customerExternalId ?? null,
    nfeExternalIds,
    stockDocumentExternalIds,
    receivableIds,
    links,
    sanitizedTraces,
  };
}

export function buildPortfolioOrderTraceViewModel(
  salesOrderId: string,
  facts: readonly PortfolioReconciliationFactApiRow[],
  run: PortfolioReconciliationRunMeta | null
): PortfolioOrderTraceViewModel {
  const orderRows = aggregateFactsToOrderRows(facts);
  const order = orderRows[0] ?? null;
  const alertas = [
    ...new Set(facts.flatMap((f) => parseAlertsJson(f.alertsJson))),
  ];
  const orderItems = buildPortfolioOrderItemRows(facts);
  const documentLinks = buildPortfolioDocumentLinkRows(facts);
  const allocations = buildPortfolioAllocationRows(facts);
  const receivableBlock = buildPortfolioReceivableTitleRows(facts);
  const timeline = buildPortfolioOrderTimeline(facts);
  const technical = buildPortfolioTechnicalTrace(salesOrderId, facts);
  const managerNotes = buildPortfolioOrderManagerNotes(facts, order);
  const first = facts[0];

  const stockDocuments = [
    ...new Map(
      facts
        .filter((f) => f.stockDocumentExternalId != null || f.stockDocumentId != null)
        .map((f) => [
          String(f.stockDocumentExternalId ?? f.stockDocumentId),
          {
            stockDocumentId: f.stockDocumentId,
            stockDocumentExternalId: f.stockDocumentExternalId,
            stockDocumentDate: toIsoDate(f.stockDocumentDate),
            nfeExternalId: f.nfeExternalId,
          },
        ])
    ).values(),
  ];

  return {
    salesOrderId,
    run: run ? serializeRunMeta(run) : null,
    order,
    header: {
      order,
      orderIssueDate: toIsoDate(first?.orderIssueDate),
      expectedDeliveryDate: toIsoDate(first?.expectedDeliveryDate),
      externalSalesOrderId: first?.externalSalesOrderId ?? null,
      primaryAlerts: alertas.slice(0, 5),
    },
    orderItems,
    documentLinks,
    allocations,
    receivableTitles: receivableBlock.titles,
    receivablesSummary: receivableBlock.summary,
    timeline,
    technical,
    managerNotes,
    alertas,
    items: orderItems,
    linkedNfes: documentLinks,
    stockDocuments,
    allocatedItems: allocations,
    receivables: receivableBlock.raw,
    traces: technical.sanitizedTraces,
  };
}

/** Converte draft do motor de alocação em linha de API para testes/fixtures. */
export function portfolioFactDraftToApiRow(
  draft: {
    runId: string;
    customerId: string | null;
    customerExternalId: number | null;
    customerNameSnapshot: string | null;
    salesOrderId: string | null;
    externalSalesOrderId: number | null;
    orderCode: string | null;
    orderIssueDate: Date | null;
    expectedDeliveryDate: Date | null;
    salesOrderItemId: string | null;
    externalSalesOrderItemId: number | null;
    externalProductId: number | null;
    productSkuSnapshot: string | null;
    productNameSnapshot: string | null;
    orderQuantity: number | null;
    orderUnitPrice: number | null;
    orderItemValue: number | null;
    nomusNfeId: string | null;
    nfeExternalId: number | null;
    nfeNumber: string | null;
    nfeSerie: string | null;
    nfeKey: string | null;
    nfeProcessedAt: Date | null;
    nfeHeaderValue: number | null;
    stockDocumentId: string | null;
    stockDocumentExternalId: number | null;
    stockDocumentItemId: string | null;
    stockDocumentItemExternalId: number | null;
    stockDocumentDate: Date | null;
    stockQuantity: number | null;
    stockUnitValue: number | null;
    stockItemValue: number | null;
    allocatedQuantity: number | null;
    allocatedValueByOrderPrice: number | null;
    allocatedValueByStockPrice: number | null;
    remainingOrderQuantityAfterAllocation: number | null;
    remainingOrderValueAfterAllocation: number | null;
    priceDifferenceUnit: number | null;
    priceDifferenceTotal: number | null;
    receivableIdsJson: number[] | null;
    receivableTotalValue: number | null;
    receivedValue: number | null;
    openReceivableValue: number | null;
    dueDatesJson: Array<string | null> | null;
    settlementDatesJson: Array<string | null> | null;
    forecastSource: string;
    forecastDate: Date | null;
    forecastValue: number | null;
    confidenceLevel: string;
    status: string;
    alertsJson: string[];
    traceJson: Record<string, unknown>;
  },
  id: string
): PortfolioReconciliationFactApiRow {
  return {
    id,
    runId: draft.runId,
    customerId: draft.customerId,
    customerExternalId: draft.customerExternalId,
    customerNameSnapshot: draft.customerNameSnapshot,
    salesOrderId: draft.salesOrderId,
    externalSalesOrderId: draft.externalSalesOrderId,
    orderCode: draft.orderCode,
    orderIssueDate: draft.orderIssueDate,
    expectedDeliveryDate: draft.expectedDeliveryDate,
    salesOrderItemId: draft.salesOrderItemId,
    externalSalesOrderItemId: draft.externalSalesOrderItemId,
    externalProductId: draft.externalProductId,
    productSkuSnapshot: draft.productSkuSnapshot,
    productNameSnapshot: draft.productNameSnapshot,
    orderQuantity: draft.orderQuantity,
    orderUnitPrice: draft.orderUnitPrice,
    orderItemValue: draft.orderItemValue,
    nomusNfeId: draft.nomusNfeId,
    nfeExternalId: draft.nfeExternalId,
    nfeNumber: draft.nfeNumber,
    nfeSerie: draft.nfeSerie,
    nfeKey: draft.nfeKey,
    nfeProcessedAt: draft.nfeProcessedAt,
    nfeHeaderValue: draft.nfeHeaderValue,
    stockDocumentId: draft.stockDocumentId,
    stockDocumentExternalId: draft.stockDocumentExternalId,
    stockDocumentItemId: draft.stockDocumentItemId,
    stockDocumentItemExternalId: draft.stockDocumentItemExternalId,
    stockDocumentDate: draft.stockDocumentDate,
    stockQuantity: draft.stockQuantity,
    stockUnitValue: draft.stockUnitValue,
    stockItemValue: draft.stockItemValue,
    allocatedQuantity: draft.allocatedQuantity,
    allocatedValueByOrderPrice: draft.allocatedValueByOrderPrice,
    allocatedValueByStockPrice: draft.allocatedValueByStockPrice,
    remainingOrderQuantityAfterAllocation: draft.remainingOrderQuantityAfterAllocation,
    remainingOrderValueAfterAllocation: draft.remainingOrderValueAfterAllocation,
    priceDifferenceUnit: draft.priceDifferenceUnit,
    priceDifferenceTotal: draft.priceDifferenceTotal,
    receivableIdsJson: draft.receivableIdsJson,
    receivableTotalValue: draft.receivableTotalValue,
    receivedValue: draft.receivedValue,
    openReceivableValue: draft.openReceivableValue,
    dueDatesJson: draft.dueDatesJson,
    settlementDatesJson: draft.settlementDatesJson,
    forecastSource: draft.forecastSource,
    forecastDate: draft.forecastDate,
    forecastValue: draft.forecastValue,
    confidenceLevel: draft.confidenceLevel,
    status: draft.status,
    alertsJson: draft.alertsJson,
    traceJson: draft.traceJson,
  };
}
