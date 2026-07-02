import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  interpolateCommercialTierRate,
  resolveCommercialPriceTier,
  resolveSoldUnitNetPrice,
  roundRatePercent,
  validateCommercialTierPriceOrder,
  type CommercialPriceTierRow,
} from "./commission-commercial-tier.js";
import { computeCommissionAmount } from "./commission-money.js";

function sampleTiers(): CommercialPriceTierRow[] {
  return [
    { code: "ATACADO", name: "Atacado", salePrice: 10, commissionPercent: 1 },
    { code: "VAREJO_1", name: "Varejo 1", salePrice: 12, commissionPercent: 2 },
    { code: "VAREJO_2", name: "Varejo 2", salePrice: 14, commissionPercent: 3 },
    { code: "VAREJO_3", name: "Varejo 3", salePrice: 16, commissionPercent: 4 },
  ];
}

function esmaltecTiers(): CommercialPriceTierRow[] {
  return [
    { code: "ATACADO", name: "Atacado", salePrice: 3.043697, commissionPercent: 1 },
    { code: "VAREJO_1", name: "Varejo 1", salePrice: 4.132499, commissionPercent: 2 },
    { code: "VAREJO_2", name: "Varejo 2", salePrice: 5, commissionPercent: 3 },
    { code: "VAREJO_3", name: "Varejo 3", salePrice: 6, commissionPercent: 4 },
  ];
}

describe("commission-commercial-tier — interpolação proporcional", () => {
  it("preço abaixo do Atacado: 1%, flag fora da tabela, não bloqueia", () => {
    const result = resolveCommercialPriceTier({ soldUnitPrice: 9.5, tiers: sampleTiers() });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.tierCode, "PRECO_FORA_DA_TABELA");
      assert.equal(result.ratePercent, 1);
      assert.equal(result.outOfTablePrice, true);
      assert.equal(result.calculationType, "COMMERCIAL_PRICE_TIER");
    }
  });

  it("preço igual ao Atacado retorna exatamente 1%", () => {
    const result = resolveCommercialPriceTier({ soldUnitPrice: 10, tiers: sampleTiers() });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.ratePercent, 1);
      assert.equal(result.tierCode, "ATACADO");
      assert.equal(result.calculationType, "COMMERCIAL_PRICE_TIER_INTERPOLATED");
      assert.equal(result.interpolation?.interpolationProgress, 0);
    }
  });

  it("preço entre Atacado e Varejo 1 interpola entre 1% e 2%", () => {
    const result = resolveCommercialPriceTier({ soldUnitPrice: 11, tiers: sampleTiers() });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.tierCode, "ATACADO");
      assert.ok(result.ratePercent > 1 && result.ratePercent < 2);
      assert.equal(result.calculationType, "COMMERCIAL_PRICE_TIER_INTERPOLATED");
      assert.equal(result.interpolation?.fromRatePercent, 1);
      assert.equal(result.interpolation?.toRatePercent, 2);
    }
  });

  it("preço igual ao Varejo 1 retorna exatamente 2%", () => {
    const result = resolveCommercialPriceTier({ soldUnitPrice: 12, tiers: sampleTiers() });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.ratePercent, 2);
  });

  it("preço entre Varejo 1 e Varejo 2 interpola entre 2% e 3%", () => {
    const result = resolveCommercialPriceTier({ soldUnitPrice: 13, tiers: sampleTiers() });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.tierCode, "VAREJO_1");
      assert.ok(result.ratePercent > 2 && result.ratePercent < 3);
    }
  });

  it("preço igual ao Varejo 2 retorna exatamente 3%", () => {
    const result = resolveCommercialPriceTier({ soldUnitPrice: 14, tiers: sampleTiers() });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.ratePercent, 3);
  });

  it("preço entre Varejo 2 e Varejo 3 interpola entre 3% e 4%", () => {
    const result = resolveCommercialPriceTier({ soldUnitPrice: 15, tiers: sampleTiers() });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.tierCode, "VAREJO_2");
      assert.ok(result.ratePercent > 3 && result.ratePercent < 4);
    }
  });

  it("preço igual ou acima do Varejo 3 retorna 4% (teto)", () => {
    for (const price of [16, 20]) {
      const result = resolveCommercialPriceTier({ soldUnitPrice: price, tiers: sampleTiers() });
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.tierCode, "VAREJO_3");
        assert.equal(result.ratePercent, 4);
        assert.equal(result.ceilingTier, true);
      }
    }
  });

  it("caso real 612.02AA — sold 3,35 entre Atacado e Varejo 1 ≈ 1,2813%", () => {
    const result = resolveCommercialPriceTier({ soldUnitPrice: 3.35, tiers: esmaltecTiers() });
    assert.equal(result.ok, true);
    if (result.ok) {
      const expected =
        1 +
        ((3.35 - 3.043697) / (4.132499 - 3.043697)) *
          (2 - 1);
      assert.ok(Math.abs(result.ratePercent - roundRatePercent(expected)) < 0.0002);
      assert.ok(result.ratePercent > 1 && result.ratePercent < 2);
    }
  });

  it("commissionAmount = base × rate / 100 arredondado", () => {
    const result = resolveCommercialPriceTier({ soldUnitPrice: 11, tiers: sampleTiers() });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(
        computeCommissionAmount(1000, result.ratePercent),
        Math.round((1000 * result.ratePercent) / 100 * 100) / 100
      );
    }
  });

  it("toSalePrice <= fromSalePrice não divide por zero", () => {
    const flat = interpolateCommercialTierRate({
      soldUnitPrice: 11,
      fromTier: { code: "ATACADO", name: "A", salePrice: 10, commissionPercent: 1 },
      toTier: { code: "VAREJO_1", name: "V1", salePrice: 10, commissionPercent: 2 },
    });
    assert.equal(flat.ratePercent, 1);
  });

  it("faixa inconsistente gera INVALID_COMMERCIAL_PRICE_RANGE", () => {
    const bad = [...sampleTiers()];
    bad[2] = { ...bad[2]!, salePrice: 11 };
    const result = resolveCommercialPriceTier({ soldUnitPrice: 12, tiers: bad });
    assert.equal(result.ok, false);
  });

  it("tabela ausente gera NO_COMMERCIAL_PRICE_TABLE", () => {
    const result = resolveCommercialPriceTier({ soldUnitPrice: 12, tiers: sampleTiers().slice(0, 2) });
    assert.equal(result.ok, false);
  });

  it("validateCommercialTierPriceOrder exige ordem crescente", () => {
    assert.equal(validateCommercialTierPriceOrder(sampleTiers()), true);
  });

  it("resolveSoldUnitNetPrice usa valor líquido / quantidade", () => {
    assert.equal(
      resolveSoldUnitNetPrice({ quantity: 4, itemNetAmount: 44, unitPrice: 12 }),
      11
    );
  });
});

describe("commission-commercial-tier — metadata de interpolação", () => {
  it("expõe campos de interpolação entre faixas", () => {
    const result = resolveCommercialPriceTier({ soldUnitPrice: 11, tiers: sampleTiers() });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(result.interpolation);
      assert.equal(result.interpolation!.fromTierCode, "ATACADO");
      assert.equal(result.interpolation!.toTierCode, "VAREJO_1");
      assert.ok(result.interpolation!.interpolationProgress > 0);
    }
  });
});
