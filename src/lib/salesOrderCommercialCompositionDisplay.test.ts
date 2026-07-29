import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PD02820_COMMERCIAL_DISPLAY_FIXTURE,
  buildOrderCommercialCompositionTooltipLines,
  buildSalesOrderItemCommercialMarginCompositionTooltipText,
  formatCommercialDiscountCompact,
  formatCommercialMarginUnavailableReason,
  formatDiscountRatePercentPtBr,
  formatListCommercialMarginPercentLabel,
  formatPartialCommercialMarginHint,
  resolveItemCommercialCompositionForDisplay,
  resolvePd02820CommercialCompositionTotals,
  summarizeCommercialCompositionForDisplay,
  SALES_ORDER_COMMERCIAL_COMPOSITION_LABELS,
} from "./salesOrderCommercialCompositionDisplay.js";
import { buildOfficialSalesOrderMarginTooltipText } from "./salesOrderMarginDisplay.js";
import { unavailableCommercialMarginItem } from "./salesOrderCommercialMargin.js";
import { roundPricingPercent } from "./pricingCalculations.js";

describe("salesOrderCommercialCompositionDisplay — labels e formatação", () => {
  it("labels canônicos em pt-BR", () => {
    assert.equal(
      SALES_ORDER_COMMERCIAL_COMPOSITION_LABELS.grossItems,
      "Valor bruto dos itens"
    );
    assert.equal(
      SALES_ORDER_COMMERCIAL_COMPOSITION_LABELS.discountValue,
      "Desconto concedido"
    );
    assert.equal(
      SALES_ORDER_COMMERCIAL_COMPOSITION_LABELS.netSold,
      "Valor líquido vendido"
    );
    assert.equal(
      SALES_ORDER_COMMERCIAL_COMPOSITION_LABELS.unavailable,
      "Margem não calculada"
    );
    assert.equal(
      SALES_ORDER_COMMERCIAL_COMPOSITION_LABELS.partial,
      "Margem comercial parcial"
    );
  });

  it("formatação percentual pt-BR com 2 casas", () => {
    assert.equal(formatDiscountRatePercentPtBr(0.05), "5,00%");
    assert.equal(formatDiscountRatePercentPtBr(0), "0,00%");
  });

  it("desconto zero → compacto —", () => {
    assert.equal(
      formatCommercialDiscountCompact({
        discountRate: 0,
        discountValue: 0,
        discountStatus: "NO_DISCOUNT",
      }),
      "—"
    );
  });

  it("desconto de 5%", () => {
    const label = formatCommercialDiscountCompact({
      discountRate: 0.05,
      discountValue: 86.4,
      discountStatus: "DISCOUNT",
    });
    assert.match(label, /5,00%/);
  });

  it("acréscimo comercial", () => {
    const label = formatCommercialDiscountCompact({
      discountRate: 0,
      discountValue: 0,
      additionRate: 0.1,
      additionValue: 10,
      discountStatus: "ADDITION",
    });
    assert.match(label, /\+/);
    assert.match(label, /10,00%/);
  });
});

describe("salesOrderCommercialCompositionDisplay — PD 02820", () => {
  it("totais bruto 2922, desconto 146,10 (5%), líquido 2775,90", () => {
    const totals = resolvePd02820CommercialCompositionTotals();
    assert.equal(
      totals.grossActiveTotalValue,
      PD02820_COMMERCIAL_DISPLAY_FIXTURE.expected.grossActiveTotalValue
    );
    assert.equal(
      totals.discountTotalValue,
      PD02820_COMMERCIAL_DISPLAY_FIXTURE.expected.discountTotalValue
    );
    assert.equal(
      roundPricingPercent(totals.discountRate * 100),
      PD02820_COMMERCIAL_DISPLAY_FIXTURE.expected.discountRatePercent
    );
    assert.equal(
      totals.netActiveTotalValue,
      PD02820_COMMERCIAL_DISPLAY_FIXTURE.expected.netActiveTotalValue
    );
    assert.notEqual(totals.netActiveTotalValue, 2922);
  });

  it("itens com unitário líquido 4,1040 e 5,6715", () => {
    const rows = PD02820_COMMERCIAL_DISPLAY_FIXTURE.items.map((item) =>
      resolveItemCommercialCompositionForDisplay(item)
    );
    assert.equal(rows[0]!.effectiveNetUnitPrice, 4.104);
    assert.equal(rows[1]!.effectiveNetUnitPrice, 5.6715);
    assert.equal(rows[2]!.effectiveNetUnitPrice, 5.6715);
  });
});

describe("salesOrderCommercialCompositionDisplay — margem UI", () => {
  it("margem completa na listagem", () => {
    const label = formatListCommercialMarginPercentLabel({
      commercialMarginTotalValue: 500,
      commercialMarginTotalPercent: 22.5,
      commercialSoldTotalValue: 2775.9,
      totalActiveSoldValue: 2775.9,
      commercialMarginCoveragePercent: 100,
      itemsCalculated: 3,
      itemsUnavailable: 0,
      itemsActive: 3,
      isComplete: true,
      warnings: [],
    });
    assert.match(label, /22,50%/);
  });

  it("margem não calculada com reason traduzido", () => {
    assert.equal(
      formatCommercialMarginUnavailableReason("NET_SOLD_VALUE_NOT_FOUND"),
      "Valor líquido não encontrado."
    );
    assert.equal(
      formatCommercialMarginUnavailableReason("PRODUCT_WITHOUT_PRICE_FORMATION"),
      "Produto sem formação de preço cadastrada."
    );
    assert.equal(
      formatCommercialMarginUnavailableReason("COST_NOT_FOUND"),
      "Não encontramos custo válido para a data do Pedido."
    );
    assert.equal(
      formatCommercialMarginUnavailableReason("INCOMPLETE_MARGIN_TIERS"),
      "A formação de preço está incompleta (faixas)."
    );
    assert.equal(
      formatCommercialMarginUnavailableReason("HISTORICAL_FORMATION_AMBIGUOUS"),
      "Existem duas formações possíveis para essa data."
    );
    assert.equal(
      formatCommercialMarginUnavailableReason("COMMISSION_NOT_DEFINED"),
      "Não encontramos a regra de comissão."
    );

    const label = formatListCommercialMarginPercentLabel({
      commercialMarginTotalValue: null,
      commercialMarginTotalPercent: null,
      commercialSoldTotalValue: 0,
      totalActiveSoldValue: 100,
      commercialMarginCoveragePercent: 0,
      itemsCalculated: 0,
      itemsUnavailable: 2,
      itemsActive: 2,
      isComplete: false,
      warnings: ["Produto sem formação de preço cadastrada."],
    });
    assert.equal(label, "Margem não calculada");
  });

  it("cobertura parcial explicada", () => {
    const hint = formatPartialCommercialMarginHint({
      commercialMarginTotalValue: 200,
      commercialMarginTotalPercent: 20,
      commercialSoldTotalValue: 900,
      totalActiveSoldValue: 1000,
      commercialMarginCoveragePercent: 90,
      itemsCalculated: 2,
      itemsUnavailable: 1,
      itemsActive: 3,
      isComplete: false,
      warnings: [],
    });
    assert.ok(hint);
    assert.match(hint!, /Margem comercial parcial/);
    assert.match(hint!, /2 de 3 itens calculados/);
    assert.match(hint!, /90,00%/);
  });

  it("tooltip do pedido inclui bruto, desconto, líquido, margem e gerencial", () => {
    const composition = resolvePd02820CommercialCompositionTotals();
    const text = buildOfficialSalesOrderMarginTooltipText({
      summary: {
        netRevenue: 2775.9,
        totalCost: 1000,
        marginValue: 800,
        marginPercent: 28.8,
        markup: 2,
        itemsCount: 3,
        validItemsCount: 3,
        ignoredItemsCount: 0,
        hasMissingCost: false,
        hasMissingProduct: false,
        hasNegativeMargin: false,
        hasInvalidRevenue: false,
        status: "OK",
        statusLabel: "OK",
        statusSeverity: "ok",
        commercialMargin: {
          commercialMarginTotalValue: 500,
          commercialMarginTotalPercent: 18.01,
          commercialSoldTotalValue: 2775.9,
          totalActiveSoldValue: 2775.9,
          commercialMarginCoveragePercent: 100,
          itemsCalculated: 3,
          itemsUnavailable: 0,
          itemsActive: 3,
          isComplete: true,
          warnings: [],
          commercialComposition: {
            grossActiveTotalValue: composition.grossActiveTotalValue,
            discountTotalValue: composition.discountTotalValue,
            discountRate: composition.discountRate,
            additionTotalValue: composition.additionTotalValue,
            additionRate: composition.additionRate,
            netActiveTotalValue: composition.netActiveTotalValue,
          },
        },
      },
      commercialComposition: composition,
    });
    assert.match(text, /Valor bruto dos itens/);
    assert.match(text, /2\.922,00/);
    assert.match(text, /Desconto concedido/);
    assert.match(text, /146,10/);
    assert.match(text, /Valor líquido vendido/);
    assert.match(text, /2\.775,90/);
    assert.match(text, /Margem comercial/);
    assert.match(text, /Margem gerencial/);
    assert.match(text, /Cobertura/);
  });

  it("tooltip do item lista composição 1–17", () => {
    const composition = resolveItemCommercialCompositionForDisplay(
      PD02820_COMMERCIAL_DISPLAY_FIXTURE.items[0]!
    );
    const commercial = {
      ...unavailableCommercialMarginItem({
        soldQuantity: 400,
        negotiatedUnitPrice: 4.104,
        soldValue: 1641.6,
        reasonCode: "COST_NOT_FOUND",
      }),
      isComplete: true,
      reasonCode: null as null,
      calculationSource: "HISTORICAL_PRICE_FORMATION" as const,
      costUnit: 1.2,
      costValue: 480,
      taxRate: 0.1,
      taxValue: 164.16,
      freightRate: 0.02,
      freightRateValue: 32.83,
      freightAbsoluteUnit: 0.05,
      freightAbsoluteValue: 20,
      commissionRate: 0.05,
      commissionValue: 82.08,
      otherVariablesRate: 0.01,
      otherVariablesValue: 16.42,
      commercialMarginRate: 0.2,
      commercialMarginPercent: 20,
      commercialMarginUnitValue: 0.8208,
      commercialMarginValue: 328.32,
      lowerMarginBand: "ATACADO",
      upperMarginBand: "VAREJO_1",
      lowerBandPrice: 4,
      upperBandPrice: 5,
      historicalContextId: "ctx",
      priceTableVersionId: "v1",
      referenceDate: "2024-06-01",
      warnings: ["Aviso de teste"],
      negotiatedUnitPrice: 4.104,
      soldValue: 1641.6,
      soldQuantity: 400,
    };
    const text = buildSalesOrderItemCommercialMarginCompositionTooltipText({
      commercial,
      composition,
    });
    assert.match(text, /1\. Preço unitário bruto/);
    assert.match(text, /4\. Desconto em percentual/);
    assert.match(text, /6\. Preço unitário líquido/);
    assert.match(text, /7\. Valor líquido vendido/);
    assert.match(text, /11\. Comissão proporcional/);
    assert.match(text, /15\. Faixas utilizadas/);
    assert.match(text, /17\. Warnings/);
  });

  it("alinhamento DTO — sumário de composição fecha bruto − desconto = líquido", () => {
    const rows = PD02820_COMMERCIAL_DISPLAY_FIXTURE.items.map((item) =>
      resolveItemCommercialCompositionForDisplay(item)
    );
    const totals = summarizeCommercialCompositionForDisplay(rows);
    assert.equal(
      Math.round(
        (totals.grossActiveTotalValue -
          totals.discountTotalValue -
          totals.netActiveTotalValue) *
          100
      ) / 100,
      0
    );
  });
});

describe("salesOrderCommercialCompositionDisplay — PDF / política", () => {
  it("documento cliente não expõe custo, comissão nem margem", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/sales/SalesOrderClientDocument.tsx"),
      "utf8"
    );
    assert.match(src, /Desconto|totalDiscount/i);
    assert.doesNotMatch(src, /margem comercial/i);
    assert.doesNotMatch(src, /commercialMargin/);
    assert.doesNotMatch(src, /unitCost|custo histórico/i);
    assert.doesNotMatch(src, /commissionRate/);
  });

  it("detalhe interno (Imprimir/PDF) reutiliza SalesOrderDetailView com composição", () => {
    const dialog = readFileSync(
      join(process.cwd(), "src/components/sales/SalesOrderDetailDialog.tsx"),
      "utf8"
    );
    assert.match(dialog, /SalesOrderDetailView/);
    assert.match(dialog, /print|Imprimir/i);
    const view = readFileSync(
      join(process.cwd(), "src/components/sales/SalesOrderDetailView.tsx"),
      "utf8"
    );
    assert.match(view, /grossItems|discountValue|netSold|discountColumn/);
    assert.match(view, /SALES_ORDER_COMMERCIAL_COMPOSITION_LABELS/);
    assert.match(view, /Valor líquido|netActiveValue|netSold/);
  });

  it("não altera Propostas", () => {
    const files = [
      "src/lib/salesOrderCommercialCompositionDisplay.ts",
      "src/components/sales/SalesOrderDetailView.tsx",
    ];
    for (const file of files) {
      const src = readFileSync(join(process.cwd(), file), "utf8");
      assert.doesNotMatch(src, /proposalCommercialMargin/);
      assert.doesNotMatch(src, /ProposalItem/);
    }
  });
});
