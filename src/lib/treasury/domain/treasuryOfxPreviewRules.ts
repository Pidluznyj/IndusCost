/**
 * Regras puras do preview de importação OFX (sem I/O / sem Prisma).
 */

import {
  buildTreasuryBankMovementFingerprint,
  buildTreasuryBankMovementNormalizedPayload,
  type TreasuryBankMovementNormalizedPayload,
} from "./treasuryBankMovementFingerprint.js";
import type {
  TreasuryBankMovementDirection,
  TreasuryOfxPreviewDuplicateReason,
  TreasuryOfxPreviewRowStatus,
} from "../contracts/treasuryEnums.js";
import {
  addTreasuryMoney,
  normalizeTreasuryMoneyString,
  subtractTreasuryMoney,
  type TreasuryMoneyString,
} from "../treasuryMoney.js";
import type { TreasuryOfxParsedTransaction } from "../ofx/treasuryOfxParser.js";

export type TreasuryOfxPreviewInvalidSeed = {
  sortOrder: number;
  reason: string;
  field?: string | null;
  fitId?: string | null;
  description?: string | null;
};

export type TreasuryOfxPreviewMovementRow = {
  sortOrder: number;
  status: TreasuryOfxPreviewRowStatus;
  fingerprint: string | null;
  fitId: string | null;
  direction: TreasuryBankMovementDirection | null;
  amount: TreasuryMoneyString | null;
  currency: string | null;
  postedCivilDate: string | null;
  userCivilDate: string | null;
  description: string | null;
  documentNumber: string | null;
  counterpartyName: string | null;
  trnType: string | null;
  normalizedPayload: TreasuryBankMovementNormalizedPayload | null;
  invalidReason: string | null;
  duplicateReason: TreasuryOfxPreviewDuplicateReason | null;
};

export type TreasuryOfxPreviewTotals = {
  movementCount: number;
  newCount: number;
  duplicateCount: number;
  invalidCount: number;
  creditAmount: TreasuryMoneyString;
  debitAmount: TreasuryMoneyString;
  netAmount: TreasuryMoneyString;
};

export type TreasuryOfxPreviewPeriod = {
  startCivilDate: string | null;
  endCivilDate: string | null;
};

export function absoluteTreasuryMoneyString(value: string): TreasuryMoneyString {
  const normalized = normalizeTreasuryMoneyString(value);
  return normalized.startsWith("-")
    ? (normalized.slice(1) as TreasuryMoneyString)
    : normalized;
}

export function buildTreasuryOfxPreviewClassification(input: {
  accountId: string;
  transactions: readonly TreasuryOfxParsedTransaction[];
  invalidSeeds?: readonly TreasuryOfxPreviewInvalidSeed[];
  existingFingerprints: ReadonlySet<string>;
  fileAlreadyImported: boolean;
}): {
  movements: TreasuryOfxPreviewMovementRow[];
  totals: TreasuryOfxPreviewTotals;
  period: TreasuryOfxPreviewPeriod;
} {
  const accountId = input.accountId.trim();
  const seenInFile = new Set<string>();
  const movements: TreasuryOfxPreviewMovementRow[] = [];

  let creditAmount = normalizeTreasuryMoneyString("0");
  let debitAmount = normalizeTreasuryMoneyString("0");
  let newCount = 0;
  let duplicateCount = 0;
  let invalidCount = 0;
  let startCivilDate: string | null = null;
  let endCivilDate: string | null = null;

  for (let i = 0; i < input.transactions.length; i += 1) {
    const tx = input.transactions[i]!;
    const amount = absoluteTreasuryMoneyString(tx.amount);
    const direction = tx.direction;
    const fingerprint = buildTreasuryBankMovementFingerprint({
      accountId,
      fitId: tx.fitId,
      postedCivilDate: tx.postedCivilDate,
      direction,
      amount,
      description: tx.memo,
      documentNumber: null,
    });
    const normalizedPayload = buildTreasuryBankMovementNormalizedPayload({
      fitId: tx.fitId,
      postedCivilDate: tx.postedCivilDate,
      direction,
      amount,
      currency: tx.currency,
      description: tx.memo,
      documentNumber: null,
      counterpartyName: null,
      trnType: tx.trnType,
    });

    let status: TreasuryOfxPreviewRowStatus = "NEW";
    let duplicateReason: TreasuryOfxPreviewDuplicateReason | null = null;

    if (input.fileAlreadyImported) {
      status = "DUPLICATE";
      duplicateReason = "EXISTING_FILE";
    } else if (input.existingFingerprints.has(fingerprint)) {
      status = "DUPLICATE";
      duplicateReason = "EXISTING_MOVEMENT";
    } else if (seenInFile.has(fingerprint)) {
      status = "DUPLICATE";
      duplicateReason = "INTRA_FILE";
    }

    seenInFile.add(fingerprint);

    if (status === "NEW") newCount += 1;
    else duplicateCount += 1;

    if (direction === "CREDIT") {
      creditAmount = addTreasuryMoney(creditAmount, amount);
    } else {
      debitAmount = addTreasuryMoney(debitAmount, amount);
    }

    if (
      !startCivilDate ||
      tx.postedCivilDate.localeCompare(startCivilDate) < 0
    ) {
      startCivilDate = tx.postedCivilDate;
    }
    if (!endCivilDate || tx.postedCivilDate.localeCompare(endCivilDate) > 0) {
      endCivilDate = tx.postedCivilDate;
    }

    movements.push({
      sortOrder: i,
      status,
      fingerprint,
      fitId: tx.fitId,
      direction,
      amount,
      currency: normalizedPayload.currency,
      postedCivilDate: tx.postedCivilDate,
      userCivilDate: null,
      description: tx.memo,
      documentNumber: null,
      counterpartyName: null,
      trnType: tx.trnType,
      normalizedPayload,
      invalidReason: null,
      duplicateReason,
    });
  }

  for (const seed of input.invalidSeeds ?? []) {
    invalidCount += 1;
    movements.push({
      sortOrder: seed.sortOrder,
      status: "INVALID",
      fingerprint: null,
      fitId: seed.fitId?.trim() || null,
      direction: null,
      amount: null,
      currency: null,
      postedCivilDate: null,
      userCivilDate: null,
      description: seed.description?.trim() || null,
      documentNumber: null,
      counterpartyName: null,
      trnType: null,
      normalizedPayload: null,
      invalidReason: seed.reason,
      duplicateReason: null,
    });
  }

  movements.sort((a, b) => a.sortOrder - b.sortOrder);

  return {
    movements,
    totals: {
      movementCount: movements.length,
      newCount,
      duplicateCount,
      invalidCount,
      creditAmount,
      debitAmount,
      netAmount: subtractTreasuryMoney(creditAmount, debitAmount),
    },
    period: { startCivilDate, endCivilDate },
  };
}
