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
 * Conta com código de empresa UTILIZÁVEL.
 *
 * `TreasuryFinancialAccount.companyCode` é `String` no schema e `TEXT NOT NULL`
 * no banco (migration 20260805120000). Logo, filtrar por nulo é impossível E
 * redundante: não existe linha com nulo.
 *
 * A implementação anterior era `NOT: { companyCode: null }` e derrubava em
 * runtime toda rota que a usasse, com
 * `PrismaClientValidationError: Argument 'companyCode' must not be null`.
 * O comentário antigo mostra a origem do engano: ao bater em
 * `{ not: null }` a correção foi mover o nulo para dentro de `NOT`, que o
 * Prisma rejeita pelo mesmo motivo — o campo simplesmente não aceita nulo em
 * nenhuma posição.
 *
 * A intenção real era excluir conta SEM código comercial aproveitável. Como a
 * coluna é NOT NULL, o único estado inválido possível é a string vazia — e é
 * exatamente contra isso que todos os consumidores já se defendem com
 * `companyCode?.trim() || null`.
 *
 * LIMITE CONHECIDO: `not: ""` não exclui código só com espaços (`"   "`).
 * Filtrar isso no banco exigiria expressão que o Prisma não expressa em
 * `where`; os consumidores continuam aplicando `.trim()` antes de usar, que é
 * onde a decisão realmente acontece.
 */
export function treasuryCompanyCodePresentWhere(): Prisma.TreasuryFinancialAccountWhereInput {
  return { companyCode: { not: "" } };
}
