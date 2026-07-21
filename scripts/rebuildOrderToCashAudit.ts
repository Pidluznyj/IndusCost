/**
 * Rebuild oficial da camada materializada OrderToCashAudit (Run + Fact).
 *
 * Grava somente OrderToCashAuditRun / OrderToCashAuditFact.
 * Não altera SalesOrder, NF, CR, Fluxo, Comissões nem demais módulos oficiais.
 * Não chama Nomus — usa somente a base local já sincronizada.
 *
 * Uso:
 *   npx tsx scripts/rebuildOrderToCashAudit.ts --mode preview --from 2025-06-01 --to 2026-12-31
 *   npx tsx scripts/rebuildOrderToCashAudit.ts --mode apply --from 2025-06-01 --to 2026-12-31
 *   npx tsx scripts/rebuildOrderToCashAudit.ts --mode preview --customerExternalId 200 --year 2026
 *   npx tsx scripts/rebuildOrderToCashAudit.ts --mode apply --customerExternalId 200 --year 2026
 *   npx tsx scripts/rebuildOrderToCashAudit.ts --help
 *
 * Runner com log oficial:
 *   bash scripts/runOrderToCashAuditRebuild.sh apply 2025-06-01 2026-12-31
 *
 * Docs: docs/finance/order-to-cash-audit-rebuild-official.md
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
import { extractNomusRawItems } from "../src/lib/salesOrderNomusRaw.ts";
import {
  parseNomusSalesOrderItemStatus,
  resolveNomusRawItemMatchesForOrder,
} from "../src/lib/sales/nomusSalesOrderItemStatus.ts";
import {
  buildOrderToCashRebuildPreviewSummary,
  detectNomusLockFilesPresent,
  exitCodeForOrderToCashApplyStatus,
  formatCounts,
  formatOrderToCashExecutiveSummary,
  orderToCashFactRowToPrismaData,
  parseOrderToCashRebuildCli,
  printOrderToCashRebuildHelp,
  resolvePeriodBounds,
  validateOrderToCashRebuildFilters,
  type OrderToCashDateAxis,
  type OrderToCashRebuildCliOptions,
} from "../src/lib/sales/orderToCashAuditRebuild.ts";
import { mergeSalesOrderWhereWithPortfolioOperationalGate } from "../src/lib/finance/financePortfolioOperationalOrderGate.server.ts";

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

/**
 * Avisa (e opcionalmente bloqueia) se parece haver sync Nomus ou outro rebuild O2C ativo.
 * Não chama Nomus.
 */
async function assessActiveNomusSyncRisk(): Promise<{
  warnings: string[];
  shouldBlock: boolean;
}> {
  const warnings: string[] = [];
  const lockHits = detectNomusLockFilesPresent();
  for (const lockPath of lockHits) {
    warnings.push(
      `Arquivo de lock Nomus presente: ${lockPath} (possível sync em andamento).`
    );
  }

  try {
    const runningIntegrations = await prisma.integrationRun.findMany({
      where: {
        sourceSystem: "NOMUS",
        status: { in: ["RUNNING", "IN_PROGRESS", "STARTED"] },
        finishedAt: null,
      },
      orderBy: { startedAt: "desc" },
      take: 10,
      select: { id: true, target: true, status: true, command: true, startedAt: true },
    });
    for (const run of runningIntegrations) {
      warnings.push(
        `IntegrationRun Nomus ativa: id=${run.id} target=${run.target} status=${run.status} command=${run.command ?? "—"} startedAt=${run.startedAt?.toISOString() ?? "—"}`
      );
    }
  } catch {
    // Ambientes sem tabela / permissão — não bloqueia o rebuild local.
  }

  try {
    const runningO2c = await prisma.orderToCashAuditRun.findMany({
      where: { status: "RUNNING", finishedAt: null },
      orderBy: { startedAt: "desc" },
      take: 5,
      select: { id: true, startedAt: true, createdBy: true },
    });
    for (const run of runningO2c) {
      warnings.push(
        `Outro OrderToCashAuditRun ainda RUNNING: id=${run.id} startedAt=${run.startedAt?.toISOString() ?? "—"} createdBy=${run.createdBy ?? "—"}`
      );
    }
  } catch {
    // ignore
  }

  return { warnings, shouldBlock: warnings.length > 0 };
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
      where.issueDate = {
        ...(period.from ? { gte: period.from } : {}),
        ...(period.to ? { lte: period.to } : {}),
      };
    }
  }

  // Mesmo universo operacional de Pedidos / CR (exclui CANCELLED/ERROR e MISSING_CONFIRMED).
  return mergeSalesOrderWhereWithPortfolioOperationalGate(where);
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

  const orderItems: OrderToCashAuditOrderItemInput[] = ordersRaw.flatMap((order) => {
    const rawItems = extractNomusRawItems(order.nomusRawResponse);
    const localForMatch = order.items.map((it) => ({
      id: it.id,
      externalProductId: it.externalProductId,
      skuSnapshot: it.skuSnapshot,
      productNameSnapshot: it.productNameSnapshot,
      quantity: it.quantity != null ? Number(it.quantity) : null,
      negotiatedPrice:
        it.negotiatedPrice != null ? Number(it.negotiatedPrice) : null,
      notes: it.notes,
      nomusItemExternalId: it.nomusItemExternalId ?? null,
      nomusItemSequence: it.nomusItemSequence ?? null,
    }));
    const matches = resolveNomusRawItemMatchesForOrder(localForMatch, rawItems);

    return order.items.map((item, index) => {
      const dbCanceled =
        item.nomusIsCanceled === true ||
        item.nomusIsStale === true ||
        (item.nomusItemStatusNormalized ?? "").toUpperCase() === "CANCELED";
      const dbCut =
        item.nomusIsCut === true ||
        (item.nomusItemStatusNormalized ?? "").toUpperCase() === "FULFILLED_WITH_CUT";
      const fromDb = dbCanceled
        ? "CANCELADO"
        : dbCut
          ? "ATENDIDO_COM_CORTE"
          : item.nomusItemStatusNormalized === "FULFILLED"
            ? "ATENDIDO"
            : item.nomusItemStatusNormalized === "PARTIAL"
              ? "PARCIAL"
              : item.nomusItemStatusNormalized === "RELEASED"
                ? "LIBERADO"
                : item.nomusItemStatusNormalized === "PENDING"
                  ? "PENDENTE"
                  : null;

      let itemStatus: string | null = fromDb;
      let nomusIsCanceled = item.nomusIsCanceled === true;
      let nomusIsCut = item.nomusIsCut === true;

      // Fallback: usar match POR LINHA quando DB não tem status persistido.
      if (!itemStatus) {
        const match = matches.get(item.id);
        if (match?.rawItem) {
          const parsed = parseNomusSalesOrderItemStatus(match.rawItem.raw);
          if (parsed.isCanceled) {
            itemStatus = "CANCELADO";
            nomusIsCanceled = true;
          } else if (parsed.isCut) {
            itemStatus = "ATENDIDO_COM_CORTE";
            nomusIsCut = true;
          } else if (parsed.statusNormalized === "FULFILLED") itemStatus = "ATENDIDO";
          else if (parsed.statusNormalized === "PARTIAL") itemStatus = "PARCIAL";
          else if (parsed.statusNormalized === "RELEASED") itemStatus = "LIBERADO";
          else if (parsed.statusNormalized === "PENDING") itemStatus = "PENDENTE";
        }
        void index;
      }
      return {
        id: item.id,
        salesOrderId: order.id,
        externalSalesOrderItemId: item.nomusItemExternalId ?? null,
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
        itemStatus,
        nomusIsCanceled,
        nomusIsStale: item.nomusIsStale === true,
        nomusIsCut,
        nomusItemStatusNormalized: item.nomusItemStatusNormalized ?? null,
        nomusItemStatusRaw: item.nomusItemStatusRaw ?? null,
        nomusMatchConfidence:
          item.nomusMatchConfidence ?? matches.get(item.id)?.matchConfidence ?? null,
      };
    });
  });

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
  console.log("\n" + formatOrderToCashExecutiveSummary(summary, { mode: "preview" }));
  console.log(formatCounts("statusCounts", summary.statusCounts));
  console.log(formatCounts("operationalStageCounts", summary.operationalStageCounts));
  console.log(formatCounts("financialStageCounts", summary.financialStageCounts));
  console.log(formatCounts("paymentStatusCounts", summary.paymentStatusCounts));
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
  let options: OrderToCashRebuildCliOptions;
  try {
    options = parseOrderToCashRebuildCli(process.argv.slice(2));
  } catch (error) {
    if (error instanceof Error && error.message === "HELP") {
      console.log(printOrderToCashRebuildHelp());
      return;
    }
    throw error;
  }

  const filterWarnings = validateOrderToCashRebuildFilters(options);
  const period = resolvePeriodBounds(options);

  console.log(`${LOG} mode=${options.mode} dateAxis=${options.dateAxis}`);
  console.log(
    `${LOG} filters: orderCode=${options.orderCode ?? "—"} salesOrderId=${options.salesOrderId ?? "—"} customerExternalId=${options.customerExternalId ?? "—"} year=${options.year ?? "—"} from=${period.from?.toISOString() ?? "—"} to=${period.to?.toISOString() ?? "—"} limit=${options.limit ?? "—"}`
  );
  console.log(`${LOG} fonte: base local (SalesOrder / NF / Stock / CR) — sem chamada Nomus`);
  for (const w of filterWarnings) console.warn(`${LOG} ${w}`);

  if (options.mode === "apply") {
    const syncRisk = await assessActiveNomusSyncRisk();
    for (const w of syncRisk.warnings) {
      console.warn(`${LOG} AVISO SYNC: ${w}`);
    }
    if (syncRisk.warnings.length === 0) {
      console.log(`${LOG} nenhum sync Nomus ativo detectado (locks/IntegrationRun).`);
    } else if (options.failIfSyncActive) {
      console.error(
        `${LOG} abortando apply: --fail-if-sync-active / ORDER_TO_CASH_AUDIT_FAIL_IF_SYNC_ACTIVE=1`
      );
      process.exitCode = 3;
      return;
    } else {
      console.warn(
        `${LOG} prosseguindo apply apesar do aviso (use --fail-if-sync-active para abortar).`
      );
    }
  }

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

  const status = await persistApply({
    runId,
    options,
    period,
    rows: built.rows,
    summary,
    builderWarnings: built.warnings,
  });

  console.log(
    "\n" +
      formatOrderToCashExecutiveSummary(summary, {
        mode: "apply",
        runId,
        status,
      })
  );
  console.log(`total inserido: ${status === "FAILED" ? 0 : summary.totalFacts}`);
  console.log(`${LOG} APPLY concluído — status=${status} runId=${runId}`);

  process.exitCode = exitCodeForOrderToCashApplyStatus(status);
}

main()
  .catch((error) => {
    if (
      error instanceof Error &&
      /--mode inválido|--year inválido|--dateAxis|--customerExternalId|--limit/.test(
        error.message
      )
    ) {
      console.error(`${LOG} CLI ERROR: ${error.message}`);
      console.error(printOrderToCashRebuildHelp());
      process.exitCode = 2;
    } else {
      console.error(`${LOG} FAILED`, error);
      process.exitCode = 1;
    }
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
