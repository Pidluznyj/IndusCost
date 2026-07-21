import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  createEmptyInventoryLocationForm,
  inventoryLocationFormToPayload,
  validateInventoryLocationForm,
  formatInventoryLocationType,
  normalizeInventoryLocationListResponse,
} from "../components/inventory/inventoryLocationForm.js";
import { resolveInventoryTabFromPath } from "../components/inventory/inventoryNavigation.js";
import {
  parseCreateInventoryLocationBody,
  parseUpdateInventoryLocationBody,
} from "./inventory/inventoryValidation.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("inventoryLocations — formulário e validação", () => {
  it("cria payload de local com tipo e endereço", () => {
    const payload = inventoryLocationFormToPayload(
      createEmptyInventoryLocationForm({
        code: "c1-e2",
        name: "Corredor 1 Estante 2",
        locationType: "QUARANTINE",
        isDefault: true,
        aisle: "C1",
        shelf: "E2",
        position: "01",
      })
    );
    assert.equal(payload.code, "c1-e2");
    assert.equal(payload.locationType, "QUARANTINE");
    assert.equal(payload.isDefault, true);
    assert.equal(payload.aisle, "C1");
    assert.equal(payload.position, "01");
  });

  it("valida campos obrigatórios no formulário", () => {
    const errors = validateInventoryLocationForm(createEmptyInventoryLocationForm());
    assert.ok(errors.code);
    assert.ok(errors.name);
  });

  it("parseia body de API", () => {
    const created = parseCreateInventoryLocationBody({
      code: "P1",
      name: "Produção",
      locationType: "PRODUCTION",
      isDefault: "true",
      aisle: "A",
    });
    assert.equal(created.locationType, "PRODUCTION");
    assert.equal(created.isDefault, true);
    const patched = parseUpdateInventoryLocationBody({ status: "INACTIVE", isDefault: false });
    assert.equal(patched.status, "INACTIVE");
    assert.equal(patched.isDefault, false);
  });

  it("normaliza lista de locais", () => {
    const list = normalizeInventoryLocationListResponse({
      rows: [
        {
          id: "1",
          warehouseId: "w1",
          code: "L1",
          name: "Local 1",
          status: "ACTIVE",
          locationType: "PHYSICAL",
          isDefault: true,
        },
      ],
      total: 1,
    });
    assert.equal(list.rows.length, 1);
    assert.equal(list.rows[0]?.isDefault, true);
    assert.equal(formatInventoryLocationType("QUARANTINE"), "Quarentena");
  });
});

describe("inventoryLocations — rotas e UI", () => {
  it("registra rotas de locais sob warehouses", () => {
    const routes = read("src/lib/inventoryRoutes.ts");
    assert.match(routes, /\/api\/inventory\/warehouses\/:warehouseId\/locations/);
    assert.match(routes, /locations\/:locationId\/status/);
    assert.doesNotMatch(routes, /inventoryLocation\.delete/);
    assert.match(routes, /assertWarehouseCanBeDeactivated/);
  });

  it("painel de locais no detalhe do almoxarifado", () => {
    const sheet = read("src/components/inventory/InventoryWarehouseDetailSheet.tsx");
    assert.match(sheet, /InventoryWarehouseLocationsPanel/);
    const panel = read("src/components/inventory/InventoryWarehouseLocationsPanel.tsx");
    assert.match(panel, /inventory-warehouse-locations/);
    assert.match(panel, /Inativar/);
    assert.doesNotMatch(panel, /Excluir|DELETE/);
  });

  it("aba warehouses resolve path", () => {
    assert.equal(resolveInventoryTabFromPath("/inventory/warehouses"), "warehouses");
  });

  it("casca SC aponta para estoque com flag OP-05", () => {
    const shell = read("src/components/supply-chain/SupplyChainModuleShell.tsx");
    assert.match(shell, /\/inventory\//);
    assert.match(shell, /SUPPLY_CHAIN_INVENTORY_MODULE_ENABLED/);
  });

  it("schema aditivo cobre tipo, padrão e endereçamento", () => {
    const schema = read("prisma/schema.prisma");
    assert.match(schema, /enum InventoryLocationType/);
    assert.match(schema, /isDefault/);
    assert.match(schema, /parentLocationId/);
    assert.match(schema, /\baisle\b/);
    assert.match(schema, /\bshelf\b/);
    assert.match(schema, /\bposition\b/);
    const migration = read(
      "prisma/migrations/20260804130000_inventory_locations_hierarchy/migration.sql"
    );
    assert.doesNotMatch(migration, /\bDROP\s+TABLE\b/i);
    assert.match(migration, /InventoryLocation_warehouse_default_active_key/);
  });
});
