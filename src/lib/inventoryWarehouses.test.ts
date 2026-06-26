import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { resolveInventoryTabFromPath } from "../components/inventory/inventoryNavigation.js";
import {
  createEmptyInventoryWarehouseForm,
  inventoryWarehouseFormToPayload,
  validateInventoryWarehouseForm,
} from "../components/inventory/inventoryWarehouseForm.js";
import { formatInventoryWarehouseStatus } from "../components/inventory/inventoryWarehouseLabels.js";
import {
  filterWarehousesForMovement,
  isWarehouseSelectableForMovement,
} from "../components/inventory/inventoryWarehouseMovementPolicy.js";
import {
  buildWarehouseSummaryFromBalances,
  EMPTY_WAREHOUSE_SUMMARY,
  normalizeInventoryWarehouseListResponse,
} from "../components/inventory/inventoryWarehousePresentation.js";
import type { InventoryWarehouseRow } from "../types/inventory.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function sampleWarehouse(overrides: Partial<InventoryWarehouseRow> = {}): InventoryWarehouseRow {
  return {
    id: "wh-1",
    code: "MP",
    name: "Matéria-prima",
    description: null,
    status: "ACTIVE",
    allowsMovements: true,
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

describe("inventoryWarehouseForm", () => {
  it("2. cria almoxarifado", () => {
    const payload = inventoryWarehouseFormToPayload(
      createEmptyInventoryWarehouseForm({
        code: "MP",
        name: "Matéria-prima",
        description: "Almoxarifado principal",
      })
    );
    assert.equal(payload.code, "MP");
    assert.equal(payload.name, "Matéria-prima");
    assert.equal(payload.status, "ACTIVE");
    assert.equal(payload.allowsMovements, true);
  });

  it("3. edita almoxarifado", () => {
    const payload = inventoryWarehouseFormToPayload(
      createEmptyInventoryWarehouseForm({
        code: "PA",
        name: "Produto acabado",
        description: "Atualizado",
        allowsMovements: false,
      })
    );
    assert.equal(payload.code, "PA");
    assert.equal(payload.allowsMovements, false);
    assert.equal(payload.description, "Atualizado");
  });

  it("valida campos obrigatórios", () => {
    const errors = validateInventoryWarehouseForm(createEmptyInventoryWarehouseForm());
    assert.ok(errors.code);
    assert.ok(errors.name);
  });
});

describe("inventoryWarehousePresentation", () => {
  it("1. normaliza lista de almoxarifados", () => {
    const list = normalizeInventoryWarehouseListResponse({
      rows: [{ id: "1", code: "MP", name: "Matéria-prima", status: "ACTIVE", allowsMovements: true }],
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    });
    assert.equal(list.rows.length, 1);
    assert.equal(list.rows[0]?.code, "MP");
  });

  it("8. almoxarifado sem saldo não quebra resumo", () => {
    assert.deepEqual(EMPTY_WAREHOUSE_SUMMARY.itemsCount, 0);
    assert.equal(EMPTY_WAREHOUSE_SUMMARY.hasBalances, false);
    const summary = buildWarehouseSummaryFromBalances([]);
    assert.equal(summary.itemsCount, 0);
    assert.equal(summary.totalInventoryValue, 0);
    assert.equal(summary.criticalItems.length, 0);
  });

  it("lista vazia segura", () => {
    const list = normalizeInventoryWarehouseListResponse(null);
    assert.deepEqual(list.rows, []);
    assert.equal(list.total, 0);
  });
});

describe("inventoryWarehouseMovementPolicy", () => {
  it("5. local inativo aparece como inativo na política", () => {
    const inactive = sampleWarehouse({ status: "INACTIVE" });
    assert.equal(isWarehouseSelectableForMovement(inactive), false);
    assert.equal(formatInventoryWarehouseStatus("INACTIVE"), "Inativo");
  });

  it("6. local inativo não elegível para nova movimentação", () => {
    const active = sampleWarehouse();
    const inactive = sampleWarehouse({ id: "wh-2", status: "INACTIVE" });
    const noMovements = sampleWarehouse({ id: "wh-3", allowsMovements: false });

    assert.equal(isWarehouseSelectableForMovement(active), true);
    assert.equal(isWarehouseSelectableForMovement(inactive), false);
    assert.equal(isWarehouseSelectableForMovement(noMovements), false);

    const eligible = filterWarehousesForMovement([active, inactive, noMovements]);
    assert.equal(eligible.length, 1);
    assert.equal(eligible[0]?.id, "wh-1");
  });
});

describe("inventoryWarehouses UI", () => {
  it("1. InventoryWarehousesTab lista via API", () => {
    const tab = read("src/components/inventory/InventoryWarehousesTab.tsx");
    assert.match(tab, /\/api\/inventory\/warehouses/);
    assert.match(tab, /inventory-warehouses-table/);
  });

  it("filtros: busca, status e permite movimentações", () => {
    const tab = read("src/components/inventory/InventoryWarehousesTab.tsx");
    assert.match(tab, /inventory-warehouses-search/);
    assert.match(tab, /inventory-warehouses-filter-status/);
    assert.match(tab, /inventory-warehouses-filter-movements/);
    assert.match(tab, /allowsMovements/);
  });

  it("4. inativação via PATCH status", () => {
    const sheet = read("src/components/inventory/InventoryWarehouseDetailSheet.tsx");
    assert.match(sheet, /\/status/);
    assert.match(sheet, /INACTIVE/);
    assert.doesNotMatch(sheet, /DELETE/);
    assert.doesNotMatch(sheet, /\.delete\(/);
  });

  it("7. histórico preservado — sem exclusão física", () => {
    const routes = read("src/lib/inventoryRoutes.ts");
    assert.doesNotMatch(routes, /inventoryWarehouse\.delete/);
    const sheet = read("src/components/inventory/InventoryWarehouseDetailSheet.tsx");
    assert.doesNotMatch(sheet, /DELETE/);
  });

  it("sugestões visuais sem seed automático", () => {
    const tab = read("src/components/inventory/InventoryWarehousesTab.tsx");
    assert.match(tab, /SUGGESTED_INVENTORY_WAREHOUSES/);
    assert.doesNotMatch(tab, /seed/i);
    assert.doesNotMatch(tab, /bulkCreate/i);
  });

  it("detalhe consulta saldos por almoxarifado", () => {
    const sheet = read("src/components/inventory/InventoryWarehouseDetailSheet.tsx");
    assert.match(sheet, /\/api\/inventory\/balances/);
    assert.match(sheet, /warehouseId/);
    assert.match(sheet, /inventory-warehouse-summary/);
  });

  it("9. sem import server-only ou Prisma", () => {
    const files = [
      "src/components/inventory/InventoryWarehousesTab.tsx",
      "src/components/inventory/InventoryWarehouseDetailSheet.tsx",
      "src/components/inventory/inventoryWarehouseForm.ts",
      "src/components/inventory/inventoryWarehousePresentation.ts",
      "src/components/inventory/inventoryWarehouseMovementPolicy.ts",
    ];
    for (const file of files) {
      const src = read(file);
      assert.doesNotMatch(src, /inventoryService\.server/);
      assert.doesNotMatch(src, /@prisma\/client/);
      assert.doesNotMatch(src, /lib\/prisma/);
      assert.doesNotMatch(src, /PrismaClient/);
    }
  });
});

describe("inventory routes warehouses", () => {
  it("App.tsx rota /inventory/warehouses", () => {
    const app = read("src/App.tsx");
    assert.match(app, /path="inventory\/warehouses"/);
    assert.match(app, /initialTab="warehouses"/);
  });

  it("aba warehouses ativa sem comingSoon", () => {
    const nav = read("src/components/inventory/inventoryNavigation.ts");
    const block = nav.match(/id: "warehouses"[\s\S]*?\n  },/)?.[0] ?? "";
    assert.match(block, /id: "warehouses"/);
    assert.doesNotMatch(block, /comingSoon: true/);
    assert.equal(resolveInventoryTabFromPath("/inventory/warehouses"), "warehouses");
  });

  it("InventoryModule renderiza aba warehouses", () => {
    const mod = read("src/components/InventoryModule.tsx");
    assert.match(mod, /InventoryWarehousesTab/);
    assert.match(mod, /tab === "warehouses"/);
    assert.match(mod, /\/inventory\/warehouses/);
  });

  it("GET warehouses filtra allowsMovements", () => {
    const routes = read("src/lib/inventoryRoutes.ts");
    assert.match(routes, /allowsMovementsQ/);
  });
});
