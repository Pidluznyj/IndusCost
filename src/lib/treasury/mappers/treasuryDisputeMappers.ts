/**
 * Row/DTO — contestações (sem Prisma client).
 */

import { toCivilDateKey } from "@/src/lib/financeCivilDate.js";
import type { TreasuryDisputeDto } from "../contracts/treasuryDto.js";
import type { TreasuryDisputeStatus } from "../contracts/treasuryEnums.js";
import { formatTreasuryTimestampIso } from "../contracts/treasuryTimestamp.js";
import { normalizeTreasuryMoneyString } from "../treasuryMoney.js";

export type TreasuryDisputeRow = {
  id: string;
  titleType: "RECEIVABLE" | "PAYABLE";
  officialTitleId: string;
  officialExternalId: number;
  reason: string;
  amountDisputed: { toFixed(digits: number): string } | string | null;
  responsibleUserId: string | null;
  involvedArea: string | null;
  dueDate: Date | null;
  notes: string | null;
  status: TreasuryDisputeStatus;
  resolutionNote: string | null;
  version: number;
  openedAt: Date;
  createdAt: Date;
  createdByUserId: string;
  updatedAt: Date;
  updatedByUserId: string | null;
  cancelledAt: Date | null;
  cancelledByUserId: string | null;
  resolvedAt: Date | null;
};

function moneyOrNull(
  value: TreasuryDisputeRow["amountDisputed"]
): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "string") return normalizeTreasuryMoneyString(value);
  return normalizeTreasuryMoneyString(value.toFixed(2));
}

export function toTreasuryDisputeDto(row: TreasuryDisputeRow): TreasuryDisputeDto {
  return {
    id: row.id,
    side: row.titleType === "RECEIVABLE" ? "AR" : "AP",
    titleType: row.titleType,
    officialTitleId: row.officialTitleId,
    nomusExternalId: String(row.officialExternalId),
    openedAt: formatTreasuryTimestampIso(row.openedAt),
    reason: row.reason,
    amountDisputed: moneyOrNull(row.amountDisputed),
    responsibleUserId: row.responsibleUserId,
    involvedArea: row.involvedArea,
    dueDate: toCivilDateKey(row.dueDate),
    notes: row.notes,
    status: row.status,
    resolutionNote: row.resolutionNote,
    version: row.version,
    createdAt: formatTreasuryTimestampIso(row.createdAt),
    createdByUserId: row.createdByUserId,
    updatedAt: formatTreasuryTimestampIso(row.updatedAt),
    updatedByUserId: row.updatedByUserId,
    cancelledAt: row.cancelledAt
      ? formatTreasuryTimestampIso(row.cancelledAt)
      : null,
    cancelledByUserId: row.cancelledByUserId,
    resolvedAt: row.resolvedAt
      ? formatTreasuryTimestampIso(row.resolvedAt)
      : null,
  };
}
