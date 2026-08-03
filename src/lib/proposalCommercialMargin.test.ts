import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  calculateCommercialMarginFromNetUnitPrice,
  calculateSalePriceFromCommercialMarginRates,
  resolveCommercialCommissionFromTiers,
  type CommercialMarginTier,
} from "./commercialMarginCore.js";
import {
  calculatePriceTableItemFromFrozenCost,
  calculateCommercialMarginRateFromNegotiatedPrice,
} from "./priceTablePublication.js";
import {
  calculateProposalItemCommercialMargin,
  summarizeProposalCommercialMargins,
  unavailableProposalCommercialMarginItem,
} from "./proposalCommercialMargin.js";
import { resolveProposalItemCommercialValues } from "./proposalItemCommercialValues.js";
import { roundPricingMoney, roundPricingPercent } from "./pricingCalculations.js";

const TAX = 0.2875;
const OTHER = 0.02;
const FREIGHT_RATE = 0.03;
const FREIGHT_ABS = 0;
const COST = 100;

/** Faixas variáveis — NÃO hardcoded no motor (só fixture de teste). */
const VARIABLE_BANDS = [
  { marginPct: 33, commissionPercent: 6 },
  { marginPct: 48, commissionPercent: 4.5 },
  { marginPct: 57.5, commissionPercent: 3 },
] as const;

/**
 * Gera o preço líquido de uma faixa comercial usando o núcleo neutro
 * (mesma fórmula que `calculateCommercialMarginFromNetUnitPrice` reconhece:
 * frete% no divisor, por preço). Não usa `calculatePriceTableItemFromFrozenCost`
 * — desde a correção do motor de Tabela de Preço, frete% lá é sobre o CUSTO
 * (fora do divisor), formato diferente do núcleo usado por Proposta/Pedido.
 */
function formPrice(marginPercent: number, commissionPercent: number) {
  const formed = calculateSalePriceFromCommercialMarginRates({
    frozenCostUnit: COST,
    taxRate: TAX,
    commissionRate: commissionPercent / 100,
    freightRate: FREIGHT_RATE,
    freightAbsoluteUnit: FREIGHT_ABS,
    otherVariablesRate: OTHER,
    marginRate: marginPercent / 100,
  });
  assert.equal(formed.ok, true);
  if (!formed.ok) throw new Error(formed.message);
  return formed.salePrice;
}

function buildVariableTiers(): CommercialMarginTier[] {
  return VARIABLE_BANDS.map((band, index) => ({
    id: `band-${band.marginPct}`,
    marginRate: band.marginPct / 100,
    salePrice: formPrice(band.marginPct, band.commissionPercent),
    commissionRate: band.commissionPercent / 100,
    order: index + 1,
  }));
}

function assertCompositionCloses(
  item: ReturnType<typeof calculateProposalItemCommercialMargin>
) {
  assert.equal(item.isComplete, true);
  assert.ok(item.finalNetLineValue != null && item.commercialMarginValue != null);
  const residual = roundPricingMoney(
    item.finalNetLineValue! -
      (item.costValue ?? 0) -
      (item.taxValue ?? 0) -
      (item.commissionValue ?? 0) -
      (item.freightRateValue ?? 0) -
      (item.freightAbsoluteValue ?? 0) -
      (item.otherVariablesValue ?? 0)
  );
  assert.ok(
    Math.abs(residual - (item.commercialMarginValue ?? 0)) <= 0.02,
    `composição não fecha: residual=${residual} margem=${item.commercialMarginValue}`
  );
}

describe("proposalCommercialMargin — faixas variáveis", () => {
  const tiers = buildVariableTiers();
  const p33 = tiers[0]!.salePrice;
  const p48 = tiers[1]!.salePrice;
  const p575 = tiers[2]!.salePrice;

  it("1. preço líquido exato da faixa 33%", () => {
    const item = calculateProposalItemCommercialMargin({
      quantity: 2,
      negotiatedGrossUnitPrice: p33,
      finalNetUnitPrice: p33,
      finalNetLineValue: roundPricingMoney(2 * p33),
      frozenCostUnit: COST,
      taxRate: TAX,
      freightRate: FREIGHT_RATE,
      freightAbsoluteUnit: FREIGHT_ABS,
      otherVariablesRate: OTHER,
      tiers,
      formationContextId: "ctx-33",
      referenceDate: "2024-06-01",
    });
    assert.equal(item.isComplete, true);
    assert.equal(item.tierPosition, "EXACT_TIER");
    assert.equal(item.exactTier?.id, "band-33");
    assert.equal(item.commercialMarginPercent, 33);
    assert.equal(item.commissionRate, 0.06);
    assertCompositionCloses(item);
  });

  it("2. preço líquido exato da faixa 48%", () => {
    const item = calculateProposalItemCommercialMargin({
      quantity: 1,
      negotiatedGrossUnitPrice: p48,
      finalNetUnitPrice: p48,
      frozenCostUnit: COST,
      taxRate: TAX,
      freightRate: FREIGHT_RATE,
      freightAbsoluteUnit: FREIGHT_ABS,
      otherVariablesRate: OTHER,
      tiers,
      formationContextId: "ctx-48",
    });
    assert.equal(item.isComplete, true);
    assert.equal(item.tierPosition, "EXACT_TIER");
    assert.equal(item.commercialMarginPercent, 48);
    assert.equal(item.commissionRate, 0.045);
  });

  it("3. preço entre 33% e 48% — comissão proporcional; margem pela inversa", () => {
    const mid = (p33 + p48) / 2;
    const tierRes = resolveCommercialCommissionFromTiers({
      netUnitPrice: mid,
      tiers,
    });
    assert.equal(tierRes.ok, true);
    if (!tierRes.ok) throw new Error(tierRes.message);
    assert.equal(tierRes.position.position, "BETWEEN_TIERS");
    assert.ok(
      tierRes.commissionRate != null &&
        tierRes.commissionRate < 0.06 &&
        tierRes.commissionRate > 0.045
    );

    const item = calculateProposalItemCommercialMargin({
      quantity: 1,
      negotiatedGrossUnitPrice: mid,
      finalNetUnitPrice: mid,
      frozenCostUnit: COST,
      taxRate: TAX,
      freightRate: FREIGHT_RATE,
      freightAbsoluteUnit: FREIGHT_ABS,
      otherVariablesRate: OTHER,
      tiers,
      formationContextId: "ctx-mid-33-48",
    });
    assert.equal(item.isComplete, true);
    assert.equal(item.tierPosition, "BETWEEN_TIERS");
    assert.ok((item.commercialMarginPercent ?? 0) > 33);
    assert.ok((item.commercialMarginPercent ?? 0) < 48);
    assert.notEqual(
      roundPricingPercent(item.commercialMarginPercent ?? 0),
      roundPricingPercent((33 + 48) / 2)
    );
  });

  it("4. preço entre 48% e 57,5%", () => {
    const mid = (p48 + p575) / 2;
    const item = calculateProposalItemCommercialMargin({
      quantity: 1,
      negotiatedGrossUnitPrice: mid,
      finalNetUnitPrice: mid,
      frozenCostUnit: COST,
      taxRate: TAX,
      freightRate: FREIGHT_RATE,
      freightAbsoluteUnit: FREIGHT_ABS,
      otherVariablesRate: OTHER,
      tiers,
      formationContextId: "ctx-mid-48-575",
    });
    assert.equal(item.isComplete, true);
    assert.equal(item.tierPosition, "BETWEEN_TIERS");
    assert.ok((item.commercialMarginPercent ?? 0) > 48);
    assert.ok((item.commercialMarginPercent ?? 0) < 57.5);
  });

  it("5. abaixo da menor faixa", () => {
    const below = p33 - 20;
    const item = calculateProposalItemCommercialMargin({
      quantity: 1,
      negotiatedGrossUnitPrice: below,
      finalNetUnitPrice: below,
      frozenCostUnit: COST,
      taxRate: TAX,
      freightRate: FREIGHT_RATE,
      freightAbsoluteUnit: FREIGHT_ABS,
      otherVariablesRate: OTHER,
      tiers,
      formationContextId: "ctx-below",
    });
    assert.equal(item.isComplete, true);
    assert.equal(item.tierPosition, "BELOW_LOWEST");
    assert.equal(item.commissionRate, 0.01);
    assert.ok(item.warnings.some((w) => /comissão mínima de 1%/i.test(w)));
  });

  it("5b. comissão 1% suja como fração 1.0 não vira 100%", () => {
    const dirtyTiers: CommercialMarginTier[] = [
      { id: "atacado", marginRate: 0.33, salePrice: p33, commissionRate: 1 },
      { id: "varejo3", marginRate: 0.575, salePrice: p575, commissionRate: 3 },
    ];
    const item = calculateProposalItemCommercialMargin({
      quantity: 30,
      negotiatedGrossUnitPrice: 9.98,
      finalNetUnitPrice: 9.98,
      frozenCostUnit: 3.94,
      taxRate: 0.2675,
      freightRate: 0.03,
      freightAbsoluteUnit: 0,
      otherVariablesRate: 0,
      tiers: dirtyTiers,
      formationContextId: "ctx-dirty-1pct",
    });
    assert.equal(item.isComplete, true);
    assert.equal(item.tierPosition, "BELOW_LOWEST");
    assert.equal(item.commissionRate, 0.01);
    assert.ok(
      (item.commissionRate ?? 0) <= 0.03 + 1e-9,
      `comissão esperada ≤3%, obteve ${item.commissionRate}`
    );
    assert.ok(
      (item.commercialMarginPercent ?? -999) > -50,
      `margem não deve colapsar com comissão 100%; obteve ${item.commercialMarginPercent}%`
    );
  });

  it("5c. commissionRate fornecido = 1 (1%) não vira 100% — caso 301.40AA", () => {
    const item = calculateProposalItemCommercialMargin({
      quantity: 30,
      negotiatedGrossUnitPrice: 9.98,
      finalNetUnitPrice: 9.98,
      frozenCostUnit: 3.94,
      taxRate: 0.2675,
      freightRate: 0.03,
      freightAbsoluteUnit: 0,
      otherVariablesRate: 0,
      commissionRate: 1,
      tiers,
      formationContextId: "ctx-provided-1pct",
    });
    assert.equal(item.isComplete, true);
    assert.equal(item.commissionRate, 0.01);
    assert.ok(Math.abs((item.commissionValue ?? 0) - 2.99) < 0.02);
    assert.ok(
      (item.commercialMarginPercent ?? -999) > -50,
      `margem colapsada: ${item.commercialMarginPercent}%`
    );
  });

  it("6. acima da maior faixa", () => {
    const above = p575 + 40;
    const item = calculateProposalItemCommercialMargin({
      quantity: 1,
      negotiatedGrossUnitPrice: above,
      finalNetUnitPrice: above,
      frozenCostUnit: COST,
      taxRate: TAX,
      freightRate: FREIGHT_RATE,
      freightAbsoluteUnit: FREIGHT_ABS,
      otherVariablesRate: OTHER,
      tiers,
      formationContextId: "ctx-above",
    });
    assert.equal(item.isComplete, true);
    assert.equal(item.tierPosition, "ABOVE_HIGHEST");
    assert.equal(item.commissionRate, 0.03);
    assert.ok((item.commercialMarginPercent ?? 0) > 57.5);
  });

  it("7. desconto mudando a faixa", () => {
    const gross = p48;
    const net = p33;
    const values = resolveProposalItemCommercialValues({
      quantity: 10,
      referenceTableUnitPrice: p48,
      negotiatedGrossUnitPrice: gross,
      finalNetUnitPrice: net,
      finalNetLineValue: roundPricingMoney(10 * net),
    });
    assert.equal(values.isComplete, true);

    const grossTier = resolveCommercialCommissionFromTiers({
      netUnitPrice: gross,
      tiers,
    });
    const netTier = resolveCommercialCommissionFromTiers({
      netUnitPrice: net,
      tiers,
    });
    assert.equal(grossTier.ok, true);
    assert.equal(netTier.ok, true);
    if (!grossTier.ok || !netTier.ok) throw new Error("tier");
    assert.notEqual(grossTier.commissionRate, netTier.commissionRate);

    const item = calculateProposalItemCommercialMargin({
      quantity: 10,
      referenceTableUnitPrice: p48,
      negotiatedGrossUnitPrice: gross,
      finalNetUnitPrice: net,
      finalNetLineValue: values.finalNetLineValue,
      frozenCostUnit: COST,
      taxRate: TAX,
      freightRate: FREIGHT_RATE,
      freightAbsoluteUnit: FREIGHT_ABS,
      otherVariablesRate: OTHER,
      tiers,
      formationContextId: "ctx-discount-tier-shift",
    });
    assert.equal(item.commissionRate, netTier.commissionRate);
    assert.notEqual(item.commissionRate, grossTier.commissionRate);
    assert.equal(item.finalNetUnitPrice, roundPricingMoney(net));
  });

  it("8. alteração manual mais desconto", () => {
    const values = resolveProposalItemCommercialValues({
      quantity: 5,
      referenceTableUnitPrice: p48,
      negotiatedGrossUnitPrice: p33,
      informedDiscountRate: 0.05,
    });
    assert.equal(values.isComplete, true);
    assert.ok((values.manualPriceReduction ?? 0) > 0);
    assert.ok((values.explicitDiscount ?? 0) > 0);
    assert.ok((values.totalCommercialConcession ?? 0) > 0);

    const item = calculateProposalItemCommercialMargin({
      quantity: 5,
      referenceTableUnitPrice: p48,
      negotiatedGrossUnitPrice: p33,
      informedDiscountRate: 0.05,
      frozenCostUnit: COST,
      taxRate: TAX,
      freightRate: FREIGHT_RATE,
      freightAbsoluteUnit: FREIGHT_ABS,
      otherVariablesRate: OTHER,
      tiers,
      formationContextId: "ctx-manual-discount",
    });
    assert.equal(item.isComplete, true);
    assert.ok((item.manualPriceReduction ?? 0) > 0);
    assert.ok((item.explicitDiscount ?? 0) > 0);
    assert.equal(item.finalNetUnitPrice, values.finalNetUnitPrice);
    assertCompositionCloses(item);
  });

  it("9. margem negativa", () => {
    const item = calculateProposalItemCommercialMargin({
      quantity: 1,
      negotiatedGrossUnitPrice: 120,
      finalNetUnitPrice: 120,
      frozenCostUnit: COST,
      taxRate: TAX,
      freightRate: FREIGHT_RATE,
      freightAbsoluteUnit: FREIGHT_ABS,
      otherVariablesRate: OTHER,
      tiers,
      formationContextId: "ctx-neg",
    });
    assert.equal(item.isComplete, true);
    assert.ok((item.commercialMarginPercent ?? 0) < 0);
    assertCompositionCloses(item);
  });

  it("10. total ponderado", () => {
    const a = calculateProposalItemCommercialMargin({
      quantity: 10,
      negotiatedGrossUnitPrice: p33,
      finalNetUnitPrice: p33,
      frozenCostUnit: COST,
      taxRate: TAX,
      freightRate: FREIGHT_RATE,
      freightAbsoluteUnit: FREIGHT_ABS,
      otherVariablesRate: OTHER,
      tiers,
      formationContextId: "a",
    });
    const b = calculateProposalItemCommercialMargin({
      quantity: 1,
      negotiatedGrossUnitPrice: p575,
      finalNetUnitPrice: p575,
      frozenCostUnit: COST,
      taxRate: TAX,
      freightRate: FREIGHT_RATE,
      freightAbsoluteUnit: FREIGHT_ABS,
      otherVariablesRate: OTHER,
      tiers,
      formationContextId: "b",
    });
    const summary = summarizeProposalCommercialMargins([a, b]);
    assert.equal(summary.isComplete, true);
    assert.equal(summary.itemsCalculated, 2);
    const expectedPct = roundPricingPercent(
      ((a.commercialMarginValue! + b.commercialMarginValue!) /
        (a.finalNetLineValue! + b.finalNetLineValue!)) *
        100
    );
    assert.equal(summary.proposalCommercialMarginTotalPercent, expectedPct);
    assert.notEqual(
      summary.proposalCommercialMarginTotalPercent,
      roundPricingPercent(((a.commercialMarginPercent ?? 0) + (b.commercialMarginPercent ?? 0)) / 2)
    );
  });

  it("11. cobertura parcial", () => {
    const ok = calculateProposalItemCommercialMargin({
      quantity: 9,
      negotiatedGrossUnitPrice: p33,
      finalNetUnitPrice: p33,
      finalNetLineValue: roundPricingMoney(9 * p33),
      frozenCostUnit: COST,
      taxRate: TAX,
      freightRate: FREIGHT_RATE,
      freightAbsoluteUnit: FREIGHT_ABS,
      otherVariablesRate: OTHER,
      tiers,
      formationContextId: "ok",
    });
    const bad = unavailableProposalCommercialMarginItem({
      quantity: 1,
      finalNetUnitPrice: p33,
      finalNetLineValue: p33,
      reasonCode: "COST_NOT_FOUND",
    });
    const totalNet = roundPricingMoney((ok.finalNetLineValue ?? 0) + p33);
    const summary = summarizeProposalCommercialMargins([ok, bad], {
      proposalTotalNetValue: totalNet,
    });
    assert.equal(summary.isComplete, false);
    assert.equal(summary.itemsCalculated, 1);
    assert.equal(summary.itemsUnavailable, 1);
    assert.ok(summary.reasonCodes.includes("COST_NOT_FOUND"));
    assert.equal(
      summary.proposalMarginCoveragePercent,
      roundPricingPercent(((ok.finalNetLineValue ?? 0) / totalNet) * 100)
    );
  });
});

describe("proposalCommercialMargin — ausência ≠ zero e reasonCodes", () => {
  const tiers = buildVariableTiers();
  const p33 = tiers[0]!.salePrice;

  it("taxRate ausente → TAX_NOT_FOUND (não vira zero)", () => {
    const item = calculateProposalItemCommercialMargin({
      quantity: 1,
      negotiatedGrossUnitPrice: p33,
      finalNetUnitPrice: p33,
      frozenCostUnit: COST,
      taxRate: null,
      freightRate: FREIGHT_RATE,
      freightAbsoluteUnit: FREIGHT_ABS,
      otherVariablesRate: OTHER,
      tiers,
    });
    assert.equal(item.reasonCode, "TAX_NOT_FOUND");
    assert.equal(item.isComplete, false);
  });

  it("zeros explícitos de frete/outros são válidos", () => {
    const formed = calculatePriceTableItemFromFrozenCost(COST, {
      taxRate: TAX,
      commissionRate: 0.06,
      otherRate: 0,
      freightRate: 0,
      freight: 0,
      marginRate: 0.33,
    });
    assert.equal(formed.ok, true);
    if (!formed.ok) throw new Error(formed.message);
    const item = calculateProposalItemCommercialMargin({
      quantity: 1,
      negotiatedGrossUnitPrice: formed.result.salePrice,
      finalNetUnitPrice: formed.result.salePrice,
      frozenCostUnit: COST,
      taxRate: TAX,
      freightRate: 0,
      freightAbsoluteUnit: 0,
      otherVariablesRate: 0,
      commissionRate: 0.06,
      formationContextId: "zeros",
    });
    assert.equal(item.isComplete, true);
    assert.equal(item.freightRate, 0);
    assert.equal(item.otherVariablesRate, 0);
    assert.equal(item.commercialMarginPercent, 33);
  });

  it("preço líquido ausente → FINAL_NET_PRICE_NOT_FOUND", () => {
    const item = calculateProposalItemCommercialMargin({
      quantity: 1,
      negotiatedGrossUnitPrice: 0,
      finalNetUnitPrice: null,
      frozenCostUnit: COST,
      taxRate: TAX,
      freightRate: FREIGHT_RATE,
      freightAbsoluteUnit: FREIGHT_ABS,
      otherVariablesRate: OTHER,
      tiers,
    });
    assert.equal(item.reasonCode, "FINAL_NET_PRICE_NOT_FOUND");
  });

  it("forceReasonCode PRICE_TABLE_NOT_SELECTED", () => {
    const item = calculateProposalItemCommercialMargin({
      quantity: 1,
      negotiatedGrossUnitPrice: p33,
      finalNetUnitPrice: p33,
      forceReasonCode: "PRICE_TABLE_NOT_SELECTED",
    });
    assert.equal(item.reasonCode, "PRICE_TABLE_NOT_SELECTED");
    assert.equal(item.calculationSource, "UNAVAILABLE");
  });
});

describe("proposalCommercialMargin — equivalência matemática neutra", () => {
  it("mesmas entradas econômicas → mesma margem (núcleo ≡ Proposta)", () => {
    const tiers = buildVariableTiers();
    const net = tiers[1]!.salePrice;
    const commissionRate = 0.045;
    const qty = 3;
    const netLine = roundPricingMoney(qty * net);

    const neutral = calculateCommercialMarginFromNetUnitPrice({
      netUnitPrice: net,
      quantity: qty,
      frozenCostUnit: COST,
      taxRate: TAX,
      commissionRate,
      freightRate: FREIGHT_RATE,
      freightAbsoluteUnit: FREIGHT_ABS,
      otherVariablesRate: OTHER,
    });
    assert.equal(neutral.ok, true);
    if (!neutral.ok) throw new Error(neutral.message);

    const proposal = calculateProposalItemCommercialMargin({
      quantity: qty,
      negotiatedGrossUnitPrice: net,
      finalNetUnitPrice: net,
      finalNetLineValue: netLine,
      frozenCostUnit: COST,
      taxRate: TAX,
      freightRate: FREIGHT_RATE,
      freightAbsoluteUnit: FREIGHT_ABS,
      otherVariablesRate: OTHER,
      commissionRate,
      formationContextId: "equiv",
    });
    assert.equal(proposal.isComplete, true);
    assert.equal(
      roundPricingPercent(proposal.commercialMarginPercent ?? 0),
      roundPricingPercent(neutral.commercialMarginPercent)
    );
    assert.equal(
      proposal.commercialMarginValue,
      roundPricingMoney(netLine * neutral.commercialMarginRate)
    );
  });

  it("Pedido/Tabela de Preço diverge do núcleo de propósito quando há frete% (frete agora é sobre custo, não sobre preço)", () => {
    const commissionRate = 0.045;
    const net = 250;

    const neutral = calculateCommercialMarginFromNetUnitPrice({
      netUnitPrice: net,
      quantity: 1,
      frozenCostUnit: COST,
      taxRate: TAX,
      commissionRate,
      freightRate: FREIGHT_RATE,
      freightAbsoluteUnit: FREIGHT_ABS,
      otherVariablesRate: OTHER,
    });
    assert.equal(neutral.ok, true);
    if (!neutral.ok) throw new Error(neutral.message);

    const pedidoScenario = calculateCommercialMarginRateFromNegotiatedPrice({
      negotiatedUnitPrice: net,
      frozenTotalCost: COST,
      rates: {
        taxRate: TAX,
        commissionRate,
        otherRate: OTHER,
        freightRate: FREIGHT_RATE,
        freight: FREIGHT_ABS,
      },
    });
    assert.equal(pedidoScenario.ok, true);
    if (!pedidoScenario.ok) throw new Error(pedidoScenario.message);

    // Divergem porque o frete% do Pedido/Tabela de Preço não é mais fração do
    // preço (ver priceTablePublication.ts) — ver regressão dedicada em
    // priceTablePublication.test.ts ("frete 3% do custo não escala com a margem").
    assert.notEqual(
      roundPricingPercent(neutral.commercialMarginPercent),
      roundPricingPercent(pedidoScenario.marginPercent)
    );

    // Com freightRate=0 (sem frete%), os dois modelos coincidem novamente.
    const noFreight = calculateCommercialMarginFromNetUnitPrice({
      netUnitPrice: net,
      quantity: 1,
      frozenCostUnit: COST,
      taxRate: TAX,
      commissionRate,
      freightRate: 0,
      freightAbsoluteUnit: FREIGHT_ABS,
      otherVariablesRate: OTHER,
    });
    const pedidoNoFreight = calculateCommercialMarginRateFromNegotiatedPrice({
      negotiatedUnitPrice: net,
      frozenTotalCost: COST,
      rates: {
        taxRate: TAX,
        commissionRate,
        otherRate: OTHER,
        freightRate: 0,
        freight: FREIGHT_ABS,
      },
    });
    assert.equal(noFreight.ok, true);
    assert.equal(pedidoNoFreight.ok, true);
    if (noFreight.ok && pedidoNoFreight.ok) {
      assert.equal(
        roundPricingPercent(noFreight.commercialMarginPercent),
        roundPricingPercent(pedidoNoFreight.marginPercent)
      );
    }
  });
});

describe("proposalCommercialMargin — independência do Pedido", () => {
  it("módulos da Proposta não importam SalesOrder / Pedido", () => {
    for (const file of [
      "src/lib/proposalCommercialMargin.ts",
      "src/lib/proposalItemCommercialValues.ts",
    ]) {
      const src = readFileSync(join(process.cwd(), file), "utf8");
      assert.doesNotMatch(src, /salesOrderCommercialMargin/);
      assert.doesNotMatch(src, /salesOrderMarginService/);
      assert.doesNotMatch(src, /salesOrderItemCommercialValues/);
      assert.doesNotMatch(src, /SalesOrderItem/);
      assert.doesNotMatch(src, /prisma\.salesOrder/i);
    }
  });

  it("motor não hardcoda faixas ATACADO/VAREJO nem margens 30/40/50/60", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/proposalCommercialMargin.ts"),
      "utf8"
    );
    assert.doesNotMatch(src, /ATACADO/);
    assert.doesNotMatch(src, /VAREJO_1/);
    assert.doesNotMatch(src, /0\.30|0\.40|0\.50|0\.60/);
  });
});
