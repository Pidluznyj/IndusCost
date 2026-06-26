/**
 * Auditoria de paridade entre Relatório Presidencial e módulos oficiais (AR/AP/Fluxo/Faturamento/Pedidos).
 */
import {
  buildOfficialAccountsReceivableDashboard,
  type OfficialAccountsReceivableDashboardPayload,
} from "./financeAccountsReceivableRulesAdapter.js";
import {
  type FinanceArDashboardFilters,
  type FinanceArDashboardRow,
} from "./financeAccountsReceivableDashboard.js";
import {
  buildFinanceAccountsReceivableOverdueRows,
} from "./financeAccountsReceivableOverdue.js";
import {
  buildOfficialAccountsPayableDashboard,
  type OfficialAccountsPayableDashboardPayload,
} from "./financeAccountsPayableRulesAdapter.js";
import {
  type FinanceApDashboardFilters,
  type FinanceApDashboardRow,
} from "./financeAccountsPayableDashboard.js";
import {
  isAccountsPayablePurchaseOrderSchedule,
} from "./financeAccountsPayableOperational.js";
import {
  buildFinanceCashFlowDashboard,
  type FinanceCashFlowApRow,
  type FinanceCashFlowArRow,
  type FinanceCashFlowDashboardFilters,
} from "./financeCashFlowDashboard.js";
import {
  auditFinanceArOverdueParityWithDashboard,
  auditFinanceArStaleExclusionAcrossViews,
} from "./financeDashboardConsistencyAudit.js";
import {
  buildExecutiveReportApFilters,
  buildExecutiveReportApPortfolioFilters,
  buildExecutiveReportArFilters,
  buildExecutiveReportArPortfolioFilters,
  buildExecutiveReportCashFlowFilters,
  buildExecutiveReportModuleSections,
  type ExecutiveReportOfficialPayloads,
} from "./financeExecutiveReport.js";
import type { BillingDashboardTab } from "./executiveDashboardTypes.js";
import type { NomusApReportSyncCutoff } from "./financeNomusApReportFreshness.js";
import type { NomusArReportSyncCutoff } from "./financeNomusArReportFreshness.js";

export type FinanceExecutiveReportConsistencyResult = {
  ok: boolean;
  mismatches: string[];
};

function compareMetric(
  mismatches: string[],
  label: string,
  reportValue: number | null | undefined,
  officialValue: number | null | undefined
) {
  if (reportValue !== officialValue) {
    mismatches.push(`${label}: report=${reportValue ?? "null"} official=${officialValue ?? "null"}`);
  }
}

function compareJsonSection(
  mismatches: string[],
  label: string,
  reportValue: unknown,
  officialValue: unknown
) {
  const a = JSON.stringify(reportValue);
  const b = JSON.stringify(officialValue);
  if (a !== b) {
    mismatches.push(`${label}: estrutura divergente`);
  }
}

export function auditExecutiveReportArParity(
  reportAr: ReturnType<typeof buildExecutiveReportModuleSections>["accountsReceivable"]["payload"],
  officialAr: OfficialAccountsReceivableDashboardPayload,
  topN?: number
): FinanceExecutiveReportConsistencyResult {
  const mismatches: string[] = [];
  compareMetric(mismatches, "AR totalOpenAmount", reportAr.cards.totalOpenAmount, officialAr.cards.totalOpenAmount);
  compareMetric(mismatches, "AR overdueAmount", reportAr.cards.overdueAmount, officialAr.cards.overdueAmount);
  compareMetric(mismatches, "AR totalRecords", reportAr.cards.totalRecords, officialAr.cards.totalRecords);
  compareMetric(
    mismatches,
    "AR settledTitlesCount",
    reportAr.cards.settledTitlesCount,
    officialAr.cards.settledTitlesCount
  );
  compareJsonSection(mismatches, "AR agingBuckets", reportAr.agingBuckets, officialAr.agingBuckets);
  compareJsonSection(
    mismatches,
    "AR monthlyDueSchedule",
    reportAr.monthlyDueSchedule,
    officialAr.monthlyDueSchedule
  );
  compareJsonSection(mismatches, "AR scheduleBuckets", reportAr.scheduleBuckets, officialAr.scheduleBuckets);
  compareJsonSection(mismatches, "AR financialHorizon", reportAr.financialHorizon, officialAr.financialHorizon);

  const expectedTop = topN != null && topN > 0 ? officialAr.topDebtors.slice(0, topN) : officialAr.topDebtors;
  compareJsonSection(mismatches, "AR topDebtors", reportAr.topDebtors, expectedTop);

  const expectedCritical =
    topN != null && topN > 0 ? officialAr.criticalTitles.slice(0, topN) : officialAr.criticalTitles;
  compareJsonSection(mismatches, "AR criticalTitles", reportAr.criticalTitles, expectedCritical);

  return { ok: mismatches.length === 0, mismatches };
}

export function auditExecutiveReportApParity(
  reportAp: ReturnType<typeof buildExecutiveReportModuleSections>["accountsPayable"]["payload"],
  officialAp: OfficialAccountsPayableDashboardPayload,
  topN?: number
): FinanceExecutiveReportConsistencyResult {
  const mismatches: string[] = [];
  compareMetric(mismatches, "AP totalOpenAmount", reportAp.cards.totalOpenAmount, officialAp.cards.totalOpenAmount);
  compareMetric(mismatches, "AP overdueAmount", reportAp.cards.overdueAmount, officialAp.cards.overdueAmount);
  compareMetric(mismatches, "AP totalRecords", reportAp.cards.totalRecords, officialAp.cards.totalRecords);
  compareJsonSection(mismatches, "AP agingBuckets", reportAp.agingBuckets, officialAp.agingBuckets);
  compareJsonSection(
    mismatches,
    "AP monthlyDueSchedule",
    reportAp.monthlyDueSchedule,
    officialAp.monthlyDueSchedule
  );
  compareJsonSection(mismatches, "AP financialHorizon", reportAp.financialHorizon, officialAp.financialHorizon);

  const expectedTop =
    topN != null && topN > 0 ? officialAp.topSuppliers.slice(0, topN) : officialAp.topSuppliers;
  compareJsonSection(mismatches, "AP topSuppliers", reportAp.topSuppliers, expectedTop);

  const expectedCritical =
    topN != null && topN > 0 ? officialAp.criticalTitles.slice(0, topN) : officialAp.criticalTitles;
  compareJsonSection(mismatches, "AP criticalTitles", reportAp.criticalTitles, expectedCritical);

  return { ok: mismatches.length === 0, mismatches };
}

export function auditExecutiveReportCashFlowParity(
  reportCashFlow: ReturnType<typeof buildExecutiveReportModuleSections>["cashFlow"]["payload"],
  officialCashFlow: ReturnType<typeof buildFinanceCashFlowDashboard>
): FinanceExecutiveReportConsistencyResult {
  const mismatches: string[] = [];
  compareMetric(
    mismatches,
    "Fluxo netFlowAmount",
    reportCashFlow.cards.netFlowAmount,
    officialCashFlow.cards.netFlowAmount
  );
  compareMetric(
    mismatches,
    "Fluxo inflowAmount",
    reportCashFlow.cards.inflowAmount,
    officialCashFlow.cards.inflowAmount
  );
  compareMetric(
    mismatches,
    "Fluxo outflowAmount",
    reportCashFlow.cards.outflowAmount,
    officialCashFlow.cards.outflowAmount
  );
  compareJsonSection(mismatches, "Fluxo monthlySeries", reportCashFlow.monthlySeries, officialCashFlow.monthlySeries);
  compareJsonSection(
    mismatches,
    "Fluxo reconciliation",
    reportCashFlow.reconciliation,
    officialCashFlow.reconciliation
  );
  compareJsonSection(
    mismatches,
    "Fluxo executiveSummary",
    reportCashFlow.executiveSummary,
    officialCashFlow.executiveSummary
  );
  compareJsonSection(mismatches, "Fluxo executiveYtd", reportCashFlow.executiveYtd, officialCashFlow.executiveYtd);
  return { ok: mismatches.length === 0, mismatches };
}

export function auditExecutiveReportCalendarParity(
  reportCalendar: ReturnType<typeof buildExecutiveReportModuleSections>["calendarAgenda"],
  officialCashFlow: ReturnType<typeof buildFinanceCashFlowDashboard>
): FinanceExecutiveReportConsistencyResult {
  const mismatches: string[] = [];
  compareJsonSection(mismatches, "Calendário calendar", reportCalendar.calendar, officialCashFlow.calendar);
  compareJsonSection(
    mismatches,
    "Calendário monthlyTimeline",
    reportCalendar.executiveSummary.monthlyTimeline,
    officialCashFlow.executiveSummary.monthlyTimeline
  );
  compareJsonSection(
    mismatches,
    "Calendário period",
    reportCalendar.executiveSummary.period,
    officialCashFlow.executiveSummary.period
  );
  compareJsonSection(
    mismatches,
    "Calendário net",
    reportCalendar.executiveSummary.net,
    officialCashFlow.executiveSummary.net
  );
  return { ok: mismatches.length === 0, mismatches };
}

export function auditExecutiveReportHeadlineParity(
  reportSummary: ReturnType<typeof buildExecutiveReportModuleSections>["executiveSummary"],
  official: {
    arCards: OfficialAccountsReceivableDashboardPayload["cards"];
    apCards: OfficialAccountsPayableDashboardPayload["cards"];
    cashFlowCards: ReturnType<typeof buildFinanceCashFlowDashboard>["cards"];
    billingTarget: BillingDashboardTab["target"] | null | undefined;
  }
): FinanceExecutiveReportConsistencyResult {
  const mismatches: string[] = [];
  const byId = new Map(reportSummary.headlineMetrics.map((m) => [m.id, m]));
  compareMetric(
    mismatches,
    "Headline billing-month",
    byId.get("billing-month")?.value,
    official.billingTarget?.actual ?? null
  );
  compareMetric(
    mismatches,
    "Headline ar-open",
    byId.get("ar-open")?.value,
    official.arCards.totalOpenAmount
  );
  compareMetric(
    mismatches,
    "Headline ap-open",
    byId.get("ap-open")?.value,
    official.apCards.totalOpenAmount
  );
  compareMetric(
    mismatches,
    "Headline cash-net",
    byId.get("cash-net")?.value,
    official.cashFlowCards.netFlowAmount
  );
  return { ok: mismatches.length === 0, mismatches };
}

export function auditExecutiveReportBillingParity(
  reportBilling: NonNullable<
    ReturnType<typeof buildExecutiveReportModuleSections>["billingComparison"]
  >["tab"],
  officialTab: BillingDashboardTab
): FinanceExecutiveReportConsistencyResult {
  const mismatches: string[] = [];
  compareMetric(mismatches, "Faturamento actual", reportBilling.target.actual, officialTab.target.actual);
  compareMetric(
    mismatches,
    "Faturamento achievementPercent",
    reportBilling.target.achievementPercent,
    officialTab.target.achievementPercent
  );
  compareJsonSection(mismatches, "Faturamento monthlySeries", reportBilling.monthlySeries, officialTab.monthlySeries);
  compareJsonSection(
    mismatches,
    "Faturamento multiYearMonthly",
    reportBilling.multiYearMonthly,
    officialTab.multiYearMonthly
  );
  return { ok: mismatches.length === 0, mismatches };
}

export function auditExecutiveReportSalesOrdersParity(
  reportOrders: NonNullable<
    ReturnType<typeof buildExecutiveReportModuleSections>["salesOrders"]
  >["tab"],
  officialTab: NonNullable<ExecutiveReportOfficialPayloads["salesOrdersTab"]>
): FinanceExecutiveReportConsistencyResult {
  const mismatches: string[] = [];
  compareJsonSection(mismatches, "Pedidos summaryCards", reportOrders.summaryCards, officialTab.summaryCards);
  compareMetric(mismatches, "Pedidos target.actual", reportOrders.target?.actual, officialTab.target?.actual);
  compareJsonSection(mismatches, "Pedidos monthlySeries", reportOrders.monthlySeries, officialTab.monthlySeries);
  compareJsonSection(mismatches, "Pedidos statusBreakdown", reportOrders.statusBreakdown, officialTab.statusBreakdown);
  return { ok: mismatches.length === 0, mismatches };
}

/** Paridade completa entre seções montadas e payloads oficiais nos mesmos filtros. */
export function auditExecutiveReportFullParity(
  sections: ReturnType<typeof buildExecutiveReportModuleSections>,
  official: ExecutiveReportOfficialPayloads
): FinanceExecutiveReportConsistencyResult {
  const parts = [
    auditExecutiveReportArParity(sections.accountsReceivable.payload, official.arPayload, official.filters.topN),
    auditExecutiveReportApParity(sections.accountsPayable.payload, official.apPayload, official.filters.topN),
    auditExecutiveReportCashFlowParity(sections.cashFlow.payload, official.cashFlowPayload),
    auditExecutiveReportCalendarParity(sections.calendarAgenda, official.cashFlowPayload),
    auditExecutiveReportHeadlineParity(sections.executiveSummary, {
      arCards: official.arPayload.cards,
      apCards: official.apPayload.cards,
      cashFlowCards: official.cashFlowPayload.cards,
      billingTarget: official.billingTab?.target,
    }),
  ];

  if (sections.billingComparison && official.billingTab) {
    parts.push(auditExecutiveReportBillingParity(sections.billingComparison.tab, official.billingTab));
  }
  if (sections.salesOrders && official.salesOrdersTab) {
    parts.push(auditExecutiveReportSalesOrdersParity(sections.salesOrders.tab, official.salesOrdersTab));
  }

  const mismatches = parts.flatMap((p) => p.mismatches);
  return { ok: mismatches.length === 0, mismatches };
}

/** AR atrasado/em aberto: stale, quitado, settlementDate e balance <= 0 excluídos. */
export function auditExecutiveReportArOverdueRules(
  rows: FinanceArDashboardRow[],
  filters: FinanceArDashboardFilters,
  referenceDate: Date,
  syncCutoff: NomusArReportSyncCutoff | null
): FinanceExecutiveReportConsistencyResult {
  const mismatches: string[] = [];

  const overdueParity = auditFinanceArOverdueParityWithDashboard(rows, filters, referenceDate, syncCutoff);
  mismatches.push(...overdueParity.mismatches);

  const overdueRows = buildFinanceAccountsReceivableOverdueRows(rows, filters, referenceDate, syncCutoff);
  for (const row of overdueRows) {
    if (row.balanceReceivable <= 0) {
      mismatches.push(`overdue inclui balance<=0: ${row.externalId}`);
    }
    if (row.amountReceived > 0 && row.balanceReceivable <= 0) {
      mismatches.push(`overdue inclui recebido quitado: ${row.externalId}`);
    }
  }

  return { ok: mismatches.length === 0, mismatches };
}

/** AP: pedido de compra (type=2) excluído da agenda gerencial. */
export function auditExecutiveReportApOperationalRules(
  rows: FinanceApDashboardRow[],
  filters: FinanceApDashboardFilters,
  referenceDate: Date,
  syncCutoff: NomusApReportSyncCutoff | null
): FinanceExecutiveReportConsistencyResult {
  const mismatches: string[] = [];
  const dash = buildOfficialAccountsPayableDashboard({
    rows,
    filters,
    referenceDate,
    syncCutoff,
  });

  const poRows = rows.filter((r) => isAccountsPayablePurchaseOrderSchedule(r));
  if (poRows.length > 0) {
    const poIds = new Set(poRows.map((r) => r.externalId));
    for (const title of dash.criticalTitles) {
      if (poIds.has(title.externalId)) {
        mismatches.push(`AP criticalTitles inclui type=2/pedido: ${title.externalId}`);
      }
    }
  }

  if (dash.dataSanitization.ignoredPurchaseOrderAgendaPayables < poRows.length) {
    mismatches.push(
      `AP sanitization ignoredPurchaseOrderAgendaPayables=${dash.dataSanitization.ignoredPurchaseOrderAgendaPayables} esperado>=${poRows.length}`
    );
  }

  return { ok: mismatches.length === 0, mismatches };
}

/** Stale AR não aparece em dashboard, atrasados nem fluxo. */
export function auditExecutiveReportArStaleExclusion(
  arRows: FinanceArDashboardRow[],
  cashFlowArRows: FinanceCashFlowArRow[],
  arFilters: FinanceArDashboardFilters,
  cashFlowFilters: FinanceCashFlowDashboardFilters,
  referenceDate: Date,
  syncCutoff: NomusArReportSyncCutoff | null,
  apSyncCutoff: NomusApReportSyncCutoff | null = null,
  apRows: FinanceCashFlowApRow[] = []
): FinanceExecutiveReportConsistencyResult {
  return auditFinanceArStaleExclusionAcrossViews(
    arRows,
    cashFlowArRows,
    arFilters,
    cashFlowFilters,
    referenceDate,
    syncCutoff,
    apSyncCutoff,
    apRows
  );
}

/** Monta payloads oficiais com filtros do relatório presidencial (sem Prisma). */
export function buildOfficialModulesForExecutiveReport(input: {
  filters: ExecutiveReportOfficialPayloads["filters"];
  referenceDate: Date;
  arRows: FinanceArDashboardRow[];
  apRows: FinanceApDashboardRow[];
  cashFlowArRows: FinanceCashFlowArRow[];
  cashFlowApRows: FinanceCashFlowApRow[];
  arSyncCutoff: NomusArReportSyncCutoff | null;
  apSyncCutoff: NomusApReportSyncCutoff | null;
  billingTab?: BillingDashboardTab | null;
  salesOrdersTab?: ExecutiveReportOfficialPayloads["salesOrdersTab"];
}) {
  const arPortfolioFilters = buildExecutiveReportArPortfolioFilters(input.filters);
  const apPortfolioFilters = buildExecutiveReportApPortfolioFilters(input.filters);
  const cashFlowFilters = buildExecutiveReportCashFlowFilters(input.filters);

  const arPayload = buildOfficialAccountsReceivableDashboard({
    rows: input.arRows,
    filters: arPortfolioFilters,
    referenceDate: input.referenceDate,
    syncCutoff: input.arSyncCutoff,
    year: input.filters.year,
    month: input.filters.month ?? undefined,
  });
  const apPayload = buildOfficialAccountsPayableDashboard({
    rows: input.apRows,
    filters: apPortfolioFilters,
    referenceDate: input.referenceDate,
    syncCutoff: input.apSyncCutoff,
    year: input.filters.year,
    month: input.filters.month ?? undefined,
  });
  const cashFlowPayload = buildFinanceCashFlowDashboard(
    input.cashFlowArRows,
    input.cashFlowApRows,
    cashFlowFilters,
    input.referenceDate,
    input.arSyncCutoff,
    input.apSyncCutoff
  );

  return {
    filters: input.filters,
    referenceDate: input.referenceDate,
    arPayload,
    apPayload,
    cashFlowPayload,
    billingTab: input.billingTab ?? null,
    salesOrdersTab: input.salesOrdersTab ?? null,
    arFilters: arPortfolioFilters,
    apFilters: apPortfolioFilters,
    cashFlowFilters,
  };
}
