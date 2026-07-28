/**
 * Agregação de fluxos do dia (CR/CP) para o dashboard.
 * Preferência: SUM/COUNT no banco; memória para testes.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import type { TreasuryCivilDate } from "../contracts/treasuryCivilDate.js";
import type { TreasuryProjectionLayer } from "../contracts/treasuryEnums.js";
import {
  emptyTreasuryDashboardDayFlow,
  type TreasuryDashboardDayFlowAggregate,
  type TreasuryDashboardDayFlowInput,
} from "../domain/treasuryDashboardRules.js";
import {
  addTreasuryMoney,
  normalizeTreasuryMoneyString,
  type TreasuryMoneyString,
} from "../treasuryMoney.js";

export type TreasuryDashboardDayFlowQuery = {
  civilDate: TreasuryCivilDate;
  scenario: TreasuryProjectionLayer;
  accountIds?: string[] | null;
};

export type TreasuryDashboardDayFlowResult = TreasuryDashboardDayFlowInput & {
  highPriorityReceivableCount: number;
  highPriorityPayableCount: number;
};

export type TreasuryDashboardDayFlowRepository = {
  aggregateDayFlow(
    query: TreasuryDashboardDayFlowQuery
  ): Promise<TreasuryDashboardDayFlowResult>;
};

function civilDayUtcRange(civilDate: string): { gte: Date; lt: Date } {
  const [y, m, d] = civilDate.split("-").map(Number);
  const gte = new Date(Date.UTC(y, m - 1, d));
  const lt = new Date(Date.UTC(y, m - 1, d + 1));
  return { gte, lt };
}

function decimalToMoney(
  value: { toFixed(digits: number): string } | null | undefined
): TreasuryMoneyString {
  if (value == null) return "0.00";
  return normalizeTreasuryMoneyString(value.toFixed(2));
}

type AggRow = {
  planned_amount: unknown;
  planned_count: unknown;
  realized_amount: unknown;
  realized_count: unknown;
  pending_amount: unknown;
  pending_count: unknown;
  high_priority_count: unknown;
};

function rowToAggregate(row: AggRow | undefined): {
  flow: TreasuryDashboardDayFlowAggregate;
  highPriorityCount: number;
} {
  if (!row) {
    return {
      flow: emptyTreasuryDashboardDayFlow().receivables,
      highPriorityCount: 0,
    };
  }
  return {
    flow: {
      plannedAmount: normalizeTreasuryMoneyString(
        String(row.planned_amount ?? "0")
      ),
      plannedTitleCount: Number(row.planned_count ?? 0),
      realizedAmount: normalizeTreasuryMoneyString(
        String(row.realized_amount ?? "0")
      ),
      realizedTitleCount: Number(row.realized_count ?? 0),
      pendingAmount: normalizeTreasuryMoneyString(
        String(row.pending_amount ?? "0")
      ),
      pendingTitleCount: Number(row.pending_count ?? 0),
    },
    highPriorityCount: Number(row.high_priority_count ?? 0),
  };
}

/**
 * Repositório Prisma — agrega no PostgreSQL (SUM/COUNT) com JOIN de complemento.
 */
export function createTreasuryDashboardDayFlowRepository(
  prisma: PrismaClient
): TreasuryDashboardDayFlowRepository {
  return {
    async aggregateDayFlow(query) {
      const { gte, lt } = civilDayUtcRange(query.civilDate);
      const accountIds = query.accountIds?.length ? query.accountIds : null;
      const scenario = query.scenario;

      const arRows = await prisma.$queryRaw<AggRow[]>`
        WITH planning AS (
          SELECT
            ar.id,
            ar."balanceReceivable" AS open_balance,
            ar."amountReceived" AS realized_amount,
            ar."settlementDate" AS settlement_date,
            COALESCE(c.priority::text, 'NORMAL') AS priority,
            CASE
              WHEN ${scenario}::text = 'CONTRACTUAL' THEN ar."dueDate"
              WHEN ${scenario}::text = 'PROBABLE' THEN COALESCE(c."expectedDate", ar."dueDate")
              ELSE COALESCE(c."confirmedDate", c."expectedDate", ar."dueDate")
            END AS planning_date
          FROM "NomusAccountsReceivable" ar
          LEFT JOIN "TreasuryTitleOperationalComplement" c
            ON c."titleType" = 'RECEIVABLE'
           AND c."officialTitleId" = ar.id
           AND c."cancelledAt" IS NULL
           AND c.status = 'ACTIVE'
          WHERE ar."sourcePresenceStatus" <> 'MISSING_CONFIRMED'
            AND (
              ${accountIds}::text[] IS NULL
              OR c."plannedAccountId" = ANY(${accountIds}::text[])
            )
        )
        SELECT
          COALESCE(SUM(open_balance) FILTER (
            WHERE planning_date >= ${gte} AND planning_date < ${lt}
              AND open_balance > 0
          ), 0) AS planned_amount,
          COUNT(*) FILTER (
            WHERE planning_date >= ${gte} AND planning_date < ${lt}
              AND open_balance > 0
          ) AS planned_count,
          COALESCE(SUM(realized_amount) FILTER (
            WHERE settlement_date >= ${gte} AND settlement_date < ${lt}
          ), 0) AS realized_amount,
          COUNT(*) FILTER (
            WHERE settlement_date >= ${gte} AND settlement_date < ${lt}
              AND COALESCE(realized_amount, 0) > 0
          ) AS realized_count,
          COALESCE(SUM(open_balance) FILTER (
            WHERE planning_date >= ${gte} AND planning_date < ${lt}
              AND open_balance > 0
          ), 0) AS pending_amount,
          COUNT(*) FILTER (
            WHERE planning_date >= ${gte} AND planning_date < ${lt}
              AND open_balance > 0
          ) AS pending_count,
          COUNT(*) FILTER (
            WHERE planning_date >= ${gte} AND planning_date < ${lt}
              AND open_balance > 0
              AND priority IN ('HIGH', 'URGENT')
          ) AS high_priority_count
        FROM planning
      `;

      const apRows = await prisma.$queryRaw<AggRow[]>`
        WITH planning AS (
          SELECT
            ap.id,
            ap."balancePayable" AS open_balance,
            COALESCE(ap."amountPaid", 0) AS realized_amount,
            COALESCE(ap."paymentDate", ap."settlementDate") AS settlement_date,
            COALESCE(c.priority::text, 'NORMAL') AS priority,
            CASE
              WHEN ${scenario}::text = 'CONTRACTUAL' THEN ap."dueDate"
              WHEN ${scenario}::text = 'PROBABLE' THEN COALESCE(c."scheduledDate", c."expectedDate", ap."scheduleDate", ap."dueDate")
              ELSE COALESCE(c."scheduledDate", c."confirmedDate", ap."scheduleDate", ap."dueDate")
            END AS planning_date
          FROM "NomusAccountsPayable" ap
          LEFT JOIN "TreasuryTitleOperationalComplement" c
            ON c."titleType" = 'PAYABLE'
           AND c."officialTitleId" = ap.id
           AND c."cancelledAt" IS NULL
           AND c.status = 'ACTIVE'
          WHERE ap."sourcePresenceStatus" <> 'MISSING_CONFIRMED'
            AND (
              ${accountIds}::text[] IS NULL
              OR c."plannedAccountId" = ANY(${accountIds}::text[])
            )
        )
        SELECT
          COALESCE(SUM(open_balance) FILTER (
            WHERE planning_date >= ${gte} AND planning_date < ${lt}
              AND open_balance > 0
          ), 0) AS planned_amount,
          COUNT(*) FILTER (
            WHERE planning_date >= ${gte} AND planning_date < ${lt}
              AND open_balance > 0
          ) AS planned_count,
          COALESCE(SUM(realized_amount) FILTER (
            WHERE settlement_date >= ${gte} AND settlement_date < ${lt}
          ), 0) AS realized_amount,
          COUNT(*) FILTER (
            WHERE settlement_date >= ${gte} AND settlement_date < ${lt}
              AND COALESCE(realized_amount, 0) > 0
          ) AS realized_count,
          COALESCE(SUM(open_balance) FILTER (
            WHERE planning_date >= ${gte} AND planning_date < ${lt}
              AND open_balance > 0
          ), 0) AS pending_amount,
          COUNT(*) FILTER (
            WHERE planning_date >= ${gte} AND planning_date < ${lt}
              AND open_balance > 0
          ) AS pending_count,
          COUNT(*) FILTER (
            WHERE planning_date >= ${gte} AND planning_date < ${lt}
              AND open_balance > 0
              AND priority IN ('HIGH', 'URGENT')
          ) AS high_priority_count
        FROM planning
      `;

      const ar = rowToAggregate(arRows[0]);
      const ap = rowToAggregate(apRows[0]);
      return {
        receivables: ar.flow,
        payables: ap.flow,
        highPriorityReceivableCount: ar.highPriorityCount,
        highPriorityPayableCount: ap.highPriorityCount,
      };
    },
  };
}

/** Linha sintética para agregação em memória (testes). */
export type TreasuryDashboardMemoryTitleRow = {
  side: "AR" | "AP";
  openBalance: string;
  realizedAmount: string;
  planningDateByScenario: Record<TreasuryProjectionLayer, TreasuryCivilDate | null>;
  settlementDate: TreasuryCivilDate | null;
  plannedAccountId: string | null;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
};

export function createMemoryTreasuryDashboardDayFlowRepository(
  rows: TreasuryDashboardMemoryTitleRow[]
): TreasuryDashboardDayFlowRepository {
  return {
    async aggregateDayFlow(query) {
      const filtered = rows.filter((r) => {
        if (!query.accountIds?.length) return true;
        return (
          r.plannedAccountId != null &&
          query.accountIds.includes(r.plannedAccountId)
        );
      });

      const aggSide = (side: "AR" | "AP"): {
        flow: TreasuryDashboardDayFlowAggregate;
        highPriorityCount: number;
      } => {
        let plannedAmount = "0.00";
        let plannedTitleCount = 0;
        let realizedAmount = "0.00";
        let realizedTitleCount = 0;
        let pendingAmount = "0.00";
        let pendingTitleCount = 0;
        let highPriorityCount = 0;

        for (const row of filtered.filter((r) => r.side === side)) {
          const planning = row.planningDateByScenario[query.scenario];
          const open = normalizeTreasuryMoneyString(row.openBalance);
          if (planning === query.civilDate && open !== "0.00" && !open.startsWith("-")) {
            // open > 0
            const openNum = Number(open);
            if (openNum > 0) {
              plannedAmount = addTreasuryMoney(plannedAmount, open);
              plannedTitleCount += 1;
              pendingAmount = addTreasuryMoney(pendingAmount, open);
              pendingTitleCount += 1;
              if (row.priority === "HIGH" || row.priority === "URGENT") {
                highPriorityCount += 1;
              }
            }
          }
          if (row.settlementDate === query.civilDate) {
            const realized = normalizeTreasuryMoneyString(row.realizedAmount);
            if (realized !== "0.00") {
              realizedAmount = addTreasuryMoney(realizedAmount, realized);
              realizedTitleCount += 1;
            }
          }
        }

        return {
          flow: {
            plannedAmount,
            plannedTitleCount,
            realizedAmount,
            realizedTitleCount,
            pendingAmount,
            pendingTitleCount,
          },
          highPriorityCount,
        };
      };

      const ar = aggSide("AR");
      const ap = aggSide("AP");
      return {
        receivables: ar.flow,
        payables: ap.flow,
        highPriorityReceivableCount: ar.highPriorityCount,
        highPriorityPayableCount: ap.highPriorityCount,
      };
    },
  };
}

export type TreasuryDashboardFreshnessRepository = {
  loadSources(asOf: Date): Promise<
    {
      source:
        | "BALANCE_SNAPSHOTS"
        | "OFFICIAL_RECEIVABLES"
        | "OFFICIAL_PAYABLES"
        | "TITLE_COMPLEMENTS";
      label: string;
      lastSuccessAt: Date | null;
      detail: string;
    }[]
  >;
};

const STALE_MS = 36 * 60 * 60 * 1000;

export function createTreasuryDashboardFreshnessRepository(
  prisma: PrismaClient
): TreasuryDashboardFreshnessRepository {
  return {
    async loadSources(asOf) {
      const [snap, arSync, apSync, complement] = await Promise.all([
        prisma.treasuryBalanceSnapshot.findFirst({
          orderBy: { referenceAt: "desc" },
          select: { referenceAt: true },
        }),
        prisma.nomusSourceSyncRun.findFirst({
          where: {
            entityType: "ACCOUNTS_RECEIVABLE",
            status: "SUCCESS",
          },
          orderBy: { finishedAt: "desc" },
          select: { finishedAt: true },
        }),
        prisma.nomusSourceSyncRun.findFirst({
          where: {
            entityType: "ACCOUNTS_PAYABLE",
            status: "SUCCESS",
          },
          orderBy: { finishedAt: "desc" },
          select: { finishedAt: true },
        }),
        prisma.treasuryTitleOperationalComplement.findFirst({
          orderBy: { updatedAt: "desc" },
          select: { updatedAt: true },
        }),
      ]);

      return [
        {
          source: "BALANCE_SNAPSHOTS" as const,
          label: "Snapshots de saldo",
          lastSuccessAt: snap?.referenceAt ?? null,
          detail: snap
            ? "Último snapshot válido disponível."
            : "Nenhum snapshot de saldo encontrado.",
        },
        {
          source: "OFFICIAL_RECEIVABLES" as const,
          label: "Contas a receber oficiais (Nomus)",
          lastSuccessAt: arSync?.finishedAt ?? null,
          detail: arSync
            ? "Último sync SUCCESS de CR."
            : "Sem sync SUCCESS de CR.",
        },
        {
          source: "OFFICIAL_PAYABLES" as const,
          label: "Contas a pagar oficiais (Nomus)",
          lastSuccessAt: apSync?.finishedAt ?? null,
          detail: apSync
            ? "Último sync SUCCESS de CP."
            : "Sem sync SUCCESS de CP.",
        },
        {
          source: "TITLE_COMPLEMENTS" as const,
          label: "Complementos operacionais",
          lastSuccessAt: complement?.updatedAt ?? null,
          detail: complement
            ? "Última atualização de complemento."
            : "Sem complementos operacionais.",
        },
      ];
    },
  };
}

export function isTreasurySourceStale(
  lastSuccessAt: Date | null,
  asOf: Date,
  staleMs = STALE_MS
): boolean {
  if (!lastSuccessAt) return true;
  return asOf.getTime() - lastSuccessAt.getTime() > staleMs;
}

export function createMemoryTreasuryDashboardFreshnessRepository(
  sources: Awaited<
    ReturnType<TreasuryDashboardFreshnessRepository["loadSources"]>
  >
): TreasuryDashboardFreshnessRepository {
  return {
    async loadSources() {
      return sources;
    },
  };
}

/** Tipagem auxiliar — evita unused Prisma import em alguns builds. */
export type TreasuryDashboardPrisma = PrismaClient | Prisma.TransactionClient;
