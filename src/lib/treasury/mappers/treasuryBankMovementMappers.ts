/**
 * Mappers de lote/movimento bancário (sem Prisma client runtime).
 */

import { toCivilDateKey } from "@/src/lib/financeCivilDate.js";
import { formatTreasuryTimestampIso } from "../contracts/treasuryTimestamp.js";
import type {
  TreasuryBankImportBatchDto,
  TreasuryBankMovementDto,
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

function asRecord(
  value: unknown
): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

export type TreasuryBankImportBatchMappedRow = {
  id: string;
  companyCode: string;
  accountId: string;
  fileSha256: string;
  originalFileName: string;
  byteLength: number;
  format: string;
  status: string;
  transactionCount: number;
  summaryJson: unknown;
  requestId: string | null;
  notes: string | null;
  createdByUserId: string;
  createdAt: Date;
  processedAt: Date | null;
  account?: { code: string; name: string } | null;
};

export type TreasuryBankMovementMappedRow = {
  id: string;
  batchId: string;
  companyCode: string;
  accountId: string;
  fingerprint: string;
  fitId: string | null;
  direction: string;
  amount: { toFixed(digits: number): string } | string | number;
  currency: string;
  postedCivilDate: Date;
  userCivilDate: Date | null;
  description: string | null;
  documentNumber: string | null;
  counterpartyName: string | null;
  trnType: string | null;
  reconciliationStatus: string;
  reconciledAmount: { toFixed(digits: number): string } | string | number;
  sortOrder: number;
  createdAt: Date;
  account?: { code: string; name: string } | null;
};

export function toTreasuryBankImportBatchDto(
  row: TreasuryBankImportBatchMappedRow
): TreasuryBankImportBatchDto {
  return {
    id: row.id,
    companyCode: row.companyCode,
    accountId: row.accountId,
    accountCode: row.account?.code ?? null,
    accountName: row.account?.name ?? null,
    fileSha256: row.fileSha256,
    originalFileName: row.originalFileName,
    byteLength: row.byteLength,
    format: row.format,
    status: row.status,
    transactionCount: row.transactionCount,
    summaryJson: asRecord(row.summaryJson),
    requestId: row.requestId,
    notes: row.notes,
    createdByUserId: row.createdByUserId,
    createdAt: formatTreasuryTimestampIso(row.createdAt),
    processedAt: row.processedAt
      ? formatTreasuryTimestampIso(row.processedAt)
      : null,
  };
}

export function toTreasuryBankMovementDto(
  row: TreasuryBankMovementMappedRow
): TreasuryBankMovementDto {
  const posted = toCivilDateKey(row.postedCivilDate);
  const user = row.userCivilDate ? toCivilDateKey(row.userCivilDate) : null;
  return {
    id: row.id,
    batchId: row.batchId,
    companyCode: row.companyCode,
    accountId: row.accountId,
    accountCode: row.account?.code ?? null,
    accountName: row.account?.name ?? null,
    fingerprint: row.fingerprint,
    fitId: row.fitId,
    direction: row.direction,
    amount: moneyFromDecimal(row.amount),
    currency: (row.currency || "BRL") as TreasuryBankMovementDto["currency"],
    postedCivilDate: posted!,
    userCivilDate: user,
    description: row.description,
    documentNumber: row.documentNumber,
    counterpartyName: row.counterpartyName,
    trnType: row.trnType,
    reconciliationStatus: row.reconciliationStatus,
    reconciledAmount: moneyFromDecimal(row.reconciledAmount),
    sortOrder: row.sortOrder,
    createdAt: formatTreasuryTimestampIso(row.createdAt),
  };
}
