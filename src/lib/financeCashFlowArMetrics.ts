/**
 * Contrato canônico das métricas AR do Fluxo de Caixa.
 *
 * Não busca banco, não aplica saneamento, não conhece React.
 * Delega ao motor oficial de Contas a Receber e aos adapters já existentes.
 *
 * Mesmo conceito → um helper. Conceitos diferentes permanecem diferentes.
 */
import {
  isFinanceArReceivedOrSettled,
  resolveFinanceArCustomerKey,
  roundMoney,
  startOfLocalDay,
  type FinanceArDashboardFilters,
  type FinanceArDashboardRow,
} from "./financeAccountsReceivableDashboard.js";
import {
  resolveOfficialArCashFlowExecutiveMetrics,
  type OfficialArCashFlowExecutiveMetrics,
} from "./financeAccountsReceivableRulesAdapter.js";
import { sumOfficialArOpenDueInPeriod } from "./financeAccountsReceivableRulesEngine.js";
import type { FinanceCashFlowArRow } from "./financeCashFlowDashboard.js";
import type { NomusArReportSyncCutoff } from "./financeNomusArReportFreshness.js";

function isCanonicalArOpenRow(row: FinanceCashFlowArRow): boolean {
  if (row.suspendCollection === true) return false;
  return !isFinanceArReceivedOrSettled(row);
}

export const FINANCE_CASH_FLOW_AR_METRIC = {
  OPEN_PORTFOLIO: "AR_OPEN_PORTFOLIO",
  OPEN_DUE_IN_PERIOD: "AR_OPEN_DUE_IN_PERIOD",
  OPEN_DUE_IN_YEAR: "AR_OPEN_DUE_IN_YEAR",
  OPEN_FORWARD_TO_YEAR_END: "AR_OPEN_FORWARD_TO_YEAR_END",
  RECEIVED_YTD: "AR_RECEIVED_YTD",
  ESTIMATED_YEAR_TOTAL: "AR_ESTIMATED_YEAR_TOTAL",
  PLANNED_BY_DUE_MONTH: "AR_PLANNED_BY_DUE_MONTH",
  MOVEMENT_TIMELINE_MONTHLY: "AR_MOVEMENT_TIMELINE_MONTHLY",
  DAILY_RADAR_OPEN_DUE: "AR_DAILY_RADAR_OPEN_DUE",
  RECEIVED_BY_DUE_IN_PERIOD: "AR_RECEIVED_BY_DUE_IN_PERIOD",
} as const;

export type FinanceCashFlowArCanonicalMetricId =
  (typeof FINANCE_CASH_FLOW_AR_METRIC)[keyof typeof FINANCE_CASH_FLOW_AR_METRIC];

export type FinanceCashFlowArMetricParityKind =
  | "MATCH"
  | "SEMANTICALLY_DIFFERENT"
  | "ERROR";

export type FinanceCashFlowArMetricFilterName =
  | "year"
  | "month"
  | "companyName"
  | "customerName"
  | "personCnpj"
  | "paymentMethodName"
  | "bankAccountName"
  | "invoiceIssued"
  | "status"
  | "cashFlowScope"
  | "viewMode"
  | "dateBase";

export type FinanceCashFlowArMetricFilterPolicy = {
  metric: FinanceCashFlowArCanonicalMetricId;
  moneyField: "balanceReceivable" | "amountReceived" | "mixed";
  dateAxis: "none" | "dueDate" | "settlementDate" | "dueDate+settlementDate" | "movement+dueDate";
  respects: readonly FinanceCashFlowArMetricFilterName[];
  ignores: readonly FinanceCashFlowArMetricFilterName[];
  reason: string;
};

const PAGE_IDENTITY_FILTERS = [
  "companyName",
  "customerName",
  "personCnpj",
  "paymentMethodName",
  "bankAccountName",
  "invoiceIssued",
  "status",
  "cashFlowScope",
] as const satisfies readonly FinanceCashFlowArMetricFilterName[];

/** Declara quais filtros cada métrica canônica respeita ou ignora de propósito. */
export const FINANCE_CASH_FLOW_AR_METRIC_FILTER_MATRIX: readonly FinanceCashFlowArMetricFilterPolicy[] =
  [
    {
      metric: FINANCE_CASH_FLOW_AR_METRIC.OPEN_PORTFOLIO,
      moneyField: "balanceReceivable",
      dateAxis: "none",
      respects: PAGE_IDENTITY_FILTERS,
      ignores: ["year", "month", "viewMode", "dateBase"],
      reason: "Carteira aberta gerencial, sem recorte de vencimento por ano/mês.",
    },
    {
      metric: FINANCE_CASH_FLOW_AR_METRIC.OPEN_DUE_IN_PERIOD,
      moneyField: "balanceReceivable",
      dateAxis: "dueDate",
      respects: ["year", "month", ...PAGE_IDENTITY_FILTERS],
      ignores: ["viewMode", "dateBase"],
      reason: "Saldo aberto cujo dueDate cai no período explícito.",
    },
    {
      metric: FINANCE_CASH_FLOW_AR_METRIC.OPEN_DUE_IN_YEAR,
      moneyField: "balanceReceivable",
      dateAxis: "dueDate",
      respects: ["year", ...PAGE_IDENTITY_FILTERS],
      ignores: ["month", "viewMode", "dateBase"],
      reason: "Saldo aberto com vencimento no ano selecionado (YTD de carteira).",
    },
    {
      metric: FINANCE_CASH_FLOW_AR_METRIC.OPEN_FORWARD_TO_YEAR_END,
      moneyField: "balanceReceivable",
      dateAxis: "dueDate",
      respects: ["year", ...PAGE_IDENTITY_FILTERS],
      ignores: ["month", "viewMode", "dateBase"],
      reason: "Saldo aberto com vencimento da data-base operacional até 31/12.",
    },
    {
      metric: FINANCE_CASH_FLOW_AR_METRIC.RECEIVED_YTD,
      moneyField: "amountReceived",
      dateAxis: "settlementDate",
      respects: ["year", ...PAGE_IDENTITY_FILTERS],
      ignores: ["month", "viewMode", "dateBase"],
      reason: "Recebido oficial YTD pela regra de baixa vigente (settlementDate).",
    },
    {
      metric: FINANCE_CASH_FLOW_AR_METRIC.ESTIMATED_YEAR_TOTAL,
      moneyField: "mixed",
      dateAxis: "dueDate+settlementDate",
      respects: ["year", ...PAGE_IDENTITY_FILTERS],
      ignores: ["month", "viewMode", "dateBase"],
      reason: "AR_RECEIVED_YTD + AR_OPEN_FORWARD_TO_YEAR_END do motor oficial.",
    },
    {
      metric: FINANCE_CASH_FLOW_AR_METRIC.PLANNED_BY_DUE_MONTH,
      moneyField: "mixed",
      dateAxis: "dueDate",
      respects: ["year", ...PAGE_IDENTITY_FILTERS],
      ignores: ["month", "viewMode", "dateBase"],
      reason: "Fluxo planejado: recebido e aberto alocados pelo vencimento.",
    },
    {
      metric: FINANCE_CASH_FLOW_AR_METRIC.MOVEMENT_TIMELINE_MONTHLY,
      moneyField: "mixed",
      dateAxis: "movement+dueDate",
      respects: ["year", ...PAGE_IDENTITY_FILTERS],
      ignores: ["month", "viewMode", "dateBase"],
      reason:
        "Realizado no eixo de movimento (settlement + overlay fev/2026) e aberto por dueDate.",
    },
    {
      metric: FINANCE_CASH_FLOW_AR_METRIC.DAILY_RADAR_OPEN_DUE,
      moneyField: "balanceReceivable",
      dateAxis: "dueDate",
      respects: [],
      ignores: [
        "year",
        "month",
        "companyName",
        "customerName",
        "personCnpj",
        "paymentMethodName",
        "bankAccountName",
        "invoiceIssued",
        "status",
        "cashFlowScope",
        "viewMode",
        "dateBase",
      ],
      reason: "Radar Diário é independente dos filtros gerais da página.",
    },
    {
      metric: FINANCE_CASH_FLOW_AR_METRIC.RECEIVED_BY_DUE_IN_PERIOD,
      moneyField: "amountReceived",
      dateAxis: "dueDate",
      respects: ["year", ...PAGE_IDENTITY_FILTERS],
      ignores: ["month", "viewMode", "dateBase"],
      reason:
        "Recebido alocado por vencimento — distinto do YTD oficial por settlementDate.",
    },
  ];

export type FinanceCashFlowArCanonicalYearMetrics = {
  receivedYtd: number;
  openForwardToYearEnd: number;
  estimatedYearTotal: number;
  openPortfolio: number;
};

const MONEY_PARITY_EPSILON = 0.005;

/** Arredondamento canônico — o mesmo `roundMoney` do motor oficial. */
export function roundCanonicalArMoney(amount: number): number {
  return roundMoney(amount);
}

/**
 * Identidade de AR_ESTIMATED_YEAR_TOTAL.
 * Usa os dois addendos já oficiais; não recalcula população.
 */
export function composeCanonicalArEstimatedYearTotal(
  receivedYtd: number,
  openForwardToYearEnd: number
): number {
  return roundMoney(receivedYtd + openForwardToYearEnd);
}

/**
 * Identidade mensal do fluxo planejado / timeline:
 * recebido do eixo + saldo aberto por vencimento.
 * Grão mensal — não é AR_ESTIMATED_YEAR_TOTAL.
 */
export function composeCanonicalArPlannedEstimatedInflow(
  receivedByAxis: number,
  openDueInPeriod: number
): number {
  return roundMoney(receivedByAxis + openDueInPeriod);
}

/** AR_OPEN_DUE_IN_PERIOD — motor oficial, balanceReceivable por dueDate. */
export function sumCanonicalArOpenDueInPeriod(
  rows: ReadonlyArray<FinanceArDashboardRow>,
  startDate: Date,
  endDate: Date
): number {
  return sumOfficialArOpenDueInPeriod([...rows], startDate, endDate);
}

/** Recebido alocado por dueDate — autoridade de AR_PLANNED_BY_DUE_MONTH.received. */
export function sumCanonicalArReceivedByDueInPeriod(
  rows: ReadonlyArray<FinanceCashFlowArRow>,
  startDate: Date,
  endDate: Date
): number {
  const start = startOfLocalDay(startDate).getTime();
  const end = startOfLocalDay(endDate).getTime();
  let total = 0;
  for (const row of rows) {
    if (row.amountReceived <= 0 || row.dueDate == null) continue;
    const due = startOfLocalDay(row.dueDate).getTime();
    if (due < start || due > end) continue;
    total += row.amountReceived;
  }
  return roundMoney(total);
}

/** Soma canônica de saldo aberto (balanceReceivable > 0). */
export function sumCanonicalArOpenBalance(
  rows: ReadonlyArray<{ balanceReceivable: number }>
): number {
  let total = 0;
  for (const row of rows) {
    if (row.balanceReceivable > 0) total += row.balanceReceivable;
  }
  return roundMoney(total);
}

/** Saldo aberto canônico dos títulos elegíveis de um cliente. */
export function sumCanonicalArOpenPortfolioForCustomer(
  rows: ReadonlyArray<FinanceCashFlowArRow>,
  customer: { personName: string | null; personCnpj: string | null; externalId?: number }
): number {
  const key = resolveFinanceArCustomerKey({
    personName: customer.personName,
    personCnpj: customer.personCnpj,
    externalId: customer.externalId ?? 0,
  });
  const matched: Array<{ balanceReceivable: number }> = [];
  for (const row of rows) {
    if (!isCanonicalArOpenRow(row)) continue;
    if (resolveFinanceArCustomerKey(row) !== key) continue;
    matched.push(row);
  }
  return sumCanonicalArOpenBalance(matched);
}

/**
 * Métricas anuais oficiais do resumo executivo.
 * Autoridade: financeAccountsReceivableRulesEngine via adapter.
 */
export function resolveCanonicalArYearMetrics(
  rows: FinanceArDashboardRow[],
  filters: FinanceArDashboardFilters,
  referenceDate: Date,
  syncCutoff: NomusArReportSyncCutoff | null | undefined,
  year: number
): FinanceCashFlowArCanonicalYearMetrics {
  const official: OfficialArCashFlowExecutiveMetrics =
    resolveOfficialArCashFlowExecutiveMetrics(
      rows,
      filters,
      referenceDate,
      syncCutoff,
      year
    );
  return {
    receivedYtd: official.receivedYtd,
    openForwardToYearEnd: official.openUntilYearEnd,
    estimatedYearTotal: official.estimatedYearTotal,
    openPortfolio: official.openAmount,
  };
}

export function classifyCanonicalArMoneyParity(
  left: number,
  right: number
): Extract<FinanceCashFlowArMetricParityKind, "MATCH" | "ERROR"> {
  const a = roundMoney(left);
  const b = roundMoney(right);
  if (a === b) return "MATCH";
  if (Math.abs(left - right) <= MONEY_PARITY_EPSILON && a === b) return "MATCH";
  return "ERROR";
}

export function assertCanonicalArMoneyEqual(
  left: number,
  right: number,
  message?: string
): void {
  if (classifyCanonicalArMoneyParity(left, right) !== "MATCH") {
    throw new Error(
      message ??
        `Paridade AR violada: ${roundMoney(left)} !== ${roundMoney(right)} (tolerância 0 centavos)`
    );
  }
}

export type FinanceCashFlowArParityCheck = {
  id: string;
  kind: FinanceCashFlowArMetricParityKind;
  leftLabel: string;
  rightLabel: string;
  left: number;
  right: number;
  reason?: string;
};

export function buildEstimatedYearTotalParityCheck(input: {
  receivedYtd: number;
  openForwardToYearEnd: number;
  estimatedYearTotal: number;
}): FinanceCashFlowArParityCheck {
  const composed = composeCanonicalArEstimatedYearTotal(
    input.receivedYtd,
    input.openForwardToYearEnd
  );
  const match = classifyCanonicalArMoneyParity(input.estimatedYearTotal, composed);
  return {
    id: "AR_ESTIMATED_YEAR_TOTAL",
    kind: match,
    leftLabel: "estimatedYearTotal",
    rightLabel: "receivedYtd + openForwardToYearEnd",
    left: input.estimatedYearTotal,
    right: composed,
  };
}

export function buildAnnualTotalsParityCheck(input: {
  annualCashInTotal: number;
  monthsCashInSum: number;
}): FinanceCashFlowArParityCheck {
  const match = classifyCanonicalArMoneyParity(
    input.annualCashInTotal,
    input.monthsCashInSum
  );
  return {
    id: "ANNUAL_TOTAL_VS_MONTHS",
    kind: match,
    leftLabel: "totals.cashInTotalAmount",
    rightLabel: "sum(months.cashInTotalAmount)",
    left: input.annualCashInTotal,
    right: roundMoney(input.monthsCashInSum),
  };
}

export function buildPlannedVsAnnualMonthParityChecks(
  planned: ReadonlyArray<{
    month: number;
    received: number;
    receivableOpenDue: number;
    estimatedInflow: number;
  }>,
  annual: ReadonlyArray<{
    month: number;
    receivedAmount: number;
    receivableOpenAmount: number;
    cashInTotalAmount: number;
  }>
): FinanceCashFlowArParityCheck[] {
  return planned.map((row) => {
    const month = annual.find((m) => m.month === row.month);
    const left = row.estimatedInflow;
    const right = month?.cashInTotalAmount ?? Number.NaN;
    const match = classifyCanonicalArMoneyParity(left, right);
    return {
      id: `PLANNED_VS_ANNUAL_M${row.month}`,
      kind: match,
      leftLabel: `plannedMonthlyTimeline[${row.month}].estimatedInflow`,
      rightLabel: `annual.months[${row.month}].cashInTotalAmount`,
      left,
      right,
    };
  });
}

export function buildRadarRangeParityCheck(input: {
  rangeKey: string;
  rangeTotal: number;
  daysSum: number;
  detailsSum: number;
}): FinanceCashFlowArParityCheck[] {
  return [
    {
      id: `RADAR_RANGE_VS_DAYS_${input.rangeKey}`,
      kind: classifyCanonicalArMoneyParity(input.rangeTotal, input.daysSum),
      leftLabel: `ranges[${input.rangeKey}].receivableTotal`,
      rightLabel: "sum(days.receivableTotal)",
      left: input.rangeTotal,
      right: roundMoney(input.daysSum),
    },
    {
      id: `RADAR_RANGE_VS_DETAILS_${input.rangeKey}`,
      kind: classifyCanonicalArMoneyParity(input.rangeTotal, input.detailsSum),
      leftLabel: `ranges[${input.rangeKey}].receivableTotal`,
      rightLabel: "sum(detail receivables)",
      left: input.rangeTotal,
      right: roundMoney(input.detailsSum),
    },
  ];
}

export function getFinanceCashFlowArMetricFilterPolicy(
  metric: FinanceCashFlowArCanonicalMetricId
): FinanceCashFlowArMetricFilterPolicy | undefined {
  return FINANCE_CASH_FLOW_AR_METRIC_FILTER_MATRIX.find((row) => row.metric === metric);
}
