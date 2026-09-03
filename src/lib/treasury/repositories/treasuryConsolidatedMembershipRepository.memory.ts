/**
 * Implementação em memória do repositório de membership do consolidado —
 * para testes de serviço (mesmo papel de `treasuryAccountRepository.memory.ts`).
 */

import type {
  TreasuryConsolidatedMembershipRepository,
  TreasuryConsolidatedMembershipRow,
} from "./treasuryConsolidatedMembershipRepository.server.js";

export type TreasuryConsolidatedMembershipMemoryStore = {
  rows: TreasuryConsolidatedMembershipRow[];
  nextId: number;
};

export function createEmptyTreasuryConsolidatedMembershipMemoryStore(): TreasuryConsolidatedMembershipMemoryStore {
  return { rows: [], nextId: 1 };
}

export function createMemoryTreasuryConsolidatedMembershipRepository(
  store: TreasuryConsolidatedMembershipMemoryStore = createEmptyTreasuryConsolidatedMembershipMemoryStore(),
  now: () => Date = () => new Date()
): TreasuryConsolidatedMembershipRepository {
  return {
    async listByAccountIds(accountIds) {
      const set = new Set(accountIds);
      return store.rows
        .filter((r) => set.has(r.accountId))
        .map((r) => ({ ...r }))
        .sort((a, b) =>
          a.accountId === b.accountId
            ? a.validFrom.localeCompare(b.validFrom)
            : a.accountId.localeCompare(b.accountId)
        );
    },
    async openInterval(input) {
      const open = store.rows.find(
        (r) => r.accountId === input.accountId && r.validUntil == null
      );
      if (open) return { ...open };
      const row: TreasuryConsolidatedMembershipRow = {
        id: `membership-${store.nextId++}`,
        accountId: input.accountId,
        validFrom: input.validFrom,
        validUntil: null,
        reason: input.reason,
        createdByUserId: input.createdByUserId,
        createdAt: now(),
        closedAt: null,
        closedByUserId: null,
      };
      store.rows.push(row);
      return { ...row };
    },
    async closeInterval(input) {
      const open = store.rows.find(
        (r) => r.accountId === input.accountId && r.validUntil == null
      );
      if (!open) return null;
      open.validUntil = input.validUntil;
      open.closedAt = now();
      open.closedByUserId = input.closedByUserId;
      open.reason = input.reason;
      return { ...open };
    },
  };
}
