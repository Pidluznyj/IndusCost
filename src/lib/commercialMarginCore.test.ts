import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculateCommercialMarginFromNetUnitPrice,
  calculateSalePriceFromCommercialMarginRates,
  interpolateCommercialCommissionRate,
  normalizeCommercialCommissionRateFraction,
  resolveCommercialCommissionFromTiers,
  resolveCommercialPricePosition,
  validateAndSortCommercialMarginTiers,
  type CommercialMarginTier,
} from "./commercialMarginCore.js";
import { interpolateCommercialTierRate } from "./commissions/commission-commercial-tier.js";
import { calculateCommercialMarginRateFromNegotiatedPrice } from "./priceTablePublication.js";
import { roundPricingPercent } from "./pricingCalculations.js";

const TAX = 0.2875;
const OTHER = 0.02;
const FREIGHT_RATE = 0.03;
const FREIGHT_ABS = 1.5;
const COST = 100;

/** Faixas dinâmicas 33% / 48% / 57% — sem códigos ATACADO/VAREJO. */
function tiers334857(): CommercialMarginTier[] {
  return [
    { id: "m33", marginRate: 0.33, salePrice: 200, commissionRate: 0.06 },
    { id: "m48", marginRate: 0.48, salePrice: 250, commissionRate: 0.04 },
    { id: "m57", marginRate: 0.57, salePrice: 300, commissionRate: 0.02 },
  ];
}

describe("commercialMarginCore — validação e ordenação dinâmica", () => {
  it("1. aceita margens 33%, 48% e 57%", () => {
    const v = validateAndSortCommercialMarginTiers(tiers334857());
    assert.equal(v.ok, true);
    if (!v.ok) throw new Error(v.message);
    assert.equal(v.tiers.length, 3);
    assert.deepEqual(
      v.tiers.map((t) => t.marginRate),
      [0.33, 0.48, 0.57]
    );
  });

  it("8. aceita duas faixas", () => {
    const v = validateAndSortCommercialMarginTiers([
      { id: "a", marginRate: 0.3, salePrice: 10, commissionRate: 0.01 },
      { id: "b", marginRate: 0.5, salePrice: 20, commissionRate: 0.03 },
    ]);
    assert.equal(v.ok, true);
  });

  it("9. aceita mais de quatro faixas", () => {
    const many: CommercialMarginTier[] = Array.from({ length: 6 }, (_, i) => ({
      id: `t${i}`,
      marginRate: 0.3 + i * 0.05,
      salePrice: 10 + i * 2,
      commissionRate: 0.01 + i * 0.005,
    }));
    const v = validateAndSortCommercialMarginTiers(many);
    assert.equal(v.ok, true);
    if (!v.ok) throw new Error(v.message);
    assert.equal(v.tiers.length, 6);
  });

  it("10. ordena faixas recebidas fora de ordem por salePrice", () => {
    const shuffled: CommercialMarginTier[] = [
      { id: "m57", marginRate: 0.57, salePrice: 300, commissionRate: 0.02 },
      { id: "m33", marginRate: 0.33, salePrice: 200, commissionRate: 0.06 },
      { id: "m48", marginRate: 0.48, salePrice: 250, commissionRate: 0.04 },
    ];
    const v = validateAndSortCommercialMarginTiers(shuffled);
    assert.equal(v.ok, true);
    if (!v.ok) throw new Error(v.message);
    assert.deepEqual(
      v.tiers.map((t) => t.id),
      ["m33", "m48", "m57"]
    );
  });

  it("11. rejeita preços duplicados", () => {
    const v = validateAndSortCommercialMarginTiers([
      { id: "a", marginRate: 0.3, salePrice: 100, commissionRate: 0.01 },
      { id: "b", marginRate: 0.4, salePrice: 100, commissionRate: 0.02 },
    ]);
    assert.equal(v.ok, false);
    if (v.ok) throw new Error("expected failure");
    assert.equal(v.code, "DUPLICATE_SALE_PRICE");
  });

  it("12. aceita margens decimais (41,5%)", () => {
    const v = validateAndSortCommercialMarginTiers([
      { id: "a", marginRate: 0.33, salePrice: 10, commissionRate: 0.01 },
      { id: "b", marginRate: 0.415, salePrice: 12, commissionRate: 0.02 },
      { id: "c", marginRate: 0.48, salePrice: 14, commissionRate: 0.03 },
    ]);
    assert.equal(v.ok, true);
    if (!v.ok) throw new Error(v.message);
    assert.equal(v.tiers[1]!.marginRate, 0.415);
  });

  it("rejeita array vazio e preço não positivo", () => {
    assert.equal(validateAndSortCommercialMarginTiers([]).ok, false);
    const badPrice = validateAndSortCommercialMarginTiers([
      { id: "a", marginRate: 0.3, salePrice: 0, commissionRate: 0.01 },
      { id: "b", marginRate: 0.4, salePrice: 10, commissionRate: 0.02 },
    ]);
    assert.equal(badPrice.ok, false);
  });
});

describe("commercialMarginCore — localização do preço", () => {
  it("2. preço exatamente na faixa de 33%", () => {
    const pos = resolveCommercialPricePosition({
      netUnitPrice: 200,
      tiers: tiers334857(),
    });
    assert.equal(pos.ok, true);
    if (!pos.ok) throw new Error(pos.message);
    assert.equal(pos.result.position, "EXACT_TIER");
    assert.equal(pos.result.exactTier?.id, "m33");
  });

  it("3. preço exatamente na faixa de 48%", () => {
    const pos = resolveCommercialPricePosition({
      netUnitPrice: 250,
      tiers: tiers334857(),
    });
    assert.equal(pos.ok, true);
    if (!pos.ok) throw new Error(pos.message);
    assert.equal(pos.result.position, "EXACT_TIER");
    assert.equal(pos.result.exactTier?.id, "m48");
  });

  it("4. preço entre 33% e 48%", () => {
    const pos = resolveCommercialPricePosition({
      netUnitPrice: 225,
      tiers: tiers334857(),
    });
    assert.equal(pos.ok, true);
    if (!pos.ok) throw new Error(pos.message);
    assert.equal(pos.result.position, "BETWEEN_TIERS");
    assert.equal(pos.result.lowerTier?.id, "m33");
    assert.equal(pos.result.upperTier?.id, "m48");
    assert.ok(pos.result.progress != null && pos.result.progress > 0 && pos.result.progress < 1);
  });

  it("5. preço abaixo da menor faixa", () => {
    const pos = resolveCommercialPricePosition({
      netUnitPrice: 150,
      tiers: tiers334857(),
    });
    assert.equal(pos.ok, true);
    if (!pos.ok) throw new Error(pos.message);
    assert.equal(pos.result.position, "BELOW_LOWEST");
  });

  it("6. preço acima da maior faixa", () => {
    const pos = resolveCommercialPricePosition({
      netUnitPrice: 400,
      tiers: tiers334857(),
    });
    assert.equal(pos.ok, true);
    if (!pos.ok) throw new Error(pos.message);
    assert.equal(pos.result.position, "ABOVE_HIGHEST");
  });
});

describe("commercialMarginCore — comissão proporcional e teto", () => {
  it("7. comissão proporcional entre faixas", () => {
    const mid = 225;
    const { progress, commissionRate } = interpolateCommercialCommissionRate({
      netUnitPrice: mid,
      lowerTier: tiers334857()[0]!,
      upperTier: tiers334857()[1]!,
    });
    assert.equal(progress, 0.5);
    assert.ok(Math.abs(commissionRate - 0.05) < 1e-12);
  });

  it("14. teto da comissão acima da maior faixa", () => {
    const resolved = resolveCommercialCommissionFromTiers({
      netUnitPrice: 999,
      tiers: tiers334857(),
    });
    assert.equal(resolved.ok, true);
    if (!resolved.ok) throw new Error(resolved.message);
    assert.equal(resolved.ceilingTier, true);
    assert.equal(resolved.commissionRate, 0.02);
  });

  it("abaixo da menor usa política explícita (não interpola margem)", () => {
    const resolved = resolveCommercialCommissionFromTiers({
      netUnitPrice: 100,
      tiers: tiers334857(),
      belowLowestCommissionRate: 0.01,
    });
    assert.equal(resolved.ok, true);
    if (!resolved.ok) throw new Error(resolved.message);
    assert.equal(resolved.belowLowest, true);
    assert.equal(resolved.commissionRate, 0.01);
    assert.equal(resolved.position.position, "BELOW_LOWEST");
  });

  it("abaixo da menor: política 1 (1%) não vira 100%", () => {
    const resolved = resolveCommercialCommissionFromTiers({
      netUnitPrice: 100,
      tiers: tiers334857(),
      belowLowestCommissionRate: 1,
    });
    assert.equal(resolved.ok, true);
    if (!resolved.ok) throw new Error(resolved.message);
    assert.equal(resolved.commissionRate, 0.01);
  });
});

describe("normalizeCommercialCommissionRateFraction", () => {
  it("1 = 1%, 6 = 6%, fração < 1 permanece", () => {
    assert.equal(normalizeCommercialCommissionRateFraction(1), 0.01);
    assert.equal(normalizeCommercialCommissionRateFraction(6), 0.06);
    assert.equal(normalizeCommercialCommissionRateFraction(4.5), 0.045);
    assert.equal(normalizeCommercialCommissionRateFraction(0.06), 0.06);
    assert.equal(normalizeCommercialCommissionRateFraction(0.01), 0.01);
  });
});

describe("commercialMarginCore — fórmula inversa e identidade", () => {
  it("13. permite margem comercial negativa com preço baixo", () => {
    const r = calculateCommercialMarginFromNetUnitPrice({
      netUnitPrice: 120,
      quantity: 1,
      frozenCostUnit: COST,
      taxRate: TAX,
      commissionRate: 0.06,
      freightRate: FREIGHT_RATE,
      freightAbsoluteUnit: FREIGHT_ABS,
      otherVariablesRate: OTHER,
    });
    assert.equal(r.ok, true);
    if (!r.ok) throw new Error(r.message);
    assert.ok(r.commercialMarginPercent < 0);
  });

  it("13b. commissionRate=1 no núcleo é 1%, não 100%", () => {
    const dirty = calculateCommercialMarginFromNetUnitPrice({
      netUnitPrice: 9.98,
      quantity: 30,
      frozenCostUnit: 3.94,
      taxRate: 0.2675,
      commissionRate: 1,
      freightRate: 0.03,
      freightAbsoluteUnit: 0,
      otherVariablesRate: 0,
    });
    const ok = calculateCommercialMarginFromNetUnitPrice({
      netUnitPrice: 9.98,
      quantity: 30,
      frozenCostUnit: 3.94,
      taxRate: 0.2675,
      commissionRate: 0.01,
      freightRate: 0.03,
      freightAbsoluteUnit: 0,
      otherVariablesRate: 0,
    });
    assert.equal(dirty.ok, true);
    assert.equal(ok.ok, true);
    if (!dirty.ok || !ok.ok) throw new Error("calc");
    assert.ok(Math.abs(dirty.commercialMarginPercent - ok.commercialMarginPercent) < 1e-9);
    assert.ok(dirty.commercialMarginPercent > -50);
    assert.ok(Math.abs(dirty.commissionValue - 9.98 * 30 * 0.01) < 0.02);
  });

  it("15. identidade direta/inversa recupera a margem", () => {
    const marginRate = 0.415;
    const commissionRate = 0.035;
    const direct = calculateSalePriceFromCommercialMarginRates({
      frozenCostUnit: COST,
      taxRate: TAX,
      commissionRate,
      freightRate: FREIGHT_RATE,
      freightAbsoluteUnit: FREIGHT_ABS,
      otherVariablesRate: OTHER,
      marginRate,
    });
    assert.equal(direct.ok, true);
    if (!direct.ok) throw new Error(direct.message);

    const inverse = calculateCommercialMarginFromNetUnitPrice({
      netUnitPrice: direct.salePrice,
      quantity: 3,
      frozenCostUnit: COST,
      taxRate: TAX,
      commissionRate,
      freightRate: FREIGHT_RATE,
      freightAbsoluteUnit: FREIGHT_ABS,
      otherVariablesRate: OTHER,
    });
    assert.equal(inverse.ok, true);
    if (!inverse.ok) throw new Error(inverse.message);
    assert.equal(roundPricingPercent(inverse.commercialMarginPercent), roundPricingPercent(marginRate * 100));
  });
});

describe("commercialMarginCore — equivalência Pedido × Proposta (mesmas entradas)", () => {
  it("núcleo (cenário Proposta) e APIs do Pedido devolvem a mesma margem quando não há frete% (freightRate=0)", () => {
    const pLo = 200;
    const pHi = 250;
    const mid = 225;
    const commissionLoPct = 6;
    const commissionHiPct = 4;

    // Cenário Pedido (adapters públicos existentes)
    const pedidoInterp = interpolateCommercialTierRate({
      soldUnitPrice: mid,
      fromTier: {
        code: "ATACADO",
        name: "Atacado",
        salePrice: pLo,
        commissionPercent: commissionLoPct,
      },
      toTier: {
        code: "VAREJO_1",
        name: "Varejo 1",
        salePrice: pHi,
        commissionPercent: commissionHiPct,
      },
    });
    // freightRate=0 aqui: com frete%, o Pedido/Tabela de Preço diverge do núcleo
    // de propósito (frete% virou fração do custo, não do preço — ver teste abaixo).
    const pedidoInverse = calculateCommercialMarginRateFromNegotiatedPrice({
      negotiatedUnitPrice: mid,
      frozenTotalCost: COST,
      rates: {
        taxRate: TAX,
        commissionRate: pedidoInterp.ratePercent / 100,
        otherRate: OTHER,
        freightRate: 0,
        freight: FREIGHT_ABS,
      },
    });
    assert.equal(pedidoInverse.ok, true);
    if (!pedidoInverse.ok) throw new Error(pedidoInverse.message);

    // Cenário Proposta (somente núcleo neutro — sem SalesOrder/Proposal)
    const proposalCommission = interpolateCommercialCommissionRate({
      netUnitPrice: mid,
      lowerTier: {
        id: "lo",
        marginRate: 0.33,
        salePrice: pLo,
        commissionRate: commissionLoPct / 100,
      },
      upperTier: {
        id: "hi",
        marginRate: 0.48,
        salePrice: pHi,
        commissionRate: commissionHiPct / 100,
      },
    });
    const proposalInverse = calculateCommercialMarginFromNetUnitPrice({
      netUnitPrice: mid,
      quantity: 1,
      frozenCostUnit: COST,
      taxRate: TAX,
      commissionRate: proposalCommission.commissionRate,
      freightRate: 0,
      freightAbsoluteUnit: FREIGHT_ABS,
      otherVariablesRate: OTHER,
    });
    assert.equal(proposalInverse.ok, true);
    if (!proposalInverse.ok) throw new Error(proposalInverse.message);

    assert.equal(pedidoInterp.progress, proposalCommission.progress);
    assert.ok(
      Math.abs(pedidoInterp.ratePercent / 100 - proposalCommission.commissionRate) < 1e-9
    );
    assert.equal(pedidoInverse.marginRate, proposalInverse.commercialMarginRate);
    assert.equal(pedidoInverse.marginPercent, proposalInverse.commercialMarginPercent);
    assert.equal(
      pedidoInverse.commercialMarginUnitValue,
      proposalInverse.commercialMarginUnitValue
    );
  });

  it("com frete% (>0), Pedido/Tabela de Preço diverge do núcleo de propósito (frete% agora é sobre custo)", () => {
    const mid = 225;
    const commissionRate = 0.045;

    const pedidoInverse = calculateCommercialMarginRateFromNegotiatedPrice({
      negotiatedUnitPrice: mid,
      frozenTotalCost: COST,
      rates: {
        taxRate: TAX,
        commissionRate,
        otherRate: OTHER,
        freightRate: FREIGHT_RATE,
        freight: FREIGHT_ABS,
      },
    });
    assert.equal(pedidoInverse.ok, true);
    if (!pedidoInverse.ok) throw new Error(pedidoInverse.message);

    const nucleoInverse = calculateCommercialMarginFromNetUnitPrice({
      netUnitPrice: mid,
      quantity: 1,
      frozenCostUnit: COST,
      taxRate: TAX,
      commissionRate,
      freightRate: FREIGHT_RATE,
      freightAbsoluteUnit: FREIGHT_ABS,
      otherVariablesRate: OTHER,
    });
    assert.equal(nucleoInverse.ok, true);
    if (!nucleoInverse.ok) throw new Error(nucleoInverse.message);

    assert.notEqual(
      roundPricingPercent(pedidoInverse.marginPercent),
      roundPricingPercent(nucleoInverse.commercialMarginPercent)
    );
  });
});

describe("commercialMarginCore — caracterização da API pública do Pedido", () => {
  it("calculateCommercialMarginRateFromNegotiatedPrice — frete% agora é fração do custo", () => {
    const inverse = calculateCommercialMarginRateFromNegotiatedPrice({
      negotiatedUnitPrice: 250,
      frozenTotalCost: COST,
      rates: {
        taxRate: TAX,
        commissionRate: 0.04,
        otherRate: OTHER,
        freightRate: FREIGHT_RATE,
        freight: FREIGHT_ABS,
      },
    });
    assert.equal(inverse.ok, true);
    if (!inverse.ok) throw new Error(inverse.message);
    // freteRate$ = custo × frete% (fora do divisor) — não mais fração do preço.
    const freightFromRate = COST * FREIGHT_RATE;
    const expectedRate =
      1 - TAX - 0.04 - OTHER - (COST + FREIGHT_ABS + freightFromRate) / 250;
    assert.equal(inverse.marginRate, expectedRate);
    assert.equal(inverse.marginPercent, expectedRate * 100);
    assert.equal(inverse.commercialMarginUnitValue, 250 * expectedRate);
    assert.equal(inverse.freightRateValueUnit, freightFromRate);
    assert.equal(inverse.freightAbsoluteUnit, FREIGHT_ABS);
  });
});
