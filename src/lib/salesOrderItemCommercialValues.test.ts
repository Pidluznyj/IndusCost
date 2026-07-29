import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeInformedDiscountRate,
  resolveSalesOrderItemCommercialValues,
} from "./salesOrderItemCommercialValues.js";
import { roundPricingMoney, roundPricingPercent } from "./pricingCalculations.js";

/** Fixtures equivalentes ao PD 02820 (Nomus UI). */
const PD02820 = {
  item10: {
    orderedQuantity: 400,
    canceledQuantity: 0,
    grossUnitPrice: 4.32,
    netTotalValue: 1641.6,
  },
  item20: {
    orderedQuantity: 100,
    canceledQuantity: 0,
    grossUnitPrice: 5.97,
    netTotalValue: 567.15,
  },
  item30: {
    orderedQuantity: 100,
    canceledQuantity: 0,
    grossUnitPrice: 5.97,
    netTotalValue: 567.15,
  },
} as const;

describe("resolveSalesOrderItemCommercialValues — PD 02820", () => {
  it("item 00010: bruto 1728, líquido 1641.60, desconto 5%, unitário 4.104", () => {
    const r = resolveSalesOrderItemCommercialValues(PD02820.item10);
    assert.equal(r.isComplete, true);
    assert.equal(r.reasonCode, null);
    assert.equal(r.activeQuantity, 400);
    assert.equal(r.grossActiveValue, 1728);
    assert.equal(r.netActiveValue, 1641.6);
    assert.equal(r.effectiveDiscountValue, 86.4);
    assert.equal(roundPricingPercent(r.effectiveDiscountRate * 100), 5);
    assert.equal(r.effectiveNetUnitPrice, 4.104);
    assert.equal(r.discountStatus, "DISCOUNT");
    assert.equal(r.commercialAdditionValue, 0);
  });

  it("itens 00020 e 00030: bruto 597, líquido 567.15, unitário 5.6715", () => {
    for (const item of [PD02820.item20, PD02820.item30]) {
      const r = resolveSalesOrderItemCommercialValues(item);
      assert.equal(r.isComplete, true);
      assert.equal(r.grossActiveValue, 597);
      assert.equal(r.netActiveValue, 567.15);
      assert.equal(r.effectiveDiscountValue, 29.85);
      assert.equal(roundPricingPercent(r.effectiveDiscountRate * 100), 5);
      assert.equal(r.effectiveNetUnitPrice, 5.6715);
      assert.equal(r.discountStatus, "DISCOUNT");
    }
  });

  it("pedido: soma líquidos = 2775.90 e desconto = 146.10", () => {
    const rows = [PD02820.item10, PD02820.item20, PD02820.item30].map((i) =>
      resolveSalesOrderItemCommercialValues(i)
    );
    const net = roundPricingMoney(rows.reduce((s, r) => s + (r.netActiveValue ?? 0), 0));
    const gross = roundPricingMoney(rows.reduce((s, r) => s + r.grossActiveValue, 0));
    const discount = roundPricingMoney(rows.reduce((s, r) => s + r.effectiveDiscountValue, 0));
    assert.equal(gross, 2922);
    assert.equal(net, 2775.9);
    assert.equal(discount, 146.1);
  });
});

describe("resolveSalesOrderItemCommercialValues — cenários", () => {
  it("sem desconto", () => {
    const r = resolveSalesOrderItemCommercialValues({
      orderedQuantity: 10,
      canceledQuantity: 0,
      grossUnitPrice: 12.5,
      netTotalValue: 125,
    });
    assert.equal(r.discountStatus, "NO_DISCOUNT");
    assert.equal(r.effectiveDiscountValue, 0);
    assert.equal(r.effectiveDiscountRate, 0);
    assert.equal(r.effectiveNetUnitPrice, 12.5);
    assert.equal(r.isComplete, true);
  });

  it("descontos diferentes por item", () => {
    const a = resolveSalesOrderItemCommercialValues({
      orderedQuantity: 100,
      grossUnitPrice: 10,
      netTotalValue: 900, // 10%
    });
    const b = resolveSalesOrderItemCommercialValues({
      orderedQuantity: 100,
      grossUnitPrice: 10,
      netTotalValue: 950, // 5%
    });
    assert.equal(roundPricingPercent(a.effectiveDiscountRate * 100), 10);
    assert.equal(roundPricingPercent(b.effectiveDiscountRate * 100), 5);
    assert.notEqual(a.effectiveDiscountValue, b.effectiveDiscountValue);
  });

  it("desconto informado divergente gera warning e não reaplica", () => {
    const r = resolveSalesOrderItemCommercialValues({
      orderedQuantity: 400,
      grossUnitPrice: 4.32,
      netTotalValue: 1641.6,
      informedDiscountRate: 0.1, // informado 10%, efetivo 5%
      informedDiscountValue: 200,
    });
    assert.equal(r.isComplete, true);
    assert.equal(r.effectiveDiscountValue, 86.4);
    assert.equal(r.effectiveNetUnitPrice, 4.104);
    assert.ok(r.warnings.some((w) => w.includes("DISCOUNT_RATE_MISMATCH")));
    assert.ok(r.warnings.some((w) => w.includes("DISCOUNT_VALUE_MISMATCH")));
  });

  it("cancelamento parcial proporcionaliza o líquido da quantidade pedida", () => {
    const r = resolveSalesOrderItemCommercialValues({
      orderedQuantity: 400,
      canceledQuantity: 100,
      grossUnitPrice: 4.32,
      netTotalValue: 1641.6, // líquido da qtd pedida 400
      netValueQuantityBasis: "ORDERED",
    });
    assert.equal(r.activeQuantity, 300);
    assert.equal(r.grossActiveValue, 1296);
    // (1641.6/400)*300 = 1231.2
    assert.equal(r.netActiveValue, 1231.2);
    assert.equal(r.effectiveNetUnitPrice, 4.104);
    assert.equal(r.isComplete, true);
  });

  it("líquido já na quantidade ativa não proporcionaliza de novo", () => {
    const r = resolveSalesOrderItemCommercialValues({
      orderedQuantity: 400,
      canceledQuantity: 100,
      grossUnitPrice: 4.32,
      netTotalValue: 1231.2, // já da qtd ativa 300
      netValueQuantityBasis: "ACTIVE",
    });
    assert.equal(r.activeQuantity, 300);
    assert.equal(r.netActiveValue, 1231.2);
    assert.equal(r.effectiveNetUnitPrice, 4.104);
  });

  it("cancelamento total → NO_ACTIVE_VALUE sem erro", () => {
    const r = resolveSalesOrderItemCommercialValues({
      orderedQuantity: 100,
      canceledQuantity: 100,
      grossUnitPrice: 5.97,
      netTotalValue: 567.15,
    });
    assert.equal(r.activeQuantity, 0);
    assert.equal(r.discountStatus, "NO_ACTIVE_VALUE");
    assert.equal(r.isComplete, true);
    assert.equal(r.reasonCode, null);
    assert.equal(r.grossActiveValue, 0);
    assert.equal(r.netActiveValue, 0);
  });

  it("isFullyCanceled zera quantidade ativa", () => {
    const r = resolveSalesOrderItemCommercialValues({
      orderedQuantity: 100,
      canceledQuantity: 0,
      isFullyCanceled: true,
      grossUnitPrice: 5.97,
      netTotalValue: 567.15,
    });
    assert.equal(r.activeQuantity, 0);
    assert.equal(r.discountStatus, "NO_ACTIVE_VALUE");
  });

  it("acréscimo comercial separado (sem desconto negativo)", () => {
    const r = resolveSalesOrderItemCommercialValues({
      orderedQuantity: 10,
      grossUnitPrice: 10,
      netTotalValue: 110,
    });
    assert.equal(r.discountStatus, "ADDITION");
    assert.equal(r.effectiveDiscountValue, 0);
    assert.equal(r.effectiveDiscountRate, 0);
    assert.equal(r.commercialAdditionValue, 10);
    assert.equal(r.commercialAdditionRate, 0.1);
    assert.equal(r.effectiveNetUnitPrice, 11);
  });

  it("valor líquido ausente → NET_SOLD_VALUE_NOT_FOUND (sem fallback bruto)", () => {
    const r = resolveSalesOrderItemCommercialValues({
      orderedQuantity: 10,
      grossUnitPrice: 4.32,
      netTotalValue: null,
    });
    assert.equal(r.isComplete, false);
    assert.equal(r.reasonCode, "NET_SOLD_VALUE_NOT_FOUND");
    assert.equal(r.netActiveValue, null);
    assert.equal(r.effectiveNetUnitPrice, null);
    assert.equal(r.grossActiveValue, 43.2);
  });

  it("valor líquido zero inválido com qtd ativa", () => {
    const r = resolveSalesOrderItemCommercialValues({
      orderedQuantity: 10,
      grossUnitPrice: 4.32,
      netTotalValue: 0,
    });
    assert.equal(r.isComplete, false);
    assert.equal(r.reasonCode, "NET_SOLD_VALUE_NOT_FOUND");
  });

  it("preço unitário bruto inválido", () => {
    const r = resolveSalesOrderItemCommercialValues({
      orderedQuantity: 10,
      grossUnitPrice: 0,
      netTotalValue: 50,
    });
    assert.equal(r.isComplete, false);
    assert.equal(r.reasonCode, "INVALID_GROSS_UNIT_PRICE");
  });

  it("preserva precisão de quatro casas no unitário líquido", () => {
    const a = resolveSalesOrderItemCommercialValues(PD02820.item10);
    const b = resolveSalesOrderItemCommercialValues(PD02820.item20);
    assert.equal(a.effectiveNetUnitPrice, 4.104);
    assert.equal(b.effectiveNetUnitPrice, 5.6715);
    // Não colapsar para 2 casas.
    assert.notEqual(Number(a.effectiveNetUnitPrice!.toFixed(2)), a.effectiveNetUnitPrice);
  });

  it("valida bruto oficial incoerente com warning", () => {
    const r = resolveSalesOrderItemCommercialValues({
      orderedQuantity: 400,
      grossUnitPrice: 4.32,
      grossTotalValue: 9999,
      netTotalValue: 1641.6,
    });
    assert.equal(r.isComplete, true);
    assert.ok(r.warnings.some((w) => /Bruto oficial/.test(w)));
  });

  it("normalizeInformedDiscountRate aceita 5 e 0.05", () => {
    assert.equal(normalizeInformedDiscountRate(5), 0.05);
    assert.equal(normalizeInformedDiscountRate(0.05), 0.05);
    assert.equal(normalizeInformedDiscountRate(null), null);
  });

  it("função é pura — mesmas entradas, mesma saída", () => {
    const input = { ...PD02820.item10 };
    const a = resolveSalesOrderItemCommercialValues(input);
    const b = resolveSalesOrderItemCommercialValues(input);
    assert.deepEqual(a, b);
  });
});

describe("resolveSalesOrderItemCommercialValues — política", () => {
  it("módulo não importa Prisma nem Proposal", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(
      join(process.cwd(), "src/lib/salesOrderItemCommercialValues.ts"),
      "utf8"
    );
    assert.doesNotMatch(src, /@prisma\/client/);
    assert.doesNotMatch(src, /prisma\./i);
    assert.doesNotMatch(src, /Proposal/);
    assert.doesNotMatch(src, /proposalId/);
  });
});
