import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("inventory official material link — APIs e proteção", () => {
  it("rotas de pesquisa e vínculo usam permissão de items", () => {
    const routes = read("src/lib/inventoryRoutes.ts");
    assert.match(routes, /\/api\/inventory\/official-materials/);
    assert.match(routes, /\/api\/inventory\/items\/link-material/);
    assert.match(routes, /\/api\/inventory\/items\/:id\/material-link/);
    assert.match(routes, /searchOfficialMaterialsForInventory/);
    assert.match(routes, /linkOfficialMaterialToStockControl/);
    assert.match(routes, /OFFICIAL_MATERIAL_FIELDS_READONLY/);
  });

  it("serviço lê MP só via createOfficialDataProviders", () => {
    const service = read("src/lib/inventory/inventoryMaterialLinkService.server.ts");
    assert.match(service, /createOfficialDataProviders/);
    assert.match(service, /providers\.materials\.(findById|list)/);
    assert.doesNotMatch(service, /prisma\.material\.(create|update|delete|upsert)/);
    assert.doesNotMatch(service, /material\.create\(/);
  });

  it("migration aditiva com unicidade de MP ativa", () => {
    const migration = read(
      "prisma/migrations/20260804140000_inventory_official_material_link/migration.sql"
    );
    assert.doesNotMatch(migration, /\bDROP\s+TABLE\b/i);
    assert.doesNotMatch(migration, /ALTER TABLE "Material"/);
    assert.match(migration, /InventoryItem_materialId_active_key/);
    assert.match(migration, /safetyStock/);
    assert.match(migration, /controlsStock/);
    assert.match(migration, /allowsReservation/);
    assert.match(migration, /allowsBlock/);
    assert.match(migration, /materialCodeSnapshot/);
    assert.match(migration, /defaultWarehouseId/);
  });

  it("schema InventoryItem guarda vínculo e snapshots, sem mutar Material fields", () => {
    const schema = read("prisma/schema.prisma");
    const item = schema.match(/model InventoryItem \{[\s\S]*?\n\}/m);
    assert.ok(item);
    assert.match(item[0], /materialId/);
    assert.match(item[0], /materialCodeSnapshot/);
    assert.match(item[0], /safetyStock/);
    assert.match(item[0], /controlsStock/);
    assert.match(item[0], /allowsReservation/);
    assert.match(item[0], /allowsBlock/);
    assert.match(item[0], /defaultWarehouseId/);
    assert.match(item[0], /defaultLocationId/);

    const material = schema.match(/model Material \{[\s\S]*?\n\}/m);
    assert.ok(material);
    assert.match(material[0], /InventoryItem\s+InventoryItem\[\]/);
    assert.doesNotMatch(material[0], /controlsStock|safetyStock|defaultWarehouseId/);
  });

  it("UI de vínculo e pesquisa existem sem edição de cadastro oficial", () => {
    const sheet = read("src/components/inventory/InventoryMaterialLinkSheet.tsx");
    assert.match(sheet, /\/api\/inventory\/official-materials/);
    assert.match(sheet, /\/api\/inventory\/items\/link-material/);
    assert.match(sheet, /somente leitura|Somente leitura|read-only|não cria nem edita/i);
    assert.doesNotMatch(sheet, /POST.*\/api\/materials|PUT.*\/api\/materials/);

    const tab = read("src/components/inventory/InventoryItemsTab.tsx");
    assert.match(tab, /InventoryMaterialLinkSheet/);
    assert.match(tab, /inventory-items-link-material/);
  });
});
