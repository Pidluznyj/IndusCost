/**
 * Facade de repositórios da Tesouraria — server-only.
 * Contas: `createTreasuryAccountRepository`.
 */

export {
  createTreasuryAccountRepository,
  type TreasuryAccountRepository,
} from "./treasuryAccountRepository.server.js";

/** @deprecated Preferir `createTreasuryAccountRepository`. */
export function createTreasuryRepository() {
  return {
    async listFinancialAccounts() {
      return [] as never[];
    },
  };
}
