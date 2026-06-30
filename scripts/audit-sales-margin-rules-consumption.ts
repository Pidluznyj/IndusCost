#!/usr/bin/env npx tsx
/**
 * Compara métricas de Margem de Venda entre motor oficial, Pedidos, Gestão, Resultado e Financeiro.
 *
 * Uso:
 *   npx tsx scripts/audit-sales-margin-rules-consumption.ts --year=2026 --month=6 --asOfDate=2026-06-26
 */
import { prisma } from "../src/lib/prisma.js";
import { buildFinanceSalesOrdersDashboard } from "../src/lib/financeSalesOrdersDashboard.js";
import { loadSalesOrderManagementPage } from "../src/lib/salesOrderIntelligenceRoutes.js";
import { buildSalesOrderResultDashboard } from "../src/lib/salesOrderResultEngine.server.js";
import {
  buildOfficialSalesMarginRulesResult,
  calculateOfficialSalesOrderMarginsForOrders,
  mapMarginContextToRulesOrders,
  OFFICIAL_SM_RULES_SOURCE,
  resolveOfficialScopedMarginMetrics,
} from "../src/lib/salesMarginRulesAdapter.js";
import {
  buildSalesOrderMarginContext,
  SALES_ORDER_ITEM_MARGIN_SELECT,
  type SalesOrderMarginContext,
} from "../src/lib/salesOrderMarginService.server.js";
import type { SalesMarginRulesOrderInput } from "../src/lib/salesMarginRulesEngine.types.js";
import type { SalesOrderCostSource } from "../src/lib/salesOrderMarginTypes.js";
import {
  buildSalesOrderManagementWhere,
  parseSalesOrderManagementFilters,
} from "../src/lib/salesOrderManagement.js";
import { buildSalesOrderListWhere } from "../src/lib/salesOrdersListSummary.js";
import {
  loadProductTaxPercentIndex,
  resolveDefaultSalesTaxPercent,
} from "../src/lib/averageSalesTaxEngine.js";
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
  engine: number | null;
  orders: number | null;
  management: number | null;
  result: number | null;
  finance: number | null;
  delta: number;
  status: string;
};

function nearlyEqual(a: number | null, b: number | null, epsilon = 0.02): boolean {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= epsilon;
}

function fmt(n: unknown): string {
  if (n == null) return "—";
  if (typeof n === "number" && Number.isFinite(n)) return n.toFixed(2);
  if (typeof n === "string" && n.trim() !== "") {
    const parsed = Number(n);
    if (Number.isFinite(parsed)) return parsed.toFixed(2);
  }
  return "INVÁLIDO";
}

const LIVE_MARGIN_COST_SOURCES = new Set<SalesOrderCostSource>([
  "LIVE_PRODUCT_COST",
  "RECALCULATED_CURRENT_COST",
  "OFFICIAL_FINAL_COST",
  "CURRENT_ENGINEERING_COST",
  "CURRENT_COST",
  "MANUAL_COST",
  "HISTORICAL_SNAPSHOT",
]);

function buildMarginAuditDiagnostics(input: {
  listOrdersCount: number;
  mgmtOrdersCount: number;
  rulesOrders: SalesMarginRulesOrderInput[];
  marginContext: SalesOrderMarginContext;
  engineOrdersAfterFilter: number;
  soldScoped: ReturnType<typeof resolveOfficialScopedMarginMetrics>;
}) {
  let itemsLoaded = 0;
  let itemsWithUnitCostSnapshot = 0;

  for (const order of input.rulesOrders) {
    for (const item of order.items) {
      itemsLoaded += 1;
      const unitCost = Number(item.unitCost);
      if (Number.isFinite(unitCost) && unitCost > 0) {
        itemsWithUnitCostSnapshot += 1;
      }
    }
  }

  let itemsUsingLiveFallback = 0;
  let itemsWithoutCost = 0;
  for (const result of input.marginContext.byOrderId.values()) {
    for (const item of result.itemResults) {
      if (item.status === "SEM_CUSTO") itemsWithoutCost += 1;
      if (item.costSource && LIVE_MARGIN_COST_SOURCES.has(item.costSource)) {
        if (item.costSource !== "SALES_ORDER_ITEM_SNAPSHOT") {
          itemsUsingLiveFallback += 1;
        }
      }
    }
  }

  return {
    salesOrdersLoaded: input.listOrdersCount,
    managementOrdersLoaded: input.mgmtOrdersCount,
    engineOrdersAfterFilter: input.engineOrdersAfterFilter,
    itemsLoaded,
    itemsWithUnitCostSnapshot,
    itemsUsingLiveFallback,
    itemsWithoutCost,
    revenueLoaded: input.soldScoped.netSalesAmount,
    costLoaded: input.soldScoped.totalCost,
    marginValue: input.soldScoped.marginAmount,
    weightedMarginPerc: input.soldScoped.marginPercent,
    scopeNote:
      input.itemsLoaded > 0 && itemsWithoutCost === input.itemsLoaded
        ? "Todas as linhas SEM_CUSTO — margem consolidada exclui receita até custo ser resolvido (Pedidos usa totalNetValue do cabeçalho)."
        : input.listOrdersCount !== input.mgmtOrdersCount
          ? "Escopo lista (issueDate) e gestão diferem — motor usa lista alinhada à auditoria de Pedidos."
          : null,
  };
}

async function main() {
  const year = Number(parseArg("year") ?? "2026");
  const month = Number(parseArg("month") ?? "6");
  const asOfDate = parseArg("asOfDate") ?? "2026-06-26";
  const ref = new Date(asOfDate + "T23:59:59");

  const mgmtFilters = parseSalesOrderManagementFilters({ year: String(year), month: String(month) });
  const listWhere = buildSalesOrderListWhere({ year, month });
  const mgmtWhere = buildSalesOrderManagementWhere(mgmtFilters);

  const marginOrderSelect = {
    id: true,
    issueDate: true,
    status: true,
    totalNetValue: true,
    nomusRawResponse: true,
    items: { select: SALES_ORDER_ITEM_MARGIN_SELECT },
  } as const;

  const [listOrders, mgmtOrders] = await Promise.all([
    prisma.salesOrder.findMany({ where: listWhere, select: marginOrderSelect }),
    prisma.salesOrder.findMany({ where: mgmtWhere, select: marginOrderSelect }),
  ]);

  const marginOrders = listOrders;
  const productIds = marginOrders.flatMap((order) =>
    order.items.map((item) => item.productId).filter((id): id is string => Boolean(id))
  );
  await registerOfficialServerResolversForAuditScripts(prisma, productIds);

  const marginContext = await buildSalesOrderMarginContext(prisma, marginOrders);
  const rulesOrders = mapMarginContextToRulesOrders(marginOrders, marginContext.byOrderId);

  const [productTaxIndex, defaultTax] = await Promise.all([
    loadProductTaxPercentIndex(prisma, productIds),
    resolveDefaultSalesTaxPercent(prisma),
  ]);

  const engineSold = buildOfficialSalesMarginRulesResult(rulesOrders, {
    taxMode: "none",
    year,
    month,
    referenceDate: ref,
    filters: { year, month },
  });
  const engineGerencial = buildOfficialSalesMarginRulesResult(rulesOrders, {
    taxMode: "deductFromGross",
    taxContext: {
      productTaxIndex,
      defaultTaxPercent: defaultTax.percent,
      defaultTaxLabel: defaultTax.label,
    },
    year,
    month,
    referenceDate: ref,
    filters: { year, month },
  });

  const marginByOrder = await calculateOfficialSalesOrderMarginsForOrders(prisma, marginOrders);
  let ordersMarginAmount = 0;
  let ordersNetRevenue = 0;
  for (const result of marginByOrder.values()) {
    ordersMarginAmount += result.marginSummary.marginValue;
    ordersNetRevenue += result.marginSummary.netRevenue;
  }

  const [mgmtPage, resultPayload, financePayload] = await Promise.all([
    loadSalesOrderManagementPage({ year: String(year), month: String(month), pageSize: "10000" }),
    buildSalesOrderResultDashboard(prisma, {
      year: String(year),
      month: String(month),
      asOfDate,
    }),
    buildFinanceSalesOrdersDashboard({ year: String(year), month: String(month) }, ref),
  ]);

  const mgmtConsolidated = mgmtPage.marginEconomics?.consolidated;
  const financeMargin = financePayload.summary.marginPortfolio;

  const rows: AuditRow[] = [];

  function addRow(
    indicator: string,
    engineVal: number | null,
    ordersVal: number | null,
    mgmtVal: number | null,
    resultVal: number | null,
    financeVal: number | null,
    scopeNote?: string
  ) {
    const refVal = mgmtVal ?? ordersVal ?? engineVal;
    const delta =
      engineVal != null && refVal != null ? Math.round((engineVal - refVal) * 100) / 100 : 0;
    let status =
      engineVal == null && refVal == null
        ? "NÃO APLICÁVEL"
        : nearlyEqual(engineVal, refVal)
          ? "OK"
          : "DIFERENÇA";
    if (scopeNote) status = `ESCOPO DIFERENTE — ${scopeNote}`;
    rows.push({
      indicator,
      engine: engineVal,
      orders: ordersVal,
      management: mgmtVal,
      result: resultVal,
      finance: financeVal,
      delta,
      status,
    });
  }

  const soldScoped = resolveOfficialScopedMarginMetrics(engineSold);
  const gerencialScoped = resolveOfficialScopedMarginMetrics(engineGerencial);
  const diagnostics = buildMarginAuditDiagnostics({
    listOrdersCount: listOrders.length,
    mgmtOrdersCount: mgmtOrders.length,
    rulesOrders,
    marginContext,
    engineOrdersAfterFilter: engineSold.orderResults.length,
    soldScoped,
  });

  const pedidosSoldHeaderTotal = listOrders.reduce(
    (sum, order) => sum + (Number.isFinite(Number(order.totalNetValue)) ? Number(order.totalNetValue) : 0),
    0
  );

  addRow(
    "Margem R$ (pedido, taxMode none)",
    soldScoped.marginAmount,
    ordersMarginAmount,
    mgmtConsolidated?.marginValue ?? null,
    null,
    financeMargin?.marginValue ?? null
  );
  addRow(
    "Margem % ponderada (pedido)",
    soldScoped.marginPercent,
    ordersNetRevenue > 0 ? (ordersMarginAmount / ordersNetRevenue) * 100 : null,
    mgmtConsolidated?.marginPercent ?? null,
    null,
    financeMargin?.marginPercent ?? null
  );
  addRow(
    "Receita vendida (escopo margem pedido)",
    soldScoped.netSalesAmount,
    ordersNetRevenue,
    mgmtConsolidated?.netRevenue ?? null,
    null,
    financeMargin?.netRevenue ?? null
  );
  addRow(
    "Custo total",
    soldScoped.totalCost,
    null,
    mgmtConsolidated?.totalCost ?? null,
    null,
    financeMargin?.totalCost ?? null
  );
  addRow(
    "Margem R$ gerencial (aba Resultado)",
    gerencialScoped.marginAmount,
    null,
    null,
    resultPayload.totals.marginAmount,
    null,
    "Resultado usa receita líquida gerencial com imposto"
  );
  addRow(
    "Margem % gerencial (aba Resultado)",
    gerencialScoped.marginPercent,
    null,
    null,
    resultPayload.totals.marginPercent,
    null,
    "Resultado usa receita líquida gerencial com imposto"
  );
  addRow(
    "Imposto estimado (aba Resultado)",
    gerencialScoped.taxAmount,
    null,
    null,
    resultPayload.totals.taxAmount,
    null,
    "Camada fiscal só na aba Resultado"
  );

  console.log(
    `Auditoria consumo Margem — year=${year} month=${month} asOfDate=${asOfDate} source=${OFFICIAL_SM_RULES_SOURCE}\n`
  );
  console.log("### Diagnóstico de escopo");
  console.log(`- salesOrdersLoaded (lista Pedidos): ${diagnostics.salesOrdersLoaded}`);
  console.log(`- managementOrdersLoaded: ${diagnostics.managementOrdersLoaded}`);
  console.log(`- engineOrdersAfterFilter: ${diagnostics.engineOrdersAfterFilter}`);
  console.log(`- itemsLoaded: ${diagnostics.itemsLoaded}`);
  console.log(`- itemsWithUnitCostSnapshot: ${diagnostics.itemsWithUnitCostSnapshot}`);
  console.log(`- itemsUsingLiveFallback: ${diagnostics.itemsUsingLiveFallback}`);
  console.log(`- itemsWithoutCost: ${diagnostics.itemsWithoutCost}`);
  console.log(`- revenueLoaded (margem consolidada): ${fmt(diagnostics.revenueLoaded)}`);
  console.log(`- pedidosSoldHeaderTotal (escopo Pedidos): ${fmt(pedidosSoldHeaderTotal)}`);
  console.log(`- costLoaded: ${fmt(diagnostics.costLoaded)}`);
  console.log(`- marginValue: ${fmt(diagnostics.marginValue)}`);
  console.log(`- weightedMarginPerc: ${diagnostics.weightedMarginPerc == null ? "—" : `${fmt(diagnostics.weightedMarginPerc)}%`}`);
  if (diagnostics.scopeNote) {
    console.log(`- scopeNote: ${diagnostics.scopeNote}`);
  }
  console.log("");
  console.log(
    "| Indicador | Motor Margem | Pedidos | Gestão | Resultado | Financeiro | Diferença | Status |"
  );
  console.log("| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |");
  for (const r of rows) {
    console.log(
      `| ${r.indicator} | ${fmt(r.engine)} | ${fmt(r.orders)} | ${fmt(r.management)} | ${fmt(r.result)} | ${fmt(r.finance)} | ${fmt(r.delta)} | ${r.status} |`
    );
  }

  const failures = rows.filter((r) => r.status === "DIFERENÇA");
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
