import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFinanceAccountsPayableDashboard,
  classifyFinanceApTitle,
  computeDaysOverdue,
  filterFinanceApRows,
  FinanceApFilterParseError,
  hasFinanceApDocument,
  parseFinanceApDashboardFilters,
  resolveFinanceApDueDateBounds,
  resolveFinanceApSupplierKey,
  startOfLocalDay,
  type FinanceApDashboardRow,
} from "./financeAccountsPayableDashboard.js";

function row(partial: Partial<FinanceApDashboardRow> & Pick<FinanceApDashboardRow, "externalId">): FinanceApDashboardRow {
  return {
    companyName: "Empresa A",
    personName: "Fornecedor X",
    personCnpj: "12.345.678/0001-90",
    dueDate: null,
    settlementDate: null,
    paymentDate: null,
    amountPayable: 1000,
    amountPaid: 0,
    balancePayable: 1000,
    paymentMethodName: "Boleto",
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

const REF = new Date(2026, 5, 6, 12, 0, 0, 0); // 06/06/2026 local

describe("financeAccountsPayableDashboard", () => {
  it("calcula cards principais: aberto, vencido, a vencer, vence hoje", () => {
    const rows = [
      row({ externalId: 1, balancePayable: 100, dueDate: new Date(2026, 5, 1) }), // overdue
      row({ externalId: 2, balancePayable: 200, dueDate: new Date(2026, 5, 6) }), // due today
      row({ externalId: 3, balancePayable: 300, dueDate: new Date(2026, 5, 20) }), // upcoming
      row({ externalId: 4, balancePayable: 0, dueDate: new Date(2026, 4, 1) }), // settled
    ];

    const dash = buildFinanceAccountsPayableDashboard(rows, { status: "all" }, REF);
    assert.equal(dash.cards.totalRecords, 4);
    assert.equal(dash.cards.openTitlesCount, 3);
    assert.equal(dash.cards.settledTitlesCount, 1);
    assert.equal(dash.cards.totalOpenAmount, 600);
    assert.equal(dash.cards.overdueAmount, 100);
    assert.equal(dash.cards.dueTodayAmount, 200);
    assert.equal(dash.cards.upcomingAmount, 300);
  });

  it("calcula próximos 7/30 dias e atrasoência", () => {
    const rows = [
      row({ externalId: 1, balancePayable: 100, dueDate: new Date(2026, 5, 10) }),
      row({ externalId: 2, balancePayable: 50, dueDate: new Date(2026, 5, 1) }),
      row({ externalId: 3, balancePayable: 25, dueDate: new Date(2026, 6, 1) }),
    ];
    const dash = buildFinanceAccountsPayableDashboard(rows, { status: "all" }, REF);
    assert.equal(dash.cards.dueNext7DaysAmount, 100);
    assert.equal(dash.cards.dueNext30DaysAmount, 125);
    assert.equal(dash.cards.overduePercent, Number(((50 / 175) * 100).toFixed(2)));
  });

  it("atrasoência com denominador zero retorna 0", () => {
    const dash = buildFinanceAccountsPayableDashboard(
      [row({ externalId: 1, balancePayable: 0 })],
      { status: "all" },
      REF
    );
    assert.equal(dash.cards.overduePercent, 0);
    assert.ok(Number.isFinite(dash.cards.overduePercent));
  });

  it("monta aging buckets e percentuais sem NaN", () => {
    const rows = [
      row({ externalId: 1, balancePayable: 100, dueDate: new Date(2026, 5, 20) }),
      row({ externalId: 2, balancePayable: 200, dueDate: new Date(2026, 5, 6) }),
      row({ externalId: 3, balancePayable: 300, dueDate: new Date(2026, 5, 1) }),
    ];
    const dash = buildFinanceAccountsPayableDashboard(rows, { status: "all" }, REF);
    assert.equal(dash.agingBuckets.length, 8);
    const totalPercent = dash.agingBuckets.reduce((acc, b) => acc + b.percentOfOpenAmount, 0);
    assert.ok(Number.isFinite(totalPercent));
    assert.ok(dash.agingBuckets.every((b) => Number.isFinite(b.amount)));
  });

  it("topSuppliers agrupa por CNPJ e calcula percentual da carteira", () => {
    const rows = [
      row({
        externalId: 1,
        personCnpj: "11.111.111/0001-11",
        personName: "A",
        balancePayable: 700,
        dueDate: new Date(2026, 5, 1),
      }),
      row({
        externalId: 2,
        personCnpj: "22.222.222/0001-22",
        personName: "B",
        balancePayable: 300,
        dueDate: new Date(2026, 5, 10),
      }),
    ];
    const dash = buildFinanceAccountsPayableDashboard(rows, { status: "all" }, REF);
    assert.equal(dash.topSuppliers.length, 2);
    assert.equal(dash.topSuppliers[0]?.personCnpj, "11.111.111/0001-11");
    assert.equal(dash.topSuppliers[0]?.percentOfPortfolio, 70);
  });

  it("usa personName quando CNPJ ausente", () => {
    assert.equal(
      resolveFinanceApSupplierKey({ personCnpj: null, personName: "Fornecedor Y", externalId: 9 }),
      "name:fornecedor y"
    );
  });

  it("filtros básicos por status e personName", () => {
    const rows = [
      row({ externalId: 1, personName: "Alpha Ltda", balancePayable: 100, dueDate: new Date(2026, 5, 1) }),
      row({ externalId: 2, personName: "Beta SA", balancePayable: 200, dueDate: new Date(2026, 5, 20) }),
    ];
    const overdueOnly = buildFinanceAccountsPayableDashboard(
      rows,
      { status: "overdue", personName: "alpha" },
      REF
    );
    assert.equal(overdueOnly.cards.totalRecords, 1);
    assert.equal(overdueOnly.cards.overdueAmount, 100);
  });

  it("datas no limite do dia: vence hoje vs ontem", () => {
    const todayMorning = new Date(2026, 5, 6, 8, 0, 0);
    const yesterday = new Date(2026, 5, 5, 23, 59, 0);
    assert.equal(classifyFinanceApTitle(row({ externalId: 1, dueDate: todayMorning }), REF), "dueToday");
    assert.equal(classifyFinanceApTitle(row({ externalId: 2, dueDate: yesterday }), REF), "overdue");
    assert.equal(computeDaysOverdue(yesterday, REF), 1);
  });

  it("dataQualityAlerts e saldos negativos", () => {
    const rows = [
      row({
        externalId: 1,
        balancePayable: 100,
        dueDate: null,
        personCnpj: null,
        paymentMethodName: null,
        sourceInvoiceId: null,
        documentNumber: null,
        amountPayable: 50,
        amountPaid: 80,
        suspendPayment: true,
      }),
      row({
        externalId: 2,
        balancePayable: -10,
        dueDate: new Date(2026, 5, 1),
        amountPayable: 50,
        amountPaid: 0,
      }),
    ];
    const dash = buildFinanceAccountsPayableDashboard(rows, { status: "all" }, REF);
    assert.equal(dash.dataQualityAlerts.negativeBalance, 1);
    assert.equal(dash.dataQualityAlerts.missingDueDate, 1);
    assert.equal(dash.dataQualityAlerts.missingPersonCnpj, 1);
    assert.equal(dash.dataQualityAlerts.missingPaymentMethod, 1);
    assert.equal(dash.dataQualityAlerts.paidGreaterThanPayable, 1);
    assert.equal(dash.dataQualityAlerts.suspendedPaymentOpen, 1);
    assert.ok(dash.dataQualitySummary.length >= 5);
  });

  it("calcula totalPayableAmount e topSupplier", () => {
    const rows = [
      row({
        externalId: 1,
        balancePayable: 500,
        amountPayable: 500,
        dueDate: new Date(2026, 5, 1),
      }),
      row({
        externalId: 2,
        balancePayable: 200,
        amountPayable: 200,
        dueDate: new Date(2026, 5, 20),
        personName: "Fornecedor B",
        personCnpj: "98.765.432/0001-10",
      }),
    ];
    const dash = buildFinanceAccountsPayableDashboard(rows, { status: "all" }, REF);
    assert.equal(dash.cards.totalPayableAmount, 700);
    assert.equal(dash.cards.topSupplier?.totalOpenAmount, 500);
  });

  it("hasFinanceApDocument detecta id ou número", () => {
    assert.equal(hasFinanceApDocument({ sourceInvoiceId: 1, documentNumber: null }), true);
    assert.equal(
      hasFinanceApDocument({ sourceInvoiceId: null, documentNumber: "123" }),
      true
    );
    assert.equal(
      hasFinanceApDocument({ sourceInvoiceId: null, documentNumber: null }),
      false
    );
  });

  it("filterFinanceApRows filtra documentQuery e suspendPayment", () => {
    const rows = [
      row({ externalId: 1, sourceInvoiceId: 1, documentNumber: "NF-1" }),
      row({ externalId: 2, sourceInvoiceId: null, documentNumber: "DOC-2", suspendPayment: true }),
    ];
    const byDoc = filterFinanceApRows(rows, { status: "all", documentQuery: "NF-1" }, REF);
    const suspended = filterFinanceApRows(rows, { status: "all", suspendPayment: "yes" }, REF);
    assert.deepEqual(byDoc.map((r) => r.externalId), [1]);
    assert.deepEqual(suspended.map((r) => r.externalId), [2]);
  });

  it("parseFinanceApDashboardFilters interpreta documentQuery e suspendPayment", () => {
    assert.equal(parseFinanceApDashboardFilters({ documentQuery: "NF-10" }).documentQuery, "NF-10");
    assert.equal(parseFinanceApDashboardFilters({ suspendPayment: "yes" }).suspendPayment, "yes");
    assert.equal(parseFinanceApDashboardFilters({ suspendPayment: "nao" }).suspendPayment, "no");
    assert.throws(
      () => parseFinanceApDashboardFilters({ suspendPayment: "talvez" }),
      FinanceApFilterParseError
    );
  });

  it("parseFinanceApDashboardFilters interpreta query params", () => {
    const filters = parseFinanceApDashboardFilters({
      status: "overdue",
      dueDateFrom: "2026-06-01",
      dueDateTo: "2026-06-30",
      companyName: "Empresa",
    });
    assert.equal(filters.status, "overdue");
    assert.ok(filters.dueDateFrom instanceof Date);
    assert.ok(filters.dueDateTo instanceof Date);
  });

  it("parseFinanceApDashboardFilters aceita year e month válidos", () => {
    const filters = parseFinanceApDashboardFilters({ year: "2026", month: "6" });
    assert.equal(filters.year, 2026);
    assert.equal(filters.month, 6);
  });

  it("parseFinanceApDashboardFilters aceita year sem month", () => {
    const filters = parseFinanceApDashboardFilters({ year: "2026" });
    assert.equal(filters.year, 2026);
    assert.equal(filters.month, undefined);
  });

  it("parseFinanceApDashboardFilters rejeita month sem year", () => {
    assert.throws(
      () => parseFinanceApDashboardFilters({ month: "6" }),
      FinanceApFilterParseError
    );
  });

  it("parseFinanceApDashboardFilters rejeita year inválido", () => {
    assert.throws(
      () => parseFinanceApDashboardFilters({ year: "26" }),
      FinanceApFilterParseError
    );
    assert.throws(
      () => parseFinanceApDashboardFilters({ year: "abcd" }),
      FinanceApFilterParseError
    );
  });

  it("parseFinanceApDashboardFilters rejeita month inválido", () => {
    assert.throws(
      () => parseFinanceApDashboardFilters({ year: "2026", month: "13" }),
      FinanceApFilterParseError
    );
    assert.throws(
      () => parseFinanceApDashboardFilters({ year: "2026", month: "0" }),
      FinanceApFilterParseError
    );
  });

  it("filterFinanceApRows filtra somente ano 2026", () => {
    const rows = [
      row({ externalId: 1, dueDate: new Date(2025, 11, 31) }),
      row({ externalId: 2, dueDate: new Date(2026, 0, 1) }),
      row({ externalId: 3, dueDate: new Date(2026, 11, 31) }),
      row({ externalId: 4, dueDate: new Date(2027, 0, 1) }),
    ];
    const filtered = filterFinanceApRows(rows, { status: "all", year: 2026 }, REF);
    assert.deepEqual(
      filtered.map((r) => r.externalId),
      [2, 3]
    );
  });

  it("filterFinanceApRows filtra junho/2026 sem incluir maio ou julho", () => {
    const rows = [
      row({ externalId: 1, dueDate: new Date(2026, 4, 31) }),
      row({ externalId: 2, dueDate: new Date(2026, 5, 1) }),
      row({ externalId: 3, dueDate: new Date(2026, 5, 30) }),
      row({ externalId: 4, dueDate: new Date(2026, 6, 1) }),
    ];
    const filtered = filterFinanceApRows(
      rows,
      { status: "all", year: 2026, month: 6 },
      REF
    );
    assert.deepEqual(
      filtered.map((r) => r.externalId),
      [2, 3]
    );
  });

  it("resolveFinanceApDueDateBounds usa intervalo half-open para mês", () => {
    const bounds = resolveFinanceApDueDateBounds({ year: 2026, month: 6 });
    assert.equal(bounds.from?.getFullYear(), 2026);
    assert.equal(bounds.from?.getMonth(), 5);
    assert.equal(bounds.from?.getDate(), 1);
    assert.equal(bounds.toExclusive?.getFullYear(), 2026);
    assert.equal(bounds.toExclusive?.getMonth(), 6);
    assert.equal(bounds.toExclusive?.getDate(), 1);
    assert.equal(bounds.empty, false);
  });

  it("filterFinanceApRows usa interseção com dueDateFrom/dueDateTo", () => {
    const rows = [
      row({ externalId: 1, dueDate: new Date(2026, 5, 5) }),
      row({ externalId: 2, dueDate: new Date(2026, 5, 20) }),
      row({ externalId: 3, dueDate: new Date(2026, 5, 28) }),
    ];
    const filtered = filterFinanceApRows(
      rows,
      {
        status: "all",
        year: 2026,
        month: 6,
        dueDateFrom: new Date(2026, 5, 10),
        dueDateTo: new Date(2026, 5, 25),
      },
      REF
    );
    assert.deepEqual(
      filtered.map((r) => r.externalId),
      [2]
    );
  });

  it("resolveFinanceApDueDateBounds retorna empty quando interseção é inválida", () => {
    const bounds = resolveFinanceApDueDateBounds({
      year: 2026,
      month: 6,
      dueDateFrom: new Date(2026, 6, 1),
      dueDateTo: new Date(2026, 6, 30),
    });
    assert.equal(bounds.empty, true);
    assert.equal(
      filterFinanceApRows(
        [row({ externalId: 1, dueDate: new Date(2026, 5, 15) })],
        { status: "all", year: 2026, month: 6, dueDateFrom: new Date(2026, 6, 1) },
        REF
      ).length,
      0
    );
  });

  it("filterFinanceApRows respeita intervalo dueDateFrom/dueDateTo", () => {
    const rows = [
      row({ externalId: 1, dueDate: new Date(2026, 4, 31) }),
      row({ externalId: 2, dueDate: new Date(2026, 5, 10) }),
    ];
    const filtered = filterFinanceApRows(
      rows,
      { status: "all", dueDateFrom: new Date(2026, 5, 1), dueDateTo: new Date(2026, 5, 30) },
      REF
    );
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.externalId, 2);
  });

  it("payload não contém NaN ou Infinity nos cards", () => {
    const dash = buildFinanceAccountsPayableDashboard([], { status: "all" }, REF);
    for (const value of Object.values(dash.cards)) {
      if (typeof value === "number") {
        assert.ok(Number.isFinite(value));
      }
    }
    assert.equal(startOfLocalDay(REF).getHours(), 0);
  });

  it("monta scheduleBuckets para vencimentos futuros", () => {
    const rows = [
      row({ externalId: 1, balancePayable: 100, dueDate: new Date(2026, 5, 6) }),
      row({ externalId: 2, balancePayable: 200, dueDate: new Date(2026, 5, 10) }),
      row({ externalId: 3, balancePayable: 300, dueDate: new Date(2026, 7, 1) }),
    ];
    const dash = buildFinanceAccountsPayableDashboard(rows, { status: "all" }, REF);
    assert.equal(dash.scheduleBuckets.length, 6);
    const today = dash.scheduleBuckets.find((b) => b.key === "today");
    assert.equal(today?.amount, 100);
    assert.ok(dash.scheduleBuckets.every((b) => Number.isFinite(b.amount)));
  });

  it("supplierRanking inclui ação sugerida", () => {
    const rows = [
      row({
        externalId: 1,
        personCnpj: "11.111.111/0001-11",
        balancePayable: 100,
        dueDate: new Date(2026, 5, 1),
      }),
      row({
        externalId: 2,
        personCnpj: "11.111.111/0001-11",
        balancePayable: 50,
        dueDate: new Date(2026, 5, 20),
        suspendPayment: true,
      }),
    ];
    const dash = buildFinanceAccountsPayableDashboard(rows, { status: "all" }, REF);
    assert.equal(dash.supplierRanking.length, 1);
    assert.equal(dash.supplierRanking[0]?.suggestedAction, "Revisar bloqueio de pagamento");
  });

  it("paymentMethodSummary calcula ticket médio", () => {
    const rows = [
      row({ externalId: 1, balancePayable: 100, paymentMethodName: "PIX", dueDate: new Date(2026, 5, 1) }),
      row({ externalId: 2, balancePayable: 300, paymentMethodName: "PIX", dueDate: new Date(2026, 5, 20) }),
    ];
    const dash = buildFinanceAccountsPayableDashboard(rows, { status: "all" }, REF);
    assert.equal(dash.paymentMethodSummary[0]?.averageTicket, 200);
  });

  it("companySummary inclui recebido no mês e atrasoência", () => {
    const rows = [
      row({
        externalId: 1,
        companyName: "Empresa A",
        balancePayable: 100,
        dueDate: new Date(2026, 5, 1),
      }),
      row({
        externalId: 2,
        companyName: "Empresa A",
        balancePayable: 0,
        amountPaid: 500,
        settlementDate: new Date(2026, 5, 5),
        dueDate: new Date(2026, 5, 1),
      }),
    ];
    const dash = buildFinanceAccountsPayableDashboard(rows, { status: "all" }, REF);
    assert.equal(dash.companySummary.length, 1);
    assert.equal(dash.companySummary[0]?.paidThisMonthAmount, 500);
    assert.ok(Number.isFinite(dash.companySummary[0]?.overduePercent ?? NaN));
  });
});
