import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildFinanceAccountsReceivableDashboard,
  filterFinanceArRows,
  type FinanceArDashboardRow,
} from "./financeAccountsReceivableDashboard.js";
import {
  buildFinanceAccountsPayableDashboard,
  filterFinanceApRows,
  type FinanceApDashboardRow,
} from "./financeAccountsPayableDashboard.js";
import {
  buildFinanceArDashboardQuery,
  buildFinanceArExportQuery,
  normalizeFinanceArUiFilters,
} from "./financeAccountsReceivableDashboardTypes.js";
import {
  buildFinanceApDashboardQuery,
  buildFinanceApExportQuery,
  normalizeFinanceApUiFilters,
} from "./financeAccountsPayableDashboardTypes.js";
import { buildBillingMultiYearMonthlyPoints } from "./financeBillingChartData.js";
import {
  FINANCE_BILLING_RECENT_ORDERS_SCOPE,
  FINANCE_BILLING_YTD_SCOPE,
} from "./financeFilterScope.js";
import { buildFinanceArExportCsv } from "./financeAccountsReceivableExport.js";
import { buildFinanceApExportCsv } from "./financeAccountsPayableExport.js";

const REF = new Date(2026, 5, 6, 12, 0, 0, 0);

function arRow(
  partial: Partial<FinanceArDashboardRow> & Pick<FinanceArDashboardRow, "externalId">
): FinanceArDashboardRow {
  return {
    companyName: "Empresa A",
    personName: "Cliente X",
    personCnpj: "12.345.678/0001-90",
    dueDate: new Date(2026, 5, 10),
    settlementDate: null,
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    paymentMethodName: "PIX",
    bankAccountName: "Bradesco",
    sourceInvoiceId: 100,
    sourceInvoiceNumber: "NF-100",
    suspendCollection: false,
    description: null,
    nomusStatus: null,
    syncedAt: new Date("2026-06-06T12:00:00.000Z"),
    ...partial,
  };
}

function apRow(
  partial: Partial<FinanceApDashboardRow> & Pick<FinanceApDashboardRow, "externalId">
): FinanceApDashboardRow {
  return {
    companyName: "Empresa A",
    personName: "Fornecedor X",
    personCnpj: "12.345.678/0001-90",
    dueDate: new Date(2026, 5, 10),
    settlementDate: null,
    paymentDate: null,
    amountPayable: 1000,
    amountPaid: 0,
    balancePayable: 1000,
    paymentMethodName: "PIX",
    bankAccountName: "Bradesco",
    sourceInvoiceId: 100,
    documentNumber: "NF-100",
    suspendPayment: false,
    description: null,
    nomusStatus: null,
    syncedAt: new Date("2026-06-06T12:00:00.000Z"),
    ...partial,
  };
}

function assertNoBadNumbers(values: Array<number | null | undefined>) {
  for (const v of values) {
    if (v == null) continue;
    assert.ok(Number.isFinite(v), `expected finite, got ${v}`);
    assert.notEqual(v, Infinity);
    assert.notEqual(v, -Infinity);
  }
}

describe("financeDashboardConsistencyAudit — Contas a Receber", () => {
  const rows = [
    arRow({ externalId: 1, personName: "Alpha", personCnpj: "11.111.111/0001-11", dueDate: new Date(2026, 5, 1), balanceReceivable: 100 }),
    arRow({ externalId: 2, personName: "Beta", personCnpj: "22.222.222/0001-22", dueDate: new Date(2026, 6, 15), balanceReceivable: 200 }),
    arRow({ externalId: 3, personName: "Gamma", personCnpj: "33.333.333/0001-33", dueDate: new Date(2026, 4, 20), balanceReceivable: 50, companyName: "Empresa B" }),
  ];

  it("filtro por mês afeta cards, aging, ranking e títulos críticos", () => {
    const all = buildFinanceAccountsReceivableDashboard(rows, { status: "all" }, REF);
    const june = buildFinanceAccountsReceivableDashboard(rows, { status: "all", year: 2026, month: 6 }, REF);
    assert.equal(all.cards.totalRecords, 3);
    assert.equal(june.cards.totalRecords, 1);
    assert.equal(june.cards.totalOpenAmount, 100);
    assert.ok(june.agingBuckets.every((b) => Number.isFinite(b.amount)));
    assert.equal(june.topDebtors.length, 1);
    assert.equal(june.criticalTitles.length, 1);
  });

  it("filtro por cliente/fornecedor afeta ranking e export", () => {
    const filtered = buildFinanceAccountsReceivableDashboard(rows, { status: "all", personName: "beta" }, REF);
    assert.equal(filtered.cards.totalRecords, 1);
    assert.equal(filtered.customerRanking.length, 1);
    assert.equal(filtered.customerRanking[0]?.personName, "Beta");
    const csv = buildFinanceArExportCsv(
      filterFinanceArRows(rows, { status: "all", personName: "beta" }, REF),
      { status: "all", personName: "beta" },
      REF
    );
    assert.match(csv, /Beta/);
    assert.doesNotMatch(csv, /Alpha/);
  });

  it("filtro por status overdue afeta cards e action center input", () => {
    const dash = buildFinanceAccountsReceivableDashboard(rows, { status: "overdue" }, REF);
    assert.equal(dash.cards.totalRecords, 2);
    assert.equal(dash.cards.overdueAmount, 150);
    assert.ok(dash.criticalTitles.every((t) => (t.daysOverdue ?? 0) > 0));
  });

  it("filtro por CNPJ afeta cards", () => {
    const dash = buildFinanceAccountsReceivableDashboard(
      rows,
      { status: "all", personCnpj: "22222222000122" },
      REF
    );
    assert.equal(dash.cards.totalRecords, 1);
    assert.equal(dash.topDebtors[0]?.personName, "Beta");
  });

  it("export CSV usa filtros aplicados (não draft) e inclui format=csv", () => {
    const applied = normalizeFinanceArUiFilters({
      year: "2026",
      month: "6",
      status: "overdue",
      companyName: "",
      personName: "",
      personCnpj: "",
      dueDateFrom: "",
      dueDateTo: "",
      documentQuery: "",
      invoiceIssued: "all",
    });
    const dashQs = buildFinanceArDashboardQuery(applied);
    const exportQs = buildFinanceArExportQuery(applied);
    assert.ok(exportQs.includes(dashQs));
    assert.ok(exportQs.includes("format=csv"));
    const page = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceAccountsReceivablePage.tsx"),
      "utf8"
    );
    assert.ok(page.includes("buildFinanceArExportQuery(appliedFilters)"));
    assert.ok(!page.includes("buildFinanceArExportQuery(draftFilters)"));
  });

  it("métricas numéricas do dashboard não contêm NaN/Infinity", () => {
    const dash = buildFinanceAccountsReceivableDashboard(rows, { status: "all" }, REF);
    assertNoBadNumbers([
      dash.cards.totalOpenAmount,
      dash.cards.delinquencyRate,
      dash.cards.avgDaysOverdue,
      ...dash.agingBuckets.map((b) => b.percentOfOpenAmount),
      ...dash.topDebtors.map((d) => d.percentOfPortfolio),
    ]);
  });
});

describe("financeDashboardConsistencyAudit — Contas a Pagar", () => {
  const rows = [
    apRow({ externalId: 1, personName: "Alpha", personCnpj: "11.111.111/0001-11", dueDate: new Date(2026, 5, 1), balancePayable: 100 }),
    apRow({ externalId: 2, personName: "Beta", personCnpj: "22.222.222/0001-22", dueDate: new Date(2026, 6, 15), balancePayable: 200 }),
    apRow({ externalId: 3, personName: "Gamma", companyName: "Empresa B", dueDate: new Date(2026, 4, 20), balancePayable: 50 }),
  ];

  it("filtro por mês afeta cards, aging, ranking e títulos críticos", () => {
    const all = buildFinanceAccountsPayableDashboard(rows, { status: "all" }, REF);
    const june = buildFinanceAccountsPayableDashboard(rows, { status: "all", year: 2026, month: 6 }, REF);
    assert.equal(all.cards.totalRecords, 3);
    assert.equal(june.cards.totalRecords, 1);
    assert.equal(june.topSuppliers.length, 1);
    assert.equal(june.criticalTitles.length, 1);
  });

  it("filtro por fornecedor afeta ranking e export", () => {
    const dash = buildFinanceAccountsPayableDashboard(rows, { status: "all", personName: "gamma" }, REF);
    assert.equal(dash.cards.totalRecords, 1);
    assert.equal(dash.supplierRanking[0]?.personName, "Gamma");
    const csv = buildFinanceApExportCsv(
      filterFinanceApRows(rows, { status: "all", personName: "gamma" }, REF),
      { status: "all", personName: "gamma" },
      REF
    );
    assert.match(csv, /Gamma/);
    assert.doesNotMatch(csv, /Alpha/);
  });

  it("filtro por status open afeta cards", () => {
    const rowsWithSettled = [
      ...rows,
      apRow({ externalId: 4, balancePayable: 0, dueDate: new Date(2026, 5, 1) }),
    ];
    const dash = buildFinanceAccountsPayableDashboard(rowsWithSettled, { status: "open" }, REF);
    assert.equal(dash.cards.totalRecords, 3);
    assert.equal(dash.cards.settledTitlesCount, 0);
  });

  it("filtro por empresa afeta cards", () => {
    const dash = buildFinanceAccountsPayableDashboard(
      rows,
      { status: "all", companyName: "Empresa B" },
      REF
    );
    assert.equal(dash.cards.totalRecords, 1);
    assert.equal(dash.companySummary[0]?.companyName, "Empresa B");
  });

  it("export CSV usa filtros aplicados e format=csv", () => {
    const applied = normalizeFinanceApUiFilters({
      year: "2026",
      month: "6",
      status: "overdue",
      companyName: "",
      personName: "Alpha",
      personCnpj: "",
      dueDateFrom: "",
      dueDateTo: "",
      documentQuery: "",
      paymentMethodName: "",
      bankAccountName: "",
      suspendPayment: "all",
    });
    const exportQs = buildFinanceApExportQuery(applied);
    assert.ok(exportQs.includes(buildFinanceApDashboardQuery(applied)));
    assert.ok(exportQs.includes("format=csv"));
  });

  it("label de qualidade AP usa terminologia de pagamento", () => {
    const src = readFileSync(
      join(process.cwd(), "src", "lib", "financeAccountsPayableDataQuality.ts"),
      "utf8"
    );
    assert.ok(src.includes('label: "Valor pago maior que valor original"'));
    assert.ok(!src.includes('label: "Valor recebido maior que valor original"'));
  });

  it("métricas numéricas do dashboard não contêm NaN/Infinity", () => {
    const dash = buildFinanceAccountsPayableDashboard(rows, { status: "all" }, REF);
    assertNoBadNumbers([
      dash.cards.totalOpenAmount,
      dash.cards.overduePercent,
      dash.cards.avgDaysOverdue,
      ...dash.agingBuckets.map((b) => b.percentOfOpenAmount),
    ]);
  });
});

describe("financeDashboardConsistencyAudit — Faturamento", () => {
  it("meses futuros retornam null (não zero falso) no gráfico multi-ano", () => {
    const maps = new Map<number, Map<number, number>>();
    maps.set(2026, new Map([[6, 250]]));
    const points = buildBillingMultiYearMonthlyPoints(2026, maps, 6, true);
    assert.equal(points[5]!.values[2026], 250);
    assert.equal(points[6]!.values[2026], null);
    assert.equal(points[11]!.values[2026], null);
  });

  it("exceção YTD rotulada no frontend", () => {
    const views = readFileSync(
      join(process.cwd(), "src", "components", "finance", "billing", "FinanceBillingExecutiveViews.tsx"),
      "utf8"
    );
    assert.ok(views.includes(FINANCE_BILLING_YTD_SCOPE));
    assert.ok(views.includes("Acumulado YTD"));
  });

  it("exceção faturamentos recentes rotulada", () => {
    const views = readFileSync(
      join(process.cwd(), "src", "components", "finance", "billing", "FinanceBillingExecutiveViews.tsx"),
      "utf8"
    );
    assert.ok(views.includes(FINANCE_BILLING_RECENT_ORDERS_SCOPE));
    assert.ok(views.includes("Faturamentos recentes"));
  });

  it("guarda billingTabMetricsAreFinite existe para validar NaN/Infinity", () => {
    const src = readFileSync(
      join(process.cwd(), "src", "lib", "financeBillingDashboard.ts"),
      "utf8"
    );
    assert.ok(src.includes("billingTabMetricsAreFinite"));
    assert.ok(src.includes("Number.isFinite"));
  });
});
