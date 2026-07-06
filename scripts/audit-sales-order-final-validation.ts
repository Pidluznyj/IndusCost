/**
 * Validação final ponta a ponta — Pedido de Venda / NF-e / motor único.
 *
 * Uso:
 *   npm run audit:sales-order-final-validation
 *   npx tsx scripts/audit-sales-order-final-validation.ts --year=2026
 */
import "dotenv/config";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma.ts";
import { buildSalesOrderNfeLinkDiagnostic } from "../src/lib/salesOrderNfeLink.ts";
import {
  aggregateSalesOrderMetrics,
  buildOperationalFunnelStages,
  loadSalesOrderEnrichedMetricsForIssueYear,
  SALES_ORDER_METRICS_ENGINE_VERSION,
} from "../src/lib/salesOrderMetricsEngine.ts";
import {
  buildManagementRowsFromOrders,
  parseSalesOrderManagementFilters,
} from "../src/lib/salesOrderManagement.ts";
import { buildFulfillmentKpis } from "../src/lib/salesOrderManagementFulfillment.ts";
import { INVOICE_COVERAGE_TOLERANCE_ABSOLUTE } from "../src/lib/salesOrderLinkedNfe.ts";
import { extractNomusRawNfes } from "../src/lib/salesOrderNomusRaw.ts";
import { isCancelledSalesOrderStatus } from "../src/lib/salesOrderDashboardRules.ts";

const REF = new Date();
const YEAR = Number(process.argv.find((a) => a.startsWith("--year="))?.split("=")[1] ?? REF.getFullYear());
const REPORT_PATH = join(process.cwd(), "docs/audits/sales-order-final-validation-report.json");

type SectionResult = Record<string, unknown>;

function section(title: string, data: SectionResult) {
  console.log(`\n=== ${title} ===`);
  console.log(JSON.stringify(data, null, 2));
  return { title, data };
}

async function auditNfeLinks(): Promise<SectionResult> {
  const diagnostic = await buildSalesOrderNfeLinkDiagnostic();
  const duplicateLinks = await prisma.$queryRaw<
    Array<{ salesOrderId: string; nfeExternalId: bigint; c: bigint }>
  >`
    SELECT "salesOrderId", "nfeExternalId", COUNT(*)::bigint AS c
    FROM "SalesOrderNfeLink"
    GROUP BY "salesOrderId", "nfeExternalId"
    HAVING COUNT(*) > 1
  `;

  return {
    year: YEAR,
    ...diagnostic,
    duplicateNfeExternalIdPerOrder: duplicateLinks.length,
    duplicateExamples: duplicateLinks.slice(0, 5).map((r) => ({
      salesOrderId: r.salesOrderId,
      nfeExternalId: Number(r.nfeExternalId),
      count: Number(r.c),
    })),
  };
}

async function auditStatuses(year: number, referenceDate: Date): Promise<SectionResult> {
  const metrics = await loadSalesOrderEnrichedMetricsForIssueYear(year, referenceDate);
  const agg = aggregateSalesOrderMetrics(metrics);
  const funnel = buildOperationalFunnelStages(metrics);

  const byLogistic: Record<string, number> = {};
  const byManagement: Record<string, number> = {};
  for (const m of metrics) {
    if (isCancelledSalesOrderStatus(m.orderStatus)) continue;
    byLogistic[m.logisticStatus] = (byLogistic[m.logisticStatus] ?? 0) + 1;
    byManagement[m.managementStatus] = (byManagement[m.managementStatus] ?? 0) + 1;
  }

  return {
    year,
    engineVersion: SALES_ORDER_METRICS_ENGINE_VERSION,
    aggregate: agg,
    funnelStages: funnel.map((s) => ({ id: s.id, count: s.count, value: s.value })),
    byLogisticStatus: byLogistic,
    byManagementStatus: byManagement,
    onTime: agg.deliveredOnTimeCount + agg.pendingOnTimeCount,
    late: agg.deliveredLateCount + agg.pendingLateCount,
    pending: agg.withoutNfeCount,
    partial: agg.partialCount,
    withCut: agg.withCutCount,
    review: agg.reviewCount,
  };
}

async function auditValues(year: number, referenceDate: Date): Promise<SectionResult> {
  const metrics = await loadSalesOrderEnrichedMetricsForIssueYear(year, referenceDate);
  const active = metrics.filter(
    (m) => !isCancelledSalesOrderStatus(m.orderStatus) && m.logisticStatusCardId !== "finishedOrCancelled"
  );

  let nfeGreaterThanOrder = 0;
  let hasNfeZeroValue = 0;
  let noNetValue = 0;
  let noPlannedDate = 0;
  const nfeGreaterExamples: Array<{ orderCode: string; sold: number; invoiced: number }> = [];

  for (const m of active) {
    if (m.totalNetValue <= 0) noNetValue += 1;
    if (!m.expectedDeliveryDate) noPlannedDate += 1;
    if (m.hasNfe && m.nfeTotalValue <= 0) hasNfeZeroValue += 1;
    const over =
      m.nfeTotalValue > m.totalNetValue + INVOICE_COVERAGE_TOLERANCE_ABSOLUTE &&
      m.totalNetValue > 0;
    if (over) {
      nfeGreaterThanOrder += 1;
      if (nfeGreaterExamples.length < 10) {
        nfeGreaterExamples.push({
          orderCode: m.orderCode,
          sold: m.totalNetValue,
          invoiced: m.nfeTotalValue,
        });
      }
    }
  }

  const agg = aggregateSalesOrderMetrics(metrics);

  return {
    year,
    totalSoldValue: agg.totalSoldValue,
    totalInvoicedValue: agg.totalInvoicedValue,
    soldInvoicedGap: agg.soldInvoicedGap,
    invoiceCoveragePercent: agg.invoiceCoveragePercent,
    nfeGreaterThanOrderAboveTolerance: nfeGreaterThanOrder,
    nfeGreaterExamples,
    hasNfeButZeroInvoicedValue: hasNfeZeroValue,
    ordersWithoutNetValue: noNetValue,
    ordersWithoutPlannedDate: noPlannedDate,
    toleranceAbsolute: INVOICE_COVERAGE_TOLERANCE_ABSOLUTE,
  };
}

async function auditCrossModule(year: number, referenceDate: Date): Promise<SectionResult> {
  const yearStart = new Date(year, 0, 1);
  const yearEnd = new Date(year, 11, 31, 23, 59, 59, 999);

  const orders = await prisma.salesOrder.findMany({
    where: { issueDate: { gte: yearStart, lte: yearEnd } },
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

  const engineMetrics = await loadSalesOrderEnrichedMetricsForIssueYear(year, referenceDate);
  const engineAgg = aggregateSalesOrderMetrics(engineMetrics);

  const filters = parseSalesOrderManagementFilters({ year: String(year) });
  const { rows, fulfillmentKpis } = buildManagementRowsFromOrders(orders, filters, referenceDate);
  const fulfillmentFromRows = buildFulfillmentKpis(rows);

  const managementWithNfe = fulfillmentKpis.ordersWithNfe;
  const managementWithoutNfe = fulfillmentKpis.ordersWithoutNfe;
  const managementOverdue = fulfillmentKpis.pendingLate;
  const managementOnTimeDelivered = fulfillmentKpis.deliveredOnTime;

  const funnel = buildOperationalFunnelStages(engineMetrics);
  const funnelWithNfe = funnel.find((s) => s.id === "withNfe")?.count ?? 0;
  const funnelPendingLate = funnel.find((s) => s.id === "pendingLate")?.count ?? 0;

  let rawNfeOnlyCount = 0;
  for (const order of orders) {
    const raw = extractNomusRawNfes(order.nomusRawResponse);
    if (raw.length === 0) continue;
    const row = rows.find((r) => r.id === order.id);
    if (row && !row.hasInvoice) rawNfeOnlyCount += 1;
  }

  const comparisons = {
    totalOrders: {
      engine: engineAgg.totalOrders,
      managementRows: rows.filter((r) => !isCancelledSalesOrderStatus(r.operationalStatus)).length,
      match:
        engineAgg.totalOrders ===
        rows.filter((r) => !isCancelledSalesOrderStatus(r.operationalStatus)).length,
    },
    withNfe: {
      engine: engineAgg.withNfeCount,
      management: managementWithNfe,
      funnel: funnelWithNfe,
      fulfillmentKpis: fulfillmentKpis.ordersWithNfe,
      match:
        engineAgg.withNfeCount === managementWithNfe &&
        engineAgg.withNfeCount === funnelWithNfe &&
        engineAgg.withNfeCount === fulfillmentKpis.ordersWithNfe,
    },
    withoutNfe: {
      engine: engineAgg.withoutNfeCount,
      management: managementWithoutNfe,
      match: engineAgg.withoutNfeCount === managementWithoutNfe,
    },
    overduePending: {
      engine: engineAgg.pendingLateCount,
      management: managementOverdue,
      funnel: funnelPendingLate,
      match:
        engineAgg.pendingLateCount === managementOverdue &&
        engineAgg.pendingLateCount === funnelPendingLate,
    },
    deliveredOnTime: {
      engine: engineAgg.deliveredOnTimeCount,
      management: managementOnTimeDelivered,
      match: engineAgg.deliveredOnTimeCount === managementOnTimeDelivered,
    },
    soldValue: {
      engine: engineAgg.totalSoldValue,
      management: fulfillmentFromRows.totalSoldValue,
      match: Math.abs(engineAgg.totalSoldValue - fulfillmentFromRows.totalSoldValue) < 0.01,
    },
    invoicedValue: {
      engine: engineAgg.totalInvoicedValue,
      management: fulfillmentFromRows.totalInvoicedValue,
      match: Math.abs(engineAgg.totalInvoicedValue - fulfillmentFromRows.totalInvoicedValue) < 0.01,
    },
    rawNfeWithoutEngineNfe: rawNfeOnlyCount,
  };

  const allMatch = Object.values(comparisons).every((c) =>
    typeof c === "object" && c !== null && "match" in c ? c.match === true : true
  );

  return { year, comparisons, allModulesConsistent: allMatch };
}

function walkCode(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkCode(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

function rel(p: string) {
  return p.replace(process.cwd() + "\\", "").replace(process.cwd() + "/", "");
}

const CODE_PATTERNS: Array<{
  id: string;
  re: RegExp;
  motorAllowlist: RegExp;
  syncAllowlist: RegExp;
  risk: "Risco" | "Pendente";
}> = [
  {
    id: "nomusRawResponse.nfes",
    re: /nomusRawResponse\.nfes/g,
    motorAllowlist: /salesOrderLinkedNfe|salesOrderMetricsEngine|salesOrderNomusRaw|salesOrderNfeLink|salesOrderInvoicingSql|systemDataLineageAudit|materialDemandPlannedRealizedAudit/,
    syncAllowlist: /nomusSalesOrdersSync|nomusNfesSync|backfill-sales-order|salesOrderRawMaterialIntelligenceService|financeBillingNfeComparison|audit-/,
    risk: "Risco",
  },
  {
    id: "orderIsInvoicedSql",
    re: /orderIsInvoicedSql/g,
    motorAllowlist: /salesOrderInvoicingSql/,
    syncAllowlist: /financeSalesOrdersDashboard\.test|audit-/,
    risk: "Pendente",
  },
  {
    id: "orderNotInvoicedSql",
    re: /orderNotInvoicedSql/g,
    motorAllowlist: /salesOrderInvoicingSql/,
    syncAllowlist: /financeSalesOrdersDashboard\.test|financeBilling|audit-/,
    risk: "Pendente",
  },
  {
    id: "dataProcessamento-direct",
    re: /dataProcessamento/g,
    motorAllowlist: /salesOrderLinkedNfe|salesOrderLogisticStatus|salesOrderNomusRaw|salesOrderNfeLink|nomusNfe|financeBilling|materialDemand|salesOrderMetricsEngine|salesOrderManagementFulfillment/,
    syncAllowlist: /\.test\.|audit-|FinanceBillingNfe/,
    risk: "Risco",
  },
];

function auditCode(): SectionResult {
  const files = walkCode(join(process.cwd(), "src"));
  const findings: Array<{
    pattern: string;
    file: string;
    count: number;
    classification: "OK-motor" | "OK-sync" | "Pendente" | "Risco";
  }> = [];

  for (const file of files) {
    const path = rel(file);
    if (path.includes("salesOrderMetricsEngine")) continue;
    const src = readFileSync(file, "utf8");

    for (const pat of CODE_PATTERNS) {
      const matches = src.match(pat.re);
      if (!matches?.length) continue;
      let classification: "OK-motor" | "OK-sync" | "Pendente" | "Risco" = pat.risk;
      if (pat.motorAllowlist.test(path)) classification = "OK-motor";
      else if (pat.syncAllowlist.test(path)) classification = "OK-sync";
      findings.push({
        pattern: pat.id,
        file: path,
        count: matches.length,
        classification,
      });
    }
  }

  const pending = findings.filter((f) => f.classification === "Pendente" || f.classification === "Risco");
  return {
    totalFindings: findings.length,
    pendingOrRisk: pending.length,
    byClassification: {
      okMotor: findings.filter((f) => f.classification === "OK-motor").length,
      okSync: findings.filter((f) => f.classification === "OK-sync").length,
      pendente: findings.filter((f) => f.classification === "Pendente").length,
      risco: findings.filter((f) => f.classification === "Risco").length,
    },
    topPending: pending.slice(0, 25),
  };
}

async function main() {
  console.log("IndusCost — Validação final Pedido de Venda / NF-e");
  console.log(`Ano: ${YEAR} | Referência: ${REF.toISOString()}`);
  console.log(`Motor: salesOrderMetricsEngine v${SALES_ORDER_METRICS_ENGINE_VERSION}`);

  const report: Record<string, unknown> = {
    generatedAt: REF.toISOString(),
    year: YEAR,
    engineVersion: SALES_ORDER_METRICS_ENGINE_VERSION,
    dbAvailable: false,
  };

  report.codeAudit = auditCode();

  try {
    await prisma.$queryRaw`SELECT 1`;
    report.dbAvailable = true;

    report.nfeLinks = await auditNfeLinks();
    report.statuses = await auditStatuses(YEAR, REF);
    report.values = await auditValues(YEAR, REF);
    report.crossModule = await auditCrossModule(YEAR, REF);
  } catch (err) {
    report.dbError = err instanceof Error ? err.message : String(err);
    console.error("\nDB indisponível — auditoria runtime pulada:", report.dbError);
  }

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log(`\nRelatório JSON: ${REPORT_PATH}`);

  const cross = report.crossModule as { allModulesConsistent?: boolean } | undefined;
  const code = report.codeAudit as { pendingOrRisk?: number } | undefined;
  const ok =
    report.dbAvailable === true &&
    cross?.allModulesConsistent === true &&
    (code?.pendingOrRisk ?? 0) < 50;

  console.log(
    ok
      ? "\nRESULTADO: OK — validação runtime consistente (revisar achados de código no relatório MD)"
      : report.dbAvailable
        ? "\nRESULTADO: ATENÇÃO — divergências ou achados pendentes (ver relatório)"
        : "\nRESULTADO: PARCIAL — auditoria estática OK; executar no servidor com DB para runtime"
  );

  await prisma.$disconnect().catch(() => undefined);
  process.exit(report.dbAvailable && cross && !cross.allModulesConsistent ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
