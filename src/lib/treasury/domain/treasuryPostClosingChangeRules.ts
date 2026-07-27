/**
 * Detecção pura de mudanças financeiras após fechamento diário.
 *
 * - Nunca reescreve o fechamento CLOSED.
 * - Gera candidato idempotente para exceção FINANCIAL_CHANGE_AFTER_CLOSING
 *   (alias de requisito: POST_CLOSING_FINANCIAL_CHANGE).
 * Sem Prisma / sem I/O.
 */

import type { TreasuryExceptionEntityKind } from "../contracts/treasuryEnums.js";
import type { TreasuryExceptionEnginePostClosingChangeSeed } from "./treasuryExceptionEngine.js";
import {
  normalizeTreasuryMoneyString,
  subtractTreasuryMoney,
  type TreasuryMoneyString,
} from "../treasuryMoney.js";

/** Alias do requisito (Prompt 46). Tipo persistido no enum Prisma/contrato. */
export const POST_CLOSING_FINANCIAL_CHANGE =
  "FINANCIAL_CHANGE_AFTER_CLOSING" as const;

export const TREASURY_POST_CLOSING_CHANGE_KINDS = [
  "LATE_SETTLEMENT",
  "LATE_CANCELLATION",
  "LATE_BANK_MOVEMENT",
  "BALANCE_CHANGE",
  "RECONCILIATION_CHANGE",
  "SYNC_CHANGE",
  "OTHER",
] as const;

export type TreasuryPostClosingChangeKind =
  (typeof TREASURY_POST_CLOSING_CHANGE_KINDS)[number];

export type TreasuryPostClosingClosingSnapshot = {
  id: string;
  companyCode: string;
  civilDate: string;
  status: string;
  version: number;
  sourceHash: string;
  observedBalance: string;
  closingBalance: string;
  differenceAmount: string;
};

export type TreasuryPostClosingChangeEventInput = {
  companyCode: string;
  civilDate: string;
  changeKind: TreasuryPostClosingChangeKind;
  entityKind: TreasuryExceptionEntityKind;
  entityId: string;
  accountId?: string | null;
  /** Valor do movimento (baixa, cancelamento, OFX, etc.). */
  amount?: string | null;
  /** Valor congelado no fechamento (quando conhecido). */
  frozenAmount?: string | null;
  /** Valor atual após a mudança. */
  currentAmount?: string | null;
  changedAtIso: string;
  /** Hash atual da fonte (opcional; usado em SYNC_CHANGE / varredura). */
  currentSourceHash?: string | null;
};

export type TreasuryPostClosingChangeDetection = {
  shouldRaise: boolean;
  reason: string;
  changeId: string;
  differenceAmount: TreasuryMoneyString | null;
  seed: TreasuryExceptionEnginePostClosingChangeSeed;
  title: string;
  description: string;
  closingId: string;
  closedCivilDate: string;
  companyCode: string;
};

const CHANGE_KIND_LABELS: Record<TreasuryPostClosingChangeKind, string> = {
  LATE_SETTLEMENT: "Baixa tardia",
  LATE_CANCELLATION: "Cancelamento tardio",
  LATE_BANK_MOVEMENT: "Movimento bancário tardio",
  BALANCE_CHANGE: "Alteração de saldo",
  RECONCILIATION_CHANGE: "Conciliação tardia",
  SYNC_CHANGE: "Sincronização após fechamento",
  OTHER: "Movimento após fechamento",
};

export function isTreasuryPostClosingChangeKind(
  value: string
): value is TreasuryPostClosingChangeKind {
  return (TREASURY_POST_CLOSING_CHANGE_KINDS as readonly string[]).includes(
    value
  );
}

/** Dia elegível: somente status CLOSED (não reescrever; OPEN/REOPENED ignorados). */
export function isTreasuryDayClosedForPostClosingDetection(
  status: string | null | undefined
): boolean {
  return status === "CLOSED";
}

/**
 * Id estável do evento → uniqueKey do motor:
 * FINANCIAL_CHANGE_AFTER_CLOSING|{company}|{changeId}
 */
export function buildTreasuryPostClosingChangeId(
  event: Pick<
    TreasuryPostClosingChangeEventInput,
    "changeKind" | "entityKind" | "entityId" | "civilDate"
  >
): string {
  return [
    event.changeKind,
    event.entityKind,
    event.entityId.trim(),
    event.civilDate.trim(),
  ].join("|");
}

export function computeTreasuryPostClosingDifferenceAmount(input: {
  frozenAmount?: string | null;
  currentAmount?: string | null;
  amount?: string | null;
}): TreasuryMoneyString | null {
  const frozen =
    input.frozenAmount != null && input.frozenAmount !== ""
      ? normalizeTreasuryMoneyString(input.frozenAmount)
      : null;
  const current =
    input.currentAmount != null && input.currentAmount !== ""
      ? normalizeTreasuryMoneyString(input.currentAmount)
      : null;
  if (frozen != null && current != null) {
    return subtractTreasuryMoney(current, frozen);
  }
  if (input.amount != null && input.amount !== "") {
    return normalizeTreasuryMoneyString(input.amount);
  }
  return null;
}

export function buildTreasuryPostClosingTreatmentHref(input: {
  companyCode: string;
  closedCivilDate: string;
}): string {
  const qs = new URLSearchParams();
  qs.set("date", input.closedCivilDate);
  qs.set("companyCode", input.companyCode.trim());
  return `/finance/treasury/closing?${qs.toString()}`;
}

/**
 * Detecta se um evento financeiro exige exceção pós-fechamento.
 * Retorna null quando o dia não está CLOSED (não gera exceção).
 */
export function detectTreasuryPostClosingFinancialChange(input: {
  closing: TreasuryPostClosingClosingSnapshot | null;
  event: TreasuryPostClosingChangeEventInput;
}): TreasuryPostClosingChangeDetection | null {
  const closing = input.closing;
  if (!closing || !isTreasuryDayClosedForPostClosingDetection(closing.status)) {
    return null;
  }
  if (closing.civilDate !== input.event.civilDate) {
    return null;
  }
  if (
    closing.companyCode.trim().toUpperCase() !==
    input.event.companyCode.trim().toUpperCase()
  ) {
    return null;
  }

  // SYNC_CHANGE: só levanta se o hash atual divergir do congelado.
  // Sem hash atual, eventos explícitos (baixa/cancelamento/saldo/banco) usam outros kinds.
  if (input.event.changeKind === "SYNC_CHANGE") {
    const currentHash = input.event.currentSourceHash?.trim() || null;
    if (!currentHash) return null;
    if (currentHash === closing.sourceHash) return null;
  }

  const changeId = buildTreasuryPostClosingChangeId(input.event);
  const differenceAmount = computeTreasuryPostClosingDifferenceAmount({
    frozenAmount: input.event.frozenAmount,
    currentAmount: input.event.currentAmount,
    amount: input.event.amount,
  });
  const kindLabel = CHANGE_KIND_LABELS[input.event.changeKind];
  const diffText =
    differenceAmount != null ? ` Diferença: ${differenceAmount}.` : "";

  const seed: TreasuryExceptionEnginePostClosingChangeSeed = {
    id: changeId,
    entityKind: input.event.entityKind,
    entityId: input.event.entityId,
    closedCivilDate: closing.civilDate,
    changedAtIso: input.event.changedAtIso,
    amount: differenceAmount ?? input.event.amount ?? null,
    changeKind: input.event.changeKind,
    differenceAmount,
    frozenAmount: input.event.frozenAmount ?? null,
    currentAmount: input.event.currentAmount ?? null,
    accountId: input.event.accountId ?? null,
    closingId: closing.id,
    closingVersion: closing.version,
    closingSourceHash: closing.sourceHash,
    currentSourceHash: input.event.currentSourceHash ?? null,
  };

  return {
    shouldRaise: true,
    reason: "DAY_CLOSED",
    changeId,
    differenceAmount,
    seed,
    title: `${kindLabel} após fechamento`,
    description: `${kindLabel} afetou o dia fechado ${closing.civilDate} (v${closing.version}). O fechamento permanece imutável.${diffText} Reabra o dia ou registre tratamento formal.`,
    closingId: closing.id,
    closedCivilDate: closing.civilDate,
    companyCode: closing.companyCode,
  };
}
