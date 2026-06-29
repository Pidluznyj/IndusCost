#!/usr/bin/env npx tsx
/**
 * Compara métricas de Pedidos de Venda entre motor oficial, listagem, gestão e relatório executivo.
 *
 * Uso:
 *   npx tsx scripts/audit-sales-order-rules-consumption.ts --year=2026 --month=6 --asOfDate=2026-06-26
 */
import { prisma } from "../src/lib/prisma.js";
import { resolveExecutiveDashboardYearContext } from "../src/lib/executiveDashboardYear.js";
import { buildSalesOrdersDashboardTab } from "../src/lib/salesOrdersDashboardMetrics.js";
import { buildFinanceSalesOrdersDashboard } from "../src/lib/financeSalesOrdersDashboard.js";
import { loadSalesOrderManagementPage } from "../src/lib/salesOrderIntelligenceRoutes.js";
import {
  buildOfficialSalesOrderListPayload,
  buildOfficialSalesOrderManagementCore,
  mapPrismaOrderToSalesOrderRulesInput,
  OFFICIAL_SO_RULES_SOURCE,
  SALES_ORDER_RULES_PRISMA_SELECT,
} from "../src/lib/salesOrderRulesAdapter.js";
import { buildOfficialSalesOrderRulesResult } from "../src/lib/salesOrderRulesAdapter.js";
import { buildSalesOrderListWhere } from "../src/lib/salesOrdersListSummary.js";
import { buildSalesOrderManagementWhere } from "../src/lib/salesOrderManagement.js";
import { loadSalesOrderLinkedNfeContextMap } from "../src/lib/salesOrderLinkedNfe.js";
import { registerOfficialServerResolversForAuditScripts } from "../src/lib/registerServerResolvers.js";

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return undefined;
}

type AuditRow = {
  indicator: string;
  engine: number;
  listScreen: number | null;
  management: number | null;
  executiveReport: number | null;
  financeDashboard: number | null;
  delta: number;
  status: string;
};

function nearlyEqual(a: number, b: number, epsilon = 0.01): boolean {
  return Math.abs(a - b) <= epsilon;
}

function fmt(n: number | null): string {
  if (n == null) return "—";
  return n.toFixed(2);
}

async function main() {
  const year = Number(parseArg("year") ?? "2026");
  const month = Number(parseArg("month") ?? "6");
  const asOfDate = parseArg("asOfDate") ?? "2026-06-26";
  const ref = new Date(asOfDate + "T23:59:59");
  const yearCtx = resolveExecutiveDashboardYearContext(year, ref);

  const listWhere = buildSalesOrderListWhere({ year, month });
  const mgmtWhere = buildSalesOrderManagementWhere({ year, month });

  const [listOrders, mgmtOrders] = await Promise.all([
    prisma.salesOrder.findMany({ where: listWhere, select: SALES_ORDER_RULES_PRISMA_SELECT }),
    prisma.salesOrder.findMany({ where: mgmtWhere, select: SALES_ORDER_RULES_PRISMA_SELECT }),
  ]);

  const linkedMap = await loadSalesOrderLinkedNfeContextMap(
    [...listOrders, ...mgmtOrders].map((o) => ({
      id: o.id,
      totalNetValue: o.totalNetValue,
      issueDate: o.issueDate,
      expectedDeliveryDate: o.expectedDeliveryDate,
      nomusRawResponse: o.nomusRawResponse,
    })),
    ref
  );

  const rulesOrders = listOrders.map(mapPrismaOrderToSalesOrderRulesInput);
  const engine = buildOfficialSalesOrderRulesResult({
    orders: rulesOrders,
    listFilters: { year, month },
    managementFilters: { year, month },
    referenceDate: ref,
    year,
    month,
    linkedNfeContextMap: linkedMap,
  });

  const listPayload = buildOfficialSalesOrderListPayload({
    orders: rulesOrders,
    listFilters: { year, month },
    referenceDate: ref,
    year,
    month,
  });

  const mgmtCore = buildOfficialSalesOrderManagementCore({
    orders: mgmtOrders.map(mapPrismaOrderToSalesOrderRulesInput),
    managementFilters: { year, month },
    referenceDate: ref,
    linkedNfeContextMap: linkedMap,
  });

  const productIds =
    mgmtOrders.length === 0
      ? []
      : (
          await prisma.salesOrderItem.findMany({
            where: { salesOrderId: { in: mgmtOrders.map((order) => order.id) } },
            select: { productId: true },
            distinct: ["productId"],
          })
        ).map((row) => row.productId);
  await registerOfficialServerResolversForAuditScripts(prisma, productIds);

  const [mgmtPage, execTab] = await Promise.all([
    loadSalesOrderManagementPage({ year: String(year), month: String(month), pageSize: "10000" }),
    buildSalesOrdersDashboardTab(yearCtx),
  ]);

  const rows: AuditRow[] = [];

  function addRow(
    indicator: string,
    engineVal: number,
    listVal: number | null,
    mgmtVal: number | null,
    reportVal: number | null,
    financeVal: number | null = null,
    scopeNote?: string
  ) {
    const refVal = listVal ?? financeVal ?? engineVal;
    const delta = Math.round((engineVal - refVal) * 100) / 100;
    let status = nearlyEqual(engineVal, refVal) ? "OK" : "DIVERGENTE";
    if (scopeNote) status = `ESCOPO DIFERENTE — ${scopeNote}`;
    rows.push({
      indicator,
      engine: engineVal,
      listScreen: listVal,
      management: mgmtVal,
      executiveReport: reportVal,
      financeDashboard: financeVal,
      delta,
      status,
    });
  }

  const financePayload = await buildFinanceSalesOrdersDashboard(
    { year: String(year), month: String(month) },
    ref
  );

  const execMonthCard = execTab.summaryCards.find((c) => c.id === "realized-month");
  const execYtdCard = execTab.summaryCards.find((c) => c.id === "realized-ytd");

  addRow(
    "Valor vendido (filtro mês)",
    engine.metrics.soldAmount,
    listPayload.summary.totalNetAmount,
    mgmtCore.fulfillmentKpis.totalSoldValue,
    execMonthCard?.value ?? null,
    financePayload.summary.totalOrdersAmount
  );
  addRow(
    "Pedidos filtrados",
    engine.metrics.filteredOrders,
    listPayload.summary.totalOrders,
    mgmtPage.summary?.totalOrders ?? null,
    null,
    financePayload.summary.orderCount
  );
  addRow(
    "Valor vendido YTD",
    engine.metrics.soldAmountYtd,
    null,
    null,
    execYtdCard?.value ?? null,
    "YTD exclui cancelados — escopo executivo"
  );
  addRow(
    "Valor faturado vinculado",
    engine.metrics.invoicedAmount,
    null,
    mgmtCore.fulfillmentKpis.totalInvoicedValue,
    null
  );
  addRow(
    "Gap vendido × faturado",
    engine.metrics.soldInvoicedGap,
    null,
    mgmtCore.fulfillmentKpis.soldInvoicedGap,
    null
  );
  addRow(
    "Com NF",
    engine.metrics.withNfeCount,
    null,
    mgmtCore.fulfillmentKpis.ordersWithNfe,
    null
  );
  addRow(
    "Sem NF",
    engine.metrics.withoutNfeCount,
    null,
    mgmtCore.fulfillmentKpis.ordersWithoutNfe,
    null
  );

  console.log(
    `Auditoria consumo Pedidos — year=${year} month=${month} asOfDate=${asOfDate} source=${OFFICIAL_SO_RULES_SOURCE}\n`
  );
  console.log("| Indicador | Motor | Tela Pedidos | Gestão | Relatório | Financeiro | Diferença | Status |");
  console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |");
  for (const r of rows) {
    console.log(
      `| ${r.indicator} | ${fmt(r.engine)} | ${fmt(r.listScreen)} | ${fmt(r.management)} | ${fmt(r.executiveReport)} | ${fmt(r.financeDashboard)} | ${fmt(r.delta)} | ${r.status} |`
    );
  }

  const failures = rows.filter((r) => r.status === "DIVERGENTE");
  if (failures.length > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
