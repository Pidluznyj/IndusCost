/**
 * Domínio da rotina diária por conta (fluxo simples).
 *
 * Reuso deliberado — sem model Prisma novo:
 * - Saldo inicial / saldo final bancário → evidência em `TreasuryBalanceSnapshot`
 *   (origem MANUAL, chave idempotente versionada por conta+data civil).
 * - CLOSED / REOPENED → `TreasuryDailyClosing` + `TreasuryDailyClosingAccountPosition`.
 * - Sugestão de abertura → `observedBalance` do último fechamento CLOSED da conta.
 * - Auditoria → `TreasuryAuditLog` (append-only).
 * - Previsto / realizado / divergência → calculados (fórmulas canônicas).
 *
 * Sem exclusão física; concorrência via expectedVersion; timestamps do servidor.
 */

import {
  isTreasuryCivilDate,
  parseTreasuryCivilDate,
  type TreasuryCivilDate,
} from "../contracts/treasuryCivilDate.js";
import type {
  TreasuryClosingStatus,
  TreasuryDailyAccountRoutineStatus,
  TreasuryDailyOpeningBalanceOrigin,
} from "../contracts/treasuryEnums.js";
import {
  addTreasuryMoney,
  normalizeTreasuryMoneyString,
  subtractTreasuryMoney,
  type TreasuryMoneyString,
} from "../treasuryMoney.js";
import {
  canTreasuryActorMutateAccountBalance,
  type TreasuryAccountAccessSnapshot,
  type TreasuryAccountActor,
} from "./treasuryAccountRules.js";
import { TreasuryDomainError } from "./treasuryErrors.js";

export const TREASURY_DAILY_ACCOUNT_ROUTINE_ENTITY_TYPE =
  "TreasuryDailyAccountRoutine" as const;

export const TREASURY_DAILY_OPENING_SNAPSHOT_KEY_PREFIX =
  "daily-opening" as const;
export const TREASURY_DAILY_CLOSING_BANK_SNAPSHOT_KEY_PREFIX =
  "daily-closing-bank" as const;

/** Movimentos do dia usados nas fórmulas (já filtrados por conta/data). */
export type TreasuryDailyAccountRoutineDayFlow = {
  plannedReceivables: string;
  plannedPayables: string;
  plannedTransferIn: string;
  plannedTransferOut: string;
  plannedManualEntries: string;
  settledReceivables: string;
  settledPayables: string;
  realizedLocalInflows: string;
  realizedLocalOutflows: string;
  realizedTransferIn: string;
  realizedTransferOut: string;
};

export type TreasuryDailyAccountRoutineInformedBalance = {
  amount: TreasuryMoneyString;
  informedByUserId: string;
  informedAt: string;
  /** Origem apenas do saldo inicial. */
  origin?: TreasuryDailyOpeningBalanceOrigin;
  notes?: string | null;
  version: number;
};

export type TreasuryDailyAccountRoutineCaveat = {
  code: string;
  message: string;
  acknowledged: boolean;
};

export type TreasuryDailyAccountRoutineState = {
  accountId: string;
  civilDate: TreasuryCivilDate;
  status: TreasuryDailyAccountRoutineStatus;
  openingBalance: TreasuryDailyAccountRoutineInformedBalance | null;
  closingBankBalance: TreasuryDailyAccountRoutineInformedBalance | null;
  predictedClosingBalance: TreasuryMoneyString | null;
  realizedClosingBalance: TreasuryMoneyString | null;
  divergence: TreasuryMoneyString | null;
  notes: string | null;
  caveats: readonly TreasuryDailyAccountRoutineCaveat[];
  /** Versão otimista da rotina (max das versões de abertura/fechamento bancário). */
  version: number;
  /** Quando vinculado a fechamento formal. */
  formalClosingId: string | null;
  formalClosingStatus: TreasuryClosingStatus | null;
};

export type TreasuryDailyOpeningSuggestion = {
  suggestedAmount: TreasuryMoneyString | null;
  sourceClosingId: string | null;
  sourceCivilDate: TreasuryCivilDate | null;
  requiresManualInput: boolean;
  reason:
    | "PREVIOUS_CLOSING_OBSERVED"
    | "NO_PREVIOUS_CLOSING"
    | "ACCOUNT_INACTIVE";
};

export type TreasuryDailyAccountRoutineAuditPayload = {
  entityType: typeof TREASURY_DAILY_ACCOUNT_ROUTINE_ENTITY_TYPE;
  entityId: string;
  action: string;
  accountId: string;
  civilDate: TreasuryCivilDate;
  field: "openingBalance" | "closingBankBalance" | "status" | "notes";
  previousValue: string | null;
  newValue: string | null;
  userId: string;
  occurredAt: string;
  reason: string | null;
  origin: string;
  beforeJson: Record<string, unknown> | null;
  afterJson: Record<string, unknown>;
};

function money(value: string | null | undefined): TreasuryMoneyString {
  return normalizeTreasuryMoneyString(
    value == null || value === "" ? "0" : value
  );
}

function assertMoneyField(value: string, field: string): TreasuryMoneyString {
  try {
    return normalizeTreasuryMoneyString(value);
  } catch {
    throw new TreasuryDomainError(
      "INVALID_MONEY",
      `${field} inválido (use string decimal com até 2 casas).`,
      field
    );
  }
}

export function buildTreasuryDailyAccountRoutineEntityId(input: {
  accountId: string;
  civilDate: TreasuryCivilDate;
}): string {
  return `${input.accountId}:${input.civilDate}`;
}

export function buildTreasuryDailyOpeningSnapshotIdempotencyKey(input: {
  civilDate: TreasuryCivilDate;
  version: number;
}): string {
  if (!Number.isInteger(input.version) || input.version < 1) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "Versão do saldo inicial deve ser inteiro >= 1.",
      "version"
    );
  }
  return `${TREASURY_DAILY_OPENING_SNAPSHOT_KEY_PREFIX}:${input.civilDate}:v${input.version}`;
}

export function buildTreasuryDailyClosingBankSnapshotIdempotencyKey(input: {
  civilDate: TreasuryCivilDate;
  version: number;
}): string {
  if (!Number.isInteger(input.version) || input.version < 1) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "Versão do saldo final bancário deve ser inteiro >= 1.",
      "version"
    );
  }
  return `${TREASURY_DAILY_CLOSING_BANK_SNAPSHOT_KEY_PREFIX}:${input.civilDate}:v${input.version}`;
}

export function parseTreasuryDailyRoutineSnapshotKey(key: string): {
  kind: "opening" | "closingBank";
  civilDate: TreasuryCivilDate;
  version: number;
} | null {
  const opening = new RegExp(
    `^${TREASURY_DAILY_OPENING_SNAPSHOT_KEY_PREFIX}:(\\d{4}-\\d{2}-\\d{2}):v(\\d+)$`
  ).exec(key.trim());
  if (opening) {
    return {
      kind: "opening",
      civilDate: parseTreasuryCivilDate(opening[1]),
      version: Number(opening[2]),
    };
  }
  const closing = new RegExp(
    `^${TREASURY_DAILY_CLOSING_BANK_SNAPSHOT_KEY_PREFIX}:(\\d{4}-\\d{2}-\\d{2}):v(\\d+)$`
  ).exec(key.trim());
  if (closing) {
    return {
      kind: "closingBank",
      civilDate: parseTreasuryCivilDate(closing[1]),
      version: Number(closing[2]),
    };
  }
  return null;
}

/**
 * Sugere saldo inicial a partir do último observedBalance fechado da conta.
 * Sem fechamento anterior: sugestão null e exige informação manual (não assume 0).
 */
export function suggestTreasuryDailyOpeningBalance(input: {
  accountIsActive: boolean;
  previousClosedPosition: {
    closingId: string;
    civilDate: string;
    observedBalance: string;
  } | null;
}): TreasuryDailyOpeningSuggestion {
  if (!input.accountIsActive) {
    return {
      suggestedAmount: null,
      sourceClosingId: null,
      sourceCivilDate: null,
      requiresManualInput: true,
      reason: "ACCOUNT_INACTIVE",
    };
  }
  if (!input.previousClosedPosition) {
    return {
      suggestedAmount: null,
      sourceClosingId: null,
      sourceCivilDate: null,
      requiresManualInput: true,
      reason: "NO_PREVIOUS_CLOSING",
    };
  }
  const civilDate = parseTreasuryCivilDate(
    input.previousClosedPosition.civilDate,
    "previousClosedPosition.civilDate"
  );
  return {
    suggestedAmount: assertMoneyField(
      input.previousClosedPosition.observedBalance,
      "previousClosedPosition.observedBalance"
    ),
    sourceClosingId: input.previousClosedPosition.closingId,
    sourceCivilDate: civilDate,
    requiresManualInput: false,
    reason: "PREVIOUS_CLOSING_OBSERVED",
  };
}

/** Fórmula canônica — saldo final previsto. */
export function computeTreasuryDailyPredictedClosingBalance(input: {
  openingBalance: string;
  dayFlow: TreasuryDailyAccountRoutineDayFlow;
}): TreasuryMoneyString {
  const opening = assertMoneyField(input.openingBalance, "openingBalance");
  let predicted = opening;
  predicted = addTreasuryMoney(predicted, money(input.dayFlow.plannedReceivables));
  predicted = subtractTreasuryMoney(
    predicted,
    money(input.dayFlow.plannedPayables)
  );
  predicted = addTreasuryMoney(predicted, money(input.dayFlow.plannedTransferIn));
  predicted = subtractTreasuryMoney(
    predicted,
    money(input.dayFlow.plannedTransferOut)
  );
  predicted = addTreasuryMoney(
    predicted,
    money(input.dayFlow.plannedManualEntries)
  );
  return predicted;
}

/** Fórmula canônica — saldo final realizado calculado. */
export function computeTreasuryDailyRealizedClosingBalance(input: {
  openingBalance: string;
  dayFlow: TreasuryDailyAccountRoutineDayFlow;
}): TreasuryMoneyString {
  const opening = assertMoneyField(input.openingBalance, "openingBalance");
  let realized = opening;
  realized = addTreasuryMoney(realized, money(input.dayFlow.settledReceivables));
  realized = subtractTreasuryMoney(
    realized,
    money(input.dayFlow.settledPayables)
  );
  realized = addTreasuryMoney(
    realized,
    money(input.dayFlow.realizedLocalInflows)
  );
  realized = subtractTreasuryMoney(
    realized,
    money(input.dayFlow.realizedLocalOutflows)
  );
  realized = addTreasuryMoney(realized, money(input.dayFlow.realizedTransferIn));
  realized = subtractTreasuryMoney(
    realized,
    money(input.dayFlow.realizedTransferOut)
  );
  return realized;
}

/** Divergência = saldo final bancário informado − saldo final realizado calculado. */
export function computeTreasuryDailyDivergence(input: {
  informedClosingBankBalance: string;
  realizedClosingBalance: string;
}): TreasuryMoneyString {
  return subtractTreasuryMoney(
    assertMoneyField(
      input.informedClosingBankBalance,
      "informedClosingBankBalance"
    ),
    assertMoneyField(input.realizedClosingBalance, "realizedClosingBalance")
  );
}

export function deriveTreasuryDailyAccountRoutineStatus(input: {
  openingBalance: string | null;
  closingBankBalance: string | null;
  divergence: string | null;
  formalClosingStatus: TreasuryClosingStatus | null;
  caveats?: readonly TreasuryDailyAccountRoutineCaveat[];
}): TreasuryDailyAccountRoutineStatus {
  if (input.formalClosingStatus === "CLOSED") return "CLOSED";
  if (input.formalClosingStatus === "REOPENED") return "REOPENED";

  if (input.openingBalance == null) return "NOT_STARTED";
  if (input.closingBankBalance == null) return "OPEN";

  const divergence = money(input.divergence ?? "0.00");
  const hasOpenCaveat = (input.caveats ?? []).some((c) => !c.acknowledged);
  if (divergence !== "0.00" || hasOpenCaveat) return "NEEDS_REVIEW";
  return "READY_TO_CLOSE";
}

export function assertTreasuryDailyAccountRoutineCivilDate(
  value: unknown,
  field = "civilDate"
): TreasuryCivilDate {
  if (!isTreasuryCivilDate(value)) {
    throw new TreasuryDomainError(
      "INVALID_CIVIL_DATE",
      `${field} inválido (esperado YYYY-MM-DD, fuso operacional America/Sao_Paulo).`,
      field
    );
  }
  return value;
}

/**
 * Horário de gravação vem do servidor (`recordedAt`).
 * Não confiar no relógio do navegador.
 */
export function assertTreasuryDailyRoutineServerTimestamp(
  recordedAt: Date | string,
  field = "recordedAt"
): string {
  const d = recordedAt instanceof Date ? recordedAt : new Date(recordedAt);
  if (Number.isNaN(d.getTime())) {
    throw new TreasuryDomainError(
      "INVALID_TIMESTAMP",
      `${field} inválido (use instante do servidor).`,
      field
    );
  }
  return d.toISOString();
}

export function assertTreasuryDailyAccountRoutineMutable(input: {
  status: TreasuryDailyAccountRoutineStatus;
  action: "open" | "correct_opening" | "inform_closing" | "annotate";
}): void {
  if (input.status === "CLOSED") {
    throw new TreasuryDomainError(
      "DAY_CLOSED",
      "Rotina diária CLOSED não admite alteração; reabra o fechamento formal.",
      "status"
    );
  }
}

export function assertTreasuryDailyAccountRoutineConcurrency(input: {
  currentVersion: number;
  expectedVersion: number;
}): void {
  if (
    !Number.isInteger(input.currentVersion) ||
    !Number.isInteger(input.expectedVersion)
  ) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "Versões de concorrência devem ser inteiros.",
      "expectedVersion"
    );
  }
  if (input.currentVersion !== input.expectedVersion) {
    throw new TreasuryDomainError(
      "CONFLICT",
      "Rotina diária desatualizada. Recarregue e tente novamente.",
      "expectedVersion"
    );
  }
}

export function assertTreasuryDailyAccountRoutineCanMutate(input: {
  accountIsActive: boolean;
  actor: TreasuryAccountActor;
  access: TreasuryAccountAccessSnapshot | null;
}): void {
  if (!input.accountIsActive) {
    throw new TreasuryDomainError(
      "CONFLICT",
      "Conta financeira inativa não admite rotina diária.",
      "accountId"
    );
  }
  if (!canTreasuryActorMutateAccountBalance(input.actor, input.access)) {
    throw new TreasuryDomainError(
      "FORBIDDEN",
      "Usuário sem permissão para informar saldo da conta.",
      "accountId"
    );
  }
}

/**
 * Primeira abertura ou correção do saldo inicial.
 * Sem sugestão prévia: amount é obrigatório (não assume zero).
 */
export function planTreasuryDailyOpeningBalance(input: {
  accountId: string;
  civilDate: string;
  current: TreasuryDailyAccountRoutineState | null;
  expectedVersion: number;
  amount: string | null | undefined;
  confirmSuggestedAmount?: string | null;
  suggestion: TreasuryDailyOpeningSuggestion;
  actorUserId: string;
  recordedAt: Date | string;
  notes?: string | null;
  reason?: string | null;
}): {
  next: TreasuryDailyAccountRoutineState;
  audit: TreasuryDailyAccountRoutineAuditPayload;
  snapshotIdempotencyKey: string;
  snapshotOrigin: "MANUAL";
} {
  const civilDate = assertTreasuryDailyAccountRoutineCivilDate(input.civilDate);
  const recordedAt = assertTreasuryDailyRoutineServerTimestamp(input.recordedAt);
  const currentVersion = input.current?.version ?? 0;
  assertTreasuryDailyAccountRoutineConcurrency({
    currentVersion,
    expectedVersion: input.expectedVersion,
  });
  if (input.current) {
    assertTreasuryDailyAccountRoutineMutable({
      status: input.current.status,
      action: input.current.openingBalance ? "correct_opening" : "open",
    });
  }

  let amount: TreasuryMoneyString;
  let origin: TreasuryDailyOpeningBalanceOrigin;

  const confirm = input.confirmSuggestedAmount?.trim();
  if (confirm != null && confirm !== "") {
    if (input.suggestion.suggestedAmount == null) {
      throw new TreasuryDomainError(
        "VALIDATION_ERROR",
        "Não há saldo sugerido para confirmar; informe o valor manualmente.",
        "confirmSuggestedAmount"
      );
    }
    const confirmed = assertMoneyField(confirm, "confirmSuggestedAmount");
    if (confirmed !== input.suggestion.suggestedAmount) {
      throw new TreasuryDomainError(
        "VALIDATION_ERROR",
        "Valor confirmado difere da sugestão do fechamento anterior.",
        "confirmSuggestedAmount"
      );
    }
    amount = confirmed;
    origin = "PREVIOUS_CLOSING";
  } else if (input.amount != null && String(input.amount).trim() !== "") {
    amount = assertMoneyField(String(input.amount), "amount");
    origin =
      input.suggestion.suggestedAmount != null &&
      amount === input.suggestion.suggestedAmount
        ? "PREVIOUS_CLOSING"
        : "MANUAL";
  } else if (input.suggestion.requiresManualInput) {
    throw new TreasuryDomainError(
      "REQUIRED_FIELD",
      "Sem fechamento anterior: informe o saldo inicial manualmente (não assumir zero).",
      "amount"
    );
  } else {
    throw new TreasuryDomainError(
      "REQUIRED_FIELD",
      "Informe ou confirme o saldo inicial.",
      "amount"
    );
  }

  const nextVersion = currentVersion + 1;
  const opening: TreasuryDailyAccountRoutineInformedBalance = {
    amount,
    informedByUserId: input.actorUserId,
    informedAt: recordedAt,
    origin,
    notes: input.notes?.trim() || null,
    version: nextVersion,
  };

  const base: TreasuryDailyAccountRoutineState = input.current ?? {
    accountId: input.accountId,
    civilDate,
    status: "NOT_STARTED",
    openingBalance: null,
    closingBankBalance: null,
    predictedClosingBalance: null,
    realizedClosingBalance: null,
    divergence: null,
    notes: null,
    caveats: [],
    version: 0,
    formalClosingId: null,
    formalClosingStatus: null,
  };

  const next: TreasuryDailyAccountRoutineState = {
    ...base,
    civilDate,
    openingBalance: opening,
    notes: input.notes?.trim() || base.notes,
    version: nextVersion,
    status: deriveTreasuryDailyAccountRoutineStatus({
      openingBalance: opening.amount,
      closingBankBalance: base.closingBankBalance?.amount ?? null,
      divergence: base.divergence,
      formalClosingStatus: base.formalClosingStatus,
      caveats: base.caveats,
    }),
  };

  if (next.closingBankBalance && next.realizedClosingBalance) {
    next.divergence = computeTreasuryDailyDivergence({
      informedClosingBankBalance: next.closingBankBalance.amount,
      realizedClosingBalance: next.realizedClosingBalance,
    });
    next.status = deriveTreasuryDailyAccountRoutineStatus({
      openingBalance: next.openingBalance?.amount ?? null,
      closingBankBalance: next.closingBankBalance.amount,
      divergence: next.divergence,
      formalClosingStatus: next.formalClosingStatus,
      caveats: next.caveats,
    });
  }

  const entityId = buildTreasuryDailyAccountRoutineEntityId({
    accountId: input.accountId,
    civilDate,
  });

  return {
    next,
    snapshotIdempotencyKey: buildTreasuryDailyOpeningSnapshotIdempotencyKey({
      civilDate,
      version: nextVersion,
    }),
    snapshotOrigin: "MANUAL",
    audit: {
      entityType: TREASURY_DAILY_ACCOUNT_ROUTINE_ENTITY_TYPE,
      entityId,
      action:
        base.openingBalance == null
          ? "DAILY_OPENING_SET"
          : "DAILY_OPENING_CORRECTED",
      accountId: input.accountId,
      civilDate,
      field: "openingBalance",
      previousValue: base.openingBalance?.amount ?? null,
      newValue: amount,
      userId: input.actorUserId,
      occurredAt: recordedAt,
      reason: input.reason?.trim() || null,
      origin,
      beforeJson: base.openingBalance
        ? {
            amount: base.openingBalance.amount,
            version: base.openingBalance.version,
            origin: base.openingBalance.origin ?? null,
          }
        : null,
      afterJson: {
        amount: opening.amount,
        version: opening.version,
        origin: opening.origin ?? null,
        informedByUserId: opening.informedByUserId,
        informedAt: opening.informedAt,
        notes: opening.notes,
      },
    },
  };
}

export function planTreasuryDailyClosingBankBalance(input: {
  accountId: string;
  civilDate: string;
  current: TreasuryDailyAccountRoutineState;
  expectedVersion: number;
  amount: string;
  actorUserId: string;
  recordedAt: Date | string;
  dayFlow: TreasuryDailyAccountRoutineDayFlow;
  notes?: string | null;
  reason?: string | null;
}): {
  next: TreasuryDailyAccountRoutineState;
  audit: TreasuryDailyAccountRoutineAuditPayload;
  snapshotIdempotencyKey: string;
  snapshotOrigin: "MANUAL";
} {
  const civilDate = assertTreasuryDailyAccountRoutineCivilDate(input.civilDate);
  const recordedAt = assertTreasuryDailyRoutineServerTimestamp(input.recordedAt);
  assertTreasuryDailyAccountRoutineConcurrency({
    currentVersion: input.current.version,
    expectedVersion: input.expectedVersion,
  });
  assertTreasuryDailyAccountRoutineMutable({
    status: input.current.status,
    action: "inform_closing",
  });
  if (!input.current.openingBalance) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "Informe o saldo inicial antes do saldo final bancário.",
      "openingBalance"
    );
  }

  const amount = assertMoneyField(input.amount, "amount");
  const nextVersion = input.current.version + 1;
  const realized = computeTreasuryDailyRealizedClosingBalance({
    openingBalance: input.current.openingBalance.amount,
    dayFlow: input.dayFlow,
  });
  const predicted = computeTreasuryDailyPredictedClosingBalance({
    openingBalance: input.current.openingBalance.amount,
    dayFlow: input.dayFlow,
  });
  const divergence = computeTreasuryDailyDivergence({
    informedClosingBankBalance: amount,
    realizedClosingBalance: realized,
  });

  const closingBank: TreasuryDailyAccountRoutineInformedBalance = {
    amount,
    informedByUserId: input.actorUserId,
    informedAt: recordedAt,
    notes: input.notes?.trim() || null,
    version: nextVersion,
  };

  const next: TreasuryDailyAccountRoutineState = {
    ...input.current,
    civilDate,
    closingBankBalance: closingBank,
    predictedClosingBalance: predicted,
    realizedClosingBalance: realized,
    divergence,
    notes: input.notes?.trim() || input.current.notes,
    version: nextVersion,
    status: deriveTreasuryDailyAccountRoutineStatus({
      openingBalance: input.current.openingBalance.amount,
      closingBankBalance: amount,
      divergence,
      formalClosingStatus: input.current.formalClosingStatus,
      caveats: input.current.caveats,
    }),
  };

  const entityId = buildTreasuryDailyAccountRoutineEntityId({
    accountId: input.accountId,
    civilDate,
  });

  return {
    next,
    snapshotIdempotencyKey: buildTreasuryDailyClosingBankSnapshotIdempotencyKey({
      civilDate,
      version: nextVersion,
    }),
    snapshotOrigin: "MANUAL",
    audit: {
      entityType: TREASURY_DAILY_ACCOUNT_ROUTINE_ENTITY_TYPE,
      entityId,
      action:
        input.current.closingBankBalance == null
          ? "DAILY_CLOSING_BANK_SET"
          : "DAILY_CLOSING_BANK_CORRECTED",
      accountId: input.accountId,
      civilDate,
      field: "closingBankBalance",
      previousValue: input.current.closingBankBalance?.amount ?? null,
      newValue: amount,
      userId: input.actorUserId,
      occurredAt: recordedAt,
      reason: input.reason?.trim() || null,
      origin: "MANUAL",
      beforeJson: input.current.closingBankBalance
        ? {
            amount: input.current.closingBankBalance.amount,
            version: input.current.closingBankBalance.version,
          }
        : null,
      afterJson: {
        amount: closingBank.amount,
        version: closingBank.version,
        informedByUserId: closingBank.informedByUserId,
        informedAt: closingBank.informedAt,
        predictedClosingBalance: predicted,
        realizedClosingBalance: realized,
        divergence,
        notes: closingBank.notes,
      },
    },
  };
}

/**
 * Aplica movimentos do dia sobre um estado já aberto (sem gravar saldo bancário).
 */
export function refreshTreasuryDailyAccountRoutineCalculations(input: {
  current: TreasuryDailyAccountRoutineState;
  dayFlow: TreasuryDailyAccountRoutineDayFlow;
}): TreasuryDailyAccountRoutineState {
  if (!input.current.openingBalance) {
    return {
      ...input.current,
      predictedClosingBalance: null,
      realizedClosingBalance: null,
      divergence: null,
      status: deriveTreasuryDailyAccountRoutineStatus({
        openingBalance: null,
        closingBankBalance: input.current.closingBankBalance?.amount ?? null,
        divergence: null,
        formalClosingStatus: input.current.formalClosingStatus,
        caveats: input.current.caveats,
      }),
    };
  }

  const predicted = computeTreasuryDailyPredictedClosingBalance({
    openingBalance: input.current.openingBalance.amount,
    dayFlow: input.dayFlow,
  });
  const realized = computeTreasuryDailyRealizedClosingBalance({
    openingBalance: input.current.openingBalance.amount,
    dayFlow: input.dayFlow,
  });
  const divergence =
    input.current.closingBankBalance != null
      ? computeTreasuryDailyDivergence({
          informedClosingBankBalance: input.current.closingBankBalance.amount,
          realizedClosingBalance: realized,
        })
      : null;

  return {
    ...input.current,
    predictedClosingBalance: predicted,
    realizedClosingBalance: realized,
    divergence,
    status: deriveTreasuryDailyAccountRoutineStatus({
      openingBalance: input.current.openingBalance.amount,
      closingBankBalance: input.current.closingBankBalance?.amount ?? null,
      divergence,
      formalClosingStatus: input.current.formalClosingStatus,
      caveats: input.current.caveats,
    }),
  };
}

/** Vincula status formal do fechamento diário à rotina por conta. */
export function applyTreasuryDailyFormalClosingToRoutine(input: {
  current: TreasuryDailyAccountRoutineState;
  formalClosingId: string;
  formalClosingStatus: TreasuryClosingStatus;
}): TreasuryDailyAccountRoutineState {
  return {
    ...input.current,
    formalClosingId: input.formalClosingId,
    formalClosingStatus: input.formalClosingStatus,
    status: deriveTreasuryDailyAccountRoutineStatus({
      openingBalance: input.current.openingBalance?.amount ?? null,
      closingBankBalance: input.current.closingBankBalance?.amount ?? null,
      divergence: input.current.divergence,
      formalClosingStatus: input.formalClosingStatus,
      caveats: input.current.caveats,
    }),
  };
}

export function emptyTreasuryDailyAccountRoutineDayFlow(): TreasuryDailyAccountRoutineDayFlow {
  return {
    plannedReceivables: "0.00",
    plannedPayables: "0.00",
    plannedTransferIn: "0.00",
    plannedTransferOut: "0.00",
    plannedManualEntries: "0.00",
    settledReceivables: "0.00",
    settledPayables: "0.00",
    realizedLocalInflows: "0.00",
    realizedLocalOutflows: "0.00",
    realizedTransferIn: "0.00",
    realizedTransferOut: "0.00",
  };
}
