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
  auditFinanceArDashboardCalculations,
  computeFinanceArIndependentMetrics,
  financeArDraftDiffersFromApplied,
} from "./financeAccountsReceivableCalculationAudit.js";
import {
  buildFinanceArDashboardQuery,
  EMPTY_FINANCE_AR_UI_FILTERS,
  normalizeFinanceArUiFilters,
} from "./financeAccountsReceivableDashboardTypes.js";
import { buildFinanceArExportCsv } from "./financeAccountsReceivableExport.js";
import { FINANCE_AR_RECEIVED_THIS_MONTH_SCOPE } from "./financeFilterScope.js";

function row(
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

const REF = new Date(2026, 5, 6, 12, 0, 0, 0);

describe("financeAccountsReceivableCalculationAudit", () => {
  const fixture = [
    row({ externalId: 1, personName: "Alpha", balanceReceivable: 100, dueDate: new Date(2026, 5, 1) }),
    row({ externalId: 2, personName: "Beta", balanceReceivable: 200, dueDate: new Date(2026, 6, 15) }),
    row({
      externalId: 3,
      personName: "Gamma",
      balanceReceivable: 300,
      dueDate: new Date(2026, 3, 27),
      companyName: "Empresa B",
    }),
    row({
      externalId: 4,
      balanceReceivable: 0,
      amountReceived: 450,
      settlementDate: new Date(2026, 5, 4),
      dueDate: new Date(2026, 4, 1),
    }),
  ];

  it("auditFinanceArDashboardCalculations: cards batem com recálculo independente", () => {
    const result = auditFinanceArDashboardCalculations(fixture, { status: "all" }, REF);
    assert.equal(result.ok, true, result.mismatches.join("; "));
  });

  it("filtro por mês altera todos os blocos de forma coerente", () => {
    const all = auditFinanceArDashboardCalculations(fixture, { status: "all" }, REF);
    const june = auditFinanceArDashboardCalculations(
      fixture,
      { status: "all", year: 2026, month: 6 },
      REF
    );
    assert.equal(all.ok, true);
    assert.equal(june.ok, true);
    const juneDash = buildFinanceAccountsReceivableDashboard(
      fixture,
      { status: "all", year: 2026, month: 6 },
      REF
    );
    assert.equal(juneDash.cards.totalRecords, 1);
    assert.equal(juneDash.topDebtors.length, 1);
    assert.equal(juneDash.criticalTitles.length, 1);
  });

  it("aging soma equivale ao saldo em aberto com dueDate", () => {
    const dash = buildFinanceAccountsReceivableDashboard(fixture, { status: "all" }, REF);
    const ind = computeFinanceArIndependentMetrics(fixture, { status: "all" }, REF);
    const agingSum = dash.agingBuckets.reduce((s, b) => s + b.amount, 0);
    assert.equal(Math.round(agingSum * 100) / 100, ind.agingOpenTotal);
  });

  it("ranking top devedores bate com agrupamento manual", () => {
    const dash = buildFinanceAccountsReceivableDashboard(fixture, { status: "all" }, REF);
    const ind = computeFinanceArIndependentMetrics(fixture, { status: "all" }, REF);
    const topSum = dash.topDebtors.reduce((s, d) => s + d.totalOpenAmount, 0);
    assert.equal(topSum, ind.topDebtorsTotalOpen);
  });

  it("títulos críticos vêm do universo filtrado", () => {
    const filtered = filterFinanceArRows(fixture, { status: "overdue" }, REF);
    const dash = buildFinanceAccountsReceivableDashboard(fixture, { status: "overdue" }, REF);
    assert.ok(dash.criticalTitles.every((t) => t.daysOverdue > 0));
    assert.equal(dash.criticalTitles.length, Math.min(20, filtered.filter((r) => r.balanceReceivable > 0).length));
  });

  it("export CSV usa mesmas linhas filtradas", () => {
    const filters = { status: "all" as const, personName: "beta" };
    const filtered = filterFinanceArRows(fixture, filters, REF);
    const csv = buildFinanceArExportCsv(filtered, filters, REF);
    assert.match(csv, /Beta/);
    assert.doesNotMatch(csv, /Alpha/);
  });

  it("draft não altera query aplicada até aplicar", () => {
    const applied = normalizeFinanceArUiFilters(EMPTY_FINANCE_AR_UI_FILTERS);
    const draft = normalizeFinanceArUiFilters({
      ...EMPTY_FINANCE_AR_UI_FILTERS,
      personName: "Cliente Draft",
    });
    assert.equal(
      financeArDraftDiffersFromApplied(
        buildFinanceArDashboardQuery(draft),
        buildFinanceArDashboardQuery(applied)
      ),
      true
    );
  });

  it("receivedThisMonth usa mês calendário atual — exceção rotulada na UI", () => {
    const page = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceAccountsReceivablePage.tsx"),
      "utf8"
    );
    assert.ok(page.includes("FINANCE_AR_RECEIVED_THIS_MONTH_SCOPE"));
    assert.equal(
      FINANCE_AR_RECEIVED_THIS_MONTH_SCOPE.includes("calendário atual"),
      true
    );
    const dash = buildFinanceAccountsReceivableDashboard(fixture, { status: "all" }, REF);
    assert.equal(dash.cards.receivedThisMonthAmount, 450);
  });

  it("UI AR possui resumo executivo com 6 KPIs e filtros principais visíveis", () => {
    const page = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceAccountsReceivablePage.tsx"),
      "utf8"
    );
    assert.ok(page.includes("Resumo executivo"));
    assert.ok(page.includes("alwaysVisible"));
    assert.ok(page.includes("Atraso Médio"));
    assert.ok(page.includes('label="Vencido"'));
    assert.ok(page.includes("buildFinanceArPrismaWhere") === false);
    const routes = readFileSync(
      join(process.cwd(), "src", "lib", "financeAccountsReceivableRoutes.ts"),
      "utf8"
    );
    assert.ok(routes.includes("buildFinanceArPrismaWhere"));
  });
});
