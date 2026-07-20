/**
 * OP-59 — Contrato e helpers puros do resumo do Kanban de Pedidos.
 * Sem I/O. Agrega apenas fatos já materializados nos snapshots.
 */

import type { Prisma } from "@prisma/client";
import {
  SALES_ORDER_FLOW_STAGE_LABELS,
  SALES_ORDER_FLOW_STAGES,
  type SalesOrderFlowStage,
} from "./salesOrderFlowCatalog.js";
import { buildSalesOrderSearchOr } from "@/src/lib/salesOrdersListSummary.js";
import { mergeSalesOrderOperationalPresenceWhere } from "@/src/lib/nomus/nomusSourcePresencePolicy.js";

export const SALES_ORDER_FLOW_SUMMARY_PRIORITIES = [
  "LOW",
  "NORMAL",
  "HIGH",
  "URGENT",
] as const;

export type SalesOrderFlowSummaryPriority =
  (typeof SALES_ORDER_FLOW_SUMMARY_PRIORITIES)[number];

export type SalesOrderFlowSummaryFilters = {
  q: string | null;
  customerId: string | null;
  sellerKey: string | null;
  seller: string | null;
  company: string | null;
  product: string | null;
  sector: string | null;
  issueFrom: Date | null;
  issueTo: Date | null;
  promisedFrom: Date | null;
  promisedTo: Date | null;
  overdue: boolean | null;
  blocked: boolean | null;
  inconsistent: boolean | null;
  partiallyShipped: boolean | null;
  withCut: boolean | null;
  withActiveResidual: boolean | null;
  priority: SalesOrderFlowSummaryPriority | null;
};

export type SalesOrderFlowSummaryColumn = {
  stage: SalesOrderFlowStage;
  label: string;
  /** Cancelados ficam em coluna própria, fora do fluxo operacional ativo. */
  isCanceledColumn: boolean;
  orderCount: number;
  orderValue: number | null;
  activeResidualValue: number | null;
};

export type SalesOrderFlowSummaryTotals = {
  overdueCount: number;
  blockedCount: number;
  inconsistentCount: number | null;
  partiallyShippedCount: number;
  completedWithCutCount: number;
  canceledCount: number;
};

export type SalesOrderFlowSummaryPayload = {
  filters: {
    q: string | null;
    customerId: string | null;
    sellerKey: string | null;
    seller: string | null;
    company: string | null;
    product: string | null;
    sector: string | null;
    issueFrom: string | null;
    issueTo: string | null;
    promisedFrom: string | null;
    promisedTo: string | null;
    overdue: boolean | null;
    blocked: boolean | null;
    inconsistent: boolean | null;
    partiallyShipped: boolean | null;
    withCut: boolean | null;
    withActiveResidual: boolean | null;
    priority: SalesOrderFlowSummaryPriority | null;
  };
  columns: SalesOrderFlowSummaryColumn[];
  totals: SalesOrderFlowSummaryTotals;
  lastUpdatedAt: string | null;
  valuesVisible: boolean;
  inconsistenciesVisible: boolean;
  generatedAt: string;
};

export type SalesOrderFlowSummaryStageAggregate = {
  stage: string;
  orderCount: number;
  orderValue: number;
  activeResidualValue: number;
};

export class SalesOrderFlowSummaryQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SalesOrderFlowSummaryQueryError";
  }
}

function parseOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function parseOptionalBoolean(value: unknown): boolean | null {
  if (value === undefined || value === null || value === "") return null;
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  throw new SalesOrderFlowSummaryQueryError(
    "Filtro booleano inválido (use true/false)."
  );
}

function parseDateStart(value: unknown, label: string): Date | null {
  const raw = parseOptionalString(value);
  if (!raw) return null;
  const date = new Date(`${raw}T00:00:00`);
  if (!Number.isFinite(date.getTime())) {
    throw new SalesOrderFlowSummaryQueryError(`Data inválida em ${label}.`);
  }
  return date;
}

function parseDateEnd(value: unknown, label: string): Date | null {
  const raw = parseOptionalString(value);
  if (!raw) return null;
  const date = new Date(`${raw}T23:59:59.999`);
  if (!Number.isFinite(date.getTime())) {
    throw new SalesOrderFlowSummaryQueryError(`Data inválida em ${label}.`);
  }
  return date;
}

function parsePriority(value: unknown): SalesOrderFlowSummaryPriority | null {
  const raw = parseOptionalString(value);
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (
    !(SALES_ORDER_FLOW_SUMMARY_PRIORITIES as readonly string[]).includes(upper)
  ) {
    throw new SalesOrderFlowSummaryQueryError(
      "Prioridade inválida (LOW|NORMAL|HIGH|URGENT)."
    );
  }
  return upper as SalesOrderFlowSummaryPriority;
}

export function parseSalesOrderFlowSummaryQuery(
  query: Record<string, unknown>
): SalesOrderFlowSummaryFilters {
  return {
    q: parseOptionalString(query.q),
    customerId: parseOptionalString(query.customerId),
    sellerKey: parseOptionalString(query.sellerKey),
    seller: parseOptionalString(query.seller ?? query.vendedor),
    company: parseOptionalString(query.company ?? query.empresa),
    product: parseOptionalString(query.product ?? query.produto),
    sector: parseOptionalString(query.sector ?? query.setor),
    issueFrom: parseDateStart(
      query.issueFrom ?? query.emissionFrom ?? query.emissaoFrom,
      "emissão (início)"
    ),
    issueTo: parseDateEnd(
      query.issueTo ?? query.emissionTo ?? query.emissaoTo,
      "emissão (fim)"
    ),
    promisedFrom: parseDateStart(
      query.promisedFrom ?? query.entregaFrom,
      "entrega prometida (início)"
    ),
    promisedTo: parseDateEnd(
      query.promisedTo ?? query.entregaTo,
      "entrega prometida (fim)"
    ),
    overdue: parseOptionalBoolean(query.overdue ?? query.atrasado),
    blocked: parseOptionalBoolean(query.blocked ?? query.bloqueado),
    inconsistent: parseOptionalBoolean(
      query.inconsistent ?? query.inconsistente
    ),
    partiallyShipped: parseOptionalBoolean(
      query.partiallyShipped ?? query.parcialmenteEnviado
    ),
    withCut: parseOptionalBoolean(query.withCut ?? query.comCorte),
    withActiveResidual: parseOptionalBoolean(
      query.withActiveResidual ?? query.comSaldoAtivo
    ),
    priority: parsePriority(query.priority ?? query.prioridade),
  };
}

export function serializeSalesOrderFlowSummaryFilters(
  filters: SalesOrderFlowSummaryFilters
): SalesOrderFlowSummaryPayload["filters"] {
  return {
    q: filters.q,
    customerId: filters.customerId,
    sellerKey: filters.sellerKey,
    seller: filters.seller,
    company: filters.company,
    product: filters.product,
    sector: filters.sector,
    issueFrom: filters.issueFrom?.toISOString() ?? null,
    issueTo: filters.issueTo?.toISOString() ?? null,
    promisedFrom: filters.promisedFrom?.toISOString() ?? null,
    promisedTo: filters.promisedTo?.toISOString() ?? null,
    overdue: filters.overdue,
    blocked: filters.blocked,
    inconsistent: filters.inconsistent,
    partiallyShipped: filters.partiallyShipped,
    withCut: filters.withCut,
    withActiveResidual: filters.withActiveResidual,
    priority: filters.priority,
  };
}

function decimalNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof value === "object" && value !== null && "toNumber" in value) {
    const n = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Monta where do snapshot sem duplicar pedidos por joins de itens.
 * Filtros de item usam `items.some` (existência), nunca expandem linhas.
 */
export function buildSalesOrderFlowSummarySnapshotWhere(input: {
  filters: SalesOrderFlowSummaryFilters;
  sellerWhere?: Prisma.SalesOrderWhereInput | null;
  scopeCustomerIds?: string[] | null;
}): Prisma.SalesOrderFlowSnapshotWhereInput {
  const { filters } = input;
  const orderAnd: Prisma.SalesOrderWhereInput[] = [];

  if (input.scopeCustomerIds) {
    orderAnd.push({ customerId: { in: input.scopeCustomerIds } });
  }
  if (filters.customerId) {
    orderAnd.push({ customerId: filters.customerId });
  }
  if (input.sellerWhere) {
    orderAnd.push(input.sellerWhere);
  } else if (filters.seller) {
    const asNum = Number(filters.seller);
    if (Number.isInteger(asNum) && asNum > 0) {
      orderAnd.push({ externalSellerId: asNum });
    } else {
      orderAnd.push({
        nomusSellerName: { contains: filters.seller, mode: "insensitive" },
      });
    }
  }
  if (filters.company) {
    orderAnd.push({
      companyIssuer: { contains: filters.company, mode: "insensitive" },
    });
  }
  if (filters.sector) {
    orderAnd.push({
      responsible: { contains: filters.sector, mode: "insensitive" },
    });
  }
  if (filters.product) {
    const product = filters.product;
    orderAnd.push({
      items: {
        some: {
          OR: [
            { skuSnapshot: { contains: product, mode: "insensitive" } },
            { productNameSnapshot: { contains: product, mode: "insensitive" } },
            { productId: product },
          ],
        },
      },
    });
  }
  if (filters.issueFrom || filters.issueTo) {
    orderAnd.push({
      issueDate: {
        ...(filters.issueFrom ? { gte: filters.issueFrom } : {}),
        ...(filters.issueTo ? { lte: filters.issueTo } : {}),
      },
    });
  }
  const searchOr = buildSalesOrderSearchOr(filters.q);
  if (searchOr) orderAnd.push({ OR: searchOr });

  if (filters.blocked != null || filters.priority != null) {
    orderAnd.push({
      flowManagement: {
        is: {
          ...(filters.blocked != null ? { isBlocked: filters.blocked } : {}),
          ...(filters.priority != null ? { priority: filters.priority } : {}),
        },
      },
    });
  }

  const snapshotAnd: Prisma.SalesOrderFlowSnapshotWhereInput[] = [];
  const orderWhere = mergeSalesOrderOperationalPresenceWhere(
    orderAnd.length > 0 ? { AND: orderAnd } : {}
  );
  if (Object.keys(orderWhere).length > 0) {
    snapshotAnd.push({ salesOrder: orderWhere });
  }
  if (filters.promisedFrom || filters.promisedTo) {
    snapshotAnd.push({
      promisedDeliveryAt: {
        ...(filters.promisedFrom ? { gte: filters.promisedFrom } : {}),
        ...(filters.promisedTo ? { lte: filters.promisedTo } : {}),
      },
    });
  }
  if (filters.overdue != null) {
    snapshotAnd.push({ isOverdue: filters.overdue });
  }
  if (filters.inconsistent != null) {
    snapshotAnd.push(
      filters.inconsistent
        ? { inconsistentItems: { gt: 0 } }
        : { inconsistentItems: 0 }
    );
  }
  if (filters.partiallyShipped != null) {
    snapshotAnd.push(
      filters.partiallyShipped
        ? { badgesJson: { array_contains: ["PARTIAL"] } }
        : { NOT: { badgesJson: { array_contains: ["PARTIAL"] } } }
    );
  }
  if (filters.withCut != null) {
    snapshotAnd.push(
      filters.withCut ? { cutValue: { gt: 0 } } : { cutValue: 0 }
    );
  }
  if (filters.withActiveResidual != null) {
    snapshotAnd.push(
      filters.withActiveResidual
        ? { activeResidualValue: { gt: 0 } }
        : { activeResidualValue: 0 }
    );
  }

  if (snapshotAnd.length === 0) return {};
  if (snapshotAnd.length === 1) return snapshotAnd[0]!;
  return { AND: snapshotAnd };
}

export function buildSalesOrderFlowSummaryColumns(
  aggregates: ReadonlyArray<SalesOrderFlowSummaryStageAggregate>,
  canViewValues: boolean
): SalesOrderFlowSummaryColumn[] {
  const byStage = new Map(
    aggregates.map((row) => [row.stage, row] as const)
  );
  return SALES_ORDER_FLOW_STAGES.map((stage) => {
    const row = byStage.get(stage);
    const orderCount = row?.orderCount ?? 0;
    const orderValue = row ? decimalNumber(row.orderValue) : 0;
    const activeResidualValue = row
      ? decimalNumber(row.activeResidualValue)
      : 0;
    return {
      stage,
      label: SALES_ORDER_FLOW_STAGE_LABELS[stage],
      isCanceledColumn: stage === "CANCELED",
      orderCount,
      orderValue: canViewValues ? orderValue : null,
      activeResidualValue: canViewValues ? activeResidualValue : null,
    };
  });
}

export function buildSalesOrderFlowSummaryPayload(input: {
  filters: SalesOrderFlowSummaryFilters;
  aggregates: ReadonlyArray<SalesOrderFlowSummaryStageAggregate>;
  totals: SalesOrderFlowSummaryTotals;
  lastUpdatedAt: Date | string | null;
  canViewValues: boolean;
  canViewInconsistencies?: boolean;
  generatedAt?: Date;
}): SalesOrderFlowSummaryPayload {
  const generatedAt = input.generatedAt ?? new Date();
  const last =
    input.lastUpdatedAt == null
      ? null
      : input.lastUpdatedAt instanceof Date
        ? input.lastUpdatedAt.toISOString()
        : new Date(input.lastUpdatedAt).toISOString();
  return {
    filters: serializeSalesOrderFlowSummaryFilters(input.filters),
    columns: buildSalesOrderFlowSummaryColumns(
      input.aggregates,
      input.canViewValues
    ),
    totals: {
      ...input.totals,
      inconsistentCount:
        input.canViewInconsistencies === false
          ? null
          : input.totals.inconsistentCount,
    },
    lastUpdatedAt: last && !Number.isNaN(Date.parse(last)) ? last : null,
    valuesVisible: input.canViewValues,
    inconsistenciesVisible: input.canViewInconsistencies !== false,
    generatedAt: generatedAt.toISOString(),
  };
}
