import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildExecutiveMonthlyTimeline,
  buildFinanceCashFlowExecutiveSummary,
} from "@/src/lib/financeCashFlowExecutiveSummary.js";
import {
  buildFinanceCashFlowDashboard,
  type FinanceCashFlowArRow,
} from "@/src/lib/financeCashFlowDashboard.js";

const REF = new Date(2026, 5, 9);

function arRow(overrides: Partial<FinanceCashFlowArRow> = {}): FinanceCashFlowArRow {
  return {
    externalId: 1,
    companyName: "Empresa A",
    personName: "Cliente X",
    personCnpj: null,
    description: null,
    dueDate: new Date(2026, 5, 15),
    settlementDate: null,
    competenceDate: null,
    amountReceivable: 1000,
    amountReceived: 0,
    balanceReceivable: 1000,
    paymentMethodName: null,
    bankAccountName: null,
    sourceInvoiceId: 1,
    sourceInvoiceNumber: "NF-1",
    suspendCollection: false,
    nomusStatus: true,
    syncedAt: new Date(),
    ...overrides,
  } as FinanceCashFlowArRow;
}

const FILTERS_2026 = {
  viewMode: "projected" as const,
  dateBase: "due" as const,
  status: "all" as const,
  year: 2026,
};

const FILTERS_2025 = { ...FILTERS_2026, year: 2025 };

const PERIOD = {
  inflowAmount: 0,
  outflowAmount: 0,
  netFlowAmount: 0,
  accumulatedBalance: 0,
};

/**
 * A: lote 05/02/2026, lag >15, R$100 — vai para dueDate (dez/2025).
 * B: 31/01 → 02/02, lag ≤3, R$200 — motor normal (Fev no Fluxo).
 * C: janeiro → 20/02, lag >15 fora do lote, R$300 — permanece em Fev.
 */
const FIXTURE: FinanceCashFlowArRow[] = [
  arRow({
    externalId: 11,
    sourceInvoiceId: 11,
    sourceInvoiceNumber: "A",
    dueDate: new Date(2025, 11, 6),
    settlementDate: new Date(2026, 1, 5),
    amountReceivable: 100,
    amountReceived: 100,
    balanceReceivable: 0,
  }),
  arRow({
    externalId: 12,
    sourceInvoiceId: 12,
    sourceInvoiceNumber: "B",
    dueDate: new Date(2026, 0, 31),
    settlementDate: new Date(2026, 1, 2),
    amountReceivable: 200,
    amountReceived: 200,
    balanceReceivable: 0,
  }),
  arRow({
    externalId: 13,
    sourceInvoiceId: 13,
    sourceInvoiceNumber: "C",
    dueDate: new Date(2026, 0, 1),
    settlementDate: new Date(2026, 1, 20),
    amountReceivable: 300,
    amountReceived: 300,
    balanceReceivable: 0,
  }),
];

describe("Fluxo de Caixa — overlay histórico mensal AR fevereiro/2026", () => {
  it("A não infla Fev; B e C seguem o motor normal de movement", () => {
    const payload = buildFinanceCashFlowDashboard(FIXTURE, [], FILTERS_2026, REF);
    const jan = payload.executiveSummary.monthlyTimeline.find((r) => r.month === 1);
    const feb = payload.executiveSummary.monthlyTimeline.find((r) => r.month === 2);

    assert.equal(feb?.received, 500, "B 200 + C 300 em Fev; A saiu para dueDate");
    assert.equal(jan?.received, 0, "A vence em 2025; B permanece em Fev no eixo movement");
  });

  it("A reaparece em dez/2025 quando o ano visível inclui o dueDate", () => {
    const payload = buildFinanceCashFlowDashboard(FIXTURE, [], FILTERS_2025, REF);
    const dec = payload.executiveSummary.monthlyTimeline.find((r) => r.month === 12);
    const feb = payload.executiveSummary.monthlyTimeline.find((r) => r.month === 2);
    assert.equal(dec?.received, 100);
    assert.equal(feb?.received, 0);
  });

  it("conserva o valor: soma 2025+2026 depois = soma das baixas antes", () => {
    const p2025 = buildFinanceCashFlowDashboard(FIXTURE, [], FILTERS_2025, REF);
    const p2026 = buildFinanceCashFlowDashboard(FIXTURE, [], FILTERS_2026, REF);
    const after =
      p2025.executiveSummary.monthlyTimeline.reduce((s, r) => s + r.received, 0) +
      p2026.executiveSummary.monthlyTimeline.reduce((s, r) => s + r.received, 0);
    assert.equal(after, 600);
  });

  it("plannedMonthlyTimeline permanece eixo dueDate (ANTES == DEPOIS conceitual)", () => {
    const payload = buildFinanceCashFlowDashboard(FIXTURE, [], FILTERS_2026, REF);
    const planned = payload.executiveSummary.plannedMonthlyTimeline;
    const viaDueDate = buildExecutiveMonthlyTimeline(FIXTURE, [], 2026, REF, {
      filters: FILTERS_2026,
      dateAxis: "dueDate",
    });
    assert.deepEqual(
      planned.map((r) => r.received),
      viaDueDate.map((r) => r.received)
    );
    assert.equal(planned.find((r) => r.month === 1)?.received, 500, "B+C vencem em janeiro");
    assert.equal(planned.find((r) => r.month === 2)?.received, 0);
  });

  it("Mar–Dez/2026 do fixture não mudam além de Fev (e Jan permanece 0 no movement)", () => {
    const payload = buildFinanceCashFlowDashboard(FIXTURE, [], FILTERS_2026, REF);
    for (const row of payload.executiveSummary.monthlyTimeline) {
      if (row.month === 2) continue;
      assert.equal(row.received, 0, `mês ${row.month} não deveria receber o lote histórico`);
    }
  });

  it("Recebido YTD 2026 permanece por settlement (inclui A); distinto da timeline mensal", () => {
    const payload = buildFinanceCashFlowDashboard(FIXTURE, [], FILTERS_2026, REF);
    const summary = buildFinanceCashFlowExecutiveSummary(
      FIXTURE,
      [],
      FILTERS_2026,
      REF,
      PERIOD
    );
    assert.equal(payload.executiveSummary.receivable.receivedYtd, summary.receivable.receivedYtd);
    assert.equal(
      summary.receivable.receivedYtd,
      600,
      "YTD por baixa: A+B+C; overlay mensal não pode alterar o card"
    );
    const monthlySum = summary.monthlyTimeline.reduce((s, r) => s + r.received, 0);
    assert.equal(monthlySum, 500, "timeline 2026 perde A para 2025; YTD não");
  });

  it("guard: plannedMonthlyTimeline continua dateAxis dueDate; movement só na tabela", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/financeCashFlowExecutiveSummary.ts"),
      "utf8"
    );
    assert.match(src, /dateAxis: "movement"/);
    assert.match(src, /dateAxis: "dueDate"/);
    assert.match(src, /plannedMonthlyTimeline = buildExecutiveMonthlyTimeline/);
    assert.doesNotMatch(
      src,
      /plannedMonthlyTimeline = buildExecutiveMonthlyTimeline\([\s\S]*dateAxis: "movement"/
    );
  });
});
