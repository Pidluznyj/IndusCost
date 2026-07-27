/**
 * Fonte de movimentos realizados oficiais para a posição financeira.
 * Enquanto o ledger/OFX não estiver ativo, o adapter Prisma retorna vazio
 * (ausência explícita — não inventa movimentos).
 */

import type { PrismaClient } from "@prisma/client";
import type { TreasuryOfficialRealizedMovement } from "../domain/treasuryFinancialPositionRules.js";

export type TreasuryOfficialRealizedMovementRepository = {
  listByAccountIds(input: {
    accountIds: string[];
    asOf?: Date;
  }): Promise<TreasuryOfficialRealizedMovement[]>;
};

/**
 * Stub server: ledger Tesouraria ainda não existe no Prisma.
 * Retorna lista vazia — o engine trata origem ZERO_BASELINE / só snapshot.
 */
export function createTreasuryOfficialRealizedMovementRepository(
  _prisma?: PrismaClient
): TreasuryOfficialRealizedMovementRepository {
  return {
    async listByAccountIds() {
      return [];
    },
  };
}

export type TreasuryOfficialRealizedMovementMemoryStore = {
  movements: TreasuryOfficialRealizedMovement[];
};

export function createEmptyOfficialRealizedMovementMemoryStore(): TreasuryOfficialRealizedMovementMemoryStore {
  return { movements: [] };
}

export function createMemoryTreasuryOfficialRealizedMovementRepository(
  store: TreasuryOfficialRealizedMovementMemoryStore
): TreasuryOfficialRealizedMovementRepository {
  return {
    async listByAccountIds(input) {
      const ids = new Set(input.accountIds);
      const asOf = input.asOf?.getTime();
      return store.movements.filter((m) => {
        if (!ids.has(m.accountId)) return false;
        if (asOf != null && m.occurredAt.getTime() > asOf) return false;
        return true;
      });
    },
  };
}
