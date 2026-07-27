/**
 * Row/DTO — ações de cobrança (sem Prisma client).
 */

import type { TreasuryCollectionActionDto } from "../contracts/treasuryDto.js";
import type { TreasuryCollectionActionType } from "../contracts/treasuryEnums.js";
import { formatTreasuryTimestampIso } from "../contracts/treasuryTimestamp.js";

export type TreasuryCollectionActionRow = {
  id: string;
  titleType: "RECEIVABLE" | "PAYABLE";
  officialTitleId: string;
  officialExternalId: number;
  actionType: TreasuryCollectionActionType;
  performedAt: Date;
  contactPerson: string | null;
  result: string | null;
  notes: string | null;
  nextAction: string | null;
  responsibleUserId: string | null;
  version: number;
  createdAt: Date;
  createdByUserId: string;
  updatedAt: Date;
  updatedByUserId: string | null;
  cancelledAt: Date | null;
  cancelledByUserId: string | null;
  cancellationReason: string | null;
};

export function toTreasuryCollectionActionDto(
  row: TreasuryCollectionActionRow
): TreasuryCollectionActionDto {
  return {
    id: row.id,
    side: row.titleType === "RECEIVABLE" ? "AR" : "AP",
    titleType: row.titleType,
    officialTitleId: row.officialTitleId,
    nomusExternalId: String(row.officialExternalId),
    actionType: row.actionType,
    performedAt: formatTreasuryTimestampIso(row.performedAt),
    contactPerson: row.contactPerson,
    result: row.result,
    notes: row.notes,
    nextAction: row.nextAction,
    responsibleUserId: row.responsibleUserId,
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
