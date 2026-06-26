import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "node:test";
import { SalesOrderListMarginCell } from "../components/sales/SalesOrderListMarginCell.js";
import {
  buildSalesOrderMarginTooltipText,
  canViewSalesOrderMarginEconomics,
  formatSalesOrderDisplayCode,
  formatSalesOrderListNetValue,
  resolveSalesOrderListCustomerName,
} from "./salesOrderListUi.js";
import type { SalesOrderMarginSummaryPayload } from "./salesOrderMarginTypes.js";

const ROOT = join(import.meta.dirname, "..");

function read(relPath: string): string {
  return readFileSync(join(ROOT, relPath), "utf8");
}

function summary(
  partial: Partial<SalesOrderMarginSummaryPayload> = {}
): SalesOrderMarginSummaryPayload {
  return {
    netRevenue: 5301.8,
    totalCost: 1321.38,
    marginValue: 3980.42,
    marginPercent: 75.08,
    markup: 4.01,
    itemsCount: 15,
    validItemsCount: 15,
    ignoredItemsCount: 0,
    hasMissingCost: false,
    hasMissingProduct: false,
    hasNegativeMargin: false,
    hasInvalidRevenue: false,
    status: "OK",
    statusLabel: "Calculada",
    statusSeverity: "success",
    ...partial,
  };
}

describe("salesOrderListUi formatters", () => {
  it("3. pedido aparece como PD XXXXX em uma linha", () => {
    assert.equal(formatSalesOrderDisplayCode("PD-02705"), "PD 02705");
    assert.equal(formatSalesOrderDisplayCode("PD02705"), "PD 02705");
    assert.equal(formatSalesOrderDisplayCode("PD 02705"), "PD 02705");
    assert.doesNotMatch(formatSalesOrderDisplayCode("PD-02705"), /\n/);
  });

  it("4. cliente usa fallback quando ausente", () => {
    assert.equal(
      resolveSalesOrderListCustomerName({ companyName: null, tradeName: null }),
      "Cliente não informado"
    );
    assert.equal(
      resolveSalesOrderListCustomerName({
        companyName: "Britânia Eletrodomésticos SA",
        tradeName: null,
      }),
      "Britânia Eletrodomésticos SA"
    );
  });

  it("5. valor líquido formatado sem NaN", () => {
    const v = formatSalesOrderListNetValue(5301.8);
    assert.doesNotMatch(v.display, /NaN/);
    assert.doesNotMatch(v.title, /NaN/);
    assert.match(v.title, /5\.301/);
    const missing = formatSalesOrderListNetValue(undefined);
    assert.equal(missing.display, "—");
  });

  it("7–11. tooltip de margem usa valores reais e alertas", () => {
    const ok = buildSalesOrderMarginTooltipText(summary());
    assert.match(ok, /Receita líquida:.*5\.301/);
    assert.match(ok, /Custo estimado:.*1\.321/);
    assert.match(ok, /Margem R\$:.*3\.980/);
    assert.match(ok, /Margem %:.*75,08%/);
    assert.match(ok, /Fórmula:/);

    const noCost = buildSalesOrderMarginTooltipText(summary({ hasMissingCost: true, status: "SEM_CUSTO" }));
    assert.match(noCost, /sem custo cadastrado/i);

    const noProduct = buildSalesOrderMarginTooltipText(
      summary({ hasMissingProduct: true, status: "SEM_PRODUTO_VINCULADO" })
    );
    assert.match(noProduct, /sem vínculo com produto local/i);

    const negative = buildSalesOrderMarginTooltipText(
      summary({ hasNegativeMargin: true, status: "MARGEM_NEGATIVA" })
    );
    assert.match(negative, /custo estimado é maior que a receita/i);
  });

  it("15. permissão de margem usa products.tab.cost ou costs.view", () => {
    assert.equal(
      canViewSalesOrderMarginEconomics({ hasPermission: (p) => p === "products.tab.cost" }),
      true
    );
    assert.equal(
      canViewSalesOrderMarginEconomics({ hasPermission: (p) => p === "costs.view" }),
      true
    );
    assert.equal(
      canViewSalesOrderMarginEconomics({ hasPermission: () => false }),
      false
    );
  });
});

describe("salesOrderListGrid components", () => {
  it("1–2. grid renderiza nova estrutura de colunas e headers compactos", () => {
    const tableSrc = read("components/sales/SalesOrderListTable.tsx");
    const css = read("components/sales/sales-order-list-table.css");
    assert.match(tableSrc, />Pedido</);
    assert.match(tableSrc, />Cliente</);
    assert.match(tableSrc, />Responsável</);
    assert.match(tableSrc, />Emissão</);
    assert.match(tableSrc, />Situação</);
    assert.match(tableSrc, />Valor líquido</);
    assert.match(tableSrc, />Margem</);
    assert.match(tableSrc, />Itens</);
    assert.match(tableSrc, />Ações</);
    assert.doesNotMatch(tableSrc, />Margem %</);
    assert.doesNotMatch(tableSrc, />Margem R\$</);
    assert.doesNotMatch(tableSrc, />Status margem</);
    assert.match(css, /white-space:\s*nowrap/);
  });

  it("6. coluna Margem mostra percentual, valor e status compacto", () => {
    const html = renderToStaticMarkup(
      React.createElement(SalesOrderListMarginCell, {
        marginSummary: summary(),
      })
    );
    assert.match(html, /75,08%/);
    assert.match(html, /3\.980/);
    assert.match(html, /Calculada/);
    assert.match(html, /sales-order-list-margin-cell/);
    assert.match(html, /sales-order-list-margin-tooltip-trigger/);
  });

  it("8. tooltip renderizado com valores do pedido", () => {
    const html = renderToStaticMarkup(
      React.createElement(SalesOrderListMarginCell, {
        marginSummary: summary(),
      })
    );
    assert.match(html, /sales-order-list-margin-tooltip/);
    assert.match(html, /5\.301/);
    assert.match(html, /1\.321/);
  });

  it("12. clique na linha abre resumo via callback", () => {
    const moduleSrc = read("components/SalesOrdersModule.tsx");
    assert.match(moduleSrc, /SalesOrderQuickSummaryDrawer/);
    assert.match(moduleSrc, /setSummaryDrawerOpen\(true\)/);
    assert.match(moduleSrc, /onRowOpenSummary/);
  });

  it("13–14. resumo mostra blocos comercial e margem", () => {
    const drawerSrc = read("components/sales/SalesOrderQuickSummaryDrawer.tsx");
    assert.match(drawerSrc, /sales-order-quick-summary-drawer/);
    assert.match(drawerSrc, /Comercial/);
    assert.match(drawerSrc, /Valor líquido/);
    assert.match(drawerSrc, /sales-order-quick-summary-margin/);
    assert.match(drawerSrc, /Receita líquida/);
    assert.match(drawerSrc, /Custo estimado/);
  });

  it("15. resumo oculta margem sem permissão", () => {
    const drawerSrc = read("components/sales/SalesOrderQuickSummaryDrawer.tsx");
    assert.match(drawerSrc, /showMarginEconomics/);
    assert.match(drawerSrc, /showMarginEconomics \?/);
  });

  it("16. botões de detalhe e itens no resumo", () => {
    const drawerSrc = read("components/sales/SalesOrderQuickSummaryDrawer.tsx");
    assert.match(drawerSrc, /sales-order-open-detail/);
    assert.match(drawerSrc, /sales-order-open-items/);
    assert.match(drawerSrc, /Abrir detalhe completo/);
    assert.match(drawerSrc, /Ver itens/);
  });

  it("tabela oculta coluna margem sem permissão", () => {
    const tableSrc = read("components/sales/SalesOrderListTable.tsx");
    assert.match(tableSrc, /showMarginEconomics/);
    assert.match(tableSrc, /showMarginEconomics \?/);
  });

  it("4. cliente na tabela usa ellipsis e title", () => {
    const tableSrc = read("components/sales/SalesOrderListTable.tsx");
    assert.match(tableSrc, /so-cell-ellipsis/);
    assert.match(tableSrc, /title=\{customerName\}/);
    assert.match(tableSrc, /formatSalesOrderDisplayCode/);
  });

  it("tooltip de margem fica acima das linhas da tabela", () => {
    const css = read("components/sales/sales-order-list-table.css");
    assert.match(css, /tr:has\(\.sales-order-margin-tooltip-wrap:hover\)/);
    assert.match(css, /z-index:\s*60/);
    assert.match(css, /\.sales-order-margin-tooltip-panel[\s\S]*z-index:\s*80/);
    assert.match(css, /var\(--color-popover/);
  });
});

describe("salesOrderListGrid wiring", () => {
  it("17–20. paginação, busca, filtros e exportação preservados", () => {
    const moduleSrc = read("components/SalesOrdersModule.tsx");
    assert.match(moduleSrc, /sales-orders-smart-search/);
    assert.match(moduleSrc, /sales-orders-export-internal-margin/);
    assert.match(moduleSrc, /setCurrentPage/);
    assert.match(moduleSrc, /listFiltersKey/);
    assert.match(moduleSrc, /SalesOrderListTable/);
    assert.doesNotMatch(moduleSrc, />Margem %</);
  });

  it("10. frontend não recalcula margem na listagem", () => {
    const marginCell = read("components/sales/SalesOrderListMarginCell.tsx");
    const listUi = read("lib/salesOrderListUi.ts");
    assert.doesNotMatch(marginCell, /calculateSalesOrderMargin/);
    assert.doesNotMatch(listUi, /calculateSalesOrderMargin/);
    assert.match(marginCell, /pickSalesOrderListMarginPercent/);
    assert.match(marginCell, /buildSalesOrderMarginTooltipText/);
  });

  it("21. build não reintroduz Prisma no frontend da listagem", () => {
    for (const rel of [
      "components/sales/SalesOrderListTable.tsx",
      "components/sales/SalesOrderListMarginCell.tsx",
      "components/sales/SalesOrderQuickSummaryDrawer.tsx",
      "lib/salesOrderListUi.ts",
    ]) {
      const src = read(rel);
      assert.doesNotMatch(src, /@prisma\/client/);
      assert.doesNotMatch(src, /\.server/);
    }
  });
});
