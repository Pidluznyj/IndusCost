/**
 * Auditoria pós-migração — consumidores de Pedido de Venda vs motor único.
 */
import "dotenv/config";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma.ts";
import {
  aggregateSalesOrderMetrics,
  buildOperationalFunnelStages,
  loadSalesOrderEnrichedMetricsForIssueYear,
  SALES_ORDER_METRICS_ENGINE_VERSION,
} from "../src/lib/salesOrderMetricsEngine.ts";
import { buildManagementRowsFromOrders, parseSalesOrderManagementFilters } from "../src/lib/salesOrderManagement.ts";

const ROOT = join(process.cwd(), "src");
const REF = new Date();
const YEAR = REF.getFullYear();

const ENGINE_PATH = "salesOrderMetricsEngine";
const LEGACY_PATTERNS = [
  { id: "raw-nfes-direct", re: /nomusRawResponse\.nfes/g, exclude: /salesOrderLinkedNfe|salesOrderMetricsEngine|salesOrderInvoicingSql/ },
  { id: "orderIsInvoicedSql", re: /orderIsInvoicedSql/g, exclude: /salesOrderInvoicingSql|financeSalesOrdersDashboard\.test/ },
  { id: "orderNotInvoicedSql", re: /orderNotInvoicedSql/g, exclude: /salesOrderInvoicingSql|financeSalesOrdersDashboard\.test|financeBilling/ },
  { id: "duplicate-hasInvoicing", re: /function salesOrderHasInvoicing/g, exclude: /customerCommercialSalesOrderView/ },
];

const MIGRATED_MARKERS = [
  "src/lib/salesOrdersDashboardMetrics.ts",
  "src/lib/salesFunnelDashboardMetrics.ts",
  "src/lib/customerCommercialSalesOrderView.ts",
  "src/lib/materialDemandPlannedRealized.ts",
  "src/lib/salesOrderRawMaterialIntelligenceService.ts",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

function rel(p: string) {
  return p.replace(process.cwd() + "\\", "").replace(process.cwd() + "/", "");
}

function scanLegacyUsage() {
  const files = walk(ROOT);
  const findings: Array<{ pattern: string; file: string; count: number }> = [];

  for (const file of files) {
    const src = readFileSync(file, "utf8");
    const path = rel(file);
    if (path.includes(ENGINE_PATH)) continue;

    for (const pat of LEGACY_PATTERNS) {
      if (pat.exclude && pat.exclude.test(path)) continue;
      const matches = src.match(pat.re);
      if (matches && matches.length > 0) {
        findings.push({ pattern: pat.id, file: path, count: matches.length });
      }
    }
  }
  return findings;
}

function scanPendingMigration() {
  const files = walk(ROOT);
  const pending: string[] = [];
  const highRisk = [
    "crmSellerDashboardService.ts",
    "financeSalesOrdersDashboard.ts",
    "financeSalesOrdersExtendedMetrics.ts",
    "billingDashboardMetrics.ts",
    "financeBillingForecast.ts",
    "financeBillingHorizonDrilldown.ts",
  ];

  for (const file of files) {
    const path = rel(file);
    const base = path.split("/").pop() ?? path;
    if (!highRisk.includes(base)) continue;
    const src = readFileSync(file, "utf8");
    if (!src.includes(ENGINE_PATH) && (src.includes("orderIsInvoicedSql") || src.includes("orderNotInvoicedSql"))) {
      pending.push(path);
    }
  }
  return pending;
}

async function compareDashboardVsManagement() {
  try {
    const engineMetrics = await loadSalesOrderEnrichedMetricsForIssueYear(YEAR, REF);
    const agg = aggregateSalesOrderMetrics(engineMetrics);
    const funnel = buildOperationalFunnelStages(engineMetrics);

    const orders = await prisma.salesOrder.findMany({
      where: {
        issueDate: {
          gte: new Date(YEAR, 0, 1),
          lte: new Date(YEAR, 11, 31, 23, 59, 59, 999),
        },
      },
      select: {
        id: true,
        orderCode: true,
        status: true,
        issueDate: true,
        expectedDeliveryDate: true,
        totalNetValue: true,
        responsible: true,
        nomusRawResponse: true,
        companyIssuer: true,
        externalSalesOrderId: true,
        customerId: true,
        Customer: { select: { companyName: true, tradeName: true, taxId: true } },
        items: {
          select: {
            id: true,
            externalProductId: true,
            skuSnapshot: true,
            productNameSnapshot: true,
            quantity: true,
          },
        },
      },
    });

    const filters = parseSalesOrderManagementFilters({ year: String(YEAR) });
    const { rows } = buildManagementRowsFromOrders(orders, filters, REF);
    const managementWithNfe = rows.filter((r) => r.hasInvoice).length;
    const managementOverdue = rows.filter((r) => r.logisticStatusCardId === "overduePending").length;

    return {
      year: YEAR,
      dbAvailable: true,
      engineTotalOrders: agg.totalOrders,
      engineWithNfe: agg.withNfeCount,
      engineOverdue: agg.pendingLateCount,
      managementRowCount: rows.length,
      managementWithNfe,
      managementOverdue,
      funnelSold: funnel.find((s) => s.id === "sold")?.count ?? 0,
      funnelWithNfe: funnel.find((s) => s.id === "withNfe")?.count ?? 0,
      withNfeMatch: managementWithNfe === agg.withNfeCount,
      overdueMatch: managementOverdue === agg.pendingLateCount,
      totalSoldValue: agg.totalSoldValue,
      totalInvoicedValue: agg.totalInvoicedValue,
    };
  } catch (err) {
    return {
      year: YEAR,
      dbAvailable: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function countMultiNfeOrders() {
  try {
    const metrics = await loadSalesOrderEnrichedMetricsForIssueYear(YEAR, REF);
    const multi = metrics.filter((m) => m.nfeCount > 1);
    const uniqueInAgg = aggregateSalesOrderMetrics(metrics);
    return {
      dbAvailable: true,
      ordersWithMultipleNfe: multi.length,
      aggregateOrderCount: uniqueInAgg.totalOrders,
      metricsRowCount: metrics.length,
      noDuplicateInKpi:
        uniqueInAgg.totalOrders ===
        metrics.filter(
          (m) => m.orderStatus !== "CANCELLED" && m.logisticStatusCardId !== "finishedOrCancelled"
        ).length,
    };
  } catch {
    return { dbAvailable: false };
  }
}

async function main() {
  console.log("=== Auditoria pós-migração — Pedido de Venda ===");
  console.log(`Motor: salesOrderMetricsEngine v${SALES_ORDER_METRICS_ENGINE_VERSION}`);
  console.log(`Referência: ${REF.toISOString()}`);
  console.log("");

  console.log("--- Arquivos migrados (marcadores) ---");
  for (const p of MIGRATED_MARKERS) console.log(`  ✓ ${p}`);
  console.log("");

  const legacy = scanLegacyUsage();
  console.log("--- Leituras legadas fora do motor (prioritário revisar) ---");
  if (legacy.length === 0) {
    console.log("  Nenhuma ocorrência crítica encontrada nos padrões monitorados.");
  } else {
    for (const f of legacy.slice(0, 30)) {
      console.log(`  [${f.pattern}] ${f.file} (${f.count}x)`);
    }
    if (legacy.length > 30) console.log(`  ... +${legacy.length - 30} ocorrências`);
  }
  console.log("");

  const pending = scanPendingMigration();
  console.log("--- Consumidores ainda pendentes de migração total ---");
  if (pending.length === 0) {
    console.log("  Nenhum arquivo de alto risco pendente na lista monitorada.");
  } else {
    for (const p of pending) console.log(`  ⏳ ${p}`);
  }
  console.log("");

  const comparison = await compareDashboardVsManagement();
  console.log("--- Contagens Dashboard (engine) vs Gestão de Pedidos ---");
  console.log(JSON.stringify(comparison, null, 2));
  console.log("");

  const multiNfe = await countMultiNfeOrders();
  console.log("--- Pedidos com múltiplas NF-es ---");
  console.log(JSON.stringify(multiNfe, null, 2));
  console.log("");

  const totalYear = comparison.dbAvailable
    ? await prisma.salesOrder.count({
        where: {
          issueDate: {
            gte: new Date(YEAR, 0, 1),
            lte: new Date(YEAR, 11, 31, 23, 59, 59, 999),
          },
        },
      })
    : null;
  console.log(`Total pedidos ${YEAR} (DB): ${totalYear ?? "indisponível"}`);
  if (comparison.dbAvailable && "totalSoldValue" in comparison) {
    console.log(`Valor vendido (engine): ${comparison.totalSoldValue?.toFixed(2)}`);
    console.log(`Valor faturado NF (engine): ${comparison.totalInvoicedValue?.toFixed(2)}`);
    console.log(`Pedidos com NF: ${comparison.engineWithNfe}`);
  } else {
    console.log("Comparação runtime DB/engine: pulada (banco indisponível).");
  }

  await prisma.$disconnect().catch(() => undefined);

  const ok =
    legacy.length === 0 ||
    (comparison.dbAvailable &&
      "withNfeMatch" in comparison &&
      comparison.withNfeMatch &&
      comparison.overdueMatch &&
      multiNfe.dbAvailable &&
      multiNfe.noDuplicateInKpi);

  console.log("");
  console.log(
    ok
      ? "RESULTADO: OK — auditoria estática concluída; runtime DB verificado quando disponível"
      : "RESULTADO: ATENÇÃO — revisar divergências ou leituras legadas acima"
  );
  process.exit(comparison.dbAvailable ? (ok ? 0 : 1) : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
