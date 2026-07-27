/**
 * Row/DTO helpers de transferências internas (sem Prisma client).
 */

import { toCivilDateKey } from "@/src/lib/financeCivilDate.js";
import type { TreasuryTransferDto } from "../contracts/treasuryDto.js";
import type {
  TreasuryCurrency,
  TreasuryTransferStatus,
} from "../contracts/treasuryEnums.js";
import { formatTreasuryTimestampIso } from "../contracts/treasuryTimestamp.js";
import {
  isTreasuryTransferFundsInTransit,
  resolveTreasuryTransferProjectionLegs,
} from "../domain/treasuryTransferRules.js";
import type { TreasuryProjectionTransferSeed } from "../domain/treasuryProjectionEngine.js";
import { normalizeTreasuryMoneyString } from "../treasuryMoney.js";

export type TreasuryTransferRow = {
  id: string;
  transferGroupId: string;
  companyCode: string;
  fromAccountId: string;
  toAccountId: string;
  amount: { toFixed(digits: number): string } | string;
  currency: TreasuryCurrency | string;
  civilDate: Date;
  sentCivilDate: Date | null;
  receivedCivilDate: Date | null;
  reconciledCivilDate: Date | null;
  sentAt: Date | null;
  receivedAt: Date | null;
  reconciledAt: Date | null;
  status: TreasuryTransferStatus;
  memo: string | null;
  version: number;
  createdAt: Date;
  createdByUserId: string;
  updatedAt: Date;
  updatedByUserId: string | null;
  cancelledAt: Date | null;
  cancelledByUserId: string | null;
  cancellationReason: string | null;
};

function money(value: TreasuryTransferRow["amount"]): string {
  if (typeof value === "string") return normalizeTreasuryMoneyString(value);
  return normalizeTreasuryMoneyString(value.toFixed(2));
}

function civilOrNull(value: Date | null): string | null {
  if (!value) return null;
  return toCivilDateKey(value);
}

export function toTreasuryTransferDto(row: TreasuryTransferRow): TreasuryTransferDto {
  const civilDate = toCivilDateKey(row.civilDate);
  if (!civilDate) {
    throw new Error("civilDate inválida no row de transferência.");
  }
  return {
    id: row.id,
    transferGroupId: row.transferGroupId,
    companyCode: row.companyCode,
    fromAccountId: row.fromAccountId,
    toAccountId: row.toAccountId,
    civilDate,
    amount: money(row.amount),
    currency: (row.currency as TreasuryCurrency) || "BRL",
    status: row.status,
    memo: row.memo,
    fundsInTransit: isTreasuryTransferFundsInTransit(row.status),
    sentCivilDate: civilOrNull(row.sentCivilDate),
    receivedCivilDate: civilOrNull(row.receivedCivilDate),
    reconciledCivilDate: civilOrNull(row.reconciledCivilDate),
    sentAt: row.sentAt ? formatTreasuryTimestampIso(row.sentAt) : null,
    receivedAt: row.receivedAt
      ? formatTreasuryTimestampIso(row.receivedAt)
      : null,
    reconciledAt: row.reconciledAt
      ? formatTreasuryTimestampIso(row.reconciledAt)
      : null,
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

export function toTreasuryProjectionTransferSeed(
  row: TreasuryTransferRow
): TreasuryProjectionTransferSeed {
  const dto = toTreasuryTransferDto(row);
  const legs = resolveTreasuryTransferProjectionLegs({
    status: dto.status,
    civilDate: dto.civilDate,
    sentCivilDate: dto.sentCivilDate,
    receivedCivilDate: dto.receivedCivilDate,
  });
  return {
    id: dto.id,
    transferGroupId: dto.transferGroupId,
    fromAccountId: dto.fromAccountId,
    toAccountId: dto.toAccountId,
    civilDate: dto.civilDate,
    amount: dto.amount,
    isCancelled: legs.isCancelled,
    status: dto.status,
    outCivilDate: legs.outCivilDate,
    inCivilDate: legs.inCivilDate,
    outRealized: legs.outRealized,
    inRealized: legs.inRealized,
  };
}
