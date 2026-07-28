import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculatePriceTableItemFromFrozenCost,
  calculateCommercialMarginRateFromNegotiatedPrice,
} from "./priceTablePublication.js";
import {
  calculateSalesOrderItemCommercialMargin,
  resolveActiveSoldQuantity,
  summarizeSalesOrderCommercialMargins,
  unavailableCommercialMarginItem,
  type SalesOrderCommercialMarginItemPayload,
} from "./salesOrderCommercialMargin.js";
import { interpolateCommercialTierRate } from "./commissions/commission-commercial-tier.js";
import { roundPricingPercent } from "./pricingCalculations.js";

const TAX = 0.2875;
const OTHER = 0.02;
const FREIGHT_RATE = 0.03;
const FREIGHT_ABS = 1.5;
const COST = 100;

function ratesAt(marginRate: number, commissionRate: number) {
  return {
    taxRate: TAX,
    commissionRate,
    otherRate: OTHER,
    freightRate: FREIGHT_RATE,
    freight: FREIGHT_ABS,
    marginRate,
  };
}

function formPrice(marginPercent: number, commissionPercent: number) {
  const formed = calculatePriceTableItemFromFrozenCost(
    COST,
    ratesAt(marginPercent / 100, commissionPercent / 100)
  );
  assert.equal(formed.ok, true);
  if (!formed.ok) throw new Error(formed.message);
  return formed.result.salePrice;
}

describe("salesOrderCommercialMargin — identidade 30/40/50/60", () => {
  for (const margin of [30, 40, 50, 60] as const) {
    it(`forma preço a ${margin}% e a inversa recupera ${margin}%`, () => {
      const commission = margin === 30 ? 6 : margin === 40 ? 5 : margin === 50 ? 4 : 3;
      const salePrice = formPrice(margin, commission);
      const inverse = calculateCommercialMarginRateFromNegotiatedPrice({
        negotiatedUnitPrice: salePrice,
        frozenTotalCost: COST,
        rates: {
          taxRate: TAX,
          commissionRate: commission / 100,
          otherRate: OTHER,
          freightRate: FREIGHT_RATE,
          freight: FREIGHT_ABS,
        },
      });
      assert.equal(inverse.ok, true);
      if (!inverse.ok) throw new Error(inverse.message);
      assert.equal(roundPricingPercent(inverse.marginPercent), margin);

      const item = calculateSalesOrderItemCommercialMargin({
        soldQuantity: 2,
        negotiatedUnitPrice: salePrice,
        frozenTotalCost: COST,
        rates: {
          taxRate: TAX,
          commissionRate: commission / 100,
          otherRate: OTHER,
          freightRate: FREIGHT_RATE,
          freight: FREIGHT_ABS,
        },
        calculationSource: "EXACT_PRICE_TABLE_VERSION",
      });
      assert.equal(item.isComplete, true);
      assert.equal(item.commercialMarginPercent, margin);
      assert.ok(item.commercialMarginValue != null);
      assert.ok(
        Math.abs(
          (item.commercialMarginValue ?? 0) -
            item.soldValue * (item.commercialMarginRate ?? 0)
        ) < 0.02
      );
    });
  }
});

describe("salesOrderCommercialMargin — intermediários e bordas", () => {
  it("usa comissão proporcional entre faixas (não interpola margem)", () => {
    const price30 = formPrice(30, 6);
    const price40 = formPrice(40, 5);
    const midPrice = (price30 + price40) / 2;
    const { ratePercent: commission } = interpolateCommercialTierRate({
      soldUnitPrice: midPrice,
      fromTier: {
        code: "ATACADO",
        name: "Atacado",
        salePrice: price30,
        commissionPercent: 6,
      },
      toTier: {
        code: "VAREJO_1",
        name: "Varejo 1",
        salePrice: price40,
        commissionPercent: 5,
      },
    });
    assert.ok(commission > 5 && commission < 6);

    const inverse = calculateCommercialMarginRateFromNegotiatedPrice({
      negotiatedUnitPrice: midPrice,
      frozenTotalCost: COST,
      rates: {
        taxRate: TAX,
        commissionRate: commission / 100,
        otherRate: OTHER,
        freightRate: FREIGHT_RATE,
        freight: FREIGHT_ABS,
      },
    });
    assert.equal(inverse.ok, true);
    if (!inverse.ok) throw new Error(inverse.message);
    assert.ok(inverse.marginPercent > 30 && inverse.marginPercent < 40);
  });

  it("cobre faixas 40–50 e 50–60 com comissão proporcional", () => {
    for (const [lo, hi, cLo, cHi, fromCode, toCode] of [
      [40, 50, 5, 4, "VAREJO_1", "VAREJO_2"],
      [50, 60, 4, 3, "VAREJO_2", "VAREJO_3"],
    ] as const) {
      const pLo = formPrice(lo, cLo);
      const pHi = formPrice(hi, cHi);
      const mid = (pLo + pHi) / 2;
      const { ratePercent: commission } = interpolateCommercialTierRate({
        soldUnitPrice: mid,
        fromTier: {
          code: fromCode,
          name: fromCode,
          salePrice: pLo,
          commissionPercent: cLo,
        },
        toTier: {
          code: toCode,
          name: toCode,
          salePrice: pHi,
          commissionPercent: cHi,
        },
      });
      const inverse = calculateCommercialMarginRateFromNegotiatedPrice({
        negotiatedUnitPrice: mid,
        frozenTotalCost: COST,
        rates: {
          taxRate: TAX,
          commissionRate: commission / 100,
          otherRate: OTHER,
          freightRate: FREIGHT_RATE,
          freight: FREIGHT_ABS,
        },
      });
      assert.equal(inverse.ok, true);
      if (!inverse.ok) throw new Error(inverse.message);
      assert.ok(inverse.marginPercent > lo && inverse.marginPercent < hi);
    }
  });

  it("permite margem negativa quando preço é baixo demais", () => {
    const inverse = calculateCommercialMarginRateFromNegotiatedPrice({
      negotiatedUnitPrice: 120,
      frozenTotalCost: COST,
      rates: {
        taxRate: TAX,
        commissionRate: 0.06,
        otherRate: OTHER,
        freightRate: FREIGHT_RATE,
        freight: FREIGHT_ABS,
      },
    });
    assert.equal(inverse.ok, true);
    if (!inverse.ok) throw new Error(inverse.message);
    assert.ok(inverse.marginPercent < 0);
  });

  it("preserva frete % e frete absoluto sem duplicar", () => {
    const salePrice = formPrice(40, 5);
    const inverse = calculateCommercialMarginRateFromNegotiatedPrice({
      negotiatedUnitPrice: salePrice,
      frozenTotalCost: COST,
      rates: {
        taxRate: TAX,
        commissionRate: 0.05,
        otherRate: OTHER,
        freightRate: FREIGHT_RATE,
        freight: FREIGHT_ABS,
      },
    });
    assert.equal(inverse.ok, true);
    if (!inverse.ok) throw new Error(inverse.message);
    assert.ok(Math.abs(inverse.freightRateValueUnit - salePrice * FREIGHT_RATE) < 1e-9);
    assert.equal(inverse.freightAbsoluteUnit, FREIGHT_ABS);
  });

  it("exclui quantidade cancelada e item totalmente cancelado", () => {
    assert.equal(
      resolveActiveSoldQuantity({ orderedQuantity: 10, canceledQuantity: 3 }),
      7
    );
    assert.equal(
      resolveActiveSoldQuantity({
        orderedQuantity: 10,
        canceledQuantity: 10,
        isFullyCanceled: true,
      }),
      0
    );
    const canceled = calculateSalesOrderItemCommercialMargin({
      soldQuantity: 0,
      negotiatedUnitPrice: 200,
      frozenTotalCost: COST,
      rates: {
        taxRate: TAX,
        commissionRate: 0.05,
        otherRate: OTHER,
        freightRate: 0,
        freight: 0,
      },
      calculationSource: "EXACT_PROPOSAL_SNAPSHOT",
    });
    assert.equal(canceled.isComplete, false);
    assert.equal(canceled.calculationSource, "UNAVAILABLE");
  });

  it("não assume zero quando formação está incompleta", () => {
    const unavailable = unavailableCommercialMarginItem({
      soldQuantity: 1,
      negotiatedUnitPrice: 100,
      soldValue: 100,
      warnings: ["parâmetro ausente"],
    });
    assert.equal(unavailable.isComplete, false);
    assert.equal(unavailable.taxRate, null);
    assert.equal(unavailable.commissionRate, null);
    assert.equal(unavailable.commercialMarginPercent, null);
    assert.match(unavailable.warnings.join(" "), /parâmetro ausente|indisponível/i);
  });
});

describe("salesOrderCommercialMargin — totais ponderados", () => {
  function completeItem(
    partial: Partial<SalesOrderCommercialMarginItemPayload> & {
      soldValue: number;
      commercialMarginValue: number;
      commercialMarginPercent: number;
    }
  ): SalesOrderCommercialMarginItemPayload {
    return {
      soldQuantity: 1,
      negotiatedUnitPrice: partial.soldValue,
      soldValue: partial.soldValue,
      costUnit: 10,
      costValue: 10,
      taxRate: TAX,
      taxValue: 1,
      commissionRate: 0.05,
      commissionValue: 1,
      freightRate: 0,
      freightRateValue: 0,
      freightAbsoluteUnit: 0,
      freightAbsoluteValue: 0,
      otherVariablesRate: 0,
      otherVariablesValue: 0,
      commercialMarginRate: partial.commercialMarginPercent / 100,
      commercialMarginPercent: partial.commercialMarginPercent,
      commercialMarginUnitValue: partial.commercialMarginValue,
      commercialMarginValue: partial.commercialMarginValue,
      lowerMarginBand: null,
      upperMarginBand: null,
      lowerBandPrice: null,
      upperBandPrice: null,
      calculationSource: "EXACT_PROPOSAL_SNAPSHOT",
      priceTableVersionId: "v1",
      referenceDate: "2024-01-15",
      warnings: [],
      isComplete: true,
      ...partial,
    };
  }

  it("total ponderado ≠ média simples", () => {
    const a = completeItem({
      soldValue: 1000,
      commercialMarginValue: 300,
      commercialMarginPercent: 30,
    });
    const b = completeItem({
      soldValue: 100,
      commercialMarginValue: 60,
      commercialMarginPercent: 60,
    });
    const summary = summarizeSalesOrderCommercialMargins([a, b]);
    assert.equal(summary.commercialMarginTotalValue, 360);
    assert.equal(summary.commercialSoldTotalValue, 1100);
    const weighted = roundPricingPercent((360 / 1100) * 100);
    assert.equal(summary.commercialMarginTotalPercent, weighted);
    assert.notEqual(summary.commercialMarginTotalPercent, 45);
  });

  it("cobertura parcial marca incompleto", () => {
    const ok = completeItem({
      soldValue: 900,
      commercialMarginValue: 270,
      commercialMarginPercent: 30,
    });
    const bad = unavailableCommercialMarginItem({
      soldQuantity: 1,
      negotiatedUnitPrice: 100,
      soldValue: 100,
    });
    const summary = summarizeSalesOrderCommercialMargins([ok, bad], {
      totalActiveSoldValue: 1000,
    });
    assert.equal(summary.isComplete, false);
    assert.equal(summary.itemsCalculated, 1);
    assert.equal(summary.itemsUnavailable, 1);
    assert.equal(summary.commercialMarginCoveragePercent, 90);
  });

  it("ignora item cancelado (soldQuantity 0) no total ativo", () => {
    const ok = completeItem({
      soldValue: 500,
      commercialMarginValue: 150,
      commercialMarginPercent: 30,
    });
    const canceled = unavailableCommercialMarginItem({
      soldQuantity: 0,
      soldValue: 0,
      warnings: ["Item cancelado"],
    });
    const summary = summarizeSalesOrderCommercialMargins([ok, canceled]);
    assert.equal(summary.itemsActive, 1);
    assert.equal(summary.commercialMarginTotalPercent, 30);
    assert.equal(summary.isComplete, true);
  });
});
