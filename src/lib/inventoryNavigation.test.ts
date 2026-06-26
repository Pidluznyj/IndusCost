import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  EMPTY_INVENTORY_DASHBOARD,
  normalizeInventoryDashboard,
} from "../components/inventory/inventoryDashboardPresentation.js";
import {
  getVisibleInventoryTabs,
  INVENTORY_BASE_PATH,
  INVENTORY_TAB_DEFS,
} from "../components/inventory/inventoryNavigation.js";
import { canAccessModule } from "./modulePermissions.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

function checker(permissions: string[]) {
  const set = new Set(permissions);
  return {
    hasPermission: (p: string) => set.has(p),
    hasAnyPermission: (ps: string[]) => ps.some((p) => set.has(p)),
  };
}

describe("inventoryNavigation", () => {
  it("1. rota base /inventory", () => {
    assert.equal(INVENTORY_BASE_PATH, "/inventory");
  });

  it("1. App.tsx registra rota /inventory", () => {
    const app = read("src/App.tsx");
    assert.match(app, /path="inventory"/);
    assert.match(app, /InventoryModule/);
    assert.match(app, /Estoque \/ Almoxarifado/);
  });

  it("1. Sidebar inclui Estoque / Almoxarifado", () => {
    const sidebar = read("src/components/layout/Sidebar.tsx");
    assert.match(sidebar, /id: "inventory"/);
    assert.match(sidebar, /Warehouse/);
  });

  it("inventory.view abre módulo", () => {
    assert.equal(canAccessModule("inventory", checker(["inventory.view"])), true);
    assert.equal(canAccessModule("inventory", checker(["settings.view"])), false);
  });

  it("8. abas preparadas incluem placeholders", () => {
    const tabs = getVisibleInventoryTabs();
    assert.equal(tabs[0]?.id, "overview");
    assert.equal(tabs.some((t) => t.id === "items" && !t.comingSoon), true);
    assert.equal(tabs.some((t) => t.id === "warehouses" && !t.comingSoon), true);
    assert.equal(tabs.some((t) => t.id === "audit" && t.comingSoon), true);
    assert.equal(INVENTORY_TAB_DEFS.length, 8);
  });

  it("3. InventoryModule chama API do dashboard", () => {
    const mod = read("src/components/InventoryModule.tsx");
    assert.match(mod, /\/api\/inventory\/dashboard/);
    assert.match(mod, /fetchJsonOk/);
    assert.match(mod, /normalizeInventoryDashboard/);
  });

  it("9. frontend não importa server-only", () => {
    const mod = read("src/components/InventoryModule.tsx");
    assert.doesNotMatch(mod, /inventoryService\.server/);
    assert.doesNotMatch(mod, /inventoryDashboard\.server/);
    assert.doesNotMatch(mod, /@prisma\/client/);
    assert.doesNotMatch(mod, /lib\/prisma/);

    const dash = read("src/components/inventory/InventoryDashboardTab.tsx");
    assert.doesNotMatch(dash, /\.server/);
    assert.doesNotMatch(dash, /@prisma\/client/);
  });
});

describe("inventoryDashboardPresentation", () => {
  it("4. cards renderizam valores normalizados", () => {
    const payload = normalizeInventoryDashboard({
      totalInventoryValue: 1500.5,
      itemsCount: 12,
      belowMinimumCount: 3,
    });
    assert.equal(payload.totalInventoryValue, 1500.5);
    assert.equal(payload.itemsCount, 12);
    assert.equal(payload.belowMinimumCount, 3);
  });

  it("5. API vazia não quebra", () => {
    assert.deepEqual(normalizeInventoryDashboard(null), EMPTY_INVENTORY_DASHBOARD);
    assert.deepEqual(normalizeInventoryDashboard({}), EMPTY_INVENTORY_DASHBOARD);
    assert.equal(EMPTY_INVENTORY_DASHBOARD.recentMovements.length, 0);
  });

  it("6. payload parcial não quebra", () => {
    const payload = normalizeInventoryDashboard({
      recentMovements: [{ id: "m1", quantity: "bad" }],
      criticalRawMaterials: [{ code: "MP-1" }],
    });
    assert.equal(payload.recentMovements.length, 1);
    assert.equal(payload.recentMovements[0]?.quantity, 0);
    assert.equal(payload.criticalRawMaterials.length, 1);
    assert.equal(payload.criticalRawMaterials[0]?.code, "MP-1");
  });

  it("7. últimas movimentações normalizadas", () => {
    const payload = normalizeInventoryDashboard({
      recentMovements: [
        {
          id: "mv-1",
          itemCode: "MP-001",
          movementType: "MANUAL_ENTRY",
          quantity: 10,
          unit: "KG",
          movementDate: "2026-06-24T12:00:00.000Z",
          warehouseCode: "MP",
        },
      ],
    });
    assert.equal(payload.recentMovements[0]?.itemCode, "MP-001");
    assert.equal(payload.recentMovements[0]?.quantity, 10);
  });
});

describe("InventoryDashboardTab", () => {
  it("4. dashboard tab usa MetricCard", () => {
    const tab = read("src/components/inventory/InventoryDashboardTab.tsx");
    assert.match(tab, /MetricCardGrid/);
    assert.match(tab, /Valor total em estoque/);
    assert.match(tab, /inventory-recent-movements/);
  });

  it("7. tabela de movimentações preparada", () => {
    const tab = read("src/components/inventory/InventoryDashboardTab.tsx");
    assert.match(tab, /Últimas movimentações/);
    assert.match(tab, /itemCode/);
    assert.match(tab, /warehouseCode/);
  });
});

describe("InventoryModule estados", () => {
  it("loading, erro e sem permissão", () => {
    const mod = read("src/components/InventoryModule.tsx");
    assert.match(mod, /InventoryLoading/);
    assert.match(mod, /InventoryErrorBanner/);
    assert.match(mod, /InventoryPermissionDenied/);
    assert.match(mod, /InventoryComingSoonTab/);
  });
});
