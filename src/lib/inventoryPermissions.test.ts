import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  canApproveInventoryCount,
  canCreateBasicInventoryMovement,
  canCreateInventoryAdjustment,
  canCreateInventoryMovementType,
  canManageInventoryBlock,
  canViewInventory,
} from "./inventory/inventoryPermissionChecks.js";
import { validateMovementRequest } from "./inventory/inventoryMovementRules.js";
import { InventoryValidationError } from "./inventory/inventoryTypes.js";
import { snapshotFromBalance } from "./inventory/inventoryTypes.js";
import { assertInventoryMovementPermission } from "./inventory/inventoryPermissionChecks.js";
import { createInventoryMovement } from "./inventory/inventoryService.server.js";
import { Prisma } from "@prisma/client";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("inventoryPermissionChecks", () => {
  it("1. usuário sem permissão não cria movimento básico", () => {
    assert.equal(canCreateBasicInventoryMovement(["inventory.view"]), false);
    assert.equal(canCreateInventoryMovementType(["inventory.view"], "MANUAL_ENTRY"), false);
    assert.throws(
      () => assertInventoryMovementPermission(["inventory.view"], "MANUAL_ENTRY"),
      (e: unknown) => e instanceof Error
    );
  });

  it("2. usuário sem permissão não cria ajuste", () => {
    assert.equal(canCreateInventoryAdjustment(["inventory.view"]), false);
    assert.equal(
      canCreateInventoryMovementType(["inventory.view"], "POSITIVE_ADJUSTMENT"),
      false
    );
    assert.equal(
      canCreateInventoryMovementType(["inventory.movements.create"], "POSITIVE_ADJUSTMENT"),
      true
    );
  });

  it("3. usuário sem permissão não aprova conferência", () => {
    assert.equal(canApproveInventoryCount(["inventory.count.manage"]), true);
    assert.equal(canApproveInventoryCount(["inventory.view"]), false);
    assert.equal(canApproveInventoryCount(["inventory.count.approve"]), true);
  });

  it("4. usuário consulta consegue visualizar", () => {
    assert.equal(canViewInventory(["inventory.view"]), true);
    assert.equal(canViewInventory([]), false);
  });

  it("13. não quebra usuários admin legado (inventory.manage)", () => {
    const legacy = ["inventory.manage"];
    assert.equal(canCreateBasicInventoryMovement(legacy), true);
    assert.equal(canCreateInventoryAdjustment(legacy), true);
    assert.equal(canManageInventoryBlock(legacy), true);
    assert.equal(canApproveInventoryCount(legacy), true);
  });

  it("13b. SUPER_ADMIN recebe novas chaves via catálogo", () => {
    const catalog = read("src/lib/permissionCatalog.ts");
    assert.match(catalog, /inventory\.item\.manage/);
    assert.match(catalog, /inventory\.count\.approve/);
    assert.match(catalog, /inventory\.adjustment\.create/);
  });
});

describe("inventoryMovementRules — centro de custo e motivo", () => {
  const balance = snapshotFromBalance({ physicalQuantity: 10, availableQuantity: 10 });

  it("5. saída de suprimento administrativo sem centro de custo falha", () => {
    assert.throws(
      () =>
        validateMovementRequest(balance, {
          movementType: "MANUAL_EXIT",
          quantity: 1,
          reason: "Consumo",
          itemType: "ADMINISTRATIVE_SUPPLY",
        }),
      (e: unknown) => e instanceof InventoryValidationError && e.code === "COST_CENTER_REQUIRED"
    );
  });

  it("6. saída de EPI sem centro de custo falha", () => {
    assert.throws(
      () =>
        validateMovementRequest(balance, {
          movementType: "MANUAL_EXIT",
          quantity: 1,
          reason: "Distribuição",
          itemType: "PPE",
        }),
      (e: unknown) => e instanceof InventoryValidationError && e.code === "COST_CENTER_REQUIRED"
    );
  });

  it("7. saída de manutenção sem centro de custo falha", () => {
    assert.throws(
      () =>
        validateMovementRequest(balance, {
          movementType: "MANUAL_EXIT",
          quantity: 1,
          reason: "OS 123",
          itemType: "MAINTENANCE",
        }),
      (e: unknown) => e instanceof InventoryValidationError && e.code === "COST_CENTER_REQUIRED"
    );
  });

  it("8. movimento manual sem motivo falha", () => {
    assert.throws(
      () =>
        validateMovementRequest(balance, {
          movementType: "MANUAL_EXIT",
          quantity: 1,
          reason: "",
          itemType: "RAW_MATERIAL",
        }),
      (e: unknown) => e instanceof InventoryValidationError && e.code === "REASON_REQUIRED"
    );
  });

  it("9. ajuste sem motivo falha", () => {
    assert.throws(
      () =>
        validateMovementRequest(balance, {
          movementType: "POSITIVE_ADJUSTMENT",
          quantity: 1,
          reason: "",
        }),
      (e: unknown) =>
        e instanceof InventoryValidationError &&
        (e.code === "ADJUSTMENT_REASON_REQUIRED" || e.code === "REASON_REQUIRED")
    );
  });

  it("10. bloqueio sem motivo falha", () => {
    assert.throws(
      () =>
        validateMovementRequest(balance, {
          movementType: "BLOCK",
          quantity: 1,
          reason: "",
        }),
      (e: unknown) => e instanceof InventoryValidationError && e.code === "REASON_REQUIRED"
    );
  });
});

describe("inventoryService — permissão e auditoria", () => {
  it("1. serviço rejeita movimento sem permissão", async () => {
    const { prisma } = createMinimalMockPrisma();
    await assert.rejects(
      () =>
        createInventoryMovement(
          prisma as never,
          {
            itemId: "item-1",
            destinationWarehouseId: "wh-1",
            movementType: "MANUAL_ENTRY",
            quantity: 1,
            unit: "UN",
            reason: "Teste",
          },
          { userId: "u1", permissions: ["inventory.view"] }
        ),
      (e: unknown) => e instanceof InventoryValidationError && e.code === "NOT_AUTHORIZED"
    );
  });

  it("11. auditoria registra movimento", async () => {
    const { prisma, state } = createMinimalMockPrisma();
    await createInventoryMovement(
      prisma as never,
      {
        itemId: "item-1",
        destinationWarehouseId: "wh-1",
        movementType: "MANUAL_ENTRY",
        quantity: 2,
        unit: "UN",
        reason: "Entrada auditável",
      },
      { userId: "user-audit", permissions: ["inventory.movements.create"] }
    );
    assert.equal(state.movements.length, 1);
    assert.equal(state.movements[0].responsibleUserId, "user-audit");
    assert.equal(state.movements[0].reason, "Entrada auditável");
    assert.equal(state.auditLogs.length, 1);
    assert.equal(state.auditLogs[0].entityType, "InventoryMovement");
  });
});

describe("inventory UI — permissões", () => {
  it("12. UI esconde ação sem permissão", () => {
    const items = read("src/components/inventory/InventoryItemsTab.tsx");
    assert.match(items, /inventory-items-no-permission/);
    assert.match(items, /canManageItems/);
    const movements = read("src/components/inventory/InventoryMovementsTab.tsx");
    assert.match(movements, /inventory-movements-no-permission/);
    const warehouses = read("src/components/inventory/InventoryWarehousesTab.tsx");
    assert.match(warehouses, /inventory-warehouses-no-permission/);
    const form = read("src/components/inventory/InventoryMovementFormSheet.tsx");
    assert.match(form, /canCreateMovementType/);
    const counts = read("src/components/inventory/InventoryCountDetailSheet.tsx");
    assert.match(counts, /canApproveCount/);
  });

  it("14. build não reintroduz Prisma no frontend de permissões", () => {
    const hook = read("src/components/inventory/inventoryPermissions.ts");
    assert.doesNotMatch(hook, /@prisma\/client/);
    assert.match(hook, /inventoryPermissionChecks/);
  });
});

describe("inventoryRoutes — permissões granulares", () => {
  it("rotas usam requireResource por faceta do contrato", () => {
    const routes = read("src/lib/inventoryRoutes.ts");
    assert.match(routes, /OPERATIONS_RESOURCE_KEYS\.inventoryItems/);
    assert.match(routes, /OPERATIONS_RESOURCE_KEYS\.inventoryWarehouses/);
    assert.match(routes, /OPERATIONS_RESOURCE_KEYS\.inventoryCounts/);
    assert.match(routes, /OPERATIONS_ACTIONS\.approve/);
    assert.doesNotMatch(routes, /inventoryMovement\.delete/);
    assert.doesNotMatch(routes, /inventoryMovement\.update/);
  });
});

function createMinimalMockPrisma() {
  const state = {
    balances: [] as Array<Record<string, unknown>>,
    movements: [] as Array<Record<string, unknown>>,
    auditLogs: [] as Array<Record<string, unknown>>,
    reservations: [] as Array<Record<string, unknown>>,
  };

  const item = {
    id: "item-1",
    status: "ACTIVE" as const,
    itemType: "RAW_MATERIAL" as const,
    unit: "UN",
    controlsStock: true,
    allowsReservation: true,
    allowsBlock: true,
    materialId: null as string | null,
    materialCodeSnapshot: null as string | null,
    materialDescriptionSnapshot: null as string | null,
    lastKnownCost: null as unknown,
    averageCost: null as unknown,
  };
  const warehouse = { id: "wh-1", status: "ACTIVE" as const, allowsMovements: true };

  const tx = {
    inventoryItem: { findUnique: async () => item },
    inventoryWarehouse: { findUnique: async () => warehouse },
    inventoryBalance: {
      findUnique: async ({ where }: { where: { id?: string } }) => {
        if (where.id) return state.balances.find((b) => b.id === where.id) ?? null;
        return null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: "bal-1", ...data };
        state.balances.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const idx = state.balances.findIndex((b) => b.id === where.id);
        state.balances[idx] = { ...state.balances[idx], ...data };
        return state.balances[idx];
      },
    },
    inventoryMovement: {
      findFirst: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `mov-${state.movements.length + 1}`, ...data };
        state.movements.push(row);
        return row;
      },
    },
    inventoryReservation: {
      create: async ({ data }: { data: Record<string, unknown> }) => ({ id: "res-1", ...data }),
      findUnique: async () => null,
      update: async () => ({}),
    },
    inventoryAuditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.auditLogs.push(data);
        return data;
      },
    },
  };

  return {
    prisma: {
      $transaction: async (fn: (inner: typeof tx) => Promise<unknown>) => fn(tx),
      inventoryAuditLog: tx.inventoryAuditLog,
    },
    state,
  };
}
