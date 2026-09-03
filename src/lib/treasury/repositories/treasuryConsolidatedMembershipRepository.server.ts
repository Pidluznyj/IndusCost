/**
 * Repositório — `TreasuryConsolidatedAccountMembership` (membership temporal
 * do consolidado). Intervalos [validFrom, validUntil] em dia civil
 * America/Sao_Paulo; `validUntil = null` = vigente.
 *
 * Invariantes:
 *  - no máximo UM intervalo aberto por conta;
 *  - `openInterval` é idempotente para o mesmo (accountId, validFrom) aberto;
 *  - `closeInterval` fecha o intervalo aberto (se houver) e devolve null se
 *    não havia nada a fechar — nunca lança por ausência.
 */

import type { Prisma, PrismaClient } from "@prisma/client";

export type TreasuryConsolidatedMembershipDb = PrismaClient | Prisma.TransactionClient;

export type TreasuryConsolidatedMembershipRow = {
  id: string;
  accountId: string;
  /** YYYY-MM-DD (inclusivo). */
  validFrom: string;
  /** YYYY-MM-DD (inclusivo) ou null = vigente. */
  validUntil: string | null;
  reason: string;
  createdByUserId: string | null;
  createdAt: Date;
  closedAt: Date | null;
  closedByUserId: string | null;
};

export type TreasuryConsolidatedMembershipReason =
  | "BOOTSTRAP"
  | "ACCOUNT_CREATED"
  | "INCLUDE_ON"
  | "INCLUDE_OFF"
  | "DEACTIVATED"
  | "REACTIVATED"
  | "MANUAL";

export type TreasuryConsolidatedMembershipRepository = {
  listByAccountIds(
    accountIds: readonly string[],
    db?: TreasuryConsolidatedMembershipDb
  ): Promise<TreasuryConsolidatedMembershipRow[]>;
  openInterval(
    input: {
      accountId: string;
      validFrom: string;
      reason: TreasuryConsolidatedMembershipReason;
      createdByUserId: string | null;
    },
    db?: TreasuryConsolidatedMembershipDb
  ): Promise<TreasuryConsolidatedMembershipRow>;
  closeInterval(
    input: {
      accountId: string;
      validUntil: string;
      reason: TreasuryConsolidatedMembershipReason;
      closedByUserId: string | null;
    },
    db?: TreasuryConsolidatedMembershipDb
  ): Promise<TreasuryConsolidatedMembershipRow | null>;
};

type TreasuryConsolidatedMembershipPrismaRow = {
  id: string;
  accountId: string;
  validFrom: Date;
  validUntil: Date | null;
  reason: string;
  createdByUserId: string | null;
  createdAt: Date;
  closedAt: Date | null;
  closedByUserId: string | null;
};

function toCivilDateString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function civilDateStringToUtcMidnight(civilDate: string): Date {
  return new Date(`${civilDate}T00:00:00.000Z`);
}

function toRow(
  row: TreasuryConsolidatedMembershipPrismaRow
): TreasuryConsolidatedMembershipRow {
  return {
    id: row.id,
    accountId: row.accountId,
    validFrom: toCivilDateString(row.validFrom),
    validUntil: row.validUntil == null ? null : toCivilDateString(row.validUntil),
    reason: row.reason,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
    closedAt: row.closedAt,
    closedByUserId: row.closedByUserId,
  };
}

export function createTreasuryConsolidatedMembershipRepository(
  prisma: PrismaClient
): TreasuryConsolidatedMembershipRepository {
  return {
    async listByAccountIds(accountIds, db) {
      const client = db ?? prisma;
      const rows = await client.treasuryConsolidatedAccountMembership.findMany({
        where: { accountId: { in: [...accountIds] } },
        orderBy: [{ accountId: "asc" }, { validFrom: "asc" }],
      });
      return rows.map(toRow);
    },

    async openInterval(input, db) {
      const client = db ?? prisma;
      const open = await client.treasuryConsolidatedAccountMembership.findFirst({
        where: { accountId: input.accountId, validUntil: null },
      });
      if (open) return toRow(open);
      const created = await client.treasuryConsolidatedAccountMembership.create({
        data: {
          accountId: input.accountId,
          validFrom: civilDateStringToUtcMidnight(input.validFrom),
          validUntil: null,
          reason: input.reason,
          createdByUserId: input.createdByUserId,
        },
      });
      return toRow(created);
    },

    async closeInterval(input, db) {
      const client = db ?? prisma;
      const open = await client.treasuryConsolidatedAccountMembership.findFirst({
        where: { accountId: input.accountId, validUntil: null },
      });
      if (!open) return null;
      const updated = await client.treasuryConsolidatedAccountMembership.update({
        where: { id: open.id },
        data: {
          validUntil: civilDateStringToUtcMidnight(input.validUntil),
          closedAt: new Date(),
          closedByUserId: input.closedByUserId,
          reason: input.reason,
        },
      });
      return toRow(updated);
    },
  };
}
