/**
 * Auditoria financeira/técnica — Central de Inteligência × Britânia.
 *
 * Uso:
 *   npx tsx tmp-audits/validate-portfolio-intelligence-britania.ts
 *
 * Preferência: run materializada no banco.
 * Fallback: fixture Britânia-shaped (mesmos totais/códigos) se DB indisponível.
 *
 * Não grava nada. Não altera regras de classificação.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  BRITANIA_INTELLIGENCE_EXPECTED,
  buildPortfolioMaturityAnalytics,
  type PortfolioMaturityAnalyticsResult,
  type PortfolioMaturityOrderRow,
  type PortfolioOrderEnrichment,
} from "../src/lib/finance/portfolioMaturityAnalytics.ts";
import type { PortfolioReconciliationFactApiRow } from "../src/lib/finance/portfolioReconciliationApi.ts";

const RUN_ID = BRITANIA_INTELLIGENCE_EXPECTED.runId;
const AS_OF = "2026-07-10";
const MONEY_TOL = 0.05;

type Check = { name: string; pass: boolean; detail: string };

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

function moneyClose(a: number, b: number): boolean {
  return Math.abs(a - b) <= MONEY_TOL;
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}

function fact(partial: Partial<PortfolioReconciliationFactApiRow> & { id: string }): PortfolioReconciliationFactApiRow {
  return {
    runId: RUN_ID,
    customerId: null,
    customerExternalId: 200,
    customerNameSnapshot: "Britânia",
    salesOrderId: partial.salesOrderId ?? partial.id,
    externalSalesOrderId: null,
    orderCode: partial.orderCode ?? "PD",
    orderIssueDate: partial.orderIssueDate ?? null,
    expectedDeliveryDate: partial.expectedDeliveryDate ?? null,
    salesOrderItemId: partial.salesOrderItemId ?? `${partial.id}-item`,
    externalSalesOrderItemId: null,
    externalProductId: null,
    productSkuSnapshot: null,
    productNameSnapshot: null,
    orderQuantity: 1,
    orderUnitPrice: partial.orderItemValue ?? 0,
    orderItemValue: partial.orderItemValue ?? 0,
    nomusNfeId: null,
    nfeExternalId: partial.nfeExternalId ?? null,
    nfeNumber: null,
    nfeSerie: null,
    nfeKey: null,
    nfeProcessedAt: null,
    nfeHeaderValue: null,
    stockDocumentId: partial.stockDocumentId ?? null,
    stockDocumentExternalId: partial.stockDocumentExternalId ?? null,
    stockDocumentItemId: null,
    stockDocumentItemExternalId: null,
    stockDocumentDate: null,
    stockQuantity: null,
    stockUnitValue: null,
    stockItemValue: null,
    allocatedQuantity: partial.allocatedQuantity ?? null,
    allocatedValueByOrderPrice: partial.allocatedValueByOrderPrice ?? null,
    allocatedValueByStockPrice: null,
    remainingOrderQuantityAfterAllocation: null,
    remainingOrderValueAfterAllocation: null,
    priceDifferenceUnit: null,
    priceDifferenceTotal: null,
    receivableIdsJson: null,
    receivableTotalValue: partial.receivableTotalValue ?? null,
    receivedValue: partial.receivedValue ?? null,
    openReceivableValue: partial.openReceivableValue ?? null,
    dueDatesJson: null,
    settlementDatesJson: null,
    forecastSource: partial.forecastSource ?? "ORDER",
    forecastDate: partial.forecastDate ?? null,
    forecastValue: partial.forecastValue ?? partial.orderItemValue ?? null,
    confidenceLevel: partial.confidenceLevel ?? "MEDIUM",
    status: partial.status ?? "ORDER_ONLY",
    alertsJson: null,
    traceJson: null,
    ...partial,
  };
}

/** Fixture com totais e códigos oficiais Britânia (offline). */
function buildBritaniaShapedFixture(): {
  facts: PortfolioReconciliationFactApiRow[];
  orderTotalBySalesOrderId: Map<string, number>;
} {
  const e = BRITANIA_INTELLIGENCE_EXPECTED;
  const orderTotals = new Map<string, number>();
  const facts: PortfolioReconciliationFactApiRow[] = [];

  const crPool = round2(e.valorTotalPedidos - e.valorSemNfDocCr);
  const crEach = round2(crPool / 18);
  let crAssigned = 0;
  for (let i = 0; i < 18; i++) {
    const id = `cr-${i}`;
    const value = i === 17 ? round2(crPool - crAssigned) : crEach;
    crAssigned = round2(crAssigned + value);
    orderTotals.set(id, value);
    facts.push(
      fact({
        id: `f-cr-${i}`,
        salesOrderId: id,
        orderCode: `PD CR ${i}`,
        salesOrderItemId: `item-cr-${i}`,
        orderItemValue: value,
        allocatedQuantity: 1,
        allocatedValueByOrderPrice: value,
        receivableTotalValue: value,
        openReceivableValue: value,
        receivedValue: 0,
        forecastSource: "RECEIVABLE",
        forecastDate: "2026-08-10",
        status: "RECEIVABLE_CONFIRMED",
        confidenceLevel: "HIGH",
        nfeExternalId: 1000 + i,
        stockDocumentId: `s-${i}`,
        stockDocumentExternalId: 2000 + i,
      })
    );
  }

  for (const [i, o] of e.futurePresentOrders.entries()) {
    const id = `fut-${i}`;
    orderTotals.set(id, o.orderValue);
    const forecastDate =
      o.statusPrincipal === "CARTEIRA_PRESENTE_ATENCAO" ? "2026-07-20" : "2026-09-15";
    facts.push(
      fact({
        id: `f-fut-${i}`,
        salesOrderId: id,
        orderCode: o.orderCode,
        salesOrderItemId: `item-fut-${i}`,
        orderItemValue: o.orderValue,
        forecastSource: "ORDER",
        forecastDate,
        forecastValue: o.orderValue,
        status: "ORDER_ONLY",
        orderIssueDate: "2026-06-01",
        confidenceLevel: "MEDIUM",
      })
    );
  }

  for (const [i, o] of e.blockedOrders.entries()) {
    const id = `blk-${i}`;
    orderTotals.set(id, o.orderValue);
    facts.push(
      fact({
        id: `f-blk-${i}`,
        salesOrderId: id,
        orderCode: o.orderCode,
        salesOrderItemId: `item-blk-${i}`,
        orderItemValue: o.orderValue,
        forecastSource: "ORDER",
        forecastDate: "2025-11-01",
        forecastValue: o.orderValue,
        status: "ORDER_ONLY",
        orderIssueDate: "2025-01-01",
        confidenceLevel: "LOW",
      })
    );
  }

  return { facts, orderTotalBySalesOrderId: orderTotals };
}

function findRow(
  rows: readonly PortfolioMaturityOrderRow[],
  orderCode: string
): PortfolioMaturityOrderRow | undefined {
  return rows.find((r) => r.orderCode === orderCode);
}

function runChecks(
  analytics: PortfolioMaturityAnalyticsResult,
  source: "DB" | "FIXTURE"
): Check[] {
  const e = BRITANIA_INTELLIGENCE_EXPECTED;
  const checks: Check[] = [];
  const add = (name: string, pass: boolean, detail: string) => {
    checks.push({ name, pass, detail });
  };

  add(
    "totalPedidos",
    analytics.totals.totalPedidos === e.totalPedidos,
    `actual=${analytics.totals.totalPedidos} expected=${e.totalPedidos}`
  );
  add(
    "valorTotalPedidos",
    moneyClose(analytics.totals.valorTotalPedidos, e.valorTotalPedidos),
    `actual=${analytics.totals.valorTotalPedidos} expected=${e.valorTotalPedidos}`
  );
  add(
    "pedidosSemNfDocCr",
    analytics.totals.pedidosSemNfDocCr === e.pedidosSemNfDocCr,
    `actual=${analytics.totals.pedidosSemNfDocCr} expected=${e.pedidosSemNfDocCr}`
  );
  add(
    "valorSemNfDocCr",
    moneyClose(analytics.totals.valorSemNfDocCr, e.valorSemNfDocCr),
    `actual=${analytics.totals.valorSemNfDocCr} expected=${e.valorSemNfDocCr}`
  );
  add(
    "carteiraFuturaPresentePlausivel",
    moneyClose(analytics.totals.valorFuturoPresentePlausivel, e.valorFuturoPresentePlausivel),
    `actual=${analytics.totals.valorFuturoPresentePlausivel} expected=${e.valorFuturoPresentePlausivel}`
  );
  add(
    "carteiraVencidaBloqueada",
    moneyClose(analytics.totals.valorVencidoBloqueado, e.valorVencidoBloqueado),
    `actual=${analytics.totals.valorVencidoBloqueado} expected=${e.valorVencidoBloqueado}`
  );

  const totalCard = analytics.summaryCards.find((c) => c.key === "CARTEIRA_TOTAL_ANALISADA");
  add(
    "card.CARTEIRA_TOTAL_ANALISADA",
    Boolean(totalCard && moneyClose(totalCard.value, e.valorTotalPedidos)),
    `value=${totalCard?.value}`
  );
  const blockedCard = analytics.summaryCards.find((c) => c.key === "CARTEIRA_VENCIDA_BLOQUEADA");
  add(
    "card.CARTEIRA_VENCIDA_BLOQUEADA",
    Boolean(blockedCard && moneyClose(blockedCard.value, e.valorVencidoBloqueado) && blockedCard.count === 10),
    `value=${blockedCard?.value} count=${blockedCard?.count}`
  );
  const futuraCard = analytics.summaryCards.find((c) => c.key === "CARTEIRA_FUTURA_PROVAVEL");
  const presenteCard = analytics.summaryCards.find((c) => c.key === "CARTEIRA_PRESENTE_ATENCAO");
  const futuraPresente =
    (futuraCard?.value ?? 0) + (presenteCard?.value ?? 0);
  add(
    "cards.futura+presente",
    moneyClose(futuraPresente, e.valorFuturoPresentePlausivel),
    `futura=${futuraCard?.value} presente=${presenteCard?.value} sum=${futuraPresente}`
  );

  const statusSum = analytics.statusGroups.reduce((s, g) => s + g.orderValue, 0);
  add(
    "grupos.somaStatus=carteiraTotal",
    moneyClose(statusSum, analytics.totals.valorTotalPedidos),
    `statusSum=${statusSum} total=${analytics.totals.valorTotalPedidos}`
  );

  const codesByStatus = new Map<string, string>();
  let duplicate = false;
  for (const g of analytics.statusGroups) {
    for (const code of g.orderCodes) {
      if (codesByStatus.has(code)) {
        duplicate = true;
        break;
      }
      codesByStatus.set(code, g.statusPrincipal);
    }
  }
  add("statusPrincipal.semDuplicidade", !duplicate, duplicate ? "pedido em 2 grupos" : "ok");

  const rowSum = analytics.rows.reduce((s, r) => s + r.orderValue, 0);
  add(
    "rows.somaUnica=carteiraTotal",
    moneyClose(rowSum, analytics.totals.valorTotalPedidos) &&
      analytics.rows.length === analytics.totals.totalPedidos,
    `rowSum=${rowSum} rows=${analytics.rows.length}`
  );

  for (const expected of e.futurePresentOrders) {
    const row = findRow(analytics.rows, expected.orderCode);
    add(
      `pedido.${expected.orderCode}.status`,
      row?.statusPrincipal === expected.statusPrincipal,
      `actual=${row?.statusPrincipal} expected=${expected.statusPrincipal}`
    );
    add(
      `pedido.${expected.orderCode}.valor`,
      Boolean(row && moneyClose(row.orderValue, expected.orderValue)),
      `actual=${row?.orderValue} expected=${expected.orderValue}`
    );
  }

  for (const expected of e.blockedOrders) {
    const row = findRow(analytics.rows, expected.orderCode);
    add(
      `pedido.${expected.orderCode}.status`,
      row?.statusPrincipal === "CARTEIRA_VENCIDA_BLOQUEADA",
      `actual=${row?.statusPrincipal}`
    );
    add(
      `pedido.${expected.orderCode}.valor`,
      Boolean(row && moneyClose(row.orderValue, expected.orderValue)),
      `actual=${row?.orderValue} expected=${expected.orderValue}`
    );
    add(
      `pedido.${expected.orderCode}.confiancaMuitoBaixa`,
      Boolean(
        row &&
          (row.confidenceLabel === "MUITO_BAIXA" || row.confidenceScore < 30)
      ),
      `label=${row?.confidenceLabel} score=${row?.confidenceScore}`
    );
    add(
      `pedido.${expected.orderCode}.semNfDocCr`,
      Boolean(
        row &&
          !row.evidenceFlags.hasNfe &&
          !row.evidenceFlags.hasStockDocument &&
          !row.evidenceFlags.hasReceivable
      ),
      `nfe=${row?.evidenceFlags.hasNfe} doc=${row?.evidenceFlags.hasStockDocument} cr=${row?.evidenceFlags.hasReceivable}`
    );
  }

  // Confiança: futuros tendem a MEDIA; presente pode ser BAIXA (regra 40–60) — não forçar MEDIA.
  for (const code of ["PD 02607", "PD 02740"]) {
    const row = findRow(analytics.rows, code);
    add(
      `pedido.${code}.confiancaMediaFaixa`,
      Boolean(row && row.confidenceScore >= 55 && row.confidenceScore <= 70),
      `score=${row?.confidenceScore} label=${row?.confidenceLabel}`
    );
  }
  {
    const row = findRow(analytics.rows, "PD 02739");
    add(
      "pedido.PD 02739.confiancaPresenteFaixa",
      Boolean(row && row.confidenceScore >= 40 && row.confidenceScore <= 60),
      `score=${row?.confidenceScore} label=${row?.confidenceLabel} (presente/atenção: BAIXA é esperada pela regra; não forçar MEDIA)`
    );
  }

  const futuraCount = analytics.rows.filter(
    (r) => r.statusPrincipal === "CARTEIRA_FUTURA_PROVAVEL"
  ).length;
  const presenteCount = analytics.rows.filter(
    (r) => r.statusPrincipal === "CARTEIRA_PRESENTE_ATENCAO"
  ).length;
  const blockedCount = analytics.rows.filter(
    (r) => r.statusPrincipal === "CARTEIRA_VENCIDA_BLOQUEADA"
  ).length;
  add(
    "sanfona.futura+presente.count=3",
    futuraCount + presenteCount === 3,
    `futura=${futuraCount} presente=${presenteCount}`
  );
  add("sanfona.vencida.count=10", blockedCount === 10, `count=${blockedCount}`);

  let explanationsOk = analytics.summaryCards.length > 0;
  for (const card of analytics.summaryCards) {
    const ex = card.explanation;
    if (
      !ex?.whatItMeans?.trim() ||
      !ex.howWeCalculate?.trim() ||
      !ex.whatIsIncluded?.trim() ||
      !ex.whatIsExcluded?.trim() ||
      !ex.howToInterpret?.trim()
    ) {
      explanationsOk = false;
      break;
    }
  }
  add("explanations.cardsCompletas", explanationsOk, `cards=${analytics.summaryCards.length}`);

  const pd02159 = findRow(analytics.rows, "PD 02159");
  add(
    "drawer.PD02159.ausenciaNfDocCr",
    Boolean(
      pd02159 &&
        !pd02159.evidenceFlags.hasNfe &&
        !pd02159.evidenceFlags.hasStockDocument &&
        !pd02159.evidenceFlags.hasReceivable
    ),
    `status=${pd02159?.statusPrincipal}`
  );

  add(
    `fonte.${source}`,
    true,
    source === "DB" ? "run materializada" : "fixture Britânia-shaped (DB indisponível)"
  );

  return checks;
}

function printChecks(checks: Check[]) {
  console.log("\n=== PASS/FAIL por regra ===");
  let pass = 0;
  let fail = 0;
  for (const c of checks) {
    if (c.name.startsWith("fonte.")) {
      console.log(`INFO  ${c.name}: ${c.detail}`);
      continue;
    }
    const mark = c.pass ? "PASS" : "FAIL";
    if (c.pass) pass += 1;
    else fail += 1;
    console.log(`${mark} ${c.name} — ${c.detail}`);
  }
  console.log(`\nResumo: PASS=${pass} FAIL=${fail}`);
  return fail === 0;
}

async function loadFromDb(): Promise<PortfolioMaturityAnalyticsResult> {
  const prisma = new PrismaClient();
  try {
    const run = await prisma.portfolioReconciliationRun.findUnique({
      where: { id: RUN_ID },
    });
    if (!run) {
      throw new Error(`Run ${RUN_ID} não encontrada neste banco.`);
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

    return buildPortfolioMaturityAnalytics({
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
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  console.log("=== Portfolio Intelligence — Validação Britânia ===");
  console.log(`runId=${RUN_ID} asOf=${AS_OF} tol=R$ ${MONEY_TOL}`);

  let analytics: PortfolioMaturityAnalyticsResult;
  let source: "DB" | "FIXTURE" = "DB";

  try {
    analytics = await loadFromDb();
    console.log("Fonte: banco (run materializada).");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      /Can't reach database server|ECONNREFUSED|P1001|não encontrada/i.test(msg)
    ) {
      console.warn(`DB indisponível/sem run: ${msg}`);
      console.warn("Rodando fixture Britânia-shaped com valores oficiais (sem maquiar).");
      const fixture = buildBritaniaShapedFixture();
      analytics = buildPortfolioMaturityAnalytics({
        facts: fixture.facts,
        orderTotalBySalesOrderId: fixture.orderTotalBySalesOrderId,
        filters: {
          runId: RUN_ID,
          customerExternalId: 200,
          asOfDate: AS_OF,
          pageSize: 200,
        },
      });
      source = "FIXTURE";
    } else {
      console.error(msg);
      process.exitCode = 1;
      return;
    }
  }

  console.log(
    `Pedidos classificados=${analytics.rows.length} cards=${analytics.summaryCards.length} groups=${analytics.statusGroups.length}`
  );
  if (analytics.warnings.length) {
    console.log("--- Warnings ---");
    for (const w of analytics.warnings) console.log(w);
  }

  const checks = runChecks(analytics, source);
  const ok = printChecks(checks);

  if (!ok) {
    console.error(
      "\nFALHA: divergência real. Não forçar número — investigar classificação/agregação ou mudança na origem."
    );
    process.exitCode = 1;
    return;
  }

  if (source === "FIXTURE") {
    console.log(
      "\nBritânia bateu 100% no modo FIXTURE (service puro). Reexecute com DB para validar a run materializada."
    );
  } else {
    console.log("\nBritânia bateu 100% na run materializada.");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
