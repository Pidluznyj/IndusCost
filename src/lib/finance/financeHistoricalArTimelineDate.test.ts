/**
 * Política histórica da Linha do Tempo Mensal — não é o resolver canônico de 3 dias úteis.
 *
 * Totais de auditoria em produção (fevereiro/2026, amountReceived):
 *   bruto 2.350.398,55; normalizado (lag>15 nas 4 datas) 1.060.137,55;
 *   fevereiro restante 1.290.261,00;
 *   redistribuição 2025-11 309.042,24 / 2025-12 426.028,00 / 2026-01 325.067,31.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  startOfLocalDay,
  sumFinanceArReceivedBySettlementInFilteredRows,
  sumFinanceArReceivedBySettlementInPeriod,
} from "@/src/lib/financeAccountsReceivableDashboard.js";
import { buildFinanceCashFlowDashboard, type FinanceCashFlowArRow } from "@/src/lib/financeCashFlowDashboard.js";
import { toCivilDateKey } from "@/src/lib/financeCivilDate.js";
import {
  HISTORICAL_AR_ADMIN_MIN_LAG_DAYS,
  HISTORICAL_AR_ADMIN_SETTLEMENT_DATES,
  resolveHistoricalArTimelineDate,
  sumFinanceArReceivedByHistoricalTimelineDateInFilteredRows,
} from "@/src/lib/finance/financeHistoricalArTimelineDate.js";
import {
  FINANCE_SETTLEMENT_RECONCILIATION_DEFAULTS,
  resolveFinanceEffectiveSettlementDate,
} from "@/src/lib/finance/financeSettlementReconciliation.js";

const REF = new Date(2026, 5, 9);
const CF_FILTERS = {
  viewMode: "projected" as const,
  dateBase: "due" as const,
  status: "all" as const,
  year: 2026,
};

/** Auditoria produção — valores documentados, não 53 títulos reais. */
const AUDIT = {
  febGross: 2_350_398.55,
  normalizedOut: 1_060_137.55,
  febRemaining: 1_290_261.0,
  due2025_11: 309_042.24,
  due2025_12: 426_028.0,
  due2026_01: 325_067.31,
};

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
  };
}

function monthReceived(
  year: number,
  month: number,
  rows: FinanceCashFlowArRow[]
): number {
  return (
    buildFinanceCashFlowDashboard(rows, [], { ...CF_FILTERS, year }, REF).executiveSummary
      .monthlyTimeline.find((r) => r.month === month)?.received ?? 0
  );
}

function plannedMonthReceived(
  year: number,
  month: number,
  rows: FinanceCashFlowArRow[]
): number {
  return (
    buildFinanceCashFlowDashboard(rows, [], { ...CF_FILTERS, year }, REF).executiveSummary
      .plannedMonthlyTimeline.find((r) => r.month === month)?.received ?? 0
  );
}

describe("financeHistoricalArTimelineDate — política, não resolver canônico", () => {
  it("constantes da auditoria: 4 datas de lote e threshold 15 dias corridos", () => {
    assert.equal(HISTORICAL_AR_ADMIN_MIN_LAG_DAYS, 15);
    assert.deepEqual(
      [...HISTORICAL_AR_ADMIN_SETTLEMENT_DATES].sort(),
      ["2026-02-04", "2026-02-05", "2026-02-09", "2026-02-19"]
    );
  });

  it("1. lote 2026-02-04 / venc. 2025-11-20 / lag>15 → aloca em 2025-11", () => {
    const allocated = resolveHistoricalArTimelineDate({
      dueDate: new Date(2025, 10, 20),
      settlementDate: new Date(2026, 1, 4),
    });
    assert.equal(toCivilDateKey(allocated), "2025-11-20");
    const rows = [
      arRow({
        amountReceived: 1000,
        amountReceivable: 1000,
        balanceReceivable: 0,
        dueDate: new Date(2025, 10, 20),
        settlementDate: new Date(2026, 1, 4),
      }),
    ];
    assert.equal(monthReceived(2025, 11, rows), 1000);
    assert.equal(monthReceived(2026, 2, rows), 0);
  });

  it("2. lote 2026-02-05 / venc. 2025-12-06 → aloca em 2025-12", () => {
    const rows = [
      arRow({
        amountReceived: 2000,
        amountReceivable: 2000,
        balanceReceivable: 0,
        dueDate: new Date(2025, 11, 6),
        settlementDate: new Date(2026, 1, 5),
      }),
    ];
    assert.equal(monthReceived(2025, 12, rows), 2000);
    assert.equal(monthReceived(2026, 2, rows), 0);
  });

  it("3. Koppetel-like: venc. 2026-01-30 / baixa 2026-02-19 / lag 20 → janeiro", () => {
    const rows = [
      arRow({
        externalId: 13168,
        personName: "Cliente lote jan/30",
        amountReceived: 74_000,
        amountReceivable: 74_000,
        balanceReceivable: 0,
        dueDate: new Date(2026, 0, 30),
        settlementDate: new Date(2026, 1, 19),
      }),
    ];
    assert.equal(monthReceived(2026, 1, rows), 74_000);
    assert.equal(monthReceived(2026, 2, rows), 0);
  });

  it("4. mesma data de lote, lag <=15 → permanece em fevereiro", () => {
    const rows = [
      arRow({
        amountReceived: 500,
        amountReceivable: 500,
        balanceReceivable: 0,
        dueDate: new Date(2026, 1, 10),
        settlementDate: new Date(2026, 1, 19),
      }),
    ];
    assert.equal(monthReceived(2026, 2, rows), 500);
  });

  it("5. data fora do lote (2026-02-10), lag>15 → permanece na settlementDate", () => {
    const rows = [
      arRow({
        amountReceived: 800,
        amountReceivable: 800,
        balanceReceivable: 0,
        dueDate: new Date(2025, 6, 1),
        settlementDate: new Date(2026, 1, 10),
      }),
    ];
    assert.equal(monthReceived(2026, 2, rows), 800);
    assert.equal(monthReceived(2025, 7, rows), 0);
  });

  it("6. março/2026 atraso real >30 → permanece em março", () => {
    const rows = [
      arRow({
        amountReceived: 900,
        amountReceivable: 900,
        balanceReceivable: 0,
        dueDate: new Date(2025, 5, 1),
        settlementDate: new Date(2026, 2, 15),
      }),
    ];
    assert.equal(monthReceived(2026, 3, rows), 900);
  });

  it("7. antecipado (settlement < due) em data de lote → permanece settlementDate", () => {
    const rows = [
      arRow({
        amountReceived: 400,
        amountReceivable: 400,
        balanceReceivable: 0,
        dueDate: new Date(2026, 2, 20),
        settlementDate: new Date(2026, 1, 19),
      }),
    ];
    assert.equal(monthReceived(2026, 2, rows), 400);
    assert.equal(monthReceived(2026, 3, rows), 0);
  });

  it("8. sem dueDate → comportamento anterior (settlementDate)", () => {
    const rows = [
      arRow({
        amountReceived: 300,
        amountReceivable: 300,
        balanceReceivable: 0,
        dueDate: null,
        settlementDate: new Date(2026, 1, 4),
      }),
    ];
    assert.equal(monthReceived(2026, 2, rows), 300);
    assert.equal(resolveHistoricalArTimelineDate({ dueDate: null, settlementDate: new Date(2026, 1, 4) })?.getTime(), new Date(2026, 1, 4).getTime());
  });

  it("9. plannedMonthlyTimeline continua no vencimento", () => {
    const rows = [
      arRow({
        amountReceived: 1500,
        amountReceivable: 1500,
        balanceReceivable: 0,
        dueDate: new Date(2025, 10, 20),
        settlementDate: new Date(2026, 1, 4),
      }),
    ];
    assert.equal(plannedMonthReceived(2025, 11, rows), 1500);
    assert.equal(plannedMonthReceived(2026, 2, rows), 0);
    assert.equal(monthReceived(2026, 2, rows), 0);
  });

  it("meia-noite UTC do lote não vira 03/02 — ainda normaliza", () => {
    const allocated = resolveHistoricalArTimelineDate({
      dueDate: new Date(Date.UTC(2025, 10, 20)),
      settlementDate: new Date(Date.UTC(2026, 1, 4)),
    });
    assert.equal(toCivilDateKey(allocated), "2025-11-20");
    assert.equal(toCivilDateKey(new Date(Date.UTC(2026, 1, 4))), "2026-02-04");
  });

  it("lag exatamente 15 em data de lote não normaliza", () => {
    const allocated = resolveHistoricalArTimelineDate({
      dueDate: new Date(2026, 1, 4),
      settlementDate: new Date(2026, 1, 19),
    });
    assert.equal(toCivilDateKey(allocated), "2026-02-19");
  });

  it("10. resolver canônico de 3 dias úteis NÃO aplica o lote histórico", () => {
    const dueDate = new Date(2025, 10, 20);
    const settlementDate = new Date(2026, 1, 4);
    const canonical = resolveFinanceEffectiveSettlementDate(
      { dueDate, settledOn: settlementDate, isSettled: true },
      FINANCE_SETTLEMENT_RECONCILIATION_DEFAULTS
    );
    assert.equal(toCivilDateKey(canonical), "2026-02-04");
    assert.equal(FINANCE_SETTLEMENT_RECONCILIATION_DEFAULTS.toleranceDays, 3);
    assert.equal(
      toCivilDateKey(resolveHistoricalArTimelineDate({ dueDate, settlementDate })),
      "2025-11-20"
    );
  });
});

describe("financeHistoricalArTimelineDate — totais da auditoria (fixture representativa)", () => {
  const rows: FinanceCashFlowArRow[] = [
    arRow({
      externalId: 11,
      amountReceived: AUDIT.due2025_11,
      amountReceivable: AUDIT.due2025_11,
      balanceReceivable: 0,
      dueDate: new Date(2025, 10, 20),
      settlementDate: new Date(2026, 1, 4),
    }),
    arRow({
      externalId: 12,
      amountReceived: AUDIT.due2025_12,
      amountReceivable: AUDIT.due2025_12,
      balanceReceivable: 0,
      dueDate: new Date(2025, 11, 6),
      settlementDate: new Date(2026, 1, 5),
    }),
    arRow({
      externalId: 13,
      amountReceived: AUDIT.due2026_01,
      amountReceivable: AUDIT.due2026_01,
      balanceReceivable: 0,
      dueDate: new Date(2026, 0, 30),
      settlementDate: new Date(2026, 1, 19),
    }),
    arRow({
      externalId: 14,
      amountReceived: AUDIT.febRemaining,
      amountReceivable: AUDIT.febRemaining,
      balanceReceivable: 0,
      dueDate: new Date(2026, 1, 10),
      settlementDate: new Date(2026, 1, 15),
    }),
  ];

  it("antes da normalização conceitual o bruto de fevereiro permanece no somador cru", () => {
    const febStart = startOfLocalDay(new Date(2026, 1, 1));
    const febEnd = startOfLocalDay(new Date(2026, 1, 28));
    assert.equal(
      sumFinanceArReceivedBySettlementInFilteredRows(rows, febStart, febEnd),
      AUDIT.febGross
    );
  });

  it("depois da normalização: sai 1.060.137,55 de fevereiro e redistribui 2025-11/12 e 2026-01", () => {
    const febStart = startOfLocalDay(new Date(2026, 1, 1));
    const febEnd = startOfLocalDay(new Date(2026, 1, 28));
    assert.equal(
      sumFinanceArReceivedByHistoricalTimelineDateInFilteredRows(rows, febStart, febEnd),
      AUDIT.febRemaining
    );
    assert.equal(monthReceived(2026, 2, rows), AUDIT.febRemaining);
    assert.equal(monthReceived(2026, 1, rows), AUDIT.due2026_01);
    assert.equal(monthReceived(2025, 11, rows), AUDIT.due2025_11);
    assert.equal(monthReceived(2025, 12, rows), AUDIT.due2025_12);
    assert.equal(
      roundAudit(AUDIT.due2025_11 + AUDIT.due2025_12 + AUDIT.due2026_01),
      AUDIT.normalizedOut
    );
    assert.equal(roundAudit(AUDIT.febGross - AUDIT.normalizedOut), AUDIT.febRemaining);
  });

  it("KPI CR por settlementDate continua no bruto de fevereiro (não usa a política histórica)", () => {
    const febStart = startOfLocalDay(new Date(2026, 1, 1));
    const febEnd = startOfLocalDay(new Date(2026, 1, 28));
    assert.equal(
      sumFinanceArReceivedBySettlementInPeriod(
        rows,
        { status: "all", year: 2026, month: 2 },
        new Date(2026, 1, 20),
        null,
        febStart,
        febEnd
      ),
      AUDIT.febGross
    );
  });
});

function roundAudit(n: number): number {
  return Math.round(n * 100) / 100;
}
