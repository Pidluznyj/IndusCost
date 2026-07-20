import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  aggregateCostCenterExpenseMapTotals,
  formatCostCenterExpenseMapSummaryCurrency,
  buildCostCenterExpenseMapAllocationsQuery,
  buildCostCenterExpenseMapExportQuery,
  buildExpenseMapDetailTitle,
  formatExpenseMapSelectedCenterNames,
  buildCostCenterExpenseMapCards,
  DEFAULT_COST_CENTER_EXPENSE_MAP_DRILLDOWN_FILTERS,
  filterCostCenterExpenseMapCards,
  inferCostCenterExpenseMapCategory,
  sortCostCenterExpenseMapCards,
} from "./financeCostCenterExpenseMap.js";
import type { FinanceCostCenterDashboardByCostCenterRow } from "./financeCostCenterDashboard.js";
import type { FinanceCostCenterDto } from "./financeCostCenters.js";
import { createDefaultFinanceCostCentersUiFilters } from "./financeCostCentersPageTypes.js";
import {
  buildCostCenterDetailSummaryFromRows,
  matchesCostCenterDetailFilters,
  type CostCenterDetailListFilters,
} from "./financeCostCenterDetail.js";
import type { CostCenterDetailAllocationRow } from "./financeCostCenterDetailShared.js";

function center(overrides: Partial<FinanceCostCenterDto> = {}): FinanceCostCenterDto {
  return {
    id: "cc-1",
    code: "ADM",
    name: "Administrativo",
    description: null,
    parentId: null,
    responsibleUserId: null,
    responsibleName: null,
    status: "ACTIVE",
    color: null,
    icon: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

function metrics(
  overrides: Partial<FinanceCostCenterDashboardByCostCenterRow> = {}
): FinanceCostCenterDashboardByCostCenterRow {
  return {
    costCenterId: "cc-1",
    code: "ADM",
    name: "Administrativo",
    amount: 1000,
    openAmount: 600,
    overdueAmount: 200,
    paidAmount: 400,
    titlesCount: 3,
    sharePercentage: 50,
    ...overrides,
  };
}

function allocationRow(
  overrides: Partial<CostCenterDetailAllocationRow> = {}
): CostCenterDetailAllocationRow {
  return {
    allocationId: "a1",
    accountsPayableId: 100,
    companyName: "Empresa A",
    personName: "Fornecedor X",
    personCnpj: "11111111000111",
    nomusClassification: "40.01",
    description: "Desc",
    comments: null,
    documentNumber: "NF-1",
    sourceInvoiceId: null,
    dueDate: "2026-06-10T00:00:00.000Z",
    competenceDate: "2026-05-01T00:00:00.000Z",
    paymentDate: null,
    settlementDate: null,
    statusKey: "overdue",
    statusLabel: "Vencido",
    amountPayable: 1000,
    balancePayable: 1000,
    allocatedAmount: 1000,
    allocatedPercentage: 100,
    allocationSource: "AUTO_RULE",
    lockedManual: false,
    costCenterId: "cc-1",
    costCenterCode: "ADM",
    costCenterName: "Administrativo",
    supplierId: "sup-1",
    supplierName: "Fornecedor X",
    allocationNotes: null,
    allocationCreatedAt: "2026-01-01T00:00:00.000Z",
    allocationUpdatedAt: "2026-01-02T00:00:00.000Z",
    isPartialTitle: false,
    ...overrides,
  };
}

describe("financeCostCenterExpenseMap", () => {
  it("cards são ordenados do maior valor alocado para o menor", () => {
    const cards = buildCostCenterExpenseMapCards(
      [
        metrics({ costCenterId: "cc-1", code: "A", amount: 100 }),
        metrics({ costCenterId: "cc-2", code: "B", amount: 900 }),
      ],
      [
        center({ id: "cc-1", code: "A" }),
        center({ id: "cc-2", code: "B", name: "Fabricação" }),
      ]
    );
    assert.equal(cards[0]!.costCenterId, "cc-2");
    assert.equal(cards[1]!.costCenterId, "cc-1");
    const resorted = sortCostCenterExpenseMapCards([
      cards[1]!,
      cards[0]!,
    ]);
    assert.equal(resorted[0]!.amount, 900);
  });

  it("cards mostram valor e quantidade corretos por centro", () => {
    const cards = buildCostCenterExpenseMapCards(
      [metrics({ amount: 1500, titlesCount: 7, overdueAmount: 300, paidAmount: 500, openAmount: 1000 })],
      [center()]
    );
    assert.equal(cards[0]!.amount, 1500);
    assert.equal(cards[0]!.titlesCount, 7);
    assert.equal(cards[0]!.overdueAmount, 300);
    assert.equal(cards[0]!.paidAmount, 500);
    assert.equal(cards[0]!.upcomingAmount, 700);
  });

  it("filtro apenas com valor oculta centros zerados", () => {
    const cards = buildCostCenterExpenseMapCards(
      [metrics({ costCenterId: "cc-1", amount: 0 }), metrics({ costCenterId: "cc-2", amount: 50 })],
      [center({ id: "cc-1" }), center({ id: "cc-2", code: "FAB" })]
    );
    const filtered = filterCostCenterExpenseMapCards(cards, "withValue");
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]!.costCenterId, "cc-2");
  });

  it("inferência de categoria administrativo/fabricação/excluir", () => {
    assert.equal(
      inferCostCenterExpenseMapCategory({
        code: "ADM",
        name: "Escritório",
        parentCode: null,
        parentName: "ADMINISTRATIVO",
      }),
      "administrative"
    );
    assert.equal(
      inferCostCenterExpenseMapCategory({
        code: "FAB",
        name: "Linha 1",
        parentCode: "FAB",
        parentName: "FABRICAÇÃO",
      }),
      "manufacturing"
    );
    assert.equal(
      inferCostCenterExpenseMapCategory({
        code: "NC",
        name: "Ignorar",
        parentCode: null,
        parentName: "NAO CONSIDERAR",
      }),
      "exclude"
    );
  });

  it("query do drilldown reutiliza filtros da página e parâmetros locais", () => {
    const filters = createDefaultFinanceCostCentersUiFilters();
    const qs = buildCostCenterExpenseMapAllocationsQuery(filters, {
      ...DEFAULT_COST_CENTER_EXPENSE_MAP_DRILLDOWN_FILTERS,
      search: "fornecedor",
      classification: "40.01",
      timing: "overdue",
      allocationSource: "MANUAL",
      lockedOnly: true,
      minAmount: "100",
      page: 2,
      pageSize: 25,
      sortBy: "allocatedAmount",
      sortDirection: "desc",
      companyName: "",
      supplierName: "",
      status: "all",
      maxAmount: "",
      dueDateFrom: "2026-01-01",
      dueDateTo: "2026-12-31",
      competenceDateFrom: "",
      competenceDateTo: "",
      paymentDateFrom: "",
      paymentDateTo: "",
    });
    assert.ok(qs.includes("year="));
    assert.ok(qs.includes("search=fornecedor"));
    assert.ok(qs.includes("nomusClassification=40.01"));
    assert.ok(qs.includes("timing=overdue"));
    assert.ok(qs.includes("allocationSource=MANUAL"));
    assert.ok(qs.includes("lockedOnly=true"));
    assert.ok(qs.includes("page=2"));
    assert.ok(qs.includes("sortBy=allocatedAmount"));
  });


  it("exportação PDF força ordenação por vencimento DESC", () => {
    const filters = createDefaultFinanceCostCentersUiFilters();
    const qs = buildCostCenterExpenseMapExportQuery(
      filters,
      {
        ...DEFAULT_COST_CENTER_EXPENSE_MAP_DRILLDOWN_FILTERS,
        sortBy: "allocatedAmount",
        sortDirection: "asc",
      },
      undefined,
      { sortBy: "dueDate", sortDirection: "desc" }
    );
    assert.ok(qs.includes("sortBy=dueDate"));
    assert.ok(qs.includes("sortDirection=desc"));
    assert.ok(!qs.includes("sortBy=allocatedAmount"));
  });

  it("PDF do detalhe usa ordenação por vencimento DESC na query", () => {
    const section = readFileSync(
      join(process.cwd(), "src/components/finance/cost-centers/FinanceCostCenterExpenseMapSection.tsx"),
      "utf8"
    );
    assert.match(section, /sortBy:\s*"dueDate"/);
    assert.match(section, /sortDirection:\s*"desc"/);
  });

  it("gráfico mensal empilha pago e em aberto", () => {
    const chart = readFileSync(
      join(
        process.cwd(),
        "src/components/finance/cost-centers/FinanceCostCenterMonthlyDrilldownChart.tsx"
      ),
      "utf8"
    );
    assert.match(chart, /stackId="ap"/);
    assert.match(chart, /dataKey="paidAmount"/);
    assert.match(chart, /dataKey="openAmount"/);
    assert.match(chart, /<Bar[\s\S]*dataKey="openAmount"/);
  });

  it("drilldown lista títulos por centro único ou consolidado na seleção", () => {
    const section = readFileSync(
      join(process.cwd(), "src/components/finance/cost-centers/FinanceCostCenterExpenseMapSection.tsx"),
      "utf8"
    );
    const routes = readFileSync(
      join(process.cwd(), "src/lib/financeCostCenterDetailRoutes.ts"),
      "utf8"
    );
    const centersRoutes = readFileSync(
      join(process.cwd(), "src/lib/financeCostCentersRoutes.ts"),
      "utf8"
    );
    const server = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    assert.ok(section.includes("/api/finance/cost-centers/${detailCenterIds[0]}/allocations"));
    assert.ok(section.includes("/api/finance/cost-centers/allocations?"));
    assert.ok(section.includes("isMultiCenterDetail"));
    assert.ok(section.includes("finance-cc-expense-map-detail-selection-badge"));
    assert.ok(section.includes("finance-cc-expense-map-detail-center-list"));
    assert.ok(section.includes("Não foi possível carregar o detalhamento do centro."));
    assert.doesNotMatch(section, /buildFinanceTabLoadError\("Não foi possível carregar o detalhamento/);
    assert.ok(routes.includes('app.get("/api/finance/cost-centers/allocations"'));
    assert.ok(routes.includes("listCostCenterDetailAllocationsForCenters"));
    assert.ok(routes.includes("assertFinanceCostCenterUuid"));
    assert.ok(centersRoutes.includes("isFinanceCostCenterUuid"));
    const detailRegister = server.indexOf("registerFinanceCostCenterDetailRoutes(app");
    const centersRegister = server.indexOf("registerFinanceCostCentersRoutes(app");
    assert.ok(detailRegister >= 0 && centersRegister >= 0);
    assert.ok(detailRegister < centersRegister);
  });

  it("formata título e lista de centros selecionados no detalhe", () => {
    const cards = buildCostCenterExpenseMapCards(
      [
        metrics({ costCenterId: "cc-1", amount: 100 }),
        metrics({ costCenterId: "cc-2", amount: 200 }),
        metrics({ costCenterId: "cc-3", amount: 300 }),
        metrics({ costCenterId: "cc-4", amount: 400 }),
        metrics({ costCenterId: "cc-5", amount: 500 }),
      ],
      [
        center({ id: "cc-1", name: "FOLHA" }),
        center({ id: "cc-2", name: "MATÉRIA PRIMA", code: "MP" }),
        center({ id: "cc-3", name: "MÃO DE OBRA", code: "MO" }),
        center({ id: "cc-4", name: "FERRAMENTARIA", code: "FER" }),
        center({ id: "cc-5", name: "IMPOSTO", code: "IMP" }),
      ]
    );
    assert.equal(
      buildExpenseMapDetailTitle(cards, ["cc-1", "cc-2", "cc-3", "cc-4"]),
      "Detalhamento dos centros selecionados (4)"
    );
    assert.equal(buildExpenseMapDetailTitle(cards, ["cc-1"]), "Detalhamento do centro — FOLHA");
    assert.equal(
      formatExpenseMapSelectedCenterNames(cards, ["cc-1", "cc-2", "cc-3", "cc-4"]),
      "FOLHA, MATÉRIA PRIMA, MÃO DE OBRA, FERRAMENTARIA"
    );
    assert.equal(
      formatExpenseMapSelectedCenterNames(cards, ["cc-1", "cc-2", "cc-3", "cc-4", "cc-5"]),
      "FOLHA, MATÉRIA PRIMA, MÃO DE OBRA, FERRAMENTARIA + 1 centros"
    );

    const qs = buildCostCenterExpenseMapAllocationsQuery(
      { year: "2026", month: "", status: "all", companyName: "", costCenterId: "", supplierId: "", classification: "all" },
      DEFAULT_COST_CENTER_EXPENSE_MAP_DRILLDOWN_FILTERS,
      ["cc-1", "cc-2"]
    );
    assert.ok(qs.includes("costCenterIds=cc-1%2Ccc-2") || qs.includes("costCenterIds=cc-1,cc-2"));
  });

  it("cards do mapa exibem titulo legivel sem truncate agressivo", () => {
    const section = readFileSync(
      join(process.cwd(), "src/components/finance/cost-centers/FinanceCostCenterExpenseMapSection.tsx"),
      "utf8"
    );
    assert.match(section, /line-clamp-2/);
    assert.match(section, /title=\{card\.name\}/);
    assert.match(section, /title=\{card\.code\}/);
    assert.doesNotMatch(section, /font-bold text-foreground truncate/);
    assert.doesNotMatch(section, /min-w-0 pr-8/);
  });

  it("botão limpar seleção aparece no cabeçalho e no resumo com contagem", () => {
    const section = readFileSync(
      join(process.cwd(), "src/components/finance/cost-centers/FinanceCostCenterExpenseMapSection.tsx"),
      "utf8"
    );
    const summary = readFileSync(
      join(
        process.cwd(),
        "src/components/finance/cost-centers/FinanceCostCenterExpenseMapExecutiveSummary.tsx"
      ),
      "utf8"
    );
    assert.match(section, /finance-cc-expense-map-clear-selection-toolbar/);
    assert.match(section, /Limpar seleção \(\{selectedCenterIds\.length\}\)/);
    assert.match(section, /handleClearSelection/);
    assert.match(section, /setSelectedCenterIds\(\[\]\)/);
    assert.match(summary, /finance-cc-expense-map-clear-selection/);
    assert.match(summary, /Limpar seleção \(\{formatFinanceInteger\(totals\.centersCount\)\}\)/);
  });

  it("drilldown lista apenas títulos do centro via API path por id", () => {
    const section = readFileSync(
      join(process.cwd(), "src/components/finance/cost-centers/FinanceCostCenterExpenseMapSection.tsx"),
      "utf8"
    );
    const summary = readFileSync(
      join(
        process.cwd(),
        "src/components/finance/cost-centers/FinanceCostCenterExpenseMapExecutiveSummary.tsx"
      ),
      "utf8"
    );
    assert.ok(section.includes("FinanceCostCenterExpenseMapExecutiveSummary"));
    assert.ok(section.includes("finance-cc-expense-map-select-"));
    assert.ok(summary.includes("finance-cc-expense-map-executive-summary"));
    assert.ok(summary.includes("finance-cc-expense-map-clear-selection"));
  });

  it("formata moeda do totalizador em versão compacta a partir de R$ 1 mil", () => {
    const compact = formatCostCenterExpenseMapSummaryCurrency(309_700);
    assert.equal(compact.display, "R$ 309,7 mil");
    assert.match(compact.fullValue, /309\.700,00/);

    const medium = formatCostCenterExpenseMapSummaryCurrency(3_968.6);
    assert.equal(medium.display, "R$ 3,97 mil");

    const small = formatCostCenterExpenseMapSummaryCurrency(850.5);
    assert.match(small.display, /850,50/);
    assert.equal(small.display, small.fullValue);

    const million = formatCostCenterExpenseMapSummaryCurrency(2_490_000);
    assert.equal(million.display, "R$ 2,49 Mi");
  });

  it("totalizador executivo soma cards filtrados e seleção", () => {
    const cards = buildCostCenterExpenseMapCards(
      [
        metrics({ costCenterId: "cc-1", amount: 1000, overdueAmount: 200, paidAmount: 300, openAmount: 700 }),
        metrics({ costCenterId: "cc-2", amount: 500, overdueAmount: 50, paidAmount: 100, openAmount: 400 }),
      ],
      [center({ id: "cc-1" }), center({ id: "cc-2", code: "FAB" })]
    );
    const all = aggregateCostCenterExpenseMapTotals(cards);
    assert.equal(all.centersCount, 2);
    assert.equal(all.amount, 1500);
    assert.equal(all.overdueAmount, 250);
    assert.equal(all.upcomingAmount, 850);
    assert.equal(all.paidAmount, 400);
    assert.equal(all.participationPercent, 100);

    const selected = aggregateCostCenterExpenseMapTotals(cards, new Set(["cc-2"]));
    assert.equal(selected.centersCount, 1);
    assert.equal(selected.amount, 500);
    assert.equal(selected.participationPercent, 33.33);
  });

  it("filtros do drilldown e totalizadores respeitam escopo", () => {
    const filters: CostCenterDetailListFilters = {
      status: "all",
      timing: "paid",
      nomusClassification: "40.01",
    };
    assert.equal(matchesCostCenterDetailFilters(allocationRow({ statusKey: "overdue" }), filters), false);
    assert.equal(
      matchesCostCenterDetailFilters(
        allocationRow({ paymentDate: "2026-06-01T00:00:00.000Z", balancePayable: 0 }),
        filters
      ),
      true
    );

    const summary = buildCostCenterDetailSummaryFromRows(
      {
        id: "cc-1",
        code: "ADM",
        name: "Administrativo",
        parentId: null,
        parentCode: null,
        parentName: null,
        status: "ACTIVE",
      },
      [
        allocationRow({ allocatedAmount: 1000, accountsPayableId: 1 }),
        allocationRow({
          allocationId: "a2",
          accountsPayableId: 2,
          allocatedAmount: 500,
          paymentDate: "2026-06-01T00:00:00.000Z",
          balancePayable: 0,
          statusKey: "settled",
          statusLabel: "Liquidado",
        }),
      ]
    );
    assert.equal(summary.totalAllocatedAmount, 1500);
    assert.equal(summary.titlesCount, 2);
    assert.equal(summary.paidAmount, 500);
    assert.equal(summary.averageAllocatedPerTitle, 750);
  });

  it("UI da aba Centros de Custo inclui mapa de gastos sem remover CRUD", () => {
    const crud = readFileSync(
      join(process.cwd(), "src/components/finance/cost-centers/FinanceCostCentersCrudTab.tsx"),
      "utf8"
    );
    const page = readFileSync(
      join(process.cwd(), "src/components/finance/cost-centers/FinanceCostCentersPage.tsx"),
      "utf8"
    );
    assert.ok(crud.includes("FinanceCostCenterExpenseMapSection"));
    assert.ok(crud.includes("finance-cost-centers-crud-tab"));
    assert.ok(page.includes("appliedFilters={appliedFilters}"));
    assert.ok(page.includes("dashboard={data}"));
    const expenseMap = readFileSync(
      join(process.cwd(), "src/components/finance/cost-centers/FinanceCostCenterExpenseMapSection.tsx"),
      "utf8"
    );
    assert.match(expenseMap, /finance-cc-expense-map-section/);
    assert.match(expenseMap, /FinanceCostCenterExpenseMapExecutiveSummary/);
    const executive = readFileSync(
      join(
        process.cwd(),
        "src/components/finance/cost-centers/FinanceCostCenterExpenseMapExecutiveSummary.tsx"
      ),
      "utf8"
    );
    assert.match(executive, /finance-cc-expense-map-clear-selection/);
    assert.match(executive, /finance-cc-expense-map-executive-summary\.css/);
    assert.match(executive, /finance-cc-expense-map-metric-grid/);
    assert.match(executive, /formatCostCenterExpenseMapSummaryCurrency/);
  });
});
