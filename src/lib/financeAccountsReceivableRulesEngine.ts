/**
 * Motor oficial de regras de Contas a Receber — fonte única server-side para métricas AR.
 *
 * Consolida regras já existentes em:
 * - financeAccountsReceivableDashboard.ts (tela Contas a Receber)
 * - financeAccountsReceivableManagement.ts (base saneada gerencial)
 * - financeAccountsReceivableHorizon.ts (horizonte financeiro)
 * - financeCivilDate.ts (datas civis)
 * - financeExecutiveReportDataSources.ts (recebido YTD por settlementDate)
 *
 * Não altera telas/endpoints existentes — apenas expõe contrato unificado para consumo futuro.
 */

import {
  addLocalDays,
  buildFinanceAccountsReceivableDashboard,
  classifyFinanceArTitle,
  computeDaysOverdue,
  endOfLocalDay,
  filterFinanceArManagementReportRows,
  hasFinanceArSourceInvoice,
  isFinanceArAllowedInManagementReport,
  isFinanceArOpen,
  isFinanceArReceivedOrSettled,
  roundMoney,
  startOfLocalDay,
  sumFinanceArReceivedBySettlementInPeriod,
  type FinanceArDashboardFilters,
  type FinanceArDashboardRow,
} from "./financeAccountsReceivableDashboard.js";
import { startOfCivilDate, toCivilDateKey } from "./financeCivilDate.js";
import { resolveForwardYearRange } from "./financeCashFlowExecutiveSummary.js";
import { isFinanceArOverdueWithoutFiscalDocument } from "./financeAccountsReceivableManagement.js";
import type { NomusArReportSyncCutoff } from "./financeNomusArReportFreshness.js";
import type {
  FinanceAccountsReceivableDayBucket,
  FinanceAccountsReceivableGridRow,
  FinanceAccountsReceivableMetricDefinition,
  FinanceAccountsReceivableMetrics,
  FinanceAccountsReceivableRulesAuditResult,
  FinanceAccountsReceivableRulesBuildInput,
  FinanceAccountsReceivableRulesContext,
  FinanceAccountsReceivableRulesFilters,
  FinanceAccountsReceivableRulesResult,
  FinanceArEffectiveStatus,
  FinanceArRulesDateRole,
  FinanceArRulesInput,
  FinanceArRulesMetricKey,
  NormalizedAccountsReceivableTitle,
} from "./financeAccountsReceivableRulesEngine.types.js";

export const FINANCE_AR_RULES_ENGINE_VERSION = "1.0.0";

export const FINANCE_AR_RULES_ENGINE_NOTE =
  "Contas a Receber gerencial: carteira aberta e aging por vencimento (dueDate); recebido por data de baixa (settlementDate). Vencidos sem NF excluídos da visão gerencial." as const;

export type {
  FinanceAccountsReceivableDayBucket,
  FinanceAccountsReceivableGridRow,
  FinanceAccountsReceivableMetricDefinition,
  FinanceAccountsReceivableMetrics,
  FinanceAccountsReceivableRulesAuditResult,
  FinanceAccountsReceivableRulesBuildInput,
  FinanceAccountsReceivableRulesContext,
  FinanceAccountsReceivableRulesFilters,
  FinanceAccountsReceivableRulesResult,
  FinanceAccountsReceivableDashboardPayload,
  FinanceArEffectiveStatus,
  FinanceArRulesDateRole,
  FinanceArRulesInput,
  FinanceArRulesMetricKey,
  NormalizedAccountsReceivableTitle,
} from "./financeAccountsReceivableRulesEngine.types.js";

const METRIC_DEFINITIONS: FinanceAccountsReceivableMetricDefinition[] = [
  {
    key: "totalReceivable",
    label: "Total a receber",
    description:
      "Soma de amountReceivable dos títulos no universo filtrado e saneado gerencialmente (inclui abertos e quitados no período).",
    valueField: "amountReceivable",
    dateField: "dueDate",
    includes: ["Títulos no filtro de vencimento/período", "Abertos e quitados"],
    excludes: [
      "Grupo interno",
      "Fantasmas",
      "Stale Nomus",
      "Vencidos sem NF",
      "Duplicatas pré-NF superseded",
      "Títulos obsoletos de pedido/parcela substituídos no Nomus",
    ],
  },
  {
    key: "receivedThisMonth",
    label: "Recebido no mês",
    description:
      "Soma de amountReceived dos títulos cuja settlementDate (data de baixa) cai no mês/ano de referência.",
    valueField: "amountReceived",
    dateField: "settlementDate",
    includes: ["Títulos com baixa no mês corrente"],
    excludes: ["Títulos sem settlementDate no mês"],
    dateBasisNote: "Data de baixa — regra oficial da tela Contas a Receber.",
  },
  {
    key: "receivedYtd",
    label: "Recebido YTD",
    description:
      "Soma de amountReceived dos títulos cuja settlementDate está entre 01/01 do ano e a data-base (ou fim do ano).",
    valueField: "amountReceived",
    dateField: "settlementDate",
    includes: ["Baixas no acumulado do ano"],
    excludes: ["Recebimentos fora do YTD"],
    dateBasisNote:
      "Mesma regra do Relatório Executivo (sumFinanceArReceivedBySettlementInPeriod). Distinto do Fluxo de Caixa planejado (dueDate).",
  },
  {
    key: "openAmount",
    label: "Em aberto",
    description: "Soma de balanceReceivable dos títulos ainda pendentes (saldo > 0, não quitados).",
    valueField: "balanceReceivable",
    dateField: "dueDate",
    includes: ["Títulos com saldo em aberto"],
    excludes: ["Quitados", "Cobrança suspensa em status settled"],
  },
  {
    key: "overdueAmount",
    label: "Vencido / atrasado gerencial",
    description:
      "Saldo em aberto com vencimento anterior à data-base, após saneamento gerencial (vencidos sem NF excluídos).",
    valueField: "balanceReceivable",
    dateField: "dueDate",
    includes: ["Abertos vencidos com lastro fiscal quando exigido"],
    excludes: ["A vencer", "Vence hoje", "Vencidos sem NF"],
  },
  {
    key: "dueTodayAmount",
    label: "Vence hoje",
    description: "Saldo em aberto com vencimento igual à data-base.",
    valueField: "balanceReceivable",
    dateField: "dueDate",
    includes: ["Abertos com dueDate = hoje"],
    excludes: ["Vencidos", "Futuros"],
  },
  {
    key: "dueNext7DaysAmount",
    label: "Próximos 7 dias",
    description: "Saldo em aberto com vencimento entre hoje e hoje+7 dias (janela cumulativa).",
    valueField: "balanceReceivable",
    dateField: "dueDate",
    includes: ["Abertos com vencimento na janela 0–7 dias"],
    excludes: ["Vencidos anteriores a hoje"],
  },
  {
    key: "dueNext30DaysAmount",
    label: "Próximos 30 dias",
    description: "Saldo em aberto com vencimento entre hoje e hoje+30 dias (janela cumulativa).",
    valueField: "balanceReceivable",
    dateField: "dueDate",
    includes: ["Abertos com vencimento na janela 0–30 dias"],
    excludes: ["Vencidos anteriores a hoje"],
  },
  {
    key: "dueNext60DaysAmount",
    label: "Próximos 60 dias",
    description: "Saldo em aberto com vencimento entre hoje e hoje+60 dias (janela cumulativa).",
    valueField: "balanceReceivable",
    dateField: "dueDate",
    includes: ["Abertos com vencimento na janela 0–60 dias"],
    excludes: ["Vencidos anteriores a hoje"],
  },
  {
    key: "dueNext90DaysAmount",
    label: "Próximos 90 dias",
    description: "Saldo em aberto com vencimento entre hoje e hoje+90 dias (janela cumulativa).",
    valueField: "balanceReceivable",
    dateField: "dueDate",
    includes: ["Abertos com vencimento na janela 0–90 dias"],
    excludes: ["Vencidos anteriores a hoje"],
  },
  {
    key: "openWithInvoiceAmount",
    label: "Com NF",
    description: "Saldo em aberto de títulos com NF de origem vinculada (sourceInvoiceId ou sourceInvoiceNumber).",
    valueField: "balanceReceivable",
    dateField: "dueDate",
    includes: ["Abertos com NF"],
    excludes: ["Pré-NF", "Quitados"],
  },
  {
    key: "openWithoutInvoiceAmount",
    label: "Sem NF",
    description: "Saldo em aberto de títulos sem NF de origem vinculada (carteira pré-NF).",
    valueField: "balanceReceivable",
    dateField: "dueDate",
    includes: ["Abertos sem NF"],
    excludes: ["Com NF vinculada", "Quitados"],
  },
  {
    key: "openUntilYearEnd",
    label: "A receber até 31/12",
    description:
      "Saldo em aberto com vencimento entre hoje (ou início do ano) e 31/12 do ano de referência.",
    valueField: "balanceReceivable",
    dateField: "dueDate",
    includes: ["Abertos com vencimento no forward range do ano"],
    excludes: ["Quitados", "Vencimentos após 31/12"],
    dateBasisNote: "Mesma regra de financeCashFlowExecutiveSummary.sumArOpenDueInPeriod.",
  },
  {
    key: "estimatedYearTotal",
    label: "Estimativa AR do ano",
    description: "Recebido YTD (settlementDate) + A receber até 31/12 (dueDate). Projeção gerencial do ano.",
    valueField: "derived",
    dateField: "mixed",
    includes: ["receivedYtd", "openUntilYearEnd"],
    excludes: [],
    dateBasisNote: "Derivado — sem campo único equivalente no dashboard AR cards.",
  },
  {
    key: "periodReceivedAmount",
    label: "Entradas do período",
    description: "Recebimentos no período YTD por settlementDate — entradas realizadas.",
    valueField: "amountReceived",
    dateField: "settlementDate",
    includes: ["Baixas no período YTD"],
    excludes: [],
  },
  {
    key: "periodExpectedInflowAmount",
    label: "Entradas previstas",
    description:
      "Saldo em aberto com vencimento no forward range (hoje até 31/12) — entradas previstas por vencimento.",
    valueField: "balanceReceivable",
    dateField: "dueDate",
    includes: ["Abertos com vencimento futuro no ano"],
    excludes: ["Quitados"],
  },
];

function safeMoney(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function isDashboardRow(
  title: FinanceArRulesInput | FinanceArDashboardRow
): title is FinanceArDashboardRow {
  return "syncedAt" in title && title.externalId != null;
}

function toDashboardRow(input: FinanceArRulesInput | FinanceArDashboardRow): FinanceArDashboardRow {
  if (isDashboardRow(input)) return input;
  return {
    externalId: input.externalId ?? 0,
    companyName: input.companyName ?? null,
    personId: input.personId ?? null,
    personName: input.personName ?? null,
    personCnpj: input.personCnpj ?? null,
    description: input.description ?? null,
    comments: input.comments ?? null,
    dueDate: input.dueDate ?? null,
    competenceDate: input.competenceDate ?? null,
    settlementDate: input.settlementDate ?? null,
    amountReceivable: roundMoney(safeMoney(input.amountReceivable)),
    amountReceived: roundMoney(safeMoney(input.amountReceived)),
    balanceReceivable: roundMoney(safeMoney(input.balanceReceivable)),
    paymentMethodName: input.paymentMethodName ?? null,
    bankAccountName: input.bankAccountName ?? null,
    sourceInvoiceId: input.sourceInvoiceId ?? null,
    sourceInvoiceNumber: input.sourceInvoiceNumber ?? null,
    suspendCollection: input.suspendCollection ?? null,
    nomusStatus: input.nomusStatus ?? null,
    syncedAt: input.syncedAt ?? new Date(0),
  };
}

export function normalizeAccountsReceivableFilters(
  input: Partial<FinanceAccountsReceivableRulesFilters> & { status?: FinanceArDashboardFilters["status"] }
): FinanceAccountsReceivableRulesFilters {
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
    invoiceIssued: input.invoiceIssued,
  };
}

export function buildAccountsReceivableRulesContext(
  input: FinanceAccountsReceivableRulesBuildInput = {}
): FinanceAccountsReceivableRulesContext {
  const referenceDate = input.referenceDate ?? new Date();
  const today = startOfLocalDay(referenceDate);
  const filters = normalizeAccountsReceivableFilters(input.filters ?? { status: "all" });
  const year = input.year ?? filters.year ?? referenceDate.getFullYear();
  const month = input.month ?? filters.month ?? referenceDate.getMonth() + 1;

  const ytdStart = startOfLocalDay(new Date(year, 0, 1));
  const isCurrentYear = year === referenceDate.getFullYear();
  const ytdEnd = isCurrentYear
    ? today
    : startOfLocalDay(new Date(year, 11, 31));
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

export function normalizeAccountsReceivableTitle(
  input: FinanceArRulesInput | FinanceArDashboardRow,
  referenceDate: Date = new Date()
): NormalizedAccountsReceivableTitle {
  const row = toDashboardRow(input);
  const dueDateCivilKey = row.dueDate ? toCivilDateKey(row.dueDate) : null;
  const operationalDueDate = row.dueDate ? startOfCivilDate(row.dueDate) : null;

  const isSuspended = row.suspendCollection === true && !isFinanceArReceivedOrSettled(row);
  const isSettled = isFinanceArReceivedOrSettled(row);
  const isOpen = isFinanceArOpen(row) && !isSettled && row.suspendCollection !== true;

  let effectiveStatus: FinanceArEffectiveStatus = "UNKNOWN";
  if (isSuspended) effectiveStatus = "SUSPENDED";
  else if (isSettled) effectiveStatus = "SETTLED";
  else if (isOpen) effectiveStatus = "OPEN";

  return {
    id: row.externalId ?? null,
    dueDate: row.dueDate,
    dueDateCivilKey,
    settlementDate: row.settlementDate,
    competenceDate: row.competenceDate ?? null,
    operationalDueDate,
    effectiveStatus,
    amountReceivable: row.amountReceivable,
    amountReceived: row.amountReceived,
    openAmount: isOpen ? row.balanceReceivable : 0,
    isOpen,
    isSettled,
    isSuspended,
    hasSourceInvoice: hasFinanceArSourceInvoice(row),
    calculatedStatus: classifyFinanceArTitle(row, referenceDate),
  };
}

export function classifyAccountsReceivableTitle(
  title: FinanceArRulesInput | FinanceArDashboardRow,
  context: Pick<FinanceAccountsReceivableRulesContext, "referenceDate">
): Exclude<FinanceArDashboardFilters["status"], "all"> | "unknown" {
  return classifyFinanceArTitle(toDashboardRow(title), context.referenceDate);
}

export function getAccountsReceivableValue(
  title: FinanceArRulesInput | FinanceArDashboardRow,
  metric: FinanceArRulesMetricKey,
  context: FinanceAccountsReceivableRulesContext
): number {
  const row = toDashboardRow(title);
  const normalized = normalizeAccountsReceivableTitle(row, context.referenceDate);

  switch (metric) {
    case "totalReceivable":
      return normalized.amountReceivable;
    case "receivedThisMonth":
      return isReceivedInPeriod(row, context.monthStart, context.monthEnd) ? normalized.amountReceived : 0;
    case "receivedYtd":
      return isReceivedInPeriod(row, context.ytdStart, context.ytdEnd) ? normalized.amountReceived : 0;
    case "openAmount":
      return normalized.openAmount;
    case "openWithInvoiceAmount":
      return normalized.isOpen && normalized.hasSourceInvoice ? normalized.openAmount : 0;
    case "openWithoutInvoiceAmount":
      return normalized.isOpen && !normalized.hasSourceInvoice ? normalized.openAmount : 0;
    case "overdueAmount":
      return normalized.isOpen && normalized.calculatedStatus === "overdue" ? normalized.openAmount : 0;
    case "dueTodayAmount":
      return normalized.isOpen && normalized.calculatedStatus === "dueToday" ? normalized.openAmount : 0;
    case "dueNext7DaysAmount":
      return normalized.isOpen && isOpenDueInCumulativeWindow(row, context.today, 7)
        ? normalized.openAmount
        : 0;
    case "dueNext30DaysAmount":
      return normalized.isOpen && isOpenDueInCumulativeWindow(row, context.today, 30)
        ? normalized.openAmount
        : 0;
    case "dueNext60DaysAmount":
      return normalized.isOpen && isOpenDueInCumulativeWindow(row, context.today, 60)
        ? normalized.openAmount
        : 0;
    case "dueNext90DaysAmount":
      return normalized.isOpen && isOpenDueInCumulativeWindow(row, context.today, 90)
        ? normalized.openAmount
        : 0;
    case "openUntilYearEnd":
      return normalized.isOpen && isOpenDueInPeriod(row, context.forwardFromDate, context.yearEnd)
        ? normalized.openAmount
        : 0;
    case "periodReceivedAmount":
      return isReceivedInPeriod(row, context.ytdStart, context.ytdEnd) ? normalized.amountReceived : 0;
    case "periodExpectedInflowAmount":
      return normalized.isOpen && isOpenDueInPeriod(row, context.forwardFromDate, context.yearEnd)
        ? normalized.openAmount
        : 0;
    case "estimatedYearTotal":
      return roundMoney(
        getAccountsReceivableValue(title, "receivedYtd", context) +
          getAccountsReceivableValue(title, "openUntilYearEnd", context)
      );
    default:
      return 0;
  }
}

export function getAccountsReceivableDate(
  title: FinanceArRulesInput | FinanceArDashboardRow,
  dateRole: FinanceArRulesDateRole,
  _context?: FinanceAccountsReceivableRulesContext
): Date | null {
  const row = toDashboardRow(title);

  switch (dateRole) {
    case "dueDate":
      return row.dueDate ? startOfCivilDate(row.dueDate) : null;
    case "settlementDate":
      return row.settlementDate ? startOfLocalDay(row.settlementDate) : null;
    case "competenceDate":
      return row.competenceDate ? startOfCivilDate(row.competenceDate) : null;
    case "operationalDueDate":
      return row.dueDate ? startOfCivilDate(row.dueDate) : null;
    default:
      return null;
  }
}

function isReceivedInPeriod(
  row: Pick<FinanceArDashboardRow, "settlementDate" | "amountReceived">,
  startDate: Date,
  endDate: Date
): boolean {
  if (!row.settlementDate || row.amountReceived <= 0) return false;
  const settlementMs = row.settlementDate.getTime();
  return settlementMs >= startDate.getTime() && settlementMs <= endOfLocalDay(endDate).getTime();
}

function isOpenDueInPeriod(
  row: Pick<FinanceArDashboardRow, "dueDate" | "balanceReceivable">,
  startDate: Date,
  endDate: Date
): boolean {
  if (!isFinanceArOpen(row) || !row.dueDate) return false;
  const due = startOfCivilDate(row.dueDate).getTime();
  const start = startOfLocalDay(startDate).getTime();
  const end = startOfLocalDay(endDate).getTime();
  return due >= start && due <= end;
}

function isOpenDueInCumulativeWindow(
  row: Pick<FinanceArDashboardRow, "dueDate" | "balanceReceivable">,
  today: Date,
  days: number
): boolean {
  const end = endOfLocalDay(addLocalDays(today, days));
  return isOpenDueInPeriod(row, today, end);
}

function sumOpenDueInCumulativeWindow(
  rows: FinanceArDashboardRow[],
  today: Date,
  days: number
): number {
  let total = 0;
  for (const row of rows) {
    if (!isFinanceArReceivedOrSettled(row) && isOpenDueInCumulativeWindow(row, today, days)) {
      total += row.balanceReceivable;
    }
  }
  return roundMoney(total);
}

function sumOpenDueInPeriod(
  rows: FinanceArDashboardRow[],
  startDate: Date,
  endDate: Date
): number {
  let total = 0;
  for (const row of rows) {
    if (!isFinanceArReceivedOrSettled(row) && isOpenDueInPeriod(row, startDate, endDate)) {
      total += row.balanceReceivable;
    }
  }
  return roundMoney(total);
}

export type OfficialArMetricScope = {
  filters?: FinanceArDashboardFilters;
  referenceDate?: Date;
  syncCutoff?: NomusArReportSyncCutoff | null;
};

function scopeRowsForOfficialArMetric(
  rows: FinanceArDashboardRow[],
  scope?: OfficialArMetricScope
): FinanceArDashboardRow[] {
  if (!scope?.filters || !scope.referenceDate) return rows;
  return filterFinanceArManagementReportRows(
    rows,
    scope.filters,
    scope.referenceDate,
    scope.syncCutoff
  );
}

/** Carteira gerencial — título vencido (dueDate) com lastro fiscal quando exigido. */
export function isOfficialArOverdueTitle(
  row: FinanceArDashboardRow,
  referenceDate: Date
): boolean {
  if (row.suspendCollection === true) return false;
  if (isFinanceArReceivedOrSettled(row)) return false;
  if (!row.dueDate) return false;
  if (classifyFinanceArTitle(row, referenceDate) !== "overdue") return false;
  if (isFinanceArOverdueWithoutFiscalDocument(row, referenceDate)) return false;
  return true;
}

/** Títulos atrasados gerenciais após saneamento e freshness. */
export function filterOfficialArOverdueTitles(
  rows: FinanceArDashboardRow[],
  filters: FinanceArDashboardFilters,
  referenceDate: Date,
  syncCutoff?: NomusArReportSyncCutoff | null
): FinanceArDashboardRow[] {
  const base = filterFinanceArManagementReportRows(
    rows,
    { ...filters, status: "all" },
    referenceDate,
    syncCutoff
  );
  return base.filter((row) => isOfficialArOverdueTitle(row, referenceDate));
}

/** Saldo vencido gerencial — mesma regra de overdueAmount no motor. */
export function sumOfficialArOverdueAmount(
  rows: FinanceArDashboardRow[],
  filters: FinanceArDashboardFilters,
  referenceDate: Date,
  syncCutoff?: NomusArReportSyncCutoff | null
): number {
  return roundMoney(
    filterOfficialArOverdueTitles(rows, filters, referenceDate, syncCutoff).reduce(
      (sum, row) => sum + row.balanceReceivable,
      0
    )
  );
}

/** Timeline / Fluxo — saldo aberto com vencimento no período (dueDate, datas civis). */
export function sumOfficialArOpenDueInPeriod(
  rows: FinanceArDashboardRow[],
  startDate: Date,
  endDate: Date,
  scope?: OfficialArMetricScope
): number {
  return sumOpenDueInPeriod(scopeRowsForOfficialArMetric(rows, scope), startDate, endDate);
}

/** Contagem de títulos abertos com vencimento no período (dueDate). */
export function countOfficialArOpenDueInPeriod(
  rows: FinanceArDashboardRow[],
  startDate: Date,
  endDate: Date,
  scope?: OfficialArMetricScope
): number {
  let count = 0;
  for (const row of scopeRowsForOfficialArMetric(rows, scope)) {
    if (!isFinanceArReceivedOrSettled(row) && isOpenDueInPeriod(row, startDate, endDate)) {
      count += 1;
    }
  }
  return count;
}

export function buildAccountsReceivableMetrics(
  titles: FinanceArDashboardRow[],
  context: FinanceAccountsReceivableRulesContext
): FinanceAccountsReceivableMetrics {
  const dashboard = buildFinanceAccountsReceivableDashboard(
    titles,
    context.filters,
    context.referenceDate,
    context.syncCutoff
  );
  const cards = dashboard.cards;

  const receivedYtd = sumFinanceArReceivedBySettlementInPeriod(
    titles,
    context.filters,
    context.referenceDate,
    context.syncCutoff,
    context.ytdStart,
    context.ytdEnd
  );

  const openUntilYearEnd = sumOpenDueInPeriod(
    filterFinanceArManagementReportRows(
      titles,
      { ...context.filters, year: context.year, month: undefined },
      context.referenceDate,
      context.syncCutoff
    ),
    context.forwardFromDate,
    context.yearEnd
  );

  const dueNext60DaysAmount = sumOpenDueInCumulativeWindow(
    filterFinanceArManagementReportRows(titles, context.filters, context.referenceDate, context.syncCutoff),
    context.today,
    60
  );
  const dueNext90DaysAmount = sumOpenDueInCumulativeWindow(
    filterFinanceArManagementReportRows(titles, context.filters, context.referenceDate, context.syncCutoff),
    context.today,
    90
  );

  return {
    totalReceivable: cards.totalAmountReceivable,
    receivedThisMonth: cards.receivedThisMonthAmount,
    receivedYtd,
    openAmount: cards.totalOpenAmount,
    overdueAmount: cards.overdueAmount,
    dueTodayAmount: cards.dueTodayAmount,
    dueNext7DaysAmount: cards.dueNext7DaysAmount,
    dueNext30DaysAmount: cards.dueNext30DaysAmount,
    dueNext60DaysAmount,
    dueNext90DaysAmount,
    openWithInvoiceAmount: cards.openWithInvoiceAmount,
    openWithoutInvoiceAmount: cards.openWithoutInvoiceAmount,
    openWithInvoiceCount: cards.openWithInvoiceCount,
    openWithoutInvoiceCount: cards.openWithoutInvoiceCount,
    openUntilYearEnd,
    estimatedYearTotal: roundMoney(receivedYtd + openUntilYearEnd),
    periodReceivedAmount: receivedYtd,
    periodExpectedInflowAmount: openUntilYearEnd,
  };
}

export function buildAccountsReceivableDayBuckets(
  titles: FinanceArDashboardRow[],
  context: FinanceAccountsReceivableRulesContext
): FinanceAccountsReceivableDayBucket[] {
  const filtered = filterFinanceArManagementReportRows(
    titles,
    context.filters,
    context.referenceDate,
    context.syncCutoff
  );
  const acc = new Map<string, { amount: number; count: number }>();

  for (const row of filtered) {
    if (isFinanceArReceivedOrSettled(row) || !row.dueDate) continue;
    const key = toCivilDateKey(row.dueDate);
    if (!key) continue;
    const existing = acc.get(key) ?? { amount: 0, count: 0 };
    existing.amount += row.balanceReceivable;
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

export function buildAccountsReceivableGridRows(
  titles: FinanceArDashboardRow[],
  context: FinanceAccountsReceivableRulesContext
): FinanceAccountsReceivableGridRow[] {
  const filtered = filterFinanceArManagementReportRows(
    titles,
    context.filters,
    context.referenceDate,
    context.syncCutoff
  );
  const today = context.today;

  return filtered.map((row) => ({
    externalId: row.externalId,
    companyName: row.companyName,
    personName: row.personName,
    personCnpj: row.personCnpj,
    dueDate: row.dueDate ? toCivilDateKey(row.dueDate) : null,
    settlementDate: row.settlementDate ? toCivilDateKey(row.settlementDate) : null,
    amountReceivable: roundMoney(row.amountReceivable),
    amountReceived: roundMoney(row.amountReceived),
    balanceReceivable: roundMoney(row.balanceReceivable),
    hasSourceInvoice: hasFinanceArSourceInvoice(row),
    calculatedStatus: classifyFinanceArTitle(row, today),
    daysOverdue: computeDaysOverdue(row.dueDate, today),
    paymentMethodName: row.paymentMethodName,
    bankAccountName: row.bankAccountName,
    sourceInvoiceId: row.sourceInvoiceId,
    sourceInvoiceNumber: row.sourceInvoiceNumber,
    suspendCollection: row.suspendCollection,
  }));
}

export function explainAccountsReceivableMetric(
  metricName: FinanceArRulesMetricKey | string
): FinanceAccountsReceivableMetricDefinition | null {
  return METRIC_DEFINITIONS.find((def) => def.key === metricName) ?? null;
}

export function listAccountsReceivableMetricDefinitions(): FinanceAccountsReceivableMetricDefinition[] {
  return [...METRIC_DEFINITIONS];
}

export function auditAccountsReceivableRules(
  result: FinanceAccountsReceivableRulesResult
): FinanceAccountsReceivableRulesAuditResult {
  const warnings: string[] = [];
  const metricValues = Object.values(result.metrics);
  const isFinite = metricValues.every((v) => Number.isFinite(v));

  if (!isFinite) {
    warnings.push("Uma ou mais métricas retornaram NaN ou Infinity.");
  }

  if (result.metrics.openAmount < result.metrics.overdueAmount) {
    warnings.push("overdueAmount excede openAmount — revisar classificação.");
  }

  const engineOpen = result.metrics.openAmount;
  const cardsOpen = result.cards.totalOpenAmount;
  if (Math.abs(engineOpen - cardsOpen) > 0.01) {
    warnings.push(
      `Divergência openAmount engine (${engineOpen}) vs cards dashboard (${cardsOpen}).`
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
export function buildFinanceAccountsReceivableRulesResult(
  titles: FinanceArDashboardRow[],
  input: FinanceAccountsReceivableRulesBuildInput = {}
): FinanceAccountsReceivableRulesResult {
  const context = buildAccountsReceivableRulesContext(input);
  const dashboard = buildFinanceAccountsReceivableDashboard(
    titles,
    context.filters,
    context.referenceDate,
    context.syncCutoff,
    { horizonSourceRows: input.horizonSourceRows ?? titles }
  );

  const metrics = buildAccountsReceivableMetrics(titles, context);
  const dayBuckets = buildAccountsReceivableDayBuckets(titles, context);
  const gridRows = buildAccountsReceivableGridRows(titles, context);
  const horizon = dashboard.financialHorizon;

  const result: FinanceAccountsReceivableRulesResult = {
    engineVersion: FINANCE_AR_RULES_ENGINE_VERSION,
    generatedAt: context.referenceDate.toISOString(),
    referenceDate: context.today.toISOString(),
    context,
    metrics,
    cards: dashboard.cards,
    horizon,
    dayBuckets,
    gridRows,
    dataSanitization: dashboard.dataSanitization,
    metricDefinitions: listAccountsReceivableMetricDefinitions(),
    audit: { isFinite: true, warnings: [], metricsDocumented: 0, filteredTitlesCount: 0, openTitlesCount: 0, settledTitlesCount: 0 },
    fullDashboard: dashboard,
  };

  result.audit = auditAccountsReceivableRules(result);
  return result;
}

/** Verifica se título entra na visão gerencial após saneamento. */
export function isAccountsReceivableTitleAllowedInManagement(
  title: FinanceArRulesInput | FinanceArDashboardRow,
  referenceDate: Date
): boolean {
  return isFinanceArAllowedInManagementReport(toDashboardRow(title), referenceDate);
}

export { FINANCE_AR_RULES_ENGINE_NOTE as FINANCE_AR_MANAGEMENT_RULES_NOTE };
