/**
 * Diagnóstico — Status Pedidos / itens cancelados — PD 02207.
 *
 * Uso:
 *   npx tsx tmp-audits/inspect-order-status-pd02207.ts
 *
 * Com DATABASE_URL: backfill pontual do status Nomus em SalesOrderItem + consolida.
 * Sem DATABASE_URL: fixture local.
 */
import "dotenv/config";
import {
  aggregateOrderFactsToRow,
  type PortfolioOrderStatusFact,
} from "../src/lib/finance/portfolioOrderStatusService.js";
import { isCanceledOrderItemFact } from "../src/lib/finance/orderItemFulfillmentStatus.js";
import {
  extractNomusRawItems,
  matchRawItemToDbItem,
  resolveSalesOrderItemNomusStatus,
} from "../src/lib/salesOrderNomusRaw.js";
import { parseNomusSalesOrderItemStatus } from "../src/lib/sales/nomusSalesOrderItemStatus.js";

const ORDER_CODE = "PD 02207";

function money(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fixtureFacts(): PortfolioOrderStatusFact[] {
  const salesOrderId = "fixture-pd-02207";
  const shared = {
    salesOrderId,
    orderCode: ORDER_CODE,
    orderNetValue: 197_030,
    customerName: "Fixture",
    externalCustomerId: 1,
    financialStage: "CR_RECEIVED",
    receivableTotalValue: 71_405,
    receivableOpenValue: 0,
    receivableReceivedValue: 71_405,
    runId: "fixture",
    orderIssueDate: new Date("2026-01-10"),
    orderExpectedDeliveryDate: null,
    customerId: null,
    sellerName: null,
    sellerQualityStatus: null,
    stockDocumentId: null,
    stockDocumentExternalId: null,
    stockDocumentDate: null,
    stockDocumentItemQuantity: null,
    stockDocumentItemUnitValue: null,
    stockDocumentItemTotalValue: null,
    excessQuantity: null,
    outsideOrderQuantity: null,
    nfeNumber: null,
    nfeIssueDate: null,
    nfeHeaderValue: null,
    nfeItemQuantity: null,
    nfeItemUnitValue: null,
    nfeItemTotalValue: null,
    paymentDueDate: null,
    paymentSettlementDate: null,
    paymentStatus: null,
    operationalStage: null,
    orderToCashStage: null,
    temperature: null,
    confidenceScore: null,
    confidenceLabel: null,
    responsibleArea: null,
    recommendedAction: null,
    alertsJson: null,
    blockingReasonsJson: null,
    hasDeliveryDelay: false,
    hasMissingStockDocument: false,
    hasPartialFulfillment: false,
    hasFullFulfillment: true,
    hasExcessQuantity: false,
    hasProductOutsideOrder: false,
    hasNfeHeaderGreaterThanOrder: false,
    hasPriceMismatch: false,
    hasDocumentWithoutReceivable: false,
    hasOverdueReceivable: false,
  } as const;

  return [
    {
      ...shared,
      id: "a1",
      productCode: "618.09AA",
      sku: "618.09AA",
      productName: "618.09AA",
      lineType: "ORDER_ITEM_ALLOCATED",
      orderedQuantity: 8,
      orderUnitPrice: 5000,
      orderItemTotalValue: 40_000,
      quantityUsedForOrder: 8,
      allocatedValueByOrderPrice: 40_000,
      allocatedValueByDocumentPrice: 40_000,
      orderItemStatus: "ATENDIDO",
      nomusItemStatusNormalized: "FULFILLED",
      nomusIsCanceled: false,
    },
    {
      ...shared,
      id: "a2",
      productCode: "618.10AA",
      sku: "618.10AA",
      productName: "618.10AA",
      lineType: "ORDER_ITEM_ALLOCATED",
      orderedQuantity: 6.5,
      orderUnitPrice: 4831.538461,
      orderItemTotalValue: 31_405,
      quantityUsedForOrder: 6.5,
      allocatedValueByOrderPrice: 31_405,
      allocatedValueByDocumentPrice: 31_405,
      orderItemStatus: "ATENDIDO",
      nomusItemStatusNormalized: "FULFILLED",
      nomusIsCanceled: false,
    },
    {
      ...shared,
      id: "c1",
      productCode: "618.07AA",
      sku: "618.07AA",
      productName: "618.07AA",
      lineType: "ORDER_ITEM_PENDING",
      orderedQuantity: 16.5,
      orderUnitPrice: 4848.484848,
      orderItemTotalValue: 80_000,
      quantityUsedForOrder: null,
      allocatedValueByOrderPrice: null,
      allocatedValueByDocumentPrice: null,
      orderItemStatus: "CANCELADO",
      nomusItemStatusNormalized: "CANCELED",
      nomusIsCanceled: true,
      receivableTotalValue: null,
      receivableOpenValue: null,
      receivableReceivedValue: null,
    },
    {
      ...shared,
      id: "c2",
      productCode: "618.01AA",
      sku: "618.01AA",
      productName: "618.01AA",
      lineType: "ORDER_ITEM_PENDING",
      orderedQuantity: 9,
      orderUnitPrice: 5069.444444,
      orderItemTotalValue: 45_625,
      quantityUsedForOrder: null,
      allocatedValueByOrderPrice: null,
      allocatedValueByDocumentPrice: null,
      orderItemStatus: "CANCELADO",
      nomusItemStatusNormalized: "CANCELED",
      nomusIsCanceled: true,
      receivableTotalValue: null,
      receivableOpenValue: null,
      receivableReceivedValue: null,
    },
  ];
}

function printClassification(row: ReturnType<typeof aggregateOrderFactsToRow>): void {
  console.log("\n=== Classificação consolidada ===");
  console.log({
    orderCode: row.orderCode,
    fulfilledItemsCount: row.fulfilledItemsCount,
    canceledItemsCount: row.canceledItemsCount,
    pendingActiveItemsCount: row.pendingActiveItemsCount,
    originalOrderValue: row.originalOrderValue,
    canceledOrderValue: row.canceledOrderValue,
    activeOrderValue: row.activeOrderValue,
    allocatedOrderValue: row.allocatedOrderValue,
    pendingActiveOrderValue: row.pendingActiveOrderValue,
    fulfillmentPercentActive: row.fulfillmentPercentActive,
    consolidatedOrderStatus: row.consolidatedOrderStatus,
    isPartial: row.consolidatedOrderStatus.startsWith("PARCIAL_"),
    hasCanceledItems: row.hasCanceledItems,
    hasPendingItems: row.hasPendingItems,
  });
  console.log(
    `Valores: original ${money(row.originalOrderValue)} | cancelado ${money(row.canceledOrderValue)} | ativo ${money(row.activeOrderValue)} | atendido ${money(row.allocatedOrderValue)} | pendente ativo ${money(row.pendingActiveOrderValue)}`
  );
}

async function runLive(): Promise<boolean> {
  if (!process.env.DATABASE_URL?.trim()) return false;

  try {
  const { prisma } = await import("../src/lib/prisma.js");
  const { enrichFactsWithOrderItemStatus } = await import(
    "../src/lib/finance/orderToCashFactItemStatusEnrichment.server.js"
  );
  const { backfillSalesOrderItemNomusStatusForOrder } = await import(
    "../src/lib/sales/backfillSalesOrderItemNomusStatus.server.js"
  );

  const order = await prisma.salesOrder.findFirst({
    where: { orderCode: ORDER_CODE },
    select: {
      id: true,
      orderCode: true,
      totalNetValue: true,
      nomusRawResponse: true,
      items: {
        select: {
          id: true,
          skuSnapshot: true,
          productNameSnapshot: true,
          externalProductId: true,
          quantity: true,
          totalNetValue: true,
          negotiatedPrice: true,
          nomusItemStatusRaw: true,
          nomusItemStatusNormalized: true,
          nomusIsCanceled: true,
          nomusIsStale: true,
        },
        orderBy: { id: "asc" },
      },
    },
  });

  if (!order) {
    console.log(`Pedido ${ORDER_CODE} não encontrado no banco.`);
    return true;
  }

  const backfill = await backfillSalesOrderItemNomusStatusForOrder(prisma, order.id);
  console.log(`\nBackfill status Nomus: ${backfill.updated} item(ns) atualizado(s).`);

  const refreshed = await prisma.salesOrderItem.findMany({
    where: { salesOrderId: order.id },
    orderBy: { id: "asc" },
  });

  console.log(`\n=== SalesOrderItem — ${order.orderCode} (${order.id}) ===`);
  const rawItems = extractNomusRawItems(order.nomusRawResponse);
  for (let i = 0; i < refreshed.length; i++) {
    const item = refreshed[i]!;
    const matched = matchRawItemToDbItem(
      rawItems,
      {
        externalProductId: item.externalProductId,
        skuSnapshot: item.skuSnapshot,
        productNameSnapshot: item.productNameSnapshot,
      },
      { itemIndex: i, totalDbItems: refreshed.length }
    );
    const parsed = parseNomusSalesOrderItemStatus(matched?.raw ?? null);
    const nomus = resolveSalesOrderItemNomusStatus(
      order.nomusRawResponse,
      {
        externalProductId: item.externalProductId,
        skuSnapshot: item.skuSnapshot,
        productNameSnapshot: item.productNameSnapshot,
      },
      { itemIndex: i, totalDbItems: refreshed.length }
    );
    console.log({
      sku: item.skuSnapshot,
      statusBruto: item.nomusItemStatusRaw ?? parsed.statusRaw,
      statusNormalizado:
        item.nomusItemStatusNormalized ?? parsed.statusNormalized,
      nomusLifecycle: nomus,
      nomusIsCanceled: item.nomusIsCanceled,
      nomusIsStale: item.nomusIsStale,
      quantidadePedida: Number(item.quantity),
      quantidadeAtendida: matched?.quantidadeAtendida ?? null,
      valorItem: Number(item.totalNetValue ?? 0),
    });
  }

  const factsRaw = await prisma.orderToCashAuditFact.findMany({
    where: { orderCode: ORDER_CODE },
    orderBy: [{ createdAt: "desc" }],
    take: 200,
  });

  if (factsRaw.length === 0) {
    console.log("\nNenhuma fact O2C — fixture local:");
    printClassification(aggregateOrderFactsToRow(fixtureFacts()));
    return true;
  }

  const latestRunId = factsRaw[0]!.runId;
  const runFacts = factsRaw.filter((f) => f.runId === latestRunId);
  console.log(`\n=== Facts O2C (run ${latestRunId}, ${runFacts.length} linhas) ===`);

  const mapped = runFacts.map((f) => ({
    id: f.id,
    runId: f.runId,
    orderCode: f.orderCode,
    orderIssueDate: f.orderIssueDate,
    orderExpectedDeliveryDate: f.orderExpectedDeliveryDate,
    orderNetValue: f.orderNetValue != null ? Number(f.orderNetValue) : null,
    customerId: f.customerId,
    customerName: f.customerName,
    externalCustomerId: f.externalCustomerId,
    sellerName: f.sellerName,
    sellerQualityStatus: f.sellerQualityStatus,
    productCode: f.productCode,
    sku: f.sku,
    productName: f.productName,
    lineType: f.lineType,
    orderedQuantity: f.orderedQuantity != null ? Number(f.orderedQuantity) : null,
    orderUnitPrice: f.orderUnitPrice != null ? Number(f.orderUnitPrice) : null,
    orderItemTotalValue:
      f.orderItemTotalValue != null ? Number(f.orderItemTotalValue) : null,
    stockDocumentId: f.stockDocumentId,
    stockDocumentExternalId: f.stockDocumentExternalId,
    stockDocumentDate: f.stockDocumentDate,
    stockDocumentItemQuantity:
      f.stockDocumentItemQuantity != null
        ? Number(f.stockDocumentItemQuantity)
        : null,
    quantityUsedForOrder:
      f.quantityUsedForOrder != null ? Number(f.quantityUsedForOrder) : null,
    excessQuantity: f.excessQuantity != null ? Number(f.excessQuantity) : null,
    outsideOrderQuantity:
      f.outsideOrderQuantity != null ? Number(f.outsideOrderQuantity) : null,
    allocatedValueByOrderPrice:
      f.allocatedValueByOrderPrice != null
        ? Number(f.allocatedValueByOrderPrice)
        : null,
    allocatedValueByDocumentPrice:
      f.allocatedValueByDocumentPrice != null
        ? Number(f.allocatedValueByDocumentPrice)
        : null,
    stockDocumentItemUnitValue:
      f.stockDocumentItemUnitValue != null
        ? Number(f.stockDocumentItemUnitValue)
        : null,
    stockDocumentItemTotalValue:
      f.stockDocumentItemTotalValue != null
        ? Number(f.stockDocumentItemTotalValue)
        : null,
    nfeItemQuantity: f.nfeItemQuantity != null ? Number(f.nfeItemQuantity) : null,
    nfeItemUnitValue:
      f.nfeItemUnitValue != null ? Number(f.nfeItemUnitValue) : null,
    nfeItemTotalValue:
      f.nfeItemTotalValue != null ? Number(f.nfeItemTotalValue) : null,
    nfeNumber: f.nfeNumber,
    nfeIssueDate: f.nfeIssueDate,
    nfeHeaderValue: f.nfeHeaderValue != null ? Number(f.nfeHeaderValue) : null,
    receivableTotalValue:
      f.receivableTotalValue != null ? Number(f.receivableTotalValue) : null,
    receivableOpenValue:
      f.receivableOpenValue != null ? Number(f.receivableOpenValue) : null,
    receivableReceivedValue:
      f.receivableReceivedValue != null
        ? Number(f.receivableReceivedValue)
        : null,
    paymentDueDate: f.paymentDueDate,
    paymentSettlementDate: f.paymentSettlementDate,
    paymentStatus: f.paymentStatus,
    operationalStage: f.operationalStage,
    financialStage: f.financialStage,
    orderToCashStage: f.orderToCashStage,
    temperature: f.temperature,
    confidenceScore: f.confidenceScore != null ? Number(f.confidenceScore) : null,
    confidenceLabel: f.confidenceLabel,
    responsibleArea: f.responsibleArea,
    recommendedAction: f.recommendedAction,
    alertsJson: f.alertsJson,
    blockingReasonsJson: f.blockingReasonsJson,
    hasDeliveryDelay: f.hasDeliveryDelay,
    hasMissingStockDocument: f.hasMissingStockDocument,
    hasPartialFulfillment: f.hasPartialFulfillment,
    hasFullFulfillment: f.hasFullFulfillment,
    hasExcessQuantity: f.hasExcessQuantity,
    hasProductOutsideOrder: f.hasProductOutsideOrder,
    hasNfeHeaderGreaterThanOrder: f.hasNfeHeaderGreaterThanOrder,
    hasPriceMismatch: f.hasPriceMismatch,
    hasDocumentWithoutReceivable: f.hasDocumentWithoutReceivable,
    hasOverdueReceivable: f.hasOverdueReceivable,
    salesOrderId: f.salesOrderId,
    salesOrderItemId: f.salesOrderItemId,
    orderItemStatus: f.orderItemStatus,
  }));

  const enriched = await enrichFactsWithOrderItemStatus(mapped);
  for (const f of enriched) {
    console.log({
      productCode: f.productCode,
      lineType: f.lineType,
      orderItemStatus: f.orderItemStatus,
      nomusIsCanceled: f.nomusIsCanceled,
      canceled: isCanceledOrderItemFact(f),
      orderItemTotalValue: f.orderItemTotalValue,
      allocatedValueByOrderPrice: f.allocatedValueByOrderPrice,
    });
  }

  printClassification(aggregateOrderFactsToRow(enriched));
  return true;
  } catch (err) {
    console.warn(
      "DB indisponível — fallback fixture:",
      err instanceof Error ? err.message : err
    );
    return false;
  }
}

async function main(): Promise<void> {
  console.log(`Inspect Status Pedidos — ${ORDER_CODE}`);
  const live = await runLive();
  if (!live) {
    console.log("\nSem DATABASE_URL — fixture local:");
    const facts = fixtureFacts();
    for (const f of facts) {
      console.log({
        productCode: f.productCode,
        lineType: f.lineType,
        orderItemStatus: f.orderItemStatus,
        nomusIsCanceled: f.nomusIsCanceled,
        canceled: isCanceledOrderItemFact(f),
        valor: f.orderItemTotalValue,
      });
    }
    printClassification(aggregateOrderFactsToRow(facts));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
