import test from "node:test";
import assert from "node:assert/strict";
import { buildPricingUnitCalculationBreakdown } from "./pricingUnitCalculationBreakdown.js";

test("ponte linear fecha com o modelo divisor (PV = CIU + F + parcelas sobre PV)", () => {
  const ciu = 1.164301;
  const freight = 0.05;
  const taxRate = 0.18;
  const commRate = 0.05;
  const otherRate = 0.0425;
  const marginRate = 0.15;
  const divisor = 1 - taxRate - commRate - otherRate - marginRate;
  const suggestedPrice = (ciu + freight) / divisor;

  const totalTaxes = suggestedPrice * taxRate;
  const totalCommission = suggestedPrice * commRate;
  const totalOther = suggestedPrice * otherRate;

  const b = buildPricingUnitCalculationBreakdown({
    custoFabril: ciu,
    custoGerencial: ciu + 0.1,
    totalMaterialCost: 0.5,
    totalHH_Unit: 0.3,
    totalHM_Unit: 0.364301,
    totalCIF_Unit: 0.02,
    totalOPEX_Unit: 0.1,
    taxRuleName: "Teste",
    taxRuleId: "uuid",
    taxRate,
    commRate,
    marginRate,
    otherRate,
    freight,
    divisor,
    suggestedPrice,
    totalTaxes,
    totalCommission,
    totalOther,
    contributionMargin: suggestedPrice - totalTaxes - totalCommission - freight - ciu,
    operationalMargin: 0,
    openBookConsolidatedMaterials: null,
    bomMaterialsDetail: null,
    processBreakdown: null,
  });

  const sum =
    ciu +
    freight +
    totalTaxes +
    totalCommission +
    totalOther +
    suggestedPrice * marginRate;
  assert.ok(Math.abs(sum - suggestedPrice) < 1e-6);
  assert.ok(Math.abs(b.priceBridge.lines.reduce((a, l) => a + l.amount, 0) - suggestedPrice) < 1e-6);
});
