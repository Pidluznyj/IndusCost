/**
 * Mappers de snapshot de saldo Tesouraria (sem Prisma client runtime).
 */

import { formatTreasuryTimestampIso } from "../contracts/treasuryTimestamp.js";
import type { TreasuryCivilDate } from "../contracts/treasuryCivilDate.js";
import type { TreasuryBalanceSnapshotDto } from "../contracts/treasuryDto.js";
import type { TreasuryBalanceOrigin } from "../contracts/treasuryEnums.js";
import { computeTreasuryBalanceSnapshotAmounts } from "../domain/treasuryBalanceRules.js";
import { normalizeTreasuryMoneyString } from "../treasuryMoney.js";

export type TreasuryBalanceSnapshotRow = {
  id: string;
  accountId: string;
  referenceAt: Date;
  availableBalance: { toFixed(digits: number): string } | string | number;
  blockedBalance: { toFixed(digits: number): string } | string | number;
  investmentsBalance: { toFixed(digits: number): string } | string | number;
  usedLimit: { toFixed(digits: number): string } | string | number;
  origin: TreasuryBalanceOrigin | string;
  idempotencyKey: string;
  notes: string | null;
  attachmentUrl: string | null;
  createdByUserId: string;
  previousSnapshotId: string | null;
  createdAt: Date;
};

function moneyFromDecimal(
  value: TreasuryBalanceSnapshotRow["availableBalance"]
): string {
  if (typeof value === "string") return normalizeTreasuryMoneyString(value);
  if (typeof value === "number") {
    return normalizeTreasuryMoneyString(value.toFixed(2));
  }
  return normalizeTreasuryMoneyString(value.toFixed(2));
}

export function civilDateFromReferenceAt(referenceAt: Date): TreasuryCivilDate {
  const y = referenceAt.getUTCFullYear();
  const m = String(referenceAt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(referenceAt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function toTreasuryBalanceSnapshotDto(
  row: TreasuryBalanceSnapshotRow
): TreasuryBalanceSnapshotDto {
  const availableBalance = moneyFromDecimal(row.availableBalance);
  const blockedBalance = moneyFromDecimal(row.blockedBalance);
  const investmentsBalance = moneyFromDecimal(row.investmentsBalance);
  const usedLimit = moneyFromDecimal(row.usedLimit);
  const amounts = computeTreasuryBalanceSnapshotAmounts({
    availableBalance,
    blockedBalance,
    investmentsBalance,
    usedLimit,
  });

  return {
    id: row.id,
    accountId: row.accountId,
    referenceAt: formatTreasuryTimestampIso(row.referenceAt),
    civilDate: civilDateFromReferenceAt(row.referenceAt),
    availableBalance,
    blockedBalance,
    investmentsBalance,
    usedLimit,
    observedBalance: amounts.observedBalance,
    operationalAvailableBalance: amounts.operationalAvailableBalance,
    origin: row.origin as TreasuryBalanceOrigin,
    idempotencyKey: row.idempotencyKey,
    notes: row.notes,
    attachmentUrl: row.attachmentUrl,
    createdByUserId: row.createdByUserId,
    previousSnapshotId: row.previousSnapshotId,
    createdAt: formatTreasuryTimestampIso(row.createdAt),
  };
}
