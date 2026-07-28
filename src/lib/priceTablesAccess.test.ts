import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  PRICE_TABLE_CONSUMER_PERMISSIONS,
  canConsumePriceTables,
  canGenerateCommercialPriceTables,
} from "./priceTablesAccess.ts";

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("priceTablesAccess", () => {
  it("proposals.view consome tabelas; sem bag relevante não consome", () => {
    assert.equal(
      canConsumePriceTables({
        hasPermission: (p) => p === "proposals.view",
      }),
      true
    );
    assert.equal(
      canConsumePriceTables({
        hasPermission: () => false,
      }),
      false
    );
    assert.equal(
      canConsumePriceTables({
        hasPermission: () => false,
        isSuperAdmin: () => true,
      }),
      true
    );
  });

  it("somente SUPER_ADMIN gera/publica tabelas comerciais", () => {
    assert.equal(canGenerateCommercialPriceTables({ isSuperAdmin: () => true }), true);
    assert.equal(canGenerateCommercialPriceTables({ isSuperAdmin: () => false }), false);
  });

  it("GET /api/price-tables alinha consumo com published-price; generate/publish exigem SUPER_ADMIN", () => {
    const server = read("server.ts");
    const listIdx = server.indexOf('"/api/price-tables"');
    assert.ok(listIdx >= 0);
    const listBlock = server.slice(listIdx, listIdx + 400);
    for (const perm of PRICE_TABLE_CONSUMER_PERMISSIONS) {
      assert.match(listBlock, new RegExp(perm.replace(/\./g, "\\.")));
    }
    assert.doesNotMatch(listBlock, /requireResource\("admin\.settings\.price_tables"/);

    const genIdx = server.indexOf('"/api/price-tables/:priceTableId/versions/generate-draft"');
    assert.ok(genIdx >= 0);
    assert.match(server.slice(genIdx, genIdx + 220), /requireSuperAdmin/);

    const pubIdx = server.indexOf('"/api/price-table-versions/:id/publish"');
    assert.ok(pubIdx >= 0);
    assert.match(server.slice(pubIdx, pubIdx + 220), /requireSuperAdmin/);
  });

  it("Formação de Preço e Configurações ocultam geração comercial para não-SA", () => {
    const pricing = read("src/components/PricingModule.tsx");
    const settings = read("src/components/SettingsModule.tsx");
    assert.match(pricing, /allowGenerateCommercialTables/);
    assert.match(pricing, /canGenerateCommercialPriceTables/);
    assert.match(settings, /canGenerateCommercialPriceTables/);
    assert.match(settings, /allowGenerateCommercialTables/);
  });
});
