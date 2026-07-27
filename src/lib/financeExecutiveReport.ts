import type { PrismaClient } from "@prisma/client";
import { buildFinanceBillingDashboard } from "./financeBillingDashboard.js";
import {
  buildOfficialAccountsReceivableDashboard,
  type OfficialAccountsReceivableDashboardPayload,
} from "./financeAccountsReceivableRulesAdapter.js";
import {
  type FinanceArDashboardFilters,
} from "./financeAccountsReceivableDashboard.js";
import {
  buildOfficialAccountsPayableDashboard,
  type OfficialAccountsPayableDashboardPayload,
} from "./financeAccountsPayableRulesAdapter.js";
import {
  buildFinanceApPrismaWhere,
  mapPrismaRowToFinanceApDashboardRow,
  type FinanceApDashboardFilters,
} from "./financeAccountsPayableDashboard.js";
import {
  buildFinanceCashFlowDashboard,
  FINANCE_CASH_FLOW_AP_SELECT,
  mapPrismaRowToFinanceCashFlowApRow,
  toApLoadFilters,
  toArLoadFilters,
  type FinanceCashFlowDashboardFilters,
} from "./financeCashFlowDashboard.js";
import { enrichFinanceCashFlowArLoadBundle } from "./finance/financeCashFlowEffectiveAr.server.js";
import type { FinanceCashFlowExecutiveMonthlyRow } from "./financeCashFlowExecutiveSummary.js";
import {
  buildCashFlowApPrismaWhere,
} from "./financeCashFlowRowFilters.js";
import { FINANCE_AP_TITLE_SELECT } from "./financeAccountsPayableTitles.js";
import { loadFinanceArManagementRowsFromPrisma } from "./financeAccountsReceivableManagement.server.js";
import { loadFinanceArOpenHorizonRowsFromPrisma } from "./financeAccountsReceivableManagement.server.js";
import { mergeFinanceDataSanitization } from "./financeInternalGroupExclusions.js";
import { parseFinanceManagementScope } from "./financeInternalGroupExclusions.js";
import { resolveExecutiveDashboardYearContext } from "./executiveDashboardYear.js";
import { buildSalesOrdersDashboardTab } from "./salesOrdersDashboardMetrics.js";
import {
  buildExecutiveReportCashRadarBlock,
  loadExecutiveReportDailyRadarPortfolioRows,
} from "./financeExecutiveReportCashRadar.js";
import { formatExecutiveReportCurrency } from "./financeExecutiveReportUtils.js";
import {
  buildExecutiveReportCoverTitle,
  EXECUTIVE_REPORT_DOCUMENT_TITLE,
  formatExecutiveReportCoverDate,
} from "./financeExecutiveReportUtils.js";
import { buildFinanceExecutiveReportNarrative } from "./financeExecutiveReportNarrative.js";
import { buildExecutiveCashFlowAnnualChart } from "./financeExecutiveReportPresentation.js";
import { buildCashFlowAnnualComparison } from "./financeCashFlowAnnualComparison.js";
import { loadAnnualComparisonPortfolioRows } from "./financeExecutiveReportAnnualLoad.js";
import {
  buildExecutiveReportPayablesSection,
  buildExecutiveReportReceivablesSection,
  resolveExecutiveReportHighlightMonth,
} from "./financeExecutiveReportDataSources.js";
import {
  FINANCE_EXECUTIVE_REPORT_KNOWN_GAPS,
  FINANCE_EXECUTIVE_REPORT_OFFICIAL_SOURCES,
  type FinanceExecutiveReport,
  type FinanceExecutiveReportDataQuality,
  type FinanceExecutiveReportFilters,
} from "./financeExecutiveReportTypes.js";
import { getNomusAccountsReceivableSyncStatus } from "./nomusAccountsReceivableSyncRunner.js";
import { getNomusAccountsPayableSyncStatus } from "./nomusAccountsPayableSyncRunner.js";
import { getNomusNfesSyncStatus } from "./nomusNfesSyncRunner.js";
import { resolveNomusApReportSyncCutoffFromPrisma } from "./financeNomusApReportFreshness.js";
import { prisma as defaultPrisma } from "./prisma.js";
import { EXECUTIVE_DASHBOARD_MIN_YEAR } from "./executiveDashboardYear.js";
import { buildFinanceCostCenterDashboardDefault } from "./financeCostCenterDashboard.js";
import {
  buildExecutiveReportCostCenterDashboardFilters,
} from "./financeCostCenterAnnualSpendingChart.js";
import {
  buildEmptyExecutiveReportCostCenterTopCards,
  buildExecutiveReportCostCenterTopCards,
  EXECUTIVE_REPORT_COST_CENTER_TOP_CARDS_LIMIT,
  type FinanceExecutiveReportCostCenterTopCardsSummary,
  type FinanceExecutiveReportCostCenterTopCard,
} from "./financeExecutiveReportCostCenterTopCards.js";
import { listFinancialCostCentersDefault } from "./financeCostCenters.js";

export { EXECUTIVE_REPORT_COST_CENTER_TOP_CARDS_LIMIT } from "./financeExecutiveReportCostCenterTopCards.js";

export class FinanceExecutiveReportParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinanceExecutiveReportParseError";
  }
}


export type FinanceExecutiveReportCompany = import("./financeExecutiveReportCompany.js").FinanceExecutiveReportCompany;
import {
  mapExecutiveReportCompanyToFilter,
  parseFinanceExecutiveReportCompany,
} from "./financeExecutiveReportCompany.js";
export {
  mapExecutiveReportCompanyToEmitterCnpj,
  mapExecutiveReportCompanyToFilter,
  parseFinanceExecutiveReportCompany,
} from "./financeExecutiveReportCompany.js";
export type FinanceExecutiveReportCustomerType = "external" | "all";
export type FinanceExecutiveReportNfeFilter = "all" | "with-nfe" | "without-nfe";
export type FinanceExecutiveReportTopN = number | "all";

function parseIsoDateOnly(value: unknown): Date | null {
  if (value == null || value === "") return null;
  const raw = String(value).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

function endOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

export function parseFinanceExecutiveReportCustomerType(
  value: unknown
): FinanceExecutiveReportCustomerType {
  return String(value ?? "external").trim().toLowerCase() === "all" ? "all" : "external";
}

export function parseFinanceExecutiveReportNfeFilter(
  value: unknown
): FinanceExecutiveReportNfeFilter {
  const raw = String(value ?? "all").trim().toLowerCase();
  if (raw === "with-nfe" || raw === "with_nfe" || raw === "yes") return "with-nfe";
  if (raw === "without-nfe" || raw === "without_nfe" || raw === "no") return "without-nfe";
  return "all";
}

export function mapExecutiveReportNfeFilterToInvoiceIssued(
  filter: FinanceExecutiveReportNfeFilter
): "yes" | "no" | undefined {
  if (filter === "with-nfe") return "yes";
  if (filter === "without-nfe") return "no";
  return undefined;
}

export function parseFinanceExecutiveReportTopN(value: unknown): FinanceExecutiveReportTopN {
  const raw = String(value ?? "50").trim().toLowerCase();
  if (raw === "all") return "all";
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) return 50;
  return Math.min(n, 500);
}

export function parseFinanceExecutiveReportQuery(
  query: Record<string, unknown>,
  referenceNow = new Date()
): FinanceExecutiveReportFilters {
  const yearRaw = query.year;
  const yearParsed = yearRaw == null || yearRaw === "" ? referenceNow.getFullYear() : Number(yearRaw);
  if (!Number.isInteger(yearParsed) || yearParsed < EXECUTIVE_DASHBOARD_MIN_YEAR) {
    throw new FinanceExecutiveReportParseError("Ano inválido para o relatório presidencial.");
  }

  const monthRaw = query.month;
  let month: number | null = null;
  if (monthRaw != null && monthRaw !== "") {
    const m = Number(monthRaw);
    if (!Number.isInteger(m) || m < 1 || m > 12) {
      throw new FinanceExecutiveReportParseError("Mês inválido. Use 1–12.");
    }
    month = m;
  }

  const asOfParsed = parseIsoDateOnly(query.asOfDate);
  if (!asOfParsed) {
    throw new FinanceExecutiveReportParseError("asOfDate é obrigatório (YYYY-MM-DD).");
  }

  const company = parseFinanceExecutiveReportCompany(query.company);
  const customerType = parseFinanceExecutiveReportCustomerType(query.customerType);
  const nfeFilter = parseFinanceExecutiveReportNfeFilter(query.nfeFilter ?? query.nfe);
  const topN = parseFinanceExecutiveReportTopN(query.topN);

  return {
    year: yearParsed,
    month,
    asOfDate: asOfParsed.toISOString().slice(0, 10),
    company: company === "all" ? undefined : company,
    customerType,
    includeInternalCompanies: customerType === "all",
    nfeFilter: "nfe",
    invoiceIssuedFilter: nfeFilter,
    topN: topN === "all" ? undefined : topN,
    mode: "live",
  };
}

export function resolveExecutiveReportReferenceDate(
  filters: FinanceExecutiveReportFilters
): Date {
  const base = parseIsoDateOnly(filters.asOfDate);
  if (!base) return endOfLocalDay(new Date());
  return endOfLocalDay(base);
}

export function buildExecutiveReportArFilters(
  filters: FinanceExecutiveReportFilters
): FinanceArDashboardFilters {
  return {
    status: "all",
    year: filters.year,
    month: filters.month ?? undefined,
    companyName: mapExecutiveReportCompanyToFilter(
      (filters.company as FinanceExecutiveReportCompany | undefined) ?? "all"
    ),
    invoiceIssued: mapExecutiveReportNfeFilterToInvoiceIssued(
      filters.invoiceIssuedFilter ?? "all"
    ),
  };
}

/** Filtros de carteira AR — espelha a tela oficial (ano, sem mês de vencimento). */
export function buildExecutiveReportArPortfolioFilters(
  filters: FinanceExecutiveReportFilters
): FinanceArDashboardFilters {
  return buildExecutiveReportArFilters({ ...filters, month: null });
}

export function buildExecutiveReportApFilters(
  filters: FinanceExecutiveReportFilters
): FinanceApDashboardFilters {
  return {
    status: "all",
    year: filters.year,
    month: filters.month ?? undefined,
    companyName: mapExecutiveReportCompanyToFilter(
      (filters.company as FinanceExecutiveReportCompany | undefined) ?? "all"
    ),
    managementScope: parseFinanceManagementScope(
      filters.customerType === "all" ? "all" : "company"
    ),
  };
}

/** Filtros de carteira AP — espelha a tela oficial (ano, sem mês de vencimento). */
export function buildExecutiveReportApPortfolioFilters(
  filters: FinanceExecutiveReportFilters
): FinanceApDashboardFilters {
  return buildExecutiveReportApFilters({ ...filters, month: null });
}

export function buildExecutiveReportCashFlowFilters(
  filters: FinanceExecutiveReportFilters
): FinanceCashFlowDashboardFilters {
  return {
    year: filters.year,
    month: filters.month ?? undefined,
    companyName: mapExecutiveReportCompanyToFilter(
      (filters.company as FinanceExecutiveReportCompany | undefined) ?? "all"
    ),
    viewMode: "projected",
    dateBase: "due",
    status: "all",
    cashFlowScope: parseFinanceManagementScope(
      filters.customerType === "all" ? "all" : "company"
    ),
    invoiceIssued: mapExecutiveReportNfeFilterToInvoiceIssued(
      filters.invoiceIssuedFilter ?? "all"
    ),
  };
}

/** Filtros anuais para o gráfico Jan–Dez — ignora mês, mantém ano/empresa/escopo. */
export function buildExecutiveReportCashFlowAnnualFilters(
  filters: FinanceExecutiveReportFilters
): FinanceCashFlowDashboardFilters {
  return buildExecutiveReportCashFlowFilters({ ...filters, month: undefined });
}

/**
 * Linha do tempo mensal Jan–Dez para o Relatório Presidencial.
 * Mesma fonte da tabela Fluxo de Caixa (`executiveSummary.monthlyTimeline` com carga anual).
 */
export function resolveExecutiveReportCashFlowMonthlyTimeline(
  cashFlowAnnualPayload: ReturnType<typeof buildFinanceCashFlowDashboard>
): FinanceCashFlowExecutiveMonthlyRow[] {
  return cashFlowAnnualPayload.executiveSummary.monthlyTimeline;
}

export function buildExecutiveReportCashFlowAnnualChart(
  cashFlowAnnualPayload: ReturnType<typeof buildFinanceCashFlowDashboard>,
  year: number,
  highlightMonth: number
) {
  const built = buildExecutiveCashFlowAnnualChart(
    cashFlowAnnualPayload.executiveSummary.monthlyTimeline,
    year,
    highlightMonth
  );
  return {
    year,
    highlightMonth,
    points: built.rows,
    hasData: built.hasData,
  };
}

export function sliceExecutiveReportTopN<T>(rows: T[], topN?: number): T[] {
  if (topN == null || topN <= 0) return rows;
  return rows.slice(0, topN);
}

async function loadApRows(
  db: Pick<PrismaClient, "nomusAccountsPayable">,
  filters: FinanceApDashboardFilters
) {
  const syncCutoff = await resolveNomusApReportSyncCutoffFromPrisma(db);
  const where = buildFinanceApPrismaWhere(filters, syncCutoff);
  const rows = await db.nomusAccountsPayable.findMany({
    where,
    select: FINANCE_AP_TITLE_SELECT,
    orderBy: { dueDate: "asc" },
  });
  return { rows: rows.map(mapPrismaRowToFinanceApDashboardRow), syncCutoff };
}

async function loadCashFlowRows(
  db: PrismaClient,
  filters: FinanceCashFlowDashboardFilters,
  referenceDate: Date
) {
  const arFilters = toArLoadFilters(filters);
  const apFilters = toApLoadFilters(filters);
  const [{ rows: arManagementRows, syncCutoff: arSyncCutoff }, apSyncCutoff] =
    await Promise.all([
      loadFinanceArManagementRowsFromPrisma(db, arFilters, referenceDate),
      resolveNomusApReportSyncCutoffFromPrisma(db),
    ]);
  const apWhere = buildCashFlowApPrismaWhere(filters, apFilters, referenceDate, apSyncCutoff);
  const apPrisma = await db.nomusAccountsPayable.findMany({
    where: apWhere,
    select: FINANCE_CASH_FLOW_AP_SELECT,
    orderBy: { dueDate: "asc" },
  });

  const arRows = arManagementRows as import("./financeCashFlowDashboard.js").FinanceCashFlowArRow[];
  const { orderContexts, nfeOrderLinks } = await enrichFinanceCashFlowArLoadBundle(
    db,
    arRows,
    referenceDate,
    {
      customerName: filters.customerName,
      personCnpj: filters.personCnpj,
    }
  );

  return {
    arRows,
    apRows: apPrisma.map(mapPrismaRowToFinanceCashFlowApRow),
    arSyncCutoff,
    apSyncCutoff,
    orderContexts,
    nfeOrderLinks,
  };
}

export function buildFinanceExecutiveReportDataQuality(input: {
  warnings: string[];
  unavailableSections: string[];
  sanitization: ReturnType<typeof mergeFinanceDataSanitization>;
  sync: FinanceExecutiveReportDataQuality["sync"];
  arStaleExcluded: boolean;
  apStaleExcluded: boolean;
  billingTargetMissing: boolean;
}): FinanceExecutiveReportDataQuality {
  const warnings = [...input.warnings];
  if (input.billingTargetMissing) {
    warnings.push(
      "Metas de faturamento derivadas (+30% sobre período anterior); não há cadastro editável de metas."
    );
  }
  if (input.arStaleExcluded) {
    warnings.push("Base AR exclui títulos stale Nomus (freshness via syncCutoff).");
  }
  if (input.apStaleExcluded) {
    warnings.push("Base AP exclui títulos stale Nomus (freshness via syncCutoff).");
  }
  if (!input.sync.accountsReceivableLastSyncAt) {
    warnings.push("Última sync de Contas a Receber indisponível.");
  }
  if (!input.sync.accountsPayableLastSyncAt) {
    warnings.push("Última sync de Contas a Pagar indisponível.");
  }
  if (!input.sync.nfeLastSyncAt) {
    warnings.push("Última sync de NF-e indisponível.");
  }

  return {
    sanitization: input.sanitization,
    warnings,
    unavailableSections: input.unavailableSections,
    targetsDerived: true,
    sync: input.sync,
    freshness: {
      arStaleExcluded: input.arStaleExcluded,
      apStaleExcluded: input.apStaleExcluded,
    },
  };
}

export type ExecutiveReportOfficialPayloads = {
  filters: FinanceExecutiveReportFilters;
  referenceDate: Date;
  arPayload: OfficialAccountsReceivableDashboardPayload;
  apPayload: OfficialAccountsPayableDashboardPayload;
  cashFlowPayload: ReturnType<typeof buildFinanceCashFlowDashboard>;
  cashFlowAnnualPayload: ReturnType<typeof buildFinanceCashFlowDashboard>;
  billingTab: Awaited<ReturnType<typeof buildFinanceBillingDashboard>>["tab"] | null;
  salesOrdersTab: Awaited<ReturnType<typeof buildSalesOrdersDashboardTab>> | null;
};

/** Monta seções do relatório a partir dos payloads oficiais — usado em auditoria de paridade. */
export function buildExecutiveReportModuleSections(input: ExecutiveReportOfficialPayloads) {
  const { filters, arPayload, apPayload, cashFlowPayload, cashFlowAnnualPayload, billingTab, salesOrdersTab } =
    input;
  const topN = filters.topN;

  const executiveSummary = {
    headlineMetrics: [
      {
        id: "billing-month",
        label: "Faturamento do mês",
        value: billingTab?.target.actual ?? null,
        formatted: formatExecutiveReportCurrency(billingTab?.target.actual ?? null),
        source: "billing" as const,
      },
      {
        id: "ar-open",
        label: "AR em aberto",
        value: arPayload.cards.totalOpenAmount,
        formatted: formatExecutiveReportCurrency(arPayload.cards.totalOpenAmount),
        source: "accountsReceivable" as const,
      },
      {
        id: "ap-open",
        label: "AP em aberto",
        value: apPayload.cards.totalOpenAmount,
        formatted: formatExecutiveReportCurrency(apPayload.cards.totalOpenAmount),
        source: "accountsPayable" as const,
      },
      {
        id: "cash-net",
        label: "Fluxo líquido (período)",
        value: cashFlowPayload.cards.netFlowAmount,
        formatted: formatExecutiveReportCurrency(cashFlowPayload.cards.netFlowAmount),
        source: "cashFlow" as const,
      },
    ],
    highlights: cashFlowPayload.executiveReading.slice(0, 3),
  };

  return {
    executiveSummary,
    accountsReceivable: {
      payload: {
        cards: arPayload.cards,
        agingBuckets: arPayload.agingBuckets,
        topDebtors: sliceExecutiveReportTopN(arPayload.topDebtors, topN),
        monthlyDueSchedule: arPayload.monthlyDueSchedule,
        scheduleBuckets: arPayload.scheduleBuckets,
        criticalTitles: sliceExecutiveReportTopN(arPayload.criticalTitles, topN),
        dataSanitization: mergeFinanceDataSanitization(arPayload.dataSanitization),
        financialHorizon: arPayload.financialHorizon,
      },
    },
    accountsPayable: {
      payload: {
        cards: apPayload.cards,
        agingBuckets: apPayload.agingBuckets,
        topSuppliers: sliceExecutiveReportTopN(apPayload.topSuppliers, topN),
        monthlyDueSchedule: apPayload.monthlyDueSchedule,
        criticalTitles: sliceExecutiveReportTopN(apPayload.criticalTitles, topN),
        dataSanitization: mergeFinanceDataSanitization(apPayload.dataSanitization),
        financialHorizon: apPayload.financialHorizon,
        purchaseOrderScheduleAudit: apPayload.purchaseOrderScheduleAudit,
      },
    },
    cashFlow: {
      payload: {
        cards: cashFlowPayload.cards,
        executiveSummary: cashFlowPayload.executiveSummary,
        executiveYtd: cashFlowPayload.executiveYtd,
        monthlySeries: cashFlowPayload.monthlySeries,
        cashForecast: cashFlowPayload.cashForecast,
        dataSanitization: cashFlowPayload.dataSanitization,
        reconciliation: cashFlowPayload.reconciliation,
        executiveReading: cashFlowPayload.executiveReading,
      },
    },
    calendarAgenda: {
      calendar: cashFlowPayload.calendar,
      executiveSummary: {
        monthlyTimeline: resolveExecutiveReportCashFlowMonthlyTimeline(cashFlowAnnualPayload),
        period: cashFlowPayload.executiveSummary.period,
        net: cashFlowPayload.executiveSummary.net,
      },
    },
    billingComparison: billingTab
      ? {
          tab: {
            summaryCards: billingTab.summaryCards,
            target: billingTab.target,
            yearComparison: billingTab.yearComparison,
            monthlySeries: billingTab.monthlySeries,
            chartSeries: billingTab.chartSeries,
            multiYearMonthly: billingTab.multiYearMonthly,
            multiYearSummary: billingTab.multiYearSummary,
            cumulativeBilling: billingTab.cumulativeBilling,
          },
        }
      : null,
    salesOrders: salesOrdersTab
      ? {
          tab: {
            summaryCards: salesOrdersTab.summaryCards,
            targets: salesOrdersTab.targets,
            target: salesOrdersTab.target,
            projection: salesOrdersTab.projection,
            monthlySeries: salesOrdersTab.monthlySeries,
            chartSeries: salesOrdersTab.chartSeries,
            accumulatedEvolution: salesOrdersTab.accumulatedEvolution,
            statusBreakdown: salesOrdersTab.statusBreakdown,
            overdueOrders: salesOrdersTab.overdueOrders,
            periodLabel: salesOrdersTab.periodLabel,
          },
        }
      : null,
  };
}

export function buildExecutiveReportCostCenterSpendingFilters(
  filters: FinanceExecutiveReportFilters
): ReturnType<typeof buildExecutiveReportCostCenterDashboardFilters> {
  return buildExecutiveReportCostCenterDashboardFilters({
    year: filters.year,
    month: filters.month,
    companyName: mapExecutiveReportCompanyToFilter(
      (filters.company as FinanceExecutiveReportCompany | undefined) ?? "all"
    ),
  });
}

export async function loadExecutiveReportCostCenterSpending(
  filters: FinanceExecutiveReportFilters,
  referenceDate: Date
): Promise<{
  topCards: FinanceExecutiveReportCostCenterTopCard[];
  summary: FinanceExecutiveReportCostCenterTopCardsSummary;
  totals: import("./financeCostCenterExpenseMap.js").CostCenterExpenseMapAggregateTotals;
}> {
  const ccFilters = buildExecutiveReportCostCenterSpendingFilters(filters);
  const dashboard = await buildFinanceCostCenterDashboardDefault(ccFilters, referenceDate);
  const { items: centers } = await listFinancialCostCentersDefault();
  return buildExecutiveReportCostCenterTopCards(dashboard.byCostCenter, centers, {
    limit: EXECUTIVE_REPORT_COST_CENTER_TOP_CARDS_LIMIT,
    classifiedTotal: dashboard.summary.totalAmount,
  });
}

export async function buildFinanceExecutiveReport(
  query: Record<string, unknown>,
  db: Pick<PrismaClient, "nomusAccountsReceivable" | "nomusAccountsPayable"> = defaultPrisma
): Promise<FinanceExecutiveReport> {
  const filters = parseFinanceExecutiveReportQuery(query);
  const referenceDate = resolveExecutiveReportReferenceDate(filters);
  const yearCtx = resolveExecutiveDashboardYearContext(filters.year, referenceDate);
  const highlightMonth = resolveExecutiveReportHighlightMonth(filters.month, referenceDate);
  const arPortfolioFilters = buildExecutiveReportArPortfolioFilters(filters);
  const apPortfolioFilters = buildExecutiveReportApPortfolioFilters(filters);
  const cashFlowFilters = buildExecutiveReportCashFlowFilters(filters);
  const cashFlowAnnualFilters = buildExecutiveReportCashFlowAnnualFilters(filters);
  const topN = filters.topN;
  const unavailableSections: string[] = [];
  const warnings: string[] = [];
  const companyIssuer = mapExecutiveReportCompanyToFilter(
    (filters.company as FinanceExecutiveReportCompany | undefined) ?? "all"
  );

  const [
    arLoad,
    apLoad,
    arHorizonLoad,
    cashFlowLoad,
    cashFlowAnnualLoad,
    annualPortfolioLoad,
    billingPayload,
    salesOrdersTab,
    arSyncStatus,
    apSyncStatus,
    nfeSyncStatus,
    dailyRadarPortfolio,
  ] = await Promise.all([
    loadFinanceArManagementRowsFromPrisma(db, arPortfolioFilters, referenceDate),
    loadApRows(db, apPortfolioFilters),
    loadFinanceArOpenHorizonRowsFromPrisma(db, referenceDate),
    loadCashFlowRows(db, cashFlowFilters, referenceDate),
    loadCashFlowRows(db, cashFlowAnnualFilters, referenceDate),
    loadAnnualComparisonPortfolioRows(db, referenceDate, cashFlowFilters),
    buildFinanceBillingDashboard(
      {
        year: String(filters.year),
        billingSource: "nfe",
        dateBase: "processamento",
        company: filters.company ?? "all",
      },
      referenceDate
    ).catch((e) => {
      console.error("executive-report billing", e);
      unavailableSections.push("billing");
      return null;
    }),
    buildSalesOrdersDashboardTab(yearCtx, {
      companyIssuer,
      month: highlightMonth,
      excludeGroupCompanyCustomers: true,
    }).catch((e) => {
      console.error("executive-report salesOrders", e);
      unavailableSections.push("salesOrders");
      return null;
    }),
    getNomusAccountsReceivableSyncStatus().catch(() => null),
    getNomusAccountsPayableSyncStatus().catch(() => null),
    getNomusNfesSyncStatus().catch(() => null),
    loadExecutiveReportDailyRadarPortfolioRows(filters, referenceDate, db),
  ]);

  const arPayload = buildOfficialAccountsReceivableDashboard({
    rows: arLoad.rows,
    filters: arPortfolioFilters,
    referenceDate,
    syncCutoff: arLoad.syncCutoff,
    horizonSourceRows: arHorizonLoad.rows,
    year: filters.year,
    month: highlightMonth,
  });
  const apPayload = buildOfficialAccountsPayableDashboard({
    rows: apLoad.rows,
    filters: apPortfolioFilters,
    referenceDate,
    syncCutoff: apLoad.syncCutoff,
    year: filters.year,
    month: highlightMonth,
  });
  const receivablesSection = buildExecutiveReportReceivablesSection({
    rows: arLoad.rows,
    filters: arPortfolioFilters,
    referenceDate,
    syncCutoff: arLoad.syncCutoff,
    year: filters.year,
    month: highlightMonth,
  });
  const payablesSection = buildExecutiveReportPayablesSection({
    rows: apLoad.rows,
    filters: apPortfolioFilters,
    referenceDate,
    syncCutoff: apLoad.syncCutoff,
    year: filters.year,
    month: highlightMonth,
  });
  const cashFlowPayload = buildFinanceCashFlowDashboard(
    cashFlowLoad.arRows,
    cashFlowLoad.apRows,
    cashFlowFilters,
    referenceDate,
    cashFlowLoad.arSyncCutoff,
    cashFlowLoad.apSyncCutoff,
    {
      orderContexts: cashFlowLoad.orderContexts,
      nfeOrderLinks: cashFlowLoad.nfeOrderLinks,
    }
  );
  const cashFlowAnnualPayload = buildFinanceCashFlowDashboard(
    cashFlowAnnualLoad.arRows,
    cashFlowAnnualLoad.apRows,
    cashFlowAnnualFilters,
    referenceDate,
    cashFlowAnnualLoad.arSyncCutoff,
    cashFlowAnnualLoad.apSyncCutoff,
    {
      orderContexts: cashFlowAnnualLoad.orderContexts,
      nfeOrderLinks: cashFlowAnnualLoad.nfeOrderLinks,
    }
  );
  const highlightMonthForChart = highlightMonth;
  const cashFlowAnnualChart = buildExecutiveReportCashFlowAnnualChart(
    cashFlowAnnualPayload,
    filters.year,
    highlightMonthForChart
  );

  const annualComparisonCurrent = buildCashFlowAnnualComparison(
    annualPortfolioLoad.arRows,
    annualPortfolioLoad.apRows,
    filters.year,
    referenceDate,
    annualPortfolioLoad.arSyncCutoff,
    annualPortfolioLoad.apSyncCutoff,
    {
      orderContexts: annualPortfolioLoad.orderContexts,
      nfeOrderLinks: annualPortfolioLoad.nfeOrderLinks,
    }
  );
  const annualComparisonPrevious = buildCashFlowAnnualComparison(
    annualPortfolioLoad.arRows,
    annualPortfolioLoad.apRows,
    filters.year - 1,
    referenceDate,
    annualPortfolioLoad.arSyncCutoff,
    annualPortfolioLoad.apSyncCutoff,
    {
      orderContexts: annualPortfolioLoad.orderContexts,
      nfeOrderLinks: annualPortfolioLoad.nfeOrderLinks,
    }
  );

  let costCenterSpending: FinanceExecutiveReport["costCenterSpending"];
  try {
    const loaded = await loadExecutiveReportCostCenterSpending(filters, referenceDate);
    costCenterSpending = {
      source: FINANCE_EXECUTIVE_REPORT_OFFICIAL_SOURCES.costCenterDashboard,
      topCards: loaded.topCards,
      summary: loaded.summary,
      totals: loaded.totals,
    };
  } catch (error) {
    console.error("executive-report costCenterSpending", error);
    unavailableSections.push("costCenterSpending");
    const empty = buildEmptyExecutiveReportCostCenterTopCards();
    costCenterSpending = {
      source: FINANCE_EXECUTIVE_REPORT_OFFICIAL_SOURCES.costCenterDashboard,
      topCards: empty.topCards,
      summary: empty.summary,
      totals: empty.totals,
    };
    warnings.push("Centros de custo indisponíveis nesta geração.");
  }

  const billingTab = billingPayload?.tab ?? null;
  const billingTargetMissing =
    billingTab?.target.target == null || billingTab.target.achievementPercent == null;

  const syncInfo: FinanceExecutiveReportDataQuality["sync"] = {
    accountsReceivableLastSyncAt:
      arSyncStatus?.finishedAt ??
      arSyncStatus?.lastSuccess?.finishedAt ??
      arPayload.cards.lastSyncAt,
    accountsPayableLastSyncAt:
      apSyncStatus?.finishedAt ??
      apSyncStatus?.lastSuccess?.finishedAt ??
      apPayload.cards.lastSyncAt,
    nfeLastSyncAt:
      nfeSyncStatus?.lastSuccess?.finishedAt ?? nfeSyncStatus?.lastRun?.finishedAt ?? null,
    salesOrdersLastSyncAt: null,
  };

  const sanitization = mergeFinanceDataSanitization(
    arPayload.dataSanitization,
    apPayload.dataSanitization,
    cashFlowPayload.dataSanitization
  );

  const dataQuality = buildFinanceExecutiveReportDataQuality({
    warnings,
    unavailableSections,
    sanitization,
    sync: syncInfo,
    arStaleExcluded: arLoad.syncCutoff != null,
    apStaleExcluded: apLoad.syncCutoff != null,
    billingTargetMissing,
  });

  const periodLabel =
    filters.month != null
      ? `${String(filters.month).padStart(2, "0")}/${filters.year}`
      : String(filters.year);

  const cover = {
    title: EXECUTIVE_REPORT_DOCUMENT_TITLE,
    subtitle:
      "Visão consolidada de vendas, faturamento, recebíveis, pagamentos e fluxo de caixa",
    reportDateLabel: formatExecutiveReportCoverDate(referenceDate),
    periodLabel,
    companyLabel:
      filters.company && filters.company !== "all"
        ? String(filters.company).toUpperCase()
        : "Consolidado",
  };

  const executiveSummary = {
    headlineMetrics: [
      {
        id: "billing-month",
        label: "Faturamento do mês",
        value: billingTab?.target.actual ?? null,
        formatted: formatExecutiveReportCurrency(billingTab?.target.actual ?? null),
        source: "billing" as const,
      },
      {
        id: "ar-open",
        label: "AR em aberto",
        value: arPayload.cards.totalOpenAmount,
        formatted: formatExecutiveReportCurrency(arPayload.cards.totalOpenAmount),
        source: "accountsReceivable" as const,
      },
      {
        id: "ap-open",
        label: "AP em aberto",
        value: apPayload.cards.totalOpenAmount,
        formatted: formatExecutiveReportCurrency(apPayload.cards.totalOpenAmount),
        source: "accountsPayable" as const,
      },
      {
        id: "cash-net",
        label: "Fluxo líquido (período)",
        value: cashFlowPayload.cards.netFlowAmount,
        formatted: formatExecutiveReportCurrency(cashFlowPayload.cards.netFlowAmount),
        source: "cashFlow" as const,
      },
    ],
    highlights: cashFlowPayload.executiveReading.slice(0, 3),
  };

  const narrative = buildFinanceExecutiveReportNarrative({
    billingTab,
    arCards: arPayload.cards,
    apCards: apPayload.cards,
    cashFlow: cashFlowPayload,
    salesOrdersTab,
  });

  const cashRadar = buildExecutiveReportCashRadarBlock({
    arRows: dailyRadarPortfolio.arRows,
    apRows: dailyRadarPortfolio.apRows,
    filters,
    referenceDate,
    arSyncCutoff: dailyRadarPortfolio.arSyncCutoff,
    apSyncCutoff: dailyRadarPortfolio.apSyncCutoff,
    dashboardFilters: dailyRadarPortfolio.dashboardFilters,
    orderContexts: dailyRadarPortfolio.orderContexts,
    nfeOrderLinks: dailyRadarPortfolio.nfeOrderLinks,
    exportAll: true,
  });

  return {
    generatedAt: new Date().toISOString(),
    asOfDate: filters.asOfDate,
    year: filters.year,
    month: filters.month ?? null,
    company: filters.company ?? null,
    filters,
    mode: filters.mode,
    dataSources: FINANCE_EXECUTIVE_REPORT_OFFICIAL_SOURCES,
    dataQuality,
    knownGaps: FINANCE_EXECUTIVE_REPORT_KNOWN_GAPS,
    cover,
    executiveSummary,
    billingComparison: billingPayload
      ? {
          source: FINANCE_EXECUTIVE_REPORT_OFFICIAL_SOURCES.billing,
          payload: {
            selectedYear: billingPayload.selectedYear,
            previousYear: billingPayload.previousYear,
            currentMonth: billingPayload.currentMonth,
            billingSource: billingPayload.billingSource,
            periodLabel: billingPayload.periodLabel,
          },
          tab: {
            summaryCards: billingTab!.summaryCards,
            target: billingTab!.target,
            yearComparison: billingTab!.yearComparison,
            monthlySeries: billingTab!.monthlySeries,
            chartSeries: billingTab!.chartSeries,
            multiYearMonthly: billingTab!.multiYearMonthly,
            multiYearSummary: billingTab!.multiYearSummary,
            cumulativeBilling: billingTab!.cumulativeBilling,
          },
        }
      : {
          source: FINANCE_EXECUTIVE_REPORT_OFFICIAL_SOURCES.billing,
          payload: {
            selectedYear: filters.year,
            previousYear: filters.year - 1,
            currentMonth: filters.month ?? referenceDate.getMonth() + 1,
            billingSource: "nfe",
            periodLabel,
          },
          tab: {
            summaryCards: [],
            target: billingTab?.target ?? {
              actual: null,
              previousPeriod: null,
              target: null,
              gap: null,
              achievementPercent: null,
              formatted: {
                actual: "—",
                previousPeriod: "—",
                target: "—",
                gap: "—",
                achievementPercent: "—",
              },
            },
            yearComparison: billingTab?.yearComparison ?? {
              yearToDateCurrent: null,
              yearToDatePrevious: null,
              previousYearTotal: null,
              annualTarget: null,
              formatted: {
                yearToDateCurrent: "—",
                yearToDatePrevious: "—",
                previousYearTotal: "—",
                annualTarget: "—",
              },
            },
            monthlySeries: [],
            chartSeries: billingTab?.chartSeries ?? {
              kind: "billing",
              selectedYear: filters.year,
              previousYear: filters.year - 1,
              ytdMonthLimit: 12,
              targetAsLine: true,
              labels: {
                previousYearBar: "",
                currentYearBar: "",
                targetLine: "",
              },
              colors: {
                previousYearBar: "",
                currentYearBar: "",
                targetLine: "",
              },
            },
            multiYearMonthly: [],
            multiYearSummary: [],
            cumulativeBilling: [],
          },
        },
    billingProjection: {
      source: FINANCE_EXECUTIVE_REPORT_OFFICIAL_SOURCES.billing,
      tab: {
        projection: billingTab?.projection ?? {
          dailyAverage: null,
          projectedMonth: null,
          projectedYear: null,
          workdaysElapsed: 0,
          workdaysInMonth: 0,
          workdaysInYear: 0,
          ytdDailyAverageHint: "",
          formatted: { dailyAverage: "—", projectedMonth: "—", projectedYear: "—" },
        },
        realizedVsProjected: billingTab?.realizedVsProjected ?? {
          realized: null,
          projected: null,
          target: null,
          formatted: { realized: "—", projected: "—", target: "—" },
        },
        accumulatedEvolution: billingTab?.accumulatedEvolution ?? [],
        forecast: billingTab?.forecast ?? {
          portfolioAmount: null,
          monthForecastAmount: null,
          overdueAmount: null,
          monthlyComparison: [],
          dailySeries: [],
          orders: [],
          financialHorizon: { buckets: [], total: { label: "", amount: 0, count: 0 } },
        },
      },
    },
    accountsReceivable: {
      source: FINANCE_EXECUTIVE_REPORT_OFFICIAL_SOURCES.accountsReceivable,
      metricsSource: receivablesSection.metricsSource,
      kpis: receivablesSection.kpis,
      payload: {
        cards: arPayload.cards,
        agingBuckets: arPayload.agingBuckets,
        topDebtors: sliceExecutiveReportTopN(arPayload.topDebtors, topN),
        monthlyDueSchedule: arPayload.monthlyDueSchedule,
        scheduleBuckets: arPayload.scheduleBuckets,
        criticalTitles: sliceExecutiveReportTopN(arPayload.criticalTitles, topN),
        dataSanitization: mergeFinanceDataSanitization(arPayload.dataSanitization),
        financialHorizon: arPayload.financialHorizon,
      },
    },
    accountsPayable: {
      source: FINANCE_EXECUTIVE_REPORT_OFFICIAL_SOURCES.accountsPayable,
      metricsSource: payablesSection.metricsSource,
      kpis: payablesSection.kpis,
      payload: {
        cards: apPayload.cards,
        agingBuckets: apPayload.agingBuckets,
        topSuppliers: sliceExecutiveReportTopN(apPayload.topSuppliers, topN),
        monthlyDueSchedule: apPayload.monthlyDueSchedule,
        criticalTitles: sliceExecutiveReportTopN(apPayload.criticalTitles, topN),
        dataSanitization: mergeFinanceDataSanitization(apPayload.dataSanitization),
        financialHorizon: apPayload.financialHorizon,
        purchaseOrderScheduleAudit: apPayload.purchaseOrderScheduleAudit,
      },
    },
    cashFlow: {
      source: FINANCE_EXECUTIVE_REPORT_OFFICIAL_SOURCES.cashFlow,
      payload: {
        cards: cashFlowPayload.cards,
        executiveSummary: cashFlowPayload.executiveSummary,
        executiveYtd: cashFlowPayload.executiveYtd,
        monthlySeries: cashFlowPayload.monthlySeries,
        cashForecast: cashFlowPayload.cashForecast,
        dataSanitization: cashFlowPayload.dataSanitization,
        reconciliation: cashFlowPayload.reconciliation,
        executiveReading: cashFlowPayload.executiveReading,
      },
    },
    calendarAgenda: {
      source: FINANCE_EXECUTIVE_REPORT_OFFICIAL_SOURCES.cashFlowCalendar,
      calendar: cashFlowPayload.calendar,
      executiveSummary: {
        monthlyTimeline: resolveExecutiveReportCashFlowMonthlyTimeline(cashFlowAnnualPayload),
        period: cashFlowPayload.executiveSummary.period,
        net: cashFlowPayload.executiveSummary.net,
      },
      annualChart: cashFlowAnnualChart,
    },
    annualComparison: {
      source: FINANCE_EXECUTIVE_REPORT_OFFICIAL_SOURCES.cashFlow,
      currentYear: annualComparisonCurrent,
      previousYear: annualComparisonPrevious,
    },
    salesOrders: {
      source: FINANCE_EXECUTIVE_REPORT_OFFICIAL_SOURCES.salesOrders,
      tab: salesOrdersTab
        ? {
            summaryCards: salesOrdersTab.summaryCards,
            targets: salesOrdersTab.targets,
            target: salesOrdersTab.target,
            projection: salesOrdersTab.projection,
            monthlySeries: salesOrdersTab.monthlySeries,
            chartSeries: salesOrdersTab.chartSeries,
            accumulatedEvolution: salesOrdersTab.accumulatedEvolution,
            statusBreakdown: salesOrdersTab.statusBreakdown,
            overdueOrders: salesOrdersTab.overdueOrders,
            periodLabel: salesOrdersTab.periodLabel,
          }
        : {
            summaryCards: [],
            targets: salesOrdersTab?.targets ?? ({} as never),
            target: salesOrdersTab?.target ?? ({} as never),
            projection: salesOrdersTab?.projection ?? ({} as never),
            monthlySeries: [],
            chartSeries: salesOrdersTab?.chartSeries ?? ({} as never),
            accumulatedEvolution: [],
            statusBreakdown: [],
            overdueOrders: {
              count: 0,
              totalValue: null,
              formattedTotalValue: "—",
              description: "",
              selectedYear: filters.year,
              items: [],
            },
            periodLabel: periodLabel,
          },
    },
    costCenterSpending,
    cashRadar,
    executiveNarrative: narrative,
  };
}
