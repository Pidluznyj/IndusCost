/**
 * Orquestrador do DRE Gerencial Mensal.
 * Sempre consulta motores oficiais — não recalcula elegibilidade NF-e nem alocação AP.
 * CMV = item NF-e × custo vigente na data da nota (tabela de custo de produtos).
 */

import { queryMonthlyFiscalNfe } from "@/src/lib/financeBillingNfeDashboard.js";
import {
  buildFinanceCostCenterDashboardDefault,
} from "@/src/lib/financeCostCenterDashboard.js";
import { buildExecutiveReportCostCenterDashboardFilters } from "@/src/lib/financeCostCenterAnnualSpendingChart.js";
import {
  mapExecutiveReportCompanyToEmitterCnpj,
  mapExecutiveReportCompanyToFilter,
  parseFinanceExecutiveReportCompany,
} from "@/src/lib/financeExecutiveReportCompany.js";
import { queryMonthlyFiscalNfeDeductions } from "@/src/lib/financeDreNfeQueries.server.js";
import { loadMonthlyCmvFromNfeProductCosts } from "@/src/lib/financeDreCmvFromNfe.server.js";
import {
  bucketCostCenterSpendByDreRole,
  type DreCostCenterRole,
} from "@/src/lib/financeDreCostCenterRoles.js";
import {
  buildFinanceDreInformativeReport,
  buildFinanceDreLines,
  buildFinanceDreSourceChecks,
  emptyDreSeries,
  financeDreMonthLabels,
  roundDreMoney,
  ytdThroughMonth,
} from "@/src/lib/financeDreMath.js";
import {
  FINANCE_DRE_OFFICIAL_SOURCES,
  type FinanceDreCompany,
  type FinanceDreCostCenterBreakdownRow,
  type FinanceDreFilters,
  type FinanceDreReport,
} from "@/src/lib/financeDreTypes.js";

export class FinanceDreParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinanceDreParseError";
  }
}

const ROLE_LABELS: Record<DreCostCenterRole, string> = {
  logistics: "Logística / Fretes",
  packaging: "Embalagens",
  payroll: "Folha",
  benefits: "Benefícios",
  assembly: "Montagem",
  labor: "Mão de obra",
  tax: "Imposto",
  raw_material: "Matéria-prima",
  admin: "Administrativo",
};

export function parseFinanceDreQuery(
  query: Record<string, unknown>,
  referenceNow: Date = new Date()
): FinanceDreFilters {
  const nowYear = referenceNow.getFullYear();
  const nowMonth = referenceNow.getMonth() + 1;

  const yearRaw = Number.parseInt(String(query.year ?? nowYear), 10);
  const year = Number.isFinite(yearRaw) && yearRaw >= 2000 && yearRaw <= 2100 ? yearRaw : nowYear;

  const monthRaw = Number.parseInt(String(query.month ?? nowMonth), 10);
  const highlightMonth =
    Number.isFinite(monthRaw) && monthRaw >= 1 && monthRaw <= 12 ? monthRaw : nowMonth;

  const company = parseFinanceExecutiveReportCompany(query.company) as FinanceDreCompany;

  return {
    year,
    highlightMonth,
    company,
    dateBase: "emissao",
  };
}

function companyLabel(company: FinanceDreCompany): string {
  switch (company) {
    case "lazarios":
      return "Lazarios";
    case "koppetel":
      return "Koppetel";
    case "sm":
      return "SM";
    default:
      return "Todas as empresas";
  }
}

function sumSeriesSafeLocal(a: number[], b: number[]): number[] {
  return Array.from({ length: 12 }, (_, i) => roundDreMoney((a[i] ?? 0) + (b[i] ?? 0)));
}

export async function buildFinanceDreReport(
  query: Record<string, unknown> = {},
  referenceNow: Date = new Date()
): Promise<FinanceDreReport> {
  const filters = parseFinanceDreQuery(query, referenceNow);
  const emitterCnpj = mapExecutiveReportCompanyToEmitterCnpj(filters.company);
  const companyName = mapExecutiveReportCompanyToFilter(filters.company);

  const [revenueMap, deductions, ccDashboard, cmvBundle] = await Promise.all([
    queryMonthlyFiscalNfe(filters.year, "emissao", emitterCnpj),
    queryMonthlyFiscalNfeDeductions(filters.year, "emissao", emitterCnpj),
    buildFinanceCostCenterDashboardDefault(
      buildExecutiveReportCostCenterDashboardFilters({
        year: filters.year,
        month: null,
        companyName,
      }),
      referenceNow
    ),
    loadMonthlyCmvFromNfeProductCosts(filters.year, emitterCnpj),
  ]);

  const receitaBruta = emptyDreSeries();
  for (const [month, total] of revenueMap.entries()) {
    if (month >= 1 && month <= 12) receitaBruta[month - 1] = roundDreMoney(total);
  }

  const { buckets: ccBuckets, roleRows } = bucketCostCenterSpendByDreRole(
    ccDashboard.monthlySeries.byCostCenter.map((row) => ({
      month: row.month,
      year: row.year,
      costCenterId: row.costCenterId,
      code: row.code,
      name: row.name,
      amount: row.amount,
    })),
    filters.year,
    ccDashboard.monthlySeries.totals.map((row) => ({
      month: row.month,
      year: row.year,
      unclassifiedAmount: row.unclassifiedAmount,
    })),
    filters.highlightMonth
  );

  const despesasAdmin = sumSeriesSafeLocal(ccBuckets.admin, ccBuckets.unclassified);
  const unclassifiedYtd = ytdThroughMonth(ccBuckets.unclassified, filters.highlightMonth);

  const gapRevenueByMonth = sumSeriesSafeLocal(
    sumSeriesSafeLocal(
      cmvBundle.missingItemsRevenueByMonth,
      cmvBundle.missingProductRevenueByMonth
    ),
    cmvBundle.missingCostRevenueByMonth
  );
  const gapRevenueYtd = ytdThroughMonth(gapRevenueByMonth, filters.highlightMonth);
  const gapLineCount =
    cmvBundle.missingItemsNfeCount +
    cmvBundle.missingProductLineCount +
    cmvBundle.missingCostLineCount;

  const costCenterBreakdown: FinanceDreCostCenterBreakdownRow[] = roleRows.map((row) => ({
    costCenterId: row.costCenterId,
    code: row.code,
    name: row.name,
    role: row.role,
    roleLabel: ROLE_LABELS[row.role],
    highlightAmount: row.highlightAmount,
    ytdAmount: row.ytdAmount,
  }));

  const { lines, kpis, qualityAlerts } = buildFinanceDreLines({
    highlightMonth: filters.highlightMonth,
    receitaBruta,
    cofins: deductions.cofins,
    icms: deductions.icms,
    icmsSt: deductions.icmsSt,
    ipi: deductions.ipi,
    pis: deductions.pis,
    devolucoes: deductions.devolucoes,
    cmv: cmvBundle.cmv,
    fretes: ccBuckets.logistics,
    embalagens: ccBuckets.packaging,
    despesasAdmin,
    despesasPessoal: ccBuckets.personnel,
    impostosCc: ccBuckets.tax,
    materiaPrimaCc: ccBuckets.rawMaterial,
    unclassifiedCcAmount: ccBuckets.unclassified,
    quality: {
      unlinkedNfeCount: gapLineCount,
      unlinkedNfeRevenue: gapRevenueYtd,
      taxSummaryGapCount: deductions.taxSummaryGapCount,
      missingItemsNfeCount: cmvBundle.missingItemsNfeCount,
      missingProductLineCount: cmvBundle.missingProductLineCount,
      missingCostLineCount: cmvBundle.missingCostLineCount,
      pricedLineCount: cmvBundle.pricedLineCount,
    },
  });

  const sourceChecks = buildFinanceDreSourceChecks({
    unlinkedNfeCount: gapLineCount,
    taxSummaryGapCount: deductions.taxSummaryGapCount,
    unclassifiedYtd,
    pricedLineCount: cmvBundle.pricedLineCount,
  });

  const informativeReport = buildFinanceDreInformativeReport({
    highlightMonth: filters.highlightMonth,
    despesasPessoal: ccBuckets.personnel,
    impostosCc: ccBuckets.tax,
    materiaPrimaCc: ccBuckets.rawMaterial,
    unclassifiedCcAmount: ccBuckets.unclassified,
    unlinkedNfeRevenueByMonth: gapRevenueByMonth,
    unlinkedNfeCount: gapLineCount,
    missingItemsNfeCount: cmvBundle.missingItemsNfeCount,
    missingItemsRevenueByMonth: cmvBundle.missingItemsRevenueByMonth,
    missingProductLineCount: cmvBundle.missingProductLineCount,
    missingProductRevenueByMonth: cmvBundle.missingProductRevenueByMonth,
    missingCostLineCount: cmvBundle.missingCostLineCount,
    missingCostRevenueByMonth: cmvBundle.missingCostRevenueByMonth,
  });

  const monthName = financeDreMonthLabels()[filters.highlightMonth - 1] ?? String(filters.highlightMonth);

  return {
    schemaVersion: 1,
    title: "DRE Gerencial Mensal",
    subtitle: `${companyLabel(filters.company)} · ${monthName}/${filters.year} · competência emissão NF-e`,
    disclaimer:
      "Demonstrativo gerencial para o conselho. Não substitui o DRE contábil. Receita = NF-e emitida; CMV = quantidade faturada × custo vigente na data da nota; despesas via centros de custo.",
    generatedAt: new Date().toISOString(),
    filters,
    companyLabel: companyLabel(filters.company),
    monthLabels: financeDreMonthLabels(),
    kpis,
    lines,
    sourceChecks,
    informativeReport,
    costCenterBreakdown,
    qualityAlerts,
    sources: FINANCE_DRE_OFFICIAL_SOURCES,
  };
}
