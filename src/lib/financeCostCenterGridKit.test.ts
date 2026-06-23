import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFinanceGridEmptyState,
  filterSupplierGridRows,
  filterUnclassifiedGroupedRows,
  paginateFinanceGridRows,
  prepareCostCenterCrudGridRows,
  prepareUnclassifiedGroupedRows,
  supplierGridTotals,
  toggleSortState,
  unclassifiedGroupedTotals,
} from "@/src/lib/financeCostCenterGridKit";
import { groupUnclassifiedPayablesBySupplier } from "@/src/lib/financeUnclassifiedPayablesGrouping";

describe("financeCostCenterGridKit", () => {
  it("ordena centros de custo por código", () => {
    const rows = prepareCostCenterCrudGridRows(
      [
        { id: "2", code: "B", name: "Beta", status: "ACTIVE", updatedAt: null },
        { id: "1", code: "A", name: "Alpha", status: "ACTIVE", updatedAt: null },
      ],
      "",
      { key: "code", direction: "asc" }
    );
    assert.equal(rows[0]?.code, "A");
    assert.equal(rows[1]?.code, "B");
  });

  it("filtra fornecedores por regra ativa", () => {
    const rows = filterSupplierGridRows(
      [
        {
          supplierId: "1",
          name: "A",
          document: null,
          titlesCount: 1,
          amount: 100,
          costCenterName: "CC",
          ruleStatus: "Regra ativa",
          hasActiveRule: true,
          aliasesCount: 0,
        },
        {
          supplierId: "2",
          name: "B",
          document: null,
          titlesCount: 1,
          amount: 50,
          costCenterName: "CC",
          ruleStatus: "Sem regra",
          hasActiveRule: false,
          aliasesCount: 0,
        },
      ],
      { search: "", ruleFilter: "without_rule" }
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.name, "B");
  });

  it("totalizadores de fornecedores respeitam filtros", () => {
    const filtered = filterSupplierGridRows(
      [
        {
          supplierId: "1",
          name: "A",
          document: null,
          titlesCount: 2,
          amount: 100,
          costCenterName: "CC",
          ruleStatus: "Regra ativa",
          hasActiveRule: true,
          aliasesCount: 0,
        },
        {
          supplierId: "2",
          name: "B",
          document: null,
          titlesCount: 1,
          amount: 40,
          costCenterName: "CC",
          ruleStatus: "Sem regra",
          hasActiveRule: false,
          aliasesCount: 0,
        },
      ],
      { search: "A", ruleFilter: "all" }
    );
    const totals = supplierGridTotals(filtered);
    assert.equal(totals.rowCount, 1);
    assert.equal(totals.amountSum, 100);
  });

  it("paginação não altera totalizadores da base filtrada", () => {
    const base = Array.from({ length: 30 }, (_, i) => ({
      supplierId: String(i),
      name: `S${i}`,
      document: null,
      titlesCount: 1,
      amount: 10,
      costCenterName: "CC",
      ruleStatus: "Sem regra",
      hasActiveRule: false,
      aliasesCount: 0,
    }));
    const filtered = filterSupplierGridRows(base, { search: "", ruleFilter: "all" });
    const totals = supplierGridTotals(filtered);
    const page1 = paginateFinanceGridRows(filtered, { page: 1, pageSize: 10 });
    const page2 = paginateFinanceGridRows(filtered, { page: 2, pageSize: 10 });
    assert.equal(page1.pageRows.length, 10);
    assert.equal(page2.pageRows.length, 10);
    assert.equal(totals.rowCount, 30);
    assert.equal(totals.amountSum, 300);
  });

  it("toggleSortState alterna direção na mesma coluna", () => {
    const first = toggleSortState({ key: "name", direction: "asc" }, "name", "asc");
    assert.equal(first.direction, "desc");
    const second = toggleSortState(first, "amount", "desc");
    assert.equal(second.key, "amount");
    assert.equal(second.direction, "desc");
  });

  it("filtros persistem ao trocar ordenação", () => {
    const grouped = groupUnclassifiedPayablesBySupplier([
      {
        externalId: 1,
        titleAmount: 100,
        companyName: "C",
        personName: "Fornecedor A",
        cause: "NO_ALLOCATION",
        supplierId: "s1",
      },
      {
        externalId: 2,
        titleAmount: 50,
        companyName: "C",
        personName: "Fornecedor B",
        cause: "SUPPLIER_NO_RULE",
        supplierId: "s2",
      },
    ]);
    const filters = { search: "A", cause: "all" as const };
    const asc = prepareUnclassifiedGroupedRows(grouped, filters, { key: "name", direction: "asc" });
    const desc = prepareUnclassifiedGroupedRows(grouped, filters, { key: "amount", direction: "desc" });
    assert.equal(asc.length, 1);
    assert.equal(desc.length, 1);
    assert.equal(asc[0]?.name, "Fornecedor A");
    assert.equal(desc[0]?.name, "Fornecedor A");
  });

  it("sem classificação agrupado não inclui fornecedor filtrado por causa inexistente", () => {
    const grouped = groupUnclassifiedPayablesBySupplier([
      {
        externalId: 1,
        titleAmount: 100,
        companyName: null,
        personName: "Alocado Total",
        cause: "NO_ALLOCATION",
      },
    ]);
    const filtered = filterUnclassifiedGroupedRows(grouped, {
      search: "",
      cause: "SUPPLIER_NO_RULE",
    });
    assert.equal(filtered.length, 0);
  });

  it("totais de títulos sem classificação somam gap real por fornecedor", () => {
    const grouped = groupUnclassifiedPayablesBySupplier([
      { externalId: 1, titleAmount: 60, companyName: null, personName: "X", cause: "NO_ALLOCATION" },
      { externalId: 2, titleAmount: 40, companyName: null, personName: "X", cause: "NO_ALLOCATION" },
    ]);
    const totals = unclassifiedGroupedTotals(grouped);
    assert.equal(totals.rowCount, 2);
    assert.equal(totals.amountSum, 100);
  });

  it("empty state diferencia sem dados e filtros restritivos", () => {
    const noData = buildFinanceGridEmptyState(false, false, {
      title: "Vazio",
      description: "Sem registros",
    }, {
      title: "Filtrado",
      description: "Nada no filtro",
    });
    const filtered = buildFinanceGridEmptyState(true, true, {
      title: "Vazio",
      description: "Sem registros",
    }, {
      title: "Filtrado",
      description: "Nada no filtro",
    });
    assert.equal(noData.title, "Vazio");
    assert.equal(filtered.title, "Filtrado");
  });
});
