import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import * as XLSX from "xlsx";
import {
  buildCostCenterDetailSummaryFromRows,
  matchesCostCenterDetailFilters,
  sortCostCenterDetailRows,
  type CostCenterDetailListFilters,
} from "./financeCostCenterDetail.js";
import type {
  CostCenterDetailAllocationRow,
  CostCenterDetailExportPayload,
} from "./financeCostCenterDetailShared.js";
import {
  buildCostCenterExpenseMapExportQuery,
  DEFAULT_COST_CENTER_EXPENSE_MAP_DRILLDOWN_FILTERS,
} from "./financeCostCenterExpenseMap.js";
import { createDefaultFinanceCostCentersUiFilters } from "./financeCostCentersPageTypes.js";
import {
  buildCostCenterDetailAppliedFilterLines,
  buildCostCenterDetailAppliedFilterLinesFromQuery,
  buildCostCenterDetailExportFilename,
  sanitizeCostCenterExportSlug,
} from "./financeCostCenterDetailExportMeta.js";
import { buildCostCenterDetailExportWorkbook } from "./financeCostCenterDetailExport.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

function row(overrides: Partial<CostCenterDetailAllocationRow> = {}): CostCenterDetailAllocationRow {
  return {
    allocationId: "a1",
    accountsPayableId: 100,
    companyName: "KOPPETEL",
    personName: "PATRIMONIAL PK",
    personCnpj: "11111111000111",
    nomusClassification: "40.01",
    description: "Investimento",
    comments: null,
    documentNumber: "DOC-1",
    sourceInvoiceId: null,
    dueDate: "2026-08-06T00:00:00.000Z",
    competenceDate: "2026-07-01T00:00:00.000Z",
    paymentDate: null,
    settlementDate: null,
    statusKey: "overdue",
    statusLabel: "Vencido",
    amountPayable: 1000,
    balancePayable: 800,
    allocatedAmount: 1000,
    allocatedPercentage: 100,
    allocationSource: "MANUAL",
    lockedManual: true,
    costCenterId: "cc-1",
    costCenterCode: "CC_ADMIN",
    costCenterName: "INVESTIMENTO SOCIOS",
    supplierId: "sup-1",
    supplierName: "PATRIMONIAL PK",
    allocationNotes: null,
    allocationCreatedAt: "2026-01-01T00:00:00.000Z",
    allocationUpdatedAt: "2026-01-02T00:00:00.000Z",
    isPartialTitle: false,
    ...overrides,
  };
}

function exportPayload(rows: CostCenterDetailAllocationRow[]): CostCenterDetailExportPayload {
  const summary = buildCostCenterDetailSummaryFromRows(
    {
      id: "cc-1",
      code: "CC_ADMINISTRATIVO_INVESTIMENTO_SOCIOS",
      name: "INVESTIMENTO SOCIOS",
      parentId: "parent-1",
      parentCode: "ADM",
      parentName: "ADMINISTRATIVO",
      status: "ACTIVE",
    },
    rows
  );
  const totals = rows.reduce(
    (acc, item) => {
      acc.allocatedAmount += item.allocatedAmount;
      acc.balancePayable += item.balancePayable;
      acc.amountPayable += item.amountPayable;
      return acc;
    },
    { allocatedAmount: 0, balancePayable: 0, amountPayable: 0 }
  );
  return {
    generatedAt: "2026-06-24T12:00:00.000Z",
    center: {
      id: "cc-1",
      code: "CC_ADMINISTRATIVO_INVESTIMENTO_SOCIOS",
      name: "INVESTIMENTO SOCIOS",
      parentCode: "ADM",
      parentName: "ADMINISTRATIVO",
    },
    summary,
    rows,
    totals,
    sortBy: "allocatedAmount",
    sortDirection: "desc",
    appliedFilters: [
      { label: "Ano", value: "2026" },
      { label: "Fornecedor", value: "PATRIMONIAL PK" },
    ],
    userName: "Paulo",
  };
}

describe("financeCostCenterDetailExport", () => {
  it("botões Exportar Excel/PDF aparecem no detalhe do mapa de gastos", () => {
    const ui = read("src/components/finance/cost-centers/FinanceCostCenterExpenseMapSection.tsx");
    assert.ok(ui.includes('data-testid="finance-cc-expense-map-export-excel"'));
    assert.ok(ui.includes('data-testid="finance-cc-expense-map-export-pdf"'));
    assert.ok(ui.includes("Exportar Excel"));
    assert.ok(ui.includes("Exportar PDF"));
    assert.ok(ui.includes("Fechar detalhe"));
  });

  it("export query envia centro e filtros do drilldown", () => {
    const pageFilters = createDefaultFinanceCostCentersUiFilters();
    pageFilters.year = 2026;
    const qs = buildCostCenterExpenseMapExportQuery(pageFilters, {
      ...DEFAULT_COST_CENTER_EXPENSE_MAP_DRILLDOWN_FILTERS,
      search: "patrimonial",
      supplierName: "PATRIMONIAL PK",
      companyName: "KOPPETEL",
      classification: "40.01",
      status: "overdue",
      timing: "overdue",
      allocationSource: "MANUAL",
      lockedOnly: true,
      minAmount: "100",
      maxAmount: "5000",
      dueDateFrom: "2026-01-01",
      dueDateTo: "2026-12-31",
      competenceDateFrom: "2026-01-01",
      competenceDateTo: "2026-06-30",
      paymentDateFrom: "2026-02-01",
      paymentDateTo: "2026-03-01",
    });
    assert.match(qs, /year=2026/);
    assert.match(qs, /search=patrimonial/);
    assert.match(qs, /personName=PATRIMONIAL/);
    assert.match(qs, /companyName=KOPPETEL/);
    assert.match(qs, /nomusClassification=40\.01/);
    assert.match(qs, /status=overdue/);
    assert.match(qs, /timing=overdue/);
    assert.match(qs, /allocationSource=MANUAL/);
    assert.match(qs, /lockedOnly=true/);
    assert.match(qs, /minAmount=100/);
    assert.match(qs, /maxAmount=5000/);
    assert.match(qs, /dueDateFrom=2026-01-01/);
    assert.match(qs, /dueDateTo=2026-12-31/);
    assert.match(qs, /competenceDateFrom=2026-01-01/);
    assert.match(qs, /competenceDateTo=2026-06-30/);
    assert.match(qs, /paymentDateFrom=2026-02-01/);
    assert.match(qs, /paymentDateTo=2026-03-01/);
    assert.doesNotMatch(qs, /page=/);
    assert.doesNotMatch(qs, /limit=/);
  });

  it("UI chama endpoints de exportação com costCenterId selecionado", () => {
    const ui = read("src/components/finance/cost-centers/FinanceCostCenterExpenseMapSection.tsx");
    assert.ok(ui.includes("/detail/export.xlsx?"));
    assert.ok(ui.includes("/detail/export-data?"));
    assert.ok(ui.includes("${detailCenterIds[0]}"));
    assert.ok(ui.includes("/api/finance/cost-centers/detail/export.xlsx?"));
    assert.ok(ui.includes("buildCostCenterSelectionExportFilename"));
  });

  it("rotas expõem export.xlsx e export-data", () => {
    const routes = read("src/lib/financeCostCenterDetailRoutes.ts");
    assert.ok(routes.includes("/api/finance/cost-centers/:id/detail/export.xlsx"));
    assert.ok(routes.includes("/api/finance/cost-centers/:id/detail/export-data"));
    assert.ok(routes.includes("/api/finance/cost-centers/detail/export.xlsx"));
    assert.ok(routes.includes("/api/finance/cost-centers/detail/export-data"));
  });

  it("filtros aplicados são exibidos no relatório", () => {
    const lines = buildCostCenterDetailAppliedFilterLines({
      pageFilters: { ...createDefaultFinanceCostCentersUiFilters(), year: 2026 },
      drilldown: {
        ...DEFAULT_COST_CENTER_EXPENSE_MAP_DRILLDOWN_FILTERS,
        supplierName: "PATRIMONIAL PK",
        dueDateFrom: "2026-01-01",
        dueDateTo: "2026-12-31",
        lockedOnly: true,
      },
    });
    assert.ok(lines.some((line) => line.label === "Ano" && line.value === "2026"));
    assert.ok(lines.some((line) => line.label === "Fornecedor" && line.value === "PATRIMONIAL PK"));
    assert.ok(lines.some((line) => line.label === "Vencimento" && line.value.includes("01/01/2026")));
    assert.ok(lines.some((line) => line.label === "Apenas locked manual" && line.value === "Sim"));

    const fromQuery = buildCostCenterDetailAppliedFilterLinesFromQuery({
      year: "2026",
      search: "ap",
      personName: "Fornecedor",
      lockedOnly: "true",
    });
    assert.ok(fromQuery.some((line) => line.label === "Busca" && line.value === "ap"));
  });

  it("Excel contém resumo, filtros, títulos e totais de todos os registros filtrados", () => {
    const rows = [
      row({ allocationId: "a1", allocatedAmount: 1000, amountPayable: 1000, balancePayable: 800 }),
      row({
        allocationId: "a2",
        accountsPayableId: 101,
        allocatedAmount: 500,
        amountPayable: 500,
        balancePayable: 500,
      }),
    ];
    const payload = exportPayload(rows);
    const wb = buildCostCenterDetailExportWorkbook(payload);
    assert.ok(wb.SheetNames.includes("Resumo"));
    assert.ok(wb.SheetNames.includes("Filtros aplicados"));
    assert.ok(wb.SheetNames.includes("Títulos"));

    const titles = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets["Títulos"]!);
    assert.equal(titles.length, 3);
    const totalRow = titles[2]!;
    assert.equal(totalRow.AP, "Total");
    assert.equal(totalRow.Valor, 1500);
    assert.equal(totalRow.Saldo, 1300);
    assert.equal(totalRow["Valor alocado"], 1500);

    const resumo = XLSX.utils.sheet_to_json<{ Campo: string; Valor: unknown }>(wb.Sheets["Resumo"]!);
    assert.ok(resumo.some((line) => line.Campo === "Total alocado" && line.Valor === 1500));
    assert.ok(
      resumo.some((line) => line.Campo === "Quantidade de títulos" && line.Valor === 2)
    );

    const filters = XLSX.utils.sheet_to_json<{ Filtro: string; Valor: string }>(
      wb.Sheets["Filtros aplicados"]!
    );
    assert.ok(filters.some((line) => line.Filtro === "Ano"));
  });

  it("totalizadores da exportação batem com resumo do detalhe", () => {
    const rows = [row({ allocatedAmount: 1200, amountPayable: 1200, balancePayable: 900 })];
    const payload = exportPayload(rows);
    assert.equal(payload.summary.totalAllocatedAmount, payload.totals.allocatedAmount);
    assert.equal(payload.summary.titlesCount, 1);
    assert.equal(payload.totals.amountPayable, 1200);
    assert.equal(payload.totals.balancePayable, 900);
  });

  it("busca interna filtra linhas usadas na exportação", () => {
    const filters: CostCenterDetailListFilters = { status: "all", search: "patrimonial" };
    assert.equal(matchesCostCenterDetailFilters(row({ supplierName: "PATRIMONIAL PK" }), filters), true);
    assert.equal(
      matchesCostCenterDetailFilters(
        row({ supplierName: "Outro", personName: "Fornecedor Z" }),
        filters
      ),
      false
    );
  });

  it("nome de arquivo é sanitizado", () => {
    assert.equal(
      sanitizeCostCenterExportSlug("INVESTIMENTO SÓCIOS"),
      "investimento-socios"
    );
    assert.match(
      buildCostCenterDetailExportFilename("INVESTIMENTO SOCIOS", new Date("2026-06-24")),
      /^centro-custo-investimento-socios-2026\.xlsx$/
    );
  });

  it("PDF usa documento de impressão com filtros, coluna alocado e tabela", () => {
    const printDoc = read(
      "src/components/finance/cost-centers/FinanceCostCenterDetailPrintDocument.tsx"
    );
    assert.ok(printDoc.includes("Filtros aplicados"));
    assert.ok(printDoc.includes("finance-cc-detail-print-data-table"));
    assert.ok(printDoc.includes("FINANCE_CC_DETAIL_EXPORT_TITLE"));
    assert.ok(printDoc.includes(">Alocado<"));
    assert.ok(printDoc.includes("payload.totals.allocatedAmount"));
    assert.ok(printDoc.includes("FinanceCostCenterMonthlyPrintChart"));
    assert.ok(printDoc.includes("payload.monthlyChart"));
    assert.ok(printDoc.indexOf("FinanceCostCenterMonthlyPrintChart") < printDoc.indexOf("Títulos alocados"));
  });

  it("PDF inclui gráfico mensal pago/em aberto antes do grid", () => {
    const printChart = read(
      "src/components/finance/cost-centers/FinanceCostCenterMonthlyPrintChart.tsx"
    );
    const css = read("src/components/finance/cost-centers/finance-cc-detail-print.css");
    const ui = read("src/components/finance/cost-centers/FinanceCostCenterExpenseMapSection.tsx");
    assert.ok(printChart.includes("Pago / realizado"));
    assert.ok(printChart.includes("Previsto / em aberto"));
    assert.ok(printChart.includes("paidAmount"));
    assert.ok(printChart.includes("openAmount"));
    assert.ok(css.includes("finance-cc-detail-print-chart-segment--paid"));
    assert.ok(css.includes("finance-cc-detail-print-chart-segment--open"));
    assert.ok(ui.includes("monthlyChart"));
    assert.ok(ui.includes("buildCostCenterMonthlyChartQuery"));
  });

  it("detalhe do mapa usa summary da listagem (uma única fonte)", () => {
    const ui = read("src/components/finance/cost-centers/FinanceCostCenterExpenseMapSection.tsx");
    assert.doesNotMatch(ui, /\/summary\?/);
    assert.ok(ui.includes("setSummary(listRes.summary)"));
    assert.ok(ui.includes("list.totals.allocatedAmount"));
  });

  it("exportação não reintroduz Prisma no componente de detalhe", () => {
    const ui = read("src/components/finance/cost-centers/FinanceCostCenterExpenseMapSection.tsx");
    assert.doesNotMatch(ui, /@prisma\/client|PrismaClient|src\/lib\/prisma/);
  });

  it("grid e export compartilham resolveCostCenterDetailFilteredRows", () => {
    const lib = read("src/lib/financeCostCenterDetail.ts");
    assert.ok(lib.includes("resolveCostCenterDetailFilteredRows"));
    assert.ok(lib.includes("buildCostCenterDetailViewFromRows"));
    assert.ok(lib.includes("buildCostCenterDetailExportPayloadDefault"));
    assert.ok(lib.includes("listCostCenterDetailAllocationsDefault"));
  });
});
