/**
 * Página da listagem de Propostas + totalizadores (GET /api/proposals paginado).
 *
 * Tudo no banco, antes da paginação: a visibilidade padrão (sem as propostas Nomus sem valor comercial) entra no
 * `where` do `findMany` e do `count`, então nenhuma página vem vazia nem o total mente.
 * Os totalizadores usam os filtros da tela + a população comercial (`PROPOSAL_COMMERCIAL_METRICS_WHERE`), nunca o
 * filtro administrativo: ligar "Exibir propostas sem valor comercial" muda o grid, não os indicadores.
 */
import type { Prisma } from "@prisma/client";
import {
  PROPOSAL_COMMERCIAL_METRICS_WHERE,
  PROPOSAL_DEFAULT_GRID_VISIBILITY_WHERE,
  PROPOSAL_NOMUS_WITHOUT_COMMERCIAL_VALUE_WHERE,
  andProposalWhere,
  withProposalCommercialEligibility,
} from "./proposalCommercialEligibility.js";
import {
  buildProposalListCommercialDateWhere,
  buildProposalListNetValueWhere,
  buildProposalListOrderBy,
} from "./proposalListQuery.js";

const OPEN_STATUSES = ["DRAFT", "ANALYSIS", "SENT"] as const;

export type ProposalListFilters = {
  search: string;
  status: string | null;
  responsible: string;
  customerId: string;
  startDate: Date | null;
  endDate: Date | null;
  minNetValue: number | null;
  maxNetValue: number | null;
  /** Filtro administrativo já autorizado pela rota. */
  includeWithoutCommercialValue: boolean;
};

export type ProposalListSummaryPayload = {
  totalProposals: number;
  totalNetAmount: number;
  totalGrossAmount: number;
  averageNetValue: number;
  yearToDateCount: number;
  monthToDateCount: number;
  openProposalsCount: number;
  openProposalsAmount: number;
  convertedProposalsCount: number;
  convertedProposalsAmount: number;
  conversionRate: number | null;
  /** Quantas propostas sem valor comercial os filtros atuais escondem do grid padrão (0 com o filtro ligado). */
  hiddenWithoutCommercialValueCount: number;
};

type ProposalReader = {
  findMany(args: unknown): Promise<Array<Record<string, unknown>>>;
  count(args: { where: Prisma.ProposalWhereInput }): Promise<number>;
  aggregate(args: unknown): Promise<{
    _count: { id: number };
    _sum: { totalNetValue?: unknown; totalGrossValue?: unknown };
  }>;
};

/** Filtros da tela (sem visibilidade nem população). Busca é OR próprio, sempre dentro de AND. */
export function buildProposalListFilterWhere(filters: ProposalListFilters): Prisma.ProposalWhereInput {
  const search = filters.search.trim();
  return andProposalWhere(
    filters.status ? { status: filters.status as Prisma.ProposalWhereInput["status"] } : null,
    filters.responsible ? { responsible: filters.responsible } : null,
    filters.customerId ? { customerId: filters.customerId } : null,
    buildProposalListCommercialDateWhere(filters.startDate, filters.endDate),
    buildProposalListNetValueWhere(filters.minNetValue, filters.maxNetValue),
    search
      ? {
          OR: [
            { title: { contains: search, mode: "insensitive" } },
            { Customer: { companyName: { contains: search, mode: "insensitive" } } },
            { Customer: { tradeName: { contains: search, mode: "insensitive" } } },
            { Customer: { taxId: { contains: search, mode: "insensitive" } } },
            ...(Number.isFinite(Number(search)) ? [{ number: Number.parseInt(search, 10) }] : []),
          ],
        }
      : null
  );
}

export function buildProposalListWheres(filters: ProposalListFilters, now: Date) {
  const filterWhere = buildProposalListFilterWhere(filters);
  const gridWhere = filters.includeWithoutCommercialValue
    ? filterWhere
    : andProposalWhere(filterWhere, PROPOSAL_DEFAULT_GRID_VISIBILITY_WHERE);
  const metricsWhere = andProposalWhere(filterWhere, PROPOSAL_COMMERCIAL_METRICS_WHERE);
  const currentYearStart = new Date(now.getFullYear(), 0, 1);
  const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    filterWhere,
    gridWhere,
    metricsWhere,
    // Propostas no ano/mês: só a população comercial, pela data COMERCIAL, sem os filtros da tela (como antes).
    yearToDateWhere: andProposalWhere({ commercialDate: { gte: currentYearStart } }, PROPOSAL_COMMERCIAL_METRICS_WHERE),
    monthToDateWhere: andProposalWhere({ commercialDate: { gte: currentMonthStart } }, PROPOSAL_COMMERCIAL_METRICS_WHERE),
    openWhere: andProposalWhere(metricsWhere, { salesOrder: { is: null } }, { status: { in: [...OPEN_STATUSES] } }),
    convertedWhere: andProposalWhere(metricsWhere, { OR: [{ salesOrder: { isNot: null } }, { status: "APPROVED" }] }),
    hiddenWhere: filters.includeWithoutCommercialValue
      ? null
      : andProposalWhere(filterWhere, PROPOSAL_NOMUS_WITHOUT_COMMERCIAL_VALUE_WHERE),
  };
}

export async function loadProposalListPage(
  db: { proposal: ProposalReader },
  input: { filters: ProposalListFilters; page: number; pageSize: number; now?: Date }
): Promise<{
  rows: Array<Record<string, unknown>>;
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  summary: ProposalListSummaryPayload;
}> {
  const now = input.now ?? new Date();
  const wheres = buildProposalListWheres(input.filters, now);
  const skip = (input.page - 1) * input.pageSize;
  const [rows, total, aggregate, yearToDateCount, monthToDateCount, openAggregate, convertedAggregate, hiddenCount] =
    await Promise.all([
      db.proposal.findMany({
        where: wheres.gridWhere,
        include: {
          Customer: true,
          salesOrder: { select: { id: true, orderCode: true, status: true } },
          _count: { select: { items: true } },
        },
        orderBy: buildProposalListOrderBy(),
        skip,
        take: input.pageSize,
      }),
      db.proposal.count({ where: wheres.gridWhere }),
      db.proposal.aggregate({
        where: wheres.metricsWhere,
        _count: { id: true },
        _sum: { totalNetValue: true, totalGrossValue: true },
      }),
      db.proposal.count({ where: wheres.yearToDateWhere }),
      db.proposal.count({ where: wheres.monthToDateWhere }),
      db.proposal.aggregate({ where: wheres.openWhere, _count: { id: true }, _sum: { totalNetValue: true } }),
      db.proposal.aggregate({ where: wheres.convertedWhere, _count: { id: true }, _sum: { totalNetValue: true } }),
      wheres.hiddenWhere
        ? db.proposal.count({ where: wheres.hiddenWhere }).catch(() => 0)
        : Promise.resolve(0),
    ]);

  const totalProposals = aggregate._count.id;
  const totalNetAmount = Number(aggregate._sum.totalNetValue ?? 0);
  const totalGrossAmount = Number(aggregate._sum.totalGrossValue ?? 0);
  const convertedProposalsCount = convertedAggregate._count.id;
  return {
    rows: rows.slice(0, input.pageSize).map((row) => withProposalCommercialEligibility(row)),
    page: input.page,
    pageSize: input.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / input.pageSize)),
    summary: {
      totalProposals,
      totalNetAmount,
      totalGrossAmount,
      averageNetValue: totalProposals > 0 ? totalNetAmount / totalProposals : 0,
      yearToDateCount,
      monthToDateCount,
      openProposalsCount: openAggregate._count.id,
      openProposalsAmount: Number(openAggregate._sum.totalNetValue ?? 0),
      convertedProposalsCount,
      convertedProposalsAmount: Number(convertedAggregate._sum.totalNetValue ?? 0),
      conversionRate: totalProposals > 0 ? (convertedProposalsCount / totalProposals) * 100 : null,
      hiddenWithoutCommercialValueCount: hiddenCount,
    },
  };
}
