/**
 * Visibilidade operacional D+1..D+3 de CR atrasado na Timeline da Caixa.
 * Camada paralela: não altera inflows/closing/cenários/gráfico.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { TreasuryCaixaTimelineRow } from "./treasuryCaixaRules.js";
import {
  buildTreasuryCaixaMonthlyBalanceChart,
  buildTreasuryCaixaMonthlyTimeline,
  composeTreasuryCaixaTimelineDisplayRows,
  selectTreasuryCaixaRecentOverdueReceivables,
  TREASURY_CAIXA_RECENT_OVERDUE_VISIBILITY_DAYS,
} from "./treasuryCaixaRules.js";

function title(over: {
  externalId?: number;
  dueDate?: string | null;
  personName?: string | null;
  balanceReceivable?: number;
  daysOverdue?: number;
  calculatedStatus?: string | null;
  suspendCollection?: boolean | null;
}) {
  return {
    externalId: over.externalId ?? 18257,
    dueDate: over.dueDate === undefined ? "2026-09-20" : over.dueDate,
    personName: over.personName === undefined ? "Britânia Eletrodomésticos SA" : over.personName,
    balanceReceivable: over.balanceReceivable ?? 162866,
    daysOverdue: over.daysOverdue ?? 1,
    calculatedStatus: over.calculatedStatus ?? "overdue",
    suspendCollection: over.suspendCollection ?? false,
  };
}

function financialRow(
  civilDate: string,
  over: Partial<TreasuryCaixaTimelineRow> = {}
): TreasuryCaixaTimelineRow {
  const closing = over.closing !== undefined ? over.closing : 0;
  return {
    civilDate,
    kind: civilDate < "2026-09-21" ? "REALIZED" : civilDate > "2026-09-21" ? "FORECAST" : "TODAY",
    opening: 0,
    inflows: 0,
    outflows: 0,
    closing,
    closingCalculated: closing,
    closingInformed: null,
    divergence: null,
    negative: closing != null && closing < 0,
    ...over,
  };
}

describe("treasuryCaixaRecentOverdue — selectTreasuryCaixaRecentOverdueReceivables", () => {
  it("expõe a janela de 3 dias corridos", () => {
    assert.equal(TREASURY_CAIXA_RECENT_OVERDUE_VISIBILITY_DAYS, 3);
  });

  it("CR vencido há 1 dia e aberto aparece como recent overdue", () => {
    const days = selectTreasuryCaixaRecentOverdueReceivables([title({ daysOverdue: 1 })]);
    assert.equal(days.length, 1);
    assert.equal(days[0]!.civilDate, "2026-09-20");
    assert.equal(days[0]!.amount, 162866);
    assert.equal(days[0]!.count, 1);
    assert.equal(days[0]!.daysOverdue, 1);
    assert.equal(days[0]!.titles[0]!.externalId, 18257);
  });

  it("CR vencido há 2 dias aparece", () => {
    const days = selectTreasuryCaixaRecentOverdueReceivables([title({ daysOverdue: 2 })]);
    assert.equal(days[0]!.daysOverdue, 2);
    assert.equal(days[0]!.count, 1);
  });

  it("CR vencido há 3 dias aparece", () => {
    const days = selectTreasuryCaixaRecentOverdueReceivables([title({ daysOverdue: 3 })]);
    assert.equal(days[0]!.daysOverdue, 3);
  });

  it("CR vencido há 4 dias NÃO aparece na camada recent overdue", () => {
    const days = selectTreasuryCaixaRecentOverdueReceivables([title({ daysOverdue: 4 })]);
    assert.deepEqual(days, []);
  });

  it("título liquidado NÃO aparece", () => {
    const days = selectTreasuryCaixaRecentOverdueReceivables([
      title({ calculatedStatus: "settled", daysOverdue: 1, balanceReceivable: 162866 }),
    ]);
    assert.deepEqual(days, []);
  });

  it("balanceReceivable = 0 NÃO aparece", () => {
    const days = selectTreasuryCaixaRecentOverdueReceivables([
      title({ balanceReceivable: 0, daysOverdue: 1 }),
    ]);
    assert.deepEqual(days, []);
  });

  it("sem dueDate NÃO aparece", () => {
    const days = selectTreasuryCaixaRecentOverdueReceivables([
      title({ dueDate: null, daysOverdue: 1 }),
    ]);
    assert.deepEqual(days, []);
  });

  it("múltiplos títulos no mesmo dueDate agrupam", () => {
    const days = selectTreasuryCaixaRecentOverdueReceivables([
      title({ externalId: 1, balanceReceivable: 100, daysOverdue: 1 }),
      title({ externalId: 2, personName: "Outro", balanceReceivable: 50, daysOverdue: 1 }),
    ]);
    assert.equal(days.length, 1);
    assert.equal(days[0]!.amount, 150);
    assert.equal(days[0]!.count, 2);
    assert.equal(days[0]!.titles[0]!.externalId, 1);
    assert.equal(days[0]!.titles[1]!.externalId, 2);
  });

  it("domingo: vence domingo e segunda é D+1 corrido — aparece", () => {
    const days = selectTreasuryCaixaRecentOverdueReceivables([
      title({ dueDate: "2026-09-20", daysOverdue: 1 }),
    ]);
    assert.equal(days[0]!.civilDate, "2026-09-20");
    assert.equal(days[0]!.daysOverdue, 1);
  });

  it("sábado: a regra continua por dias corridos", () => {
    const days = selectTreasuryCaixaRecentOverdueReceivables([
      title({ dueDate: "2026-09-19", daysOverdue: 2 }),
    ]);
    assert.equal(days[0]!.civilDate, "2026-09-19");
    assert.equal(days[0]!.daysOverdue, 2);
  });

  it("não inclui suspenso", () => {
    assert.deepEqual(
      selectTreasuryCaixaRecentOverdueReceivables([
        title({ suspendCollection: true, daysOverdue: 1 }),
      ]),
      []
    );
    assert.deepEqual(
      selectTreasuryCaixaRecentOverdueReceivables([
        title({ calculatedStatus: "suspended", daysOverdue: 1 }),
      ]),
      []
    );
  });

  it("respeita o recorte do período visível do board", () => {
    const days = selectTreasuryCaixaRecentOverdueReceivables(
      [title({ dueDate: "2026-09-20", daysOverdue: 1 })],
      { dueDateFrom: "2026-10-01", dueDateTo: "2026-10-31" }
    );
    assert.deepEqual(days, []);
  });
});

describe("treasuryCaixaRecentOverdue — composeTreasuryCaixaTimelineDisplayRows", () => {
  it("reinsere o vencimento original mesmo sem TreasuryCaixaTimelineRow financeiro", () => {
    const display = composeTreasuryCaixaTimelineDisplayRows(
      [financialRow("2026-09-18"), financialRow("2026-09-21")],
      selectTreasuryCaixaRecentOverdueReceivables([title({ daysOverdue: 1 })])
    );
    assert.deepEqual(
      display.map((d) => [d.type, d.civilDate]),
      [
        ["FINANCIAL_DAY", "2026-09-18"],
        ["RECENT_OVERDUE", "2026-09-20"],
        ["FINANCIAL_DAY", "2026-09-21"],
      ]
    );
  });

  it("não muta as linhas financeiras quando o vencimento coincide com um dia de caixa", () => {
    const row = financialRow("2026-09-20", { inflows: 10, closing: 10 });
    const frozen = { ...row };
    const display = composeTreasuryCaixaTimelineDisplayRows(
      [row],
      selectTreasuryCaixaRecentOverdueReceivables([title({ daysOverdue: 1 })])
    );
    assert.equal(display.length, 1);
    assert.equal(display[0]!.type, "FINANCIAL_DAY");
    if (display[0]!.type !== "FINANCIAL_DAY") throw new Error("expected financial day");
    assert.equal(display[0]!.row.inflows, 10);
    assert.equal(display[0]!.recentOverdue?.amount, 162866);
    assert.deepEqual(row, frozen);
  });
});

describe("treasuryCaixaRecentOverdue — NÃO duplicar caixa (Britânia 20/09)", () => {
  it("162.866 não entra em inflows/closing/abertura de 21/09 nem no gráfico", () => {
    const sep19 = financialRow("2026-09-19", {
      opening: 500000,
      inflows: 0,
      outflows: 0,
      closing: 500000,
      closingCalculated: 500000,
    });
    const sep21 = financialRow("2026-09-21", {
      opening: 500000,
      inflows: 30000,
      outflows: 0,
      closing: 530000,
      closingCalculated: 530000,
    });
    const timelineRows = [sep19, sep21];
    const recent = selectTreasuryCaixaRecentOverdueReceivables([
      title({
        externalId: 18257,
        dueDate: "2026-09-20",
        personName: "Britânia Eletrodomésticos SA",
        balanceReceivable: 162866,
        daysOverdue: 1,
      }),
    ]);

    const display = composeTreasuryCaixaTimelineDisplayRows(timelineRows, recent);
    const after21 = display.find((d) => d.civilDate === "2026-09-21");
    assert.equal(after21?.type, "FINANCIAL_DAY");
    if (after21?.type !== "FINANCIAL_DAY") throw new Error("expected 21/09 financial");
    assert.equal(after21.row.inflows, 30000);
    assert.equal(after21.row.opening, 500000);
    assert.equal(after21.row.closing, 530000);
    assert.equal(after21.row.closingCalculated, 530000);

    const visual20 = display.find((d) => d.civilDate === "2026-09-20");
    assert.equal(visual20?.type, "RECENT_OVERDUE");
    if (visual20?.type !== "RECENT_OVERDUE") throw new Error("expected 20/09 operational");
    assert.equal(visual20.recentOverdue.amount, 162866);

    const monthsBefore = buildTreasuryCaixaMonthlyTimeline(timelineRows);
    const monthsAfterDisplay = buildTreasuryCaixaMonthlyTimeline(timelineRows);
    assert.deepEqual(monthsAfterDisplay, monthsBefore);
    assert.equal(monthsBefore[0]!.inflows, 30000);
    assert.equal(monthsBefore[0]!.closing, 530000);

    const chart = buildTreasuryCaixaMonthlyBalanceChart(monthsBefore);
    assert.equal(chart[0]!.closingBalance, 530000);

    assert.equal(sep21.inflows, 30000);
    assert.equal(sep21.opening, 500000);
    assert.equal(sep21.closing, 530000);
    assert.equal(
      timelineRows.some((r) => r.civilDate === "2026-09-20"),
      false,
      "atraso recente não pode entrar em timeline.rows"
    );
  });
});
