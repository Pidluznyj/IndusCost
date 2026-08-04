/**
 * Carrega fatos para o preview de fechamento diário (Prisma — server-only).
 * Movimentos OFX/ledger ainda não existem: unreconciledMovements vem vazio até haver fonte.
 */

import type { PrismaClient } from "@prisma/client";
import { toCivilDateKey } from "@/src/lib/financeCivilDate.js";
import type { TreasuryCivilDate } from "../contracts/treasuryCivilDate.js";
import type { TreasuryClosingStatus } from "../contracts/treasuryEnums.js";
import { formatTreasuryTimestampIso } from "../contracts/treasuryTimestamp.js";
import type {
  TreasuryDailyClosingPreviewAccountFact,
  TreasuryDailyClosingPreviewFacts,
  TreasuryDailyClosingPreviewPendencyFact,
  TreasuryDailyClosingPreviewPromiseFact,
  TreasuryDailyClosingPreviewTransferFact,
} from "../domain/treasuryDailyClosingPreviewRules.js";
import {
  addTreasuryMoney,
  normalizeTreasuryMoneyString,
} from "../treasuryMoney.js";

export type TreasuryDailyClosingPreviewFactsQuery = {
  civilDate: TreasuryCivilDate;
  companyCode?: string | null;
  accountIds?: string[] | null;
  staleBalanceHours: number;
  syncMaxAgeHours: number;
  now?: Date;
};

export type TreasuryDailyClosingPreviewFactsRepository = {
  loadPreviewFacts(
    query: TreasuryDailyClosingPreviewFactsQuery
  ): Promise<TreasuryDailyClosingPreviewFacts>;
};

function money(value: { toFixed(d: number): string } | null | undefined): string {
  return normalizeTreasuryMoneyString(value?.toFixed(2) ?? "0.00");
}

function hoursSince(from: Date, now: Date): number {
  return (now.getTime() - from.getTime()) / (1000 * 60 * 60);
}

export function createTreasuryDailyClosingPreviewFactsRepository(
  prisma: PrismaClient
): TreasuryDailyClosingPreviewFactsRepository {
  return {
    async loadPreviewFacts(query) {
      const now = query.now ?? new Date();
      const companyCode = query.companyCode?.trim() || null;

      const accounts = await prisma.treasuryFinancialAccount.findMany({
        where: {
          isActive: true,
          ...(companyCode ? { companyCode } : {}),
          ...(query.accountIds?.length
            ? { id: { in: query.accountIds } }
            : {}),
        },
        orderBy: [{ sortOrder: "asc" }, { code: "asc" }],
        select: {
          id: true,
          code: true,
          name: true,
          includeInConsolidated: true,
          minimumBalance: true,
          allowNegativeBalance: true,
        },
      });

      const accountIds = accounts.map((a) => a.id);
      const snapshots =
        accountIds.length === 0
          ? []
          : await prisma.treasuryBalanceSnapshot.findMany({
              where: { accountId: { in: accountIds }, cancelledAt: null },
              orderBy: { referenceAt: "desc" },
              select: {
                accountId: true,
                availableBalance: true,
                referenceAt: true,
                idempotencyKey: true,
                origin: true,
              },
            });

      const openingByAccount = new Map<string, string>();
      const closingBankByAccount = new Map<string, string>();
      const latestByAccount = new Map<
        string,
        { availableBalance: (typeof snapshots)[number]["availableBalance"]; referenceAt: Date }
      >();

      for (const s of snapshots) {
        if (!latestByAccount.has(s.accountId)) {
          latestByAccount.set(s.accountId, {
            availableBalance: s.availableBalance,
            referenceAt: s.referenceAt,
          });
        }
        const key = s.idempotencyKey ?? "";
        if (
          s.origin === "MANUAL" &&
          key.startsWith(`daily-opening:${query.civilDate}:`) &&
          !openingByAccount.has(s.accountId)
        ) {
          openingByAccount.set(s.accountId, money(s.availableBalance));
        }
        if (
          s.origin === "MANUAL" &&
          key.startsWith(`daily-closing-bank:${query.civilDate}:`) &&
          !closingBankByAccount.has(s.accountId)
        ) {
          closingBankByAccount.set(s.accountId, money(s.availableBalance));
        }
      }

      const accountFacts: TreasuryDailyClosingPreviewAccountFact[] =
        accounts.map((a) => {
          const snap = latestByAccount.get(a.id);
          const opening =
            openingByAccount.get(a.id) ??
            (snap ? money(snap.availableBalance) : "0.00");
          const observed =
            closingBankByAccount.get(a.id) ??
            (snap ? money(snap.availableBalance) : null);
          const age =
            snap != null ? hoursSince(snap.referenceAt, now) : null;
          return {
            accountId: a.id,
            code: a.code,
            name: a.name,
            includeInConsolidated: a.includeInConsolidated,
            openingBalance: opening,
            realizedInflows: "0.00",
            realizedOutflows: "0.00",
            pendenciesAmount: "0.00",
            closingBalance: observed ?? opening,
            observedBalance: observed,
            reconciledBalance: null,
            minimumBalance: money(a.minimumBalance),
            allowNegativeBalance: a.allowNegativeBalance,
            lastBalanceAtIso: snap
              ? formatTreasuryTimestampIso(snap.referenceAt)
              : null,
            balanceAgeHours: age,
          };
        });

      const arRows = await prisma.nomusAccountsReceivable.findMany({
        where: {
          settlementDate: null,
          balanceReceivable: { gt: 0 },
        },
        take: 500,
        orderBy: { dueDate: "asc" },
        select: {
          id: true,
          balanceReceivable: true,
          dueDate: true,
          personName: true,
          externalId: true,
        },
      });
      const arOverlays =
        arRows.length === 0
          ? []
          : await prisma.treasuryTitleOperationalComplement.findMany({
              where: {
                titleType: "RECEIVABLE",
                officialTitleId: { in: arRows.map((r) => r.id) },
                cancelledAt: null,
              },
              select: {
                officialTitleId: true,
                expectedDate: true,
                plannedAccountId: true,
              },
            });
      const arOverlayById = new Map(
        arOverlays.map((o) => [o.officialTitleId, o] as const)
      );
      const pendingReceivables: TreasuryDailyClosingPreviewPendencyFact[] =
        arRows.map((r) => {
          const o = arOverlayById.get(r.id);
          return {
            side: "RECEIVABLE" as const,
            officialTitleId: r.id,
            nomusExternalId: r.externalId,
            counterpartyName: r.personName,
            openAmount: money(r.balanceReceivable),
            dueDate: r.dueDate ? toCivilDateKey(r.dueDate) : null,
            expectedDate: o?.expectedDate
              ? toCivilDateKey(o.expectedDate)
              : null,
            accountId: o?.plannedAccountId ?? null,
          };
        });

      const apRows = await prisma.nomusAccountsPayable.findMany({
        where: {
          settlementDate: null,
          balancePayable: { gt: 0 },
        },
        take: 500,
        orderBy: { dueDate: "asc" },
        select: {
          id: true,
          balancePayable: true,
          dueDate: true,
          personName: true,
          externalId: true,
        },
      });
      const apOverlays =
        apRows.length === 0
          ? []
          : await prisma.treasuryTitleOperationalComplement.findMany({
              where: {
                titleType: "PAYABLE",
                officialTitleId: { in: apRows.map((r) => r.id) },
                cancelledAt: null,
              },
              select: {
                officialTitleId: true,
                expectedDate: true,
                plannedAccountId: true,
              },
            });
      const apOverlayById = new Map(
        apOverlays.map((o) => [o.officialTitleId, o] as const)
      );
      const pendingPayables: TreasuryDailyClosingPreviewPendencyFact[] =
        apRows.map((r) => {
          const o = apOverlayById.get(r.id);
          return {
            side: "PAYABLE" as const,
            officialTitleId: r.id,
            nomusExternalId: r.externalId,
            counterpartyName: r.personName,
            openAmount: money(r.balancePayable),
            dueDate: r.dueDate ? toCivilDateKey(r.dueDate) : null,
            expectedDate: o?.expectedDate
              ? toCivilDateKey(o.expectedDate)
              : null,
            accountId: o?.plannedAccountId ?? null,
          };
        });

      const pendMap = new Map<string, string>();
      for (const p of [...pendingReceivables, ...pendingPayables]) {
        if (!p.accountId) continue;
        const prev = pendMap.get(p.accountId) ?? "0.00";
        pendMap.set(
          p.accountId,
          addTreasuryMoney(prev, normalizeTreasuryMoneyString(p.openAmount))
        );
      }
      for (const fact of accountFacts) {
        const pend = pendMap.get(fact.accountId);
        if (pend) fact.pendenciesAmount = pend;
      }

      const promiseRows = await prisma.treasuryPaymentPromise.findMany({
        where: {
          status: { in: ["EXPIRED", "ACTIVE", "PARTIALLY_FULFILLED"] },
          cancelledAt: null,
        },
        take: 200,
        select: {
          id: true,
          officialTitleId: true,
          promisedAmount: true,
          promisedDate: true,
          status: true,
        },
      });
      const expiredPromises: TreasuryDailyClosingPreviewPromiseFact[] =
        promiseRows
          .filter((p) => {
            const promisedCivil = toCivilDateKey(p.promisedDate);
            return (
              p.status === "EXPIRED" || promisedCivil < query.civilDate
            );
          })
          .map((p) => ({
            id: p.id,
            officialTitleId: p.officialTitleId,
            promisedAmount: money(p.promisedAmount),
            promisedDate: toCivilDateKey(p.promisedDate),
            status: p.status,
          }));

      const transferRows = await prisma.treasuryTransfer.findMany({
        where: {
          status: "SENT",
          ...(companyCode ? { companyCode } : {}),
        },
        take: 200,
        select: {
          id: true,
          fromAccountId: true,
          toAccountId: true,
          amount: true,
          status: true,
        },
      });
      const transfersInTransit: TreasuryDailyClosingPreviewTransferFact[] =
        transferRows.map((t) => ({
          id: t.id,
          fromAccountId: t.fromAccountId,
          toAccountId: t.toAccountId,
          amount: money(t.amount),
          status: t.status,
        }));

      const [civilY, civilM, civilD] = query.civilDate.split("-").map(Number);
      const civilDateStart = new Date(Date.UTC(civilY, civilM - 1, civilD));
      const currentClosing = await prisma.treasuryDailyClosing.findFirst({
        where: {
          civilDate: civilDateStart,
          status: { in: ["OPEN", "CLOSED"] },
          ...(companyCode ? { companyCode } : {}),
        },
        select: { status: true },
        orderBy: { version: "desc" },
      });

      const openDup = await prisma.treasuryException.count({
        where: {
          type: "SUSPECTED_DUPLICATE",
          status: {
            in: ["OPEN", "ACK", "IN_ANALYSIS", "WAITING_THIRD_PARTY"],
          },
          ...(companyCode ? { companyCode } : {}),
        },
      });

      const lastSync = await prisma.nomusSourceSyncRun.findFirst({
        where: { status: "SUCCESS" },
        orderBy: { finishedAt: "desc" },
        select: { finishedAt: true },
      });
      const syncAgeHours =
        lastSync?.finishedAt != null
          ? hoursSince(lastSync.finishedAt, now)
          : null;

      return {
        civilDate: query.civilDate,
        companyCode,
        generatedAtIso: formatTreasuryTimestampIso(now),
        staleBalanceHours: query.staleBalanceHours,
        syncMaxAgeHours: query.syncMaxAgeHours,
        syncAgeHours,
        currentClosingStatus:
          (currentClosing?.status as TreasuryClosingStatus | undefined) ??
          null,
        hasSourceData: accounts.length > 0,
        openSuspectedDuplicateCount: openDup,
        accounts: accountFacts,
        pendingReceivables,
        pendingPayables,
        unreconciledMovements: [],
        expiredPromises,
        transfersInTransit,
      };
    },
  };
}
