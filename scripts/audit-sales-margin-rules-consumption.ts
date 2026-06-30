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
  assessSalesMarginNomusFiscalConfig,
  loadSalesMarginNomusConfig,
} from "../src/lib/salesMarginNomusConfig.js";
import { resolveOfficialSalesMarginTaxContext } from "../src/lib/salesMarginNomusTaxContext.server.js";
import { resolveSalesTaxRuleById } from "../src/lib/averageSalesTaxEngine.js";
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
  taxModeEffective: string;
  taxRuleLabel: string;
  taxPercent: number | null;
  taxAmount: number | null;
  totalRevenue: number | null;
  netRevenue: number | null;
  coveredRevenue: number | null;
  uncoveredRevenue: number | null;
  totalCost: number | null;
  marginValue: number | null;
  marginPercent: number | null;
  coverageStatus: string;
  costSourceNote: string;
  divergence: string;
  legacyFallback: string;
  fiscalStatus: string;
};

const OPERATIONAL_MARGIN_SOURCE_FILES = [
  "src/lib/salesOrderMarginService.server.ts",
  "src/lib/salesMarginRulesAdapter.ts",
  "src/lib/financeSalesOrdersDashboard.ts",
  "src/lib/financeSalesOrdersExport.ts",
  "src/lib/salesOrderInternalMarginExport.server.ts",
  "src/lib/salesOrderMarginIndicators.server.ts",
  "src/lib/salesOrderIntelligenceRoutes.ts",
  "src/lib/customerIntelligenceRoutes.ts",
] as const;

function operationalFileForcesTaxModeNone(rel: string): boolean {
  const src = readSrc(rel);
  return /buildInput:\s*\{\s*taxMode:\s*["']none["']/.test(src)
    || /buildOfficialSalesMarginRulesResult\([^)]*\{\s*taxMode:\s*["']none["']/.test(src);
}

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
  nomusTaxMode: string;
  taxRuleLabel: string;
  taxPercent: number | null;
  fiscalStatus: string;
  officialScoped: ReturnType<typeof resolveOfficialScopedMarginMetrics>;
  ordersMarginAmount: number;
  mgmtConsolidated:
    | {
        marginValue: number;
        marginPercent: number | null;
        totalSalesRevenueInScope?: number;
        marginRevenueCovered?: number;
        marginRevenueUncovered?: number;
        costCoverageStatus?: string;
        totalCost?: number;
        netRevenue?: number;
      }
    | null
    | undefined;
  resultTotals: {
    marginAmount: number;
    marginPercent: number | null;
    taxAmount: number;
    netSalesAmount: number;
    salesAmount: number;
    costAmount: number;
  };
  financeMargin:
    | {
        marginValue: number;
        marginPercent: number | null;
        totalSalesRevenueInScope?: number;
        marginRevenueCovered?: number;
        marginRevenueUncovered?: number;
        costCoverageStatus?: string;
        totalCost?: number;
        netRevenue?: number;
      }
    | null
    | undefined;
  engineRef: number | null;
}): ScreenMarginAuditRow[] {
  const ref = input.engineRef;
  const baseTax = {
    taxModeEffective: input.nomusTaxMode,
    taxRuleLabel: input.taxRuleLabel,
    taxPercent: input.taxPercent,
    fiscalStatus: input.fiscalStatus,
    costSourceNote: "SalesOrderItem.unitCost → getProductCostAnalysis se configurado",
  };

  function divergence(actual: number | null | undefined): string {
    if (ref == null || actual == null) return "—";
    const delta = Math.round((ref - actual) * 100) / 100;
    return nearlyEqual(ref, actual) ? "OK" : String(delta);
  }

  function rowMetrics(
    scoped: {
      totalSalesRevenueInScope?: number;
      marginRevenueCovered?: number;
      marginRevenueUncovered?: number;
      marginValue?: number;
      marginPercent?: number | null;
      costCoverageStatus?: string;
      totalCost?: number;
      netRevenue?: number;
      taxAmount?: number;
      netSalesAmount?: number;
    } | null | undefined,
    divergenceVal: string
  ) {
    return {
      taxAmount: scoped?.taxAmount ?? (input.officialScoped.taxAmount ?? null),
      totalRevenue: scoped?.totalSalesRevenueInScope ?? null,
      netRevenue: scoped?.netSalesAmount ?? scoped?.netRevenue ?? null,
      coveredRevenue: scoped?.marginRevenueCovered ?? null,
      uncoveredRevenue: scoped?.marginRevenueUncovered ?? null,
      totalCost: scoped?.totalCost ?? null,
      marginValue: scoped?.marginValue ?? (scoped as { marginAmount?: number })?.marginAmount ?? null,
      marginPercent: scoped?.marginPercent ?? null,
      coverageStatus: scoped?.costCoverageStatus ?? "—",
      divergence: divergenceVal,
    };
  }

  const staticScreens: Array<{
    screen: string;
    endpoint: string;
    file: string;
    exposesMargin: boolean;
    operational: boolean;
    metrics?: ReturnType<typeof rowMetrics>;
  }> = [
    {
      screen: "Pedidos de Venda — lista",
      endpoint: "GET /api/sales-orders + attachMarginsToSalesOrders",
      file: "src/components/sales/SalesOrderListTable.tsx",
      exposesMargin: true,
      operational: true,
      metrics: rowMetrics(
        {
          totalSalesRevenueInScope: input.officialScoped.totalSalesRevenueInScope,
          marginRevenueCovered: input.officialScoped.marginRevenueCovered,
          marginRevenueUncovered: input.officialScoped.marginRevenueUncovered,
          marginValue: input.ordersMarginAmount,
          marginPercent:
            input.officialScoped.marginRevenueCovered > 0
              ? (input.ordersMarginAmount / input.officialScoped.marginRevenueCovered) * 100
              : null,
          costCoverageStatus: input.officialScoped.costCoverageStatus,
          totalCost: input.officialScoped.totalCost,
          netSalesAmount: input.officialScoped.netSalesAmount,
          taxAmount: input.officialScoped.taxAmount,
        },
        divergence(input.ordersMarginAmount)
      ),
    },
    {
      screen: "Pedidos de Venda — detalhe",
      endpoint: "GET /api/sales-orders/:id + attachMarginToSalesOrderDetail",
      file: "src/components/SalesOrdersModule.tsx",
      exposesMargin: true,
      operational: true,
      metrics: rowMetrics(input.officialScoped, "OK"),
    },
    {
      screen: "Gestão de Pedidos",
      endpoint: "GET /api/sales-orders/management",
      file: "src/components/sales/SalesOrderManagementMarginOverview.tsx",
      exposesMargin: true,
      operational: true,
      metrics: rowMetrics(input.mgmtConsolidated ?? undefined, divergence(input.mgmtConsolidated?.marginValue)),
    },
    {
      screen: "Aba Resultado",
      endpoint: "GET /api/sales-orders/result",
      file: "src/components/sales/SalesOrderResultPage.tsx",
      exposesMargin: true,
      operational: false,
      metrics: rowMetrics(
        {
          totalSalesRevenueInScope: input.resultTotals.salesAmount,
          marginRevenueCovered: input.resultTotals.netSalesAmount,
          marginValue: input.resultTotals.marginAmount,
          marginPercent: input.resultTotals.marginPercent,
          totalCost: input.resultTotals.costAmount,
          netSalesAmount: input.resultTotals.netSalesAmount,
          taxAmount: input.resultTotals.taxAmount,
          costCoverageStatus: "GERENCIAL",
        },
        "ESCOPO DIFERENTE"
      ),
    },
    {
      screen: "Financeiro > Pedidos de Venda",
      endpoint: "GET /api/finance/sales-orders/dashboard",
      file: "src/lib/financeSalesOrdersDashboard.ts",
      exposesMargin: true,
      operational: true,
      metrics: rowMetrics(input.financeMargin ?? undefined, divergence(input.financeMargin?.marginValue)),
    },
    {
      screen: "CRM Comercial / Inteligência",
      endpoint: "GET /api/crm/customers/:id/intelligence",
      file: "src/components/crm/customer-intelligence/CustomerIntelligenceKpiGrid.tsx",
      exposesMargin: true,
      operational: true,
      metrics: rowMetrics(input.officialScoped, "OK"),
    },
    {
      screen: "Cliente 360",
      endpoint: "GET /api/customers/:id/commercial-360",
      file: "src/components/customers/CustomerCommercial360.tsx",
      exposesMargin: true,
      operational: true,
      metrics: rowMetrics(input.officialScoped, "OK"),
    },
    {
      screen: "Produtos vendidos (Indicadores)",
      endpoint: "GET /api/sales-orders/margin-indicators",
      file: "src/components/contextual/SalesOrdersIndicatorsDashboard.tsx",
      exposesMargin: true,
      operational: true,
      metrics: rowMetrics(input.officialScoped, "OK"),
    },
    {
      screen: "Relatório Executivo / Presidencial",
      endpoint: "GET /api/reports/data",
      file: "src/components/ReportsModule.tsx",
      exposesMargin: true,
      operational: false,
      metrics: rowMetrics(input.officialScoped, "OK"),
    },
    {
      screen: "Exportação margem interna",
      endpoint: "GET /api/sales-orders/margin-indicators/export",
      file: "src/lib/salesOrderInternalMarginExport.server.ts",
      exposesMargin: true,
      operational: true,
      metrics: rowMetrics(input.officialScoped, "OK"),
    },
    {
      screen: "Exportação Financeiro Pedidos",
      endpoint: "GET /api/finance/sales-orders/export",
      file: "src/lib/financeSalesOrdersExport.ts",
      exposesMargin: true,
      operational: true,
      metrics: rowMetrics(input.officialScoped, "OK"),
    },
    {
      screen: "Propostas comerciais",
      endpoint: "ProposalModule (domínio separado)",
      file: "src/components/ProposalModule.tsx",
      exposesMargin: false,
      operational: false,
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
      ...baseTax,
      ...(row.metrics ?? {
        taxAmount: null,
        totalRevenue: null,
        netRevenue: null,
        coveredRevenue: null,
        uncoveredRevenue: null,
        totalCost: null,
        marginValue: null,
        marginPercent: null,
        coverageStatus: "—",
        divergence: "—",
      }),
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

  const { config: nomusConfig } = await loadSalesMarginNomusConfig(prisma);
  const taxRule = nomusConfig.defaultTaxRuleId
    ? await resolveSalesTaxRuleById(prisma, nomusConfig.defaultTaxRuleId)
    : null;
  const fiscalAssessment = assessSalesMarginNomusFiscalConfig(
    nomusConfig,
    taxRule,
    null
  );
  const taxContext = await resolveOfficialSalesMarginTaxContext(
    prisma,
    productIds,
    nomusConfig
  );

  const marginContext = await buildSalesOrderMarginContext(prisma, marginOrders);
  const rulesOrders = mapMarginContextToRulesOrders(marginOrders, marginContext.byOrderId);

  const engineOfficial = buildOfficialSalesMarginRulesResult(rulesOrders, {
    taxMode: nomusConfig.taxMode,
    taxContext: nomusConfig.taxMode === "deductFromGross" ? taxContext : undefined,
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

  const officialScoped = resolveOfficialScopedMarginMetrics(engineOfficial);
  const diagnostics = buildMarginAuditDiagnostics({
    listOrdersCount: listOrders.length,
    mgmtOrdersCount: mgmtOrders.length,
    rulesOrders,
    marginContext,
    engineOrdersAfterFilter: engineOfficial.orderResults.length,
    soldScoped: officialScoped,
  });

  const pedidosSoldHeaderTotal = listOrders.reduce(
    (sum, order) => sum + (Number.isFinite(Number(order.totalNetValue)) ? Number(order.totalNetValue) : 0),
    0
  );

  addRow(
    "Margem R$ gerencial (config Nomus)",
    officialScoped.marginAmount,
    ordersMarginAmount,
    mgmtConsolidated?.marginValue ?? null,
    resultPayload.totals.marginAmount,
    financeMargin?.marginValue ?? null
  );
  addRow(
    "Margem % ponderada gerencial",
    officialScoped.marginPercent,
    ordersNetRevenue > 0 ? (ordersMarginAmount / ordersNetRevenue) * 100 : null,
    mgmtConsolidated?.marginPercent ?? null,
    resultPayload.totals.marginPercent,
    financeMargin?.marginPercent ?? null
  );
  addRow(
    "Imposto estimado (TaxRule Nomus)",
    officialScoped.taxAmount,
    null,
    null,
    resultPayload.totals.taxAmount,
    null
  );
  addRow(
    "Receita vendida total (escopo pedidos)",
    officialScoped.totalSalesRevenueInScope,
    null,
    mgmtConsolidated?.totalSalesRevenueInScope ?? null,
    null,
    financeMargin?.totalSalesRevenueInScope ?? null
  );
  addRow(
    "Receita coberta pela margem",
    officialScoped.marginRevenueCovered,
    ordersNetRevenue,
    mgmtConsolidated?.marginRevenueCovered ?? null,
    null,
    financeMargin?.marginRevenueCovered ?? null
  );
  addRow(
    "Receita sem custo",
    officialScoped.marginRevenueUncovered,
    null,
    mgmtConsolidated?.marginRevenueUncovered ?? null,
    null,
    financeMargin?.marginRevenueUncovered ?? null
  );
  addRow(
    "Cobertura % receita",
    officialScoped.marginCoveragePercent,
    null,
    mgmtConsolidated?.marginCoveragePercent ?? null,
    null,
    financeMargin?.marginCoveragePercent ?? null
  );
  addRow(
    "Receita líquida gerencial",
    officialScoped.netSalesAmount,
    ordersNetRevenue,
    mgmtConsolidated?.netRevenue ?? null,
    null,
    financeMargin?.netRevenue ?? null
  );
  addRow(
    "Custo total",
    officialScoped.totalCost,
    null,
    mgmtConsolidated?.totalCost ?? null,
    null,
    financeMargin?.totalCost ?? null
  );
  console.log(
    `Auditoria consumo Margem — year=${year} month=${month} asOfDate=${asOfDate} source=${OFFICIAL_SM_RULES_SOURCE}\n`
  );
  console.log("### Configuração fiscal Nomus");
  console.log(`- taxMode: ${nomusConfig.taxMode}`);
  console.log(`- defaultTaxRuleId: ${nomusConfig.defaultTaxRuleId ?? "—"}`);
  console.log(`- TaxRule: ${taxRule?.name ?? taxContext.defaultTaxLabel}`);
  console.log(`- percentual imposto: ${taxContext.defaultTaxPercent}%`);
  console.log(`- fiscalConfigComplete: ${taxContext.fiscalConfigComplete ? "sim" : "não"}`);
  console.log(`- resultado fiscal: ${fiscalAssessment.status}`);
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
    nomusTaxMode: nomusConfig.taxMode,
    taxRuleLabel: taxRule?.name ?? taxContext.defaultTaxLabel,
    taxPercent: taxContext.defaultTaxPercent,
    fiscalStatus: fiscalAssessment.status,
    officialScoped,
    ordersMarginAmount,
    mgmtConsolidated,
    resultTotals: resultPayload.totals,
    financeMargin,
    engineRef: officialScoped.marginAmount,
  });

  console.log("\n### Auditoria por tela / fonte");
  console.log(
    "| Tela | Endpoint | taxMode | TaxRule | % imposto | Imposto R$ | Venda | Receita líq. | Custo | Margem R$ | Margem % | Cobertura | Fiscal | Divergência |"
  );
  console.log("| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |");
  for (const r of screenRows) {
    console.log(
      `| ${r.screen} | ${r.endpoint} | ${r.taxModeEffective} | ${r.taxRuleLabel} | ${r.taxPercent == null ? "—" : `${fmt(r.taxPercent)}%`} | ${fmt(r.taxAmount)} | ${fmt(r.totalRevenue)} | ${fmt(r.netRevenue)} | ${fmt(r.totalCost)} | ${fmt(r.marginValue)} | ${r.marginPercent == null ? "—" : `${fmt(r.marginPercent)}%`} | ${r.coverageStatus} | ${r.fiscalStatus} | ${r.divergence} |`
    );
  }

  const operationalForcesNone = OPERATIONAL_MARGIN_SOURCE_FILES.filter((file) =>
    operationalFileForcesTaxModeNone(file)
  );
  if (operationalForcesNone.length > 0) {
    console.error("\nBLOQUEANTE: fluxos operacionais ainda forçam taxMode none:");
    for (const file of operationalForcesNone) console.error(`- ${file}`);
    process.exitCode = 1;
  }

  if (nomusConfig.taxMode === "deductFromGross" && fiscalAssessment.status === "BLOQUEANTE") {
    console.error(
      "\nBLOQUEANTE: configuração fiscal incompleta — margem gerencial operacional não deve usar 0% silencioso."
    );
    process.exitCode = 1;
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
