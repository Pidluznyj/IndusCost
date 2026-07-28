import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import {
  buildSalesOrderMarginAlerts,
  formatSalesOrderMarginMoney,
  formatSalesOrderMarginPercent,
  formatSalesOrderMarkup,
  pickSalesOrderListMarginPercent,
  pickSalesOrderListMarginValue,
  salesOrderMarginSummaryStatusBadgeClass,
} from "./salesOrderMarginDisplay.js";
import type {
  SalesOrderItemMarginPayload,
  SalesOrderMarginSummaryPayload,
} from "./salesOrderMarginTypes.js";
import { SalesOrderMarginStatusBadge } from "../components/sales/SalesOrderMarginStatusBadge.js";

function summary(
  partial: Partial<SalesOrderMarginSummaryPayload> = {}
): SalesOrderMarginSummaryPayload {
  return {
    netRevenue: 1000,
    totalCost: 400,
    marginValue: 600,
    marginPercent: 60,
    markup: 2.5,
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
    ...partial,
  };
}

function itemMargin(
  partial: Partial<SalesOrderItemMarginPayload> = {}
): SalesOrderItemMarginPayload {
  return {
    netRevenue: 100,
    unitCost: 40,
    totalCost: 40,
    marginValue: 60,
    marginPercent: 60,
    markup: 2.5,
    status: "OK",
    statusLabel: "Margem calculada",
    statusSeverity: "success",
    costSource: "OFFICIAL_FINAL_COST",
    costConfidence: "HIGH",
    productResolutionSource: "LOCAL_PRODUCT_ID",
    notes: [],
    ...partial,
  };
}

describe("salesOrderMarginDisplay", () => {
  it("formata moeda, percentual e markup sem NaN", () => {
    assert.match(formatSalesOrderMarginMoney(12345.67), /12\.345,67/);
    assert.equal(formatSalesOrderMarginMoney(null), "—");
    assert.equal(formatSalesOrderMarginPercent(36.25), "36,25%");
    assert.equal(formatSalesOrderMarginPercent(undefined), "—");
    assert.equal(formatSalesOrderMarkup(1.56), "1,56x");
    assert.equal(formatSalesOrderMarkup(0), "—");
  });

  it("margem usa no máximo 2 casas decimais na listagem", () => {
    assert.equal(formatSalesOrderMarginMoney(212.212678), "R$\u00a0212,21");
    assert.equal(formatSalesOrderMarginMoney(40167.14423), "R$\u00a040.167,14");
    assert.equal(formatSalesOrderMarginPercent(76.034567), "76,03%");
    assert.doesNotMatch(formatSalesOrderMarginMoney(212.212678), /212,212678/);
  });

  it("2. lista mostra — quando margem é null/ausente", () => {
    assert.equal(pickSalesOrderListMarginPercent(null), "—");
    assert.equal(pickSalesOrderListMarginValue(undefined), "—");
  });

  it("1. lista renderiza margem comercial a partir de commercialMargin", () => {
    const withCommercial = summary({
      commercialMargin: {
        commercialMarginTotalValue: 340,
        commercialMarginTotalPercent: 34,
        commercialSoldTotalValue: 1000,
        totalActiveSoldValue: 1000,
        commercialMarginCoveragePercent: 100,
        itemsCalculated: 1,
        itemsUnavailable: 0,
        itemsActive: 1,
        isComplete: true,
        warnings: [],
      },
    });
    assert.equal(pickSalesOrderListMarginPercent(withCommercial), "34,00%");
    assert.match(pickSalesOrderListMarginValue(withCommercial), /340,00/);
  });

  it("lista não usa margem gerencial como principal sem commercialMargin", () => {
    assert.equal(pickSalesOrderListMarginPercent(summary()), "—");
    assert.equal(pickSalesOrderListMarginValue(summary()), "—");
  });
});

describe("salesOrderMargin UI", () => {
  it("3. status OK aparece corretamente", () => {
    const html = renderToStaticMarkup(
      React.createElement(SalesOrderMarginStatusBadge, {
        label: "Margem calculada",
        status: "OK",
      })
    );
    assert.match(html, /Margem calculada/);
    assert.ok(html.includes(salesOrderMarginSummaryStatusBadgeClass("OK")));
  });

  it("4. status SEM_CUSTO aparece corretamente", () => {
    const html = renderToStaticMarkup(
      React.createElement(SalesOrderMarginStatusBadge, {
        label: "Custo indisponível",
        status: "SEM_CUSTO",
      })
    );
    assert.match(html, /Custo indisponível/);
    assert.ok(html.includes(salesOrderMarginSummaryStatusBadgeClass("SEM_CUSTO")));
  });

  it("5. status MARGEM_NEGATIVA aparece corretamente", () => {
    const html = renderToStaticMarkup(
      React.createElement(SalesOrderMarginStatusBadge, {
        label: "Margem negativa",
        status: "MARGEM_NEGATIVA",
      })
    );
    assert.match(html, /Margem negativa/);
    assert.ok(html.includes(salesOrderMarginSummaryStatusBadgeClass("MARGEM_NEGATIVA")));
  });

  it("6. detalhe mostra cards de margem", () => {
    const analysisSrc = readFileSync(
      join(process.cwd(), "src", "components", "sales", "SalesOrderMarginAnalysis.tsx"),
      "utf8"
    );
    const metricGridSrc = readFileSync(
      join(process.cwd(), "src", "components", "sales", "SalesOrderMarginMetricGrid.tsx"),
      "utf8"
    );
    assert.match(analysisSrc, /Margem comercial da venda/);
    assert.match(analysisSrc, /SalesOrderMarginMetricGrid/);
    assert.match(analysisSrc, /resolveSalesOrderMarginRevenueLabel\(summary\)/);
    assert.match(metricGridSrc, /Custo estimado/);
    assert.match(metricGridSrc, /resolveSalesOrderMarginMoneyLabel/);
    assert.match(metricGridSrc, /resolveSalesOrderMarginPercentLabel/);
    assert.match(metricGridSrc, /buildSalesOrderMarginCoverageHint/);
    assert.match(metricGridSrc, /Markup/);
    assert.match(analysisSrc, /resolveSalesOrderMarginSupportText/);
    assert.match(metricGridSrc, /commercialMargin|soldValue/);
  });

  it("7. detalhe mostra margem por item", () => {
    const html = renderToStaticMarkup(
      React.createElement(SalesOrderMarginStatusBadge, {
        label: itemMargin().statusLabel,
        severity: itemMargin().statusSeverity,
      })
    );
    assert.match(html, /Margem calculada/);
    const analysisSrc = readFileSync(
      join(process.cwd(), "src", "components", "sales", "SalesOrderMarginAnalysis.tsx"),
      "utf8"
    );
    assert.match(analysisSrc, /formatOfficialPriceTableReferenceLabel/);
    assert.match(analysisSrc, /commercialReference/);
    assert.match(analysisSrc, /formatSalesOrderMarginPercent/);
    assert.match(analysisSrc, /marginLeakageAmount/);
    assert.match(analysisSrc, /sales-order-item-margin-/);
  });

  it("8. detalhe mostra alerta de item sem custo", () => {
    const alerts = buildSalesOrderMarginAlerts(summary({ hasMissingCost: true, status: "PARTIAL" }));
    assert.ok(alerts.some((a) => a.includes("sem custo de produção publicado")));
    const analysisSrc = readFileSync(
      join(process.cwd(), "src", "components", "sales", "SalesOrderMarginAnalysis.tsx"),
      "utf8"
    );
    assert.match(analysisSrc, /buildSalesOrderMarginAlerts/);
  });

  it("9. detalhe mostra alerta de item sem produto", () => {
    const alerts = buildSalesOrderMarginAlerts(
      summary({ hasMissingProduct: true, status: "SEM_PRODUTO_VINCULADO" })
    );
    assert.ok(alerts.some((a) => a.includes("sem vínculo com produto local")));
  });

  it("11. tela não quebra com payload antigo sem marginSummary", () => {
    const analysisSrc = readFileSync(
      join(process.cwd(), "src", "components", "sales", "SalesOrderMarginAnalysis.tsx"),
      "utf8"
    );
    assert.match(analysisSrc, /Margem ainda não calculada/);
    const marginCellSrc = readFileSync(
      join(process.cwd(), "src", "components", "sales", "SalesOrderListMarginCell.tsx"),
      "utf8"
    );
    assert.match(marginCellSrc, /Margem não calculada/);
    assert.match(marginCellSrc, /pickSalesOrderListMarginPercent/);
  });
});

describe("salesOrderMargin UI — wiring e segurança", () => {
  it("10. frontend não calcula margem diretamente", () => {
    const moduleSrc = readFileSync(
      join(process.cwd(), "src", "components", "SalesOrdersModule.tsx"),
      "utf8"
    );
    const analysisSrc = readFileSync(
      join(process.cwd(), "src", "components", "sales", "SalesOrderMarginAnalysis.tsx"),
      "utf8"
    );
    assert.doesNotMatch(moduleSrc, /calculateSalesOrderItemMargin/);
    assert.doesNotMatch(moduleSrc, /calculateSalesOrderMarginSummary/);
    assert.doesNotMatch(analysisSrc, /calculateSalesOrderItemMargin/);
    assert.doesNotMatch(analysisSrc, /marginValue\s*=/);
    assert.match(moduleSrc, /marginSummary/);
    assert.match(moduleSrc, /SalesOrderMarginAnalysisSection/);
  });

  it("12. build não reintroduz Prisma no frontend de margem", () => {
    for (const rel of [
      "src/components/SalesOrdersModule.tsx",
      "src/components/sales/SalesOrderMarginAnalysis.tsx",
      "src/lib/salesOrderMarginDisplay.ts",
    ]) {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      assert.doesNotMatch(src, /@prisma\/client/);
      assert.doesNotMatch(src, /salesOrderMarginService\.server/);
    }
  });

  it("lista usa helpers de exibição sem motor de margem", () => {
    const tableSrc = readFileSync(
      join(process.cwd(), "src", "components", "sales", "SalesOrderListTable.tsx"),
      "utf8"
    );
    const marginCellSrc = readFileSync(
      join(process.cwd(), "src", "components", "sales", "SalesOrderListMarginCell.tsx"),
      "utf8"
    );
    assert.match(tableSrc, /SalesOrderListMarginCell/);
    assert.match(marginCellSrc, /pickSalesOrderListMarginPercent/);
    assert.match(marginCellSrc, /data-testid="sales-order-list-margin-cell"/);
  });
});
