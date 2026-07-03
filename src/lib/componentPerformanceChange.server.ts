/**
 * Service — alterações operacionais de performance de componentes.
 * NÃO importar no frontend.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import type { AppAuthContext } from "./appAuth.js";
import {
  COMPONENT_PERFORMANCE_CHANGE_SOURCE,
  ComponentPerformanceValidationError,
  diffProcessSnapshots,
  isMissingComponentProcess,
  mergeProcessSnapshot,
  parseComponentPerformanceListQuery,
  parseComponentPerformancePatchBody,
  serializeProcessSnapshot,
  snapshotFromProduct,
  type ComponentPerformanceListFilters,
  type ComponentPerformanceProcessSnapshot,
  validateMergedProcessSnapshot,
  validatePositiveFieldsWhenPresent,
  estimateTheoreticalPiecesPerHour,
} from "./componentPerformanceChange.js";

export type ComponentPerformanceActor = {
  userId: string;
  userName: string;
  userEmail: string;
};

export function actorFromAppAuth(auth: AppAuthContext): ComponentPerformanceActor {
  return {
    userId: auth.id,
    userName: auth.name?.trim() || auth.email,
    userEmail: auth.email,
  };
}

function serializeProductRow(product: {
  id: string;
  sku: string;
  name: string;
  status: string | null;
  type: string;
  cycleTimeSeconds: unknown;
  cavities: unknown;
  setupTimeMin: unknown;
  efficiencyExpected: unknown;
  costingMode: string;
  defaultLotSize: unknown;
  updatedAt: Date | null;
  _count?: { SalesOrderItem?: number; ProductRouting?: number };
  lastPerformanceChangeAt?: Date | null;
}) {
  const process = snapshotFromProduct(product);
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    status: product.status,
    type: product.type,
    costingMode: product.costingMode,
    defaultLotSize: product.defaultLotSize != null ? Number(product.defaultLotSize) : null,
    process,
    missingProcess: isMissingComponentProcess(process),
    soldCount: product._count?.SalesOrderItem ?? 0,
    routingStepCount: product._count?.ProductRouting ?? 0,
    updatedAt: product.updatedAt?.toISOString() ?? null,
    lastPerformanceChangeAt: product.lastPerformanceChangeAt?.toISOString() ?? null,
    estimatedPiecesPerHour: estimateTheoreticalPiecesPerHour(process),
  };
}

function buildListWhere(filters: ComponentPerformanceListFilters): Prisma.ProductWhereInput {
  const where: Prisma.ProductWhereInput = {
    type: "COMPONENT",
  };

  if (filters.status) {
    where.status = filters.status;
  }

  if (filters.sku) {
    where.sku = { contains: filters.sku, mode: "insensitive" };
  }

  if (filters.name) {
    where.name = { contains: filters.name, mode: "insensitive" };
  }

  if (filters.soldOnly) {
    where.SalesOrderItem = { some: {} };
  }

  if (filters.missingProcessOnly) {
    where.OR = [
      { cycleTimeSeconds: null },
      { cavities: null },
      { setupTimeMin: null },
      { efficiencyExpected: null },
    ];
  }

  if (filters.missingCycleOnly) {
    where.cycleTimeSeconds = null;
  }

  if (filters.missingCavitiesOnly) {
    where.cavities = null;
  }

  if (filters.soldMissingOnly) {
    where.SalesOrderItem = { some: {} };
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
      { OR: [{ cycleTimeSeconds: null }, { cavities: null }] },
    ];
  }

  if (filters.pendingOnly) {
    where.OR = [
      { cycleTimeSeconds: null },
      { cavities: null },
      { setupTimeMin: null },
      { efficiencyExpected: null },
    ];
  }

  if (filters.recentlyChangedOnly) {
    const days = filters.recentDays ?? 30;
    const since = new Date();
    since.setDate(since.getDate() - days);
    where.ComponentPerformanceChangeLog = {
      some: {
        changedAt: { gte: since },
      },
    };
  }

  return where;
}

async function attachLastPerformanceChangeAt<
  T extends { id: string },
>(
  db: PrismaClient,
  rows: T[]
): Promise<Array<T & { lastPerformanceChangeAt: Date | null }>> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const grouped = await db.componentPerformanceChangeLog.groupBy({
    by: ["productId"],
    where: { productId: { in: ids } },
    _max: { changedAt: true },
  });
  const map = new Map(grouped.map((row) => [row.productId, row._max.changedAt ?? null]));
  return rows.map((row) => ({
    ...row,
    lastPerformanceChangeAt: map.get(row.id) ?? null,
  }));
}

const productSelectForList = {
  id: true,
  sku: true,
  name: true,
  status: true,
  type: true,
  cycleTimeSeconds: true,
  cavities: true,
  setupTimeMin: true,
  efficiencyExpected: true,
  costingMode: true,
  defaultLotSize: true,
  updatedAt: true,
  _count: {
    select: {
      SalesOrderItem: true,
      ProductRouting: true,
    },
  },
} satisfies Prisma.ProductSelect;

export async function listComponentPerformanceProducts(
  db: PrismaClient,
  query: Record<string, unknown>
) {
  const filters = parseComponentPerformanceListQuery(query);
  const where = buildListWhere(filters);

  const [total, rows] = await Promise.all([
    db.product.count({ where }),
    db.product.findMany({
      where,
      select: productSelectForList,
      orderBy: [{ sku: "asc" }],
      take: filters.limit,
      skip: filters.offset,
    }),
  ]);

  const rowsWithHistory = await attachLastPerformanceChangeAt(db, rows);

  return {
    total,
    limit: filters.limit ?? 100,
    offset: filters.offset ?? 0,
    items: rowsWithHistory.map(serializeProductRow),
  };
}

export async function getComponentPerformanceProduct(db: PrismaClient, productId: string) {
  const product = await db.product.findUnique({
    where: { id: productId },
    select: productSelectForList,
  });

  if (!product || product.type !== "COMPONENT") {
    return null;
  }

  return serializeProductRow(product);
}

function serializeChangeLog(row: {
  id: string;
  productId: string;
  skuSnapshot: string;
  productNameSnapshot: string;
  productTypeSnapshot: string;
  changedAt: Date;
  changedByUserId: string;
  changedByUserName: string;
  changedByUserEmail: string;
  responsiblePersonName: string;
  note: string | null;
  oldCycleTimeSeconds: unknown;
  newCycleTimeSeconds: unknown;
  oldCavities: number | null;
  newCavities: number | null;
  oldValuesJson: unknown;
  newValuesJson: unknown;
  changedFieldsJson: unknown;
  source: string;
  createdAt: Date;
}) {
  return {
    id: row.id,
    productId: row.productId,
    skuSnapshot: row.skuSnapshot,
    productNameSnapshot: row.productNameSnapshot,
    productTypeSnapshot: row.productTypeSnapshot,
    changedAt: row.changedAt.toISOString(),
    changedByUserId: row.changedByUserId,
    changedByUserName: row.changedByUserName,
    changedByUserEmail: row.changedByUserEmail,
    responsiblePersonName: row.responsiblePersonName,
    note: row.note,
    oldCycleTimeSeconds:
      row.oldCycleTimeSeconds != null ? Number(row.oldCycleTimeSeconds) : null,
    newCycleTimeSeconds:
      row.newCycleTimeSeconds != null ? Number(row.newCycleTimeSeconds) : null,
    oldCavities: row.oldCavities,
    newCavities: row.newCavities,
    oldValuesJson: row.oldValuesJson,
    newValuesJson: row.newValuesJson,
    changedFields: row.changedFieldsJson,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listComponentPerformanceHistory(
  db: PrismaClient,
  productId: string,
  options?: { limit?: number; offset?: number }
) {
  const product = await db.product.findUnique({
    where: { id: productId },
    select: { id: true, type: true },
  });
  if (!product || product.type !== "COMPONENT") {
    return null;
  }

  const limit = Math.min(Math.max(Math.floor(options?.limit ?? 50), 1), 200);
  const offset = Math.max(Math.floor(options?.offset ?? 0), 0);

  const [total, rows] = await Promise.all([
    db.componentPerformanceChangeLog.count({ where: { productId } }),
    db.componentPerformanceChangeLog.findMany({
      where: { productId },
      orderBy: { changedAt: "desc" },
      take: limit,
      skip: offset,
    }),
  ]);

  return {
    productId,
    total,
    limit,
    offset,
    items: rows.map(serializeChangeLog),
  };
}

export type PatchComponentPerformanceResult =
  | {
      ok: true;
      changed: true;
      product: ReturnType<typeof serializeProductRow>;
      changeLog: ReturnType<typeof serializeChangeLog>;
    }
  | {
      ok: true;
      changed: false;
      product: ReturnType<typeof serializeProductRow>;
      message: string;
    };

export async function patchComponentPerformanceProduct(
  db: PrismaClient,
  productId: string,
  body: unknown,
  actor: ComponentPerformanceActor
): Promise<PatchComponentPerformanceResult> {
  const patch = parseComponentPerformancePatchBody(body);
  validatePositiveFieldsWhenPresent(patch);

  const current = await db.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      sku: true,
      name: true,
      status: true,
      type: true,
      cycleTimeSeconds: true,
      cavities: true,
      setupTimeMin: true,
      efficiencyExpected: true,
      costingMode: true,
      defaultLotSize: true,
      updatedAt: true,
    },
  });

  if (!current) {
    throw new ComponentPerformanceValidationError("NOT_FOUND", "Componente não encontrado.");
  }
  if (current.type !== "COMPONENT") {
    throw new ComponentPerformanceValidationError(
      "NOT_COMPONENT",
      "Performance operacional só se aplica a itens do tipo COMPONENT."
    );
  }

  const before = snapshotFromProduct(current);
  const after = mergeProcessSnapshot(before, patch);
  validateMergedProcessSnapshot(after);

  const changedFields = diffProcessSnapshots(before, after);
  const productRow = serializeProductRow({ ...current, _count: { SalesOrderItem: 0, ProductRouting: 0 } });

  if (changedFields.length === 0) {
    return {
      ok: true,
      changed: false,
      product: productRow,
      message: "Nenhuma alteração detectada — histórico não foi criado.",
    };
  }

  const result = await db.$transaction(async (tx) => {
    const updated = await tx.product.update({
      where: { id: productId },
      data: {
        cycleTimeSeconds: after.cycleTimeSeconds,
        cavities: after.cavities,
        setupTimeMin: after.setupTimeMin,
        efficiencyExpected: after.efficiencyExpected,
      },
      select: productSelectForList,
    });

    const log = await tx.componentPerformanceChangeLog.create({
      data: {
        productId,
        skuSnapshot: current.sku,
        productNameSnapshot: current.name,
        productTypeSnapshot: "COMPONENT",
        changedByUserId: actor.userId,
        changedByUserName: actor.userName,
        changedByUserEmail: actor.userEmail,
        responsiblePersonName: patch.responsiblePersonName,
        note: patch.note ?? null,
        oldCycleTimeSeconds: before.cycleTimeSeconds,
        newCycleTimeSeconds: after.cycleTimeSeconds,
        oldCavities: before.cavities,
        newCavities: after.cavities,
        oldValuesJson: serializeProcessSnapshot(before),
        newValuesJson: serializeProcessSnapshot(after),
        changedFieldsJson: changedFields,
        source: COMPONENT_PERFORMANCE_CHANGE_SOURCE,
      },
    });

    return { updated, log };
  });

  return {
    ok: true,
    changed: true,
    product: serializeProductRow(result.updated),
    changeLog: serializeChangeLog(result.log),
  };
}

export { ComponentPerformanceValidationError };
