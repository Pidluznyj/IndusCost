import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { calculatePriceTableItemFromFrozenCost } from "../priceTablePublication.js";
import {
  marginFromCostAndTargetPrice as legacyMargin,
  priceFromCostAndMargin as legacyPrice,
} from "../simulationFormula.js";
import {
  marginFromCostAndPrice,
  markupFactor,
  markupPct,
  priceFromCostAndMargin,
  validatePricingPremises,
} from "./commercialPriceFormula.js";

const near = (actual: number, expected: number, eps = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= eps, `${actual} ≉ ${expected}`);

const premises = { taxRatePct: 18, commissionRatePct: 3, otherRatePct: 0, freight: 0 };

describe("commercialPriceFormula — referência numérica", () => {
  it("imposto 18% + comissão 3% + margem 20% → custo / 0,59", () => {
    const r = priceFromCostAndMargin(10, premises, 20);
    assert.ok(r.ok === true);
    if (r.ok === true) {
      near(r.price, 16.94915254237288, 1e-12);
      near(r.divisor, 0.59);
    }
  });

  it("frete absoluto soma ao custo; outras variáveis entram no divisor", () => {
    const r = priceFromCostAndMargin(10, { taxRatePct: 10, commissionRatePct: 2, otherRatePct: 3, freight: 1.5 }, 25);
    if (r.ok === true) near(r.price, 11.5 / 0.6);
  });

  it("margem a partir do preço é a inversa do preço a partir da margem", () => {
    const price = priceFromCostAndMargin(4.02, premises, 40);
    assert.ok(price.ok === true);
    if (price.ok === true) {
      const margin = marginFromCostAndPrice(4.02, premises, price.price);
      if (margin.ok === true) near(margin.marginRatePct, 40, 1e-9);
    }
  });

  it("margem negativa é resultado válido (preço abaixo do custo)", () => {
    const r = marginFromCostAndPrice(10, { taxRatePct: 0, commissionRatePct: 0, otherRatePct: 0, freight: 0 }, 8);
    assert.ok(r.ok === true);
    if (r.ok === true) near(r.marginRatePct, -25);
  });
});

describe("commercialPriceFormula — premissas impossíveis nunca viram preço 0", () => {
  it("divisor ≤ 0 → IMPOSSIBLE_PREMISES com o divisor", () => {
    for (const margin of [79, 80, 120]) {
      const r = priceFromCostAndMargin(10, premises, margin);
      assert.equal(r.ok, false);
      if (r.ok === false) {
        assert.equal(r.code, "IMPOSSIBLE_PREMISES");
        assert.ok((r.divisor as number) <= 0);
      }
    }
  });

  it("entradas inválidas têm código próprio", () => {
    const codes = [
      priceFromCostAndMargin(Number.NaN, premises, 10),
      priceFromCostAndMargin(-1, premises, 10),
      priceFromCostAndMargin(10, { ...premises, taxRatePct: -1 }, 10),
      priceFromCostAndMargin(10, { ...premises, freight: Number.POSITIVE_INFINITY }, 10),
      priceFromCostAndMargin(10, premises, Number.NaN),
      marginFromCostAndPrice(10, premises, 0),
      marginFromCostAndPrice(10, premises, -5),
    ].map((r) => (r.ok === false ? r.code : "OK"));
    assert.deepEqual(codes, [
      "INVALID_COST",
      "INVALID_COST",
      "INVALID_PREMISES",
      "INVALID_PREMISES",
      "INVALID_MARGIN",
      "INVALID_PRICE",
      "INVALID_PRICE",
    ]);
    assert.equal(validatePricingPremises(premises).ok, true);
  });
});

describe("commercialPriceFormula — markup com uma semântica só", () => {
  it("markupFactor = preço/custo; markupPct = (preço/custo − 1) × 100", () => {
    near(markupFactor(16.9, 10) as number, 1.69);
    near(markupPct(16.9, 10) as number, 69);
    assert.equal(markupFactor(10, 0), null);
    assert.equal(markupPct(10, -1), null);
    assert.equal(markupFactor(Number.NaN, 10), null);
  });
});

describe("commercialPriceFormula — equivalência com as fórmulas existentes", () => {
  const cases = [
    { cost: 10, tax: 18, comm: 3, other: 0, margin: 20, freight: 0 },
    { cost: 4.02, tax: 0, comm: 0, other: 0, margin: 40, freight: 0 },
    { cost: 123.456789, tax: 27.25, comm: 5, other: 2.5, margin: 12, freight: 3.2 },
    { cost: 0.0375, tax: 9.25, comm: 1, other: 0.5, margin: 35, freight: 0.01 },
  ];

  it("igual à fórmula da publicação de tabela de preço (frete percentual = 0)", () => {
    for (const c of cases) {
      const canonical = priceFromCostAndMargin(
        c.cost,
        { taxRatePct: c.tax, commissionRatePct: c.comm, otherRatePct: c.other, freight: c.freight },
        c.margin
      );
      const published = calculatePriceTableItemFromFrozenCost(c.cost, {
        taxRate: c.tax / 100,
        commissionRate: c.comm / 100,
        otherRate: c.other / 100,
        marginRate: c.margin / 100,
        freight: c.freight,
        freightRate: 0,
      });
      assert.ok(canonical.ok === true && published.ok === true);
      if (canonical.ok === true && published.ok === true) {
        near(canonical.price, published.result.salePrice, 1e-9);
      }
    }
  });

  it("igual às funções legadas de simulationFormula no domínio válido", () => {
    for (const c of cases) {
      const legacyPremises = { taxRatePct: c.tax, commRatePct: c.comm, otherRatePct: c.other, freight: c.freight };
      const canonicalPremises = { taxRatePct: c.tax, commissionRatePct: c.comm, otherRatePct: c.other, freight: c.freight };
      const canonical = priceFromCostAndMargin(c.cost, canonicalPremises, c.margin);
      const legacy = legacyPrice(c.cost, legacyPremises, c.margin);
      if (canonical.ok === true) {
        near(canonical.price, legacy.price, 1e-12);
        const m1 = marginFromCostAndPrice(c.cost, canonicalPremises, canonical.price);
        const m2 = legacyMargin(c.cost, legacyPremises, canonical.price);
        if (m1.ok === true) near(m1.marginRatePct, m2.marginRatePct, 1e-12);
      }
    }
  });

  it("é biblioteca pura: sem Prisma, sem I/O, sem imports de servidor", () => {
    const src = readFileSync(resolve(process.cwd(), "src/lib/pricing/commercialPriceFormula.ts"), "utf8");
    assert.doesNotMatch(src, /^import /m);
    assert.doesNotMatch(src, /prisma|fetch\(|\.server/i);
  });
});
