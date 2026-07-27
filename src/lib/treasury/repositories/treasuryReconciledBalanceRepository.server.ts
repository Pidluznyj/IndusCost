/**
 * Fonte de saldos conciliados (conciliação bancária).
 * Stub vazio até o workspace de conciliação — ausência é explícita.
 */

import type { PrismaClient } from "@prisma/client";
import type { TreasuryReconciledBalanceHint } from "../domain/treasuryFinancialPositionRules.js";

export type TreasuryReconciledBalanceRepository = {
  listByAccountIds(input: {
    accountIds: string[];
    asOf?: Date;
  }): Promise<TreasuryReconciledBalanceHint[]>;
};

export function createTreasuryReconciledBalanceRepository(
  _prisma?: PrismaClient
): TreasuryReconciledBalanceRepository {
  return {
    async listByAccountIds() {
      return [];
    },
  };
}

export type TreasuryReconciledBalanceMemoryStore = {
  rows: TreasuryReconciledBalanceHint[];
};

export function createEmptyReconciledBalanceMemoryStore(): TreasuryReconciledBalanceMemoryStore {
  return { rows: [] };
}

export function createMemoryTreasuryReconciledBalanceRepository(
  store: TreasuryReconciledBalanceMemoryStore
): TreasuryReconciledBalanceRepository {
  return {
    async listByAccountIds(input) {
      const ids = new Set(input.accountIds);
      const asOf = input.asOf?.getTime();
      return store.rows.filter((r) => {
        if (!ids.has(r.accountId)) return false;
        if (asOf != null && r.reconciledAt.getTime() > asOf) return false;
        return true;
      });
    },
  };
}
