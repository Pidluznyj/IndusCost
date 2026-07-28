/**
 * Row/DTO helpers de lançamentos do ledger local.
 */

import { toCivilDateKey } from "@/src/lib/financeCivilDate.js";
import type { TreasuryLedgerEntryDto } from "../contracts/treasuryDto.js";
import type {
  TreasuryCurrency,
  TreasuryLedgerDirection,
  TreasuryLedgerNature,
  TreasuryLedgerStatus,
} from "../contracts/treasuryEnums.js";
import { formatTreasuryTimestampIso } from "../contracts/treasuryTimestamp.js";
import { normalizeTreasuryMoneyString } from "../treasuryMoney.js";

export type TreasuryLedgerEntryRow = {
  id: string;
  companyCode: string;
  accountId: string;
  civilDate: Date;
  amount: { toFixed(digits: number): string } | string;
  currency: TreasuryCurrency | string;
  direction: TreasuryLedgerDirection;
  nature: TreasuryLedgerNature;
  status: TreasuryLedgerStatus;
  memo: string | null;
  counterpartRef: string | null;
  transferGroupId: string | null;
  reversesEntryId: string | null;
  reversedByEntryId: string | null;
  version: number;
  createdAt: Date;
  createdByUserId: string;
  updatedAt: Date;
  updatedByUserId: string | null;
};

function money(value: TreasuryLedgerEntryRow["amount"]): string {
  if (typeof value === "string") return normalizeTreasuryMoneyString(value);
  return normalizeTreasuryMoneyString(value.toFixed(2));
}

export function toTreasuryLedgerEntryDto(
  row: TreasuryLedgerEntryRow
): TreasuryLedgerEntryDto {
  const civilDate = toCivilDateKey(row.civilDate);
  if (!civilDate) {
    throw new Error("civilDate inválida no row de lançamento.");
  }
  return {
    id: row.id,
    companyCode: row.companyCode,
    accountId: row.accountId,
    civilDate,
    amount: money(row.amount),
    currency: (row.currency as TreasuryCurrency) || "BRL",
    direction: row.direction,
    nature: row.nature,
    status: row.status,
    memo: row.memo,
    counterpartRef: row.counterpartRef,
    transferGroupId: row.transferGroupId,
    reversesEntryId: row.reversesEntryId,
    version: row.version,
    createdAt: formatTreasuryTimestampIso(row.createdAt),
    createdByUserId: row.createdByUserId,
    updatedAt: formatTreasuryTimestampIso(row.updatedAt),
    updatedByUserId: row.updatedByUserId,
  };
}
