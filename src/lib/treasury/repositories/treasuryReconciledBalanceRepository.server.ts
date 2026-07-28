/**
 * Fonte de saldos conciliados: ledger balance OFX persistido no lote (summaryJson).
 * Sem saldo OFX → lista vazia (origem MISSING no engine — não inventa igualdade com observado).
 */

import type { PrismaClient } from "@prisma/client";
import type { TreasuryReconciledBalanceHint } from "../domain/treasuryFinancialPositionRules.js";
import { normalizeTreasuryMoneyString } from "../treasuryMoney.js";

export type TreasuryReconciledBalanceRepository = {
  listByAccountIds(input: {
    accountIds: string[];
    asOf?: Date;
  }): Promise<TreasuryReconciledBalanceHint[]>;
};

function readLedgerBalanceFromSummary(summaryJson: unknown): {
  amount: string;
  asOfCivilDate: string | null;
} | null {
  if (!summaryJson || typeof summaryJson !== "object") return null;
  const row = summaryJson as Record<string, unknown>;
  const amountRaw = row.ledgerBalanceAmount;
  if (typeof amountRaw !== "string" || !amountRaw.trim()) return null;
  try {
    return {
      amount: normalizeTreasuryMoneyString(amountRaw),
      asOfCivilDate:
        typeof row.ledgerBalanceAsOfCivilDate === "string"
          ? row.ledgerBalanceAsOfCivilDate
          : null,
    };
  } catch {
    return null;
  }
}

function civilDateToUtcNoon(civil: string): Date {
  const [y, m, d] = civil.split("-").map((p) => Number(p));
  return new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0));
}

export function createTreasuryReconciledBalanceRepository(
  prisma: PrismaClient
): TreasuryReconciledBalanceRepository {
  return {
    async listByAccountIds(input) {
      if (!input.accountIds.length) return [];
      const batches = await prisma.treasuryBankImportBatch.findMany({
        where: {
          accountId: { in: input.accountIds },
          status: "PROCESSED",
          ...(input.asOf ? { processedAt: { lte: input.asOf } } : {}),
        },
        orderBy: [{ processedAt: "desc" }, { createdAt: "desc" }],
        select: {
          accountId: true,
          processedAt: true,
          createdAt: true,
          summaryJson: true,
        },
      });

      const byAccount = new Map<string, TreasuryReconciledBalanceHint>();
      for (const batch of batches) {
        if (byAccount.has(batch.accountId)) continue;
        const ledger = readLedgerBalanceFromSummary(batch.summaryJson);
        if (!ledger) continue;
        const reconciledAt = ledger.asOfCivilDate
          ? civilDateToUtcNoon(ledger.asOfCivilDate)
          : (batch.processedAt ?? batch.createdAt);
        byAccount.set(batch.accountId, {
          accountId: batch.accountId,
          reconciledBalance: ledger.amount,
          reconciledAt,
          source: "OFX_LEDGER_BALANCE",
        });
      }
      return [...byAccount.values()];
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
