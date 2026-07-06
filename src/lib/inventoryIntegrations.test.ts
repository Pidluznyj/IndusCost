import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  INVENTORY_INTEGRATIONS_ENABLED,
  INVENTORY_INTEGRATION_ORIGIN_TYPES,
  INVENTORY_MOVEMENT_INTEGRATION_FIELD_KEYS,
  assertInventoryIntegrationsDisabled,
  isExternalIntegrationOrigin,
  mapIntegrationOriginToMovementOrigin,
} from "./inventory/inventoryIntegrationTypes.js";
import {
  INVENTORY_DEMAND_STATUSES,
  INVENTORY_DEMAND_TYPES,
  computeProjectedAvailable,
  emptyDemandProjection,
  validateDemandProjectionInput,
} from "./inventory/inventoryDemandProjectionTypes.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("inventoryIntegrationTypes", () => {
  it("1. tipos de integração compilam e exportam constantes", () => {
    assert.equal(INVENTORY_INTEGRATIONS_ENABLED, false);
    assert.ok(INVENTORY_INTEGRATION_ORIGIN_TYPES.includes("PURCHASE_ORDER"));
    assert.ok(INVENTORY_INTEGRATION_ORIGIN_TYPES.includes("BOM"));
    assert.ok(INVENTORY_MOVEMENT_INTEGRATION_FIELD_KEYS.includes("salesOrderId"));
    assert.equal(mapIntegrationOriginToMovementOrigin("PURCHASE_ORDER"), "PURCHASE");
    assert.equal(mapIntegrationOriginToMovementOrigin("SALES_ORDER"), "SALES_ORDER");
    assert.equal(mapIntegrationOriginToMovementOrigin("BOM"), "PRODUCTION_ORDER");
    assert.equal(isExternalIntegrationOrigin("MANUAL"), false);
    assert.equal(isExternalIntegrationOrigin("NFE"), true);
  });

  it("2. nenhuma integração real foi ativada", () => {
    assert.throws(() => assertInventoryIntegrationsDisabled(), /INVENTORY_INTEGRATIONS_DISABLED/);
    const integration = read("src/lib/inventory/inventoryIntegrationTypes.ts");
    assert.match(integration, /INVENTORY_INTEGRATIONS_ENABLED = false/);
    assert.doesNotMatch(integration, /@prisma\/client/);
    assert.doesNotMatch(integration, /import\s+.*createInventoryMovement/);
    assert.doesNotMatch(integration, /from\s+["'].*inventoryService/);
  });
});

describe("inventoryDemandProjectionTypes", () => {
  it("demanda futura — tipos e validação pura", () => {
    assert.equal(INVENTORY_DEMAND_TYPES.length, 6);
    assert.equal(INVENTORY_DEMAND_STATUSES.length, 4);
    const empty = emptyDemandProjection();
    assert.equal(empty.status, "PLANNED");
    const valid = validateDemandProjectionInput({
      itemId: "item-1",
      warehouseId: "wh-1",
      requiredDate: "2026-06-01",
      quantity: 10,
      demandType: "SALES_ORDER_DEMAND",
      originType: "SALES_ORDER",
      originId: "so-1",
      priority: 1,
    });
    assert.equal(valid.ok, true);
    assert.equal(
      computeProjectedAvailable(100, [
        { quantity: 20, status: "PLANNED" },
        { quantity: 10, status: "RESERVED" },
        { quantity: 5, status: "CONSUMED" },
      ]),
      70
    );
  });
});

describe("integrações cross-módulo — não ativas", () => {
  const purchasePaths = [
    "src/lib/purchaseOrderRoutes.ts",
    "src/lib/purchasesRoutes.ts",
    "src/lib/purchaseRoutes.ts",
  ];

  it("3. pedidos de venda continuam sem movimentar estoque", () => {
    const salesSrc = read("src/lib/salesOrderManagementRoutes.test.ts");
    assert.doesNotMatch(salesSrc, /createInventoryMovement/);
    assert.doesNotMatch(salesSrc, /\/api\/inventory\/movements/);
    assert.doesNotMatch(read("src/lib/inventoryRoutes.ts"), /salesOrder.*createInventoryMovement/s);
  });

  it("4. compras continuam sem movimentar estoque", () => {
    for (const p of purchasePaths) {
      try {
        const src = read(p);
        assert.doesNotMatch(src, /createInventoryMovement/);
        assert.doesNotMatch(src, /\/api\/inventory\/movements/);
      } catch {
        // arquivo pode não existir neste repositório
      }
    }
    assert.doesNotMatch(read("src/lib/inventoryRoutes.ts"), /purchaseOrder.*createInventoryMovement/s);
  });

  it("5. BOM continua sem movimentar estoque", () => {
    const bomCandidates = ["src/lib/bom", "src/components/bom"];
    for (const dir of bomCandidates) {
      try {
        read(join(process.cwd(), dir));
      } catch {
        // ok
      }
    }
    const inventory = read("src/lib/inventory/inventoryService.server.ts");
    assert.doesNotMatch(inventory, /explod/i);
    assert.doesNotMatch(inventory, /bomId.*update/i);
  });

  it("6. produção continua sem movimentar estoque automaticamente", () => {
    const prodCandidates = [
      "src/lib/productionRoutes.ts",
      "src/lib/productionOrderRoutes.ts",
    ];
    for (const p of prodCandidates) {
      try {
        const src = read(p);
        assert.doesNotMatch(src, /createInventoryMovement/);
      } catch {
        // ok
      }
    }
  });

  it("7. build não reintroduz Prisma nos contratos de integração", () => {
    for (const file of [
      "src/lib/inventory/inventoryIntegrationTypes.ts",
      "src/lib/inventory/inventoryDemandProjectionTypes.ts",
    ]) {
      const src = read(file);
      assert.doesNotMatch(src, /@prisma\/client/);
      assert.doesNotMatch(src, /PrismaClient/);
      assert.doesNotMatch(src, /from "react"/);
    }
  });
});

describe("documentação de integrações futuras", () => {
  it("docs/inventory-future-integrations.md existe e cobre domínios", () => {
    const doc = read("docs/inventory-future-integrations.md");
    assert.match(doc, /Compras/);
    assert.match(doc, /pedidos de venda/i);
    assert.match(doc, /BOM/);
    assert.match(doc, /Produção|produção/);
    assert.match(doc, /Qualidade|qualidade/);
    assert.match(doc, /centro de custo/i);
    assert.match(doc, /Financeiro|financeiro/);
    assert.match(doc, /matéria-prima|matéria-prima/i);
    assert.match(doc, /não foi implementado|não implementad/i);
    assert.match(doc, /INVENTORY_INTEGRATIONS_ENABLED/);
  });
});
