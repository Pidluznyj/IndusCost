/**
 * Helpers SQL/Prisma da Tesouraria — tipagem segura (uuid ≠ text).
 */

import type { Prisma } from "@prisma/client";

/**
 * Contas opcionais para `$queryRaw`.
 * Preferir `= ANY(...::uuid[])` + flag booleana (nunca `::text[]` em coluna uuid).
 */
export function bindTreasuryOptionalUuidAccountFilter(
  accountIds: string[] | null | undefined
): { filterByAccounts: boolean; accountIdList: string[] } {
  const accountIdList = accountIds?.length ? [...accountIds] : [];
  return {
    filterByAccounts: accountIdList.length > 0,
    accountIdList,
  };
}

/**
 * `companyCode IS NOT NULL` — Prisma 5 rejeita `companyCode: { not: null }`
 * ("Argument `not` must not be null").
 */
export function treasuryCompanyCodePresentWhere(): Prisma.TreasuryFinancialAccountWhereInput {
  return { NOT: { companyCode: null } };
}
