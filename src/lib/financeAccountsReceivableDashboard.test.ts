import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFinanceAccountsReceivableDashboard,
  buildFinanceArPrismaWhere,
  classifyFinanceArTitle,
  computeDaysOverdue,
  filterFinanceArRows,
  FinanceArFilterParseError,
  hasFinanceArSourceInvoice,
  parseFinanceArDashboardFilters,
  resolveFinanceArDueDateBounds,
  resolveFinanceArCustomerKey,
  startOfLocalDay,
  type FinanceArDashboardRow,
} from "./financeAccountsReceivableDashboard.js";

function row(partial: Partial<FinanceArDashboardRow> & Pick<FinanceArDashboardRow, "externalId">): FinanceArDashboardRow {
  return {
    companyName: "Empresa A",
    personName: "Cliente X",
    personCnpj: "12.345.678/0001-90",
    dueDate: null,
    settlementDate: null,
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    paymentMethodName: "Boleto",
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

const REF = new Date(2026, 5, 6, 12, 0, 0, 0); // 06/06/2026 local

describe("financeAccountsReceivableDashboard", () => {
  it("calcula cards principais: aberto, vencido, a vencer, vence hoje", () => {
    const rows = [
      row({ externalId: 1, balanceReceivable: 100, dueDate: new Date(2026, 5, 1) }), // overdue
      row({ externalId: 2, balanceReceivable: 200, dueDate: new Date(2026, 5, 6) }), // due today
      row({ externalId: 3, balanceReceivable: 300, dueDate: new Date(2026, 5, 20) }), // upcoming
      row({
        externalId: 4,
        balanceReceivable: 0,
        amountReceivable: 1000,
        amountReceived: 1000,
        dueDate: new Date(2026, 4, 1),
      }), // settled (não fantasma)
    ];

    const dash = buildFinanceAccountsReceivableDashboard(rows, { status: "all" }, REF);
    assert.equal(dash.cards.totalRecords, 4);
    assert.equal(dash.cards.openTitlesCount, 3);
    assert.equal(dash.cards.settledTitlesCount, 1);
    assert.equal(dash.cards.totalOpenAmount, 600);
    assert.equal(dash.cards.overdueAmount, 100);
    assert.equal(dash.cards.dueTodayAmount, 200);
    assert.equal(dash.cards.upcomingAmount, 300);
  });

  it("calcula próximos 7/30 dias e inadimplência", () => {
    const rows = [
      row({ externalId: 1, balanceReceivable: 100, dueDate: new Date(2026, 5, 10) }),
      row({ externalId: 2, balanceReceivable: 50, dueDate: new Date(2026, 5, 1) }),
      row({ externalId: 3, balanceReceivable: 25, dueDate: new Date(2026, 6, 1) }),
    ];
    const dash = buildFinanceAccountsReceivableDashboard(rows, { status: "all" }, REF);
    assert.equal(dash.cards.dueNext7DaysAmount, 100);
    assert.equal(dash.cards.dueNext30DaysAmount, 125);
    assert.equal(dash.cards.delinquencyRate, Number(((50 / 175) * 100).toFixed(2)));
  });

  it("inadimplência com denominador zero retorna 0", () => {
    const dash = buildFinanceAccountsReceivableDashboard(
      [row({ externalId: 1, balanceReceivable: 0 })],
      { status: "all" },
      REF
    );
    assert.equal(dash.cards.delinquencyRate, 0);
    assert.ok(Number.isFinite(dash.cards.delinquencyRate));
  });

  it("monta aging buckets e percentuais sem NaN", () => {
    const rows = [
      row({ externalId: 1, balanceReceivable: 100, dueDate: new Date(2026, 5, 20) }),
      row({ externalId: 2, balanceReceivable: 200, dueDate: new Date(2026, 5, 6) }),
      row({ externalId: 3, balanceReceivable: 300, dueDate: new Date(2026, 5, 1) }),
    ];
    const dash = buildFinanceAccountsReceivableDashboard(rows, { status: "all" }, REF);
    assert.equal(dash.agingBuckets.length, 8);
    const totalPercent = dash.agingBuckets.reduce((acc, b) => acc + b.percentOfOpenAmount, 0);
    assert.ok(Number.isFinite(totalPercent));
    assert.ok(dash.agingBuckets.every((b) => Number.isFinite(b.amount)));
  });

  it("topDebtors agrupa por CNPJ e calcula percentual da carteira", () => {
    const rows = [
      row({
        externalId: 1,
        personCnpj: "11.111.111/0001-11",
        personName: "A",
        balanceReceivable: 700,
        dueDate: new Date(2026, 5, 1),
      }),
      row({
        externalId: 2,
        personCnpj: "22.222.222/0001-22",
        personName: "B",
        balanceReceivable: 300,
        dueDate: new Date(2026, 5, 10),
      }),
    ];
    const dash = buildFinanceAccountsReceivableDashboard(rows, { status: "all" }, REF);
    assert.equal(dash.topDebtors.length, 2);
    assert.equal(dash.topDebtors[0]?.personCnpj, "11.111.111/0001-11");
    assert.equal(dash.topDebtors[0]?.percentOfPortfolio, 70);
  });

  it("usa personName quando CNPJ ausente", () => {
    assert.equal(
      resolveFinanceArCustomerKey({ personCnpj: null, personName: "Cliente Y", externalId: 9 }),
      "name:cliente y"
    );
  });

  it("filtros básicos por status e personName", () => {
    const rows = [
      row({ externalId: 1, personName: "Alpha Ltda", balanceReceivable: 100, dueDate: new Date(2026, 5, 1) }),
      row({ externalId: 2, personName: "Beta SA", balanceReceivable: 200, dueDate: new Date(2026, 5, 20) }),
    ];
    const overdueOnly = buildFinanceAccountsReceivableDashboard(
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
    assert.equal(classifyFinanceArTitle(row({ externalId: 1, dueDate: todayMorning }), REF), "dueToday");
    assert.equal(classifyFinanceArTitle(row({ externalId: 2, dueDate: yesterday }), REF), "overdue");
    assert.equal(computeDaysOverdue(yesterday, REF), 1);
  });

  it("dataQualityAlerts e saldos negativos", () => {
    const rows = [
      row({
        externalId: 1,
        balanceReceivable: 100,
        dueDate: null,
        personCnpj: null,
        paymentMethodName: null,
        sourceInvoiceId: null,
        sourceInvoiceNumber: null,
        amountReceivable: 50,
        amountReceived: 80,
        suspendCollection: true,
      }),
      row({
        externalId: 2,
        balanceReceivable: -10,
        dueDate: new Date(2026, 5, 1),
        amountReceivable: 50,
        amountReceived: 0,
      }),
    ];
    const dash = buildFinanceAccountsReceivableDashboard(rows, { status: "all" }, REF);
    assert.equal(dash.dataQualityAlerts.negativeBalance, 1);
    assert.equal(dash.dataQualityAlerts.missingDueDate, 1);
    assert.equal(dash.dataQualityAlerts.missingPersonCnpj, 1);
    assert.equal(dash.dataQualityAlerts.missingPaymentMethod, 1);
    assert.equal(dash.dataQualityAlerts.receivedGreaterThanReceivable, 1);
    assert.equal(dash.dataQualityAlerts.suspendedCollectionOpen, 1);
    assert.ok(dash.dataQualitySummary.length >= 5);
  });

  it("segmenta carteira em aberto com e sem NF emitida", () => {
    const rows = [
      row({
        externalId: 1,
        balanceReceivable: 100,
        dueDate: new Date(2026, 5, 1),
        sourceInvoiceId: 10,
        sourceInvoiceNumber: "NF-10",
      }),
      row({
        externalId: 2,
        balanceReceivable: 200,
        dueDate: new Date(2026, 5, 20),
        sourceInvoiceId: null,
        sourceInvoiceNumber: null,
      }),
      row({
        externalId: 3,
        balanceReceivable: 0,
        dueDate: new Date(2026, 5, 1),
        sourceInvoiceId: null,
        sourceInvoiceNumber: null,
      }),
    ];
    const dash = buildFinanceAccountsReceivableDashboard(rows, { status: "all" }, REF);
    assert.equal(dash.cards.openWithInvoiceCount, 1);
    assert.equal(dash.cards.openWithoutInvoiceCount, 1);
    assert.equal(dash.cards.openWithInvoiceAmount, 100);
    assert.equal(dash.cards.openWithoutInvoiceAmount, 200);
    assert.equal(dash.cards.preInvoiceShareOfOpenPercent, 66.67);
  });

  it("hasFinanceArSourceInvoice detecta id ou número", () => {
    assert.equal(hasFinanceArSourceInvoice({ sourceInvoiceId: 1, sourceInvoiceNumber: null }), true);
    assert.equal(
      hasFinanceArSourceInvoice({ sourceInvoiceId: null, sourceInvoiceNumber: "123" }),
      true
    );
    assert.equal(
      hasFinanceArSourceInvoice({ sourceInvoiceId: null, sourceInvoiceNumber: null }),
      false
    );
  });

  it("filterFinanceArRows filtra invoiceIssued yes/no", () => {
    const rows = [
      row({ externalId: 1, sourceInvoiceId: 1, sourceInvoiceNumber: "NF-1" }),
      row({ externalId: 2, sourceInvoiceId: null, sourceInvoiceNumber: null }),
    ];
    const withInvoice = filterFinanceArRows(rows, { status: "all", invoiceIssued: "yes" }, REF);
    const preInvoice = filterFinanceArRows(rows, { status: "all", invoiceIssued: "no" }, REF);
    assert.deepEqual(
      withInvoice.map((r) => r.externalId),
      [1]
    );
    assert.deepEqual(
      preInvoice.map((r) => r.externalId),
      [2]
    );
  });

  it("filterFinanceArRows remove duplicata sem NF quando existe Com NF", () => {
    const rows = [
      row({
        externalId: 1,
        sourceInvoiceId: null,
        balanceReceivable: 800,
        dueDate: new Date(2026, 2, 1),
      }),
      row({
        externalId: 2,
        sourceInvoiceId: 10,
        sourceInvoiceNumber: "NF-10",
        balanceReceivable: 800,
        dueDate: new Date(2026, 2, 1),
      }),
    ];
    const filtered = filterFinanceArRows(rows, { status: "all", year: 2026, month: 3 }, REF);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]!.externalId, 2);
  });

  it("parseFinanceArDashboardFilters interpreta invoiceIssued", () => {
    assert.equal(parseFinanceArDashboardFilters({ invoiceIssued: "yes" }).invoiceIssued, "yes");
    assert.equal(parseFinanceArDashboardFilters({ invoiceIssued: "nao" }).invoiceIssued, "no");
    assert.equal(parseFinanceArDashboardFilters({}).invoiceIssued, "all");
    assert.throws(
      () => parseFinanceArDashboardFilters({ invoiceIssued: "talvez" }),
      FinanceArFilterParseError
    );
  });

  it("parseFinanceArDashboardFilters interpreta query params", () => {
    const filters = parseFinanceArDashboardFilters({
      status: "overdue",
      dueDateFrom: "2026-06-01",
      dueDateTo: "2026-06-30",
      companyName: "Empresa",
    });
    assert.equal(filters.status, "overdue");
    assert.ok(filters.dueDateFrom instanceof Date);
    assert.ok(filters.dueDateTo instanceof Date);
  });

  it("parseFinanceArDashboardFilters aceita year e month válidos", () => {
    const filters = parseFinanceArDashboardFilters({ year: "2026", month: "6" });
    assert.equal(filters.year, 2026);
    assert.equal(filters.month, 6);
  });

  it("parseFinanceArDashboardFilters aceita year sem month", () => {
    const filters = parseFinanceArDashboardFilters({ year: "2026" });
    assert.equal(filters.year, 2026);
    assert.equal(filters.month, undefined);
  });

  it("parseFinanceArDashboardFilters rejeita month sem year", () => {
    assert.throws(
      () => parseFinanceArDashboardFilters({ month: "6" }),
      FinanceArFilterParseError
    );
  });

  it("parseFinanceArDashboardFilters rejeita year inválido", () => {
    assert.throws(
      () => parseFinanceArDashboardFilters({ year: "26" }),
      FinanceArFilterParseError
    );
    assert.throws(
      () => parseFinanceArDashboardFilters({ year: "abcd" }),
      FinanceArFilterParseError
    );
  });

  it("parseFinanceArDashboardFilters rejeita month inválido", () => {
    assert.throws(
      () => parseFinanceArDashboardFilters({ year: "2026", month: "13" }),
      FinanceArFilterParseError
    );
    assert.throws(
      () => parseFinanceArDashboardFilters({ year: "2026", month: "0" }),
      FinanceArFilterParseError
    );
  });

  it("filterFinanceArRows filtra somente ano 2026", () => {
    const rows = [
      row({ externalId: 1, dueDate: new Date(2025, 11, 31) }),
      row({ externalId: 2, dueDate: new Date(2026, 0, 1) }),
      row({ externalId: 3, dueDate: new Date(2026, 11, 31) }),
      row({ externalId: 4, dueDate: new Date(2027, 0, 1) }),
    ];
    const filtered = filterFinanceArRows(rows, { status: "all", year: 2026 }, REF);
    assert.deepEqual(
      filtered.map((r) => r.externalId),
      [2, 3]
    );
  });

  it("filterFinanceArRows filtra junho/2026 sem incluir maio ou julho", () => {
    const rows = [
      row({ externalId: 1, dueDate: new Date(2026, 4, 31) }),
      row({ externalId: 2, dueDate: new Date(2026, 5, 1) }),
      row({ externalId: 3, dueDate: new Date(2026, 5, 30) }),
      row({ externalId: 4, dueDate: new Date(2026, 6, 1) }),
    ];
    const filtered = filterFinanceArRows(
      rows,
      { status: "all", year: 2026, month: 6 },
      REF
    );
    assert.deepEqual(
      filtered.map((r) => r.externalId),
      [2, 3]
    );
  });

  it("resolveFinanceArDueDateBounds usa intervalo half-open para mês", () => {
    const bounds = resolveFinanceArDueDateBounds({ year: 2026, month: 6 });
    assert.equal(bounds.from?.getFullYear(), 2026);
    assert.equal(bounds.from?.getMonth(), 5);
    assert.equal(bounds.from?.getDate(), 1);
    assert.equal(bounds.toExclusive?.getFullYear(), 2026);
    assert.equal(bounds.toExclusive?.getMonth(), 6);
    assert.equal(bounds.toExclusive?.getDate(), 1);
    assert.equal(bounds.empty, false);
  });

  it("filterFinanceArRows usa interseção com dueDateFrom/dueDateTo", () => {
    const rows = [
      row({ externalId: 1, dueDate: new Date(2026, 5, 5) }),
      row({ externalId: 2, dueDate: new Date(2026, 5, 20) }),
      row({ externalId: 3, dueDate: new Date(2026, 5, 28) }),
    ];
    const filtered = filterFinanceArRows(
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

  it("resolveFinanceArDueDateBounds retorna empty quando interseção é inválida", () => {
    const bounds = resolveFinanceArDueDateBounds({
      year: 2026,
      month: 6,
      dueDateFrom: new Date(2026, 6, 1),
      dueDateTo: new Date(2026, 6, 30),
    });
    assert.equal(bounds.empty, true);
    assert.equal(
      filterFinanceArRows(
        [row({ externalId: 1, dueDate: new Date(2026, 5, 15) })],
        { status: "all", year: 2026, month: 6, dueDateFrom: new Date(2026, 6, 1) },
        REF
      ).length,
      0
    );
  });

  it("filterFinanceArRows respeita intervalo dueDateFrom/dueDateTo", () => {
    const rows = [
      row({ externalId: 1, dueDate: new Date(2026, 4, 31) }),
      row({ externalId: 2, dueDate: new Date(2026, 5, 10) }),
    ];
    const filtered = filterFinanceArRows(
      rows,
      { status: "all", dueDateFrom: new Date(2026, 5, 1), dueDateTo: new Date(2026, 5, 30) },
      REF
    );
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.externalId, 2);
  });

  it("payload não contém NaN ou Infinity nos cards", () => {
    const dash = buildFinanceAccountsReceivableDashboard([], { status: "all" }, REF);
    for (const value of Object.values(dash.cards)) {
      if (typeof value === "number") {
        assert.ok(Number.isFinite(value));
      }
    }
    assert.equal(startOfLocalDay(REF).getHours(), 0);
  });

  it("monta scheduleBuckets para vencimentos futuros", () => {
    const rows = [
      row({ externalId: 1, balanceReceivable: 100, dueDate: new Date(2026, 5, 6) }),
      row({ externalId: 2, balanceReceivable: 200, dueDate: new Date(2026, 5, 10) }),
      row({ externalId: 3, balanceReceivable: 300, dueDate: new Date(2026, 7, 1) }),
    ];
    const dash = buildFinanceAccountsReceivableDashboard(rows, { status: "all" }, REF);
    assert.equal(dash.scheduleBuckets.length, 6);
    const today = dash.scheduleBuckets.find((b) => b.key === "today");
    assert.equal(today?.amount, 100);
    assert.ok(dash.scheduleBuckets.every((b) => Number.isFinite(b.amount)));
  });

  it("customerRanking inclui ação sugerida", () => {
    const rows = [
      row({
        externalId: 1,
        personCnpj: "11.111.111/0001-11",
        balanceReceivable: 100,
        dueDate: new Date(2026, 5, 1),
      }),
      row({
        externalId: 2,
        personCnpj: "11.111.111/0001-11",
        balanceReceivable: 50,
        dueDate: new Date(2026, 5, 20),
        suspendCollection: true,
      }),
    ];
    const dash = buildFinanceAccountsReceivableDashboard(rows, { status: "all" }, REF);
    assert.equal(dash.customerRanking.length, 1);
    assert.equal(dash.customerRanking[0]?.suggestedAction, "Revisar motivo da cobrança suspensa");
  });

  it("paymentMethodSummary calcula ticket médio", () => {
    const rows = [
      row({ externalId: 1, balanceReceivable: 100, paymentMethodName: "PIX", dueDate: new Date(2026, 5, 1) }),
      row({ externalId: 2, balanceReceivable: 300, paymentMethodName: "PIX", dueDate: new Date(2026, 5, 20) }),
    ];
    const dash = buildFinanceAccountsReceivableDashboard(rows, { status: "all" }, REF);
    assert.equal(dash.paymentMethodSummary[0]?.averageTicket, 200);
  });

  it("companySummary inclui recebido no mês e inadimplência", () => {
    const rows = [
      row({
        externalId: 1,
        companyName: "Empresa A",
        balanceReceivable: 100,
        dueDate: new Date(2026, 5, 1),
      }),
      row({
        externalId: 2,
        companyName: "Empresa A",
        balanceReceivable: 0,
        amountReceived: 500,
        settlementDate: new Date(2026, 5, 5),
        dueDate: new Date(2026, 5, 1),
      }),
    ];
    const dash = buildFinanceAccountsReceivableDashboard(rows, { status: "all" }, REF);
    assert.equal(dash.companySummary.length, 1);
    assert.equal(dash.companySummary[0]?.receivedThisMonthAmount, 500);
    assert.ok(Number.isFinite(dash.companySummary[0]?.delinquencyRate ?? NaN));
  });

  // ── Novos KPIs executivos ──

  it("overdueOver30DaysAmount: conta apenas vencidos há mais de 30 dias", () => {
    // REF = 06/06/2026, overdue1 = 5 dias atraso, overdue2 = 40 dias, overdue3 = 70 dias
    const rows = [
      row({ externalId: 1, balanceReceivable: 100, dueDate: new Date(2026, 5, 1) }), // 5 dias overdue
      row({ externalId: 2, balanceReceivable: 200, dueDate: new Date(2026, 3, 27) }), // ~40 dias overdue
      row({ externalId: 3, balanceReceivable: 300, dueDate: new Date(2026, 2, 27) }), // ~71 dias overdue
      row({ externalId: 4, balanceReceivable: 50, dueDate: new Date(2026, 5, 20) }), // upcoming
    ];
    const dash = buildFinanceAccountsReceivableDashboard(rows, { status: "all" }, REF);
    assert.equal(dash.cards.overdueOver30DaysAmount, 500);
    assert.equal(dash.cards.overdueOver30DaysCount, 2);
    assert.ok(Number.isFinite(dash.cards.overdueOver30DaysAmount));
  });

  it("overdueOver30DaysAmount = 0 quando nenhum vencido há mais de 30 dias", () => {
    const rows = [
      row({ externalId: 1, balanceReceivable: 100, dueDate: new Date(2026, 5, 1) }), // 5 dias
      row({ externalId: 2, balanceReceivable: 200, dueDate: new Date(2026, 5, 20) }), // upcoming
    ];
    const dash = buildFinanceAccountsReceivableDashboard(rows, { status: "all" }, REF);
    assert.equal(dash.cards.overdueOver30DaysAmount, 0);
    assert.equal(dash.cards.overdueOver30DaysCount, 0);
  });

  it("avgDaysOverdue é null quando não há títulos vencidos", () => {
    const rows = [
      row({ externalId: 1, balanceReceivable: 100, dueDate: new Date(2026, 5, 20) }),
    ];
    const dash = buildFinanceAccountsReceivableDashboard(rows, { status: "all" }, REF);
    assert.equal(dash.cards.avgDaysOverdue, null);
  });

  it("avgDaysOverdue calcula média ponderada corretamente", () => {
    // REF = 06/06/2026
    // overdue1: dueDate 01/06 → 5 dias, balance 100
    // overdue2: dueDate 01/05 → 36 dias, balance 200
    // avg = (5*100 + 36*200) / (100+200) = (500 + 7200) / 300 = 7700/300 ≈ 25.67
    const rows = [
      row({ externalId: 1, balanceReceivable: 100, dueDate: new Date(2026, 5, 1) }),
      row({ externalId: 2, balanceReceivable: 200, dueDate: new Date(2026, 4, 1) }),
    ];
    const dash = buildFinanceAccountsReceivableDashboard(rows, { status: "all" }, REF);
    assert.ok(dash.cards.avgDaysOverdue !== null);
    assert.ok(Number.isFinite(dash.cards.avgDaysOverdue!));
    assert.ok(dash.cards.avgDaysOverdue! > 0);
  });

  it("novo payload não contém NaN/Infinity nos campos novos (empty dataset)", () => {
    const dash = buildFinanceAccountsReceivableDashboard([], { status: "all" }, REF);
    assert.equal(dash.cards.overdueOver30DaysAmount, 0);
    assert.equal(dash.cards.overdueOver30DaysCount, 0);
    assert.equal(dash.cards.avgDaysOverdue, null);
  });

  it("buildFinanceArPrismaWhere aplica intervalo de vencimento por ano/mês", () => {
    const where = buildFinanceArPrismaWhere({ status: "all", year: 2026, month: 6 }, REF);
    const and = (where as { AND?: Array<{ dueDate?: { gte?: Date; lt?: Date } }> }).AND;
    assert.ok(and?.length);
    const due = and?.find((clause) => clause.dueDate)?.dueDate;
    assert.equal(due?.gte?.getFullYear(), 2026);
    assert.equal(due?.gte?.getMonth(), 5);
    assert.equal(due?.lt?.getMonth(), 6);
  });

  it("buildFinanceArPrismaWhere retorna conjunto vazio para intervalo inválido", () => {
    const where = buildFinanceArPrismaWhere(
      {
        status: "all",
        dueDateFrom: new Date(2026, 5, 10),
        dueDateTo: new Date(2026, 5, 1),
      },
      REF
    );
    assert.deepEqual(where, { externalId: -1 });
  });

  it("buildFinanceArPrismaWhere pré-filtra status overdue", () => {
    const where = buildFinanceArPrismaWhere({ status: "overdue" }, REF);
    const and = (where as { AND?: unknown[] }).AND;
    assert.ok(Array.isArray(and) && and.length >= 2);
  });
});
