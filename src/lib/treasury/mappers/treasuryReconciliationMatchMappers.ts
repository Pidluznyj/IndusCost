/**
 * Mappers de match de conciliação bancária (sem Prisma client runtime).
 */

import { toCivilDateKey } from "@/src/lib/financeCivilDate.js";
import { formatTreasuryTimestampIso } from "../contracts/treasuryTimestamp.js";
import type {
  TreasuryReconciliationAllocationDto,
  TreasuryReconciliationMatchDto,
  TreasuryReconciliationMatchMovementDto,
} from "../contracts/treasuryDto.js";
import { normalizeTreasuryMoneyString } from "../treasuryMoney.js";

function moneyFromDecimal(
  value: { toFixed(digits: number): string } | string | number
): string {
  if (typeof value === "string") return normalizeTreasuryMoneyString(value);
  if (typeof value === "number") {
    return normalizeTreasuryMoneyString(value.toFixed(2));
  }
  return normalizeTreasuryMoneyString(value.toFixed(2));
}

export type TreasuryReconciliationMatchMovementRow = {
  id: string;
  matchId: string;
  bankMovementId: string;
  amount: { toFixed(digits: number): string } | string | number;
  sortOrder: number;
};

export type TreasuryReconciliationAllocationRow = {
  id: string;
  matchId: string;
  kind: string;
  amount: { toFixed(digits: number): string } | string | number;
  memo: string | null;
  nomusSide: string | null;
  officialTitleId: string | null;
  nomusExternalId: number | null;
  transferId: string | null;
  transferGroupId: string | null;
  ledgerEntryId: string | null;
  differenceCode: string | null;
  sortOrder: number;
};

export type TreasuryReconciliationMatchRow = {
  id: string;
  companyCode: string;
  accountId: string;
  status: string;
  matchedAmount: { toFixed(digits: number): string } | string | number;
  currency: string;
  matchedCivilDate: Date | string;
  justification: string | null;
  suggestionKey: string | null;
  algorithmVersion: string | null;
  suggestionScore: number | null;
  suggestionConfidence: string | null;
  suggestionReasonsJson: unknown;
  version: number;
  createdAt: Date;
  createdByUserId: string;
  updatedAt: Date;
  updatedByUserId: string | null;
  unmatchedAt: Date | null;
  unmatchedByUserId: string | null;
  unmatchReason: string | null;
  movements: TreasuryReconciliationMatchMovementRow[];
  allocations: TreasuryReconciliationAllocationRow[];
};

function asReasons(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.map((v) => String(v));
}

export function toTreasuryReconciliationMatchMovementDto(
  row: TreasuryReconciliationMatchMovementRow
): TreasuryReconciliationMatchMovementDto {
  return {
    id: row.id,
    matchId: row.matchId,
    bankMovementId: row.bankMovementId,
    amount: moneyFromDecimal(row.amount),
    sortOrder: row.sortOrder,
  };
}

export function toTreasuryReconciliationAllocationDto(
  row: TreasuryReconciliationAllocationRow
): TreasuryReconciliationAllocationDto {
  return {
    id: row.id,
    matchId: row.matchId,
    kind: row.kind,
    amount: moneyFromDecimal(row.amount),
    memo: row.memo,
    nomusSide:
      row.nomusSide === "AR" || row.nomusSide === "AP" ? row.nomusSide : null,
    officialTitleId: row.officialTitleId,
    nomusExternalId: row.nomusExternalId,
    transferId: row.transferId,
    transferGroupId: row.transferGroupId,
    ledgerEntryId: row.ledgerEntryId,
    differenceCode: row.differenceCode,
    sortOrder: row.sortOrder,
  };
}

export function toTreasuryReconciliationMatchDto(
  row: TreasuryReconciliationMatchRow
): TreasuryReconciliationMatchDto {
  const civil =
    typeof row.matchedCivilDate === "string"
      ? row.matchedCivilDate.slice(0, 10)
      : toCivilDateKey(row.matchedCivilDate) ?? "1970-01-01";
  return {
    id: row.id,
    companyCode: row.companyCode,
    accountId: row.accountId,
    status: row.status,
    matchedAmount: moneyFromDecimal(row.matchedAmount),
    currency: (row.currency as "BRL") || "BRL",
    matchedCivilDate: civil,
    justification: row.justification,
    suggestionKey: row.suggestionKey,
    algorithmVersion: row.algorithmVersion,
    suggestionScore: row.suggestionScore,
    suggestionConfidence: row.suggestionConfidence,
    suggestionReasons: asReasons(row.suggestionReasonsJson),
    version: row.version,
    movements: [...row.movements]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
      .map(toTreasuryReconciliationMatchMovementDto),
    allocations: [...row.allocations]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
      .map(toTreasuryReconciliationAllocationDto),
    createdAt: formatTreasuryTimestampIso(row.createdAt),
    createdByUserId: row.createdByUserId,
    updatedAt: formatTreasuryTimestampIso(row.updatedAt),
    updatedByUserId: row.updatedByUserId,
    unmatchedAt: row.unmatchedAt
      ? formatTreasuryTimestampIso(row.unmatchedAt)
      : null,
    unmatchedByUserId: row.unmatchedByUserId,
    unmatchReason: row.unmatchReason,
    doesNotRealizeOfficial: true,
  };
}
