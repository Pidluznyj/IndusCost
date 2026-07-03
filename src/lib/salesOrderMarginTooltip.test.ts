import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildOfficialSalesOrderMarginTooltipText,
  buildSalesOrderMarginTooltipText,
  isSalesOrderMarginDisplayUnavailable,
  pickSalesOrderListMarginPercent,
  resolveSalesOrderMarginCostSourceSummary,
  resolveSalesOrderMarginRevenueLabel,
  SALES_ORDER_MARGIN_DISPLAY_LABELS,
} from "./salesOrderMarginDisplay.js";
import type { SalesOrderMarginSummaryPayload } from "./salesOrderMarginTypes.js";

function summary(
  partial: Partial<SalesOrderMarginSummaryPayload> = {}
): SalesOrderMarginSummaryPayload {
  return {
    netRevenue: 286.63,
    totalCost: 193.49,
    marginValue: 93.14,
    marginPercent: 32.5,
    markup: 1.48,
    itemsCount: 1,
    validItemsCount: 1,
    ignoredItemsCount: 0,
    hasMissingCost: false,
    hasMissingProduct: false,
    hasNegativeMargin: false,
    hasInvalidRevenue: false,
    status: "OK",
    statusLabel: "Margem calculada",
    statusSeverity: "success",
    totalSalesRevenueInScope: 394,
    marginRevenueCovered: 394,
    marginRevenueUncovered: 0,
    marginCoveragePercent: 100,
    itemsTotal: 1,
    itemsWithCost: 1,
    itemsWithoutCost: 0,
    costCoverageStatus: "FULL",
    taxMode: "deductFromGross",
    grossSalesAmount: 394,
    taxAmount: 107.37,
    netSalesAmountAfterTax: 286.63,
    taxRuleName: "Imposto médio sobre venda",
    taxRulePercent: 27.25,
    fiscalConfigComplete: true,
    costSourceSummary: "Custo de produção IndusCost (tabela vigente)",
    hasFrozenCost: true,
    ...partial,
  };
}

describe("salesOrderMarginTooltip", () => {
  it("tooltip gerencial com imposto (pedido R$ 394)", () => {
    const text = buildOfficialSalesOrderMarginTooltipText({ summary: summary() });
    assert.match(text, /Margem gerencial do pedido/);
    assert.match(text, /Valor vendido: R\$\s*394,00/);
    assert.match(text, /Imposto estimado \(dedução de imposto\): R\$\s*107,37/);
    assert.match(text, /TaxRule Imposto médio sobre venda \(27,25%\)/);
    assert.match(text, /Receita líquida gerencial após impostos: R\$\s*286,63/);
    assert.match(text, /Custo de produção IndusCost: R\$\s*193,49/);
    assert.match(text, /Fonte do custo: Tabela de custo vigente/);
    assert.match(text, /Custo total de produção: R\$\s*193,49/);
    assert.doesNotMatch(text, /getProductCostAnalysis/);
    assert.match(text, /Margem R\$: R\$\s*93,14/);
    assert.match(text, /32,50%/);
    assert.match(text, /Cobertura: FULL/);
  });

  it("tooltip sem imposto (taxMode none)", () => {
    const text = buildOfficialSalesOrderMarginTooltipText({
      summary: summary({
        taxMode: "none",
        taxAmount: 0,
        netRevenue: 394,
        netSalesAmountAfterTax: 394,
        marginValue: 200.51,
        marginPercent: 50.89,
        fiscalConfigComplete: true,
      }),
    });
    assert.match(text, /Margem vendida sem imposto/);
    assert.match(text, /Imposto: não deduzido neste modo/);
    assert.doesNotMatch(text, /Margem gerencial do pedido/);
  });

  it("tooltip parcial mostra receita coberta/descoberta", () => {
    const text = buildOfficialSalesOrderMarginTooltipText({
      summary: summary({
        costCoverageStatus: "PARTIAL",
        marginRevenueCovered: 200,
        marginRevenueUncovered: 194,
        itemsWithoutCost: 1,
        itemsWithCost: 1,
        itemsTotal: 2,
      }),
    });
    assert.match(text, /Margem parcial do pedido/);
    assert.match(text, /Receita coberta:/);
    assert.match(text, /Receita descoberta:/);
    assert.match(text, /falta de custo resolvido/);
  });

  it("tooltip indisponível sem TaxRule configurada", () => {
    const text = buildOfficialSalesOrderMarginTooltipText({
      summary: summary({
        fiscalConfigComplete: false,
        taxAmount: 0,
        marginPercent: 0,
      }),
    });
    assert.match(text, /Margem indisponível/);
    assert.match(text, /TaxRule não configurada/);
    assert.equal(pickSalesOrderListMarginPercent(summary({ fiscalConfigComplete: false })), "—");
  });

  it("tooltip indisponível com NONE ainda documenta imposto em deductFromGross", () => {
    const text = buildOfficialSalesOrderMarginTooltipText({
      summary: summary({
        costCoverageStatus: "NONE",
        itemsWithCost: 0,
        itemsWithoutCost: 2,
        marginValue: 0,
        marginPercent: 0,
      }),
    });
    assert.match(text, /Margem indisponível/);
    assert.match(text, /Imposto estimado \(dedução de imposto\)/);
    assert.match(text, /Receita líquida gerencial após impostos/);
    assert.match(text, /TaxRule/);
  });

  it("tooltip indisponível sem custo (NONE)", () => {
    const text = buildOfficialSalesOrderMarginTooltipText({
      summary: summary({
        costCoverageStatus: "NONE",
        itemsWithCost: 0,
        itemsWithoutCost: 2,
        marginValue: 0,
        marginPercent: 0,
      }),
    });
    assert.match(text, /Margem indisponível/);
    assert.match(text, /Custo não resolvido/);
  });

  it("fonte de custo legado, estimado e misto", () => {
    assert.match(
      resolveSalesOrderMarginCostSourceSummary([{ costSource: "SALES_ORDER_ITEM_SNAPSHOT" }]),
      /Legado/
    );
    assert.equal(
      resolveSalesOrderMarginCostSourceSummary([{ costSource: "LIVE_PRODUCT_COST" }]),
      SALES_ORDER_MARGIN_DISPLAY_LABELS.costEstimated
    );
    assert.equal(
      resolveSalesOrderMarginCostSourceSummary([
        { costSource: "HISTORICAL_SNAPSHOT" },
        { costSource: "OFFICIAL_FINAL_COST" },
      ]),
      SALES_ORDER_MARGIN_DISPLAY_LABELS.costMixed
    );
  });

  it("labels por taxMode", () => {
    assert.equal(resolveSalesOrderMarginRevenueLabel({ taxMode: "none" }), "Valor vendido");
    assert.equal(
      resolveSalesOrderMarginRevenueLabel({ taxMode: "deductFromGross" }),
      "Receita líquida gerencial"
    );
  });

  it("alias buildSalesOrderMarginTooltipText", () => {
    const text = buildSalesOrderMarginTooltipText(summary());
    assert.match(text, /Margem gerencial do pedido/);
  });

  it("Pedidos lista usa tooltip gerencial", () => {
    const cell = readFileSync(
      join(process.cwd(), "src/components/sales/SalesOrderListMarginCell.tsx"),
      "utf8"
    );
    assert.match(cell, /SalesOrderMarginInfoTooltip/);
    assert.match(cell, /buildOfficialSalesOrderMarginTooltipText|SalesOrderMarginInfoTooltip/);
  });

  it("Gestão usa tooltip gerencial", () => {
    const mgmt = readFileSync(
      join(process.cwd(), "src/components/sales/SalesOrderManagementMarginOverview.tsx"),
      "utf8"
    );
    const page = readFileSync(
      join(process.cwd(), "src/components/sales/SalesOrderManagementPage.tsx"),
      "utf8"
    );
    assert.match(mgmt, /SalesOrderMarginInfoTooltip/);
    assert.match(page, /SalesOrderMarginInfoTooltip/);
  });

  it("tooltip SEM_CUSTO não apresenta margem como oficial", () => {
    const text = buildOfficialSalesOrderMarginTooltipText({
      summary: summary({
        status: "PARTIAL",
        statusLabel: "Parcial",
        hasMissingCost: true,
        costCoverageStatus: "PARTIAL",
        itemsWithCost: 1,
        itemsWithoutCost: 1,
        itemsTotal: 2,
      }),
      itemMargins: [
        { costSource: "VERSIONED_PRODUCTION_COST", unitCost: 10, totalCost: 20 },
        { costSource: "MISSING_COST", unitCost: null, totalCost: null },
      ],
    });
    assert.match(text, /Custo de produção não resolvido/);
    assert.match(text, /Margem R\$: —/);
    assert.match(text, /Margem %: —/);
    assert.match(text, /Itens sem custo/);
  });

  it("análise de margem usa labels oficiais", () => {
    const analysis = readFileSync(
      join(process.cwd(), "src/components/sales/SalesOrderMarginAnalysis.tsx"),
      "utf8"
    );
    assert.match(analysis, /Preço vendido/);
    assert.match(analysis, /Preço tabela/);
    assert.match(analysis, /Margem realizada/);
    assert.match(analysis, /PRODUCTION_COST_DISPLAY_LABELS\.productionUnitCost/);
    assert.match(analysis, /costUnresolved/);
  });

  it("painel de tabelas de custo no módulo de precificação", () => {
    const pricing = readFileSync(
      join(process.cwd(), "src/components/PricingModule.tsx"),
      "utf8"
    );
    assert.match(pricing, /ProductionCostTablesPanel/);
    assert.match(pricing, /canViewProductionCostTables/);
  });

  it("isSalesOrderMarginDisplayUnavailable detecta fiscal incompleta", () => {
    assert.equal(isSalesOrderMarginDisplayUnavailable(summary({ fiscalConfigComplete: false })), true);
    assert.equal(isSalesOrderMarginDisplayUnavailable(summary()), false);
  });
});
