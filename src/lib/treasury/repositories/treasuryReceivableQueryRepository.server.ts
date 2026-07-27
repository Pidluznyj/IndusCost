/**
 * Repository de consulta CR Tesouraria — leitura oficial + batch de complementos (sem N+1).
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  toOfficialReceivableView,
  type OfficialNomusReceivableRow,
} from "../mappers/treasuryOfficialTitleMappers.js";
import type { TreasuryTitleOperationalComplementRow } from "../mappers/treasuryTitleOperationalComplementMappers.js";
import {
  toTreasuryReceivableComplementView,
  toTreasuryReceivableListItemDto,
} from "../mappers/treasuryReceivableQueryMappers.js";
import type { TreasuryReceivableListItemDto } from "../contracts/treasuryReceivableContracts.js";
import type { TreasuryReceivablesListQuery } from "../contracts/treasurySchemas.js";
import { paginateTreasuryReceivables } from "../queries/treasuryReceivableQueryEngine.js";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";

export type TreasuryReceivableQueryDb = PrismaClient | Prisma.TransactionClient;

const AR_SELECT = {
  id: true,
  externalId: true,
  status: true,
  personId: true,
  personName: true,
  personCnpj: true,
  description: true,
  competenceDate: true,
  dueDate: true,
  amountReceivable: true,
  balanceReceivable: true,
  amountReceived: true,
  settlementDate: true,
  sourceInvoiceId: true,
  sourceInvoiceNumber: true,
  sourcePresenceStatus: true,
  sourceRemovedAt: true,
  syncedAt: true,
  rawPayload: true,
} satisfies Prisma.NomusAccountsReceivableSelect;

const COMPLEMENT_SELECT = {
  id: true,
  titleType: true,
  officialTitleId: true,
  officialExternalId: true,
  expectedDate: true,
  confirmedDate: true,
  scheduledDate: true,
  expectedAmount: true,
  confirmedAmount: true,
  scheduledAmount: true,
  status: true,
  priority: true,
  plannedAccountId: true,
  responsibleUserId: true,
  nextAction: true,
  reason: true,
  notes: true,
  version: true,
  createdAt: true,
  createdByUserId: true,
  updatedAt: true,
  updatedByUserId: true,
  cancelledAt: true,
  cancelledByUserId: true,
  cancellationReason: true,
} satisfies Prisma.TreasuryTitleOperationalComplementSelect;

function civilToUtcDate(value: string | null): Date | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}

function hasComplementFilter(query: TreasuryReceivablesListQuery): boolean {
  return Boolean(
    query.expectedFrom ||
      query.expectedTo ||
      query.hasPromise != null ||
      query.collectionOwnerUserId ||
      query.plannedAccountId ||
      query.priority ||
      query.complementStatus
  );
}

export type TreasuryReceivableQueryRepository = {
  list(
    query: TreasuryReceivablesListQuery,
    referenceDate?: Date
  ): Promise<ReturnType<typeof paginateTreasuryReceivables>>;
  getByTitleId(
    titleId: string,
    referenceDate?: Date
  ): Promise<TreasuryReceivableListItemDto | null>;
};

export function createTreasuryReceivableQueryRepository(
  prisma: PrismaClient
): TreasuryReceivableQueryRepository {
  async function loadComplementsByTitleIds(
    titleIds: string[]
  ): Promise<Map<string, TreasuryTitleOperationalComplementRow>> {
    const map = new Map<string, TreasuryTitleOperationalComplementRow>();
    if (!titleIds.length) return map;
    const rows = await prisma.treasuryTitleOperationalComplement.findMany({
      where: {
        titleType: "RECEIVABLE",
        officialTitleId: { in: titleIds },
      },
      select: COMPLEMENT_SELECT,
    });
    for (const row of rows) {
      map.set(
        row.officialTitleId,
        row as TreasuryTitleOperationalComplementRow
      );
    }
    return map;
  }

  async function resolveComplementTitleIds(
    query: TreasuryReceivablesListQuery
  ): Promise<string[] | null> {
    if (!hasComplementFilter(query)) return null;
    const where: Prisma.TreasuryTitleOperationalComplementWhereInput = {
      titleType: "RECEIVABLE",
    };
    if (query.collectionOwnerUserId) {
      where.responsibleUserId = query.collectionOwnerUserId;
    }
    if (query.plannedAccountId) {
      where.plannedAccountId = query.plannedAccountId;
    }
    if (query.priority) where.priority = query.priority;
    if (query.complementStatus) where.status = query.complementStatus;
    if (query.expectedFrom || query.expectedTo) {
      where.expectedDate = {};
      const from = civilToUtcDate(query.expectedFrom);
      const to = civilToUtcDate(query.expectedTo);
      if (from) where.expectedDate.gte = from;
      if (to) where.expectedDate.lte = to;
    }
    if (query.hasPromise === true) {
      where.OR = [
        { confirmedDate: { not: null } },
        { confirmedAmount: { not: null } },
      ];
    }
    if (query.hasPromise === false) {
      where.AND = [{ confirmedDate: null }, { confirmedAmount: null }];
    }
    const rows = await prisma.treasuryTitleOperationalComplement.findMany({
      where,
      select: { officialTitleId: true },
    });
    let ids = rows.map((r) => r.officialTitleId);
    if (query.hasPromise === true) {
      const promiseIds = await prisma.treasuryPaymentPromise.findMany({
        where: {
          titleType: "RECEIVABLE",
          status: { in: ["ACTIVE", "PARTIALLY_FULFILLED"] },
        },
        select: { officialTitleId: true },
        distinct: ["officialTitleId"],
      });
      ids = [...new Set([...ids, ...promiseIds.map((p) => p.officialTitleId)])];
    }
    return ids;
  }

  function buildArWhere(
    query: TreasuryReceivablesListQuery,
    complementTitleIds: string[] | null
  ): Prisma.NomusAccountsReceivableWhereInput {
    const where: Prisma.NomusAccountsReceivableWhereInput = {};
    if (complementTitleIds) {
      where.id = { in: complementTitleIds };
    }
    if (query.customerName) {
      where.personName = { contains: query.customerName, mode: "insensitive" };
    }
    if (query.customerTaxId) {
      const digits = query.customerTaxId.replace(/\D+/g, "");
      where.personCnpj = { contains: digits || query.customerTaxId };
    }
    const and: Prisma.NomusAccountsReceivableWhereInput[] = [];
    if (query.invoice) {
      and.push({
        OR: [
          {
            sourceInvoiceNumber: {
              contains: query.invoice,
              mode: "insensitive",
            },
          },
          ...(Number.isFinite(Number(query.invoice))
            ? [{ sourceInvoiceId: Number(query.invoice) }]
            : []),
        ],
      });
    }
    if (query.document) {
      and.push({
        description: { contains: query.document, mode: "insensitive" },
      });
    }
    if (and.length) where.AND = and;
    if (query.dueFrom || query.dueTo) {
      where.dueDate = {};
      const from = civilToUtcDate(query.dueFrom);
      const to = civilToUtcDate(query.dueTo);
      if (from) where.dueDate.gte = from;
      if (to) where.dueDate.lte = to;
    }
    if (query.openAmountMin != null || query.openAmountMax != null) {
      where.balanceReceivable = {};
      if (query.openAmountMin != null) {
        where.balanceReceivable.gte = query.openAmountMin;
      }
      if (query.openAmountMax != null) {
        where.balanceReceivable.lte = query.openAmountMax;
      }
    }
    if (!query.includeCancelled) {
      where.sourcePresenceStatus = { not: "MISSING_CONFIRMED" };
      where.sourceRemovedAt = null;
    }
    return where;
  }

  async function loadActivePromiseTitleIds(
    titleIds: string[]
  ): Promise<Set<string>> {
    const set = new Set<string>();
    if (!titleIds.length) return set;
    const rows = await prisma.treasuryPaymentPromise.findMany({
      where: {
        titleType: "RECEIVABLE",
        officialTitleId: { in: titleIds },
        status: { in: ["ACTIVE", "PARTIALLY_FULFILLED"] },
      },
      select: { officialTitleId: true },
      distinct: ["officialTitleId"],
    });
    for (const row of rows) set.add(row.officialTitleId);
    return set;
  }

  function assemble(
    arRows: OfficialNomusReceivableRow[],
    complements: Map<string, TreasuryTitleOperationalComplementRow>,
    activePromiseTitleIds: Set<string>,
    referenceDate?: Date
  ): TreasuryReceivableListItemDto[] {
    return arRows.map((row) => {
      const official = toOfficialReceivableView(row);
      const complementRow = complements.get(row.id) ?? null;
      return toTreasuryReceivableListItemDto({
        official,
        complement: complementRow
          ? toTreasuryReceivableComplementView(complementRow)
          : null,
        rawPayload: row.rawPayload,
        referenceDate,
        hasActivePromise: activePromiseTitleIds.has(row.id),
      });
    });
  }

  return {
    async list(query, referenceDate) {
      const complementTitleIds = await resolveComplementTitleIds(query);
      if (complementTitleIds && complementTitleIds.length === 0) {
        return paginateTreasuryReceivables([], query);
      }
      const where = buildArWhere(query, complementTitleIds);
      // Uma query de títulos + uma de complementos (batch) — evita N+1.
      const arRows = (await prisma.nomusAccountsReceivable.findMany({
        where,
        select: AR_SELECT,
        orderBy: [{ dueDate: "asc" }, { externalId: "asc" }],
      })) as OfficialNomusReceivableRow[];
      const titleIds = arRows.map((r) => r.id);
      const complements = await loadComplementsByTitleIds(titleIds);
      const activePromiseTitleIds = await loadActivePromiseTitleIds(titleIds);
      const assembled = assemble(
        arRows,
        complements,
        activePromiseTitleIds,
        referenceDate
      );
      return paginateTreasuryReceivables(assembled, query);
    },

    async getByTitleId(titleId, referenceDate) {
      const row = (await prisma.nomusAccountsReceivable.findUnique({
        where: { id: titleId },
        select: AR_SELECT,
      })) as OfficialNomusReceivableRow | null;
      if (!row) return null;
      const complements = await loadComplementsByTitleIds([row.id]);
      const activePromiseTitleIds = await loadActivePromiseTitleIds([row.id]);
      const [item] = assemble(
        [row],
        complements,
        activePromiseTitleIds,
        referenceDate
      );
      return item ?? null;
    },
  };
}

export function assertReceivableFound<T>(
  value: T | null
): asserts value is T {
  if (value == null) {
    throw new TreasuryDomainError(
      "NOT_FOUND",
      "Título a receber não encontrado.",
      "titleId"
    );
  }
}
