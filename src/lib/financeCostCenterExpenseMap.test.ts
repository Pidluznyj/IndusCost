import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildCostCenterExpenseMapAllocationsQuery,
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

  it("drilldown lista apenas títulos do centro via API path por id", () => {
    const section = readFileSync(
      join(process.cwd(), "src/components/finance/cost-centers/FinanceCostCenterExpenseMapSection.tsx"),
      "utf8"
    );
    assert.ok(section.includes("/api/finance/cost-centers/${selectedId}/allocations"));
    assert.ok(section.includes("/api/finance/cost-centers/${selectedId}/summary"));
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
  });
});
