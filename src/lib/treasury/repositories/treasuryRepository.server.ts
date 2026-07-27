/**
 * Repository scaffold da Tesouraria.
 * Sem Prisma / sem persistência real nesta etapa.
 * Sufixo .server: não importar no frontend.
 */

import {
  createTreasuryQueryScaffold,
  queryTreasuryFinancialAccounts,
  type TreasuryQueryClient,
} from "../queries/treasuryQueries.server.js";

export type TreasuryRepository = {
  listFinancialAccounts(): Promise<never[]>;
};

export function createTreasuryRepository(
  client: TreasuryQueryClient = createTreasuryQueryScaffold()
): TreasuryRepository {
  return {
    async listFinancialAccounts() {
      return queryTreasuryFinancialAccounts(client);
    },
  };
}
