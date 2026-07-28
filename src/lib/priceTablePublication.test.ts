import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  calculatePriceTableItemFromFrozenCost,
  DEFAULT_COMMERCIAL_GENERATION_FREIGHT_PERCENT,
  normalizePricingPercentInput,
} from "./priceTablePublication.js";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("calculatePriceTableItemFromFrozenCost — frete % no denominador", () => {
  it("margens padrão 30/40/50/60 com frete 3% e comissões 2/3", () => {
    const cases = [
      { margin: 0.3, commission: 0.02 },
      { margin: 0.4, commission: 0.03 },
      { margin: 0.5, commission: 0.02 },
      { margin: 0.6, commission: 0.03 },
    ];
    for (const c of cases) {
      const r = calculatePriceTableItemFromFrozenCost(100, {
        taxRate: 0,
        commissionRate: c.commission,
        otherRate: 0,
        marginRate: c.margin,
        freight: 0,
        freightRate: 0.03,
      });
      assert.equal(r.ok, true);
      if (!r.ok) continue;
      const expected = 100 / (1 - c.commission - 0.03 - c.margin);
      assert.ok(Math.abs(r.result.salePrice - expected) < 1e-9);
    }
  });

  it("margens 35/42 mantêm comissão 2%/3% e aceitam frete 4,5% e 0%", () => {
    const a = calculatePriceTableItemFromFrozenCost(100, {
      taxRate: 0,
      commissionRate: 0.02,
      otherRate: 0,
      marginRate: 0.35,
      freight: 0,
      freightRate: 0.045,
    });
    assert.equal(a.ok, true);
    if (a.ok) {
      assert.ok(Math.abs(a.result.salePrice - 100 / (1 - 0.02 - 0.045 - 0.35)) < 1e-9);
      assert.ok(Math.abs(a.result.totalCommission - a.result.salePrice * 0.02) < 1e-9);
    }

    const b = calculatePriceTableItemFromFrozenCost(100, {
      taxRate: 0,
      commissionRate: 0.03,
      otherRate: 0,
      marginRate: 0.42,
      freight: 0,
      freightRate: 0,
    });
    assert.equal(b.ok, true);
    if (b.ok) {
      assert.ok(Math.abs(b.result.salePrice - 100 / (1 - 0.03 - 0.42)) < 1e-9);
    }
  });

  it("bloqueia soma >= 100% e aceita casas decimais", () => {
    const bad = calculatePriceTableItemFromFrozenCost(100, {
      taxRate: 0.1,
      commissionRate: 0.2,
      otherRate: 0,
      marginRate: 0.5,
      freight: 0,
      freightRate: 0.2,
    });
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.equal(bad.code, "INVALID_PRICING_DIVISOR");

    const ok = calculatePriceTableItemFromFrozenCost(123.456, {
      taxRate: 0.1125,
      commissionRate: 0.025,
      otherRate: 0.01,
      marginRate: 0.3333,
      freight: 0,
      freightRate: 0.0325,
    });
    assert.equal(ok.ok, true);
  });

  it("legado com frete absoluto no numerador continua válido sem freightRate", () => {
    const r = calculatePriceTableItemFromFrozenCost(100, {
      taxRate: 0.1,
      commissionRate: 0.05,
      otherRate: 0,
      marginRate: 0.3,
      freight: 10,
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.ok(Math.abs(r.result.salePrice - 110 / (1 - 0.1 - 0.05 - 0.3)) < 1e-9);
    }
  });

  it("default frete comercial é 3%", () => {
    assert.equal(DEFAULT_COMMERCIAL_GENERATION_FREIGHT_PERCENT, 3);
    assert.equal(normalizePricingPercentInput("4,5", "Frete").ok, true);
    assert.equal(normalizePricingPercentInput(-1, "Frete").ok, false);
  });
});

describe("price table draft generation wiring", () => {
  it("API preview-draft e generate-draft exigem Super Admin e aceitam margem/frete", () => {
    const server = read("server.ts");
    assert.match(server, /\/versions\/preview-draft/);
    assert.match(server, /parsePriceTableDraftGenerationBody/);
    assert.match(server, /hasFreightOverride/);
    assert.match(server, /hasMarginOverride/);
    assert.match(server, /requireSuperAdmin/);
  });

  it("UI Formação de Preço expõe margem, frete e preview", () => {
    const mod = read("src/components/PricingModule.tsx");
    assert.match(mod, /commercial-gen-freight-percent/);
    assert.match(mod, /commercial-gen-preview-btn/);
    assert.match(mod, /handlePreviewCommercialDrafts/);
    assert.match(mod, /marginPct:/);
    assert.match(mod, /freightPercent:/);
    assert.match(mod, /Os percentuais informados serão utilizados apenas na nova versão/);
  });

  it("migration adiciona targetMarginPercent e freightPercent", () => {
    const mig = read(
      "prisma/migrations/20260727190000_price_table_version_margin_freight/migration.sql"
    );
    assert.match(mig, /targetMarginPercent/);
    assert.match(mig, /freightPercent/);
    const schema = read("prisma/schema.prisma");
    assert.match(schema, /targetMarginPercent/);
    assert.match(schema, /freightPercent/);
  });
});
