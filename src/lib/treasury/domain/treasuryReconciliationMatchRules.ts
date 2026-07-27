/**
 * Regras puras de conciliação bancária (match + allocations).
 * Sem Prisma / sem I/O. Não realiza baixa oficial Nomus.
 */

import { TREASURY_RECONCILIATION_REVERSE_CONFIRM_PHRASE } from "../contracts/treasuryConstants.js";
import type {
  TreasuryBankMovementReconciliationStatus,
  TreasuryReconciliationAllocationKind,
  TreasurySide,
} from "../contracts/treasuryEnums.js";
import {
  TREASURY_RECONCILIATION_ALLOCATION_NEGATIVE_KINDS,
  TREASURY_RECONCILIATION_ALLOCATION_POSITIVE_KINDS,
} from "../contracts/treasuryEnums.js";
import {
  addTreasuryMoney,
  compareTreasuryMoney,
  normalizeTreasuryMoneyString,
  subtractTreasuryMoney,
  sumTreasuryMoney,
  treasuryMoneyToCents,
  type TreasuryMoneyString,
} from "../treasuryMoney.js";
import { TreasuryDomainError } from "./treasuryErrors.js";

export const TREASURY_RECONCILIATION_DOES_NOT_REALIZE_OFFICIAL = true as const;

export function assertTreasuryReconciliationReverseConfirmPhrase(
  phrase: string
): void {
  if (phrase.trim() !== TREASURY_RECONCILIATION_REVERSE_CONFIRM_PHRASE) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      `Confirmação forte inválida. Digite exatamente ${TREASURY_RECONCILIATION_REVERSE_CONFIRM_PHRASE}.`,
      "confirmPhrase"
    );
  }
}

export type TreasuryReconciliationAllocationDraft = {
  kind: TreasuryReconciliationAllocationKind;
  amount: string;
  memo?: string | null;
  nomusSide?: TreasurySide | null;
  officialTitleId?: string | null;
  nomusExternalId?: number | null;
  openBalance?: string | null;
  transferId?: string | null;
  transferGroupId?: string | null;
  ledgerEntryId?: string | null;
  differenceCode?: string | null;
};

export type TreasuryReconciliationMovementDraft = {
  bankMovementId: string;
  amount: string;
};

function isPositiveKind(kind: TreasuryReconciliationAllocationKind): boolean {
  return (
    TREASURY_RECONCILIATION_ALLOCATION_POSITIVE_KINDS as readonly string[]
  ).includes(kind);
}

function isNegativeKind(kind: TreasuryReconciliationAllocationKind): boolean {
  return (
    TREASURY_RECONCILIATION_ALLOCATION_NEGATIVE_KINDS as readonly string[]
  ).includes(kind);
}

export function assertTreasuryReconciliationAmountPositive(
  amount: string,
  field: string
): TreasuryMoneyString {
  const normalized = normalizeTreasuryMoneyString(amount);
  if (treasuryMoneyToCents(normalized) <= 0n) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "Valor de conciliação deve ser positivo.",
      field
    );
  }
  return normalized;
}

/** Covering net = positivos − desconto/abatimento. */
export function computeTreasuryReconciliationCoveringNet(
  allocations: readonly TreasuryReconciliationAllocationDraft[]
): TreasuryMoneyString {
  let positive = "0.00";
  let negative = "0.00";
  for (const alloc of allocations) {
    const amount = assertTreasuryReconciliationAmountPositive(
      alloc.amount,
      "allocations.amount"
    );
    if (isPositiveKind(alloc.kind)) {
      positive = addTreasuryMoney(positive, amount);
    } else if (isNegativeKind(alloc.kind)) {
      negative = addTreasuryMoney(negative, amount);
    } else {
      throw new TreasuryDomainError(
        "VALIDATION_ERROR",
        `Tipo de allocation inválido: ${alloc.kind}.`,
        "allocations.kind"
      );
    }
  }
  if (compareTreasuryMoney(negative, positive) > 0) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "Desconto/abatimento não pode exceder o covering positivo.",
      "allocations"
    );
  }
  return subtractTreasuryMoney(positive, negative);
}

export function assertTreasuryReconciliationAllocationShape(
  alloc: TreasuryReconciliationAllocationDraft,
  index: number
): void {
  const field = `allocations[${index}]`;
  assertTreasuryReconciliationAmountPositive(alloc.amount, `${field}.amount`);

  switch (alloc.kind) {
    case "TITLE": {
      if (!alloc.officialTitleId?.trim()) {
        throw new TreasuryDomainError(
          "VALIDATION_ERROR",
          "Allocation TITLE exige officialTitleId.",
          `${field}.officialTitleId`
        );
      }
      if (alloc.nomusSide !== "AR" && alloc.nomusSide !== "AP") {
        throw new TreasuryDomainError(
          "VALIDATION_ERROR",
          "Allocation TITLE exige nomusSide AR ou AP.",
          `${field}.nomusSide`
        );
      }
      if (alloc.openBalance != null && alloc.openBalance !== "") {
        const open = normalizeTreasuryMoneyString(alloc.openBalance);
        const amount = normalizeTreasuryMoneyString(alloc.amount);
        if (compareTreasuryMoney(amount, open) > 0) {
          throw new TreasuryDomainError(
            "VALIDATION_ERROR",
            "Valor TITLE não pode exceder saldo aberto do título.",
            `${field}.amount`
          );
        }
      }
      break;
    }
    case "TRANSFER": {
      if (!alloc.transferId?.trim() && !alloc.transferGroupId?.trim()) {
        throw new TreasuryDomainError(
          "VALIDATION_ERROR",
          "Allocation TRANSFER exige transferId ou transferGroupId.",
          `${field}.transferId`
        );
      }
      break;
    }
    case "MANUAL_LEDGER": {
      if (!alloc.ledgerEntryId?.trim() && !alloc.memo?.trim()) {
        throw new TreasuryDomainError(
          "VALIDATION_ERROR",
          "Allocation MANUAL_LEDGER exige ledgerEntryId ou memo.",
          `${field}.ledgerEntryId`
        );
      }
      break;
    }
    case "DIFFERENCE": {
      if (!alloc.differenceCode?.trim() && !alloc.memo?.trim()) {
        throw new TreasuryDomainError(
          "VALIDATION_ERROR",
          "Allocation DIFFERENCE exige differenceCode ou memo.",
          `${field}.differenceCode`
        );
      }
      break;
    }
    case "FEE":
    case "INTEREST":
    case "DISCOUNT":
    case "ABATEMENT":
    case "UNIDENTIFIED":
      break;
    default: {
      const _exhaustive: never = alloc.kind;
      throw new TreasuryDomainError(
        "VALIDATION_ERROR",
        `Tipo de allocation inválido: ${_exhaustive}.`,
        `${field}.kind`
      );
    }
  }
}

export function assertTreasuryReconciliationMatchBalanced(input: {
  movements: readonly TreasuryReconciliationMovementDraft[];
  allocations: readonly TreasuryReconciliationAllocationDraft[];
}): {
  matchedAmount: TreasuryMoneyString;
  coveringNet: TreasuryMoneyString;
} {
  if (input.movements.length === 0) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "Informe ao menos um movimento.",
      "movements"
    );
  }
  if (input.allocations.length === 0) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "Informe ao menos uma allocation.",
      "allocations"
    );
  }

  const movementIds = new Set<string>();
  const movementAmounts: TreasuryMoneyString[] = [];
  for (let i = 0; i < input.movements.length; i += 1) {
    const mov = input.movements[i]!;
    const id = mov.bankMovementId.trim();
    if (!id) {
      throw new TreasuryDomainError(
        "VALIDATION_ERROR",
        "bankMovementId é obrigatório.",
        `movements[${i}].bankMovementId`
      );
    }
    if (movementIds.has(id)) {
      throw new TreasuryDomainError(
        "VALIDATION_ERROR",
        "Movimento duplicado no mesmo match.",
        `movements[${i}].bankMovementId`
      );
    }
    movementIds.add(id);
    movementAmounts.push(
      assertTreasuryReconciliationAmountPositive(
        mov.amount,
        `movements[${i}].amount`
      )
    );
  }

  for (let i = 0; i < input.allocations.length; i += 1) {
    assertTreasuryReconciliationAllocationShape(input.allocations[i]!, i);
  }

  const matchedAmount = sumTreasuryMoney(movementAmounts);
  const coveringNet = computeTreasuryReconciliationCoveringNet(
    input.allocations
  );
  if (compareTreasuryMoney(matchedAmount, coveringNet) !== 0) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      `Soma dos movimentos (${matchedAmount}) deve igualar covering net das allocations (${coveringNet}).`,
      "allocations"
    );
  }

  return { matchedAmount, coveringNet };
}

/**
 * Valida que a parcela do match + já conciliado ativo não excede o valor do movimento.
 */
export function assertTreasuryReconciliationMovementCapacity(input: {
  movementAmount: string;
  alreadyReconciledActive: string;
  allocateAmount: string;
  field?: string;
}): void {
  const total = normalizeTreasuryMoneyString(input.movementAmount);
  const already = normalizeTreasuryMoneyString(input.alreadyReconciledActive);
  const allocate = assertTreasuryReconciliationAmountPositive(
    input.allocateAmount,
    input.field ?? "amount"
  );
  const next = addTreasuryMoney(already, allocate);
  if (compareTreasuryMoney(next, total) > 0) {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      "Valor conciliado excederia o valor do movimento.",
      input.field ?? "amount"
    );
  }
}

export function deriveTreasuryBankMovementReconciliationStatus(input: {
  amount: string;
  reconciledAmount: string;
  currentStatus?: TreasuryBankMovementReconciliationStatus | string | null;
}): TreasuryBankMovementReconciliationStatus {
  if (input.currentStatus === "IGNORED") return "IGNORED";
  const amount = normalizeTreasuryMoneyString(input.amount);
  const reconciled = normalizeTreasuryMoneyString(input.reconciledAmount);
  if (compareTreasuryMoney(reconciled, "0.00") <= 0) return "PENDING";
  if (compareTreasuryMoney(reconciled, amount) >= 0) return "MATCHED";
  return "PARTIAL";
}

/** Soma TITLE por título no draft (anti-excesso vs openBalance). */
export function assertTreasuryReconciliationTitleOpenBalances(
  allocations: readonly TreasuryReconciliationAllocationDraft[]
): void {
  const byTitle = new Map<string, { open: string | null; sum: string }>();
  for (const alloc of allocations) {
    if (alloc.kind !== "TITLE" || !alloc.officialTitleId) continue;
    const key = alloc.officialTitleId.trim();
    const prev = byTitle.get(key) ?? { open: alloc.openBalance ?? null, sum: "0.00" };
    const open =
      prev.open ??
      (alloc.openBalance != null && alloc.openBalance !== ""
        ? alloc.openBalance
        : null);
    byTitle.set(key, {
      open,
      sum: addTreasuryMoney(prev.sum, normalizeTreasuryMoneyString(alloc.amount)),
    });
  }
  for (const [titleId, agg] of byTitle) {
    if (agg.open == null) continue;
    const open = normalizeTreasuryMoneyString(agg.open);
    if (compareTreasuryMoney(agg.sum, open) > 0) {
      throw new TreasuryDomainError(
        "VALIDATION_ERROR",
        `Soma TITLE do título ${titleId} excede saldo aberto.`,
        "allocations"
      );
    }
  }
}

export function assertTreasuryReconciliationMatchVersion(
  currentVersion: number,
  expectedVersion: number
): void {
  if (currentVersion !== expectedVersion) {
    throw new TreasuryDomainError(
      "CONFLICT",
      "Versão do match desatualizada. Recarregue e tente novamente.",
      "expectedVersion"
    );
  }
}

export function assertTreasuryReconciliationMatchActive(status: string): void {
  if (status !== "MATCHED" && status !== "PENDING") {
    throw new TreasuryDomainError(
      "VALIDATION_ERROR",
      `Match em status ${status} não pode ser desfeito.`,
      "status"
    );
  }
}
