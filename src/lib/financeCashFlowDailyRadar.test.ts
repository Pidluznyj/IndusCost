import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildFinanceCashFlowDashboard,
  type FinanceCashFlowApRow,
  type FinanceCashFlowArRow,
} from "./financeCashFlowDashboard.js";
import {
  buildFinanceCashFlowDailyRadar,
  buildCashFlowDailyRadarData,
  createDailyRadarDashboardFilters,
  dailyRadarDayCardLabel,
  DAILY_RADAR_CUSTOM_RANGE_KEY,
  DAILY_RADAR_RANGES,
  validateDailyRadarCustomPeriod,
} from "./financeCashFlowDailyRadar.js";

const BASE = new Date(2026, 5, 9);

function arRow(overrides: Partial<FinanceCashFlowArRow> = {}): FinanceCashFlowArRow {
  return {
    externalId: 1,
    companyName: "Empresa A",
    personName: "Cliente X",
    personCnpj: "11111111000111",
    description: "Recebível teste",
    dueDate: new Date(2026, 5, 9),
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
    syncedAt: new Date(2026, 5, 8),
    ...overrides,
  };
}

function apRow(overrides: Partial<FinanceCashFlowApRow> = {}): FinanceCashFlowApRow {
  return {
    externalId: 2,
    companyName: "Empresa A",
    personName: "Fornecedor Y",
    personCnpj: "22222222000122",
    description: "Pagável teste",
    dueDate: new Date(2026, 5, 9),
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
    syncedAt: new Date(2026, 5, 8),
    ...overrides,
  };
}

describe("financeCashFlowDailyRadar", () => {
  it("retorna ranges sem depender de filtros globais de ano/mês", () => {
    const arRows = [
      arRow({ externalId: 1, balanceReceivable: 100, dueDate: new Date(2026, 5, 9) }),
      arRow({ externalId: 2, balanceReceivable: 200, dueDate: new Date(2027, 0, 5) }),
    ];
    const apRows = [apRow({ balancePayable: 50, dueDate: new Date(2026, 5, 10) })];

    const radar = buildFinanceCashFlowDailyRadar(arRows, apRows, { baseDate: BASE }, BASE);
    assert.equal(radar.ranges.length, DAILY_RADAR_RANGES.length);
    assert.ok(radar.ranges.every((r) => Number.isFinite(r.netTotal)));

    const dashboard2026 = buildFinanceCashFlowDashboard(
      arRows,
      apRows,
      { viewMode: "projected", dateBase: "due", status: "open", year: 2026 },
      BASE
    );
    const dashboard2027 = buildFinanceCashFlowDashboard(
      arRows,
      apRows,
      { viewMode: "projected", dateBase: "due", status: "open", year: 2027 },
      BASE
    );
    assert.notEqual(dashboard2026.cards.inflowAmount, dashboard2027.cards.inflowAmount);

    const radarAgain = buildFinanceCashFlowDailyRadar(arRows, apRows, { baseDate: BASE }, BASE);
    assert.deepEqual(radar.ranges, radarAgain.ranges);
  });

  it("faixa 0-7 retorna exatamente D0..D7", () => {
    const arRows = [arRow({ balanceReceivable: 100, dueDate: new Date(2026, 5, 12) })];
    const payload = buildFinanceCashFlowDailyRadar(
      arRows,
      [],
      { baseDate: BASE, rangeKey: "0-7" },
      BASE
    );
    assert.ok(payload.selectedRange);
    assert.equal(payload.selectedRange!.key, "0-7");
    assert.equal(payload.selectedRange!.days.length, 8);
    assert.deepEqual(
      payload.selectedRange!.days.map((d) => d.dayOffset),
      [0, 1, 2, 3, 4, 5, 6, 7]
    );
    assert.equal(dailyRadarDayCardLabel(0), "Hoje");
    assert.equal(dailyRadarDayCardLabel(1), "Amanhã");
    assert.equal(dailyRadarDayCardLabel(3), "D+3");
  });

  it("soma da faixa bate com soma dos subcards diários", () => {
    const arRows = [
      arRow({ externalId: 1, balanceReceivable: 100, dueDate: new Date(2026, 5, 9) }),
      arRow({ externalId: 2, balanceReceivable: 200, dueDate: new Date(2026, 5, 11) }),
      arRow({ externalId: 3, balanceReceivable: 300, dueDate: new Date(2026, 5, 15) }),
    ];
    const apRows = [
      apRow({ externalId: 10, balancePayable: 40, dueDate: new Date(2026, 5, 10) }),
      apRow({ externalId: 11, balancePayable: 60, dueDate: new Date(2026, 5, 14) }),
    ];
    const payload = buildFinanceCashFlowDailyRadar(
      arRows,
      apRows,
      { baseDate: BASE, rangeKey: "0-7" },
      BASE
    );
    const range = payload.ranges.find((r) => r.key === "0-7");
    assert.ok(range);
    const days = payload.selectedRange!.days;
    const sumReceivable = days.reduce((s, d) => s + d.receivableTotal, 0);
    const sumPayable = days.reduce((s, d) => s + d.payableTotal, 0);
    assert.equal(range!.receivableTotal, sumReceivable);
    assert.equal(range!.payableTotal, sumPayable);
    assert.equal(range!.netTotal, sumReceivable - sumPayable);
  });

  it("detalhe do dia bate com grids AP/AR e saldo líquido", () => {
    const arRows = [
      arRow({ externalId: 1, balanceReceivable: 1000, dueDate: new Date(2026, 5, 9) }),
      arRow({ externalId: 2, balanceReceivable: 250, dueDate: new Date(2026, 5, 9) }),
    ];
    const apRows = [apRow({ balancePayable: 400, dueDate: new Date(2026, 5, 9) })];
    const payload = buildFinanceCashFlowDailyRadar(
      arRows,
      apRows,
      { baseDate: BASE, rangeKey: "0-7", day: "2026-06-09" },
      BASE
    );
    assert.ok(payload.selectedDay);
    const day = payload.selectedDay!;
    assert.equal(day.receivables.total, 1250);
    assert.equal(day.payables.total, 400);
    assert.equal(day.receivables.count, 2);
    assert.equal(day.payables.count, 1);
    const daySummary = payload.selectedRange?.days.find((d) => d.date === "2026-06-09");
    assert.ok(daySummary);
    assert.equal(daySummary!.receivableTotal, day.receivables.total);
    assert.equal(daySummary!.payableTotal, day.payables.total);
    assert.equal(daySummary!.netTotal, day.receivables.total - day.payables.total);
  });

  it("faixa selecionada já retorna selectedDetail com grids AP/AR da faixa inteira", () => {
    const arRows = [
      arRow({ externalId: 1, balanceReceivable: 100, dueDate: new Date(2026, 5, 9) }),
      arRow({ externalId: 2, balanceReceivable: 200, dueDate: new Date(2026, 5, 11) }),
    ];
    const apRows = [
      apRow({ externalId: 10, balancePayable: 40, dueDate: new Date(2026, 5, 10) }),
      apRow({ externalId: 11, balancePayable: 60, dueDate: new Date(2026, 5, 14) }),
    ];
    const payload = buildFinanceCashFlowDailyRadar(
      arRows,
      apRows,
      { baseDate: BASE, rangeKey: "0-7" },
      BASE
    );
    assert.ok(payload.selectedDetail);
    const detail = payload.selectedDetail!;
    assert.equal(detail.level, "range");
    assert.equal(detail.rangeKey, "0-7");
    assert.equal(detail.date, null);
    // Grids mostram TODOS os títulos da faixa, não apenas de um dia.
    assert.equal(detail.receivables.summary.count, 2);
    assert.equal(detail.payables.summary.count, 2);
    assert.equal(detail.receivables.summary.total, 300);
    assert.equal(detail.payables.summary.total, 100);
    assert.equal(detail.entriesTotal, 300);
    assert.equal(detail.exitsTotal, 100);
    assert.equal(detail.netTotal, 200);
  });

  it("selecionar um dia refina selectedDetail para apenas os títulos do dia", () => {
    const arRows = [
      arRow({ externalId: 1, balanceReceivable: 100, dueDate: new Date(2026, 5, 9) }),
      arRow({ externalId: 2, balanceReceivable: 200, dueDate: new Date(2026, 5, 11) }),
    ];
    const apRows = [apRow({ externalId: 10, balancePayable: 40, dueDate: new Date(2026, 5, 11) })];
    const payload = buildFinanceCashFlowDailyRadar(
      arRows,
      apRows,
      { baseDate: BASE, rangeKey: "0-7", day: "2026-06-11" },
      BASE
    );
    assert.ok(payload.selectedDetail);
    const detail = payload.selectedDetail!;
    assert.equal(detail.level, "day");
    assert.equal(detail.date, "2026-06-11");
    assert.equal(detail.receivables.summary.count, 1);
    assert.equal(detail.receivables.summary.total, 200);
    assert.equal(detail.payables.summary.count, 1);
    assert.equal(detail.payables.summary.total, 40);
    assert.equal(detail.netTotal, 160);
  });

  it("busca interna filtra grids AP e AR do selectedDetail", () => {
    const arRows = [
      arRow({ externalId: 1, personName: "Maria Eliana", balanceReceivable: 100, dueDate: new Date(2026, 5, 9) }),
      arRow({ externalId: 2, personName: "Gislene Lima", balanceReceivable: 200, dueDate: new Date(2026, 5, 11) }),
    ];
    const apRows = [
      apRow({ externalId: 10, personName: "Maria Eliana", balancePayable: 40, dueDate: new Date(2026, 5, 10) }),
      apRow({ externalId: 11, personName: "Outro Fornecedor", balancePayable: 60, dueDate: new Date(2026, 5, 14) }),
    ];
    const payload = buildFinanceCashFlowDailyRadar(
      arRows,
      apRows,
      { baseDate: BASE, rangeKey: "0-7", search: "maria" },
      BASE
    );
    const detail = payload.selectedDetail!;
    assert.equal(detail.receivables.summary.count, 1);
    assert.equal(detail.receivables.rows[0]?.customer, "Maria Eliana");
    assert.equal(detail.payables.summary.count, 1);
    assert.equal(detail.payables.rows[0]?.supplier, "Maria Eliana");
    assert.equal(detail.entriesTotal, 100);
    assert.equal(detail.exitsTotal, 40);
  });

  it("totalizadores da faixa incluem vencido e maior título", () => {
    const apRows = [
      apRow({ externalId: 10, balancePayable: 900, dueDate: new Date(2026, 5, 1) }),
      apRow({ externalId: 11, balancePayable: 100, dueDate: new Date(2026, 5, 3) }),
    ];
    const payload = buildFinanceCashFlowDailyRadar(
      [],
      apRows,
      { baseDate: BASE, rangeKey: "overdue" },
      BASE
    );
    const detail = payload.selectedDetail!;
    assert.equal(detail.payables.summary.count, 2);
    assert.equal(detail.payables.summary.total, 1000);
    assert.equal(detail.payables.summary.overdueTotal, 1000);
    assert.equal(detail.payables.summary.upcomingTotal, 0);
    assert.equal(detail.payables.summary.maxAmount, 900);
    assert.equal(detail.payables.summary.averageAmount, 500);
  });

  it("selectedDay permanece compatível com summary adicional", () => {
    const arRows = [arRow({ externalId: 1, balanceReceivable: 100, dueDate: new Date(2026, 5, 9) })];
    const payload = buildFinanceCashFlowDailyRadar(
      arRows,
      [],
      { baseDate: BASE, day: "2026-06-09" },
      BASE
    );
    assert.ok(payload.selectedDay);
    assert.equal(payload.selectedDay!.receivables.total, 100);
    assert.equal(payload.selectedDay!.receivables.summary.total, 100);
    assert.equal(payload.selectedDay!.receivables.summary.count, 1);
  });

  it("vencidos ficam na faixa overdue, não em D0", () => {
    const apRows = [apRow({ balancePayable: 900, dueDate: new Date(2026, 5, 1) })];
    const payload = buildFinanceCashFlowDailyRadar(
      [],
      apRows,
      { baseDate: BASE, rangeKey: "0-7" },
      BASE
    );
    const overdue = payload.ranges.find((r) => r.key === "overdue");
    assert.ok(overdue);
    assert.equal(overdue!.payableTotal, 900);
    const d0 = payload.selectedRange!.days.find((d) => d.dayOffset === 0);
    assert.ok(d0);
    assert.equal(d0!.payableTotal, 0);
  });

  it("empty states: dia sem AP ou AR", () => {
    const payloadArOnly = buildFinanceCashFlowDailyRadar(
      [arRow({ balanceReceivable: 100, dueDate: new Date(2026, 5, 9) })],
      [],
      { baseDate: BASE, day: "2026-06-09" },
      BASE
    );
    assert.equal(payloadArOnly.selectedDay!.payables.count, 0);
    assert.equal(payloadArOnly.selectedDay!.payables.rows.length, 0);

    const payloadApOnly = buildFinanceCashFlowDailyRadar(
      [],
      [apRow({ balancePayable: 100, dueDate: new Date(2026, 5, 9) })],
      { baseDate: BASE, day: "2026-06-09" },
      BASE
    );
    assert.equal(payloadApOnly.selectedDay!.receivables.count, 0);
  });

  it("createDailyRadarDashboardFilters não inclui ano/mês/empresa", () => {
    const filters = createDailyRadarDashboardFilters();
    assert.equal(filters.viewMode, "projected");
    assert.equal(filters.status, "open");
    assert.equal(filters.year, undefined);
    assert.equal(filters.month, undefined);
    assert.equal(filters.companyName, undefined);
  });

  it("FinanceCashFlowPage usa Radar Diário e não Detalhamento operacional na visão geral", () => {
    const page = readFileSync(
      join(process.cwd(), "src", "components", "finance", "FinanceCashFlowPage.tsx"),
      "utf8"
    );
    const radar = readFileSync(
      join(
        process.cwd(),
        "src",
        "components",
        "finance",
        "cash-flow",
        "FinanceCashFlowDailyRadar.tsx"
      ),
      "utf8"
    );
    assert.ok(page.includes("FinanceCashFlowDailyRadar"));
    assert.ok(page.includes("cash-flow-daily-radar") || radar.includes("cash-flow-daily-radar"));
    assert.ok(!page.includes("FinanceCashFlowDetailTable"));
    assert.ok(radar.includes("/api/finance/cash-flow/daily-radar"));
  });

  it("Radar renderiza grids a partir de selectedDetail (faixa e dia), empilhados e com totalizadores", () => {
    const radar = readFileSync(
      join(
        process.cwd(),
        "src",
        "components",
        "finance",
        "cash-flow",
        "FinanceCashFlowDailyRadar.tsx"
      ),
      "utf8"
    );
    // Drill-down progressivo usa selectedDetail nos dois níveis.
    assert.ok(radar.includes("payload?.selectedDetail"));
    assert.ok(radar.includes("Detalhe da faixa —"));
    assert.ok(radar.includes("Detalhe do dia —"));
    // Grids um abaixo do outro (stack vertical, sem grid de duas colunas).
    assert.ok(radar.includes('<div className="space-y-6">'));
    assert.ok(!radar.includes("xl:grid-cols-2"));
    // Totalizadores e rodapé de total.
    assert.ok(radar.includes("GridTotalizers"));
    assert.ok(radar.includes("Ticket médio"));
    assert.ok(radar.includes("Maior título"));
    assert.ok(radar.includes("Total ("));
    // Mensagens de vazio por filtro.
    assert.ok(radar.includes("Nenhuma conta a pagar encontrada para este filtro."));
    assert.ok(radar.includes("Nenhuma conta a receber encontrada para este filtro."));
    // Limpar dia continua disponível no nível de dia.
    assert.ok(radar.includes("Limpar dia"));
    assert.ok(radar.includes("Limpar faixa"));
  });

  it("rotas expõem endpoint daily-radar", () => {
    const routes = readFileSync(
      join(process.cwd(), "src", "lib", "financeCashFlowRoutes.ts"),
      "utf8"
    );
    assert.ok(routes.includes("/api/finance/cash-flow/daily-radar"));
    assert.ok(routes.includes("loadDailyRadarPortfolioRows"));
  });

  it("validateDailyRadarCustomPeriod rejeita data final menor que inicial", () => {
    const result = validateDailyRadarCustomPeriod("2026-06-15", "2026-06-10");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.error, /final/i);
    }
  });

  it("período personalizado calcula entradas, saídas e saldo sem alterar faixas fixas", () => {
    const arRows = [
      arRow({ externalId: 1, balanceReceivable: 100, dueDate: new Date(2026, 5, 10) }),
      arRow({ externalId: 2, balanceReceivable: 250, dueDate: new Date(2026, 5, 20) }),
    ];
    const apRows = [
      apRow({ externalId: 10, balancePayable: 40, dueDate: new Date(2026, 5, 12) }),
      apRow({ externalId: 11, balancePayable: 60, dueDate: new Date(2026, 6, 1) }),
    ];

    const baseline = buildFinanceCashFlowDailyRadar(arRows, apRows, { baseDate: BASE }, BASE);
    assert.equal(baseline.ranges.length, DAILY_RADAR_RANGES.length);

    const withCustom = buildFinanceCashFlowDailyRadar(
      arRows,
      apRows,
      {
        baseDate: BASE,
        customStartDate: "2026-06-09",
        customEndDate: "2026-06-15",
      },
      BASE
    );

    assert.deepEqual(withCustom.ranges, baseline.ranges);
    assert.ok(withCustom.customRange);
    assert.equal(withCustom.customRange!.receivableTotal, 100);
    assert.equal(withCustom.customRange!.payableTotal, 40);
    assert.equal(withCustom.customRange!.netTotal, 60);
    assert.equal(withCustom.customRange!.receivableCount, 1);
    assert.equal(withCustom.customRange!.payableCount, 1);
  });

  it("drilldown do período personalizado bate com totais do card e suporta dia", () => {
    const arRows = [
      arRow({ externalId: 1, balanceReceivable: 100, dueDate: new Date(2026, 5, 10) }),
      arRow({ externalId: 2, balanceReceivable: 200, dueDate: new Date(2026, 5, 12) }),
    ];
    const apRows = [apRow({ externalId: 10, balancePayable: 40, dueDate: new Date(2026, 5, 11) })];

    const payload = buildFinanceCashFlowDailyRadar(
      arRows,
      apRows,
      {
        baseDate: BASE,
        rangeKey: DAILY_RADAR_CUSTOM_RANGE_KEY,
        customStartDate: "2026-06-09",
        customEndDate: "2026-06-15",
      },
      BASE
    );

    assert.ok(payload.customRange);
    assert.ok(payload.selectedDetail);
    const detail = payload.selectedDetail!;
    assert.equal(detail.rangeKey, DAILY_RADAR_CUSTOM_RANGE_KEY);
    assert.equal(detail.entriesTotal, payload.customRange!.receivableTotal);
    assert.equal(detail.exitsTotal, payload.customRange!.payableTotal);
    assert.equal(detail.netTotal, payload.customRange!.netTotal);
    assert.ok(payload.selectedCustomRange);
    assert.equal(payload.selectedCustomRange!.days.length, 7);

    const dayPayload = buildFinanceCashFlowDailyRadar(
      arRows,
      apRows,
      {
        baseDate: BASE,
        rangeKey: DAILY_RADAR_CUSTOM_RANGE_KEY,
        customStartDate: "2026-06-09",
        customEndDate: "2026-06-15",
        day: "2026-06-10",
      },
      BASE
    );
    assert.equal(dayPayload.selectedDetail!.level, "day");
    assert.equal(dayPayload.selectedDetail!.receivables.summary.total, 100);
    assert.equal(dayPayload.selectedDetail!.payables.summary.total, 0);
  });

  it("período personalizado vazio retorna zeros sem erro", () => {
    const payload = buildFinanceCashFlowDailyRadar(
      [],
      [],
      {
        baseDate: BASE,
        customStartDate: "2026-06-09",
        customEndDate: "2026-06-20",
      },
      BASE
    );
    assert.ok(payload.customRange);
    assert.equal(payload.customRange!.receivableTotal, 0);
    assert.equal(payload.customRange!.payableTotal, 0);
    assert.equal(payload.customRange!.netTotal, 0);
    assert.equal(payload.customRange!.receivableCount, 0);
    assert.equal(payload.customRange!.payableCount, 0);
  });

  it("FinanceCashFlowDailyRadar inclui card de período personalizado", () => {
    const radar = readFileSync(
      join(
        process.cwd(),
        "src",
        "components",
        "finance",
        "cash-flow",
        "FinanceCashFlowDailyRadar.tsx"
      ),
      "utf8"
    );
    assert.ok(radar.includes("Período personalizado"));
    assert.ok(radar.includes("cash-flow-radar-custom-period"));
    assert.ok(radar.includes("DAILY_RADAR_CUSTOM_RANGE_KEY"));
    assert.ok(radar.includes("customStartDate"));
    assert.ok(radar.includes("setSelectedCustom(true)"));
    assert.ok(radar.includes("applyCustomPeriod"));
    assert.ok(radar.includes("cash-flow-radar-payables"));
    assert.ok(radar.includes("cash-flow-radar-receivables"));
  });

  it("soma dos dias do período personalizado bate com total do período", () => {
    const arRows = [
      arRow({ externalId: 1, balanceReceivable: 100, dueDate: new Date(2026, 5, 10) }),
      arRow({ externalId: 2, balanceReceivable: 200, dueDate: new Date(2026, 5, 12) }),
    ];
    const apRows = [apRow({ externalId: 10, balancePayable: 40, dueDate: new Date(2026, 5, 11) })];

    const payload = buildFinanceCashFlowDailyRadar(
      arRows,
      apRows,
      {
        baseDate: BASE,
        rangeKey: DAILY_RADAR_CUSTOM_RANGE_KEY,
        customStartDate: "2026-06-09",
        customEndDate: "2026-06-15",
      },
      BASE
    );

    const days = payload.selectedCustomRange?.days ?? [];
    const sumReceivable = days.reduce((sum, day) => sum + day.receivableTotal, 0);
    const sumPayable = days.reduce((sum, day) => sum + day.payableTotal, 0);
    assert.equal(sumReceivable, payload.customRange!.receivableTotal);
    assert.equal(sumPayable, payload.customRange!.payableTotal);
    assert.equal(
      payload.selectedDetail!.receivables.summary.total,
      payload.selectedDetail!.entriesTotal
    );
    assert.equal(payload.selectedDetail!.payables.summary.total, payload.selectedDetail!.exitsTotal);
  });

  it("buildCashFlowDailyRadarData delega ao motor oficial compartilhado", () => {
    const arRows = [arRow({ dueDate: new Date(2026, 5, 9) })];
    const apRows = [apRow({ dueDate: new Date(2026, 5, 10) })];
    const direct = buildFinanceCashFlowDailyRadar(
      arRows,
      apRows,
      { baseDate: BASE, rangeKey: "0-7", exportAll: true },
      BASE
    );
    const shared = buildCashFlowDailyRadarData({
      arRows,
      apRows,
      baseDate: BASE,
      query: { rangeKey: "0-7", exportAll: true },
    });
    assert.equal(shared.ranges.length, direct.ranges.length);
    assert.equal(shared.selectedDetail?.entriesTotal, direct.selectedDetail?.entriesTotal);
  });
});
