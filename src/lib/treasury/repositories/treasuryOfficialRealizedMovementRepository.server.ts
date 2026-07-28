/**
 * Fonte de movimentos realizados para a posição financeira.
 * Usa lançamentos manuais/ledger ACTIVE (não inventa baixas Nomus).
 * Ausência de linhas = lista vazia (engine trata ZERO_BASELINE / só snapshot).
 */

import type { PrismaClient } from "@prisma/client";
import type { TreasuryOfficialRealizedMovement } from "../domain/treasuryFinancialPositionRules.js";

export type TreasuryOfficialRealizedMovementRepository = {
  listByAccountIds(input: {
    accountIds: string[];
    asOf?: Date;
  }): Promise<TreasuryOfficialRealizedMovement[]>;
};

function civilDateToUtcNoon(civil: Date): Date {
  const y = civil.getUTCFullYear();
  const m = civil.getUTCMonth();
  const d = civil.getUTCDate();
  return new Date(Date.UTC(y, m, d, 12, 0, 0, 0));
}

export function createTreasuryOfficialRealizedMovementRepository(
  prisma: PrismaClient
): TreasuryOfficialRealizedMovementRepository {
  return {
    async listByAccountIds(input) {
      if (!input.accountIds.length) return [];
      const asOf = input.asOf;
      const rows = await prisma.treasuryLedgerEntry.findMany({
        where: {
          accountId: { in: input.accountIds },
          status: "ACTIVE",
          ...(asOf
            ? {
                civilDate: {
                  lte: new Date(
                    Date.UTC(
                      asOf.getUTCFullYear(),
                      asOf.getUTCMonth(),
                      asOf.getUTCDate()
                    )
                  ),
                },
              }
            : {}),
        },
        select: {
          id: true,
          accountId: true,
          civilDate: true,
          createdAt: true,
          amount: true,
          direction: true,
          status: true,
          nature: true,
          memo: true,
        },
        orderBy: [{ civilDate: "asc" }, { createdAt: "asc" }],
      });

      return rows
        .map((row) => {
          const occurredAt = civilDateToUtcNoon(row.civilDate);
          return {
            id: row.id,
            accountId: row.accountId,
            occurredAt,
            amount: row.amount.toFixed(2),
            direction: row.direction,
            status: row.status,
            source: `LEDGER:${row.nature}`,
            memo: row.memo,
          } satisfies TreasuryOfficialRealizedMovement;
        })
        .filter((m) => (asOf ? m.occurredAt.getTime() <= asOf.getTime() : true));
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
