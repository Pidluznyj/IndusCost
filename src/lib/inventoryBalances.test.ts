import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { resolveInventoryTabFromPath } from "../components/inventory/inventoryNavigation.js";
import {
  EMPTY_BALANCE_LIST_SUMMARY,
  normalizeInventoryBalanceListResponse,
  normalizeInventoryBalanceListRow,
} from "../components/inventory/inventoryBalancePresentation.js";
import { inventoryOperationalStatusClassName } from "../components/inventory/inventoryUi.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("inventoryBalancePresentation", () => {
  it("1. normaliza lista de saldos", () => {
    const list = normalizeInventoryBalanceListResponse({
      rows: [
        {
          id: "b1",
          itemId: "i1",
          warehouseId: "w1",
          balanceKey: "w1",
          physicalQuantity: 10,
          reservedQuantity: 1,
          blockedQuantity: 0,
          quarantineQuantity: 0,
          availableQuantity: 9,
          averageCost: 5,
          totalValue: 50,
          lastMovementAt: "2026-06-24T12:00:00.000Z",
          updatedAt: "2026-06-24T12:00:00.000Z",
          item: {
            code: "MP-001",
            description: "Aço",
            itemType: "RAW_MATERIAL",
            status: "ACTIVE",
            unit: "KG",
            minimumStock: 20,
            reorderPoint: 30,
          },
          warehouse: { code: "MP", name: "Matéria-prima", status: "ACTIVE" },
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
      summary: {
        filteredItemsCount: 1,
        filteredRowsCount: 1,
        totalInventoryValue: 50,
        criticalCount: 1,
        belowMinimumCount: 1,
        negativeCount: 0,
      },
    });
    assert.equal(list.rows.length, 1);
    assert.equal(list.rows[0]?.itemCode, "MP-001");
    assert.equal(list.rows[0]?.operationalStatus, "CRITICAL");
    assert.equal(list.summary.totalInventoryValue, 50);
  });

  it("12. saldo vazio não quebra", () => {
    const list = normalizeInventoryBalanceListResponse(null);
    assert.deepEqual(list.rows, []);
    assert.deepEqual(list.summary, EMPTY_BALANCE_LIST_SUMMARY);
    assert.equal(normalizeInventoryBalanceListRow(null), null);
  });

  it("7. status operacional calculado", () => {
    const row = normalizeInventoryBalanceListRow({
      id: "b2",
      itemId: "i2",
      warehouseId: "w1",
      balanceKey: "w1",
      physicalQuantity: -1,
      reservedQuantity: 0,
      blockedQuantity: 0,
      quarantineQuantity: 0,
      availableQuantity: -1,
      item: { code: "X", description: "Y", itemType: "RAW_MATERIAL", status: "ACTIVE", unit: "UN" },
      warehouse: { code: "MP", name: "MP", status: "ACTIVE" },
    });
    assert.equal(row?.operationalStatus, "NEGATIVE");
  });
});

describe("inventoryOperationalStatusBadge", () => {
  it("7. estilos visuais por status", () => {
    assert.match(inventoryOperationalStatusClassName("OK"), /emerald/);
    assert.match(inventoryOperationalStatusClassName("ATTENTION"), /amber/);
    assert.match(inventoryOperationalStatusClassName("CRITICAL"), /orange/);
    assert.match(inventoryOperationalStatusClassName("OUT_OF_STOCK"), /red/);
    assert.match(inventoryOperationalStatusClassName("NEGATIVE"), /red/);
    assert.match(inventoryOperationalStatusClassName("BLOCKED"), /slate/);
    assert.match(inventoryOperationalStatusClassName("QUARANTINE"), /violet/);
  });
});

describe("inventoryBalances UI", () => {
  it("1. InventoryBalancesTab consulta via API", () => {
    const tab = read("src/components/inventory/InventoryBalancesTab.tsx");
    assert.match(tab, /\/api\/inventory\/balances/);
    assert.match(tab, /inventory-balances-table/);
  });

  it("2. filtro por item", () => {
    assert.match(read("src/components/inventory/InventoryBalancesTab.tsx"), /inventory-balances-filter-item/);
  });

  it("3. filtro por tipo", () => {
    assert.match(read("src/components/inventory/InventoryBalancesTab.tsx"), /inventory-balances-filter-type/);
  });

  it("4. filtro por almoxarifado", () => {
    assert.match(read("src/components/inventory/InventoryBalancesTab.tsx"), /inventory-balances-filter-warehouse/);
  });

  it("5. filtro abaixo do mínimo", () => {
    assert.match(read("src/components/inventory/InventoryBalancesTab.tsx"), /inventory-balances-filter-below-minimum/);
  });

  it("6. filtro saldo negativo", () => {
    assert.match(read("src/components/inventory/InventoryBalancesTab.tsx"), /inventory-balances-filter-negative/);
  });

  it("8. detalhe do item abre", () => {
    const tab = read("src/components/inventory/InventoryBalancesTab.tsx");
    assert.match(tab, /InventoryBalanceItemDetailSheet/);
    const detail = read("src/components/inventory/InventoryBalanceItemDetailSheet.tsx");
    assert.match(detail, /inventory-balance-item-detail/);
  });

  it("9. detalhe mostra histórico", () => {
    const detail = read("src/components/inventory/InventoryBalanceItemDetailSheet.tsx");
    assert.match(detail, /inventory-balance-item-movements/);
    assert.match(detail, /\/api\/inventory\/items\/\$\{itemId\}\/movements/);
  });

  it("10. detalhe não permite editar saldo", () => {
    const detail = read("src/components/inventory/InventoryBalanceItemDetailSheet.tsx");
    assert.doesNotMatch(detail, /PUT.*balances/);
    assert.doesNotMatch(detail, /PATCH.*balances/);
    assert.match(detail, /movimenta/);
  });

  it("11. botão nova movimentação com item preenchido", () => {
    const detail = read("src/components/inventory/InventoryBalanceItemDetailSheet.tsx");
    assert.match(detail, /inventory-balance-new-movement/);
    const tab = read("src/components/inventory/InventoryBalancesTab.tsx");
    assert.match(tab, /initialItemId/);
    const sheet = read("src/components/inventory/InventoryMovementFormSheet.tsx");
    assert.match(sheet, /initialItemId/);
  });

  it("totalizadores no topo", () => {
    assert.match(read("src/components/inventory/InventoryBalancesTab.tsx"), /inventory-balances-summary/);
  });

  it("13. sem import server-only ou Prisma", () => {
    const files = [
      "src/components/inventory/InventoryBalancesTab.tsx",
      "src/components/inventory/InventoryBalanceItemDetailSheet.tsx",
      "src/components/inventory/inventoryBalancePresentation.ts",
    ];
    for (const file of files) {
      const src = read(file);
      assert.doesNotMatch(src, /@prisma\/client/);
      assert.doesNotMatch(src, /lib\/prisma/);
      assert.doesNotMatch(src, /inventoryService\.server/);
    }
  });
});

describe("inventory routes balances", () => {
  it("App.tsx rota /inventory/balances", () => {
    const app = read("src/App.tsx");
    assert.match(app, /path="inventory\/balances"/);
    assert.match(app, /initialTab="balances"/);
  });

  it("aba balances ativa sem comingSoon", () => {
    const nav = read("src/components/inventory/inventoryNavigation.ts");
    const block = nav.match(/id: "balances"[\s\S]*?\n  },/)?.[0] ?? "";
    assert.doesNotMatch(block, /comingSoon: true/);
    assert.equal(resolveInventoryTabFromPath("/inventory/balances"), "balances");
  });

  it("App.tsx rotas reservations e audit", () => {
    const app = read("src/App.tsx");
    assert.match(app, /path="inventory\/reservations"/);
    assert.match(app, /path="inventory\/audit"/);
    assert.equal(resolveInventoryTabFromPath("/inventory/reservations"), "reservations");
    assert.equal(resolveInventoryTabFromPath("/inventory/audit"), "audit");
  });

  it("InventoryBalancesTab filtra local e exibe mínimo/segurança", () => {
    const tab = read("src/components/inventory/InventoryBalancesTab.tsx");
    assert.match(tab, /locationId/);
    assert.match(tab, /minimumStock/);
    assert.match(tab, /safetyStock/);
    assert.match(tab, /inventory-balances-alerts/);
  });

  it("InventoryModule renderiza aba balances", () => {
    const mod = read("src/components/InventoryModule.tsx");
    assert.match(mod, /InventoryBalancesTab/);
    assert.match(mod, /tab === "balances"/);
  });

  it("API retorna summary", () => {
    const routes = read("src/lib/inventoryRoutes.ts");
    assert.match(routes, /buildBalancesListSummary/);
    assert.match(routes, /summary,/);
  });
});
