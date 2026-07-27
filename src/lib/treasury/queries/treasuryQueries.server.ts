/**
 * Queries Prisma da Tesouraria — stub scaffold.
 * Não importa/usa Prisma ainda (models virão no prompt de schema).
 * Sufixo .server: não importar no frontend.
 */

export type TreasuryQueryClient = {
  /** Placeholder tipado — substituído por PrismaClient no schema prompt. */
  readonly __treasuryQueryScaffold: true;
};

export function createTreasuryQueryScaffold(): TreasuryQueryClient {
  return { __treasuryQueryScaffold: true };
}

/** Lista contas — não implementado. */
export async function queryTreasuryFinancialAccounts(
  _client: TreasuryQueryClient
): Promise<never[]> {
  return [];
}
