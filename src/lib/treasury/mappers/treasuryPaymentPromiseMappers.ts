/**
 * Row/DTO helpers de promessas de pagamento (sem Prisma client).
 */

import { toCivilDateKey } from "@/src/lib/financeCivilDate.js";
import type { TreasuryPaymentPromiseDto } from "../contracts/treasuryDto.js";
import type { TreasuryPromiseStatus } from "../contracts/treasuryEnums.js";
import { formatTreasuryTimestampIso } from "../contracts/treasuryTimestamp.js";
import { normalizeTreasuryMoneyString } from "../treasuryMoney.js";

export type TreasuryPaymentPromiseStatusCode = TreasuryPromiseStatus;

export type TreasuryPaymentPromiseRow = {
  id: string;
  titleType: "RECEIVABLE" | "PAYABLE";
  officialTitleId: string;
  officialExternalId: number;
  promisedDate: Date;
  promisedAmount: { toFixed(digits: number): string } | string;
  fulfilledAmount: { toFixed(digits: number): string } | string;
  contactNote: string | null;
  channel: string | null;
  notes: string | null;
  responsibleUserId: string | null;
  status: TreasuryPaymentPromiseStatusCode;
  version: number;
  createdAt: Date;
  createdByUserId: string;
  updatedAt: Date;
  updatedByUserId: string | null;
  cancelledAt: Date | null;
  cancelledByUserId: string | null;
  cancellationReason: string | null;
  fulfilledAt: Date | null;
};

function money(
  value: TreasuryPaymentPromiseRow["promisedAmount"]
): string {
  if (typeof value === "string") return normalizeTreasuryMoneyString(value);
  return normalizeTreasuryMoneyString(value.toFixed(2));
}

export function toTreasuryPaymentPromiseDto(
  row: TreasuryPaymentPromiseRow
): TreasuryPaymentPromiseDto {
  const promisedDate = toCivilDateKey(row.promisedDate);
  if (!promisedDate) {
    throw new Error("promisedDate inválida no row de promessa.");
  }
  return {
    id: row.id,
    side: row.titleType === "RECEIVABLE" ? "AR" : "AP",
    titleType: row.titleType,
    officialTitleId: row.officialTitleId,
    nomusExternalId: String(row.officialExternalId),
    promisedDate,
    promisedAmount: money(row.promisedAmount),
    fulfilledAmount: money(row.fulfilledAmount),
    contactNote: row.contactNote,
    channel: row.channel,
    notes: row.notes,
    responsibleUserId: row.responsibleUserId,
    status: row.status,
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
    fulfilledAt: row.fulfilledAt
      ? formatTreasuryTimestampIso(row.fulfilledAt)
      : null,
  };
}
