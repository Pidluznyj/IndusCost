/**
 * Regras puras — posição financeira atual (observado / operacional / calculado / conciliado).
 * Divergências e ausência de saldo nunca são omitidas nem zeradas silenciosamente.
 */

import type {
  TreasuryAccountFinancialPositionDto,
  TreasuryConsolidatedFinancialPositionDto,
  TreasuryPositionValueOriginMeta,
} from "../contracts/treasuryDto.js";
import type {
  TreasuryAccountLiquidity,
  TreasuryBalanceLayer,
  TreasuryBalanceOrigin,
  TreasuryLedgerDirection,
} from "../contracts/treasuryEnums.js";
import { formatTreasuryTimestampIso } from "../contracts/treasuryTimestamp.js";
import {
  addTreasuryMoney,
  compareTreasuryMoney,
  negateTreasuryMoney,
  normalizeTreasuryMoneyString,
  type TreasuryMoneyString,
} from "../treasuryMoney.js";
import { computeTreasuryBalanceSnapshotAmounts } from "./treasuryBalanceRules.js";

export type TreasuryOfficialRealizedMovement = {
  id: string;
  accountId: string;
  /** Instantâneo do movimento realizado (UTC). */
  occurredAt: Date;
  amount: string;
  direction: TreasuryLedgerDirection;
  /** ACTIVE movimentos entram; REVERSED são ignorados pelo agregador. */
  status: "ACTIVE" | "REVERSED" | string;
  source: string;
  memo?: string | null;
};

export type TreasuryReconciledBalanceHint = {
  accountId: string;
  reconciledBalance: string;
  reconciledAt: Date;
  source: string;
};

export type TreasuryPositionAccountInput = {
  id: string;
  code: string;
  name: string;
  accountType: string;
  includeInConsolidated: boolean;
  liquidity: TreasuryAccountLiquidity | string;
  allowNegativeBalance: boolean;
  isActive: boolean;
};

export type TreasuryPositionSnapshotInput = {
  id: string;
  accountId: string;
  referenceAt: Date;
  availableBalance: string;
  blockedBalance: string;
  investmentsBalance: string;
  usedLimit: string;
  origin: TreasuryBalanceOrigin | string;
};

const MISSING: TreasuryPositionValueOriginMeta = {
  origin: "MISSING",
  detail: "Valor ausente — sem fonte válida.",
};

function moneyOrNull(
  value: string | null | undefined
): TreasuryMoneyString | null {
  if (value == null || value === "") return null;
  return normalizeTreasuryMoneyString(value);
}

export function netOfficialMovements(
  movements: TreasuryOfficialRealizedMovement[]
): TreasuryMoneyString {
  let net = "0.00";
  for (const m of movements) {
    if (m.status !== "ACTIVE") continue;
    const amount = normalizeTreasuryMoneyString(m.amount);
    net =
      m.direction === "CREDIT"
        ? addTreasuryMoney(net, amount)
        : addTreasuryMoney(net, negateTreasuryMoney(amount));
  }
  return net;
}

export function filterMovementsAfterSnapshot(
  movements: TreasuryOfficialRealizedMovement[],
  snapshotReferenceAt: Date | null
): TreasuryOfficialRealizedMovement[] {
  if (!snapshotReferenceAt) return movements.filter((m) => m.status === "ACTIVE");
  const ts = snapshotReferenceAt.getTime();
  return movements.filter(
    (m) => m.status === "ACTIVE" && m.occurredAt.getTime() > ts
  );
}

export function computeDivergence(
  observed: string | null,
  calculated: string | null
): { divergence: string | null; hasDivergence: boolean } {
  if (observed == null || calculated == null) {
    return { divergence: null, hasDivergence: false };
  }
  const divergence = addTreasuryMoney(
    normalizeTreasuryMoneyString(observed),
    negateTreasuryMoney(normalizeTreasuryMoneyString(calculated))
  );
  return {
    divergence,
    hasDivergence: compareTreasuryMoney(divergence, "0.00") !== 0,
  };
}

/**
 * Calcula posição de uma conta a partir do último snapshot + movimentos oficiais.
 * Reconciled permanece MISSING até existir fonte de conciliação.
 */
export function computeTreasuryAccountFinancialPosition(input: {
  account: TreasuryPositionAccountInput;
  snapshot: TreasuryPositionSnapshotInput | null;
  movements: TreasuryOfficialRealizedMovement[];
  reconciled?: TreasuryReconciledBalanceHint | null;
}): TreasuryAccountFinancialPositionDto {
  const account = input.account;
  const alerts: string[] = [];
  const layers: TreasuryBalanceLayer[] = ["observed", "calculated", "reconciled"];

  let observedBalance: string | null = null;
  let operationalAvailableBalance: string | null = null;
  let blockedBalance: string | null = null;
  let investmentsBalance: string | null = null;
  let usedLimit: string | null = null;
  let originsObserved = MISSING;
  let originsOperational = MISSING;
  let originsBlocked = MISSING;
  let originsInvestments = MISSING;
  let originsUsedLimit = MISSING;

  if (input.snapshot) {
    const amounts = computeTreasuryBalanceSnapshotAmounts({
      availableBalance: input.snapshot.availableBalance,
      blockedBalance: input.snapshot.blockedBalance,
      investmentsBalance: input.snapshot.investmentsBalance,
      usedLimit: input.snapshot.usedLimit,
    });
    observedBalance = amounts.observedBalance;
    operationalAvailableBalance = amounts.operationalAvailableBalance;
    blockedBalance = amounts.blockedBalance;
    investmentsBalance = amounts.investmentsBalance;
    usedLimit = amounts.usedLimit;
    const snapDetail = `Último snapshot válido ${input.snapshot.id} (origem ${input.snapshot.origin}).`;
    originsObserved = { origin: "BALANCE_SNAPSHOT", detail: snapDetail };
    originsOperational = { origin: "BALANCE_SNAPSHOT", detail: snapDetail };
    originsBlocked = { origin: "BALANCE_SNAPSHOT", detail: snapDetail };
    originsInvestments = { origin: "BALANCE_SNAPSHOT", detail: snapDetail };
    originsUsedLimit = { origin: "BALANCE_SNAPSHOT", detail: snapDetail };
  } else {
    alerts.push("Ausência de saldo: nenhum snapshot válido para a conta.");
  }

  const relevantMovements = filterMovementsAfterSnapshot(
    input.movements,
    input.snapshot?.referenceAt ?? null
  );
  const officialMovementNet = netOfficialMovements(relevantMovements);
  const officialMovementCount = relevantMovements.filter(
    (m) => m.status === "ACTIVE"
  ).length;

  let calculatedBalance: string | null;
  let originsCalculated: TreasuryPositionValueOriginMeta;

  if (input.snapshot && observedBalance != null) {
    calculatedBalance = addTreasuryMoney(observedBalance, officialMovementNet);
    originsCalculated = {
      origin: "SNAPSHOT_PLUS_OFFICIAL_MOVEMENTS",
      detail: `Snapshot observado + ${officialMovementCount} movimento(s) oficial(is) realizado(s) após ${formatTreasuryTimestampIso(input.snapshot.referenceAt)}.`,
    };
  } else if (officialMovementCount > 0) {
    calculatedBalance = officialMovementNet;
    originsCalculated = {
      origin: "OFFICIAL_MOVEMENTS_ONLY",
      detail: `Sem snapshot — ${officialMovementCount} movimento(s) oficial(is) realizado(s) desde baseline zero.`,
    };
    alerts.push(
      "Saldo calculado só com movimentos oficiais (sem snapshot de abertura)."
    );
  } else {
    calculatedBalance = "0.00";
    originsCalculated = {
      origin: "ZERO_BASELINE",
      detail:
        "Sem snapshot e sem movimentos oficiais — baseline zero explícito (não é saldo observado).",
    };
    alerts.push(
      "Saldo calculado em baseline zero (sem snapshot e sem movimentos)."
    );
  }

  let reconciledBalance: string | null = null;
  let originsReconciled = {
    origin: "MISSING" as const,
    detail:
      "Saldo conciliado indisponível — conciliação bancária ainda não aplicada a esta conta.",
  };
  if (input.reconciled) {
    reconciledBalance = normalizeTreasuryMoneyString(
      input.reconciled.reconciledBalance
    );
    originsReconciled = {
      origin: "RECONCILIATION",
      detail: `Conciliação ${input.reconciled.source} em ${formatTreasuryTimestampIso(input.reconciled.reconciledAt)}.`,
    };
  } else {
    alerts.push("Saldo conciliado ausente (divergência de conciliação não ocultada).");
  }

  const { divergence, hasDivergence } = computeDivergence(
    observedBalance,
    calculatedBalance
  );
  if (hasDivergence && divergence != null) {
    alerts.push(
      `Divergência observado vs calculado: ${divergence} (não ocultada).`
    );
  }
  if (observedBalance == null && calculatedBalance != null) {
    alerts.push(
      "Divergência parcial: observado ausente; calculado presente."
    );
  }

  const negativeProbe =
    operationalAvailableBalance ?? observedBalance ?? calculatedBalance;
  const isNegative =
    negativeProbe != null &&
    compareTreasuryMoney(normalizeTreasuryMoneyString(negativeProbe), "0.00") <
      0;
  if (isNegative) {
    alerts.push(
      account.allowNegativeBalance
        ? "Conta com saldo negativo (negativo permitido)."
        : "Conta com saldo negativo (negativo não permitido na configuração)."
    );
  }

  if (
    String(account.accountType) === "INVESTMENT" ||
    compareTreasuryMoney(investmentsBalance ?? "0.00", "0.00") > 0
  ) {
    alerts.push(
      `Aplicação/liquidez: ${account.liquidity} (exposta separadamente do operacional).`
    );
  }

  return {
    accountId: account.id,
    accountCode: account.code,
    accountName: account.name,
    accountType: account.accountType,
    includeInConsolidated: account.includeInConsolidated,
    liquidity: account.liquidity,
    allowNegativeBalance: account.allowNegativeBalance,
    isNegative,
    hasSnapshot: Boolean(input.snapshot),
    snapshotId: input.snapshot?.id ?? null,
    snapshotReferenceAt: input.snapshot
      ? formatTreasuryTimestampIso(input.snapshot.referenceAt)
      : null,
    snapshotOrigin: input.snapshot?.origin ?? null,
    observedBalance: moneyOrNull(observedBalance),
    operationalAvailableBalance: moneyOrNull(operationalAvailableBalance),
    calculatedBalance: moneyOrNull(calculatedBalance),
    reconciledBalance: moneyOrNull(reconciledBalance),
    divergence: moneyOrNull(divergence),
    hasDivergence,
    blockedBalance: moneyOrNull(blockedBalance),
    investmentsBalance: moneyOrNull(investmentsBalance),
    usedLimit: moneyOrNull(usedLimit),
    officialMovementCount,
    officialMovementNet,
    origins: {
      observed: originsObserved,
      operationalAvailable: originsOperational,
      calculated: originsCalculated,
      reconciled: originsReconciled,
      blocked: originsBlocked,
      investments: originsInvestments,
      usedLimit: originsUsedLimit,
    },
    alerts,
    layers,
  };
}

function sumNullable(values: Array<string | null>): string | null {
  const present = values.filter((v): v is string => v != null);
  if (!present.length) return null;
  return present.reduce((acc, v) => addTreasuryMoney(acc, v), "0.00");
}

export function consolidateTreasuryFinancialPositions(
  accounts: TreasuryAccountFinancialPositionDto[]
): TreasuryConsolidatedFinancialPositionDto {
  const included = accounts.filter((a) => a.includeInConsolidated);
  const excluded = accounts.filter((a) => !a.includeInConsolidated);
  const missingSnapshot = included.filter((a) => !a.hasSnapshot).length;

  const observedBalance = sumNullable(included.map((a) => a.observedBalance));
  const operationalAvailableBalance = sumNullable(
    included.map((a) => a.operationalAvailableBalance)
  );
  const calculatedBalance = sumNullable(
    included.map((a) => a.calculatedBalance)
  );
  const reconciledPresent = included.filter((a) => a.reconciledBalance != null);
  const reconciledBalance =
    reconciledPresent.length === included.length && included.length > 0
      ? sumNullable(included.map((a) => a.reconciledBalance))
      : null;

  const { divergence, hasDivergence } = computeDivergence(
    observedBalance,
    calculatedBalance
  );

  const alerts: string[] = [];
  if (excluded.length) {
    alerts.push(
      `${excluded.length} conta(s) fora do consolidado (não somadas).`
    );
  }
  if (missingSnapshot > 0) {
    alerts.push(
      `${missingSnapshot} conta(s) do consolidado sem snapshot — observado consolidado pode estar incompleto.`
    );
  }
  if (hasDivergence && divergence != null) {
    alerts.push(
      `Divergência consolidada observado vs calculado: ${divergence}.`
    );
  }
  if (reconciledBalance == null && included.length > 0) {
    alerts.push(
      "Saldo conciliado consolidado ausente (nem todas as contas têm conciliação)."
    );
  }

  return {
    accountCount: accounts.length,
    includedAccountCount: included.length,
    excludedAccountCount: excluded.length,
    accountsMissingSnapshot: missingSnapshot,
    observedBalance,
    operationalAvailableBalance,
    calculatedBalance,
    reconciledBalance,
    divergence,
    hasDivergence,
    blockedBalance: sumNullable(included.map((a) => a.blockedBalance)),
    investmentsBalance: sumNullable(
      included.map((a) => a.investmentsBalance)
    ),
    usedLimit: sumNullable(included.map((a) => a.usedLimit)),
    alerts,
  };
}
