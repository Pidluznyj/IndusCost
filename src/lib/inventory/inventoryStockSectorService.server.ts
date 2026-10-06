/**
 * Service canônico de InventoryStockSector — cadastro administrativo dos
 * setores configuráveis (strategy = STANDARD) que o Collector atende.
 *
 * O setor é CONFIGURAÇÃO OPERACIONAL: aponta para um almoxarifado e um tipo de
 * item. Não guarda saldo, não copia itens e não movimenta estoque. Os setores
 * legados (Matéria-prima, Componentes, Produto acabado) não passam por aqui.
 */
import type {
  CostCenter,
  InventoryItemType,
  InventoryStockSector,
  InventoryWarehouse,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { writeInventoryAuditLogInTx } from "./inventoryAudit.server.js";
import { canManageInventoryWarehouses } from "./inventoryPermissionChecks.js";
import { serializeInventoryWarehouse } from "./inventorySerialization.server.js";
import { InventoryValidationError } from "./inventoryTypes.js";
import { standardSectorMemberItemWhere } from "./collector/collectorStandardEligibility.js";
import {
  assertStandardRequiresItemType,
  assertStockSectorCostCenter,
  INVENTORY_STOCK_SECTOR_STANDARD_ITEM_TYPES,
  STOCK_SECTOR_ACTIVE_SCOPE_DUPLICATE,
  STOCK_SECTOR_CODE_DUPLICATE,
  STOCK_SECTOR_COST_CENTER_INVALID,
  STOCK_SECTOR_HAS_ACTIVE_SESSION,
  STOCK_SECTOR_LEGACY_ITEM_TYPES,
  STOCK_SECTOR_LEGACY_RESERVED,
  STOCK_SECTOR_NOT_FOUND,
  STOCK_SECTOR_PREFIX_DUPLICATE,
  STOCK_SECTOR_SLUG_DUPLICATE,
  STOCK_SECTOR_WAREHOUSE_INACTIVE,
  stockSectorRequiresCostCenter,
  type InventoryStockSectorStatusCode,
  type NormalizedCreateStockSectorInput,
} from "./inventoryStockSectorDomain.js";
import type {
  CreateStockSectorWithWarehouseInput,
  UpdateInventoryStockSectorPatch,
} from "./inventoryStockSectorValidation.js";
import { createInventoryWarehouseRecord } from "./inventoryWarehouseWrite.server.js";

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
  defaultCostCenter?: Pick<CostCenter, "id" | "code" | "name" | "isActive"> | null;
};

const WAREHOUSE_SELECT = {
  id: true,
  code: true,
  name: true,
  status: true,
  allowsMovements: true,
} as const;

const COST_CENTER_SELECT = { id: true, code: true, name: true, isActive: true } as const;

const SECTOR_INCLUDE = {
  warehouse: { select: WAREHOUSE_SELECT },
  defaultCostCenter: { select: COST_CENTER_SELECT },
} as const;

type Tx = Prisma.TransactionClient;

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
        "Já existe setor com este prefixo de conferência.",
        STOCK_SECTOR_PREFIX_DUPLICATE
      );
    }
    if (target.includes("itemType") || target.includes("warehouseId") || target.includes("active_standard")) {
      throw new InventoryValidationError(
        "Já existe setor ativo para este tipo de item neste almoxarifado.",
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

async function requireActiveWarehouse(tx: Pick<Tx, "inventoryWarehouse">, warehouseId: string) {
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

/**
 * Centro de custo padrão do setor: obrigatório quando o itemType exige centro de
 * custo nas saídas; quando informado, precisa existir e estar ativo.
 */
async function requireSectorCostCenter(
  tx: Pick<Tx, "costCenter">,
  itemType: InventoryItemType | null,
  defaultCostCenterId: string | null
): Promise<void> {
  assertStockSectorCostCenter(itemType, defaultCostCenterId);
  if (!defaultCostCenterId) return;
  const costCenter = await tx.costCenter.findUnique({
    where: { id: defaultCostCenterId },
    select: { id: true, isActive: true },
  });
  if (!costCenter || !costCenter.isActive) {
    throw new InventoryValidationError(
      "Centro de custo inexistente ou inativo.",
      STOCK_SECTOR_COST_CENTER_INVALID
    );
  }
}

function assertItemTypeNotLegacy(itemType: InventoryItemType | null): void {
  if (itemType && STOCK_SECTOR_LEGACY_ITEM_TYPES.has(itemType)) {
    throw new InventoryValidationError(
      "Matéria-prima, Componentes e Produto acabado têm fluxo próprio no Collector e não podem virar setor configurável.",
      STOCK_SECTOR_LEGACY_RESERVED
    );
  }
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
    defaultCostCenterId: row.defaultCostCenterId ?? null,
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
    defaultCostCenter: row.defaultCostCenter
      ? {
          id: row.defaultCostCenter.id,
          code: row.defaultCostCenter.code,
          name: row.defaultCostCenter.name,
          isActive: row.defaultCostCenter.isActive,
        }
      : null,
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

/** Lista paginada — 2 consultas, independentemente do número de setores. */
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

// ---------------------------------------------------------------------------
// Prévia de população e opções do formulário
// ---------------------------------------------------------------------------

/**
 * Quantos itens o setor enxergaria — mesmo predicado da população da contagem
 * e da retirada. Um COUNT no banco; nenhum item é carregado.
 */
export async function countInventoryStockSectorEligibleItems(
  prisma: Pick<PrismaClient, "inventoryItem">,
  input: { itemType: InventoryItemType; warehouseId: string | null }
): Promise<number> {
  assertItemTypeNotLegacy(input.itemType);
  // Almoxarifado ainda não criado (será criado com o setor): nada pertence a ele.
  if (!input.warehouseId) return 0;
  if (!isUuid(input.warehouseId)) {
    throw new InventoryValidationError("warehouseId inválido.", "INVALID_ID");
  }
  return prisma.inventoryItem.count({
    where: standardSectorMemberItemWhere({
      itemType: input.itemType,
      warehouseId: input.warehouseId,
    }),
  });
}

/** Listas fechadas do formulário: o cliente escolhe, não digita identificadores. */
export async function loadInventoryStockSectorFormOptions(
  prisma: Pick<PrismaClient, "inventoryWarehouse" | "costCenter">
) {
  const [warehouses, costCenters] = await Promise.all([
    prisma.inventoryWarehouse.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, code: true, name: true },
      orderBy: [{ code: "asc" }],
    }),
    prisma.costCenter.findMany({
      where: { isActive: true },
      select: { id: true, code: true, name: true },
      orderBy: [{ code: "asc" }],
    }),
  ]);
  return {
    strategies: ["STANDARD"] as const,
    itemTypes: INVENTORY_STOCK_SECTOR_STANDARD_ITEM_TYPES.map((itemType) => ({
      itemType,
      requiresCostCenter: stockSectorRequiresCostCenter(itemType),
    })),
    warehouses,
    costCenters,
  };
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

async function createStockSectorInTx(
  tx: Tx,
  input: NormalizedCreateStockSectorInput,
  context: InventoryStockSectorAdminContext
): Promise<InventoryStockSectorWithWarehouse> {
  await requireActiveWarehouse(tx, input.warehouseId);
  await requireSectorCostCenter(tx, input.itemType, input.defaultCostCenterId);
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
      defaultCostCenterId: input.defaultCostCenterId,
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
}

export async function createInventoryStockSector(
  prisma: PrismaClient,
  input: NormalizedCreateStockSectorInput,
  context: InventoryStockSectorAdminContext
): Promise<InventoryStockSectorWithWarehouse> {
  assertCanManageStockSectors(context);
  assertStandardRequiresItemType(input.strategy, input.itemType);
  assertItemTypeNotLegacy(input.itemType);

  try {
    return await prisma.$transaction((tx) => createStockSectorInTx(tx, input, context));
  } catch (e: unknown) {
    if (e instanceof InventoryValidationError) throw e;
    mapUniqueViolation(e);
  }
}

/**
 * Almoxarifado novo + setor na MESMA transação. Se o setor falhar (código,
 * slug ou prefixo duplicado, centro de custo inválido…), o almoxarifado criado
 * aqui é desfeito junto — nunca sobra almoxarifado órfão. A criação do
 * almoxarifado é a canônica (mesma regra e mesma auditoria do cadastro manual).
 */
export async function createInventoryStockSectorWithWarehouse(
  prisma: PrismaClient,
  input: CreateStockSectorWithWarehouseInput,
  context: InventoryStockSectorAdminContext
): Promise<{
  sector: InventoryStockSectorWithWarehouse;
  warehouse: ReturnType<typeof serializeInventoryWarehouse>;
}> {
  assertCanManageStockSectors(context);
  assertStandardRequiresItemType(input.sector.strategy, input.sector.itemType);
  assertItemTypeNotLegacy(input.sector.itemType);

  try {
    return await prisma.$transaction(async (tx) => {
      const warehouse = await createInventoryWarehouseRecord(tx, input.newWarehouse, {
        userId: context.userId,
        userName: context.userName ?? null,
      });
      const sector = await createStockSectorInTx(
        tx,
        { ...input.sector, warehouseId: warehouse.id },
        context
      );
      return { sector, warehouse: serializeInventoryWarehouse(warehouse) };
    });
  } catch (e: unknown) {
    if (e instanceof InventoryValidationError) throw e;
    mapUniqueViolation(e);
  }
}

/**
 * Campos que definem a identidade operacional do setor. Mudá-los com uma
 * conferência em contagem aberta deixaria a sessão órfã (o Collector a
 * reconhece por itemType + prefixo no almoxarifado do setor).
 */
function changesSectorIdentity(
  existing: InventoryStockSector,
  patch: UpdateInventoryStockSectorPatch
): boolean {
  return (
    (patch.warehouseId !== undefined && patch.warehouseId !== existing.warehouseId) ||
    (patch.itemType !== undefined && patch.itemType !== existing.itemType) ||
    (patch.sessionCodePrefix !== undefined &&
      patch.sessionCodePrefix !== existing.sessionCodePrefix) ||
    (patch.strategy !== undefined && patch.strategy !== existing.strategy)
  );
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
      assertItemTypeNotLegacy(nextItemType);

      if (changesSectorIdentity(existing, patch)) {
        const openSessions = await tx.inventoryCountSession.count({
          where: {
            warehouseId: existing.warehouseId,
            status: "COUNTING",
            code: { startsWith: `${existing.sessionCodePrefix}-` },
          },
        });
        if (openSessions > 0) {
          throw new InventoryValidationError(
            "Há conferência em contagem deste setor. Conclua ou cancele a conferência antes de mudar almoxarifado, tipo de item ou prefixo.",
            STOCK_SECTOR_HAS_ACTIVE_SESSION
          );
        }
      }

      if (patch.warehouseId) {
        await requireActiveWarehouse(tx, patch.warehouseId);
      }

      const nextCostCenterId =
        patch.defaultCostCenterId !== undefined
          ? patch.defaultCostCenterId
          : existing.defaultCostCenterId;
      if (patch.defaultCostCenterId !== undefined || patch.itemType !== undefined) {
        await requireSectorCostCenter(tx, nextItemType, nextCostCenterId);
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
          ...(patch.defaultCostCenterId !== undefined
            ? { defaultCostCenterId: patch.defaultCostCenterId }
            : {}),
          updatedByUserId: context.userId,
        },
        include: SECTOR_INCLUDE,
      });

      const statusChanged = patch.status !== undefined && patch.status !== existing.status;
      await writeInventoryAuditLogInTx(tx, {
        entityType: "InventoryStockSector",
        entityId: id,
        // Ativar/inativar fica nomeado na trilha; demais edições são UPDATE.
        action: statusChanged
          ? updated.status === "ACTIVE"
            ? "ACTIVATE"
            : "DEACTIVATE"
          : "UPDATE",
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
