/**
 * Row/DTO helpers de exceções da Tesouraria (sem Prisma client).
 */

import { toCivilDateKey } from "@/src/lib/financeCivilDate.js";
import type { TreasuryExceptionDto } from "../contracts/treasuryDto.js";
import type {
  TreasuryExceptionEntityKind,
  TreasuryExceptionSeverity,
  TreasuryExceptionStatus,
  TreasuryExceptionType,
} from "../contracts/treasuryEnums.js";
import { formatTreasuryTimestampIso } from "../contracts/treasuryTimestamp.js";
import { normalizeTreasuryMoneyString } from "../treasuryMoney.js";

export type TreasuryExceptionRow = {
  id: string;
  companyCode: string;
  uniqueKey: string;
  type: TreasuryExceptionType | string;
  severity: TreasuryExceptionSeverity | string;
  status: TreasuryExceptionStatus | string;
  entityKind: TreasuryExceptionEntityKind | string | null;
  entityId: string | null;
  accountId: string | null;
  nomusExternalId: string | null;
  title: string;
  description: string | null;
  amount: { toFixed(digits: number): string } | string | null;
  detectedAt: Date;
  dueAt: Date | null;
  responsibleUserId: string | null;
  resolution: string | null;
  ignoreJustification: string | null;
  recurrenceCount: number;
  metadataJson: unknown;
  version: number;
  createdAt: Date;
  createdByUserId: string;
  updatedAt: Date;
  updatedByUserId: string | null;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
  cancelledAt: Date | null;
  cancelledByUserId: string | null;
};

function moneyOrNull(
  value: TreasuryExceptionRow["amount"]
): string | null {
  if (value == null) return null;
  if (typeof value === "string") return normalizeTreasuryMoneyString(value);
  return normalizeTreasuryMoneyString(value.toFixed(2));
}

function metadataOf(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export function toTreasuryExceptionDto(
  row: TreasuryExceptionRow
): TreasuryExceptionDto {
  return {
    id: row.id,
    companyCode: row.companyCode,
    uniqueKey: row.uniqueKey,
    type: row.type as TreasuryExceptionType,
    severity: row.severity as TreasuryExceptionSeverity,
    status: row.status as TreasuryExceptionStatus,
    entityKind: (row.entityKind as TreasuryExceptionEntityKind) ?? null,
    entityId: row.entityId,
    accountId: row.accountId,
    nomusExternalId: row.nomusExternalId,
    title: row.title,
    description: row.description,
    amount: moneyOrNull(row.amount),
    detectedAt: formatTreasuryTimestampIso(row.detectedAt),
    dueAt: row.dueAt ? toCivilDateKey(row.dueAt) : null,
    responsibleUserId: row.responsibleUserId,
    resolution: row.resolution,
    ignoreJustification: row.ignoreJustification,
    recurrenceCount: row.recurrenceCount,
    metadata: metadataOf(row.metadataJson),
    version: row.version,
    createdAt: formatTreasuryTimestampIso(row.createdAt),
    createdByUserId: row.createdByUserId,
    updatedAt: formatTreasuryTimestampIso(row.updatedAt),
    updatedByUserId: row.updatedByUserId,
    acknowledgedAt: row.acknowledgedAt
      ? formatTreasuryTimestampIso(row.acknowledgedAt)
      : null,
    resolvedAt: row.resolvedAt
      ? formatTreasuryTimestampIso(row.resolvedAt)
      : null,
    cancelledAt: row.cancelledAt
      ? formatTreasuryTimestampIso(row.cancelledAt)
      : null,
    cancelledByUserId: row.cancelledByUserId,
  };
}
