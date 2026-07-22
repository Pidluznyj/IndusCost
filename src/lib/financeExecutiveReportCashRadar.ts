/**
 * Radar Diário de Caixa no Relatório Presidencial — reutiliza o motor oficial do Fluxo de Caixa.
 */
import type { PrismaClient } from "@prisma/client";
import { buildFinanceApPrismaWhere } from "./financeAccountsPayableDashboard.js";
import { loadFinanceArTitlesSourceBundle } from "./finance/financeArEffectiveTitlesSource.server.js";
import {
  FINANCE_CASH_FLOW_AP_SELECT,
  mapPrismaRowToFinanceCashFlowApRow,
  mapPrismaRowToFinanceCashFlowArRow,
  toCashFlowPortfolioApFilters,
  toCashFlowPortfolioArFilters,
} from "./financeCashFlowDashboard.js";
import type { FinanceCashFlowDashboardFilters } from "./financeCashFlowDashboardTypes.js";
import {
  buildCashFlowDailyRadarData,
  DAILY_RADAR_EXPORT_PAGE_SIZE,
  DAILY_RADAR_RANGE_KEYS,
  EXECUTIVE_REPORT_DEFAULT_CASH_RADAR_RANGE_KEY,
  type DailyRadarPayload,
  type DailyRadarRangeKey,
  type DailyRadarRangeSummary,
  type DailyRadarSelectedDetail,
} from "./financeCashFlowDailyRadar.js";
import type { FinanceExecutiveReportFilters } from "./financeExecutiveReportTypes.js";
import { parseFinanceManagementScope } from "./financeInternalGroupExclusions.js";
import { resolveNomusApReportSyncCutoffFromPrisma } from "./financeNomusApReportFreshness.js";
import { prisma as defaultPrisma } from "./prisma.js";

function mapExecutiveReportCompanyToFilter(company: string | undefined): string | undefined {
  switch (String(company ?? "all").trim().toLowerCase()) {
    case "lazarios":
      return "Lazarios";
    case "koppetel":
      return "Koppetel";
    case "sm":
      return "SM";
    default:
      return undefined;
  }
}

function mapExecutiveReportNfeFilterToInvoiceIssued(
  filter: FinanceExecutiveReportFilters["invoiceIssuedFilter"]
): "yes" | "no" | undefined {
  if (filter === "with-nfe") return "yes";
  if (filter === "without-nfe") return "no";
  return undefined;
}

export type ExecutiveReportCashRadarFilterLine = {
  label: string;
  value: string;
  /** Quando true, o filtro do relatório não altera o radar (exibido como chip informativo). */
  notApplicable?: boolean;
};

export type FinanceExecutiveReportCashRadar = {
  source: {
    module: string;
    builder: string;
    description: string;
  };
  baseDate: string;
  periodLabel: string;
  filtersApplied: ExecutiveReportCashRadarFilterLine[];
  ranges: DailyRadarRangeSummary[];
  defaultOpenRange: typeof EXECUTIVE_REPORT_DEFAULT_CASH_RADAR_RANGE_KEY;
  /** Payload completo do motor oficial — tela e PDF consomem o mesmo bloco. */
  radarPayload: DailyRadarPayload;
  selectedRangeDetail: DailyRadarSelectedDetail | null;
};

/** Filtros do radar no contexto presidencial — carteira aberta com escopo do relatório. */
export function buildExecutiveReportDailyRadarCashFlowFilters(
  filters: FinanceExecutiveReportFilters
): FinanceCashFlowDashboardFilters {
  return {
    year: filters.year,
    month: filters.month ?? undefined,
    companyName: mapExecutiveReportCompanyToFilter(filters.company),
    viewMode: "projected",
    dateBase: "due",
    status: "open",
    cashFlowScope: parseFinanceManagementScope(
      filters.customerType === "all" ? "all" : "company"
    ),
    invoiceIssued: mapExecutiveReportNfeFilterToInvoiceIssued(
      filters.invoiceIssuedFilter ?? "all"
    ),
  };
}

export async function loadExecutiveReportDailyRadarPortfolioRows(
  filters: FinanceExecutiveReportFilters,
  referenceDate: Date,
  db: Pick<PrismaClient, "nomusAccountsReceivable" | "nomusAccountsPayable"> = defaultPrisma
) {
  const dashboardFilters = buildExecutiveReportDailyRadarCashFlowFilters(filters);
  const arFilters = toCashFlowPortfolioArFilters(dashboardFilters);
  const apFilters = toCashFlowPortfolioApFilters(dashboardFilters);
  const [arBundle, apSyncCutoff] = await Promise.all([
    loadFinanceArTitlesSourceBundle(db as PrismaClient, arFilters, referenceDate),
    resolveNomusApReportSyncCutoffFromPrisma(db),
  ]);
  const apWhere = buildFinanceApPrismaWhere(apFilters, apSyncCutoff);
  const apPrisma = await db.nomusAccountsPayable.findMany({
    where: apWhere,
    select: FINANCE_CASH_FLOW_AP_SELECT,
    orderBy: { dueDate: "asc" },
  });

  return {
    arRows: arBundle.arRows,
    apRows: apPrisma.map(mapPrismaRowToFinanceCashFlowApRow),
    arSyncCutoff: arBundle.syncCutoff,
    apSyncCutoff,
    dashboardFilters,
    orderContexts: arBundle.orderContexts,
    nfeOrderLinks: arBundle.nfeOrderLinks,
  };
}

function formatCompanyLabel(company: string | undefined): string {
  if (!company || company === "all") return "Todas";
  const mapped = mapExecutiveReportCompanyToFilter(company);
  return mapped ?? company;
}

function formatCustomerTypeLabel(customerType: FinanceExecutiveReportFilters["customerType"]): string {
  if (customerType === "all") return "Todos (inclui intercompany)";
  if (customerType === "external" || customerType === "market") return "Mercado externo";
  if (customerType === "internal") return "Intercompany";
  return "Mercado externo";
}

function formatNfeFilterLabel(
  invoiceIssued: FinanceExecutiveReportFilters["invoiceIssuedFilter"]
): string {
  if (invoiceIssued === "with-nfe") return "Com NF emitida";
  if (invoiceIssued === "without-nfe") return "Sem NF emitida";
  return "Todas";
}

export function buildExecutiveReportCashRadarFilterLines(
  filters: FinanceExecutiveReportFilters
): ExecutiveReportCashRadarFilterLine[] {
  const periodLabel =
    filters.month != null
      ? `${String(filters.month).padStart(2, "0")}/${filters.year}`
      : String(filters.year);

  return [
    { label: "Ano", value: String(filters.year), notApplicable: true },
    {
      label: "Mês",
      value: filters.month != null ? String(filters.month).padStart(2, "0") : "Todos",
      notApplicable: true,
    },
    { label: "Data-base operacional", value: filters.asOfDate },
    { label: "Empresa", value: formatCompanyLabel(filters.company) },
    {
      label: "Tipo de cliente",
      value: formatCustomerTypeLabel(filters.customerType),
    },
    {
      label: "NF emitida (AR)",
      value: formatNfeFilterLabel(filters.invoiceIssuedFilter),
    },
    {
      label: "Top N",
      value: filters.topN != null ? String(filters.topN) : "50",
      notApplicable: true,
    },
    { label: "Período do relatório", value: periodLabel, notApplicable: true },
  ];
}

export function buildExecutiveReportCashRadarBlock(input: {
  arRows: ReturnType<typeof mapPrismaRowToFinanceCashFlowArRow>[];
  apRows: ReturnType<typeof mapPrismaRowToFinanceCashFlowApRow>[];
  filters: FinanceExecutiveReportFilters;
  referenceDate: Date;
  arSyncCutoff: Awaited<ReturnType<typeof loadExecutiveReportDailyRadarPortfolioRows>>["arSyncCutoff"];
  apSyncCutoff: Awaited<ReturnType<typeof resolveNomusApReportSyncCutoffFromPrisma>>;
  dashboardFilters: FinanceCashFlowDashboardFilters;
  orderContexts?: import("./finance/financeAccountsReceivableEffectiveTitles.js").FinanceArEffectiveOrderContext[];
  nfeOrderLinks?: import("./finance/financeArOperationalPortfolio.js").FinanceArNfeOrderLink[];
  rangeKey?: DailyRadarRangeKey;
  day?: string;
  search?: string;
  exportAll?: boolean;
}): FinanceExecutiveReportCashRadar {
  const rangeKey = input.rangeKey ?? EXECUTIVE_REPORT_DEFAULT_CASH_RADAR_RANGE_KEY;
  const periodLabel =
    input.filters.month != null
      ? `${String(input.filters.month).padStart(2, "0")}/${input.filters.year}`
      : String(input.filters.year);

  const radarPayload = buildCashFlowDailyRadarData({
    arRows: input.arRows,
    apRows: input.apRows,
    baseDate: input.referenceDate,
    referenceDate: input.referenceDate,
    arSyncCutoff: input.arSyncCutoff,
    apSyncCutoff: input.apSyncCutoff,
    dashboardFilters: input.dashboardFilters,
    orderContexts: input.orderContexts,
    nfeOrderLinks: input.nfeOrderLinks,
    query: {
      rangeKey,
      day: input.day,
      search: input.search,
      exportAll: input.exportAll ?? true,
      pageSize: DAILY_RADAR_EXPORT_PAGE_SIZE,
    },
  });

  return {
    source: {
      module: "financeCashFlowDailyRadar.ts",
      builder: "buildCashFlowDailyRadarData → buildFinanceCashFlowDailyRadar",
      description:
        "Radar Diário de Caixa com filtros do Relatório Presidencial (empresa, escopo de cliente, NF emitida em AR).",
    },
    baseDate: radarPayload.baseDate,
    periodLabel,
    filtersApplied: buildExecutiveReportCashRadarFilterLines(input.filters),
    ranges: radarPayload.ranges,
    defaultOpenRange: EXECUTIVE_REPORT_DEFAULT_CASH_RADAR_RANGE_KEY,
    radarPayload,
    selectedRangeDetail: radarPayload.selectedDetail ?? null,
  };
}

export function parseExecutiveReportCashRadarRangeKey(value: unknown): DailyRadarRangeKey {
  const raw = String(value ?? EXECUTIVE_REPORT_DEFAULT_CASH_RADAR_RANGE_KEY)
    .trim()
    .replace(/_/g, "-");
  if (raw === "0-7-days") return "0-7";
  if (DAILY_RADAR_RANGE_KEYS.includes(raw as DailyRadarRangeKey)) {
    return raw as DailyRadarRangeKey;
  }
  return EXECUTIVE_REPORT_DEFAULT_CASH_RADAR_RANGE_KEY;
}

export async function buildExecutiveReportCashRadarForFilters(
  filters: FinanceExecutiveReportFilters,
  referenceDate: Date,
  options?: {
    rangeKey?: DailyRadarRangeKey;
    day?: string;
    search?: string;
  },
  db: Pick<PrismaClient, "nomusAccountsReceivable" | "nomusAccountsPayable"> = defaultPrisma
): Promise<FinanceExecutiveReportCashRadar> {
  const portfolio = await loadExecutiveReportDailyRadarPortfolioRows(filters, referenceDate, db);
  const rangeKey = options?.rangeKey ?? EXECUTIVE_REPORT_DEFAULT_CASH_RADAR_RANGE_KEY;

  return buildExecutiveReportCashRadarBlock({
    ...portfolio,
    filters,
    referenceDate,
    rangeKey,
    day: options?.day,
    search: options?.search,
    exportAll: true,
  });
}
