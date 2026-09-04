import type { PrismaClient } from "@prisma/client";
import { buildFinanceBillingDashboard } from "./financeBillingDashboard.js";
import {
  type OfficialAccountsReceivableDashboardPayload,
} from "./financeAccountsReceivableRulesAdapter.js";
import {
  type FinanceArDashboardFilters,
} from "./financeAccountsReceivableDashboard.js";
import { createEmptyAccountsReceivableOpenHorizon } from "./financeAccountsReceivableHorizon.js";
import {
  type OfficialAccountsPayableDashboardPayload,
} from "./financeAccountsPayableRulesAdapter.js";
import {
  type FinanceApDashboardFilters,
} from "./financeAccountsPayableDashboard.js";
import {
  buildFinanceCashFlowDashboard,
  type FinanceCashFlowDashboardFilters,
} from "./financeCashFlowDashboard.js";
import type { FinanceCashFlowExecutiveMonthlyRow } from "./financeCashFlowExecutiveSummary.js";
import { mergeFinanceDataSanitization } from "./financeInternalGroupExclusions.js";
import { parseFinanceManagementScope } from "./financeInternalGroupExclusions.js";
import { resolveExecutiveDashboardYearContext } from "./executiveDashboardYear.js";
import { buildSalesOrdersDashboardTab } from "./salesOrdersDashboardMetrics.js";
import {
  buildExecutiveReportCashRadarBlock,
  buildExecutiveReportDailyRadarCashFlowFilters,
} from "./financeExecutiveReportCashRadar.js";
import { formatExecutiveReportCurrency } from "./financeExecutiveReportUtils.js";
import {
  EXECUTIVE_REPORT_DOCUMENT_TITLE,
  formatExecutiveReportCoverDate,
} from "./financeExecutiveReportUtils.js";
import { buildFinanceExecutiveReportNarrative } from "./financeExecutiveReportNarrative.js";
import { buildExecutiveCashFlowAnnualChart } from "./financeExecutiveReportPresentation.js";
import { buildCashFlowAnnualComparison } from "./financeCashFlowAnnualComparison.js";
import {
  buildExecutiveReportPayablesSection,
  buildExecutiveReportReceivablesSection,
  resolveExecutiveReportHighlightMonth,
} from "./financeExecutiveReportDataSources.js";
import {
  loadExecutiveReportAllYearsBundle,
  loadExecutiveReportYearScopedBundle,
  resolveExecutiveReportSharedCutoffs,
  sliceCashFlowRowsToDuePeriod,
} from "./financeExecutiveReportLoad.server.js";
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
import { createEmptyFinanceHorizonSummary } from "./financeHorizonAggregation.js";
import { FINANCE_HORIZON_AP_SCOPE_NOTE } from "./financeHorizonAggregation.js";

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

/**
 * Gráfico anual planejado do Relatório Presidencial — alocação por vencimento.
 * Distinto de `resolveExecutiveReportCashFlowMonthlyTimeline` (realizado por movimento).
 */
export function buildExecutiveReportCashFlowAnnualChart(
  cashFlowAnnualPayload: ReturnType<typeof buildFinanceCashFlowDashboard>,
  year: number,
  highlightMonth: number
) {
  const built = buildExecutiveCashFlowAnnualChart(
    cashFlowAnnualPayload.executiveSummary.plannedMonthlyTimeline,
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
      "Metas de faturamento derivadas (+20% sobre período anterior); não há cadastro editável de metas."
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
  db: PrismaClient = defaultPrisma
): Promise<FinanceExecutiveReport> {
  const filters = parseFinanceExecutiveReportQuery(query);
  const referenceDate = resolveExecutiveReportReferenceDate(filters);
  const yearCtx = resolveExecutiveDashboardYearContext(filters.year, referenceDate);
  const highlightMonth = resolveExecutiveReportHighlightMonth(filters.month, referenceDate);
  const arPortfolioFilters = buildExecutiveReportArPortfolioFilters(filters);
  const apPortfolioFilters = buildExecutiveReportApPortfolioFilters(filters);
  const cashFlowFilters = buildExecutiveReportCashFlowFilters(filters);
  const cashFlowAnnualFilters = buildExecutiveReportCashFlowAnnualFilters(filters);
  const unavailableSections: string[] = [];
  const warnings: string[] = [];
  const companyIssuer = mapExecutiveReportCompanyToFilter(
    (filters.company as FinanceExecutiveReportCompany | undefined) ?? "all"
  );
  const periodEqualsAnnual = filters.month == null;

  const [
    portfolios,
    billingPayload,
    salesOrdersTab,
    arSyncStatus,
    apSyncStatus,
    nfeSyncStatus,
    costCenterLoaded,
  ] = await Promise.all([
    resolveExecutiveReportSharedCutoffs(db).then(async (shared) => {
      const [yearScoped, allYears] = await Promise.all([
        loadExecutiveReportYearScopedBundle(db, {
          arPortfolioFilters,
          cashFlowAnnualFilters,
          referenceDate,
          shared,
        }),
        loadExecutiveReportAllYearsBundle(db, cashFlowFilters, referenceDate, shared),
      ]);
      return { yearScoped, allYears };
    }),
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
    loadExecutiveReportCostCenterSpending(filters, referenceDate).catch((error) => {
      console.error("executive-report costCenterSpending", error);
      unavailableSections.push("costCenterSpending");
      warnings.push("Centros de custo indisponíveis nesta geração.");
      return null;
    }),
  ]);

  const { yearScoped, allYears } = portfolios;

  const receivablesSection = buildExecutiveReportReceivablesSection({
    rows: yearScoped.arDashboardRows,
    filters: arPortfolioFilters,
    referenceDate,
    syncCutoff: yearScoped.arSyncCutoff,
    year: filters.year,
    month: highlightMonth,
  });
  const payablesSection = buildExecutiveReportPayablesSection({
    rows: yearScoped.apDashboardRows,
    filters: apPortfolioFilters,
    referenceDate,
    syncCutoff: yearScoped.apSyncCutoff,
    year: filters.year,
    month: highlightMonth,
  });

  const cashFlowAnnualPayload = buildFinanceCashFlowDashboard(
    yearScoped.arRows,
    yearScoped.apRows,
    cashFlowAnnualFilters,
    referenceDate,
    yearScoped.arSyncCutoff,
    yearScoped.apSyncCutoff,
    {
      orderContexts: yearScoped.orderContexts,
      nfeOrderLinks: yearScoped.nfeOrderLinks,
    }
  );
  const cashFlowPayload = periodEqualsAnnual
    ? cashFlowAnnualPayload
    : (() => {
        const periodRows = sliceCashFlowRowsToDuePeriod(
          yearScoped.arRows,
          yearScoped.apRows,
          cashFlowFilters
        );
        return buildFinanceCashFlowDashboard(
          periodRows.arRows,
          periodRows.apRows,
          cashFlowFilters,
          referenceDate,
          yearScoped.arSyncCutoff,
          yearScoped.apSyncCutoff,
          {
            orderContexts: yearScoped.orderContexts,
            nfeOrderLinks: yearScoped.nfeOrderLinks,
          }
        );
      })();

  const cashFlowAnnualChart = buildExecutiveReportCashFlowAnnualChart(
    cashFlowAnnualPayload,
    filters.year,
    highlightMonth
  );

  const annualComparisonCurrent = buildCashFlowAnnualComparison(
    allYears.arRows,
    allYears.apRows,
    filters.year,
    referenceDate,
    allYears.arSyncCutoff,
    allYears.apSyncCutoff,
    {
      orderContexts: allYears.orderContexts,
      nfeOrderLinks: allYears.nfeOrderLinks,
    }
  );
  const annualComparisonPrevious = buildCashFlowAnnualComparison(
    allYears.arRows,
    allYears.apRows,
    filters.year - 1,
    referenceDate,
    allYears.arSyncCutoff,
    allYears.apSyncCutoff,
    {
      orderContexts: allYears.orderContexts,
      nfeOrderLinks: allYears.nfeOrderLinks,
    }
  );

  let costCenterSpending: FinanceExecutiveReport["costCenterSpending"];
  if (costCenterLoaded) {
    costCenterSpending = {
      source: FINANCE_EXECUTIVE_REPORT_OFFICIAL_SOURCES.costCenterDashboard,
      topCards: costCenterLoaded.topCards,
      summary: costCenterLoaded.summary,
      totals: costCenterLoaded.totals,
    };
  } else {
    const empty = buildEmptyExecutiveReportCostCenterTopCards();
    costCenterSpending = {
      source: FINANCE_EXECUTIVE_REPORT_OFFICIAL_SOURCES.costCenterDashboard,
      topCards: empty.topCards,
      summary: empty.summary,
      totals: empty.totals,
    };
  }

  const billingTab = billingPayload?.tab ?? null;
  const billingTargetMissing =
    billingTab?.target.target == null || billingTab.target.achievementPercent == null;

  const syncInfo: FinanceExecutiveReportDataQuality["sync"] = {
    accountsReceivableLastSyncAt:
      arSyncStatus?.finishedAt ??
      arSyncStatus?.lastSuccess?.finishedAt ??
      receivablesSection.cards.lastSyncAt,
    accountsPayableLastSyncAt:
      apSyncStatus?.finishedAt ??
      apSyncStatus?.lastSuccess?.finishedAt ??
      payablesSection.cards.lastSyncAt,
    nfeLastSyncAt:
      nfeSyncStatus?.lastSuccess?.finishedAt ?? nfeSyncStatus?.lastRun?.finishedAt ?? null,
    salesOrdersLastSyncAt: null,
  };

  const sanitization = mergeFinanceDataSanitization(
    receivablesSection.dataSanitization,
    payablesSection.dataSanitization,
    cashFlowPayload.dataSanitization
  );

  const dataQuality = buildFinanceExecutiveReportDataQuality({
    warnings,
    unavailableSections,
    sanitization,
    sync: syncInfo,
    arStaleExcluded: yearScoped.arSyncCutoff != null,
    apStaleExcluded: yearScoped.apSyncCutoff != null,
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
        value: receivablesSection.cards.totalOpenAmount,
        formatted: formatExecutiveReportCurrency(receivablesSection.cards.totalOpenAmount),
        source: "accountsReceivable" as const,
      },
      {
        id: "ap-open",
        label: "AP em aberto",
        value: payablesSection.cards.totalOpenAmount,
        formatted: formatExecutiveReportCurrency(payablesSection.cards.totalOpenAmount),
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
    arCards: receivablesSection.cards,
    apCards: payablesSection.cards,
    cashFlow: cashFlowPayload,
    salesOrdersTab,
  });

  const cashRadar = buildExecutiveReportCashRadarBlock({
    arRows: allYears.arRows,
    apRows: allYears.apRows,
    filters,
    referenceDate,
    arSyncCutoff: allYears.arSyncCutoff,
    apSyncCutoff: allYears.apSyncCutoff,
    dashboardFilters: buildExecutiveReportDailyRadarCashFlowFilters(filters),
    orderContexts: allYears.orderContexts,
    nfeOrderLinks: allYears.nfeOrderLinks,
    exportAll: false,
  });

  const emptyArHorizon = createEmptyAccountsReceivableOpenHorizon(referenceDate);
  const emptyApHorizon = createEmptyFinanceHorizonSummary({
    title: "Horizonte financeiro — próximos 60 dias",
    subtitle: "Distribuição por janela operacional a partir de hoje. Valores não acumulativos.",
    scopeNote: FINANCE_HORIZON_AP_SCOPE_NOTE,
    countUnitLabel: "título(s)",
    ignoresPeriodFilter: Boolean(
      arPortfolioFilters.year != null || arPortfolioFilters.month != null
    ),
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
        cards: receivablesSection.cards,
        agingBuckets: [],
        topDebtors: [],
        monthlyDueSchedule: [],
        scheduleBuckets: [],
        criticalTitles: [],
        dataSanitization: mergeFinanceDataSanitization(receivablesSection.dataSanitization),
        financialHorizon: emptyArHorizon,
      },
    },
    accountsPayable: {
      source: FINANCE_EXECUTIVE_REPORT_OFFICIAL_SOURCES.accountsPayable,
      metricsSource: payablesSection.metricsSource,
      kpis: payablesSection.kpis,
      payload: {
        cards: payablesSection.cards,
        agingBuckets: [],
        topSuppliers: [],
        monthlyDueSchedule: [],
        criticalTitles: [],
        dataSanitization: mergeFinanceDataSanitization(payablesSection.dataSanitization),
        financialHorizon: emptyApHorizon,
        purchaseOrderScheduleAudit: payablesSection.purchaseOrderScheduleAudit,
      },
    },
    cashFlow: {
      source: FINANCE_EXECUTIVE_REPORT_OFFICIAL_SOURCES.cashFlow,
      payload: {
        cards: cashFlowPayload.cards,
        executiveSummary: cashFlowPayload.executiveSummary,
        executiveYtd: cashFlowPayload.executiveYtd,
        monthlySeries: [],
        cashForecast: cashFlowPayload.cashForecast,
        dataSanitization: cashFlowPayload.dataSanitization,
        reconciliation: cashFlowPayload.reconciliation,
        executiveReading: cashFlowPayload.executiveReading,
      },
    },
    calendarAgenda: {
      source: FINANCE_EXECUTIVE_REPORT_OFFICIAL_SOURCES.cashFlowCalendar,
      calendar: cashFlowAnnualPayload.calendar,
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
