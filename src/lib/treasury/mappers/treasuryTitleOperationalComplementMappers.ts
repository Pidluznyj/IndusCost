/**
 * Row/DTO helpers do complemento operacional de títulos (sem Prisma client).
 */

import { toCivilDateKey } from "@/src/lib/financeCivilDate.js";
import { formatTreasuryTimestampIso } from "../contracts/treasuryTimestamp.js";
import { normalizeTreasuryMoneyString } from "../treasuryMoney.js";

export type TreasuryOfficialTitleKindCode = "RECEIVABLE" | "PAYABLE";
export type TreasuryTitleOperationalStatusCode =
  | "ACTIVE"
  | "ON_HOLD"
  | "COMPLETED"
  | "CANCELLED";
export type TreasuryTitleOperationalPriorityCode =
  | "LOW"
  | "NORMAL"
  | "HIGH"
  | "URGENT";

export type TreasuryTitleOperationalComplementRow = {
  id: string;
  titleType: TreasuryOfficialTitleKindCode;
  officialTitleId: string;
  officialExternalId: number;
  expectedDate: Date | null;
  confirmedDate: Date | null;
  scheduledDate: Date | null;
  expectedAmount: { toFixed(digits: number): string } | string | null;
  confirmedAmount: { toFixed(digits: number): string } | string | null;
  scheduledAmount: { toFixed(digits: number): string } | string | null;
  status: TreasuryTitleOperationalStatusCode;
  priority: TreasuryTitleOperationalPriorityCode;
  plannedAccountId: string | null;
  responsibleUserId: string | null;
  nextAction: string | null;
  reason: string | null;
  notes: string | null;
  version: number;
  createdAt: Date;
  createdByUserId: string;
  updatedAt: Date;
  updatedByUserId: string | null;
  cancelledAt: Date | null;
  cancelledByUserId: string | null;
  cancellationReason: string | null;
};

export type TreasuryTitleOperationalComplementDto = {
  id: string;
  titleType: TreasuryOfficialTitleKindCode;
  officialTitleId: string;
  officialExternalId: number;
  expectedDate: string | null;
  confirmedDate: string | null;
  scheduledDate: string | null;
  expectedAmount: string | null;
  confirmedAmount: string | null;
  scheduledAmount: string | null;
  status: TreasuryTitleOperationalStatusCode;
  priority: TreasuryTitleOperationalPriorityCode;
  plannedAccountId: string | null;
  responsibleUserId: string | null;
  nextAction: string | null;
  reason: string | null;
  notes: string | null;
  version: number;
  createdAt: string;
  createdByUserId: string;
  updatedAt: string;
  updatedByUserId: string | null;
  cancelledAt: string | null;
  cancelledByUserId: string | null;
  cancellationReason: string | null;
};

function moneyOrNull(
  value: TreasuryTitleOperationalComplementRow["expectedAmount"]
): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "string") return normalizeTreasuryMoneyString(value);
  return normalizeTreasuryMoneyString(value.toFixed(2));
}

export function toTreasuryTitleOperationalComplementDto(
  row: TreasuryTitleOperationalComplementRow
): TreasuryTitleOperationalComplementDto {
  return {
    id: row.id,
    titleType: row.titleType,
    officialTitleId: row.officialTitleId,
    officialExternalId: row.officialExternalId,
    expectedDate: toCivilDateKey(row.expectedDate),
    confirmedDate: toCivilDateKey(row.confirmedDate),
    scheduledDate: toCivilDateKey(row.scheduledDate),
    expectedAmount: moneyOrNull(row.expectedAmount),
    confirmedAmount: moneyOrNull(row.confirmedAmount),
    scheduledAmount: moneyOrNull(row.scheduledAmount),
    status: row.status,
    priority: row.priority,
    plannedAccountId: row.plannedAccountId,
    responsibleUserId: row.responsibleUserId,
    nextAction: row.nextAction,
    reason: row.reason,
    notes: row.notes,
    version: row.version,
    createdAt: formatTreasuryTimestampIso(row.createdAt),
    createdByUserId: row.createdByUserId,
    updatedAt: formatTreasuryTimestampIso(row.updatedAt),
    updatedByUserId: row.updatedByUserId,
    cancelledAt: row.cancelledAt
      ? formatTreasuryTimestampIso(row.cancelledAt)
      : null,
    cancelledByUserId: row.cancelledByUserId,
    cancellationReason: row.cancellationReason,
  };
}
