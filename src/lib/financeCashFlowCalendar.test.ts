import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFinanceCashFlowCalendar,
  filterCalendarMovements,
  getCalendarDayByDate,
  sumCalendarMovementAmounts,
} from "./financeCashFlowCalendar.js";
import {
  sortCalendarMovements,
  DEFAULT_CALENDAR_MOVEMENT_SORT,
  toggleCalendarMovementSort,
} from "./financeCashFlowCalendarTableSort.js";
import {
  buildFinanceCashFlowDashboard,
  type FinanceCashFlowApRow,
  type FinanceCashFlowArRow,
} from "./financeCashFlowDashboard.js";
import { buildNomusApReportSyncCutoff } from "./financeNomusApReportFreshness.js";
import { buildNomusArReportSyncCutoff } from "./financeNomusArReportFreshness.js";

const LATEST_SYNC = new Date("2026-06-17T10:00:00.000Z");
const STALE_SYNC = new Date("2026-06-12T10:00:00.000Z");
const REF = new Date(2026, 5, 17);

const defaultFilters = {
  viewMode: "projected" as const,
  dateBase: "due" as const,
  status: "all" as const,
  year: 2026,
  month: 6,
};

function arRow(overrides: Partial<FinanceCashFlowArRow> = {}): FinanceCashFlowArRow {
  return {
    externalId: 1,
    companyName: "Empresa A",
    personName: "Cliente X",
    personCnpj: "11111111000111",
    description: "Recebível",
    dueDate: new Date(2026, 5, 15),
    settlementDate: null,
    competenceDate: new Date(2026, 5, 1),
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    paymentMethodName: "Boleto",
    bankAccountName: "Conta 1",
    sourceInvoiceId: 100,
    sourceInvoiceNumber: "NF-100",
    suspendCollection: false,
    nomusStatus: true,
    syncedAt: LATEST_SYNC,
    ...overrides,
  };
}

function apRow(overrides: Partial<FinanceCashFlowApRow> = {}): FinanceCashFlowApRow {
  return {
    externalId: 2,
    companyName: "Empresa A",
    personName: "Fornecedor Y",
    personCnpj: "22222222000122",
    description: "Pagável",
    dueDate: new Date(2026, 5, 15),
    scheduleDate: null,
    type: null,
    settlementDate: null,
    paymentDate: null,
    competenceDate: new Date(2026, 5, 2),
    amountPayable: 500,
    amountPaid: 0,
    balancePayable: 500,
    paymentMethodName: "PIX",
    bankAccountName: "Conta 2",
    sourceInvoiceId: null,
    documentNumber: "DOC-1",
    suspendPayment: false,
    nomusStatus: true,
    syncedAt: LATEST_SYNC,
    ...overrides,
  };
}

function arCutoff() {
  return buildNomusArReportSyncCutoff(LATEST_SYNC)!;
}

function apCutoff() {
  return buildNomusApReportSyncCutoff(LATEST_SYNC)!;
}

describe("financeCashFlowCalendar", () => {
  it("calendário soma CR do dia corretamente", () => {
    const calendar = buildFinanceCashFlowCalendar(
      [
        arRow({ externalId: 1, balanceReceivable: 400, dueDate: new Date(2026, 5, 10) }),
        arRow({ externalId: 2, balanceReceivable: 600, dueDate: new Date(2026, 5, 10) }),
      ],
      [],
      defaultFilters,
      REF
    );
    const day = getCalendarDayByDate(calendar, "2026-06-10")!;
    assert.equal(day.inflow, 1000);
    assert.equal(day.receivableCount, 2);
  });

  it("calendário soma CP do dia corretamente", () => {
    const calendar = buildFinanceCashFlowCalendar(
      [],
      [
        apRow({ externalId: 3, balancePayable: 300, dueDate: new Date(2026, 5, 12) }),
        apRow({ externalId: 4, balancePayable: 200, dueDate: new Date(2026, 5, 12) }),
      ],
      defaultFilters,
      REF
    );
    const day = getCalendarDayByDate(calendar, "2026-06-12")!;
    assert.equal(day.outflow, 500);
    assert.equal(day.payableCount, 2);
  });

  it("saldo do dia = CR − CP", () => {
    const calendar = buildFinanceCashFlowCalendar(
      [arRow({ balanceReceivable: 1500, dueDate: new Date(2026, 5, 20) })],
      [apRow({ balancePayable: 900, dueDate: new Date(2026, 5, 20) })],
      defaultFilters,
      REF
    );
    const day = getCalendarDayByDate(calendar, "2026-06-20")!;
    assert.equal(day.net, day.inflow - day.outflow);
    assert.equal(day.net, 600);
  });

  it("resumo semanal soma os dias da semana", () => {
    const calendar = buildFinanceCashFlowCalendar(
      [arRow({ balanceReceivable: 100, dueDate: new Date(2026, 5, 1) })],
      [apRow({ balancePayable: 40, dueDate: new Date(2026, 5, 3) })],
      defaultFilters,
      REF
    );
    assert.ok(calendar.weeks.length >= 1);
    const weekTotalInflow = calendar.weeks.reduce((s, w) => s + w.inflow, 0);
    const weekTotalOutflow = calendar.weeks.reduce((s, w) => s + w.outflow, 0);
    const monthInflow = calendar.days.reduce((s, d) => s + d.inflow, 0);
    const monthOutflow = calendar.days.reduce((s, d) => s + d.outflow, 0);
    assert.equal(weekTotalInflow, monthInflow);
    assert.equal(weekTotalOutflow, monthOutflow);
  });

  it("dia sem movimento retorna zero e lista vazia", () => {
    const calendar = buildFinanceCashFlowCalendar(
      [arRow({ dueDate: new Date(2026, 5, 5) })],
      [],
      defaultFilters,
      REF
    );
    const emptyDay = getCalendarDayByDate(calendar, "2026-06-01")!;
    assert.equal(emptyDay.inflow, 0);
    assert.equal(emptyDay.outflow, 0);
    assert.equal(emptyDay.net, 0);
    assert.equal(emptyDay.movements.length, 0);
  });

  it("CR recebido não entra como previsto", () => {
    const calendar = buildFinanceCashFlowCalendar(
      [
        arRow({
          balanceReceivable: 0,
          amountReceived: 800,
          settlementDate: new Date(2026, 5, 8),
          dueDate: new Date(2026, 5, 8),
        }),
      ],
      [],
      defaultFilters,
      REF
    );
    const day = getCalendarDayByDate(calendar, "2026-06-08");
    assert.equal(day?.inflow ?? 0, 0);
  });

  it("CP pago não entra como previsto", () => {
    const calendar = buildFinanceCashFlowCalendar(
      [],
      [
        apRow({
          balancePayable: 0,
          amountPaid: 500,
          paymentDate: new Date(2026, 5, 9),
          dueDate: new Date(2026, 5, 9),
        }),
      ],
      defaultFilters,
      REF
    );
    const day = getCalendarDayByDate(calendar, "2026-06-09");
    assert.equal(day?.outflow ?? 0, 0);
  });

  it("AP com scheduleDate futuro entra no dia do scheduleDate, não no dueDate", () => {
    const calendar = buildFinanceCashFlowCalendar(
      [],
      [
        apRow({
          balancePayable: 750,
          dueDate: new Date(2026, 5, 10),
          scheduleDate: new Date(2026, 5, 25),
        }),
      ],
      defaultFilters,
      REF
    );
    assert.equal(getCalendarDayByDate(calendar, "2026-06-10")?.outflow ?? 0, 0);
    assert.equal(getCalendarDayByDate(calendar, "2026-06-25")?.outflow, 750);
  });

  it("AP type=2/pedido de compra não entra se a visão gerencial exclui", () => {
    const payload = buildFinanceCashFlowDashboard(
      [],
      [
        apRow({
          externalId: 99,
          type: 2,
          description: "PEDIDO DE COMPRA PC 123",
          balancePayable: 1200,
          dueDate: new Date(2026, 5, 14),
        }),
      ],
      defaultFilters,
      REF
    );
    const day = getCalendarDayByDate(payload.calendar, "2026-06-14");
    assert.equal(day?.outflow ?? 0, 0);
  });

  it("AR stale não entra", () => {
    const payload = buildFinanceCashFlowDashboard(
      [arRow({ balanceReceivable: 5000, dueDate: new Date(2026, 5, 11), syncedAt: STALE_SYNC })],
      [],
      defaultFilters,
      REF,
      arCutoff(),
      null
    );
    assert.equal(getCalendarDayByDate(payload.calendar, "2026-06-11")?.inflow ?? 0, 0);
  });

  it("AP stale não entra", () => {
    const payload = buildFinanceCashFlowDashboard(
      [],
      [apRow({ balancePayable: 5000, dueDate: new Date(2026, 5, 11), syncedAt: STALE_SYNC })],
      defaultFilters,
      REF,
      null,
      apCutoff()
    );
    assert.equal(getCalendarDayByDate(payload.calendar, "2026-06-11")?.outflow ?? 0, 0);
  });

  it("intercompany AP não entra", () => {
    const payload = buildFinanceCashFlowDashboard(
      [],
      [
        apRow({
          companyName: "KOPPETEL",
          personName: "LAZARIOS INDUSTRIA",
          balancePayable: 3000,
          dueDate: new Date(2026, 5, 16),
        }),
      ],
      defaultFilters,
      REF
    );
    assert.equal(getCalendarDayByDate(payload.calendar, "2026-06-16")?.outflow ?? 0, 0);
  });

  it("filtros de ano/mês/empresa/status são respeitados", () => {
    const payload = buildFinanceCashFlowDashboard(
      [
        arRow({ companyName: "A", balanceReceivable: 1000, dueDate: new Date(2026, 5, 15) }),
        arRow({
          externalId: 12,
          companyName: "B",
          balanceReceivable: 9000,
          dueDate: new Date(2026, 5, 15),
        }),
      ],
      [],
      { ...defaultFilters, companyName: "A" },
      REF
    );
    const day = getCalendarDayByDate(payload.calendar, "2026-06-15")!;
    assert.equal(day.inflow, 1000);
  });

  it("ao selecionar um dia, os movimentos daquele dia são exibidos", () => {
    const calendar = buildFinanceCashFlowCalendar(
      [arRow({ externalId: 7, dueDate: new Date(2026, 5, 18) })],
      [apRow({ externalId: 8, dueDate: new Date(2026, 5, 18) })],
      defaultFilters,
      REF
    );
    const day = getCalendarDayByDate(calendar, "2026-06-18")!;
    assert.equal(day.movements.length, 2);
    assert.ok(day.movements.some((m) => m.type === "AR"));
    assert.ok(day.movements.some((m) => m.type === "AP"));
  });

  it("grid mostra CR e CP juntos", () => {
    const calendar = buildFinanceCashFlowCalendar(
      [arRow({ dueDate: new Date(2026, 5, 6) })],
      [apRow({ dueDate: new Date(2026, 5, 6) })],
      defaultFilters,
      REF
    );
    const day = getCalendarDayByDate(calendar, "2026-06-06")!;
    assert.equal(filterCalendarMovements(day.movements, "all", "").length, 2);
  });

  it('aba/filtro "Todos/CR/CP" funciona', () => {
    const calendar = buildFinanceCashFlowCalendar(
      [arRow({ dueDate: new Date(2026, 5, 6) })],
      [apRow({ dueDate: new Date(2026, 5, 6) })],
      defaultFilters,
      REF
    );
    const day = getCalendarDayByDate(calendar, "2026-06-06")!;
    assert.equal(filterCalendarMovements(day.movements, "AR", "").length, 1);
    assert.equal(filterCalendarMovements(day.movements, "AP", "").length, 1);
  });

  it("busca local filtra grid", () => {
    const calendar = buildFinanceCashFlowCalendar(
      [arRow({ personName: "Mexichem", dueDate: new Date(2026, 5, 7) })],
      [apRow({ personName: "Fornecedor Z", dueDate: new Date(2026, 5, 7) })],
      defaultFilters,
      REF
    );
    const day = getCalendarDayByDate(calendar, "2026-06-07")!;
    assert.equal(filterCalendarMovements(day.movements, "all", "mexichem").length, 1);
  });

  it("ordenação por coluna funciona", () => {
    const calendar = buildFinanceCashFlowCalendar(
      [
        arRow({ externalId: 1, balanceReceivable: 100, dueDate: new Date(2026, 5, 8) }),
        arRow({ externalId: 2, balanceReceivable: 900, dueDate: new Date(2026, 5, 8) }),
      ],
      [],
      defaultFilters,
      REF
    );
    const day = getCalendarDayByDate(calendar, "2026-06-08")!;
    const sorted = sortCalendarMovements(day.movements, DEFAULT_CALENDAR_MOVEMENT_SORT);
    assert.equal(sorted[0]!.calendarAmount, 900);
    const toggled = toggleCalendarMovementSort(DEFAULT_CALENDAR_MOVEMENT_SORT, "personName");
    assert.equal(toggled.key, "personName");
  });

  it("total do grid bate com o total do card do dia", () => {
    const calendar = buildFinanceCashFlowCalendar(
      [arRow({ balanceReceivable: 1200, dueDate: new Date(2026, 5, 9) })],
      [apRow({ balancePayable: 450, dueDate: new Date(2026, 5, 9) })],
      defaultFilters,
      REF
    );
    const day = getCalendarDayByDate(calendar, "2026-06-09")!;
    const totals = sumCalendarMovementAmounts(day.movements);
    assert.equal(totals.inflow, day.inflow);
    assert.equal(totals.outflow, day.outflow);
    assert.equal(totals.net, day.net);
  });

  it("soma dos dias do mês bate com total mensal da linha do tempo", () => {
    const payload = buildFinanceCashFlowDashboard(
      [
        arRow({ balanceReceivable: 2000, dueDate: new Date(2026, 5, 4) }),
        arRow({ externalId: 3, balanceReceivable: 500, dueDate: new Date(2026, 5, 22) }),
      ],
      [apRow({ balancePayable: 700, dueDate: new Date(2026, 5, 12) })],
      defaultFilters,
      REF
    );
    const monthInflow = payload.calendar.days.reduce((s, d) => s + d.inflow, 0);
    const monthOutflow = payload.calendar.days.reduce((s, d) => s + d.outflow, 0);
    const jun = payload.monthlySeries.find((p) => p.month === 6)!;
    assert.equal(monthInflow, jun.inflowAmount);
    assert.equal(monthOutflow, jun.outflowAmount);
    assert.equal(payload.calendar.reconciliation.status, "ok");
  });

  it("soma dos CP do calendário bate com base AP saneada do mês", () => {
    const payload = buildFinanceCashFlowDashboard(
      [],
      [
        apRow({ balancePayable: 400, dueDate: new Date(2026, 5, 2) }),
        apRow({ externalId: 5, balancePayable: 250, dueDate: new Date(2026, 5, 19) }),
      ],
      defaultFilters,
      REF
    );
    const calendarOutflow = payload.calendar.days.reduce((s, d) => s + d.outflow, 0);
    assert.equal(calendarOutflow, payload.cards.outflowAmount);
  });

  it("soma dos CR do calendário bate com base AR saneada do mês", () => {
    const payload = buildFinanceCashFlowDashboard(
      [
        arRow({ balanceReceivable: 800, dueDate: new Date(2026, 5, 3) }),
        arRow({ externalId: 6, balanceReceivable: 120, dueDate: new Date(2026, 5, 21) })],
      [],
      defaultFilters,
      REF
    );
    const calendarInflow = payload.calendar.days.reduce((s, d) => s + d.inflow, 0);
    assert.equal(calendarInflow, payload.cards.inflowAmount);
  });

  it("resumo semanal bate com soma diária", () => {
    const calendar = buildFinanceCashFlowCalendar(
      [arRow({ balanceReceivable: 300, dueDate: new Date(2026, 5, 2) })],
      [apRow({ balancePayable: 100, dueDate: new Date(2026, 5, 4) })],
      defaultFilters,
      REF
    );
    for (const week of calendar.weeks) {
      let inflow = 0;
      let outflow = 0;
      for (const day of calendar.days) {
        if (day.date >= week.startDate && day.date <= week.endDate) {
          inflow += day.inflow;
          outflow += day.outflow;
        }
      }
      assert.equal(week.inflow, inflow);
      assert.equal(week.outflow, outflow);
      assert.equal(week.net, inflow - outflow);
    }
  });

  it("valores não retornam NaN/Infinity", () => {
    const payload = buildFinanceCashFlowDashboard([arRow()], [apRow()], defaultFilters, REF);
    for (const day of payload.calendar.days) {
      for (const v of [day.inflow, day.outflow, day.net]) {
        assert.ok(Number.isFinite(v));
      }
      for (const m of day.movements) {
        for (const v of [m.amountOriginal, m.amountRealized, m.balanceOpen, m.calendarAmount]) {
          assert.ok(Number.isFinite(v));
        }
        assert.ok(m.externalId != null);
        assert.ok(m.source.startsWith("Nomus"));
      }
    }
  });

  it("totais diários derivam dos movimentos, não o contrário", () => {
    const calendar = buildFinanceCashFlowCalendar(
      [arRow({ balanceReceivable: 333.33, dueDate: new Date(2026, 5, 13) })],
      [apRow({ balancePayable: 111.11, dueDate: new Date(2026, 5, 13) })],
      defaultFilters,
      REF
    );
    const day = getCalendarDayByDate(calendar, "2026-06-13")!;
    const derived = sumCalendarMovementAmounts(day.movements);
    assert.equal(day.inflow, derived.inflow);
    assert.equal(day.outflow, derived.outflow);
    assert.equal(day.net, derived.net);
  });
});
