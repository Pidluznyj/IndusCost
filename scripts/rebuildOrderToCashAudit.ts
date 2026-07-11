/**
 * Rebuild da camada materializada OrderToCashAudit (Run + Fact).
 *
 * Grava somente OrderToCashAuditRun / OrderToCashAuditFact.
 * Não altera SalesOrder, NF, CR, Fluxo, Comissões nem demais módulos oficiais.
 * Sem UI / sem endpoint / sem cron neste prompt.
 *
 * Uso:
 *   npx tsx scripts/rebuildOrderToCashAudit.ts --mode preview --orderCode "PD 02339"
 *   npx tsx scripts/rebuildOrderToCashAudit.ts --mode apply --orderCode "PD 02339"
 *   npx tsx scripts/rebuildOrderToCashAudit.ts --mode preview --customerExternalId 200 --year 2026
 *   npx tsx scripts/rebuildOrderToCashAudit.ts --mode apply --customerExternalId 200 --year 2026
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  buildOrderToCashAuditRows,
  type OrderToCashAuditNfeInput,
  type OrderToCashAuditNfeLinkInput,
  type OrderToCashAuditOrderInput,
  type OrderToCashAuditOrderItemInput,
  type OrderToCashAuditReceivableInput,
  type OrderToCashAuditReconciliationFactInput,
  type OrderToCashAuditStockDocumentInput,
  type OrderToCashAuditStockItemInput,
} from "../src/lib/sales/orderToCashAuditBuilder.ts";
import {
  buildOrderToCashRebuildPreviewSummary,
  formatCounts,
  orderToCashFactRowToPrismaData,
  parseOrderToCashRebuildCli,
  resolvePeriodBounds,
  validateOrderToCashRebuildFilters,
  type OrderToCashDateAxis,
  type OrderToCashRebuildCliOptions,
} from "../src/lib/sales/orderToCashAuditRebuild.ts";

const prisma = new PrismaClient();
const LOG = "[order-to-cash-audit-rebuild]";

function dec(value: Prisma.Decimal | number | null | undefined): number {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const n = Number(value.toString());
  return Number.isFinite(n) ? n : 0;
}

function decOrNull(value: Prisma.Decimal | number | null | undefined): number | null {
  if (value == null) return null;
  const n = dec(value);
  return Number.isFinite(n) ? n : null;
}

async function resolveOrderIdsBySecondaryDateAxis(
  options: OrderToCashRebuildCliOptions,
  period: { from: Date | null; to: Date | null }
): Promise<string[] | null> {
  const axis = options.dateAxis;
  if (
    axis === "ORDER_ISSUE_DATE" ||
    axis === "EXPECTED_DELIVERY_DATE" ||
    (!period.from && !period.to)
  ) {
    return null;
  }

  if (axis === "STOCK_DOCUMENT_DATE") {
    const docs = await prisma.nomusStockDocument.findMany({
      where: {
        dataDocumento: {
          ...(period.from ? { gte: period.from } : {}),
          ...(period.to ? { lte: period.to } : {}),
        },
        idNfe: { not: null },
      },
      select: { idNfe: true },
      take: 50_000,
    });
    const nfeIds = [...new Set(docs.map((d) => d.idNfe).filter((id): id is number => id != null))];
    if (nfeIds.length === 0) return [];
    const links = await prisma.salesOrderNfeLink.findMany({
      where: { nfeExternalId: { in: nfeIds } },
      select: { salesOrderId: true },
    });
    return [...new Set(links.map((l) => l.salesOrderId))];
  }

  if (axis === "NFE_DATE") {
    const nfes = await prisma.nomusNfe.findMany({
      where: {
        OR: [
          {
            dataProcessamento: {
              ...(period.from ? { gte: period.from } : {}),
              ...(period.to ? { lte: period.to } : {}),
            },
          },
          {
            xmlDhEmi: {
              ...(period.from ? { gte: period.from } : {}),
              ...(period.to ? { lte: period.to } : {}),
            },
          },
        ],
      },
      select: { externalId: true },
      take: 50_000,
    });
    const nfeIds = nfes.map((n) => n.externalId);
    if (nfeIds.length === 0) return [];
    const links = await prisma.salesOrderNfeLink.findMany({
      where: { nfeExternalId: { in: nfeIds } },
      select: { salesOrderId: true },
    });
    return [...new Set(links.map((l) => l.salesOrderId))];
  }

  if (axis === "RECEIVABLE_DUE_DATE" || axis === "RECEIVABLE_SETTLEMENT_DATE") {
    const dateField =
      axis === "RECEIVABLE_DUE_DATE" ? "dueDate" : "settlementDate";
    const rows = await prisma.nomusAccountsReceivable.findMany({
      where: {
        [dateField]: {
          ...(period.from ? { gte: period.from } : {}),
          ...(period.to ? { lte: period.to } : {}),
        },
        sourceInvoiceId: { not: null },
      },
      select: { sourceInvoiceId: true },
      take: 50_000,
    });
    const nfeIds = [
      ...new Set(
        rows.map((r) => r.sourceInvoiceId).filter((id): id is number => id != null)
      ),
    ];
    if (nfeIds.length === 0) return [];
    const links = await prisma.salesOrderNfeLink.findMany({
      where: { nfeExternalId: { in: nfeIds } },
      select: { salesOrderId: true },
    });
    return [...new Set(links.map((l) => l.salesOrderId))];
  }

  return null;
}

function buildSalesOrderWhere(
  options: OrderToCashRebuildCliOptions,
  period: { from: Date | null; to: Date | null },
  secondaryOrderIds: string[] | null
): Prisma.SalesOrderWhereInput {
  const where: Prisma.SalesOrderWhereInput = {};

  if (options.orderCode) where.orderCode = options.orderCode;
  if (options.salesOrderId) where.id = options.salesOrderId;
  if (options.customerExternalId != null) {
    where.externalCustomerId = options.customerExternalId;
  }

  if (secondaryOrderIds != null) {
    where.id =
      options.salesOrderId != null
        ? options.salesOrderId
        : { in: secondaryOrderIds.length > 0 ? secondaryOrderIds : ["__none__"] };
  } else if (period.from || period.to) {
    const axis: OrderToCashDateAxis = options.dateAxis;
    if (axis === "EXPECTED_DELIVERY_DATE") {
      where.expectedDeliveryDate = {
        ...(period.from ? { gte: period.from } : {}),
        ...(period.to ? { lte: period.to } : {}),
      };
    } else {
      // Default ORDER_ISSUE_DATE (e fallback)
      where.issueDate = {
        ...(period.from ? { gte: period.from } : {}),
        ...(period.to ? { lte: period.to } : {}),
      };
    }
  }

  return where;
}

async function loadBundle(options: OrderToCashRebuildCliOptions): Promise<{
  orders: OrderToCashAuditOrderInput[];
  orderItems: OrderToCashAuditOrderItemInput[];
  nfeLinks: OrderToCashAuditNfeLinkInput[];
  nfes: OrderToCashAuditNfeInput[];
  stockDocuments: OrderToCashAuditStockDocumentInput[];
  stockDocumentItems: OrderToCashAuditStockItemInput[];
  receivables: OrderToCashAuditReceivableInput[];
  reconciliationFacts: OrderToCashAuditReconciliationFactInput[];
}> {
  const period = resolvePeriodBounds(options);
  const secondaryIds = await resolveOrderIdsBySecondaryDateAxis(options, period);
  const where = buildSalesOrderWhere(options, period, secondaryIds);

  const ordersRaw = await prisma.salesOrder.findMany({
    where,
    take: options.limit ?? undefined,
    orderBy: { issueDate: "asc" },
    include: {
      items: { orderBy: { createdAt: "asc" } },
      Customer: {
        select: {
          id: true,
          companyName: true,
          tradeName: true,
          taxId: true,
          city: true,
          state: true,
          segment: true,
        },
      },
      nfeLinks: true,
    },
  });

  const orders: OrderToCashAuditOrderInput[] = ordersRaw.map((order) => ({
    id: order.id,
    externalSalesOrderId: order.externalSalesOrderId,
    orderCode: order.orderCode,
    status: order.status,
    issueDate: order.issueDate,
    expectedDeliveryDate: order.expectedDeliveryDate,
    totalNetValue: dec(order.totalNetValue),
    totalGrossValue: dec(order.totalGrossValue),
    paymentTerms: order.paymentTerms,
    paymentMethod: order.paymentMethod,
    nomusRawResponse: order.nomusRawResponse,
    companyId: order.externalCompanyId != null ? String(order.externalCompanyId) : null,
    companyName: order.companyIssuer,
    customerId: order.customerId,
    externalCustomerId: order.externalCustomerId,
    customerName: order.Customer.tradeName ?? order.Customer.companyName,
    customerDocument: order.Customer.taxId,
    customerGroup: order.Customer.segment,
    customerCity: order.Customer.city,
    customerState: order.Customer.state,
    sellerId: null,
    externalSellerId: order.externalSellerId,
    sellerName: order.nomusSellerName,
    sellerSource: "SALES_ORDER",
    updatedAt: order.updatedAt,
  }));

  const orderItems: OrderToCashAuditOrderItemInput[] = ordersRaw.flatMap((order) =>
    order.items.map((item, index) => ({
      id: item.id,
      salesOrderId: order.id,
      externalSalesOrderItemId: null,
      orderItemSequence: index + 1,
      externalProductId: item.externalProductId,
      productId: item.productId,
      productCode: item.skuSnapshot,
      sku: item.skuSnapshot,
      productName: item.productNameSnapshot,
      productDescription: item.productNameSnapshot,
      quantity: dec(item.quantity),
      unitPrice: dec(item.negotiatedPrice),
      totalNetValue: dec(item.totalNetValue),
      expectedDeliveryDate: null,
      itemStatus: null,
    }))
  );

  const nfeLinks: OrderToCashAuditNfeLinkInput[] = ordersRaw.flatMap((order) =>
    order.nfeLinks.map((link) => ({
      salesOrderId: order.id,
      nfeExternalId: link.nfeExternalId,
      nfeNumber: link.nfeNumber,
      nfeSerie: link.nfeSerie,
      nfeKey: link.nfeKey,
      nfeStatus: link.nfeStatus,
      tipoOperacao: link.tipoOperacao,
      dataProcessamento: link.dataProcessamento,
      nomusNfeId: link.nomusNfeId,
    }))
  );

  const nfeExternalIds = [...new Set(nfeLinks.map((l) => l.nfeExternalId))];

  const nfesRaw =
    nfeExternalIds.length > 0
      ? await prisma.nomusNfe.findMany({
          where: { externalId: { in: nfeExternalIds } },
          select: {
            id: true,
            externalId: true,
            numero: true,
            serie: true,
            chave: true,
            status: true,
            tipoOperacao: true,
            dataProcessamento: true,
            xmlDhEmi: true,
            valorLiquido: true,
          },
        })
      : [];

  const nfes: OrderToCashAuditNfeInput[] = nfesRaw.map((nfe) => ({
    id: nfe.id,
    externalId: nfe.externalId,
    numero: nfe.numero,
    serie: nfe.serie,
    chave: nfe.chave,
    status: nfe.status,
    tipoOperacao: nfe.tipoOperacao,
    dataProcessamento: nfe.dataProcessamento,
    issueDate: nfe.xmlDhEmi ?? nfe.dataProcessamento,
    valorLiquido: decOrNull(nfe.valorLiquido),
  }));

  const stockRaw =
    nfeExternalIds.length > 0
      ? await prisma.nomusStockDocument.findMany({
          where: { idNfe: { in: nfeExternalIds } },
          include: { items: true },
        })
      : [];

  const stockDocuments: OrderToCashAuditStockDocumentInput[] = stockRaw.map((doc) => ({
    id: doc.id,
    externalId: doc.externalId,
    idNfe: doc.idNfe,
    tipoDocumentoEstoque: doc.tipoDocumentoEstoque,
    dataDocumento: doc.dataDocumento,
    totalValue: null,
    personId: null,
    personName: null,
    items: doc.items.map((item) => ({
      id: item.id,
      stockDocumentId: doc.id,
      externalItemId: item.externalItemId,
      externalProductId: item.externalProductId,
      productCode: null,
      productName: null,
      quantity: dec(item.quantity),
      unitValue: dec(item.unitValue),
      estimatedTotalValue: dec(item.estimatedTotalValue),
    })),
  }));

  const stockDocumentItems: OrderToCashAuditStockItemInput[] = stockDocuments.flatMap(
    (doc) => doc.items ?? []
  );

  const invoiceNumbers = nfesRaw
    .map((n) => n.numero)
    .filter((n): n is string => !!n && n.trim().length > 0);

  const receivablesRaw =
    nfeExternalIds.length > 0
      ? await prisma.nomusAccountsReceivable.findMany({
          where: {
            OR: [
              { sourceInvoiceId: { in: nfeExternalIds } },
              ...(invoiceNumbers.length > 0
                ? [{ sourceInvoiceNumber: { in: invoiceNumbers } }]
                : []),
            ],
          },
          select: {
            id: true,
            externalId: true,
            sourceInvoiceId: true,
            sourceInvoiceNumber: true,
            amountReceivable: true,
            amountReceived: true,
            balanceReceivable: true,
            dueDate: true,
            settlementDate: true,
          },
        })
      : [];

  const receivables: OrderToCashAuditReceivableInput[] = receivablesRaw.map((row) => ({
    id: row.id,
    externalId: row.externalId,
    sourceInvoiceId: row.sourceInvoiceId,
    sourceInvoiceNumber: row.sourceInvoiceNumber,
    amountReceivable: decOrNull(row.amountReceivable),
    amountReceived: decOrNull(row.amountReceived),
    balanceReceivable: decOrNull(row.balanceReceivable),
    dueDate: row.dueDate,
    settlementDate: row.settlementDate,
  }));

  // Facts de conciliação (evidência auxiliar) — último run SUCCESS se houver
  let reconciliationFacts: OrderToCashAuditReconciliationFactInput[] = [];
  const orderIds = ordersRaw.map((o) => o.id);
  if (orderIds.length > 0) {
    try {
      const latestRun = await prisma.portfolioReconciliationRun.findFirst({
        where: { status: "SUCCESS" },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (latestRun) {
        const facts = await prisma.portfolioReconciliationFact.findMany({
          where: {
            runId: latestRun.id,
            salesOrderId: { in: orderIds },
          },
          select: {
            salesOrderId: true,
            salesOrderItemId: true,
            nfeExternalId: true,
            stockDocumentId: true,
            allocatedQuantity: true,
            allocatedValueByOrderPrice: true,
            status: true,
            alertsJson: true,
          },
          take: 5_000,
        });
        reconciliationFacts = facts.map((f) => ({
          salesOrderId: f.salesOrderId,
          salesOrderItemId: f.salesOrderItemId,
          nfeExternalId: f.nfeExternalId,
          stockDocumentId: f.stockDocumentId,
          allocatedQuantity: decOrNull(f.allocatedQuantity),
          allocatedValueByOrderPrice: decOrNull(f.allocatedValueByOrderPrice),
          status: f.status,
          alertsJson: f.alertsJson,
        }));
      }
    } catch {
      // Tabela pode não existir em ambientes antigos — ignora
    }
  }

  return {
    orders,
    orderItems,
    nfeLinks,
    nfes,
    stockDocuments,
    stockDocumentItems,
    receivables,
    reconciliationFacts,
  };
}

function printPreview(summary: ReturnType<typeof buildOrderToCashRebuildPreviewSummary>): void {
  console.log("\n=== OrderToCashAudit PREVIEW ===");
  console.log(`totalOrders: ${summary.totalOrders}`);
  console.log(`totalOrderItems: ${summary.totalOrderItems}`);
  console.log(`totalFacts: ${summary.totalFacts}`);
  console.log(`totalOrderValue: ${summary.totalOrderValue}`);
  console.log(`totalAllocatedValue: ${summary.totalAllocatedValue}`);
  console.log(`totalReceivableValue: ${summary.totalReceivableValue}`);
  console.log(`totalReceivedValue: ${summary.totalReceivedValue}`);
  console.log(`totalOpenValue: ${summary.totalOpenValue}`);
  console.log(`totalBlockedValue: ${summary.totalBlockedValue}`);
  console.log(formatCounts("statusCounts", summary.statusCounts));
  console.log(formatCounts("operationalStageCounts", summary.operationalStageCounts));
  console.log(formatCounts("financialStageCounts", summary.financialStageCounts));
  console.log(formatCounts("paymentStatusCounts", summary.paymentStatusCounts));
  console.log(formatCounts("orderToCashStageCounts", summary.orderToCashStageCounts));
  console.log(formatCounts("alertCounts", summary.alertCounts));
  console.log("\ntop 10 pedidos com risco:");
  for (const row of summary.topRiskOrders) {
    console.log(
      `  - ${row.orderCode} | stage=${row.orderToCashStage} | temp=${row.temperature} | alerts=${row.alertCount} | net=${row.orderNetValue}`
    );
  }
  if (summary.warnings.length > 0) {
    console.log("\nwarnings:");
    for (const w of summary.warnings) console.log(`  - ${w}`);
  }
}

async function persistApply(params: {
  runId: string;
  options: OrderToCashRebuildCliOptions;
  period: { from: Date | null; to: Date | null };
  rows: ReturnType<typeof buildOrderToCashAuditRows>["rows"];
  summary: ReturnType<typeof buildOrderToCashRebuildPreviewSummary>;
  builderWarnings: string[];
}): Promise<"SUCCESS" | "PARTIAL" | "FAILED"> {
  const { runId, options, period, rows, summary, builderWarnings } = params;
  const startedAt = new Date();

  await prisma.orderToCashAuditRun.create({
    data: {
      id: runId,
      startedAt,
      status: "RUNNING",
      mode: "APPLY",
      periodFrom: period.from,
      periodTo: period.to,
      year: options.year,
      dateAxis: options.dateAxis,
      customerFilter:
        options.customerExternalId != null ? String(options.customerExternalId) : null,
      sellerFilter: null,
      orderFilter: options.orderCode ?? options.salesOrderId,
      totalOrders: summary.totalOrders,
      totalOrderItems: summary.totalOrderItems,
      totalFacts: 0,
      totalOrderValue: summary.totalOrderValue,
      totalAllocatedValue: summary.totalAllocatedValue,
      totalReceivableValue: summary.totalReceivableValue,
      totalReceivedValue: summary.totalReceivedValue,
      totalOpenValue: summary.totalOpenValue,
      totalBlockedValue: summary.totalBlockedValue,
      warningsJson: builderWarnings as Prisma.InputJsonValue,
      createdBy: "rebuildOrderToCashAudit.ts",
    },
  });

  let inserted = 0;
  try {
    const chunkSize = 100;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const result = await prisma.orderToCashAuditFact.createMany({
        data: chunk.map((row) => {
          const mapped = orderToCashFactRowToPrismaData(row, runId);
          return mapped as Prisma.OrderToCashAuditFactCreateManyInput;
        }),
      });
      inserted += result.count;
    }

    const status =
      inserted === rows.length ? "SUCCESS" : inserted > 0 ? "PARTIAL" : "FAILED";

    await prisma.orderToCashAuditRun.update({
      where: { id: runId },
      data: {
        status,
        finishedAt: new Date(),
        totalFacts: inserted,
        errorMessage:
          status === "SUCCESS"
            ? null
            : `Inseridos ${inserted} de ${rows.length} facts.`,
        warningsJson: [
          ...builderWarnings,
          ...(status !== "SUCCESS"
            ? [`Persistência ${status}: ${inserted}/${rows.length}`]
            : []),
        ] as Prisma.InputJsonValue,
      },
    });

    return status;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.orderToCashAuditRun.update({
      where: { id: runId },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        totalFacts: inserted,
        errorMessage: message.slice(0, 2000),
      },
    });
    throw error;
  }
}

async function main(): Promise<void> {
  const options = parseOrderToCashRebuildCli(process.argv.slice(2));
  const filterWarnings = validateOrderToCashRebuildFilters(options);
  const period = resolvePeriodBounds(options);

  console.log(`${LOG} mode=${options.mode} dateAxis=${options.dateAxis}`);
  console.log(
    `${LOG} filters: orderCode=${options.orderCode ?? "—"} salesOrderId=${options.salesOrderId ?? "—"} customerExternalId=${options.customerExternalId ?? "—"} year=${options.year ?? "—"} from=${period.from?.toISOString() ?? "—"} to=${period.to?.toISOString() ?? "—"} limit=${options.limit ?? "—"}`
  );
  for (const w of filterWarnings) console.warn(`${LOG} ${w}`);

  const bundle = await loadBundle(options);
  console.log(
    `${LOG} loaded orders=${bundle.orders.length} items=${bundle.orderItems.length} nfeLinks=${bundle.nfeLinks.length} nfes=${bundle.nfes.length} stockDocs=${bundle.stockDocuments.length} stockItems=${bundle.stockDocumentItems.length} receivables=${bundle.receivables.length} reconFacts=${bundle.reconciliationFacts.length}`
  );

  const runId = randomUUID();
  const built = buildOrderToCashAuditRows({
    ...bundle,
    options: { runId: options.mode === "apply" ? runId : null, today: new Date() },
  });

  const summary = buildOrderToCashRebuildPreviewSummary({
    ordersCount: bundle.orders.length,
    orderItemsCount: bundle.orderItems.length,
    rows: built.rows,
    builderSummary: built.summary,
    warnings: [...filterWarnings, ...built.warnings],
  });

  printPreview(summary);

  if (options.mode === "preview") {
    console.log(`\n${LOG} PREVIEW — nenhuma gravação realizada.`);
    const sample = built.rows.slice(0, 5);
    console.log(`\nAmostra de facts (${sample.length}):`);
    for (const row of sample) {
      console.log(
        `  - ${row.auditKey} | ${row.lineType} | ${row.orderCode} | stage=${row.orderToCashStage} | alloc=${row.allocatedValueByOrderPrice}`
      );
    }
    return;
  }

  // apply
  const status = await persistApply({
    runId,
    options,
    period,
    rows: built.rows,
    summary,
    builderWarnings: built.warnings,
  });

  console.log("\n=== OrderToCashAudit APPLY ===");
  console.log(`runId: ${runId}`);
  console.log(`totalOrders: ${summary.totalOrders}`);
  console.log(`totalFacts: ${summary.totalFacts}`);
  console.log(`total inserido: ${summary.totalFacts}`);
  console.log(`status: ${status}`);
}

main()
  .catch((error) => {
    console.error(`${LOG} FAILED`, error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
