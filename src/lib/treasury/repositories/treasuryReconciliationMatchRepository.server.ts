/**
 * Repository de matches de conciliação bancária — Prisma.
 */

import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";
import type { TreasuryReconciliationMatchRow } from "../mappers/treasuryReconciliationMatchMappers.js";

export type TreasuryReconciliationMatchDb =
  | PrismaClient
  | Prisma.TransactionClient;

function moneyToDecimal(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function civilDateToUtcDate(value: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) {
    throw new TreasuryDomainError(
      "INVALID_CIVIL_DATE",
      `Data civil inválida: ${value}`,
      "matchedCivilDate"
    );
  }
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function mapRow(row: {
  id: string;
  companyCode: string;
  accountId: string;
  status: string;
  matchedAmount: Prisma.Decimal;
  currency: string;
  matchedCivilDate: Date;
  justification: string | null;
  suggestionKey: string | null;
  algorithmVersion: string | null;
  suggestionScore: number | null;
  suggestionConfidence: string | null;
  suggestionReasonsJson: Prisma.JsonValue | null;
  version: number;
  createdAt: Date;
  createdByUserId: string;
  updatedAt: Date;
  updatedByUserId: string | null;
  unmatchedAt: Date | null;
  unmatchedByUserId: string | null;
  unmatchReason: string | null;
  movements: Array<{
    id: string;
    matchId: string;
    bankMovementId: string;
    amount: Prisma.Decimal;
    sortOrder: number;
  }>;
  allocations: Array<{
    id: string;
    matchId: string;
    kind: string;
    amount: Prisma.Decimal;
    memo: string | null;
    nomusSide: string | null;
    officialTitleId: string | null;
    nomusExternalId: number | null;
    transferId: string | null;
    transferGroupId: string | null;
    ledgerEntryId: string | null;
    differenceCode: string | null;
    sortOrder: number;
  }>;
}): TreasuryReconciliationMatchRow {
  return {
    ...row,
    matchedAmount: row.matchedAmount,
    suggestionReasonsJson: row.suggestionReasonsJson,
    movements: row.movements.map((m) => ({
      ...m,
      amount: m.amount,
    })),
    allocations: row.allocations.map((a) => ({
      ...a,
      amount: a.amount,
    })),
  };
}

const includeAll = {
  movements: { orderBy: { sortOrder: "asc" as const } },
  allocations: { orderBy: { sortOrder: "asc" as const } },
};

export type TreasuryBankMovementReconciliationSnapshot = {
  id: string;
  companyCode: string;
  accountId: string;
  amount: string;
  reconciliationStatus: string;
  reconciledAmount: string;
};

export type TreasuryReconciliationMatchCreateData = {
  companyCode: string;
  accountId: string;
  status: "MATCHED" | "PENDING" | "IGNORED";
  matchedAmount: string;
  currency?: string;
  matchedCivilDate: string;
  justification?: string | null;
  idempotencyKey?: string | null;
  suggestionKey?: string | null;
  algorithmVersion?: string | null;
  suggestionScore?: number | null;
  suggestionConfidence?: string | null;
  suggestionReasonsJson?: unknown;
  createdByUserId: string;
  movements: Array<{ bankMovementId: string; amount: string; sortOrder: number }>;
  allocations: Array<{
    kind: string;
    amount: string;
    memo?: string | null;
    nomusSide?: string | null;
    officialTitleId?: string | null;
    nomusExternalId?: number | null;
    transferId?: string | null;
    transferGroupId?: string | null;
    ledgerEntryId?: string | null;
    differenceCode?: string | null;
    sortOrder: number;
  }>;
};

export type TreasuryReconciliationMatchRepository = {
  findById(
    id: string,
    db?: TreasuryReconciliationMatchDb
  ): Promise<TreasuryReconciliationMatchRow | null>;
  listActiveByBankMovementId(
    bankMovementId: string,
    db?: TreasuryReconciliationMatchDb
  ): Promise<TreasuryReconciliationMatchRow[]>;
  create(
    data: TreasuryReconciliationMatchCreateData,
    db?: TreasuryReconciliationMatchDb
  ): Promise<TreasuryReconciliationMatchRow>;
  unmatch(
    id: string,
    data: {
      unmatchedByUserId: string;
      unmatchReason: string;
      expectedVersion: number;
    },
    db?: TreasuryReconciliationMatchDb
  ): Promise<TreasuryReconciliationMatchRow>;
  /**
   * Bloqueia as linhas dos movimentos até o fim da transação corrente
   * (`SELECT ... FOR UPDATE`), em ordem determinística de id para não gerar
   * deadlock entre requisições que disputem o mesmo conjunto.
   *
   * Exigido por CASH-SUPPORT-P0-CONCURRENCY-001: sem o lock, dois aceites
   * concorrentes leem a mesma capacidade livre e ambos gravam, estourando o
   * valor do movimento. Só faz sentido dentro de `$transaction` — fora dela o
   * lock é liberado imediatamente.
   */
  lockMovementsForUpdate(
    movementIds: readonly string[],
    db?: TreasuryReconciliationMatchDb
  ): Promise<void>;
  /**
   * Advisory lock transacional por título oficial. O título é do Nomus e não
   * tem linha local a bloquear com `FOR UPDATE` — o lock é nomeado.
   * `pg_advisory_xact_lock` é liberado no commit/rollback, sem unlock manual.
   * Chaves aplicadas em ordem determinística.
   */
  lockTitlesForUpdate(
    keys: readonly { key1: number; key2: number }[],
    db?: TreasuryReconciliationMatchDb
  ): Promise<void>;
  /**
   * Histórico: matches (qualquer status, inclusive UNMATCHED) com
   * `matchedCivilDate` no período — mais recentes primeiro.
   */
  listByMatchedPeriod(
    input: {
      companyCode?: string | null;
      accountId?: string | null;
      from: string;
      to: string;
      limit?: number;
    },
    db?: TreasuryReconciliationMatchDb
  ): Promise<TreasuryReconciliationMatchRow[]>;
  /** Match já criado com esta chave de idempotência (qualquer status). */
  findByIdempotencyKey(
    companyCode: string,
    idempotencyKey: string,
    db?: TreasuryReconciliationMatchDb
  ): Promise<TreasuryReconciliationMatchRow | null>;
  /** Já alocado (kind TITLE) por matches ativos, por `officialTitleId`. */
  sumActiveAllocatedByTitleIds(
    titleIds: readonly string[],
    db?: TreasuryReconciliationMatchDb
  ): Promise<Map<string, string>>;
  sumActiveAllocatedByMovementIds(
    movementIds: readonly string[],
    db?: TreasuryReconciliationMatchDb
  ): Promise<Map<string, string>>;
  findMovementSnapshot(
    id: string,
    db?: TreasuryReconciliationMatchDb
  ): Promise<TreasuryBankMovementReconciliationSnapshot | null>;
  updateMovementReconciliation(
    id: string,
    data: { reconciledAmount: string; reconciliationStatus: string },
    db?: TreasuryReconciliationMatchDb
  ): Promise<TreasuryBankMovementReconciliationSnapshot>;
};

export function createTreasuryReconciliationMatchRepository(
  prisma: PrismaClient
): TreasuryReconciliationMatchRepository {
  return {
    async findById(id, db = prisma) {
      const row = await db.treasuryReconciliationMatch.findUnique({
        where: { id },
        include: includeAll,
      });
      return row ? mapRow(row as never) : null;
    },

    async listActiveByBankMovementId(bankMovementId, db = prisma) {
      const rows = await db.treasuryReconciliationMatch.findMany({
        where: {
          status: { in: ["MATCHED", "PENDING"] },
          movements: { some: { bankMovementId: bankMovementId.trim() } },
        },
        include: includeAll,
        orderBy: { createdAt: "desc" },
      });
      return rows.map((row) => mapRow(row as never));
    },

    async create(data, db = prisma) {
      const row = await db.treasuryReconciliationMatch.create({
        data: {
          companyCode: data.companyCode,
          accountId: data.accountId,
          status: data.status,
          matchedAmount: moneyToDecimal(data.matchedAmount),
          currency: (data.currency ?? "BRL") as never,
          matchedCivilDate: civilDateToUtcDate(data.matchedCivilDate),
          justification: data.justification ?? null,
          idempotencyKey: data.idempotencyKey ?? null,
          suggestionKey: data.suggestionKey ?? null,
          algorithmVersion: data.algorithmVersion ?? null,
          suggestionScore: data.suggestionScore ?? null,
          suggestionConfidence: data.suggestionConfidence ?? null,
          suggestionReasonsJson:
            data.suggestionReasonsJson == null
              ? undefined
              : (data.suggestionReasonsJson as Prisma.InputJsonValue),
          createdByUserId: data.createdByUserId,
          movements: {
            create: data.movements.map((m) => ({
              bankMovementId: m.bankMovementId,
              amount: moneyToDecimal(m.amount),
              sortOrder: m.sortOrder,
            })),
          },
          allocations: {
            create: data.allocations.map((a) => ({
              kind: a.kind as never,
              amount: moneyToDecimal(a.amount),
              memo: a.memo ?? null,
              nomusSide: a.nomusSide ?? null,
              officialTitleId: a.officialTitleId ?? null,
              nomusExternalId: a.nomusExternalId ?? null,
              transferId: a.transferId ?? null,
              transferGroupId: a.transferGroupId ?? null,
              ledgerEntryId: a.ledgerEntryId ?? null,
              differenceCode: a.differenceCode ?? null,
              sortOrder: a.sortOrder,
            })),
          },
        },
        include: includeAll,
      });
      return mapRow(row as never);
    },

    async unmatch(id, data, db = prisma) {
      const current = await db.treasuryReconciliationMatch.findUnique({
        where: { id },
        select: { version: true, status: true },
      });
      if (!current) {
        throw new TreasuryDomainError("NOT_FOUND", "Match não encontrado.", "id");
      }
      if (current.version !== data.expectedVersion) {
        throw new TreasuryDomainError(
          "CONFLICT",
          "Versão do match desatualizada.",
          "expectedVersion"
        );
      }
      try {
        const row = await db.treasuryReconciliationMatch.update({
          where: { id },
          data: {
            status: "UNMATCHED",
            version: { increment: 1 },
            unmatchedAt: new Date(),
            unmatchedByUserId: data.unmatchedByUserId,
            unmatchReason: data.unmatchReason,
            updatedByUserId: data.unmatchedByUserId,
          },
          include: includeAll,
        });
        return mapRow(row as never);
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2025"
        ) {
          throw new TreasuryDomainError(
            "NOT_FOUND",
            "Match não encontrado.",
            "id"
          );
        }
        throw err;
      }
    },

    async lockMovementsForUpdate(movementIds, db = prisma) {
      const ids = [...new Set(movementIds.map((i) => i.trim()).filter(Boolean))]
        .sort();
      if (ids.length === 0) return;
      await db.$queryRaw`
        SELECT id FROM "TreasuryBankMovement"
        WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
        ORDER BY id
        FOR UPDATE
      `;
    },

    async lockTitlesForUpdate(keys, db = prisma) {
      const ordered = [...keys].sort(
        (a, b) => a.key1 - b.key1 || a.key2 - b.key2
      );
      for (const { key1, key2 } of ordered) {
        await db.$queryRaw`SELECT pg_advisory_xact_lock(${key1}::int, ${key2}::int)`;
      }
    },

    async listByMatchedPeriod(input, db = prisma) {
      const rows = await db.treasuryReconciliationMatch.findMany({
        where: {
          ...(input.companyCode?.trim()
            ? { companyCode: input.companyCode.trim() }
            : {}),
          ...(input.accountId?.trim() ? { accountId: input.accountId.trim() } : {}),
          matchedCivilDate: {
            gte: civilDateToUtcDate(input.from),
            lte: civilDateToUtcDate(input.to),
          },
        },
        include: includeAll,
        orderBy: [{ matchedCivilDate: "desc" }, { createdAt: "desc" }],
        take: Math.min(Math.max(input.limit ?? 200, 1), 500),
      });
      return rows.map((row) => mapRow(row as never));
    },

    async findByIdempotencyKey(companyCode, idempotencyKey, db = prisma) {
      const row = await db.treasuryReconciliationMatch.findFirst({
        where: {
          companyCode: companyCode.trim(),
          idempotencyKey: idempotencyKey.trim(),
        },
        include: includeAll,
      });
      return row ? mapRow(row as never) : null;
    },

    async sumActiveAllocatedByTitleIds(titleIds, db = prisma) {
      const ids = [...new Set(titleIds.map((i) => i.trim()).filter(Boolean))];
      const map = new Map<string, string>();
      if (ids.length === 0) return map;
      const rows = await db.treasuryReconciliationAllocation.findMany({
        where: {
          kind: "TITLE",
          officialTitleId: { in: ids },
          match: { status: { in: ["MATCHED", "PENDING"] } },
        },
        select: { officialTitleId: true, amount: true },
      });
      for (const row of rows) {
        if (!row.officialTitleId) continue;
        const prev = map.get(row.officialTitleId) ?? "0.00";
        map.set(
          row.officialTitleId,
          new Prisma.Decimal(prev).add(row.amount).toFixed(2)
        );
      }
      return map;
    },

    async sumActiveAllocatedByMovementIds(movementIds, db = prisma) {
      const ids = [...new Set(movementIds.map((i) => i.trim()).filter(Boolean))];
      const map = new Map<string, string>();
      if (ids.length === 0) return map;
      const rows = await db.treasuryReconciliationMatchMovement.findMany({
        where: {
          bankMovementId: { in: ids },
          match: { status: { in: ["MATCHED", "PENDING"] } },
        },
        select: { bankMovementId: true, amount: true },
      });
      for (const row of rows) {
        const prev = map.get(row.bankMovementId) ?? "0.00";
        const next = new Prisma.Decimal(prev).add(row.amount).toFixed(2);
        map.set(row.bankMovementId, next);
      }
      return map;
    },

    async findMovementSnapshot(id, db = prisma) {
      const row = await db.treasuryBankMovement.findUnique({
        where: { id },
        select: {
          id: true,
          companyCode: true,
          accountId: true,
          amount: true,
          reconciliationStatus: true,
          reconciledAmount: true,
        },
      });
      if (!row) return null;
      return {
        id: row.id,
        companyCode: row.companyCode,
        accountId: row.accountId,
        amount: row.amount.toFixed(2),
        reconciliationStatus: row.reconciliationStatus,
        reconciledAmount: row.reconciledAmount.toFixed(2),
      };
    },

    async updateMovementReconciliation(id, data, db = prisma) {
      const row = await db.treasuryBankMovement.update({
        where: { id },
        data: {
          reconciledAmount: moneyToDecimal(data.reconciledAmount),
          reconciliationStatus: data.reconciliationStatus as never,
        },
        select: {
          id: true,
          companyCode: true,
          accountId: true,
          amount: true,
          reconciliationStatus: true,
          reconciledAmount: true,
        },
      });
      return {
        id: row.id,
        companyCode: row.companyCode,
        accountId: row.accountId,
        amount: row.amount.toFixed(2),
        reconciliationStatus: row.reconciliationStatus,
        reconciledAmount: row.reconciledAmount.toFixed(2),
      };
    },
  };
}
