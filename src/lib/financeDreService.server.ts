/**
 * Orquestrador do DRE Gerencial Mensal.
 * Sempre consulta motores oficiais — não recalcula elegibilidade NF-e nem alocação AP.
 * CMV = item NF-e × custo vigente na data da nota (tabela de custo de produtos).
 * IRPJ/CSLL: provisão gerencial estimada (não grava tributos nem apuração fiscal).
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
  buildEstimatedCorporateTaxSeriesFromEntityBases,
  FINANCE_DRE_ESTIMATED_TAX_DISCLAIMER,
  type FinanceDreEstimatedCorporateTaxesBlock,
  type FinanceDreTaxEntitySeries,
} from "@/src/lib/financeDreEstimatedCorporateTaxes.js";
import { FINANCE_INTERNAL_GROUP_COMPANIES } from "@/src/lib/financeInternalGroupExclusions.js";
import {
  buildFinanceDreInformativeReport,
  buildFinanceDreLines,
  buildFinanceDreSourceChecks,
  computeFinanceDreEstimatedTaxBaseSeries,
  emptyDreSeries,
  financeDreMonthLabels,
  resolveFinanceDreAvailableThroughMonth,
  roundDreMoney,
  zeroDreSeriesAfterMonth,
  ytdThroughMonth,
  type FinanceDreMathInput,
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

/** Pessoas jurídicas distintas do grupo (CNPJ próprio) — filtro "Todas as empresas". */
const LEGAL_ENTITY_COMPANIES: Exclude<FinanceDreCompany, "all">[] = [
  "lazarios",
  "koppetel",
  "sm",
];

export function parseFinanceDreQuery(
  query: Record<string, unknown>,
  referenceNow: Date = new Date()
): FinanceDreFilters {
  const nowYear = referenceNow.getFullYear();
  const nowMonth = referenceNow.getMonth() + 1;

  const yearRaw = Number.parseInt(String(query.year ?? nowYear), 10);
  const year = Number.isFinite(yearRaw) && yearRaw >= 2000 && yearRaw <= 2100 ? yearRaw : nowYear;

  const availableThroughMonth = resolveFinanceDreAvailableThroughMonth(year, referenceNow);
  const monthRaw = Number.parseInt(String(query.month ?? nowMonth), 10);
  const requestedMonth =
    Number.isFinite(monthRaw) && monthRaw >= 1 && monthRaw <= 12 ? monthRaw : nowMonth;
  // Não destaca mês futuro: limita ao último mês com competência disponível.
  const highlightMonth =
    availableThroughMonth <= 0
      ? 1
      : Math.min(requestedMonth, availableThroughMonth);

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

type DreSeriesBundle = {
  mathInput: FinanceDreMathInput;
  costCenterBreakdown: FinanceDreCostCenterBreakdownRow[];
  unclassifiedYtd: number;
  gapRevenueByMonth: number[];
  gapLineCount: number;
  missingItemsRevenueByMonth: number[];
  missingProductRevenueByMonth: number[];
  missingCostRevenueByMonth: number[];
  personnel: number[];
  taxCc: number[];
  rawMaterial: number[];
  unclassified: number[];
  pricedLineCount: number;
  taxSummaryGapCount: number;
};

async function loadFinanceDreSeriesBundle(
  filters: FinanceDreFilters,
  referenceNow: Date
): Promise<DreSeriesBundle> {
  const availableThroughMonth = resolveFinanceDreAvailableThroughMonth(
    filters.year,
    referenceNow
  );
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

  const clamp = (series: number[]) => zeroDreSeriesAfterMonth(series, availableThroughMonth);

  const mathInput: FinanceDreMathInput = {
    highlightMonth: filters.highlightMonth,
    availableThroughMonth,
    receitaBruta: clamp(receitaBruta),
    cofins: clamp(deductions.cofins),
    icms: clamp(deductions.icms),
    icmsSt: clamp(deductions.icmsSt),
    ipi: clamp(deductions.ipi),
    pis: clamp(deductions.pis),
    devolucoes: clamp(deductions.devolucoes),
    cmv: clamp(cmvBundle.cmv),
    fretes: clamp(ccBuckets.logistics),
    embalagens: clamp(ccBuckets.packaging),
    despesasAdmin: clamp(despesasAdmin),
    despesasPessoal: clamp(ccBuckets.personnel),
    impostosCc: clamp(ccBuckets.tax),
    materiaPrimaCc: clamp(ccBuckets.rawMaterial),
    unclassifiedCcAmount: clamp(ccBuckets.unclassified),
    quality: {
      unlinkedNfeCount: gapLineCount,
      unlinkedNfeRevenue: gapRevenueYtd,
      taxSummaryGapCount: deductions.taxSummaryGapCount,
      missingItemsNfeCount: cmvBundle.missingItemsNfeCount,
      missingProductLineCount: cmvBundle.missingProductLineCount,
      missingCostLineCount: cmvBundle.missingCostLineCount,
      pricedLineCount: cmvBundle.pricedLineCount,
    },
  };

  return {
    mathInput,
    costCenterBreakdown,
    unclassifiedYtd,
    gapRevenueByMonth: clamp(gapRevenueByMonth),
    gapLineCount,
    missingItemsRevenueByMonth: clamp(cmvBundle.missingItemsRevenueByMonth),
    missingProductRevenueByMonth: clamp(cmvBundle.missingProductRevenueByMonth),
    missingCostRevenueByMonth: clamp(cmvBundle.missingCostRevenueByMonth),
    personnel: clamp(ccBuckets.personnel),
    taxCc: clamp(ccBuckets.tax),
    rawMaterial: clamp(ccBuckets.rawMaterial),
    unclassified: clamp(ccBuckets.unclassified),
    pricedLineCount: cmvBundle.pricedLineCount,
    taxSummaryGapCount: deductions.taxSummaryGapCount,
  };
}

async function loadPerLegalEntityTaxOverride(
  filters: FinanceDreFilters,
  referenceNow: Date
): Promise<FinanceDreEstimatedCorporateTaxesBlock> {
  const bundles = await Promise.all(
    LEGAL_ENTITY_COMPANIES.map((company) =>
      loadFinanceDreSeriesBundle({ ...filters, company }, referenceNow)
    )
  );
  const entities: FinanceDreTaxEntitySeries[] = LEGAL_ENTITY_COMPANIES.map((company, idx) => {
    const cnpj =
      mapExecutiveReportCompanyToEmitterCnpj(company) ??
      FINANCE_INTERNAL_GROUP_COMPANIES.find((c) =>
        c.aliases.some((a) => a.toLowerCase().includes(company))
      )?.cnpj ??
      "";
    return {
      companyKey: company,
      companyLabel: companyLabel(company),
      cnpjDigits: cnpj,
      baseByMonth: computeFinanceDreEstimatedTaxBaseSeries(bundles[idx]!.mathInput),
    };
  });
  return buildEstimatedCorporateTaxSeriesFromEntityBases(
    entities,
    filters.highlightMonth,
    "per_legal_entity"
  );
}

export async function buildFinanceDreReport(
  query: Record<string, unknown> = {},
  referenceNow: Date = new Date()
): Promise<FinanceDreReport> {
  const filters = parseFinanceDreQuery(query, referenceNow);

  const consolidated = await loadFinanceDreSeriesBundle(filters, referenceNow);

  const estimatedCorporateTaxesOverride =
    filters.company === "all"
      ? await loadPerLegalEntityTaxOverride(filters, referenceNow)
      : undefined;

  const { lines, kpis, qualityAlerts, estimatedCorporateTaxes } = buildFinanceDreLines({
    ...consolidated.mathInput,
    estimatedCorporateTaxesOverride,
  });

  const sourceChecks = buildFinanceDreSourceChecks({
    unlinkedNfeCount: consolidated.gapLineCount,
    taxSummaryGapCount: consolidated.taxSummaryGapCount,
    unclassifiedYtd: consolidated.unclassifiedYtd,
    pricedLineCount: consolidated.pricedLineCount,
  });

  const informativeReport = buildFinanceDreInformativeReport({
    highlightMonth: filters.highlightMonth,
    despesasPessoal: consolidated.personnel,
    impostosCc: consolidated.taxCc,
    materiaPrimaCc: consolidated.rawMaterial,
    unclassifiedCcAmount: consolidated.unclassified,
    unlinkedNfeRevenueByMonth: consolidated.gapRevenueByMonth,
    unlinkedNfeCount: consolidated.gapLineCount,
    missingItemsNfeCount: consolidated.mathInput.quality.missingItemsNfeCount,
    missingItemsRevenueByMonth: consolidated.missingItemsRevenueByMonth,
    missingProductLineCount: consolidated.mathInput.quality.missingProductLineCount,
    missingProductRevenueByMonth: consolidated.missingProductRevenueByMonth,
    missingCostLineCount: consolidated.mathInput.quality.missingCostLineCount,
    missingCostRevenueByMonth: consolidated.missingCostRevenueByMonth,
  });

  const monthName = financeDreMonthLabels()[filters.highlightMonth - 1] ?? String(filters.highlightMonth);
  const consolidationHint =
    estimatedCorporateTaxes.consolidationMode === "per_legal_entity"
      ? " IRPJ/CSLL estimados por pessoa jurídica (CNPJ) e somados — sem compensação entre empresas."
      : "";
  const ytdHint =
    " YTD de IRPJ/CSLL = soma das estimativas mensais independentes (não é apuração acumulada com limite × meses).";

  return {
    schemaVersion: 1,
    title: "DRE Gerencial Mensal",
    subtitle: `${companyLabel(filters.company)} · ${monthName}/${filters.year} · competência emissão NF-e`,
    disclaimer:
      "Demonstrativo gerencial para o conselho. Não substitui o DRE contábil. Receita = NF-e emitida; CMV = quantidade faturada × custo vigente na data da nota; despesas via centros de custo. " +
      FINANCE_DRE_ESTIMATED_TAX_DISCLAIMER +
      consolidationHint +
      ytdHint,
    generatedAt: new Date().toISOString(),
    filters,
    companyLabel: companyLabel(filters.company),
    monthLabels: financeDreMonthLabels(),
    kpis,
    lines,
    estimatedCorporateTaxes,
    sourceChecks,
    informativeReport,
    costCenterBreakdown: consolidated.costCenterBreakdown,
    qualityAlerts,
    sources: FINANCE_DRE_OFFICIAL_SOURCES,
  };
}
