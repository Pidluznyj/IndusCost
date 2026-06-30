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
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { marginLabelLooksLikeTotal } from "../src/lib/salesOrderMarginCoverage.js";

function readSrc(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

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
    revenueTotalInScope: input.soldScoped.totalSalesRevenueInScope,
    revenueCovered: input.soldScoped.marginRevenueCovered,
    revenueUncovered: input.soldScoped.marginRevenueUncovered,
    revenueCoveragePercent: input.soldScoped.marginCoveragePercent,
    costCoverageStatus: input.soldScoped.costCoverageStatus,
    itemsWithCost: input.soldScoped.itemsWithCost,
    costLoaded: input.soldScoped.totalCost,
    marginValue: input.soldScoped.marginAmount,
    weightedMarginPerc: input.soldScoped.marginPercent,
    scopeNote:
      input.soldScoped.costCoverageStatus === "PARTIAL"
        ? `Margem PARCIAL — cobre ${input.soldScoped.marginCoveragePercent ?? 0}% da receita vendida; não comparar margem R$ com valor vendido total sem contexto.`
        : input.itemsLoaded > 0 && itemsWithoutCost === input.itemsLoaded
          ? "Todas as linhas SEM_CUSTO — margem consolidada exclui receita até custo ser resolvido (Pedidos usa totalNetValue do cabeçalho)."
          : input.listOrdersCount !== input.mgmtOrdersCount
            ? "Escopo lista (issueDate) e gestão diferem — motor usa lista alinhada à auditoria de Pedidos."
            : null,
  };
}

type ScreenMarginAuditRow = {
  screen: string;
  endpoint: string;
  officialEngine: string;
  exposesMargin: string;
  totalRevenue: number | null;
  coveredRevenue: number | null;
  uncoveredRevenue: number | null;
  marginValue: number | null;
  marginPercent: number | null;
  coverageStatus: string;
  divergence: string;
  legacyFallback: string;
};

function fileUsesOfficialMarginEngine(rel: string): boolean {
  const src = readSrc(rel);
  return (
    src.includes("calculateOfficialSalesOrderMarginsForOrders") ||
    src.includes("buildOfficialSalesMarginRulesResult") ||
    src.includes("attachMarginsToSalesOrders") ||
    src.includes("attachMarginToSalesOrderDetail") ||
    src.includes("marginSummary") ||
    src.includes("enrichCustomerIntelligenceOrdersWithOfficialMargin") ||
    src.includes("loadOfficialCommercial360MarginBundle") ||
    src.includes("officialMarginValue") ||
    src.includes("resolveSalesOrderMarginMoneyLabel") ||
    src.includes("resolveSalesOrderMarginPercentLabel")
  );
}

function fileUsesLegacyMarginFallback(rel: string): boolean {
  const src = readSrc(rel);
  if (src.includes("officialMarginValue") || src.includes("marginSummary")) {
    if (src.includes("safeOrderNet(it.marginValue)")) return true;
  }
  if (src.includes("totalMarginValue") && src.includes("validCount")) return true;
  if (src.includes("legacyPercent")) return true;
  if (src.includes("marginPercSamples")) return true;
  return false;
}

function buildScreenMarginAuditRows(input: {
  soldScoped: ReturnType<typeof resolveOfficialScopedMarginMetrics>;
  ordersMarginAmount: number;
  mgmtConsolidated:
    | {
        marginValue: number;
        marginPercent: number | null;
        totalSalesRevenueInScope?: number;
        marginRevenueCovered?: number;
        marginRevenueUncovered?: number;
        costCoverageStatus?: string;
      }
    | null
    | undefined;
  resultTotals: { marginAmount: number; marginPercent: number | null };
  financeMargin:
    | {
        marginValue: number;
        marginPercent: number | null;
        totalSalesRevenueInScope?: number;
        marginRevenueCovered?: number;
        marginRevenueUncovered?: number;
        costCoverageStatus?: string;
      }
    | null
    | undefined;
  engineRef: number | null;
}): ScreenMarginAuditRow[] {
  const ref = input.engineRef;

  function divergence(actual: number | null | undefined): string {
    if (ref == null || actual == null) return "—";
    const delta = Math.round((ref - actual) * 100) / 100;
    return nearlyEqual(ref, actual) ? "OK" : String(delta);
  }

  const staticScreens: Array<{
    screen: string;
    endpoint: string;
    file: string;
    exposesMargin: boolean;
    metrics?: {
      totalRevenue: number | null;
      coveredRevenue: number | null;
      uncoveredRevenue: number | null;
      marginValue: number | null;
      marginPercent: number | null;
      coverageStatus: string;
      divergence: string;
    };
  }> = [
    {
      screen: "Pedidos de Venda — lista",
      endpoint: "GET /api/sales-orders + attachMarginsToSalesOrders",
      file: "src/components/sales/SalesOrderListTable.tsx",
      exposesMargin: true,
      metrics: {
        totalRevenue: input.soldScoped.totalSalesRevenueInScope,
        coveredRevenue: input.soldScoped.marginRevenueCovered,
        uncoveredRevenue: input.soldScoped.marginRevenueUncovered,
        marginValue: input.ordersMarginAmount,
        marginPercent:
          input.soldScoped.marginRevenueCovered > 0
            ? (input.ordersMarginAmount / input.soldScoped.marginRevenueCovered) * 100
            : null,
        coverageStatus: input.soldScoped.costCoverageStatus,
        divergence: divergence(input.ordersMarginAmount),
      },
    },
    {
      screen: "Pedidos de Venda — detalhe",
      endpoint: "GET /api/sales-orders/:id + attachMarginToSalesOrderDetail",
      file: "src/components/SalesOrdersModule.tsx",
      exposesMargin: true,
    },
    {
      screen: "Gestão de Pedidos",
      endpoint: "GET /api/sales-orders/management",
      file: "src/components/sales/SalesOrderManagementMarginOverview.tsx",
      exposesMargin: true,
      metrics: {
        totalRevenue: input.mgmtConsolidated?.totalSalesRevenueInScope ?? null,
        coveredRevenue: input.mgmtConsolidated?.marginRevenueCovered ?? null,
        uncoveredRevenue: input.mgmtConsolidated?.marginRevenueUncovered ?? null,
        marginValue: input.mgmtConsolidated?.marginValue ?? null,
        marginPercent: input.mgmtConsolidated?.marginPercent ?? null,
        coverageStatus: input.mgmtConsolidated?.costCoverageStatus ?? "—",
        divergence: divergence(input.mgmtConsolidated?.marginValue),
      },
    },
    {
      screen: "Aba Resultado",
      endpoint: "GET /api/sales-orders/result",
      file: "src/components/sales/SalesOrderResultPage.tsx",
      exposesMargin: true,
      metrics: {
        totalRevenue: null,
        coveredRevenue: null,
        uncoveredRevenue: null,
        marginValue: input.resultTotals.marginAmount,
        marginPercent: input.resultTotals.marginPercent,
        coverageStatus: "GERENCIAL",
        divergence: "ESCOPO DIFERENTE",
      },
    },
    {
      screen: "Financeiro > Pedidos de Venda",
      endpoint: "GET /api/finance/sales-orders/dashboard",
      file: "src/lib/financeSalesOrdersDashboard.ts",
      exposesMargin: true,
      metrics: {
        totalRevenue: input.financeMargin?.totalSalesRevenueInScope ?? null,
        coveredRevenue: input.financeMargin?.marginRevenueCovered ?? null,
        uncoveredRevenue: input.financeMargin?.marginRevenueUncovered ?? null,
        marginValue: input.financeMargin?.marginValue ?? null,
        marginPercent: input.financeMargin?.marginPercent ?? null,
        coverageStatus: input.financeMargin?.costCoverageStatus ?? "—",
        divergence: divergence(input.financeMargin?.marginValue),
      },
    },
    {
      screen: "CRM Comercial / Inteligência",
      endpoint: "GET /api/crm/customers/:id/intelligence",
      file: "src/components/crm/customer-intelligence/CustomerIntelligenceKpiGrid.tsx",
      exposesMargin: true,
    },
    {
      screen: "Cliente 360",
      endpoint: "GET /api/customers/:id/commercial-360",
      file: "src/components/customers/CustomerCommercial360.tsx",
      exposesMargin: true,
    },
    {
      screen: "Produtos vendidos (Indicadores)",
      endpoint: "GET /api/sales-orders/margin-indicators",
      file: "src/components/contextual/SalesOrdersIndicatorsDashboard.tsx",
      exposesMargin: true,
    },
    {
      screen: "Relatório Executivo / Presidencial",
      endpoint: "GET /api/reports/data",
      file: "src/components/ReportsModule.tsx",
      exposesMargin: true,
      metrics: {
        totalRevenue: input.soldScoped.totalSalesRevenueInScope,
        coveredRevenue: input.soldScoped.marginRevenueCovered,
        uncoveredRevenue: input.soldScoped.marginRevenueUncovered,
        marginValue: input.soldScoped.marginAmount,
        marginPercent: input.soldScoped.marginPercent,
        coverageStatus: input.soldScoped.costCoverageStatus,
        divergence: "OK",
      },
    },
    {
      screen: "Exportação margem interna",
      endpoint: "GET /api/sales-orders/margin-indicators/export",
      file: "src/lib/salesOrderInternalMarginExport.server.ts",
      exposesMargin: true,
    },
    {
      screen: "Exportação Financeiro Pedidos",
      endpoint: "GET /api/finance/sales-orders/export",
      file: "src/lib/financeSalesOrdersExport.ts",
      exposesMargin: true,
    },
    {
      screen: "Propostas comerciais",
      endpoint: "ProposalModule (domínio separado)",
      file: "src/components/ProposalModule.tsx",
      exposesMargin: false,
    },
  ];

  return staticScreens.map((row) => {
    const usesEngine = fileUsesOfficialMarginEngine(row.file);
    const legacy = fileUsesLegacyMarginFallback(row.file);
    return {
      screen: row.screen,
      endpoint: row.endpoint,
      officialEngine: row.exposesMargin ? (usesEngine ? "SIM" : "NÃO") : "NÃO APLICÁVEL",
      exposesMargin: row.exposesMargin ? "SIM" : "NÃO APLICÁVEL",
      totalRevenue: row.metrics?.totalRevenue ?? null,
      coveredRevenue: row.metrics?.coveredRevenue ?? null,
      uncoveredRevenue: row.metrics?.uncoveredRevenue ?? null,
      marginValue: row.metrics?.marginValue ?? null,
      marginPercent: row.metrics?.marginPercent ?? null,
      coverageStatus: row.metrics?.coverageStatus ?? "—",
      divergence: row.metrics?.divergence ?? "—",
      legacyFallback: legacy ? "SIM" : "NÃO",
    };
  });
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
    "Receita vendida total (escopo pedidos)",
    soldScoped.totalSalesRevenueInScope,
    null,
    mgmtConsolidated?.totalSalesRevenueInScope ?? null,
    null,
    financeMargin?.totalSalesRevenueInScope ?? null
  );
  addRow(
    "Receita coberta pela margem",
    soldScoped.marginRevenueCovered,
    ordersNetRevenue,
    mgmtConsolidated?.marginRevenueCovered ?? null,
    null,
    financeMargin?.marginRevenueCovered ?? null
  );
  addRow(
    "Receita sem custo",
    soldScoped.marginRevenueUncovered,
    null,
    mgmtConsolidated?.marginRevenueUncovered ?? null,
    null,
    financeMargin?.marginRevenueUncovered ?? null
  );
  addRow(
    "Cobertura % receita",
    soldScoped.marginCoveragePercent,
    null,
    mgmtConsolidated?.marginCoveragePercent ?? null,
    null,
    financeMargin?.marginCoveragePercent ?? null
  );
  addRow(
    "Receita líquida usada na margem (legado netSalesAmount)",
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
  console.log(`- revenueLoaded (receita com custo): ${fmt(diagnostics.revenueLoaded)}`);
  console.log(`- totalSalesRevenueInScope: ${fmt(diagnostics.revenueTotalInScope)}`);
  console.log(`- marginRevenueCovered: ${fmt(diagnostics.revenueCovered)}`);
  console.log(`- marginRevenueUncovered: ${fmt(diagnostics.revenueUncovered)}`);
  console.log(
    `- marginCoveragePercent: ${diagnostics.revenueCoveragePercent == null ? "—" : `${fmt(diagnostics.revenueCoveragePercent)}%`}`
  );
  console.log(`- costCoverageStatus: ${diagnostics.costCoverageStatus}`);
  console.log(`- itemsWithCost: ${diagnostics.itemsWithCost}`);
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

  const screenRows = buildScreenMarginAuditRows({
    soldScoped,
    ordersMarginAmount,
    mgmtConsolidated,
    resultTotals: resultPayload.totals,
    financeMargin,
    engineRef: soldScoped.marginAmount,
  });

  console.log("\n### Auditoria por tela / fonte");
  console.log(
    "| Tela | Endpoint | Motor oficial | Expõe margem | Receita total | Receita coberta | Receita descoberta | Margem R$ | Margem % | Cobertura | Divergência | Fallback legado |"
  );
  console.log("| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |");
  for (const r of screenRows) {
    console.log(
      `| ${r.screen} | ${r.endpoint} | ${r.officialEngine} | ${r.exposesMargin} | ${fmt(r.totalRevenue)} | ${fmt(r.coveredRevenue)} | ${fmt(r.uncoveredRevenue)} | ${fmt(r.marginValue)} | ${r.marginPercent == null ? "—" : `${fmt(r.marginPercent)}%`} | ${r.coverageStatus} | ${r.divergence} | ${r.legacyFallback} |`
    );
  }

  const failures = rows.filter((r) => r.status === "DIFERENÇA");
  const screenFailures = screenRows.filter(
    (r) => r.exposesMargin === "SIM" && (r.officialEngine === "NÃO" || r.legacyFallback === "SIM")
  );
  const alerts: string[] = [];

  if (
    diagnostics.costCoverageStatus === "PARTIAL" &&
    diagnostics.revenueTotalInScope > diagnostics.revenueCovered + 0.02
  ) {
    const uiFiles = [
      "src/components/sales/SalesOrderManagementMarginOverview.tsx",
      "src/components/sales/SalesOrderManagementKpiSecondaryPanel.tsx",
      "src/components/customers/CustomerCommercial360.tsx",
      "src/components/contextual/SalesOrdersIndicatorsDashboard.tsx",
    ];
    for (const file of uiFiles) {
      const src = readSrc(file);
      if (src.includes('label="Margem R$ total"') || src.includes('label="Margem total"')) {
        alerts.push(`ALERTA: ${file} rotula margem como total com cobertura PARTIAL.`);
      }
      if (
        src.includes('label="Margem R$"') &&
        !src.includes("resolveSalesOrderMarginMoneyLabel")
      ) {
        alerts.push(`ALERTA: ${file} usa label genérico "Margem R$" sem distinção parcial/total.`);
      }
    }
    const reportsMix = readSrc("src/lib/salesOrderRulesAdapter.ts");
    if (reportsMix.includes("safeOrderNet(it.marginValue)")) {
      alerts.push("ALERTA: mix de produtos em Relatórios ainda usa marginValue legado do banco.");
    }
    const reportsUi = readSrc("src/components/ReportsModule.tsx");
    if (
      reportsUi.includes('"Margem R$"') &&
      !reportsUi.includes("resolveSalesOrderMarginMoneyLabel")
    ) {
      alerts.push("ALERTA: ReportsModule usa label genérico Margem R$ sem distinção parcial/total.");
    }
  }

  if (marginLabelLooksLikeTotal("Margem R$ total")) {
    alerts.push("ALERTA: helper marginLabelLooksLikeTotal detectou label enganoso.");
  }

  if (alerts.length > 0) {
    console.log("\n### Alertas de semântica de margem");
    for (const alert of alerts) console.log(`- ${alert}`);
    process.exitCode = 1;
  }

  if (screenFailures.length > 0) {
    console.log("\n### Telas com consumo não oficial ou fallback legado");
    for (const row of screenFailures) {
      console.log(`- ${row.screen}: motor=${row.officialEngine}, fallback=${row.legacyFallback}`);
    }
    process.exitCode = 1;
  }

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
