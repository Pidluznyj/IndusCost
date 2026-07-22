import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  INVENTORY_DASHBOARD_KEYS,
  emptyInventoryDashboard,
} from "./inventory/inventoryDashboard.server.js";
import {
  parseInventoryBalancesListQuery,
  parseInventoryItemsListQuery,
} from "./inventory/inventoryListQuery.js";
import {
  parseCreateInventoryItemBody,
  parseCreateInventoryMovementBody,
  parseCreateInventoryReservationBody,
  parseCreateInventoryWarehouseBody,
} from "./inventory/inventoryValidation.js";
import { InventoryValidationError } from "./inventory/inventoryTypes.js";
import {
  INVENTORY_COUNT_MANAGE_PERMISSIONS,
  INVENTORY_ITEM_MANAGE_PERMISSIONS,
  INVENTORY_MANAGE_PERMISSIONS,
  INVENTORY_MOVEMENT_CREATE_PERMISSIONS,
  INVENTORY_RESERVATIONS_MANAGE_PERMISSIONS,
  INVENTORY_VIEW_PERMISSIONS,
  INVENTORY_WAREHOUSE_MANAGE_PERMISSIONS,
} from "./inventoryPermissions.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("inventoryRoutes", () => {
  const routes = () => read("src/lib/inventoryRoutes.ts");
  const server = () => read("server.ts");

  it("1. registrado no server", () => {
    assert.match(server(), /registerInventoryRoutes/);
  });

  it("1. GET /api/inventory/items exige auth e requireResource view", () => {
    const src = routes();
    assert.match(src, /requireAppAuth/);
    assert.match(src, /requireResource\(OPERATIONS_RESOURCE_KEYS\.inventory/);
    assert.match(src, /\/api\/inventory\/items/);
  });

  it("5. GET /api/inventory/warehouses", () => {
    assert.match(routes(), /\/api\/inventory\/warehouses/);
  });

  it("7. GET /api/inventory/balances", () => {
    assert.match(routes(), /\/api\/inventory\/balances/);
  });

  it("8. não existe endpoint para editar saldo diretamente", () => {
    const src = routes();
    assert.doesNotMatch(src, /inventoryBalance\.update/);
    assert.doesNotMatch(src, /inventoryBalance\.upsert/);
    assert.doesNotMatch(src, /PUT\s*\/api\/inventory\/balances/);
    assert.doesNotMatch(src, /PATCH\s*\/api\/inventory\/balances/);
  });

  it("9. POST /api/inventory/movements delega ao serviço", () => {
    const src = routes();
    assert.match(src, /\/api\/inventory\/movements/);
    assert.match(src, /createInventoryMovement/);
    assert.match(src, /OPERATIONS_RESOURCE_KEYS\.inventoryMovements/);
  });

  it("12. POST /api/inventory/reservations", () => {
    const src = routes();
    assert.match(src, /\/api\/inventory\/reservations/);
    assert.match(src, /OPERATIONS_RESOURCE_KEYS\.inventory/);
    assert.match(src, /OPERATIONS_ACTIONS\.manage/);
  });

  it("13. POST /api/inventory/reservations/:id/cancel", () => {
    assert.match(routes(), /\/api\/inventory\/reservations\/:id\/cancel/);
    assert.match(routes(), /cancelInventoryReservation/);
  });

  it("count-sessions — listagem e fluxo de conferência", () => {
    const src = routes();
    assert.match(src, /GET.*\/api\/inventory\/count-sessions/);
    assert.match(src, /POST.*\/api\/inventory\/count-sessions/);
    assert.match(src, /\/api\/inventory\/count-sessions\/:id\/start/);
    assert.match(src, /\/api\/inventory\/count-sessions\/:id\/finalize/);
    assert.match(src, /\/api\/inventory\/count-sessions\/:id\/approve/);
    assert.match(src, /\/api\/inventory\/count-sessions\/:id\/generate-adjustments/);
    assert.match(src, /generateInventoryCountAdjustments/);
    assert.match(src, /OPERATIONS_RESOURCE_KEYS\.inventoryCounts/);
    assert.doesNotMatch(src, /inventoryCountLine[\s\S]*inventoryBalance\.update/);
  });

  it("14. GET /api/inventory/dashboard", () => {
    assert.match(routes(), /\/api\/inventory\/dashboard/);
    assert.match(routes(), /buildInventoryDashboard/);
  });

  it("4. PATCH status de item — histórico preservado (sem delete)", () => {
    const src = routes();
    assert.match(src, /PATCH.*\/api\/inventory\/items\/:id\/status/);
    assert.doesNotMatch(src, /inventoryItem\.delete/);
    assert.doesNotMatch(src, /inventoryMovement\.delete/);
  });

  it("não retorna stack trace", () => {
    const src = routes();
    assert.doesNotMatch(src, /stack:/);
    assert.doesNotMatch(src, /res\.json\(\{[^}]*stack/);
  });

  it("permissoes de view/manage/movement/reservation definidas", () => {
    assert.deepEqual([...INVENTORY_VIEW_PERMISSIONS], ["inventory.view"]);
    assert.deepEqual([...INVENTORY_MANAGE_PERMISSIONS], ["inventory.manage"]);
    assert.deepEqual([...INVENTORY_MOVEMENT_CREATE_PERMISSIONS], [
      "inventory.movement.create",
      "inventory.movements.create",
      "inventory.manage",
    ]);
    assert.deepEqual([...INVENTORY_RESERVATIONS_MANAGE_PERMISSIONS], [
      "inventory.reservation.manage",
      "inventory.reservations.manage",
      "inventory.manage",
    ]);
    assert.ok(INVENTORY_COUNT_MANAGE_PERMISSIONS.includes("inventory.count.manage"));
    assert.ok(INVENTORY_ITEM_MANAGE_PERMISSIONS.includes("inventory.item.manage"));
    assert.ok(INVENTORY_WAREHOUSE_MANAGE_PERMISSIONS.includes("inventory.warehouse.manage"));
  });
});

describe("inventoryValidation", () => {
  it("2. cria item válido", () => {
    const item = parseCreateInventoryItemBody({
      code: "MP-001",
      description: "Parafuso M6",
      itemType: "RAW_MATERIAL",
      unit: "UN",
    });
    assert.equal(item.code, "MP-001");
    assert.equal(item.status, "ACTIVE");
    assert.equal(item.minimumStock, null);
  });

  it("3. rejeita item sem código", () => {
    assert.throws(
      () =>
        parseCreateInventoryItemBody({
          description: "Sem código",
          itemType: "RAW_MATERIAL",
          unit: "UN",
        }),
      (e: unknown) => e instanceof InventoryValidationError && e.code === "FIELD_REQUIRED"
    );
  });

  it("6. cria almoxarifado válido", () => {
    const wh = parseCreateInventoryWarehouseBody({ code: "MP", name: "Matéria-prima" });
    assert.equal(wh.code, "MP");
    assert.equal(wh.status, "ACTIVE");
    assert.equal(wh.allowsMovements, true);
  });

  it("9. cria movimento de entrada", () => {
    const m = parseCreateInventoryMovementBody({
      itemId: "00000000-0000-4000-8000-000000000001",
      movementType: "MANUAL_ENTRY",
      quantity: 10,
      reason: "Entrada inicial",
      destinationWarehouseId: "00000000-0000-4000-8000-000000000002",
    });
    assert.equal(m.movementType, "MANUAL_ENTRY");
    assert.equal(m.quantity, 10);
  });

  it("10. cria movimento de saída", () => {
    const m = parseCreateInventoryMovementBody({
      itemId: "00000000-0000-4000-8000-000000000001",
      movementType: "MANUAL_EXIT",
      quantity: 5,
      reason: "Consumo produção",
      sourceWarehouseId: "00000000-0000-4000-8000-000000000002",
      costCenterId: "00000000-0000-4000-8000-000000000003",
    });
    assert.equal(m.movementType, "MANUAL_EXIT");
  });

  it("rejeita movimento sem quantidade", () => {
    assert.throws(
      () =>
        parseCreateInventoryMovementBody({
          itemId: "x",
          movementType: "MANUAL_ENTRY",
          quantity: 0,
          reason: "teste",
        }),
      (e: unknown) => e instanceof InventoryValidationError && e.code === "INVALID_QUANTITY"
    );
  });

  it("rejeita movimento manual sem motivo", () => {
    assert.throws(
      () =>
        parseCreateInventoryMovementBody({
          itemId: "x",
          movementType: "MANUAL_ENTRY",
          quantity: 1,
          reason: "",
        }),
      (e: unknown) => e instanceof InventoryValidationError && e.code === "REASON_REQUIRED"
    );
  });

  it("12. cria reserva", () => {
    const r = parseCreateInventoryReservationBody({
      itemId: "00000000-0000-4000-8000-000000000001",
      warehouseId: "00000000-0000-4000-8000-000000000002",
      quantity: 3,
      reason: "Reserva pedido",
    });
    assert.equal(r.quantity, 3);
    assert.equal(r.reservationType, "MANUAL");
  });

  it("averageCost e estoques mínimos >= 0", () => {
    assert.throws(
      () =>
        parseCreateInventoryItemBody({
          code: "X",
          description: "Y",
          itemType: "RAW_MATERIAL",
          unit: "UN",
          averageCost: -1,
        }),
      (e: unknown) => e instanceof InventoryValidationError
    );
  });
});

describe("inventoryListQuery", () => {
  it("15. filtros não quebram com undefined", () => {
    const items = parseInventoryItemsListQuery(undefined as unknown as Record<string, unknown>);
    assert.equal(items.page, 1);
    assert.equal(items.search, "");
    assert.equal(items.belowMinimum, false);
    assert.equal(items.itemType, null);

    const balances = parseInventoryBalancesListQuery({});
    assert.equal(balances.page, 1);
    assert.equal(balances.hasReservation, false);
    assert.equal(balances.negativeStock, false);
  });
});

describe("inventoryDashboard", () => {
  it("14. dashboard retorna estrutura esperada", () => {
    const empty = emptyInventoryDashboard();
    for (const key of INVENTORY_DASHBOARD_KEYS) {
      assert.ok(key in empty, `missing key: ${key}`);
    }
    assert.equal(empty.totalInventoryValue, 0);
    assert.deepEqual(empty.recentMovements, []);
    assert.deepEqual(empty.criticalRawMaterials, []);
  });
});

describe("inventoryRoutes — imutabilidade de movimentação", () => {
  it("não expõe edição direta de InventoryMovement", () => {
    const src = read("src/lib/inventoryRoutes.ts");
    assert.doesNotMatch(src, /inventoryMovement\.update/);
    assert.doesNotMatch(src, /inventoryMovement\.delete/);
    assert.doesNotMatch(src, /PUT\s*\/api\/inventory\/movements/);
    assert.match(src, /movements\/:id\/reverse/);
  });
});

describe("permissionCatalog inventory", () => {
  it("permissionCatalog inventory", () => {
    const catalog = read("src/lib/permissionCatalog.ts");
    assert.match(catalog, /inventory\.view/);
    assert.match(catalog, /inventory\.manage/);
    assert.match(catalog, /inventory\.movements\.create/);
    assert.match(catalog, /inventory\.item\.manage/);
    assert.match(catalog, /inventory\.count\.approve/);
    assert.match(catalog, /inventory\.adjustment\.create/);
  });
});

describe("modulePermissions inventory", () => {
  it("inventory module gate", () => {
    const mod = read("src/lib/modulePermissions.ts");
    assert.match(mod, /case "inventory"/);
    assert.match(mod, /inventory\.view/);
  });
});
