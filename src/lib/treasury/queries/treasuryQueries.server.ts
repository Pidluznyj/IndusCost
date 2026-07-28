/**
 * Queries legadas de scaffold — mantidas só para testes de estrutura.
 * Preferir repositories/services tipados (`*.server.ts`) para I/O real.
 * Sufixo .server: não importar no frontend.
 */

export type TreasuryQueryClient = {
  readonly __treasuryQueryScaffold: true;
};

export function createTreasuryQueryScaffold(): TreasuryQueryClient {
  return { __treasuryQueryScaffold: true };
}

/** Lista contas — stub (use `createTreasuryAccountRepository`). */
export async function queryTreasuryFinancialAccounts(
  _client: TreasuryQueryClient
): Promise<never[]> {
  return [];
}
