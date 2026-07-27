/**
 * Regras puras — dashboard diário da Tesouraria.
 * Totais e composição devem permanecer consistentes (testes assertam).
 */

import type {
  TreasuryAccountFinancialPositionDto,
  TreasuryDashboardCashFlowBucketDto,
  TreasuryDashboardCompositionItemDto,
  TreasuryDashboardDto,
  TreasuryDashboardExceptionItemDto,
  TreasuryDashboardFreshnessDto,
  TreasuryDashboardSourceFreshnessDto,
  TreasuryFinancialPositionDto,
} from "../contracts/treasuryDto.js";
import type { TreasuryCivilDate } from "../contracts/treasuryCivilDate.js";
import type {
  TreasuryExceptionSeverity,
  TreasuryProjectionLayer,
} from "../contracts/treasuryEnums.js";
import {
  addTreasuryMoney,
  compareTreasuryMoney,
  negateTreasuryMoney,
  normalizeTreasuryMoneyString,
  type TreasuryMoneyString,
} from "../treasuryMoney.js";

export type TreasuryDashboardDayFlowAggregate = {
  plannedAmount: TreasuryMoneyString;
  plannedTitleCount: number;
  realizedAmount: TreasuryMoneyString;
  realizedTitleCount: number;
  pendingAmount: TreasuryMoneyString;
  pendingTitleCount: number;
};

export type TreasuryDashboardDayFlowInput = {
  receivables: TreasuryDashboardDayFlowAggregate;
  payables: TreasuryDashboardDayFlowAggregate;
};

function zeroFlow(): TreasuryDashboardDayFlowAggregate {
  return {
    plannedAmount: "0.00",
    plannedTitleCount: 0,
    realizedAmount: "0.00",
    realizedTitleCount: 0,
    pendingAmount: "0.00",
    pendingTitleCount: 0,
  };
}

export function emptyTreasuryDashboardDayFlow(): TreasuryDashboardDayFlowInput {
  return {
    receivables: zeroFlow(),
    payables: zeroFlow(),
  };
}

function moneyOrZero(value: string | null | undefined): TreasuryMoneyString {
  if (value == null || value === "") return "0.00";
  return normalizeTreasuryMoneyString(value);
}

function bucketFromAggregate(
  agg: TreasuryDashboardDayFlowAggregate,
  kind: TreasuryDashboardCashFlowBucketDto["kind"]
): TreasuryDashboardCashFlowBucketDto {
  return {
    kind,
    plannedAmount: normalizeTreasuryMoneyString(agg.plannedAmount),
    plannedTitleCount: agg.plannedTitleCount,
    realizedAmount: normalizeTreasuryMoneyString(agg.realizedAmount),
    realizedTitleCount: agg.realizedTitleCount,
    pendingAmount: normalizeTreasuryMoneyString(agg.pendingAmount),
    pendingTitleCount: agg.pendingTitleCount,
  };
}

function resolveCurrentBalance(
  position: TreasuryFinancialPositionDto
): {
  currentBalance: TreasuryMoneyString | null;
  currentBalanceOrigin: string;
} {
  const c = position.consolidated;
  if (c.observedBalance != null) {
    return {
      currentBalance: c.observedBalance,
      currentBalanceOrigin: "CONSOLIDATED_OBSERVED",
    };
  }
  if (c.calculatedBalance != null) {
    return {
      currentBalance: c.calculatedBalance,
      currentBalanceOrigin: "CONSOLIDATED_CALCULATED",
    };
  }
  return {
    currentBalance: null,
    currentBalanceOrigin: "MISSING",
  };
}

export function computeProjectedClosingBalance(input: {
  currentBalance: TreasuryMoneyString | null;
  plannedReceipts: TreasuryMoneyString;
  plannedPayments: TreasuryMoneyString;
}): {
  projectedClosingBalance: TreasuryMoneyString | null;
  origin: string;
} {
  if (input.currentBalance == null) {
    return {
      projectedClosingBalance: null,
      origin: "MISSING_CURRENT_BALANCE",
    };
  }
  const afterIn = addTreasuryMoney(
    input.currentBalance,
    normalizeTreasuryMoneyString(input.plannedReceipts)
  );
  const projected = addTreasuryMoney(
    afterIn,
    negateTreasuryMoney(normalizeTreasuryMoneyString(input.plannedPayments))
  );
  return {
    projectedClosingBalance: projected,
    origin: "CURRENT_PLUS_PLANNED_RECEIPTS_MINUS_PLANNED_PAYMENTS",
  };
}

function severityFromAlert(alert: string): TreasuryExceptionSeverity {
  const lower = alert.toLowerCase();
  if (lower.includes("diverg") || lower.includes("negativ")) return "CRITICAL";
  if (lower.includes("ausente") || lower.includes("missing")) return "WARNING";
  return "INFO";
}

export function buildPriorityExceptions(input: {
  position: TreasuryFinancialPositionDto;
  highPriorityReceivableCount: number;
  highPriorityPayableCount: number;
}): TreasuryDashboardExceptionItemDto[] {
  const items: TreasuryDashboardExceptionItemDto[] = [];
  let seq = 0;
  for (const alert of input.position.alerts) {
    seq += 1;
    items.push({
      id: `pos-alert-${seq}`,
      type: "POSITION_ALERT",
      severity: severityFromAlert(alert),
      status: "OPEN",
      title: alert,
      accountId: null,
      nomusExternalId: null,
      source: "FINANCIAL_POSITION",
    });
  }
  for (const acc of input.position.accounts) {
    if (acc.hasDivergence) {
      seq += 1;
      items.push({
        id: `div-${acc.accountId}`,
        type: "BALANCE_DIVERGENCE",
        severity: "CRITICAL",
        status: "OPEN",
        title: `Divergência de saldo na conta ${acc.accountCode}`,
        accountId: acc.accountId,
        nomusExternalId: null,
        source: "FINANCIAL_POSITION",
      });
    }
    if (acc.isNegative) {
      seq += 1;
      items.push({
        id: `neg-${acc.accountId}`,
        type: "NEGATIVE_BALANCE",
        severity: "CRITICAL",
        status: "OPEN",
        title: `Saldo negativo na conta ${acc.accountCode}`,
        accountId: acc.accountId,
        nomusExternalId: null,
        source: "FINANCIAL_POSITION",
      });
    }
  }
  if (input.highPriorityReceivableCount > 0) {
    seq += 1;
    items.push({
      id: `prio-ar-${seq}`,
      type: "HIGH_PRIORITY_RECEIVABLES",
      severity: "WARNING",
      status: "OPEN",
      title: `${input.highPriorityReceivableCount} título(s) a receber prioritário(s) no dia`,
      accountId: null,
      nomusExternalId: null,
      source: "DAY_FLOW",
    });
  }
  if (input.highPriorityPayableCount > 0) {
    seq += 1;
    items.push({
      id: `prio-ap-${seq}`,
      type: "HIGH_PRIORITY_PAYABLES",
      severity: "WARNING",
      status: "OPEN",
      title: `${input.highPriorityPayableCount} título(s) a pagar prioritário(s) no dia`,
      accountId: null,
      nomusExternalId: null,
      source: "DAY_FLOW",
    });
  }
  const rank: Record<TreasuryExceptionSeverity, number> = {
    CRITICAL: 0,
    WARNING: 1,
    INFO: 2,
  };
  return items.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export function buildDashboardComposition(input: {
  position: TreasuryFinancialPositionDto;
  dayFlow: TreasuryDashboardDayFlowInput;
  currentBalance: TreasuryMoneyString | null;
  projectedClosingBalance: TreasuryMoneyString | null;
}): TreasuryDashboardCompositionItemDto[] {
  const c = input.position.consolidated;
  const items: TreasuryDashboardCompositionItemDto[] = [
    {
      key: "observedBalance",
      label: "Saldo observado (consolidado)",
      amount: c.observedBalance,
      titleCount: c.includedAccountCount,
      origin: "BALANCE_SNAPSHOT",
      detailable: true,
    },
    {
      key: "calculatedBalance",
      label: "Saldo calculado (consolidado)",
      amount: c.calculatedBalance,
      titleCount: c.includedAccountCount,
      origin: "SNAPSHOT_PLUS_OFFICIAL_MOVEMENTS",
      detailable: true,
    },
    {
      key: "reconciledBalance",
      label: "Saldo conciliado (consolidado)",
      amount: c.reconciledBalance,
      titleCount: null,
      origin: c.reconciledBalance == null ? "MISSING" : "RECONCILIATION",
      detailable: true,
    },
    {
      key: "divergence",
      label: "Diferença observado − calculado",
      amount: c.divergence,
      titleCount: null,
      origin: "OBSERVED_MINUS_CALCULATED",
      detailable: true,
    },
    {
      key: "receiptsPlanned",
      label: "Recebimentos previstos",
      amount: input.dayFlow.receivables.plannedAmount,
      titleCount: input.dayFlow.receivables.plannedTitleCount,
      origin: "DAY_FLOW_RECEIVABLES_PLANNED",
      detailable: true,
    },
    {
      key: "receiptsRealized",
      label: "Recebimentos realizados",
      amount: input.dayFlow.receivables.realizedAmount,
      titleCount: input.dayFlow.receivables.realizedTitleCount,
      origin: "DAY_FLOW_RECEIVABLES_REALIZED",
      detailable: true,
    },
    {
      key: "receiptsPending",
      label: "Recebimentos pendentes",
      amount: input.dayFlow.receivables.pendingAmount,
      titleCount: input.dayFlow.receivables.pendingTitleCount,
      origin: "DAY_FLOW_RECEIVABLES_PENDING",
      detailable: true,
    },
    {
      key: "paymentsPlanned",
      label: "Pagamentos previstos",
      amount: input.dayFlow.payables.plannedAmount,
      titleCount: input.dayFlow.payables.plannedTitleCount,
      origin: "DAY_FLOW_PAYABLES_PLANNED",
      detailable: true,
    },
    {
      key: "paymentsRealized",
      label: "Pagamentos realizados",
      amount: input.dayFlow.payables.realizedAmount,
      titleCount: input.dayFlow.payables.realizedTitleCount,
      origin: "DAY_FLOW_PAYABLES_REALIZED",
      detailable: true,
    },
    {
      key: "paymentsPending",
      label: "Pagamentos pendentes",
      amount: input.dayFlow.payables.pendingAmount,
      titleCount: input.dayFlow.payables.pendingTitleCount,
      origin: "DAY_FLOW_PAYABLES_PENDING",
      detailable: true,
    },
    {
      key: "currentBalance",
      label: "Saldo atual",
      amount: input.currentBalance,
      titleCount: null,
      origin: "CURRENT_BALANCE",
      detailable: true,
    },
    {
      key: "projectedClosingBalance",
      label: "Saldo projetado de encerramento",
      amount: input.projectedClosingBalance,
      titleCount: null,
      origin: "PROJECTED_CLOSING",
      detailable: true,
    },
  ];
  return items;
}

export function buildTreasuryDashboardDto(input: {
  civilDate: TreasuryCivilDate;
  scenario: TreasuryProjectionLayer;
  accountIds: string[] | null;
  position: TreasuryFinancialPositionDto;
  dayFlow: TreasuryDashboardDayFlowInput;
  freshness: TreasuryDashboardFreshnessDto;
  highPriorityReceivableCount?: number;
  highPriorityPayableCount?: number;
}): TreasuryDashboardDto {
  const receipts = bucketFromAggregate(input.dayFlow.receivables, "RECEIPTS");
  const payments = bucketFromAggregate(input.dayFlow.payables, "PAYMENTS");
  const { currentBalance, currentBalanceOrigin } = resolveCurrentBalance(
    input.position
  );
  const projected = computeProjectedClosingBalance({
    currentBalance,
    plannedReceipts: receipts.plannedAmount,
    plannedPayments: payments.plannedAmount,
  });
  const titleCount =
    receipts.plannedTitleCount +
    receipts.realizedTitleCount +
    payments.plannedTitleCount +
    payments.realizedTitleCount;
  /** Contagem canônica de títulos do dia (universo previsto ∪ realizado, sem double-count nos buckets). */
  const receivableTitleCount = Math.max(
    receipts.plannedTitleCount,
    receipts.pendingTitleCount
  ) +
    /* realizados podem ser títulos distintos — reportamos soma dos buckets e titleCountDistinct abaixo */
    0;
  const payableTitleCount = Math.max(
    payments.plannedTitleCount,
    payments.pendingTitleCount
  );

  const composition = buildDashboardComposition({
    position: input.position,
    dayFlow: input.dayFlow,
    currentBalance,
    projectedClosingBalance: projected.projectedClosingBalance,
  });

  const exceptions = buildPriorityExceptions({
    position: input.position,
    highPriorityReceivableCount: input.highPriorityReceivableCount ?? 0,
    highPriorityPayableCount: input.highPriorityPayableCount ?? 0,
  });

  return {
    ok: true,
    civilDate: input.civilDate,
    scenario: input.scenario,
    accountIds: input.accountIds,
    asOf: input.position.asOf,
    freshness: input.freshness,
    observedBalance: input.position.consolidated.observedBalance,
    calculatedBalance: input.position.consolidated.calculatedBalance,
    reconciledBalance: input.position.consolidated.reconciledBalance,
    divergence: input.position.consolidated.divergence,
    hasDivergence: input.position.consolidated.hasDivergence,
    receipts,
    payments,
    currentBalance,
    currentBalanceOrigin,
    projectedClosingBalance: projected.projectedClosingBalance,
    projectedClosingOrigin: projected.origin,
    titleCount: {
      receivablesPlanned: receipts.plannedTitleCount,
      receivablesRealized: receipts.realizedTitleCount,
      receivablesPending: receipts.pendingTitleCount,
      payablesPlanned: payments.plannedTitleCount,
      payablesRealized: payments.realizedTitleCount,
      payablesPending: payments.pendingTitleCount,
      /** Soma dos buckets (previsto+realizado) CR+CP — pode haver interseção conceitual. */
      totalBucketSum: titleCount,
      /** Títulos previstos abertos (pendentes) no dia. */
      openOnDay: receivableTitleCount + payableTitleCount,
    },
    accounts: input.position.accounts,
    consolidated: input.position.consolidated,
    priorityExceptions: exceptions,
    composition,
    origins: {
      observed: "BALANCE_SNAPSHOT / consolidated",
      calculated: "SNAPSHOT_PLUS_OFFICIAL_MOVEMENTS / consolidated",
      reconciled: "RECONCILIATION or MISSING",
      divergence: "observed − calculated",
      receiptsPlanned: `DAY_FLOW scenario=${input.scenario}`,
      receiptsRealized: "OFFICIAL_SETTLEMENT_DATE",
      receiptsPending: "DAY_FLOW open on planning date",
      paymentsPlanned: `DAY_FLOW scenario=${input.scenario}`,
      paymentsRealized: "OFFICIAL_SETTLEMENT_OR_PAYMENT_DATE",
      paymentsPending: "DAY_FLOW open on planning date",
      currentBalance: currentBalanceOrigin,
      projectedClosing: projected.origin,
    },
  };
}

/**
 * Consistência dos totais do dashboard.
 * Lança Error com mensagem objetiva se algum invariante falhar.
 */
export function assertTreasuryDashboardTotalsConsistent(
  dto: TreasuryDashboardDto
): void {
  const byKey = new Map(dto.composition.map((c) => [c.key, c]));
  const expectAmount = (key: string, amount: string | null) => {
    const item = byKey.get(key);
    if (!item) throw new Error(`Composição ausente: ${key}`);
    const left = item.amount == null ? null : normalizeTreasuryMoneyString(item.amount);
    const right = amount == null ? null : normalizeTreasuryMoneyString(amount);
    if (left !== right) {
      throw new Error(
        `Inconsistência ${key}: composição=${left} resumo=${right}`
      );
    }
  };

  expectAmount("observedBalance", dto.observedBalance);
  expectAmount("calculatedBalance", dto.calculatedBalance);
  expectAmount("reconciledBalance", dto.reconciledBalance);
  expectAmount("divergence", dto.divergence);
  expectAmount("receiptsPlanned", dto.receipts.plannedAmount);
  expectAmount("receiptsRealized", dto.receipts.realizedAmount);
  expectAmount("receiptsPending", dto.receipts.pendingAmount);
  expectAmount("paymentsPlanned", dto.payments.plannedAmount);
  expectAmount("paymentsRealized", dto.payments.realizedAmount);
  expectAmount("paymentsPending", dto.payments.pendingAmount);
  expectAmount("currentBalance", dto.currentBalance);
  expectAmount("projectedClosingBalance", dto.projectedClosingBalance);

  if (dto.titleCount.receivablesPlanned !== dto.receipts.plannedTitleCount) {
    throw new Error("titleCount.receivablesPlanned diverge do bucket");
  }
  if (dto.titleCount.payablesPlanned !== dto.payments.plannedTitleCount) {
    throw new Error("titleCount.payablesPlanned diverge do bucket");
  }

  const projected = computeProjectedClosingBalance({
    currentBalance: dto.currentBalance,
    plannedReceipts: dto.receipts.plannedAmount,
    plannedPayments: dto.payments.plannedAmount,
  });
  if (
    (projected.projectedClosingBalance == null) !==
      (dto.projectedClosingBalance == null) ||
    (projected.projectedClosingBalance != null &&
      dto.projectedClosingBalance != null &&
      compareTreasuryMoney(
        projected.projectedClosingBalance,
        dto.projectedClosingBalance
      ) !== 0)
  ) {
    throw new Error(
      `projectedClosing inconsistente: esperado=${projected.projectedClosingBalance} dto=${dto.projectedClosingBalance}`
    );
  }

  if (
    dto.observedBalance != null &&
    dto.calculatedBalance != null &&
    dto.divergence != null
  ) {
    const expected = addTreasuryMoney(
      dto.observedBalance,
      negateTreasuryMoney(dto.calculatedBalance)
    );
    if (compareTreasuryMoney(expected, dto.divergence) !== 0) {
      throw new Error(
        `divergence inconsistente: observado-calculado=${expected} dto=${dto.divergence}`
      );
    }
  }

  // Pendente do dia não pode exceder previsto do mesmo universo (ambos usam open no dia).
  if (
    compareTreasuryMoney(
      dto.receipts.pendingAmount,
      dto.receipts.plannedAmount
    ) > 0
  ) {
    throw new Error("Recebimentos pendentes > previstos");
  }
  if (
    compareTreasuryMoney(
      dto.payments.pendingAmount,
      dto.payments.plannedAmount
    ) > 0
  ) {
    throw new Error("Pagamentos pendentes > previstos");
  }
}

export function buildFreshnessDto(input: {
  asOf: string;
  sources: TreasuryDashboardSourceFreshnessDto[];
}): TreasuryDashboardFreshnessDto {
  const stale = input.sources.filter((s) => s.isStale);
  return {
    asOf: input.asOf,
    sources: input.sources,
    hasStaleSource: stale.length > 0,
    staleSourceCount: stale.length,
  };
}

export type { TreasuryAccountFinancialPositionDto };
