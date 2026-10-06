/**
 * Service canônico de InventoryStockSector (fundação).
 * Collector legado NÃO consome este módulo nesta fase.
 */
import type {
  InventoryStockSector,
  InventoryWarehouse,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { writeInventoryAuditLogInTx } from "./inventoryAudit.server.js";
import { canManageInventoryWarehouses } from "./inventoryPermissionChecks.js";
import { InventoryValidationError } from "./inventoryTypes.js";
import {
  assertStandardRequiresItemType,
  STOCK_SECTOR_ACTIVE_SCOPE_DUPLICATE,
  STOCK_SECTOR_CODE_DUPLICATE,
  STOCK_SECTOR_NOT_FOUND,
  STOCK_SECTOR_PREFIX_DUPLICATE,
  STOCK_SECTOR_SLUG_DUPLICATE,
  STOCK_SECTOR_WAREHOUSE_INACTIVE,
  type InventoryStockSectorStatusCode,
  type NormalizedCreateStockSectorInput,
} from "./inventoryStockSectorDomain.js";
import type { UpdateInventoryStockSectorPatch } from "./inventoryStockSectorValidation.js";

export type InventoryStockSectorAdminContext = {
  userId: string;
  userName?: string | null;
  permissions?: readonly string[];
};

export type InventoryStockSectorWithWarehouse = InventoryStockSector & {
  warehouse: Pick<
    InventoryWarehouse,
    "id" | "code" | "name" | "status" | "allowsMovements"
  >;
};

const WAREHOUSE_SELECT = {
  id: true,
  code: true,
  name: true,
  status: true,
  allowsMovements: true,
} as const;

const SECTOR_INCLUDE = {
  warehouse: { select: WAREHOUSE_SELECT },
} as const;

function assertCanManageStockSectors(context: InventoryStockSectorAdminContext): void {
  if (canManageInventoryWarehouses(context.permissions ?? [])) return;
  throw new InventoryValidationError(
    "Sem permissão para administrar setores de estoque.",
    "NOT_AUTHORIZED"
  );
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function isUniqueViolation(e: unknown): e is { code: string; meta?: { target?: unknown } } {
  return (
    typeof e === "object" &&
    e != null &&
    "code" in e &&
    (e as { code?: string }).code === "P2002"
  );
}

function mapUniqueViolation(e: unknown): never {
  if (isUniqueViolation(e)) {
    const target = Array.isArray(e.meta?.target)
      ? (e.meta?.target as string[]).join(",")
      : String(e.meta?.target ?? "");
    if (target.includes("slug")) {
      throw new InventoryValidationError(
        "Já existe setor com este slug.",
        STOCK_SECTOR_SLUG_DUPLICATE
      );
    }
    if (target.includes("sessionCodePrefix")) {
      throw new InventoryValidationError(
        "Já existe setor com este sessionCodePrefix.",
        STOCK_SECTOR_PREFIX_DUPLICATE
      );
    }
    if (target.includes("itemType") || target.includes("warehouseId") || target.includes("active_standard")) {
      throw new InventoryValidationError(
        "Já existe setor STANDARD ativo para este itemType e almoxarifado.",
        STOCK_SECTOR_ACTIVE_SCOPE_DUPLICATE
      );
    }
    throw new InventoryValidationError(
      "Já existe setor com este código.",
      STOCK_SECTOR_CODE_DUPLICATE
    );
  }
  throw e;
}

async function requireActiveWarehouse(
  tx: {
    inventoryWarehouse: {
      findUnique: (args: {
        where: { id: string };
        select: typeof WAREHOUSE_SELECT;
      }) => Promise<{
        id: string;
        code: string;
        name: string;
        status: string;
        allowsMovements: boolean;
      } | null>;
    };
  },
  warehouseId: string
) {
  if (!isUuid(warehouseId)) {
    throw new InventoryValidationError("warehouseId inválido.", "INVALID_ID");
  }
  const warehouse = await tx.inventoryWarehouse.findUnique({
    where: { id: warehouseId },
    select: WAREHOUSE_SELECT,
  });
  if (!warehouse) {
    throw new InventoryValidationError("Almoxarifado não encontrado.", "WAREHOUSE_NOT_FOUND");
  }
  if (warehouse.status !== "ACTIVE") {
    throw new InventoryValidationError(
      "Almoxarifado deve estar ACTIVE para vincular ao setor.",
      STOCK_SECTOR_WAREHOUSE_INACTIVE
    );
  }
  return warehouse;
}

export function serializeInventoryStockSector(row: InventoryStockSectorWithWarehouse) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    slug: row.slug,
    status: row.status,
    warehouseId: row.warehouseId,
    strategy: row.strategy,
    itemType: row.itemType,
    sessionCodePrefix: row.sessionCodePrefix,
    allowsCounting: row.allowsCounting,
    allowsWithdrawal: row.allowsWithdrawal,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    createdByUserId: row.createdByUserId,
    updatedByUserId: row.updatedByUserId,
    warehouse: {
      id: row.warehouse.id,
      code: row.warehouse.code,
      name: row.warehouse.name,
      status: row.warehouse.status,
      allowsMovements: row.warehouse.allowsMovements,
    },
  };
}

export type ListInventoryStockSectorsQuery = {
  page: number;
  pageSize: number;
  status?: InventoryStockSectorStatusCode | null;
  strategy?: string | null;
  search?: string | null;
};

export function parseListInventoryStockSectorsQuery(
  query: Record<string, unknown>
): ListInventoryStockSectorsQuery {
  const page = Math.max(1, Number.parseInt(String(query.page ?? "1"), 10) || 1);
  const pageSize = Math.min(
    200,
    Math.max(1, Number.parseInt(String(query.pageSize ?? "50"), 10) || 50)
  );
  const statusRaw = String(query.status ?? "").trim().toUpperCase();
  const strategyRaw = String(query.strategy ?? "").trim().toUpperCase();
  const search = String(query.search ?? "").trim();
  return {
    page,
    pageSize,
    status:
      statusRaw === "ACTIVE" || statusRaw === "INACTIVE"
        ? (statusRaw as InventoryStockSectorStatusCode)
        : null,
    strategy: strategyRaw || null,
    search: search || null,
  };
}

export async function listInventoryStockSectors(
  prisma: PrismaClient,
  query: ListInventoryStockSectorsQuery
): Promise<{
  rows: ReturnType<typeof serializeInventoryStockSector>[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}> {
  const where: Prisma.InventoryStockSectorWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.strategy
      ? { strategy: query.strategy as Prisma.EnumInventoryStockSectorStrategyFilter }
      : {}),
    ...(query.search
      ? {
          OR: [
            { code: { contains: query.search, mode: "insensitive" } },
            { name: { contains: query.search, mode: "insensitive" } },
            { slug: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const skip = (query.page - 1) * query.pageSize;
  const [rows, total] = await Promise.all([
    prisma.inventoryStockSector.findMany({
      where,
      include: SECTOR_INCLUDE,
      orderBy: [{ code: "asc" }],
      skip,
      take: query.pageSize,
    }),
    prisma.inventoryStockSector.count({ where }),
  ]);
  return {
    rows: rows.map((row) => serializeInventoryStockSector(row)),
    total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

export async function getInventoryStockSectorById(
  prisma: PrismaClient,
  id: string
): Promise<InventoryStockSectorWithWarehouse> {
  if (!isUuid(id)) {
    throw new InventoryValidationError("ID inválido.", "INVALID_ID");
  }
  const row = await prisma.inventoryStockSector.findUnique({
    where: { id },
    include: SECTOR_INCLUDE,
  });
  if (!row) {
    throw new InventoryValidationError("Setor de estoque não encontrado.", STOCK_SECTOR_NOT_FOUND);
  }
  return row;
}

export async function getInventoryStockSectorBySlug(
  prisma: PrismaClient,
  slug: string
): Promise<InventoryStockSectorWithWarehouse> {
  const normalized = String(slug ?? "").trim().toLowerCase();
  if (!normalized) {
    throw new InventoryValidationError("slug é obrigatório.", "FIELD_REQUIRED");
  }
  const row = await prisma.inventoryStockSector.findUnique({
    where: { slug: normalized },
    include: SECTOR_INCLUDE,
  });
  if (!row) {
    throw new InventoryValidationError("Setor de estoque não encontrado.", STOCK_SECTOR_NOT_FOUND);
  }
  return row;
}

export async function createInventoryStockSector(
  prisma: PrismaClient,
  input: NormalizedCreateStockSectorInput,
  context: InventoryStockSectorAdminContext
): Promise<InventoryStockSectorWithWarehouse> {
  assertCanManageStockSectors(context);
  assertStandardRequiresItemType(input.strategy, input.itemType);

  try {
    return await prisma.$transaction(async (tx) => {
      await requireActiveWarehouse(tx, input.warehouseId);
      const created = await tx.inventoryStockSector.create({
        data: {
          code: input.code,
          name: input.name,
          slug: input.slug,
          status: input.status,
          warehouseId: input.warehouseId,
          strategy: input.strategy,
          itemType: input.itemType,
          sessionCodePrefix: input.sessionCodePrefix,
          allowsCounting: input.allowsCounting,
          allowsWithdrawal: input.allowsWithdrawal,
          createdByUserId: context.userId,
          updatedByUserId: context.userId,
        },
        include: SECTOR_INCLUDE,
      });
      await writeInventoryAuditLogInTx(tx, {
        entityType: "InventoryStockSector",
        entityId: created.id,
        action: "CREATE",
        afterJson: serializeInventoryStockSector(created),
        userId: context.userId,
        userName: context.userName ?? null,
      });
      return created;
    });
  } catch (e: unknown) {
    mapUniqueViolation(e);
  }
}

export async function updateInventoryStockSector(
  prisma: PrismaClient,
  id: string,
  patch: UpdateInventoryStockSectorPatch,
  context: InventoryStockSectorAdminContext
): Promise<InventoryStockSectorWithWarehouse> {
  assertCanManageStockSectors(context);

  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.inventoryStockSector.findUnique({
        where: { id },
        include: SECTOR_INCLUDE,
      });
      if (!existing) {
        throw new InventoryValidationError(
          "Setor de estoque não encontrado.",
          STOCK_SECTOR_NOT_FOUND
        );
      }

      const nextStrategy = patch.strategy ?? existing.strategy;
      const nextItemType =
        patch.itemType !== undefined ? patch.itemType : existing.itemType;
      assertStandardRequiresItemType(
        nextStrategy as NormalizedCreateStockSectorInput["strategy"],
        nextItemType
      );

      if (patch.warehouseId) {
        await requireActiveWarehouse(tx, patch.warehouseId);
      }

      const updated = await tx.inventoryStockSector.update({
        where: { id },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.slug !== undefined ? { slug: patch.slug } : {}),
          ...(patch.warehouseId !== undefined ? { warehouseId: patch.warehouseId } : {}),
          ...(patch.strategy !== undefined ? { strategy: patch.strategy } : {}),
          ...(patch.itemType !== undefined ? { itemType: patch.itemType } : {}),
          ...(patch.sessionCodePrefix !== undefined
            ? { sessionCodePrefix: patch.sessionCodePrefix }
            : {}),
          ...(patch.allowsCounting !== undefined
            ? { allowsCounting: patch.allowsCounting }
            : {}),
          ...(patch.allowsWithdrawal !== undefined
            ? { allowsWithdrawal: patch.allowsWithdrawal }
            : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          updatedByUserId: context.userId,
        },
        include: SECTOR_INCLUDE,
      });

      await writeInventoryAuditLogInTx(tx, {
        entityType: "InventoryStockSector",
        entityId: id,
        action: "UPDATE",
        beforeJson: serializeInventoryStockSector(existing),
        afterJson: serializeInventoryStockSector(updated),
        userId: context.userId,
        userName: context.userName ?? null,
      });
      return updated;
    });
  } catch (e: unknown) {
    if (e instanceof InventoryValidationError) throw e;
    mapUniqueViolation(e);
  }
}

export async function setInventoryStockSectorStatus(
  prisma: PrismaClient,
  id: string,
  status: InventoryStockSectorStatusCode,
  context: InventoryStockSectorAdminContext
): Promise<InventoryStockSectorWithWarehouse> {
  return updateInventoryStockSector(prisma, id, { status }, context);
}
