import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { resolveInventoryTabFromPath } from "../components/inventory/inventoryNavigation.js";
import { validateClientMovement, computeMovementBalancePreview, requiresMovementCostCenter } from "../components/inventory/inventoryMovementClientRules.js";
import {
  assertNoBalanceFieldsInMovementPayload,
  createEmptyInventoryMovementForm,
  inventoryMovementFormToMovementPayload,
  validateInventoryMovementForm,
} from "../components/inventory/inventoryMovementForm.js";
import { getMovementFormFields } from "../components/inventory/inventoryMovementLabels.js";
import { normalizeInventoryMovementListResponse } from "../components/inventory/inventoryMovementPresentation.js";
import { previewMovementImpact } from "../lib/inventory/inventoryMovementRules.js";
import { emptyInventoryBalance } from "../lib/inventory/inventoryTypes.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("inventoryMovementForm", () => {
  it("2. cria entrada manual", () => {
    const payload = inventoryMovementFormToMovementPayload(
      createEmptyInventoryMovementForm({
        movementType: "MANUAL_ENTRY",
        itemId: "item-1",
        destinationWarehouseId: "wh-1",
        quantity: "10",
        reason: "Entrada inicial",
      })
    );
    assert.equal(payload.movementType, "MANUAL_ENTRY");
    assert.equal(payload.quantity, 10);
    assert.equal(payload.destinationWarehouseId, "wh-1");
    assertNoBalanceFieldsInMovementPayload(payload as Record<string, unknown>);
  });

  it("3. cria saída manual", () => {
    const payload = inventoryMovementFormToMovementPayload(
      createEmptyInventoryMovementForm({
        movementType: "MANUAL_EXIT",
        itemId: "item-1",
        sourceWarehouseId: "wh-1",
        quantity: "5",
        reason: "Consumo",
      })
    );
    assert.equal(payload.movementType, "MANUAL_EXIT");
    assert.equal(payload.sourceWarehouseId, "wh-1");
  });

  it("5. cria transferência", () => {
    const payload = inventoryMovementFormToMovementPayload(
      createEmptyInventoryMovementForm({
        movementType: "TRANSFER",
        itemId: "item-1",
        sourceWarehouseId: "wh-1",
        destinationWarehouseId: "wh-2",
        quantity: "3",
        reason: "Transferência interna",
      })
    );
    assert.equal(payload.movementType, "TRANSFER");
    assert.notEqual(payload.sourceWarehouseId, payload.destinationWarehouseId);
  });

  it("6. impede transferência para mesmo local", () => {
    const errors = validateInventoryMovementForm(
      createEmptyInventoryMovementForm({
        movementType: "TRANSFER",
        itemId: "item-1",
        sourceWarehouseId: "wh-1",
        destinationWarehouseId: "wh-1",
        quantity: "1",
        reason: "Teste",
      })
    );
    assert.ok(errors.destinationWarehouseId);
  });

  it("7. cria ajuste positivo com motivo", () => {
    const payload = inventoryMovementFormToMovementPayload(
      createEmptyInventoryMovementForm({
        movementType: "POSITIVE_ADJUSTMENT",
        itemId: "item-1",
        destinationWarehouseId: "wh-1",
        quantity: "2",
        reason: "Ajuste inventário",
      })
    );
    assert.equal(payload.movementType, "POSITIVE_ADJUSTMENT");
    assert.equal(payload.reason, "Ajuste inventário");
  });

  it("8. cria ajuste negativo com motivo", () => {
    const payload = inventoryMovementFormToMovementPayload(
      createEmptyInventoryMovementForm({
        movementType: "NEGATIVE_ADJUSTMENT",
        itemId: "item-1",
        sourceWarehouseId: "wh-1",
        quantity: "1",
        reason: "Perda identificada",
      })
    );
    assert.equal(payload.movementType, "NEGATIVE_ADJUSTMENT");
  });

  it("9. cria bloqueio", () => {
    const payload = inventoryMovementFormToMovementPayload(
      createEmptyInventoryMovementForm({
        movementType: "BLOCK",
        itemId: "item-1",
        sourceWarehouseId: "wh-1",
        quantity: "4",
        reason: "Quarentena",
      })
    );
    assert.equal(payload.movementType, "BLOCK");
  });

  it("10. cria reserva via payload de reserva", () => {
    const form = createEmptyInventoryMovementForm({
      movementType: "RESERVE",
      itemId: "item-1",
      sourceWarehouseId: "wh-1",
      quantity: "2",
      reason: "Reserva pedido",
      reservationType: "MANUAL",
    });
    assert.ok(getMovementFormFields("RESERVE").has("reservationType"));
    assert.equal(form.reservationType, "MANUAL");
  });

  it("11. exige centro de custo para suprimento administrativo", () => {
    assert.equal(requiresMovementCostCenter("MANUAL_EXIT", "ADMINISTRATIVE_SUPPLY"), true);
    const errors = validateInventoryMovementForm(
      createEmptyInventoryMovementForm({
        movementType: "MANUAL_EXIT",
        itemId: "item-1",
        sourceWarehouseId: "wh-1",
        quantity: "1",
        reason: "Saída",
      }),
      "ADMINISTRATIVE_SUPPLY"
    );
    assert.ok(errors.costCenterId);
  });

  it("quantidade deve ser > 0", () => {
    const errors = validateInventoryMovementForm(
      createEmptyInventoryMovementForm({
        itemId: "item-1",
        destinationWarehouseId: "wh-1",
        quantity: "0",
        reason: "x",
      })
    );
    assert.ok(errors.quantity);
  });
});

describe("inventoryMovementClientRules", () => {
  it("4. impede saída sem saldo", () => {
    const result = validateClientMovement(emptyInventoryBalance(), "MANUAL_EXIT", 5, {
      reason: "Saída",
      sourceWarehouseId: "wh-1",
      destinationWarehouseId: null,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /saldo/i);
  });

  it("12. exibe saldo antes/depois via preview", () => {
    const balance = { ...emptyInventoryBalance(), physicalQuantity: 20, availableQuantity: 20 };
    const preview = computeMovementBalancePreview(balance, "MANUAL_ENTRY", 10);
    assert.equal(preview.currentPhysical, 20);
    assert.equal(preview.currentAvailable, 20);
    assert.equal(preview.nextPhysical, 30);
    assert.equal(preview.nextAvailable, 30);
    assert.equal(preview.physicalDelta, 10);
  });

  it("preview delega ao motor compartilhado", () => {
    const balance = { ...emptyInventoryBalance(), physicalQuantity: 10, availableQuantity: 10 };
    const shared = previewMovementImpact(balance, "MANUAL_EXIT", 3);
    const client = computeMovementBalancePreview(balance, "MANUAL_EXIT", 3);
    assert.equal(client.nextPhysical, shared.nextBalance.physicalQuantity);
  });
});

describe("inventoryMovementPresentation", () => {
  it("1. normaliza lista de movimentações", () => {
    const list = normalizeInventoryMovementListResponse({
      rows: [
        {
          id: "m1",
          itemId: "i1",
          movementType: "MANUAL_ENTRY",
          quantity: 10,
          unit: "UN",
          reason: "Teste",
          previousAvailableBalance: 0,
          nextAvailableBalance: 10,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    });
    assert.equal(list.rows.length, 1);
    assert.equal(list.rows[0]?.movementType, "MANUAL_ENTRY");
  });

  it("lista vazia segura", () => {
    const list = normalizeInventoryMovementListResponse(null);
    assert.deepEqual(list.rows, []);
  });
});

describe("inventoryMovements UI", () => {
  it("1. InventoryMovementsTab lista via API", () => {
    const tab = read("src/components/inventory/InventoryMovementsTab.tsx");
    assert.match(tab, /\/api\/inventory\/movements/);
    assert.match(tab, /inventory-movements-table/);
  });

  it("filtros completos", () => {
    const tab = read("src/components/inventory/InventoryMovementsTab.tsx");
    assert.match(tab, /inventory-movements-filter-item/);
    assert.match(tab, /inventory-movements-filter-type/);
    assert.match(tab, /inventory-movements-filter-warehouse/);
    assert.match(tab, /inventory-movements-filter-start/);
    assert.match(tab, /inventory-movements-filter-user/);
    assert.match(tab, /inventory-movements-filter-origin/);
    assert.match(tab, /inventory-movements-filter-document/);
    assert.match(tab, /inventory-movements-filter-cost-center/);
  });

  it("13. não permite edição direta de saldo", () => {
    const tab = read("src/components/inventory/InventoryMovementsTab.tsx");
    assert.match(tab, /saldo nunca é editado diretamente/i);
    assert.doesNotMatch(tab, /physicalQuantity/);
    const sheet = read("src/components/inventory/InventoryMovementFormSheet.tsx");
    assert.match(sheet, /\/api\/inventory\/movements/);
    assert.doesNotMatch(sheet, /PUT.*balances/);
    assert.doesNotMatch(sheet, /PATCH.*balances/);
  });

  it("12. preview saldo antes/depois no formulário", () => {
    const sheet = read("src/components/inventory/InventoryMovementFormSheet.tsx");
    assert.match(sheet, /inventory-movement-preview/);
    assert.match(sheet, /Saldo físico atual/);
    assert.match(sheet, /Saldo disponível após/);
  });

  it("14. tela não quebra com erro da API", () => {
    const tab = read("src/components/inventory/InventoryMovementsTab.tsx");
    assert.match(tab, /inventory-movements-error/);
    assert.match(tab, /formatInventoryApiError/);
    const sheet = read("src/components/inventory/InventoryMovementFormSheet.tsx");
    assert.match(sheet, /inventory-movement-form-error/);
    assert.doesNotMatch(sheet, /stack/i);
  });

  it("detalhe consulta movimentação por id", () => {
    const sheet = read("src/components/inventory/InventoryMovementFormSheet.tsx");
    assert.match(sheet, /\/api\/inventory\/movements\//);
    assert.match(sheet, /inventory-movement-detail/);
  });

  it("9. sem import server-only ou Prisma", () => {
    const files = [
      "src/components/inventory/InventoryMovementsTab.tsx",
      "src/components/inventory/InventoryMovementFormSheet.tsx",
      "src/components/inventory/inventoryMovementForm.ts",
      "src/components/inventory/inventoryMovementPresentation.ts",
      "src/components/inventory/inventoryMovementClientRules.ts",
    ];
    for (const file of files) {
      const src = read(file);
      assert.doesNotMatch(src, /inventoryService\.server/);
      assert.doesNotMatch(src, /@prisma\/client/);
      assert.doesNotMatch(src, /lib\/prisma/);
    }
  });
});

describe("inventory routes movements", () => {
  it("App.tsx rota /inventory/movements", () => {
    const app = read("src/App.tsx");
    assert.match(app, /path="inventory\/movements"/);
    assert.match(app, /initialTab="movements"/);
  });

  it("aba movements ativa sem comingSoon", () => {
    const nav = read("src/components/inventory/inventoryNavigation.ts");
    const block = nav.match(/id: "movements"[\s\S]*?\n  },/)?.[0] ?? "";
    assert.doesNotMatch(block, /comingSoon: true/);
    assert.equal(resolveInventoryTabFromPath("/inventory/movements"), "movements");
  });

  it("InventoryModule renderiza aba movements", () => {
    const mod = read("src/components/InventoryModule.tsx");
    assert.match(mod, /InventoryMovementsTab/);
    assert.match(mod, /tab === "movements"/);
  });

  it("GET /api/inventory/movements global", () => {
    const routes = read("src/lib/inventoryRoutes.ts");
    assert.match(routes, /app\.get\("\/api\/inventory\/movements"/);
    assert.match(routes, /app\.get\("\/api\/inventory\/movements\/:id"/);
  });
});
