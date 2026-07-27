/**
 * Carrega fatos leves para o motor de alertas (Prisma — server-only).
 */

import type { PrismaClient } from "@prisma/client";
import { toCivilDateKey } from "@/src/lib/financeCivilDate.js";
import type {
  TreasuryAlertPayableFact,
  TreasuryAlertPromiseFact,
  TreasuryAlertReceivableFact,
} from "../domain/treasuryAlertRules.js";

export type TreasuryAlertFactsRepository = {
  loadReceivables(limit?: number): Promise<TreasuryAlertReceivableFact[]>;
  loadActivePromises(limit?: number): Promise<TreasuryAlertPromiseFact[]>;
  loadCriticalPayables(limit?: number): Promise<TreasuryAlertPayableFact[]>;
  loadAccountMinimums(
    accountIds: string[]
  ): Promise<
    Map<string, { minimumBalance: string; allowNegativeBalance: boolean }>
  >;
};

function money(value: { toFixed(d: number): string } | null | undefined): string {
  return value?.toFixed(2) ?? "0.00";
}

export function createTreasuryAlertFactsRepository(
  prisma: PrismaClient
): TreasuryAlertFactsRepository {
  return {
    async loadReceivables(limit = 500) {
      const rows = await prisma.nomusAccountsReceivable.findMany({
        where: {
          settlementDate: null,
          balanceReceivable: { gt: 0 },
        },
        take: limit,
        orderBy: { dueDate: "asc" },
        select: {
          id: true,
          balanceReceivable: true,
          dueDate: true,
          personId: true,
          personName: true,
          settlementDate: true,
        },
      });
      const overlays =
        await prisma.treasuryTitleOperationalComplement.findMany({
          where: {
            titleType: "RECEIVABLE",
            officialTitleId: { in: rows.map((r) => r.id) },
            cancelledAt: null,
          },
          select: {
            officialTitleId: true,
            expectedDate: true,
          },
        });
      const expectedById = new Map(
        overlays.map((o) => [
          o.officialTitleId,
          o.expectedDate ? toCivilDateKey(o.expectedDate) : null,
        ])
      );
      return rows.map(
        (r): TreasuryAlertReceivableFact => ({
          officialTitleId: r.id,
          customerKey: String(r.personId ?? r.personName ?? r.id),
          customerName: r.personName,
          openAmount: money(r.balanceReceivable),
          expectedDate:
            expectedById.get(r.id) ??
            (r.dueDate ? toCivilDateKey(r.dueDate) : null),
          isSettled: r.settlementDate != null,
          isCancelled: false,
        })
      );
    },

    async loadActivePromises(limit = 200) {
      const rows = await prisma.treasuryPaymentPromise.findMany({
        where: {
          status: { in: ["ACTIVE", "PARTIALLY_FULFILLED", "EXPIRED"] },
          cancelledAt: null,
        },
        take: limit,
        orderBy: { promisedDate: "asc" },
        select: {
          id: true,
          officialTitleId: true,
          promisedDate: true,
          status: true,
          promisedAmount: true,
        },
      });
      return rows.map(
        (r): TreasuryAlertPromiseFact => ({
          id: r.id,
          officialTitleId: r.officialTitleId,
          promisedDate: toCivilDateKey(r.promisedDate) ?? "",
          status: String(r.status),
          promisedAmount: money(r.promisedAmount),
        })
      );
    },

    async loadCriticalPayables(limit = 200) {
      const ops = await prisma.treasuryTitleOperationalComplement.findMany({
        where: {
          titleType: "PAYABLE",
          cancelledAt: null,
          priority: { in: ["HIGH", "URGENT"] },
          scheduledDate: null,
        },
        take: limit,
        select: {
          officialTitleId: true,
          priority: true,
          scheduledDate: true,
        },
      });
      if (ops.length === 0) return [];
      const titles = await prisma.nomusAccountsPayable.findMany({
        where: {
          id: { in: ops.map((o) => o.officialTitleId) },
          settlementDate: null,
          balancePayable: { gt: 0 },
        },
        select: {
          id: true,
          balancePayable: true,
          settlementDate: true,
        },
      });
      const byId = new Map(titles.map((t) => [t.id, t]));
      const out: TreasuryAlertPayableFact[] = [];
      for (const o of ops) {
        const t = byId.get(o.officialTitleId);
        if (!t) continue;
        out.push({
          officialTitleId: o.officialTitleId,
          openAmount: money(t.balancePayable),
          isCritical: true,
          isProgrammed: o.scheduledDate != null,
          isSettled: t.settlementDate != null,
          isCancelled: false,
        });
      }
      return out;
    },

    async loadAccountMinimums(accountIds) {
      const map = new Map<
        string,
        { minimumBalance: string; allowNegativeBalance: boolean }
      >();
      if (accountIds.length === 0) return map;
      const rows = await prisma.treasuryFinancialAccount.findMany({
        where: { id: { in: accountIds } },
        select: {
          id: true,
          minimumBalance: true,
          allowNegativeBalance: true,
        },
      });
      for (const r of rows) {
        map.set(r.id, {
          minimumBalance: money(r.minimumBalance),
          allowNegativeBalance: r.allowNegativeBalance,
        });
      }
      return map;
    },
  };
}
