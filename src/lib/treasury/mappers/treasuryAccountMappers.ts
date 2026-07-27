/**
 * Mappers de conta financeira Tesouraria (sem Prisma client runtime).
 */

import { formatTreasuryTimestampIso } from "../contracts/treasuryTimestamp.js";
import { normalizeTreasuryMoneyString } from "../treasuryMoney.js";
import type {
  TreasuryFinancialAccountAccessDto,
  TreasuryFinancialAccountDto,
} from "../contracts/treasuryDto.js";
import type {
  TreasuryAccountAccessLevel,
  TreasuryAccountLiquidity,
  TreasuryAccountType,
  TreasuryBalanceOrigin,
  TreasuryCurrency,
} from "../contracts/treasuryEnums.js";
import { maskTreasuryBankIdentifierForViewer } from "../domain/treasuryAccountRules.js";

export type TreasuryAccountRow = {
  id: string;
  companyCode: string;
  companyName: string | null;
  code: string;
  name: string;
  institutionName: string;
  institutionCode: string | null;
  accountType: TreasuryAccountType | string;
  currency: TreasuryCurrency | string;
  agencyMasked: string;
  accountNumberMasked: string;
  includeInConsolidated: boolean;
  minimumBalance: { toFixed(digits: number): string } | string | number;
  allowNegativeBalance: boolean;
  liquidity: TreasuryAccountLiquidity | string;
  defaultBalanceOrigin: TreasuryBalanceOrigin | string;
  sortOrder: number;
  nomusBankAccountId: string | null;
  isActive: boolean;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  deactivatedAt: Date | null;
  deactivatedByUserId: string | null;
  deactivationReason: string | null;
};

export type TreasuryAccountAccessRow = {
  id: string;
  accountId: string;
  userId: string;
  accessLevel: TreasuryAccountAccessLevel | string;
  canViewBalance: boolean;
  canMutateBalance: boolean;
  isActive: boolean;
  grantedByUserId: string | null;
  grantedAt: Date;
  revokedAt: Date | null;
  notes?: string | null;
};

function moneyFromDecimal(
  value: TreasuryAccountRow["minimumBalance"]
): string {
  if (typeof value === "string") return normalizeTreasuryMoneyString(value);
  if (typeof value === "number") {
    return normalizeTreasuryMoneyString(value.toFixed(2));
  }
  return normalizeTreasuryMoneyString(value.toFixed(2));
}

export function toTreasuryFinancialAccountDto(
  row: TreasuryAccountRow,
  options?: { revealBankIdentifiers?: boolean }
): TreasuryFinancialAccountDto {
  const reveal = options?.revealBankIdentifiers ?? false;
  return {
    id: row.id,
    companyCode: row.companyCode,
    companyName: row.companyName,
    code: row.code,
    name: row.name,
    institutionName: row.institutionName,
    institutionCode: row.institutionCode,
    accountType: row.accountType as TreasuryAccountType,
    currency: row.currency as TreasuryCurrency,
    agencyMasked: maskTreasuryBankIdentifierForViewer(row.agencyMasked, reveal),
    accountNumberMasked: maskTreasuryBankIdentifierForViewer(
      row.accountNumberMasked,
      reveal
    ),
    includeInConsolidated: row.includeInConsolidated,
    minimumBalance: moneyFromDecimal(row.minimumBalance),
    allowNegativeBalance: row.allowNegativeBalance,
    liquidity: row.liquidity as TreasuryAccountLiquidity,
    defaultBalanceOrigin: row.defaultBalanceOrigin as TreasuryBalanceOrigin,
    sortOrder: row.sortOrder,
    nomusBankAccountId: row.nomusBankAccountId,
    isActive: row.isActive,
    createdByUserId: row.createdByUserId,
    createdAt: formatTreasuryTimestampIso(row.createdAt),
    updatedAt: formatTreasuryTimestampIso(row.updatedAt),
    deactivatedAt: row.deactivatedAt
      ? formatTreasuryTimestampIso(row.deactivatedAt)
      : null,
    deactivatedByUserId: row.deactivatedByUserId,
    deactivationReason: row.deactivationReason,
  };
}

export function toTreasuryFinancialAccountAccessDto(
  row: TreasuryAccountAccessRow
): TreasuryFinancialAccountAccessDto {
  return {
    id: row.id,
    accountId: row.accountId,
    userId: row.userId,
    accessLevel: row.accessLevel as TreasuryAccountAccessLevel,
    canViewBalance: row.canViewBalance,
    canMutateBalance: row.canMutateBalance,
    isActive: row.isActive,
    grantedByUserId: row.grantedByUserId,
    grantedAt: formatTreasuryTimestampIso(row.grantedAt),
    revokedAt: row.revokedAt
      ? formatTreasuryTimestampIso(row.revokedAt)
      : null,
  };
}

/** Snapshot estável para auditoria (sem redação de viewer). */
export function toTreasuryAccountAuditPayload(row: TreasuryAccountRow) {
  return {
    id: row.id,
    companyCode: row.companyCode,
    code: row.code,
    name: row.name,
    institutionName: row.institutionName,
    accountType: row.accountType,
    currency: row.currency,
    agencyMasked: row.agencyMasked,
    accountNumberMasked: row.accountNumberMasked,
    includeInConsolidated: row.includeInConsolidated,
    minimumBalance: moneyFromDecimal(row.minimumBalance),
    allowNegativeBalance: row.allowNegativeBalance,
    liquidity: row.liquidity,
    defaultBalanceOrigin: row.defaultBalanceOrigin,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    deactivatedAt: row.deactivatedAt?.toISOString() ?? null,
    deactivationReason: row.deactivationReason,
    updatedAt: row.updatedAt.toISOString(),
  };
}
