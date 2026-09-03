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

export function createTreasuryConsolidatedMembershipRepository(
  prisma: PrismaClient
): TreasuryConsolidatedMembershipRepository {
  void prisma;
  throw new Error("not implemented: createTreasuryConsolidatedMembershipRepository");
}
