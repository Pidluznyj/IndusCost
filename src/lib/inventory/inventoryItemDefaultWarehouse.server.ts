/**
 * Escopo padrão (almoxarifado × endereço) do InventoryItem — resolução server.
 *
 * Única porta para gravar `defaultWarehouseId` / `defaultLocationId` pelo
 * cadastro de itens (POST / PUT /api/inventory/items). O vínculo de MP oficial
 * continua com o seu próprio resolvedor (inventoryMaterialLinkService), que não
 * é tocado aqui.
 *
 * Valida, nesta ordem:
 * 1. política do tipo (setores STANDARD ativos) — preenche ou recusa;
 * 2. endereço: existe, ativo, e pertence ao almoxarifado padrão;
 * 3. almoxarifado: existe, ativo e (quando o item controla estoque) aceita movimentações.
 *
 * Não cria InventoryBalance, movimento nem linha de conferência.
 */
import type { PrismaClient } from "@prisma/client";
import type { InventoryItemType } from "./inventoryTypes.js";
import { InventoryValidationError } from "./inventoryTypes.js";
import { assertDefaultLocationBelongsToWarehouse } from "./inventoryMaterialLinkRules.js";
import {
  applyItemDefaultWarehousePolicy,
  resolveItemDefaultWarehousePolicy,
  type ItemDefaultWarehousePolicy,
  type StandardSectorWarehouseOption,
} from "./inventoryItemDefaultWarehousePolicy.js";

export const WAREHOUSE_MOVEMENTS_NOT_ALLOWED = "WAREHOUSE_MOVEMENTS_NOT_ALLOWED";

/** Superfície mínima de leitura — PrismaClient, transação ou dublê de teste. */
export type ItemDefaultWarehouseReadDb = {
  inventoryStockSector: {
    findMany: (args: {
      where: { status: "ACTIVE"; strategy: "STANDARD"; itemType: InventoryItemType };
      select: {
        id: true;
        code: true;
        name: true;
        warehouseId: true;
        warehouse: { select: { code: true; name: true } };
      };
      orderBy: { code: "asc" };
    }) => Promise<
      Array<{
        id: string;
        code: string;
        name: string;
        warehouseId: string;
        warehouse: { code: string; name: string };
      }>
    >;
  };
  inventoryWarehouse: {
    findUnique: (args: {
      where: { id: string };
      select: { id: true; code: true; status: true; allowsMovements: true };
    }) => Promise<{ id: string; code: string; status: string; allowsMovements: boolean } | null>;
  };
  inventoryLocation: {
    findUnique: (args: {
      where: { id: string };
      select: { id: true; warehouseId: true; status: true };
    }) => Promise<{ id: string; warehouseId: string; status: string } | null>;
  };
};

export async function loadStandardSectorWarehouseOptions(
  db: Pick<ItemDefaultWarehouseReadDb, "inventoryStockSector">,
  itemType: InventoryItemType
): Promise<StandardSectorWarehouseOption[]> {
  const rows = await db.inventoryStockSector.findMany({
    where: { status: "ACTIVE", strategy: "STANDARD", itemType },
    select: {
      id: true,
      code: true,
      name: true,
      warehouseId: true,
      warehouse: { select: { code: true, name: true } },
    },
    orderBy: { code: "asc" },
  });
  return rows.map((row) => ({
    sectorId: row.id,
    sectorCode: row.code,
    sectorName: row.name,
    warehouseId: row.warehouseId,
    warehouseCode: row.warehouse.code,
    warehouseName: row.warehouse.name,
  }));
}

export async function loadItemDefaultWarehousePolicy(
  db: Pick<ItemDefaultWarehouseReadDb, "inventoryStockSector">,
  itemType: InventoryItemType
): Promise<ItemDefaultWarehousePolicy> {
  return resolveItemDefaultWarehousePolicy(itemType, await loadStandardSectorWarehouseOptions(db, itemType));
}

export type ResolveItemDefaultScopeInput = {
  itemType: InventoryItemType;
  /** Item que controla saldo exige almoxarifado que aceite movimentações. */
  controlsStock: boolean;
  defaultWarehouseId: string | null;
  defaultLocationId: string | null;
};

export type ResolvedItemDefaultScope = {
  defaultWarehouseId: string | null;
  defaultLocationId: string | null;
  policy: ItemDefaultWarehousePolicy;
  /** true quando o almoxarifado veio da política, não do cliente. */
  autoAssigned: boolean;
};

export async function resolveInventoryItemDefaultScope(
  db: ItemDefaultWarehouseReadDb,
  input: ResolveItemDefaultScopeInput
): Promise<ResolvedItemDefaultScope> {
  const policy = await loadItemDefaultWarehousePolicy(db, input.itemType);

  let requestedWarehouseId = input.defaultWarehouseId?.trim() || null;
  const defaultLocationId = input.defaultLocationId?.trim() || null;
  let locationWarehouseId: string | null = null;

  if (defaultLocationId) {
    const location = await db.inventoryLocation.findUnique({
      where: { id: defaultLocationId },
      select: { id: true, warehouseId: true, status: true },
    });
    if (!location) {
      throw new InventoryValidationError("Endereço padrão não encontrado.", "LOCATION_NOT_FOUND");
    }
    if (location.status !== "ACTIVE") {
      throw new InventoryValidationError("Endereço padrão precisa estar ativo.", "LOCATION_INACTIVE");
    }
    locationWarehouseId = location.warehouseId;
    // Endereço sem almoxarifado: o almoxarifado é o do endereço (a política ainda decide).
    if (!requestedWarehouseId) requestedWarehouseId = location.warehouseId;
  }

  const defaultWarehouseId = applyItemDefaultWarehousePolicy(policy, requestedWarehouseId);
  const autoAssigned = Boolean(defaultWarehouseId) && !requestedWarehouseId;

  assertDefaultLocationBelongsToWarehouse(
    locationWarehouseId,
    defaultWarehouseId,
    Boolean(defaultLocationId)
  );

  if (defaultWarehouseId) {
    const warehouse = await db.inventoryWarehouse.findUnique({
      where: { id: defaultWarehouseId },
      select: { id: true, code: true, status: true, allowsMovements: true },
    });
    if (!warehouse) {
      throw new InventoryValidationError("Almoxarifado padrão não encontrado.", "WAREHOUSE_NOT_FOUND");
    }
    if (warehouse.status !== "ACTIVE") {
      throw new InventoryValidationError(
        `Almoxarifado padrão ${warehouse.code} está inativo.`,
        "WAREHOUSE_INACTIVE"
      );
    }
    if (input.controlsStock && !warehouse.allowsMovements) {
      throw new InventoryValidationError(
        `Almoxarifado padrão ${warehouse.code} não aceita movimentações; item que controla estoque não pode usá-lo.`,
        WAREHOUSE_MOVEMENTS_NOT_ALLOWED
      );
    }
  }

  return { defaultWarehouseId, defaultLocationId, policy, autoAssigned };
}

/** Prisma real satisfaz a superfície mínima. */
export function asItemDefaultWarehouseReadDb(prisma: PrismaClient): ItemDefaultWarehouseReadDb {
  return prisma as unknown as ItemDefaultWarehouseReadDb;
}
