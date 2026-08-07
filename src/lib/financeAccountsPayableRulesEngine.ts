/**
 * Motor oficial de regras de Contas a Pagar — fonte única server-side para métricas AP.
 *
 * Consolida regras já existentes em:
 * - financeAccountsPayableDashboard.ts (tela Contas a Pagar)
 * - financeAccountsPayableRules.ts (normalização saneada)
 * - financeAccountsPayableOperational.ts (vencimento operacional / agendamento)
 * - financeHorizonAggregation.ts (horizonte financeiro)
 * - financeExecutiveReportDataSources.ts (pago YTD por data efetiva)
 */

import {
  addLocalDays,
  buildFinanceAccountsPayableDashboard,
  classifyFinanceApTitle,
  endOfLocalDay,
  filterFinanceApRows,
  isFinanceApOpen,
  isFinanceApSettled,
  roundMoney,
  startOfLocalDay,
  sumFinanceApPaidInPaymentPeriod,
  type FinanceApDashboardFilters,
  type FinanceApDashboardRow,
} from "./financeAccountsPayableDashboard.js";
import {
  computeFinanceApDaysOverdue,
  getAccountsPayableOperationalDueDate,
  hasAccountsPayableRescheduledPayment,
} from "./financeAccountsPayableOperational.js";
import {
  isFinanceApCancelledTitle,
  resolveFinanceApOpenAmount,
} from "./financeAccountsPayableRules.js";
import type { NomusApReportSyncCutoff } from "./financeNomusApReportFreshness.js";
import { toCivilDateKey } from "./financeCivilDate.js";
import { resolveForwardYearRange } from "./financeCashFlowExecutiveSummary.js";
import type {
  FinanceAccountsPayableDayBucket,
  FinanceAccountsPayableGridRow,
  FinanceAccountsPayableMetricDefinition,
  FinanceAccountsPayableMetrics,
  FinanceAccountsPayableRulesAuditResult,
  FinanceAccountsPayableRulesBuildInput,
  FinanceAccountsPayableRulesContext,
  FinanceAccountsPayableRulesFilters,
  FinanceAccountsPayableRulesResult,
  FinanceApRulesMetricKey,
} from "./financeAccountsPayableRulesEngine.types.js";

export const FINANCE_AP_RULES_ENGINE_VERSION = "1.0.0";

export const FINANCE_AP_RULES_ENGINE_NOTE =
  "Contas a Pagar gerencial: carteira aberta e aging por data de vencimento; pago alocado por vencimento (dueDate). Agenda de pedido de compra excluída da visão gerencial." as const;

export type {
  FinanceAccountsPayableDayBucket,
  FinanceAccountsPayableDashboardPayload,
  FinanceAccountsPayableGridRow,
  FinanceAccountsPayableMetricDefinition,
  FinanceAccountsPayableMetrics,
  FinanceAccountsPayableRulesAuditResult,
  FinanceAccountsPayableRulesBuildInput,
  FinanceAccountsPayableRulesContext,
  FinanceAccountsPayableRulesFilters,
  FinanceAccountsPayableRulesResult,
  FinanceApRulesMetricKey,
} from "./financeAccountsPayableRulesEngine.types.js";

const METRIC_DEFINITIONS: FinanceAccountsPayableMetricDefinition[] = [
  {
    key: "totalPayable",
    label: "Total a pagar",
    description: "Soma de amountPayable dos títulos no universo filtrado e saneado gerencialmente.",
    valueField: "amountPayable",
    dateField: "dueDate",
    includes: ["Títulos no filtro", "Abertos e quitados"],
    excludes: ["Cancelados", "Grupo interno", "Stale Nomus", "Agenda pedido de compra"],
  },
  {
    key: "paidThisMonth",
    label: "Pago no mês",
    description: "Soma de realizedAmount cuja data efetiva de pagamento cai no mês/ano de referência.",
    valueField: "realizedAmount",
    dateField: "effectivePaymentDate",
    includes: ["Quitados com baixa no mês"],
    excludes: ["Cancelados"],
    dateBasisNote: "Data efetiva gerencial — vencimento para títulos quitados.",
  },
  {
    key: "paidYtd",
    label: "Pago YTD",
    description: "Soma de pagamentos efetivos entre 01/01 do ano e a data-base.",
    valueField: "realizedAmount",
    dateField: "effectivePaymentDate",
    includes: ["Pagamentos no acumulado do ano"],
    excludes: ["Pagamentos fora do YTD"],
  },
  {
    key: "openAmount",
    label: "Em aberto",
    description: "Soma de saldo em aberto saneado (resolveFinanceApOpenAmount).",
    valueField: "balancePayable",
    dateField: "operationalDueDate",
    includes: ["Títulos abertos"],
    excludes: ["Quitados", "Cancelados", "Pagamento suspenso"],
  },
  {
    key: "overdueAmount",
    label: "Vencido gerencial",
    description: "Saldo em aberto com status overdue na classificação gerencial.",
    valueField: "balancePayable",
    dateField: "operationalDueDate",
    includes: ["Abertos vencidos"],
    excludes: ["Quitados", "Cancelados"],
  },
  {
    key: "dueTodayAmount",
    label: "Vence hoje",
    description: "Saldo em aberto com vencimento operacional hoje.",
    valueField: "balancePayable",
    dateField: "operationalDueDate",
    includes: ["Abertos que vencem hoje"],
    excludes: ["Quitados"],
  },
  {
    key: "dueNext7DaysAmount",
    label: "Próx. 7 dias",
    description: "Saldo em aberto com vencimento operacional entre hoje e +7 dias.",
    valueField: "balancePayable",
    dateField: "operationalDueDate",
    includes: ["Abertos na janela cumulativa de 7 dias"],
    excludes: ["Quitados"],
  },
  {
    key: "dueNext30DaysAmount",
    label: "Próx. 30 dias",
    description: "Saldo em aberto com vencimento operacional entre hoje e +30 dias.",
    valueField: "balancePayable",
    dateField: "operationalDueDate",
    includes: ["Abertos na janela cumulativa de 30 dias"],
    excludes: ["Quitados"],
  },
  {
    key: "dueNext60DaysAmount",
    label: "Próx. 60 dias",
    description: "Saldo em aberto com vencimento operacional entre hoje e +60 dias.",
    valueField: "balancePayable",
    dateField: "operationalDueDate",
    includes: ["Abertos na janela cumulativa de 60 dias"],
    excludes: ["Quitados"],
  },
  {
    key: "dueNext90DaysAmount",
    label: "Próx. 90 dias",
    description: "Saldo em aberto com vencimento operacional entre hoje e +90 dias.",
    valueField: "balancePayable",
    dateField: "operationalDueDate",
    includes: ["Abertos na janela cumulativa de 90 dias"],
    excludes: ["Quitados"],
  },
  {
    key: "scheduledOpenAmount",
    label: "Agendados",
    description: "Saldo em aberto de títulos com pagamento reagendado (pedido de compra).",
    valueField: "balancePayable",
    dateField: "operationalDueDate",
    includes: ["Abertos reagendados"],
    excludes: ["Quitados"],
  },
  {
    key: "openUntilYearEnd",
    label: "A pagar restante no ano",
    description: "Saldo em aberto com vencimento operacional entre hoje e fim do ano.",
    valueField: "balancePayable",
    dateField: "operationalDueDate",
    includes: ["Abertos com vencimento futuro no ano"],
    excludes: ["Quitados"],
  },
  {
    key: "estimatedYearTotal",
    label: "Estimativa AP do ano",
    description: "Pago YTD + a pagar até 31/12.",
    valueField: "mixed",
    dateField: "mixed",
    includes: ["paidYtd", "openUntilYearEnd"],
    excludes: [],
  },
];

export function normalizeAccountsPayableFilters(
  input: Partial<FinanceAccountsPayableRulesFilters>
): FinanceAccountsPayableRulesFilters {
  return {
    status: input.status ?? "all",
    companyName: input.companyName,
    personName: input.personName,
    personCnpj: input.personCnpj,
    year: input.year,
    month: input.month,
    dueDateFrom: input.dueDateFrom,
    dueDateTo: input.dueDateTo,
    paymentMethodName: input.paymentMethodName,
    bankAccountName: input.bankAccountName,
    documentQuery: input.documentQuery,
    suspendPayment: input.suspendPayment,
    managementScope: input.managementScope,
  };
}

export function buildAccountsPayableRulesContext(
  input: FinanceAccountsPayableRulesBuildInput = {}
): FinanceAccountsPayableRulesContext {
  const referenceDate = input.referenceDate ?? new Date();
  const today = startOfLocalDay(referenceDate);
  const filters = normalizeAccountsPayableFilters(input.filters ?? { status: "all" });
  const year = input.year ?? filters.year ?? referenceDate.getFullYear();
  const month = input.month ?? filters.month ?? referenceDate.getMonth() + 1;

  const ytdStart = startOfLocalDay(new Date(year, 0, 1));
  const isCurrentYear = year === referenceDate.getFullYear();
  const ytdEnd = isCurrentYear ? today : startOfLocalDay(new Date(year, 11, 31));
  const monthStart = startOfLocalDay(new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1));
  const monthEnd = endOfLocalDay(new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0));
  const yearEnd = startOfLocalDay(new Date(year, 11, 31));
  const forward = resolveForwardYearRange(year, referenceDate);

  return {
    referenceDate,
    today,
    filters,
    syncCutoff: input.syncCutoff ?? null,
    year,
    month,
    ytdStart,
    ytdEnd,
    monthStart,
    monthEnd,
    yearEnd,
    forwardFromDate: forward.fromDate,
  };
}

function isOpenOperationalDueInPeriod(
  row: FinanceApDashboardRow,
  startDate: Date,
  endDate: Date
): boolean {
  if (!isFinanceApOpen(row)) return false;
  const operationalDueDate = getAccountsPayableOperationalDueDate(row);
  if (!operationalDueDate) return false;
  const due = startOfLocalDay(operationalDueDate).getTime();
  const start = startOfLocalDay(startDate).getTime();
  const end = startOfLocalDay(endDate).getTime();
  return due >= start && due <= end;
}

function sumOpenOperationalDueInCumulativeWindow(
  rows: FinanceApDashboardRow[],
  today: Date,
  days: number
): number {
  const end = endOfLocalDay(addLocalDays(today, days));
  let total = 0;
  for (const row of rows) {
    if (isOpenOperationalDueInPeriod(row, today, end)) {
      total += resolveFinanceApOpenAmount(row);
    }
  }
  return roundMoney(total);
}

function sumOpenOperationalDueInPeriod(
  rows: FinanceApDashboardRow[],
  startDate: Date,
  endDate: Date
): number {
  let total = 0;
  for (const row of rows) {
    if (isOpenOperationalDueInPeriod(row, startDate, endDate)) {
      total += resolveFinanceApOpenAmount(row);
    }
  }
  return roundMoney(total);
}

export type OfficialApMetricScope = {
  filters?: FinanceApDashboardFilters;
  referenceDate?: Date;
  syncCutoff?: NomusApReportSyncCutoff | null;
};

function scopeRowsForOfficialApMetric(
  rows: FinanceApDashboardRow[],
  scope?: OfficialApMetricScope
): FinanceApDashboardRow[] {
  if (!scope?.filters || !scope.referenceDate) return rows;
  return filterFinanceApRows(
    rows,
    scope.filters,
    scope.referenceDate,
    scope.syncCutoff
  );
}

/** Carteira gerencial AP — mesma regra do motor/dashboard oficial. */
export function filterOfficialApManagementTitles(
  rows: FinanceApDashboardRow[],
  filters: FinanceApDashboardFilters,
  referenceDate: Date,
  syncCutoff?: NomusApReportSyncCutoff | null
): FinanceApDashboardRow[] {
  return filterFinanceApRows(rows, filters, referenceDate, syncCutoff);
}

/** Timeline / Fluxo — saldo aberto por vencimento operacional no período. */
export function sumOfficialApOpenDueInPeriod(
  rows: FinanceApDashboardRow[],
  startDate: Date,
  endDate: Date,
  scope?: OfficialApMetricScope
): number {
  return sumOpenOperationalDueInPeriod(
    scopeRowsForOfficialApMetric(rows, scope),
    startDate,
    endDate
  );
}

/**
 * Mesma regra de {@link sumOfficialApOpenDueInPeriod}, agrupada por dia civil
 * do vencimento operacional em uma passada — a soma das chaves de um período
 * é igual à soma oficial daquele período (mesma partição civil). Para
 * consumidores que precisam do saldo aberto dia a dia (ex.: estimativa
 * diária da Tesouraria).
 */
export function sumOfficialApOpenDueByCivilDay(
  rows: FinanceApDashboardRow[],
  scope?: OfficialApMetricScope
): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of scopeRowsForOfficialApMetric(rows, scope)) {
    if (!isFinanceApOpen(row)) continue;
    const operationalDueDate = getAccountsPayableOperationalDueDate(row);
    if (!operationalDueDate) continue;
    const key = toCivilDateKey(operationalDueDate);
    if (!key) continue;
    out.set(key, roundMoney((out.get(key) ?? 0) + resolveFinanceApOpenAmount(row)));
  }
  return out;
}

/** Contagem de títulos abertos com vencimento operacional no período. */
export function countOfficialApOpenDueInPeriod(
  rows: FinanceApDashboardRow[],
  startDate: Date,
  endDate: Date,
  scope?: OfficialApMetricScope
): number {
  let count = 0;
  for (const row of scopeRowsForOfficialApMetric(rows, scope)) {
    if (isOpenOperationalDueInPeriod(row, startDate, endDate)) count += 1;
  }
  return count;
}

function sumScheduledOpenAmount(rows: FinanceApDashboardRow[]): number {
  let total = 0;
  for (const row of rows) {
    if (isFinanceApOpen(row) && hasAccountsPayableRescheduledPayment(row)) {
      total += resolveFinanceApOpenAmount(row);
    }
  }
  return roundMoney(total);
}

export function buildAccountsPayableMetrics(
  titles: FinanceApDashboardRow[],
  context: FinanceAccountsPayableRulesContext
): FinanceAccountsPayableMetrics {
  const dashboard = buildFinanceAccountsPayableDashboard(
    titles,
    context.filters,
    context.referenceDate,
    context.syncCutoff
  );
  const cards = dashboard.cards;
  const filtered = filterFinanceApRows(
    titles,
    context.filters,
    context.referenceDate,
    context.syncCutoff
  );

  const paidYtd = sumFinanceApPaidInPaymentPeriod(
    titles,
    context.filters,
    context.referenceDate,
    context.syncCutoff,
    context.ytdStart,
    context.ytdEnd
  );

  const openUntilYearEnd = sumOpenOperationalDueInPeriod(
    filterFinanceApRows(
      titles,
      { ...context.filters, year: context.year, month: undefined },
      context.referenceDate,
      context.syncCutoff
    ),
    context.forwardFromDate,
    context.yearEnd
  );

  const dueNext60DaysAmount = sumOpenOperationalDueInCumulativeWindow(
    filtered,
    context.today,
    60
  );
  const dueNext90DaysAmount = sumOpenOperationalDueInCumulativeWindow(
    filtered,
    context.today,
    90
  );
  const scheduledOpenAmount = sumScheduledOpenAmount(filtered);

  return {
    totalPayable: cards.totalPayableAmount,
    paidThisMonth: cards.paidThisMonthAmount,
    paidYtd,
    openAmount: cards.totalOpenAmount,
    overdueAmount: cards.overdueAmount,
    dueTodayAmount: cards.dueTodayAmount,
    dueNext7DaysAmount: cards.dueNext7DaysAmount,
    dueNext30DaysAmount: cards.dueNext30DaysAmount,
    dueNext60DaysAmount,
    dueNext90DaysAmount,
    scheduledOpenAmount,
    openUntilYearEnd,
    estimatedYearTotal: roundMoney(paidYtd + openUntilYearEnd),
    periodPaidAmount: paidYtd,
    periodExpectedOutflowAmount: openUntilYearEnd,
  };
}

export function buildAccountsPayableDayBuckets(
  titles: FinanceApDashboardRow[],
  context: FinanceAccountsPayableRulesContext
): FinanceAccountsPayableDayBucket[] {
  const filtered = filterFinanceApRows(
    titles,
    context.filters,
    context.referenceDate,
    context.syncCutoff
  );
  const acc = new Map<string, { amount: number; count: number }>();

  for (const row of filtered) {
    if (isFinanceApCancelledTitle(row) || !isFinanceApOpen(row)) continue;
    const operationalDueDate = getAccountsPayableOperationalDueDate(row);
    if (!operationalDueDate) continue;
    const key = toCivilDateKey(operationalDueDate);
    if (!key) continue;
    const existing = acc.get(key) ?? { amount: 0, count: 0 };
    existing.amount += resolveFinanceApOpenAmount(row);
    existing.count += 1;
    acc.set(key, existing);
  }

  return [...acc.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([civilDateKey, data]) => ({
      civilDateKey,
      dueDate: civilDateKey,
      amount: roundMoney(data.amount),
      titlesCount: data.count,
    }));
}

export function buildAccountsPayableGridRows(
  titles: FinanceApDashboardRow[],
  context: FinanceAccountsPayableRulesContext
): FinanceAccountsPayableGridRow[] {
  const filtered = filterFinanceApRows(
    titles,
    context.filters,
    context.referenceDate,
    context.syncCutoff
  );
  const today = context.today;

  return filtered
    .filter((row) => !isFinanceApCancelledTitle(row))
    .map((row) => {
      const operationalDueDate = getAccountsPayableOperationalDueDate(row);
      return {
        externalId: row.externalId,
        companyName: row.companyName,
        personName: row.personName,
        personCnpj: row.personCnpj,
        dueDate: row.dueDate ? toCivilDateKey(row.dueDate) : null,
        operationalDueDate: operationalDueDate ? toCivilDateKey(operationalDueDate) : null,
        paymentDate: row.paymentDate ? toCivilDateKey(row.paymentDate) : null,
        settlementDate: row.settlementDate ? toCivilDateKey(row.settlementDate) : null,
        amountPayable: roundMoney(row.amountPayable),
        amountPaid: roundMoney(row.amountPaid),
        balancePayable: roundMoney(row.balancePayable),
        calculatedStatus: classifyFinanceApTitle(row, today),
        daysOverdue: computeFinanceApDaysOverdue(row, today),
        paymentMethodName: row.paymentMethodName,
        bankAccountName: row.bankAccountName,
        documentNumber: row.documentNumber,
        suspendPayment: row.suspendPayment,
        isRescheduled: hasAccountsPayableRescheduledPayment(row),
      };
    });
}

export function explainAccountsPayableMetric(
  metricName: FinanceApRulesMetricKey | string
): FinanceAccountsPayableMetricDefinition | null {
  return METRIC_DEFINITIONS.find((def) => def.key === metricName) ?? null;
}

export function listAccountsPayableMetricDefinitions(): FinanceAccountsPayableMetricDefinition[] {
  return [...METRIC_DEFINITIONS];
}

export function auditAccountsPayableRules(
  result: FinanceAccountsPayableRulesResult
): FinanceAccountsPayableRulesAuditResult {
  const warnings: string[] = [];
  const metricValues = Object.values(result.metrics);
  const isFinite = metricValues.every((v) => Number.isFinite(v));

  if (!isFinite) {
    warnings.push("Uma ou mais métricas retornaram NaN ou Infinity.");
  }

  if (result.metrics.openAmount < result.metrics.overdueAmount) {
    warnings.push("overdueAmount excede openAmount — revisar classificação.");
  }

  if (Math.abs(result.metrics.openAmount - result.cards.totalOpenAmount) > 0.01) {
    warnings.push(
      `Divergência openAmount engine (${result.metrics.openAmount}) vs cards dashboard (${result.cards.totalOpenAmount}).`
    );
  }

  return {
    isFinite,
    warnings,
    metricsDocumented: result.metricDefinitions.length,
    filteredTitlesCount: result.cards.totalRecords,
    openTitlesCount: result.cards.openTitlesCount,
    settledTitlesCount: result.cards.settledTitlesCount,
  };
}

/** Ponto de entrada principal — agrega métricas, horizonte, grids e auditoria. */
export function buildFinanceAccountsPayableRulesResult(
  titles: FinanceApDashboardRow[],
  input: FinanceAccountsPayableRulesBuildInput = {}
): FinanceAccountsPayableRulesResult {
  const context = buildAccountsPayableRulesContext(input);
  const dashboard = buildFinanceAccountsPayableDashboard(
    titles,
    context.filters,
    context.referenceDate,
    context.syncCutoff
  );

  const metrics = buildAccountsPayableMetrics(titles, context);
  const dayBuckets = buildAccountsPayableDayBuckets(titles, context);
  const gridRows = buildAccountsPayableGridRows(titles, context);

  const result: FinanceAccountsPayableRulesResult = {
    engineVersion: FINANCE_AP_RULES_ENGINE_VERSION,
    generatedAt: context.referenceDate.toISOString(),
    referenceDate: context.today.toISOString(),
    context,
    metrics,
    cards: dashboard.cards,
    horizon: dashboard.financialHorizon,
    purchaseOrderScheduleAudit: dashboard.purchaseOrderScheduleAudit,
    dayBuckets,
    gridRows,
    dataSanitization: dashboard.dataSanitization,
    metricDefinitions: listAccountsPayableMetricDefinitions(),
    audit: { isFinite: true, warnings: [], metricsDocumented: 0, filteredTitlesCount: 0, openTitlesCount: 0, settledTitlesCount: 0 },
    fullDashboard: dashboard,
  };

  result.audit = auditAccountsPayableRules(result);
  return result;
}

export { FINANCE_AP_RULES_ENGINE_NOTE as FINANCE_AP_MANAGEMENT_RULES_NOTE };
