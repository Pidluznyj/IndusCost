/**
 * Rebuild manual da tabela fato PortfolioReconciliationFact.
 *
 * Camada paralela — grava somente PortfolioReconciliationRun + Fact.
 * Não altera AR, Faturamento, Fluxo de Caixa, Comissões, SalesOrder, NomusNfe.
 * Sem cron.
 *
 * Uso:
 *   npx tsx scripts/rebuildPortfolioReconciliationFacts.ts preview --orderCode="PD 02339" --explain
 *   npx tsx scripts/rebuildPortfolioReconciliationFacts.ts preview --from=2025-07-01 --to=2026-07-10
 *   npx tsx scripts/rebuildPortfolioReconciliationFacts.ts apply --from=2025-07-01 --to=2026-07-10
 *   npx tsx scripts/rebuildPortfolioReconciliationFacts.ts apply --orderCode="PD 02339" --replace-latest
 */
import "dotenv/config";
import { Prisma, PrismaClient } from "@prisma/client";
import { buildPortfolioReconciliationFacts } from "../src/lib/finance/portfolioReconciliationAllocationEngine.ts";
import {
  paymentRuleFromDbRow,
  type PortfolioPaymentRule,
} from "../src/lib/finance/portfolioPaymentCalendar.ts";
import { enrichPortfolioFactsWithReceivables } from "../src/lib/finance/portfolioReconciliationReceivables.ts";
import {
  buildPortfolioRebuildSummary,
  buildRebuildFilterKey,
  draftFactToPrismaData,
  filtersMatchRebuildKey,
  formatPortfolioRebuildExplain,
  parseRebuildPortfolioCli,
  resolveRebuildRunId,
  shouldWritePortfolioRebuild,
  type RebuildPortfolioCliOptions,
} from "../src/lib/finance/portfolioReconciliationRebuild.ts";
import { mergeSalesOrderWhereWithPortfolioOperationalGate } from "../src/lib/finance/financePortfolioOperationalOrderGate.server.ts";
import type {
  PortfolioReconciliationSnapshot,
  SnapshotNfe,
  SnapshotNfeLink,
  SnapshotOrder,
  SnapshotStockDocument,
} from "../src/lib/finance/portfolioReconciliationAllocationEngine.ts";
import type { SnapshotReceivable } from "../src/lib/finance/portfolioReconciliationReceivables.ts";

const prisma = new PrismaClient();
const LOG_PREFIX = "[portfolio-reconciliation-rebuild]";

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

async function loadSnapshot(
  options: RebuildPortfolioCliOptions
): Promise<{
  snapshot: PortfolioReconciliationSnapshot;
  receivables: SnapshotReceivable[];
  paymentRules: PortfolioPaymentRule[];
}> {
  const orderWhere: Prisma.SalesOrderWhereInput = {};
  if (options.orderCode) {
    orderWhere.orderCode = options.orderCode;
  }
  if (options.customerExternalId != null) {
    orderWhere.externalCustomerId = options.customerExternalId;
  }
  if (options.fromDate || options.toDate) {
    orderWhere.issueDate = {};
    if (options.fromDate) orderWhere.issueDate.gte = options.fromDate;
    if (options.toDate) {
      const end = new Date(options.toDate);
      end.setHours(23, 59, 59, 999);
      orderWhere.issueDate.lte = end;
    }
  }

  // Mesmo universo operacional de Pedidos / CR (exclui CANCELLED/ERROR e MISSING_CONFIRMED).
  const gatedOrderWhere = mergeSalesOrderWhereWithPortfolioOperationalGate(orderWhere);

  const ordersRaw = await prisma.salesOrder.findMany({
    where: gatedOrderWhere,
    take: options.maxOrders ?? undefined,
    orderBy: { issueDate: "asc" },
    include: {
      items: true,
      Customer: { select: { id: true, companyName: true, tradeName: true } },
      nfeLinks: true,
    },
  });

  const orders: SnapshotOrder[] = ordersRaw.map((order) => ({
    id: order.id,
    externalSalesOrderId: order.externalSalesOrderId,
    orderCode: order.orderCode,
    issueDate: order.issueDate,
    expectedDeliveryDate: order.expectedDeliveryDate,
    customerId: order.customerId,
    customerExternalId: order.externalCustomerId,
    customerNameSnapshot: order.Customer.tradeName ?? order.Customer.companyName,
    totalNetValue: dec(order.totalNetValue),
    items: order.items.map((item) => ({
      id: item.id,
      externalProductId: item.externalProductId,
      productSkuSnapshot: item.skuSnapshot,
      productNameSnapshot: item.productNameSnapshot,
      quantity: dec(item.quantity),
      unitPrice: dec(item.negotiatedPrice),
      totalNetValue: dec(item.totalNetValue),
    })),
  }));

  const nfeLinks: SnapshotNfeLink[] = ordersRaw.flatMap((order) =>
    order.nfeLinks.map((link) => ({
      salesOrderId: order.id,
      nfeExternalId: link.nfeExternalId,
      nfeNumber: link.nfeNumber,
      nfeSerie: link.nfeSerie,
      nfeKey: link.nfeKey,
      dataProcessamento: link.dataProcessamento,
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
            dataProcessamento: true,
            valorLiquido: true,
          },
        })
      : [];

  const nfes: SnapshotNfe[] = nfesRaw.map((nfe) => ({
    id: nfe.id,
    externalId: nfe.externalId,
    numero: nfe.numero,
    serie: nfe.serie,
    chave: nfe.chave,
    dataProcessamento: nfe.dataProcessamento,
    valorLiquido: decOrNull(nfe.valorLiquido),
  }));

  const stockRaw =
    nfeExternalIds.length > 0
      ? await prisma.nomusStockDocument.findMany({
          where: { idNfe: { in: nfeExternalIds } },
          include: { items: true },
        })
      : [];

  const stockDocuments: SnapshotStockDocument[] = stockRaw.map((doc) => ({
    id: doc.id,
    externalId: doc.externalId,
    idNfe: doc.idNfe,
    dataDocumento: doc.dataDocumento,
    items: doc.items.map((item) => ({
      id: item.id,
      externalItemId: item.externalItemId,
      externalProductId: item.externalProductId,
      quantity: dec(item.quantity),
      unitValue: dec(item.unitValue),
      estimatedTotalValue: dec(item.estimatedTotalValue),
    })),
  }));

  const invoiceNumbers = nfesRaw.map((n) => n.numero).filter((n): n is string => !!n && n.trim().length > 0);
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
            personName: true,
            personCnpj: true,
            personId: true,
            amountReceivable: true,
            amountReceived: true,
            balanceReceivable: true,
            dueDate: true,
            settlementDate: true,
          },
        })
      : [];

  const receivables: SnapshotReceivable[] = receivablesRaw.map((row) => ({
    id: row.id,
    externalId: row.externalId,
    sourceInvoiceId: row.sourceInvoiceId,
    sourceInvoiceNumber: row.sourceInvoiceNumber,
    personName: row.personName,
    personCnpj: row.personCnpj,
    personId: row.personId,
    amountReceivable: decOrNull(row.amountReceivable),
    amountReceived: decOrNull(row.amountReceived),
    balanceReceivable: decOrNull(row.balanceReceivable),
    dueDate: row.dueDate,
    settlementDate: row.settlementDate,
  }));

  const paymentRulesRaw = await prisma.portfolioCustomerPaymentRule.findMany({
    where: { isActive: true },
  });
  const paymentRules = paymentRulesRaw.map(paymentRuleFromDbRow);

  return {
    snapshot: { orders, nfeLinks, nfes, stockDocuments },
    receivables,
    paymentRules,
  };
}

/**
 * --replace-latest: remove o último run SUCCESS com o mesmo filterKey.
 * Seguro porque só apaga Run/Fact da camada paralela (cascade), nunca dados oficiais.
 */
async function maybeReplaceLatestRun(options: RebuildPortfolioCliOptions): Promise<string | null> {
  if (!options.replaceLatest) return null;
  const key = buildRebuildFilterKey(options);
  const candidates = await prisma.portfolioReconciliationRun.findMany({
    where: { status: "SUCCESS", mode: "apply" },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, filtersJson: true, createdAt: true },
  });
  const match = candidates.find((row) => filtersMatchRebuildKey(row.filtersJson, key));
  if (!match) {
    console.warn(`${LOG_PREFIX} --replace-latest: nenhum run anterior com o mesmo filtro.`);
    return null;
  }
  await prisma.portfolioReconciliationRun.delete({ where: { id: match.id } });
  console.warn(`${LOG_PREFIX} --replace-latest: removido run anterior ${match.id}`);
  return match.id;
}

async function persistApply(params: {
  runId: string;
  options: RebuildPortfolioCliOptions;
  facts: ReturnType<typeof enrichPortfolioFactsWithReceivables>;
  summary: ReturnType<typeof buildPortfolioRebuildSummary>;
}): Promise<void> {
  const { runId, options, facts, summary } = params;
  const startedAt = new Date();
  const filterKey = buildRebuildFilterKey(options);

  await prisma.portfolioReconciliationRun.create({
    data: {
      id: runId,
      startedAt,
      status: "RUNNING",
      mode: "apply",
      fromDate: options.fromDate,
      toDate: options.toDate,
      customerExternalId: options.customerExternalId,
      filtersJson: {
        filterKey,
        orderCode: options.orderCode,
        maxOrders: options.maxOrders,
        replaceLatest: options.replaceLatest,
      } as Prisma.InputJsonValue,
    },
  });

  try {
    const chunkSize = 200;
    for (let i = 0; i < facts.length; i += chunkSize) {
      const chunk = facts.slice(i, i + chunkSize);
      await prisma.portfolioReconciliationFact.createMany({
        data: chunk.map((fact) => {
          const row = draftFactToPrismaData(fact, runId);
          return {
            ...row,
            orderQuantity: row.orderQuantity as number | null,
            orderUnitPrice: row.orderUnitPrice as number | null,
            orderItemValue: row.orderItemValue as number | null,
            nfeHeaderValue: row.nfeHeaderValue as number | null,
            stockQuantity: row.stockQuantity as number | null,
            stockUnitValue: row.stockUnitValue as number | null,
            stockItemValue: row.stockItemValue as number | null,
            allocatedQuantity: row.allocatedQuantity as number | null,
            allocatedValueByOrderPrice: row.allocatedValueByOrderPrice as number | null,
            allocatedValueByStockPrice: row.allocatedValueByStockPrice as number | null,
            remainingOrderQuantityAfterAllocation:
              row.remainingOrderQuantityAfterAllocation as number | null,
            remainingOrderValueAfterAllocation:
              row.remainingOrderValueAfterAllocation as number | null,
            priceDifferenceUnit: row.priceDifferenceUnit as number | null,
            priceDifferenceTotal: row.priceDifferenceTotal as number | null,
            receivableTotalValue: row.receivableTotalValue as number | null,
            receivedValue: row.receivedValue as number | null,
            openReceivableValue: row.openReceivableValue as number | null,
            forecastValue: row.forecastValue as number | null,
            receivableIdsJson: row.receivableIdsJson as Prisma.InputJsonValue,
            dueDatesJson: row.dueDatesJson as Prisma.InputJsonValue,
            settlementDatesJson: row.settlementDatesJson as Prisma.InputJsonValue,
            alertsJson: row.alertsJson as Prisma.InputJsonValue,
            traceJson: row.traceJson as Prisma.InputJsonValue,
            forecastSource: row.forecastSource as "RECEIVABLE" | "NFE" | "ORDER" | "UNRESOLVED",
            confidenceLevel: row.confidenceLevel as "HIGH" | "MEDIUM" | "LOW" | "BLOCKED",
          };
        }),
      });
    }

    await prisma.portfolioReconciliationRun.update({
      where: { id: runId },
      data: {
        status: "SUCCESS",
        finishedAt: new Date(),
        summaryJson: summary as unknown as Prisma.InputJsonValue,
        errorMessage: null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.portfolioReconciliationRun.update({
      where: { id: runId },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        errorMessage: message.slice(0, 2000),
        summaryJson: summary as unknown as Prisma.InputJsonValue,
      },
    });
    throw error;
  }
}

async function main(): Promise<void> {
  const options = parseRebuildPortfolioCli(process.argv.slice(2));
  const runId = resolveRebuildRunId(options);

  console.warn(
    `${LOG_PREFIX} modo=${options.mode} runId=${runId} orderCode=${options.orderCode ?? "-"} from=${options.fromDate?.toISOString().slice(0, 10) ?? "-"} to=${options.toDate?.toISOString().slice(0, 10) ?? "-"} customerExternalId=${options.customerExternalId ?? "-"} explain=${options.explain} replaceLatest=${options.replaceLatest}`
  );

  if (options.replaceLatest && options.mode !== "apply") {
    console.warn(`${LOG_PREFIX} --replace-latest ignorado em preview (não grava).`);
  }

  const { snapshot, receivables, paymentRules } = await loadSnapshot(options);
  console.warn(`${LOG_PREFIX} pedidos carregados=${snapshot.orders.length} linksNF=${snapshot.nfeLinks.length} docsEstoque=${snapshot.stockDocuments.length} titulosCR=${receivables.length}`);

  const built = buildPortfolioReconciliationFacts({
    runId,
    mode: options.mode,
    fromDate: options.fromDate,
    toDate: options.toDate,
    customerExternalId: options.customerExternalId,
    orderCode: options.orderCode,
    snapshot,
  });

  const facts = enrichPortfolioFactsWithReceivables({
    facts: built.facts,
    receivables,
    nfes: snapshot.nfes,
    nfeLinks: snapshot.nfeLinks,
    paymentRules,
  });

  const summary = buildPortfolioRebuildSummary(facts, snapshot);

  console.warn(`${LOG_PREFIX} resumo:`);
  console.warn(
    JSON.stringify(
      {
        pedidosAnalisados: summary.ordersAnalyzed,
        pedidosOrderOnly: summary.ordersOrderOnly,
        pedidosComNf: summary.ordersWithNfe,
        pedidosComDocumentoEstoque: summary.ordersWithStockDocument,
        pedidosComCr: summary.ordersWithReceivable,
        factsGeradas: summary.factsGenerated,
        alertas: summary.alertCount,
        divergencias: summary.divergenceCount,
        totalPedido: summary.totalOrderValue,
        totalAlocado: summary.totalAllocatedValue,
        totalCr: summary.totalReceivableValue,
        saldoProjetado: summary.projectedOpenBalance,
        statusCounts: summary.statusCounts,
      },
      null,
      2
    )
  );

  if (options.explain) {
    console.warn(`\n${LOG_PREFIX} === EXPLAIN ===`);
    console.warn(formatPortfolioRebuildExplain(facts, snapshot, options.orderCode));
  }

  if (!shouldWritePortfolioRebuild(options.mode)) {
    console.warn(`${LOG_PREFIX} preview — nenhuma escrita no banco (Run/Fact não gravados).`);
    console.log(
      JSON.stringify(
        {
          mode: options.mode,
          runId,
          wrote: false,
          summary,
          sampleFacts: facts.slice(0, 5),
        },
        null,
        2
      )
    );
    return;
  }

  if (options.replaceLatest) {
    await maybeReplaceLatestRun(options);
  }

  await persistApply({ runId, options, facts, summary });
  console.warn(`${LOG_PREFIX} apply OK — runId=${runId} facts=${facts.length}`);
  console.log(JSON.stringify({ mode: options.mode, runId, wrote: true, summary }, null, 2));
}

main()
  .catch((error) => {
    console.error(`${LOG_PREFIX} falha`, error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
