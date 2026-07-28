/**
 * Repository de consulta CP Tesouraria — leitura oficial + batch complemento/CC (sem N+1).
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import {
  toOfficialPayableView,
  type OfficialNomusPayableRow,
} from "../mappers/treasuryOfficialTitleMappers.js";
import type { TreasuryTitleOperationalComplementRow } from "../mappers/treasuryTitleOperationalComplementMappers.js";
import {
  toTreasuryPayableComplementView,
  toTreasuryPayableListItemDto,
  type TreasuryPayableCostCenterProjection,
} from "../mappers/treasuryPayableQueryMappers.js";
import type { TreasuryPayableListItemDto } from "../contracts/treasuryPayableContracts.js";
import type { TreasuryPayablesListQuery } from "../contracts/treasurySchemas.js";
import { paginateTreasuryPayables } from "../queries/treasuryPayableQueryEngine.js";
import { TreasuryDomainError } from "../domain/treasuryErrors.js";

export type TreasuryPayableQueryDb = PrismaClient | Prisma.TransactionClient;

const AP_SELECT_BASE = {
  id: true,
  externalId: true,
  status: true,
  personId: true,
  personName: true,
  personCnpj: true,
  description: true,
  documentNumber: true,
  classification: true,
  comments: true,
  competenceDate: true,
  dueDate: true,
  scheduleDate: true,
  amountPayable: true,
  balancePayable: true,
  amountPaid: true,
  amountScheduled: true,
  settlementDate: true,
  paymentDate: true,
  sourceInvoiceId: true,
  sourceInvoiceNumber: true,
  sourcePresenceStatus: true,
  sourceRemovedAt: true,
  syncedAt: true,
} satisfies Prisma.NomusAccountsPayableSelect;

const AP_SELECT = {
  ...AP_SELECT_BASE,
  rawPayload: true,
} satisfies Prisma.NomusAccountsPayableSelect;

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

function hasComplementFilter(query: TreasuryPayablesListQuery): boolean {
  return Boolean(
    query.scheduledFrom ||
      query.scheduledTo ||
      query.responsibleUserId ||
      query.plannedAccountId ||
      query.priority ||
      query.complementStatus
  );
}

export type TreasuryPayableQueryRepository = {
  list(
    query: TreasuryPayablesListQuery,
    referenceDate?: Date
  ): Promise<ReturnType<typeof paginateTreasuryPayables>>;
  getByTitleId(
    titleId: string,
    referenceDate?: Date
  ): Promise<TreasuryPayableListItemDto | null>;
};

export function createTreasuryPayableQueryRepository(
  prisma: PrismaClient
): TreasuryPayableQueryRepository {
  async function loadComplementsByTitleIds(
    titleIds: string[]
  ): Promise<Map<string, TreasuryTitleOperationalComplementRow>> {
    const map = new Map<string, TreasuryTitleOperationalComplementRow>();
    if (!titleIds.length) return map;
    const rows = await prisma.treasuryTitleOperationalComplement.findMany({
      where: {
        titleType: "PAYABLE",
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

  async function loadCostCentersByExternalIds(
    externalIds: number[]
  ): Promise<Map<number, TreasuryPayableCostCenterProjection>> {
    const map = new Map<number, TreasuryPayableCostCenterProjection>();
    if (!externalIds.length) return map;
    const rows = await prisma.accountsPayableCostCenterAllocation.findMany({
      where: { accountsPayableId: { in: externalIds } },
      select: {
        accountsPayableId: true,
        percentage: true,
        costCenterId: true,
        costCenter: { select: { id: true, code: true, name: true } },
      },
      orderBy: [{ percentage: "desc" }, { createdAt: "asc" }],
    });
    for (const row of rows) {
      if (map.has(row.accountsPayableId)) continue;
      const label =
        [row.costCenter.code, row.costCenter.name].filter(Boolean).join(" — ") ||
        row.costCenter.name;
      map.set(row.accountsPayableId, {
        costCenterId: row.costCenterId,
        costCenterLabel: label,
      });
    }
    return map;
  }

  async function resolveCostCenterExternalIds(
    query: TreasuryPayablesListQuery
  ): Promise<number[] | null> {
    if (!query.costCenterId && !query.costCenter) return null;
    const where: Prisma.AccountsPayableCostCenterAllocationWhereInput = {};
    if (query.costCenterId) {
      where.costCenterId = query.costCenterId;
    }
    if (query.costCenter) {
      where.costCenter = {
        OR: [
          { name: { contains: query.costCenter, mode: "insensitive" } },
          { code: { contains: query.costCenter, mode: "insensitive" } },
        ],
      };
    }
    const rows = await prisma.accountsPayableCostCenterAllocation.findMany({
      where,
      select: { accountsPayableId: true },
      distinct: ["accountsPayableId"],
    });
    return rows.map((r) => r.accountsPayableId);
  }

  async function resolveComplementTitleIds(
    query: TreasuryPayablesListQuery
  ): Promise<string[] | null> {
    if (!hasComplementFilter(query)) return null;
    const where: Prisma.TreasuryTitleOperationalComplementWhereInput = {
      titleType: "PAYABLE",
    };
    if (query.responsibleUserId) {
      where.responsibleUserId = query.responsibleUserId;
    }
    if (query.plannedAccountId) {
      where.plannedAccountId = query.plannedAccountId;
    }
    if (query.priority) where.priority = query.priority;
    if (query.complementStatus) where.status = query.complementStatus;
    if (query.scheduledFrom || query.scheduledTo) {
      where.scheduledDate = {};
      const from = civilToUtcDate(query.scheduledFrom);
      const to = civilToUtcDate(query.scheduledTo);
      if (from) where.scheduledDate.gte = from;
      if (to) where.scheduledDate.lte = to;
    }
    const rows = await prisma.treasuryTitleOperationalComplement.findMany({
      where,
      select: { officialTitleId: true },
    });
    return rows.map((r) => r.officialTitleId);
  }

  function buildApWhere(
    query: TreasuryPayablesListQuery,
    complementTitleIds: string[] | null,
    costCenterExternalIds: number[] | null
  ): Prisma.NomusAccountsPayableWhereInput {
    const where: Prisma.NomusAccountsPayableWhereInput = {};
    if (complementTitleIds) {
      where.id = { in: complementTitleIds };
    }
    if (costCenterExternalIds) {
      where.externalId = { in: costCenterExternalIds };
    }
    if (query.supplierName) {
      where.personName = { contains: query.supplierName, mode: "insensitive" };
    }
    if (query.supplierTaxId) {
      const digits = query.supplierTaxId.replace(/\D+/g, "");
      where.personCnpj = { contains: digits || query.supplierTaxId };
    }
    if (query.classification) {
      where.classification = {
        contains: query.classification,
        mode: "insensitive",
      };
    }
    const and: Prisma.NomusAccountsPayableWhereInput[] = [];
    if (query.document) {
      and.push({
        OR: [
          {
            documentNumber: {
              contains: query.document,
              mode: "insensitive",
            },
          },
          {
            description: { contains: query.document, mode: "insensitive" },
          },
          {
            sourceInvoiceNumber: {
              contains: query.document,
              mode: "insensitive",
            },
          },
        ],
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
      where.balancePayable = {};
      if (query.openAmountMin != null) {
        where.balancePayable.gte = query.openAmountMin;
      }
      if (query.openAmountMax != null) {
        where.balancePayable.lte = query.openAmountMax;
      }
    }
    if (!query.includeCancelled) {
      where.sourcePresenceStatus = { not: "MISSING_CONFIRMED" };
      where.sourceRemovedAt = null;
    }
    return where;
  }

  function assemble(
    apRows: OfficialNomusPayableRow[],
    complements: Map<string, TreasuryTitleOperationalComplementRow>,
    costCenters: Map<number, TreasuryPayableCostCenterProjection>,
    referenceDate?: Date
  ): TreasuryPayableListItemDto[] {
    return apRows.map((row) => {
      const official = toOfficialPayableView(row);
      const complementRow = complements.get(row.id) ?? null;
      return toTreasuryPayableListItemDto({
        official,
        complement: complementRow
          ? toTreasuryPayableComplementView(complementRow)
          : null,
        costCenter: costCenters.get(row.externalId) ?? null,
        referenceDate,
      });
    });
  }

  return {
    async list(query, referenceDate) {
      const [complementTitleIds, costCenterExternalIds] = await Promise.all([
        resolveComplementTitleIds(query),
        resolveCostCenterExternalIds(query),
      ]);
      if (complementTitleIds && complementTitleIds.length === 0) {
        return paginateTreasuryPayables([], query);
      }
      if (costCenterExternalIds && costCenterExternalIds.length === 0) {
        return paginateTreasuryPayables([], query);
      }
      const where = buildApWhere(
        query,
        complementTitleIds,
        costCenterExternalIds
      );
      // Lista sem rawPayload; hidrata só a página (menos memória em milhares de títulos).
      const apRows = (await prisma.nomusAccountsPayable.findMany({
        where,
        select: AP_SELECT_BASE,
        orderBy: [{ dueDate: "asc" }, { externalId: "asc" }],
      })) as OfficialNomusPayableRow[];
      const titleIds = apRows.map((r) => r.id);
      const externalIds = apRows.map((r) => r.externalId);
      const [complements, costCenters] = await Promise.all([
        loadComplementsByTitleIds(titleIds),
        loadCostCentersByExternalIds(externalIds),
      ]);
      const assembled = assemble(
        apRows.map(
          (r) => ({ ...r, rawPayload: null }) as OfficialNomusPayableRow
        ),
        complements,
        costCenters,
        referenceDate
      );
      const page = paginateTreasuryPayables(assembled, query);
      if (page.rows.length === 0) return page;

      const pageIds = page.rows.map((r) => r.titleId);
      const hydrated = (await prisma.nomusAccountsPayable.findMany({
        where: { id: { in: pageIds } },
        select: AP_SELECT,
      })) as OfficialNomusPayableRow[];
      const byId = new Map(hydrated.map((r) => [r.id, r] as const));
      const pageExternalIds = hydrated.map((r) => r.externalId);
      const [pageComplements, pageCostCenters] = await Promise.all([
        loadComplementsByTitleIds(pageIds),
        loadCostCentersByExternalIds(pageExternalIds),
      ]);
      const hydratedRows = pageIds
        .map((id) => byId.get(id))
        .filter((r): r is OfficialNomusPayableRow => r != null);
      const reassembled = assemble(
        hydratedRows,
        pageComplements,
        pageCostCenters,
        referenceDate
      );
      const order = new Map(pageIds.map((id, i) => [id, i] as const));
      reassembled.sort(
        (a, b) => (order.get(a.titleId) ?? 0) - (order.get(b.titleId) ?? 0)
      );
      return { ...page, rows: reassembled };
    },

    async getByTitleId(titleId, referenceDate) {
      const row = (await prisma.nomusAccountsPayable.findUnique({
        where: { id: titleId },
        select: AP_SELECT,
      })) as OfficialNomusPayableRow | null;
      if (!row) return null;
      const [complements, costCenters] = await Promise.all([
        loadComplementsByTitleIds([row.id]),
        loadCostCentersByExternalIds([row.externalId]),
      ]);
      const [item] = assemble([row], complements, costCenters, referenceDate);
      return item ?? null;
    },
  };
}

export function assertPayableFound<T>(value: T | null): asserts value is T {
  if (value == null) {
    throw new TreasuryDomainError(
      "NOT_FOUND",
      "Título a pagar não encontrado.",
      "titleId"
    );
  }
}
