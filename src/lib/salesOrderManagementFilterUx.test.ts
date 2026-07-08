import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  advancedFiltersButtonLabel,
  buildAdvancedFilterChips,
  countActiveAdvancedFilters,
} from "./salesOrderManagementFilterUx.js";

function read(relPath: string): string {
  return readFileSync(join(process.cwd(), relPath), "utf8");
}

describe("salesOrderManagementFilterUx", () => {
  it("conta filtros avançados ativos", () => {
    assert.equal(
      countActiveAdvancedFilters({
        customerId: "",
        customerLabel: null,
        responsible: "",
        companyIssuer: "",
        operationalStatus: "",
        deadlineStatus: "",
        completionStatus: "",
        billingStatus: "",
        invoiceFilter: "",
        productionFilter: "",
        deliveryYear: "",
        deliveryMonth: "",
        nfeYear: "",
        nfeMonth: "",
        prazoFilter: "",
        fulfillmentFilter: "",
        invoiceCoverage: "",
        reviewDataFilter: "",
        cutFilter: "",
        invoiceNumber: "",
      }),
      0
    );
    assert.equal(
      countActiveAdvancedFilters({
        customerId: "c1",
        customerLabel: "Esmaltec",
        responsible: "João",
        companyIssuer: "",
        operationalStatus: "released",
        deadlineStatus: "overdue",
        completionStatus: "",
        billingStatus: "not_invoiced",
        invoiceFilter: "",
        productionFilter: "",
        deliveryYear: "",
        deliveryMonth: "",
        nfeYear: "",
        nfeMonth: "",
        prazoFilter: "",
        fulfillmentFilter: "",
        invoiceCoverage: "",
        reviewDataFilter: "",
        cutFilter: "",
        invoiceNumber: "",
      }),
      5
    );
  });

  it("monta chips de filtros avançados", () => {
    const chips = buildAdvancedFilterChips({
      customerId: "c1",
      customerLabel: "Esmaltec",
      responsible: "",
      companyIssuer: "",
      operationalStatus: "",
      deadlineStatus: "overdue",
      completionStatus: "",
      billingStatus: "not_invoiced",
      invoiceFilter: "",
      productionFilter: "",
      deliveryYear: "",
      deliveryMonth: "",
      nfeYear: "",
      nfeMonth: "",
      prazoFilter: "",
      fulfillmentFilter: "",
      invoiceCoverage: "",
      reviewDataFilter: "",
      cutFilter: "",
      invoiceNumber: "",
    });
    assert.equal(chips.length, 3);
    assert.ok(chips.some((c) => c.label === "Cliente" && c.value === "Esmaltec"));
    assert.ok(chips.some((c) => c.label === "Prazo" && c.value === "Atrasado"));
    assert.ok(chips.some((c) => c.label === "NF" && c.value === "Sem NF"));
  });

  it("rótulo do botão com contador", () => {
    assert.equal(advancedFiltersButtonLabel(0), "Filtros avançados");
    assert.equal(advancedFiltersButtonLabel(4), "Filtros avançados (4)");
  });
});

describe("salesOrderManagementPage filter layout", () => {
  it("1. filtros avançados fechados por padrão", () => {
    const page = read("src/components/sales/SalesOrderManagementPage.tsx");
    assert.match(page, /useState\(false\)/);
    assert.match(page, /advancedFiltersOpen/);
  });

  it("2. ano, mês e busca inteligente permanecem visíveis", () => {
    const bar = read("src/components/sales/SalesOrderManagementFiltersBar.tsx");
    assert.match(bar, />Ano</);
    assert.match(bar, />Mês</);
    assert.match(bar, /Busca inteligente/);
    assert.match(bar, /sales-order-management-smart-search/);
  });

  it("3. botão Filtros avançados aparece", () => {
    const bar = read("src/components/sales/SalesOrderManagementFiltersBar.tsx");
    assert.match(bar, /sales-order-management-advanced-filters-toggle/);
    assert.match(bar, /Filtros avançados/);
  });

  it("4–5. painel avançado colapsável", () => {
    const bar = read("src/components/sales/SalesOrderManagementFiltersBar.tsx");
    assert.match(bar, /advancedOpen \?/);
    assert.match(bar, /sales-order-management-advanced-filters-panel/);
    assert.match(bar, /aria-expanded=\{advancedOpen\}/);
  });

  it("6–7. filtros avançados conectados ao mesmo estado/query", () => {
    const page = read("src/components/sales/SalesOrderManagementPage.tsx");
    assert.match(page, /SalesOrderManagementFiltersBar/);
    assert.match(page, /params\.set\("operationalStatus"/);
    assert.match(page, /params\.set\("customerId"/);
    assert.match(page, /params\.set\("q", search\)/);
    assert.doesNotMatch(page, /appliedQuery/);
  });

  it("8. filtros ativos com contador e chips", () => {
    const page = read("src/components/sales/SalesOrderManagementPage.tsx");
    const bar = read("src/components/sales/SalesOrderManagementFiltersBar.tsx");
    assert.match(page, /countActiveAdvancedFilters/);
    assert.match(page, /buildAdvancedFilterChips/);
    assert.match(bar, /sales-order-management-active-filter-chips/);
    assert.match(bar, /advancedActiveCount/);
  });

  it("9. botão limpar filtros continua funcionando", () => {
    const bar = read("src/components/sales/SalesOrderManagementFiltersBar.tsx");
    const page = read("src/components/sales/SalesOrderManagementPage.tsx");
    assert.match(bar, /sales-order-management-clear-filters/);
    assert.match(page, /clearAllFilters/);
    assert.match(page, /setSearchDraft\(""\)/);
  });

  it("10. botão Excel interno continua funcionando", () => {
    const bar = read("src/components/sales/SalesOrderManagementFiltersBar.tsx");
    assert.match(bar, /sales-order-management-export-internal-margin/);
    assert.match(bar, /Excel interno \(margem\)/);
  });

  it("11. busca inteligente com debounce intacta", () => {
    const page = read("src/components/sales/SalesOrderManagementPage.tsx");
    assert.match(page, /setSearch\(searchDraft\.trim\(\)\)/);
    assert.match(page, /setTimeout/);
  });

  it("12–14. paginação, cards e regras de negócio intactas", () => {
    const page = read("src/components/sales/SalesOrderManagementPage.tsx");
    assert.match(page, /setPage/);
    assert.match(page, /displayDashboardCards/);
    assert.match(page, /onToggleLogisticStatus|setSelectedManagementStatus/);
    assert.doesNotMatch(page, /@prisma\/client/);
  });

  it("15. safeTrim no módulo de UX de filtros", () => {
    const ux = read("src/lib/salesOrderManagementFilterUx.ts");
    assert.match(ux, /safeTrim/);
    assert.doesNotMatch(ux, /\.trim\(\)/);
  });

  it("todos os filtros avançados existem no painel", () => {
    const bar = read("src/components/sales/SalesOrderManagementFiltersBar.tsx");
    const labels = [
      "Cliente",
      "Vendedor",
      "Empresa",
      "Status gerencial",
      "Prazo",
      "Completeza",
      "Vínculo NF",
      "Entrega — ano",
      "Entrega — mês",
      "NF — ano",
      "NF — mês",
      "Prazo (BI)",
      "Atendimento",
      "% faturado",
      "Corte",
      "Revisar dados",
      "Número NF",
    ];
    for (const label of labels) {
      assert.match(bar, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });
});
