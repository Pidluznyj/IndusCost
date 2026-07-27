/**
 * Facade de repositórios da Tesouraria — server-only.
 * Contas: `createTreasuryAccountRepository`.
 * Títulos oficiais Nomus (read-only): `createTreasuryOfficialTitlesRepository`.
 */

export {
  createTreasuryAccountRepository,
  type TreasuryAccountRepository,
} from "./treasuryAccountRepository.server.js";

export {
  createTreasuryOfficialTitlesRepository,
  type TreasuryOfficialTitlesRepository,
} from "./treasuryOfficialTitlesRepository.server.js";

/** @deprecated Preferir `createTreasuryAccountRepository`. */
export function createTreasuryRepository() {
  return {
    async listFinancialAccounts() {
      return [] as never[];
    },
  };
}
