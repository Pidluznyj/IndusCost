import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  calculatePriceTableItemFromFrozenCost,
  calculateCommercialMarginRateFromNegotiatedPrice,
} from "./priceTablePublication.js";
import {
  calculateSalesOrderItemCommercialMargin,
  readExplicitAbsolute,
  readExplicitRate,
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

/** Fixtures de teste — NÃO são hardcoded no runtime do Pedido. */
const BANDS = [
  { marginPct: 30, commissionPercent: 6 },
  { marginPct: 40, commissionPercent: 5 },
  { marginPct: 50, commissionPercent: 4 },
  { marginPct: 60, commissionPercent: 3 },
] as const;

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

describe("salesOrderCommercialMargin — identidade pelas faixas cadastradas", () => {
  for (const band of BANDS) {
    it(`preço da faixa marginPct=${band.marginPct}% recupera ${band.marginPct}%`, () => {
      const salePrice = formPrice(band.marginPct, band.commissionPercent);
      const inverse = calculateCommercialMarginRateFromNegotiatedPrice({
        negotiatedUnitPrice: salePrice,
        frozenTotalCost: COST,
        rates: {
          taxRate: TAX,
          commissionRate: band.commissionPercent / 100,
          otherRate: OTHER,
          freightRate: FREIGHT_RATE,
          freight: FREIGHT_ABS,
        },
      });
      assert.equal(inverse.ok, true);
      if (!inverse.ok) throw new Error(inverse.message);
      assert.equal(roundPricingPercent(inverse.marginPercent), band.marginPct);

      const item = calculateSalesOrderItemCommercialMargin({
        soldQuantity: 2,
        negotiatedUnitPrice: salePrice,
        frozenTotalCost: COST,
        rates: {
          taxRate: TAX,
          commissionRate: band.commissionPercent / 100,
          otherRate: OTHER,
          freightRate: FREIGHT_RATE,
          freight: FREIGHT_ABS,
        },
        historicalContextId: "v1|v2|v3|v4",
      });
      assert.equal(item.isComplete, true);
      assert.equal(item.commercialMarginPercent, band.marginPct);
      assert.equal(item.calculationSource, "HISTORICAL_PRICE_FORMATION");
      assert.equal(item.reasonCode, null);
    });
  }
});

describe("salesOrderCommercialMargin — intermediários e fora da tabela", () => {
  it("usa comissão proporcional; margem pela inversa (não linear na margem)", () => {
    const pLo = formPrice(30, 6);
    const pHi = formPrice(40, 5);
    const mid = (pLo + pHi) / 2;
    const { ratePercent: commission } = interpolateCommercialTierRate({
      soldUnitPrice: mid,
      fromTier: {
        code: "ATACADO",
        name: "Atacado",
        salePrice: pLo,
        commissionPercent: 6,
      },
      toTier: {
        code: "VAREJO_1",
        name: "Varejo 1",
        salePrice: pHi,
        commissionPercent: 5,
      },
    });
    assert.ok(commission > 5 && commission < 6);
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
    assert.ok(inverse.marginPercent > 30 && inverse.marginPercent < 40);
  });

  it("cobre faixas intermediárias 40–50 e 50–60", () => {
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

  it("permite margem negativa com preço baixo", () => {
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

  it("zeros explícitos são válidos e completos", () => {
    const salePrice = formPrice(40, 5);
    // reform with zeros
    const formed = calculatePriceTableItemFromFrozenCost(COST, {
      taxRate: TAX,
      commissionRate: 0.05,
      otherRate: 0,
      freightRate: 0,
      freight: 0,
      marginRate: 0.4,
    });
    assert.equal(formed.ok, true);
    if (!formed.ok) throw new Error(formed.message);
    const item = calculateSalesOrderItemCommercialMargin({
      soldQuantity: 1,
      negotiatedUnitPrice: formed.result.salePrice,
      frozenTotalCost: COST,
      rates: {
        taxRate: TAX,
        commissionRate: 0.05,
        otherRate: 0,
        freightRate: 0,
        freight: 0,
      },
      historicalContextId: "ctx-zero",
    });
    assert.equal(item.isComplete, true);
    assert.equal(item.otherVariablesRate, 0);
    assert.equal(item.freightRate, 0);
    assert.equal(item.freightAbsoluteUnit, 0);
    assert.equal(item.commercialMarginPercent, 40);
    void salePrice;
  });
});

describe("salesOrderCommercialMargin — ausente ≠ zero e falhas", () => {
  it("readExplicitRate distingue ausente de zero", () => {
    assert.equal(readExplicitRate(0).present, true);
    if (readExplicitRate(0).present) assert.equal(readExplicitRate(0).value, 0);
    assert.equal(readExplicitRate(null).present, false);
    assert.equal(readExplicitRate(undefined).present, false);
    assert.equal(readExplicitAbsolute(0).present, true);
    assert.equal(readExplicitAbsolute(null).present, false);
  });

  it("falhas cadastrais retornam UNAVAILABLE com reasonCode", () => {
    const cases = [
      "PRODUCT_WITHOUT_PRICE_FORMATION",
      "COST_NOT_FOUND",
      "TAX_NOT_FOUND",
      "FREIGHT_NOT_DEFINED",
      "COMMISSION_NOT_DEFINED",
      "OTHER_VARIABLES_NOT_DEFINED",
      "INVALID_NEGOTIATED_PRICE",
      "INCONSISTENT_PRICE_FORMATION_SET",
    ] as const;
    for (const code of cases) {
      const item = unavailableCommercialMarginItem({
        soldQuantity: 1,
        negotiatedUnitPrice: 100,
        soldValue: 100,
        reasonCode: code,
      });
      assert.equal(item.isComplete, false);
      assert.equal(item.calculationSource, "UNAVAILABLE");
      assert.equal(item.reasonCode, code);
      assert.equal(item.taxRate, null);
      assert.equal(item.commercialMarginPercent, null);
    }
  });

  it("preço inválido no cálculo", () => {
    const item = calculateSalesOrderItemCommercialMargin({
      soldQuantity: 1,
      negotiatedUnitPrice: 0,
      frozenTotalCost: COST,
      rates: {
        taxRate: TAX,
        commissionRate: 0.05,
        otherRate: 0,
        freightRate: 0,
        freight: 0,
      },
      historicalContextId: "x",
    });
    assert.equal(item.reasonCode, "INVALID_NEGOTIATED_PRICE");
    assert.equal(item.isComplete, false);
  });

  it("cancelamento parcial e total", () => {
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
  });
});

describe("salesOrderCommercialMargin — total ponderado", () => {
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
      calculationSource: "HISTORICAL_PRICE_FORMATION",
      historicalContextId: "ctx",
      priceTableVersionId: "v1",
      referenceDate: "2024-01-15",
      warnings: [],
      isComplete: true,
      reasonCode: null,
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
    assert.equal(
      summary.commercialMarginTotalPercent,
      roundPricingPercent((360 / 1100) * 100)
    );
    assert.notEqual(summary.commercialMarginTotalPercent, 45);
  });

  it("cobertura parcial com item não calculado", () => {
    const ok = completeItem({
      soldValue: 900,
      commercialMarginValue: 270,
      commercialMarginPercent: 30,
    });
    const bad = unavailableCommercialMarginItem({
      soldQuantity: 1,
      negotiatedUnitPrice: 100,
      soldValue: 100,
      reasonCode: "COST_NOT_FOUND",
    });
    const summary = summarizeSalesOrderCommercialMargins([ok, bad], {
      totalActiveSoldValue: 1000,
    });
    assert.equal(summary.isComplete, false);
    assert.equal(summary.itemsCalculated, 1);
    assert.equal(summary.itemsUnavailable, 1);
    assert.equal(summary.commercialMarginCoveragePercent, 90);
  });
});
