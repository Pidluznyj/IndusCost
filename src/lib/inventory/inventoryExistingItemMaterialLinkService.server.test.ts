import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import { linkExistingInventoryItemToOfficialMaterial } from "./inventoryExistingItemMaterialLinkService.server.js";
import { InventoryValidationError } from "./inventoryTypes.js";

const ITEM_ID = "22222222-2222-4222-8222-222222222222";
const MATERIAL_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_MATERIAL = "33333333-3333-4333-8333-333333333333";
const BALANCE_ID = "44444444-4444-4444-8444-444444444444";

type ItemRow = {
  id: string;
  code: string;
  description: string;
  itemType: string;
  unit: string;
  status: string;
  materialId: string | null;
  materialCodeSnapshot: string | null;
  materialDescriptionSnapshot: string | null;
  materialUnitSnapshot: string | null;
  materialCategorySnapshot: string | null;
  updatedByUserId: string | null;
  controlsLocation: boolean;
};

function emptyDelegate() {
  return {};
}

function createDb(options?: {
  itemType?: string;
  unit?: string;
  materialId?: string | null;
  otherActive?: boolean;
  materialQuantity?: string;
  physical?: string;
}) {
  const item: ItemRow = {
    id: ITEM_ID,
    code: "PP-HS03",
    description: "Polipropileno H503",
    itemType: options?.itemType ?? "RAW_MATERIAL",
    unit: options?.unit ?? "KG",
    status: "ACTIVE",
    materialId: options?.materialId ?? null,
    materialCodeSnapshot: null,
    materialDescriptionSnapshot: null,
    materialUnitSnapshot: null,
    materialCategorySnapshot: null,
    updatedByUserId: null,
    controlsLocation: false,
  };
  const material = {
    id: MATERIAL_ID,
    code: "PP-HS03",
    description: "Polipropileno H503",
    unit: "KG",
    status: "ACTIVE",
    category: "POL",
    quantity: new Prisma.Decimal(options?.materialQuantity ?? "0"),
  };
  const physical = new Prisma.Decimal(options?.physical ?? "5.355");
  const audit: unknown[] = [];
  let movementCount = 2;
  const balanceRow = {
    id: BALANCE_ID,
    physicalQuantity: physical,
    reservedQuantity: new Prisma.Decimal(0),
    blockedQuantity: new Prisma.Decimal(0),
    quarantineQuantity: new Prisma.Decimal(0),
    availableQuantity: physical,
    locationId: null,
  };

  const inventoryItemApi = {
    findUnique: async () => ({ ...item }),
    findFirst: async () => (options?.otherActive ? { id: "other-item" } : null),
    findMany: async ({ where }: { where: { materialId?: string; status?: string } }) => {
      if (where.materialId && item.materialId === where.materialId && item.status === "ACTIVE") {
        return [
          {
            id: item.id,
            materialId: item.materialId,
            unit: item.unit,
            status: item.status,
            controlsLocation: item.controlsLocation,
          },
        ];
      }
      return [];
    },
    update: async ({ data }: { data: Partial<ItemRow> }) => {
      Object.assign(item, data);
      return { ...item };
    },
  };

  const tx = {
    $queryRaw: async () => [{ "?column?": 1 }],
    inventoryItem: inventoryItemApi,
    inventoryBalance: {
      findMany: async () => [{ ...balanceRow }],
    },
    inventoryMovement: {
      count: async () => movementCount,
    },
    material: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        if (where.id !== MATERIAL_ID) return null;
        return { ...material };
      },
      update: async ({
        data,
      }: {
        data: { quantity: Prisma.Decimal };
      }) => {
        material.quantity = data.quantity;
        return { id: MATERIAL_ID, quantity: material.quantity };
      },
    },
    inventoryAuditLog: {
      create: async ({ data }: { data: unknown }) => {
        audit.push(data);
        return data;
      },
    },
  };

  const db = {
    inventoryItem: inventoryItemApi,
    material: tx.material,
    product: emptyDelegate(),
    productBOM: emptyDelegate(),
    financialSupplier: emptyDelegate(),
    costCenter: emptyDelegate(),
    financialCostCenter: emptyDelegate(),
    salesOrder: emptyDelegate(),
    nomusProductionOrder: emptyDelegate(),
    project: emptyDelegate(),
    materialCostTableItem: emptyDelegate(),
    productionCostTableItem: emptyDelegate(),
    materialMarketQuote: emptyDelegate(),
    nomusStockDocument: emptyDelegate(),
    nomusNfe: emptyDelegate(),
    $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    _item: item,
    _material: material,
    _audit: audit,
    _movementCount: () => movementCount,
    _balance: () => ({ ...balanceRow }),
  };

  return db;
}

describe("linkExistingInventoryItemToOfficialMaterial", () => {
  const actor = { id: "user-1", name: "Paulo" };

  it("vínculo válido projeta quantity e não mexe no ledger", async () => {
    const db = createDb({ materialQuantity: "0", physical: "5.355" });
    const movementsBefore = db._movementCount();
    const balanceBefore = db._balance().physicalQuantity.toString();
    const result = await linkExistingInventoryItemToOfficialMaterial(
      db as never,
      ITEM_ID,
      MATERIAL_ID,
      actor
    );
    assert.equal(result.status, "LINKED");
    assert.equal(result.item.materialId, MATERIAL_ID);
    assert.equal(result.item.id, ITEM_ID);
    assert.equal(result.idempotent, false);
    assert.equal(result.movementsCreated, 0);
    assert.equal(result.inventoryBalanceDirectWrites, 0);
    assert.equal(result.projection?.after, "5.355");
    assert.equal(result.projection?.changed, true);
    assert.equal(db._material.quantity.toString(), "5.355");
    assert.equal(db._movementCount(), movementsBefore);
    assert.equal(db._balance().physicalQuantity.toString(), balanceBefore);
    assert.equal(db._item.code, "PP-HS03");
    const actions = db._audit.map((row) => (row as { action?: string }).action);
    assert.ok(actions.includes("LINK_EXISTING_ITEM_TO_OFFICIAL_MATERIAL"));
    assert.ok(actions.includes("INVENTORY_QUANTITY_PROJECTED"));
  });

  it("idempotente se já vinculado ao mesmo Material", async () => {
    const db = createDb({
      materialId: MATERIAL_ID,
      materialQuantity: "5.355",
      physical: "5.355",
    });
    const result = await linkExistingInventoryItemToOfficialMaterial(
      db as never,
      ITEM_ID,
      MATERIAL_ID,
      actor
    );
    assert.equal(result.status, "ALREADY_LINKED");
    assert.equal(result.idempotent, true);
    assert.equal(result.item.id, ITEM_ID);
    assert.equal(result.movementsCreated, 0);
    assert.equal(db._audit.length, 0);
  });

  it("recusa FINISHED_PRODUCT e PACKAGING", async () => {
    for (const itemType of ["FINISHED_PRODUCT", "PACKAGING"] as const) {
      const db = createDb({ itemType });
      await assert.rejects(
        () => linkExistingInventoryItemToOfficialMaterial(db as never, ITEM_ID, MATERIAL_ID, actor),
        (e: unknown) => e instanceof InventoryValidationError && e.code === "ITEM_NOT_RAW_MATERIAL"
      );
    }
  });

  it("recusa UNIT_MISMATCH", async () => {
    const db = createDb({ unit: "UN" });
    await assert.rejects(
      () => linkExistingInventoryItemToOfficialMaterial(db as never, ITEM_ID, MATERIAL_ID, actor),
      (e: unknown) => e instanceof InventoryValidationError && e.code === "UNIT_MISMATCH"
    );
    assert.equal(db._item.materialId, null);
  });

  it("recusa material já vinculado a outro item ACTIVE", async () => {
    const db = createDb({ otherActive: true });
    await assert.rejects(
      () => linkExistingInventoryItemToOfficialMaterial(db as never, ITEM_ID, MATERIAL_ID, actor),
      (e: unknown) =>
        e instanceof InventoryValidationError && e.code === "MATERIAL_ALREADY_LINKED_ACTIVE"
    );
  });

  it("recusa item que não é RAW_MATERIAL", async () => {
    const db = createDb({ itemType: "COMPONENT" });
    await assert.rejects(
      () => linkExistingInventoryItemToOfficialMaterial(db as never, ITEM_ID, MATERIAL_ID, actor),
      (e: unknown) => e instanceof InventoryValidationError && e.code === "ITEM_NOT_RAW_MATERIAL"
    );
  });

  it("recusa relink para Material diferente", async () => {
    const db = createDb({ materialId: OTHER_MATERIAL });
    await assert.rejects(
      () => linkExistingInventoryItemToOfficialMaterial(db as never, ITEM_ID, MATERIAL_ID, actor),
      (e: unknown) =>
        e instanceof InventoryValidationError &&
        e.code === "ITEM_ALREADY_LINKED_TO_DIFFERENT_MATERIAL"
    );
  });
});
