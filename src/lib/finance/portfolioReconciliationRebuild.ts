/**
 * Lógica pura do rebuild manual de PortfolioReconciliationFact.
 * Preview não grava; apply só escreve Run + Fact (camada paralela).
 */

import { randomUUID } from "node:crypto";
import type {
  PortfolioFactStatus,
  PortfolioReconciliationFactDraft,
  PortfolioReconciliationMode,
  PortfolioReconciliationSnapshot,
} from "./portfolioReconciliationAllocationEngine.js";

export type RebuildPortfolioCliOptions = {
  mode: PortfolioReconciliationMode;
  fromDate: Date | null;
  toDate: Date | null;
  customerExternalId: number | null;
  orderCode: string | null;
  runId: string | null;
  maxOrders: number | null;
  explain: boolean;
  replaceLatest: boolean;
};

export type PortfolioRebuildSummary = {
  ordersAnalyzed: number;
  ordersOrderOnly: number;
  ordersWithNfe: number;
  ordersWithStockDocument: number;
  ordersWithReceivable: number;
  factsGenerated: number;
  alertCount: number;
  divergenceCount: number;
  totalOrderValue: number;
  totalAllocatedValue: number;
  totalReceivableValue: number;
  projectedOpenBalance: number;
  statusCounts: Record<string, number>;
  alertSamples: string[];
};

export type PortfolioRebuildFilterKey = {
  fromDate: string | null;
  toDate: string | null;
  customerExternalId: number | null;
  orderCode: string | null;
};

function parseIsoDate(raw: string, label: string): Date {
  const trimmed = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new Error(`${label} inválida: "${raw}". Use YYYY-MM-DD.`);
  }
  const [y, m, d] = trimmed.split("-").map((part) => Number.parseInt(part, 10));
  const date = new Date(y!, m! - 1, d!, 0, 0, 0, 0);
  if (date.getFullYear() !== y || date.getMonth() !== m! - 1 || date.getDate() !== d) {
    throw new Error(`${label} inválida: "${raw}".`);
  }
  return date;
}

export function parseRebuildPortfolioCli(argv: string[]): RebuildPortfolioCliOptions {
  const mode: PortfolioReconciliationMode =
    argv.includes("apply") || argv.includes("--apply") ? "apply" : "preview";

  let fromDate: Date | null = null;
  let toDate: Date | null = null;
  let customerExternalId: number | null = null;
  let orderCode: string | null = null;
  let runId: string | null = null;
  let maxOrders: number | null = null;
  let explain = false;
  let replaceLatest = false;

  for (const arg of argv) {
    if (arg.startsWith("--from=")) {
      fromDate = parseIsoDate(arg.slice("--from=".length), "--from");
      continue;
    }
    if (arg.startsWith("--to=")) {
      toDate = parseIsoDate(arg.slice("--to=".length), "--to");
      continue;
    }
    if (arg.startsWith("--customerExternalId=")) {
      const n = Number.parseInt(arg.slice("--customerExternalId=".length), 10);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`--customerExternalId inválido: ${arg}`);
      customerExternalId = n;
      continue;
    }
    if (arg.startsWith("--orderCode=")) {
      orderCode = arg.slice("--orderCode=".length).trim() || null;
      continue;
    }
    if (arg.startsWith("--runId=")) {
      runId = arg.slice("--runId=".length).trim() || null;
      continue;
    }
    if (arg.startsWith("--max-orders=")) {
      const n = Number.parseInt(arg.slice("--max-orders=".length), 10);
      if (!Number.isFinite(n) || n <= 0) throw new Error(`--max-orders inválido: ${arg}`);
      maxOrders = n;
      continue;
    }
    if (arg === "--explain") {
      explain = true;
      continue;
    }
    if (arg === "--replace-latest") {
      replaceLatest = true;
    }
  }

  if (!orderCode && (!fromDate || !toDate) && customerExternalId == null) {
    throw new Error(
      "Informe --orderCode=... ou --from=YYYY-MM-DD e --to=YYYY-MM-DD (e/ou --customerExternalId=...)."
    );
  }

  return {
    mode,
    fromDate,
    toDate,
    customerExternalId,
    orderCode,
    runId,
    maxOrders,
    explain,
    replaceLatest,
  };
}

export function shouldWritePortfolioRebuild(mode: PortfolioReconciliationMode): boolean {
  return mode === "apply";
}

export function resolveRebuildRunId(options: RebuildPortfolioCliOptions): string {
  return options.runId?.trim() || randomUUID();
}

export function buildRebuildFilterKey(options: RebuildPortfolioCliOptions): PortfolioRebuildFilterKey {
  return {
    fromDate: options.fromDate ? options.fromDate.toISOString().slice(0, 10) : null,
    toDate: options.toDate ? options.toDate.toISOString().slice(0, 10) : null,
    customerExternalId: options.customerExternalId,
    orderCode: options.orderCode,
  };
}

export function filtersMatchRebuildKey(
  filtersJson: unknown,
  key: PortfolioRebuildFilterKey
): boolean {
  if (!filtersJson || typeof filtersJson !== "object" || Array.isArray(filtersJson)) return false;
  const obj = filtersJson as Record<string, unknown>;
  const filterKey = (obj.filterKey ?? obj) as Record<string, unknown>;
  return (
    (filterKey.fromDate ?? null) === key.fromDate &&
    (filterKey.toDate ?? null) === key.toDate &&
    (filterKey.customerExternalId ?? null) === key.customerExternalId &&
    (filterKey.orderCode ?? null) === key.orderCode
  );
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}

const DIVERGENCE_STATUSES = new Set<PortfolioFactStatus>([
  "PRICE_MISMATCH",
  "QUANTITY_SURPLUS_IN_NFE",
  "OVER_LINKED_BY_HEADER",
  "DATA_QUALITY_ISSUE",
  "AMBIGUOUS_ALLOCATION",
  "HEADER_ONLY_LINK",
]);

export function buildPortfolioRebuildSummary(
  facts: PortfolioReconciliationFactDraft[],
  snapshot: PortfolioReconciliationSnapshot
): PortfolioRebuildSummary {
  const orderIds = new Set(snapshot.orders.map((o) => o.id));
  const ordersWithNfe = new Set(
    snapshot.nfeLinks.filter((l) => orderIds.has(l.salesOrderId)).map((l) => l.salesOrderId)
  );
  const nfeIds = new Set(snapshot.nfeLinks.map((l) => l.nfeExternalId));
  const stockNfeIds = new Set(
    snapshot.stockDocuments.filter((d) => d.idNfe != null).map((d) => d.idNfe as number)
  );
  const ordersWithStock = new Set(
    snapshot.nfeLinks
      .filter((l) => stockNfeIds.has(l.nfeExternalId))
      .map((l) => l.salesOrderId)
  );

  const ordersWithReceivable = new Set<string>();
  for (const fact of facts) {
    if (fact.salesOrderId && fact.receivableIdsJson && fact.receivableIdsJson.length > 0) {
      ordersWithReceivable.add(fact.salesOrderId);
    }
  }

  const ordersOrderOnly = snapshot.orders.filter((o) => !ordersWithNfe.has(o.id)).length;

  const statusCounts: Record<string, number> = {};
  let alertCount = 0;
  let divergenceCount = 0;
  let totalAllocatedValue = 0;
  let totalReceivableValue = 0;
  let projectedOpenBalance = 0;
  const alertSamples: string[] = [];

  for (const fact of facts) {
    statusCounts[fact.status] = (statusCounts[fact.status] ?? 0) + 1;
    if (fact.alertsJson.length > 0) {
      alertCount += fact.alertsJson.length;
      for (const alert of fact.alertsJson) {
        if (alertSamples.length < 20 && !alertSamples.includes(alert)) alertSamples.push(alert);
      }
    }
    if (DIVERGENCE_STATUSES.has(fact.status)) divergenceCount += 1;
    if ((fact.allocatedQuantity ?? 0) > 0) {
      totalAllocatedValue += fact.allocatedValueByOrderPrice ?? 0;
    }
    if (fact.receivableTotalValue != null && (fact.allocatedQuantity ?? 0) > 0) {
      totalReceivableValue += fact.receivableTotalValue;
    }
    if (fact.forecastSource === "RECEIVABLE" && fact.openReceivableValue != null) {
      projectedOpenBalance += fact.openReceivableValue;
    } else if (
      (fact.forecastSource === "NFE" || fact.forecastSource === "ORDER") &&
      fact.forecastValue != null
    ) {
      projectedOpenBalance += fact.forecastValue;
    }
  }

  // Evitar double-count de CR em múltiplas linhas da mesma NF: somar por order+nfe únicos nos rateados
  const receivableSeen = new Set<string>();
  totalReceivableValue = 0;
  for (const fact of facts) {
    if (!fact.salesOrderId || fact.nfeExternalId == null) continue;
    if (!fact.receivableIdsJson?.length) continue;
    if ((fact.allocatedQuantity ?? 0) <= 0 && fact.status !== "RECEIVABLE_CONFIRMED" && fact.status !== "RECEIVED") {
      continue;
    }
    const key = `${fact.salesOrderId}::${fact.nfeExternalId}`;
    if (receivableSeen.has(key)) continue;
    receivableSeen.add(key);
    // Soma rateada = soma dos receivableTotalValue das linhas alocadas desta NF
    const rateado = facts
      .filter(
        (f) =>
          f.salesOrderId === fact.salesOrderId &&
          f.nfeExternalId === fact.nfeExternalId &&
          (f.allocatedQuantity ?? 0) > 0 &&
          f.receivableTotalValue != null
      )
      .reduce((s, f) => s + (f.receivableTotalValue ?? 0), 0);
    totalReceivableValue += rateado;
  }

  const totalOrderValue = snapshot.orders.reduce((s, o) => s + (o.totalNetValue ?? 0), 0);

  return {
    ordersAnalyzed: snapshot.orders.length,
    ordersOrderOnly,
    ordersWithNfe: ordersWithNfe.size,
    ordersWithStockDocument: ordersWithStock.size,
    ordersWithReceivable: ordersWithReceivable.size,
    factsGenerated: facts.length,
    alertCount,
    divergenceCount,
    totalOrderValue: round2(totalOrderValue),
    totalAllocatedValue: round2(totalAllocatedValue),
    totalReceivableValue: round2(totalReceivableValue),
    projectedOpenBalance: round2(projectedOpenBalance),
    statusCounts,
    alertSamples,
  };
}

function moneyBr(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Relatório --explain (ex.: PD 02339).
 * Deixa explícito que a soma de cabeçalhos NF não é o valor do pedido.
 */
export function formatPortfolioRebuildExplain(
  facts: PortfolioReconciliationFactDraft[],
  snapshot: PortfolioReconciliationSnapshot,
  orderCode?: string | null
): string {
  const orders = orderCode
    ? snapshot.orders.filter((o) => o.orderCode === orderCode)
    : snapshot.orders;
  const lines: string[] = [];

  for (const order of orders) {
    const orderFacts = facts.filter((f) => f.salesOrderId === order.id);
    const orderTotal = order.totalNetValue ?? 0;
    const links = snapshot.nfeLinks.filter((l) => l.salesOrderId === order.id);
    const nfeNumbers = links.map((l) => l.nfeNumber ?? String(l.nfeExternalId));
    const headerSum = links.reduce((sum, link) => {
      const nfe = snapshot.nfes.find((n) => n.externalId === link.nfeExternalId);
      return sum + (nfe?.valorLiquido ?? 0);
    }, 0);

    lines.push(`Pedido ${order.orderCode}: ${moneyBr(orderTotal)}`);
    lines.push(`NF vinculadas: ${nfeNumbers.join(", ") || "(nenhuma)"}`);
    lines.push(
      `Soma cabeçalhos NF: ${moneyBr(headerSum)} — NÃO é o valor do pedido (não consumir como carteira).`
    );

    lines.push("Alocações por produto:");
    const allocations = orderFacts.filter((f) => (f.allocatedQuantity ?? 0) > 0);
    if (allocations.length === 0) {
      lines.push("  (nenhuma alocação itemizada)");
    } else {
      for (const fact of allocations) {
        lines.push(
          `  produto ${fact.externalProductId} qtde ${fact.allocatedQuantity} NF ${fact.nfeNumber ?? fact.nfeExternalId} status=${fact.status} alocado=${moneyBr(fact.allocatedValueByOrderPrice ?? 0)}`
        );
      }
    }

    const mismatches = orderFacts.filter((f) => f.status === "PRICE_MISMATCH");
    if (mismatches.length > 0) {
      lines.push(`PRICE_MISMATCH: ${mismatches.length} linha(s) (ex. NF 6845 / idNfe 6937).`);
    }

    const surplus = orderFacts.filter((f) => f.status === "QUANTITY_SURPLUS_IN_NFE");
    if (surplus.length > 0) {
      lines.push("Excedentes (não alocados ao pedido):");
      for (const fact of surplus) {
        lines.push(
          `  produto ${fact.externalProductId} NF ${fact.nfeNumber ?? fact.nfeExternalId} stockQty=${fact.stockQuantity} — ${fact.alertsJson[0] ?? "sobra"}`
        );
      }
    }

    const foreign = orderFacts.filter(
      (f) =>
        f.status === "DATA_QUALITY_ISSUE" &&
        f.alertsJson.some((a) => a.includes("sem item de pedido correspondente"))
    );
    if (foreign.length > 0) {
      lines.push(`Itens de documento sem correspondente no pedido: ${foreign.length}`);
    }

    const allocatedSum = allocations.reduce((s, f) => s + (f.allocatedValueByOrderPrice ?? 0), 0);
    lines.push(`Total alocado (preço pedido): ${moneyBr(allocatedSum)}`);
    lines.push(`Valor pedido: ${moneyBr(orderTotal)}`);
    if (Math.abs(headerSum - 355290) < 1 || headerSum > orderTotal * 1.5) {
      lines.push(
        `Atenção: não usar ${moneyBr(headerSum)} (soma NF) como valor do pedido ${order.orderCode}.`
      );
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

export function draftFactToPrismaData(
  fact: PortfolioReconciliationFactDraft,
  runId: string
): Record<string, unknown> {
  return {
    runId,
    customerId: fact.customerId,
    customerExternalId: fact.customerExternalId,
    customerNameSnapshot: fact.customerNameSnapshot,
    salesOrderId: fact.salesOrderId,
    externalSalesOrderId: fact.externalSalesOrderId,
    orderCode: fact.orderCode,
    orderIssueDate: fact.orderIssueDate,
    expectedDeliveryDate: fact.expectedDeliveryDate,
    salesOrderItemId: fact.salesOrderItemId,
    externalSalesOrderItemId: fact.externalSalesOrderItemId,
    externalProductId: fact.externalProductId,
    productSkuSnapshot: fact.productSkuSnapshot,
    productNameSnapshot: fact.productNameSnapshot,
    orderQuantity: fact.orderQuantity,
    orderUnitPrice: fact.orderUnitPrice,
    orderItemValue: fact.orderItemValue,
    nomusNfeId: fact.nomusNfeId,
    nfeExternalId: fact.nfeExternalId,
    nfeNumber: fact.nfeNumber,
    nfeSerie: fact.nfeSerie,
    nfeKey: fact.nfeKey,
    nfeProcessedAt: fact.nfeProcessedAt,
    nfeHeaderValue: fact.nfeHeaderValue,
    stockDocumentId: fact.stockDocumentId,
    stockDocumentExternalId: fact.stockDocumentExternalId,
    stockDocumentItemId: fact.stockDocumentItemId,
    stockDocumentItemExternalId: fact.stockDocumentItemExternalId,
    stockDocumentDate: fact.stockDocumentDate,
    stockQuantity: fact.stockQuantity,
    stockUnitValue: fact.stockUnitValue,
    stockItemValue: fact.stockItemValue,
    allocatedQuantity: fact.allocatedQuantity,
    allocatedValueByOrderPrice: fact.allocatedValueByOrderPrice,
    allocatedValueByStockPrice: fact.allocatedValueByStockPrice,
    remainingOrderQuantityAfterAllocation: fact.remainingOrderQuantityAfterAllocation,
    remainingOrderValueAfterAllocation: fact.remainingOrderValueAfterAllocation,
    priceDifferenceUnit: fact.priceDifferenceUnit,
    priceDifferenceTotal: fact.priceDifferenceTotal,
    receivableIdsJson: fact.receivableIdsJson,
    receivableTotalValue: fact.receivableTotalValue,
    receivedValue: fact.receivedValue,
    openReceivableValue: fact.openReceivableValue,
    dueDatesJson: fact.dueDatesJson,
    settlementDatesJson: fact.settlementDatesJson,
    forecastSource: fact.forecastSource,
    forecastDate: fact.forecastDate,
    forecastValue: fact.forecastValue,
    confidenceLevel: fact.confidenceLevel,
    status: fact.status,
    alertsJson: fact.alertsJson,
    traceJson: fact.traceJson,
  };
}
