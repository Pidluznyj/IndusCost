import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveCommercialPriceTier,
  resolveSoldUnitNetPrice,
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

describe("commission-commercial-tier", () => {
  it("preço entre Atacado e Varejo 1 aplica 1%", () => {
    const result = resolveCommercialPriceTier({ soldUnitPrice: 11, tiers: sampleTiers() });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.tierCode, "ATACADO");
      assert.equal(result.ratePercent, 1);
    }
  });

  it("preço igual ao Varejo 1 aplica 2%", () => {
    const result = resolveCommercialPriceTier({ soldUnitPrice: 12, tiers: sampleTiers() });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.ratePercent, 2);
  });

  it("preço entre Varejo 1 e Varejo 2 aplica 2%", () => {
    const result = resolveCommercialPriceTier({ soldUnitPrice: 13, tiers: sampleTiers() });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.tierCode, "VAREJO_1");
      assert.equal(result.ratePercent, 2);
    }
  });

  it("preço igual ao Varejo 2 aplica 3%", () => {
    const result = resolveCommercialPriceTier({ soldUnitPrice: 14, tiers: sampleTiers() });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.ratePercent, 3);
  });

  it("preço entre Varejo 2 e Varejo 3 aplica 3%", () => {
    const result = resolveCommercialPriceTier({ soldUnitPrice: 15, tiers: sampleTiers() });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.tierCode, "VAREJO_2");
      assert.equal(result.ratePercent, 3);
    }
  });

  it("preço igual ou maior que Varejo 3 aplica 4%", () => {
    for (const price of [16, 20]) {
      const result = resolveCommercialPriceTier({ soldUnitPrice: price, tiers: sampleTiers() });
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.tierCode, "VAREJO_3");
        assert.equal(result.ratePercent, 4);
      }
    }
  });

  it("preço abaixo de Atacado aplica 1% com faixa Preço fora da tabela", () => {
    const result = resolveCommercialPriceTier({ soldUnitPrice: 9.5, tiers: sampleTiers() });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.tierCode, "PRECO_FORA_DA_TABELA");
      assert.equal(result.tierName, "Preço fora da tabela");
      assert.equal(result.ratePercent, 1);
      assert.equal(result.outOfTablePrice, true);
      assert.equal(result.warningCode, "OUT_OF_TABLE_PRICE_COMMISSION");
      assert.equal(result.atacadoPrice, 10);
      assert.equal(result.differenceAmount, 0.5);
    }
  });

  it("exemplo de negócio: base R$ 1.000 com preço abaixo do Atacado → comissão R$ 10", () => {
    const result = resolveCommercialPriceTier({ soldUnitPrice: 9.5, tiers: sampleTiers() });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(computeCommissionAmount(1000, result.ratePercent), 10);
    }
  });

  it("faixa inconsistente gera INVALID_COMMERCIAL_PRICE_RANGE", () => {
    const bad = [...sampleTiers()];
    bad[2] = { ...bad[2]!, salePrice: 11 };
    const result = resolveCommercialPriceTier({ soldUnitPrice: 12, tiers: bad });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "INVALID_COMMERCIAL_PRICE_RANGE");
  });

  it("tabela ausente gera NO_COMMERCIAL_PRICE_TABLE", () => {
    const result = resolveCommercialPriceTier({ soldUnitPrice: 12, tiers: sampleTiers().slice(0, 2) });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NO_COMMERCIAL_PRICE_TABLE");
  });

  it("tabela sem percentual gera NO_COMMISSION_TABLE_RATE", () => {
    const tiers = sampleTiers();
    tiers[1] = { ...tiers[1]!, commissionPercent: 0 };
    const result = resolveCommercialPriceTier({ soldUnitPrice: 12, tiers });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, "NO_COMMISSION_TABLE_RATE");
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

  it("CommissionRecord math usa ratePercent resolvido", () => {
    const baseAmount = 1000;
    const tier = resolveCommercialPriceTier({ soldUnitPrice: 15, tiers: sampleTiers() });
    assert.equal(tier.ok, true);
    if (tier.ok) {
      assert.equal(computeCommissionAmount(baseAmount, tier.ratePercent), 30);
    }
  });
});
