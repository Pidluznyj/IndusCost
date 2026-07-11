/**
 * Auditoria read-only — Central de Inteligência × Britânia.
 *
 * Uso:
 *   npx tsx tmp-audits/validate-portfolio-intelligence-britania.ts
 *
 * Não grava nada. Não altera AR/Fluxo/Comissões/Presidencial.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  BRITANIA_INTELLIGENCE_EXPECTED,
  buildPortfolioMaturityAnalytics,
  type PortfolioOrderEnrichment,
} from "../src/lib/finance/portfolioMaturityAnalytics.ts";
import type { PortfolioReconciliationFactApiRow } from "../src/lib/finance/portfolioReconciliationApi.ts";

const RUN_ID = BRITANIA_INTELLIGENCE_EXPECTED.runId;
const AS_OF = "2026-07-10";

function decimalToNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    try {
      const n = (value as { toNumber: () => number }).toNumber();
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mapFact(row: Record<string, unknown>): PortfolioReconciliationFactApiRow {
  const num = (k: string) => decimalToNumber(row[k]);
  return {
    id: String(row.id),
    runId: String(row.runId),
    customerId: (row.customerId as string | null) ?? null,
    customerExternalId: (row.customerExternalId as number | null) ?? null,
    customerNameSnapshot: (row.customerNameSnapshot as string | null) ?? null,
    salesOrderId: (row.salesOrderId as string | null) ?? null,
    externalSalesOrderId: (row.externalSalesOrderId as number | null) ?? null,
    orderCode: (row.orderCode as string | null) ?? null,
    orderIssueDate: (row.orderIssueDate as Date | null) ?? null,
    expectedDeliveryDate: (row.expectedDeliveryDate as Date | null) ?? null,
    salesOrderItemId: (row.salesOrderItemId as string | null) ?? null,
    externalSalesOrderItemId: (row.externalSalesOrderItemId as number | null) ?? null,
    externalProductId: (row.externalProductId as number | null) ?? null,
    productSkuSnapshot: (row.productSkuSnapshot as string | null) ?? null,
    productNameSnapshot: (row.productNameSnapshot as string | null) ?? null,
    orderQuantity: num("orderQuantity"),
    orderUnitPrice: num("orderUnitPrice"),
    orderItemValue: num("orderItemValue"),
    nomusNfeId: (row.nomusNfeId as string | null) ?? null,
    nfeExternalId: (row.nfeExternalId as number | null) ?? null,
    nfeNumber: (row.nfeNumber as string | null) ?? null,
    nfeSerie: (row.nfeSerie as string | null) ?? null,
    nfeKey: (row.nfeKey as string | null) ?? null,
    nfeProcessedAt: (row.nfeProcessedAt as Date | null) ?? null,
    nfeHeaderValue: num("nfeHeaderValue"),
    stockDocumentId: (row.stockDocumentId as string | null) ?? null,
    stockDocumentExternalId: (row.stockDocumentExternalId as number | null) ?? null,
    stockDocumentItemId: (row.stockDocumentItemId as string | null) ?? null,
    stockDocumentItemExternalId:
      (row.stockDocumentItemExternalId as number | null) ?? null,
    stockDocumentDate: (row.stockDocumentDate as Date | null) ?? null,
    stockQuantity: num("stockQuantity"),
    stockUnitValue: num("stockUnitValue"),
    stockItemValue: num("stockItemValue"),
    allocatedQuantity: num("allocatedQuantity"),
    allocatedValueByOrderPrice: num("allocatedValueByOrderPrice"),
    allocatedValueByStockPrice: num("allocatedValueByStockPrice"),
    remainingOrderQuantityAfterAllocation: num("remainingOrderQuantityAfterAllocation"),
    remainingOrderValueAfterAllocation: num("remainingOrderValueAfterAllocation"),
    priceDifferenceUnit: num("priceDifferenceUnit"),
    priceDifferenceTotal: num("priceDifferenceTotal"),
    receivableIdsJson: row.receivableIdsJson ?? null,
    receivableTotalValue: num("receivableTotalValue"),
    receivedValue: num("receivedValue"),
    openReceivableValue: num("openReceivableValue"),
    dueDatesJson: row.dueDatesJson ?? null,
    settlementDatesJson: row.settlementDatesJson ?? null,
    forecastSource: String(row.forecastSource ?? "UNRESOLVED"),
    forecastDate: (row.forecastDate as Date | null) ?? null,
    forecastValue: num("forecastValue"),
    confidenceLevel: String(row.confidenceLevel ?? "LOW"),
    status: (row.status as string | null) ?? null,
    alertsJson: row.alertsJson ?? null,
    traceJson: row.traceJson ?? null,
  };
}

function diff(label: string, actual: number, expected: number) {
  const delta = Number((actual - expected).toFixed(2));
  const ok = Math.abs(delta) < 0.02;
  console.log(
    `${ok ? "OK" : "DIFF"} ${label}: actual=${actual} expected=${expected} delta=${delta}`
  );
  return ok;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const run = await prisma.portfolioReconciliationRun.findUnique({
      where: { id: RUN_ID },
    });
    if (!run) {
      console.error(`Run ${RUN_ID} não encontrada neste banco.`);
      console.error("Script é read-only — rode no ambiente com a run Britânia materializada.");
      process.exitCode = 2;
      return;
    }

    const rawFacts = await prisma.portfolioReconciliationFact.findMany({
      where: {
        runId: RUN_ID,
        customerExternalId: BRITANIA_INTELLIGENCE_EXPECTED.customerExternalId,
      },
      orderBy: [{ orderCode: "asc" }, { id: "asc" }],
    });
    const facts = rawFacts.map((r) => mapFact(r as unknown as Record<string, unknown>));

    const orderIds = [
      ...new Set(facts.map((f) => f.salesOrderId).filter((id): id is string => id != null)),
    ];
    const orderTotalBySalesOrderId = new Map<string, number>();
    const enrichmentsBySalesOrderId = new Map<string, PortfolioOrderEnrichment>();
    if (orderIds.length > 0) {
      const orders = await prisma.salesOrder.findMany({
        where: { id: { in: orderIds } },
        select: {
          id: true,
          totalNetValue: true,
          nomusSellerName: true,
          externalSellerId: true,
          paymentTerms: true,
          paymentMethod: true,
          externalCompanyId: true,
          updatedAt: true,
        },
      });
      for (const order of orders) {
        const n = decimalToNumber(order.totalNetValue);
        if (n != null) orderTotalBySalesOrderId.set(order.id, n);
        enrichmentsBySalesOrderId.set(order.id, {
          salesOrderId: order.id,
          orderValue: n,
          sellerName: order.nomusSellerName,
          sellerExternalId: order.externalSellerId,
          paymentTerms: order.paymentTerms,
          paymentMethod: order.paymentMethod,
          companyId:
            order.externalCompanyId != null ? String(order.externalCompanyId) : null,
          updatedAt: order.updatedAt,
        });
      }
    }

    const analytics = buildPortfolioMaturityAnalytics({
      facts,
      orderTotalBySalesOrderId,
      enrichmentsBySalesOrderId,
      filters: {
        runId: RUN_ID,
        customerExternalId: BRITANIA_INTELLIGENCE_EXPECTED.customerExternalId,
        asOfDate: AS_OF,
        pageSize: 200,
      },
    });

    const e = BRITANIA_INTELLIGENCE_EXPECTED;
    console.log("=== Portfolio Intelligence — Britânia ===");
    console.log(`runId=${RUN_ID} asOf=${AS_OF} facts=${facts.length}`);
    console.log("--- Totais ---");
    const checks = [
      diff("totalPedidos", analytics.totals.totalPedidos, e.totalPedidos),
      diff("valorTotalPedidos", analytics.totals.valorTotalPedidos, e.valorTotalPedidos),
      diff("pedidosSemNfDocCr", analytics.totals.pedidosSemNfDocCr, e.pedidosSemNfDocCr),
      diff("valorSemNfDocCr", analytics.totals.valorSemNfDocCr, e.valorSemNfDocCr),
      diff(
        "valorFuturoPresentePlausivel",
        analytics.totals.valorFuturoPresentePlausivel,
        e.valorFuturoPresentePlausivel
      ),
      diff(
        "valorVencidoBloqueado",
        analytics.totals.valorVencidoBloqueado,
        e.valorVencidoBloqueado
      ),
    ];

    console.log("--- Cards principais ---");
    for (const card of analytics.summaryCards) {
      console.log(
        `${card.key}: value=${card.value} count=${card.count} pct=${card.percentage} alert=${card.isAlertCard}`
      );
    }

    console.log("--- Status groups (sem NF/doc/CR) ---");
    const onlyOrder = analytics.rows.filter(
      (r) =>
        !r.evidenceFlags.hasNfe &&
        !r.evidenceFlags.hasStockDocument &&
        !r.evidenceFlags.hasReceivable
    );
    for (const r of onlyOrder) {
      console.log(
        `${r.orderCode} status=${r.statusPrincipal} value=${r.orderValue} forecast=${r.forecastDate} conf=${r.confidenceScore}`
      );
    }

    if (analytics.warnings.length) {
      console.log("--- Warnings ---");
      for (const w of analytics.warnings) console.log(w);
    }

    const allOk = checks.every(Boolean);
    if (!allOk) {
      console.error(
        "\nDivergência vs valores esperados. Não forçar número — investigar classificação/agregação ou mudança na origem."
      );
      process.exitCode = 1;
      return;
    }
    console.log("\nValidação Britânia OK.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  if (/Can't reach database server|ECONNREFUSED|P1001/i.test(msg)) {
    console.error(
      "Banco indisponível neste ambiente. Rode o script no servidor/ambiente com a run Britânia."
    );
    console.error(
      "Validação unitária Britânia-shaped: src/lib/finance/portfolioMaturityAnalytics.test.ts"
    );
    process.exitCode = 2;
    return;
  }
  console.error(msg);
  process.exitCode = 1;
});
