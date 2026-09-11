/**
 * Missão H — fechamento Cash Flow: caixa real (camada canônica) injetado nos
 * payloads de Fluxo de Caixa (`injectCashReceivedIntoMonthlyRows`,
 * `injectCashReceivedIntoAnnualComparisonMonths`), a partir de
 * `sumReceivedAmountByCivilMonth`. Cobre os casos de regressão obrigatórios
 * da missão (CR 19497, parcial cross-month, retroativo) no nível exato em
 * que a rota injeta os valores — sem depender de Prisma/DB.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  injectCashReceivedIntoMonthlyRows,
  type FinanceCashFlowExecutiveMonthlyRow,
} from "./financeCashFlowExecutiveSummary.js";
import { injectCashReceivedIntoAnnualComparisonMonths } from "./financeCashFlowAnnualComparison.js";
import {
  sumReceivedAmountByCivilMonth,
  type FinanceReceiptEvent,
} from "./financeReceiptsCanonical.js";

function receiptEvent(overrides: Partial<FinanceReceiptEvent>): FinanceReceiptEvent {
  return {
    receiptExternalId: 1,
    receivableExternalId: 1,
    receiptDate: "2026-01-01",
    receivedAmount: 0,
    bankFeeAmount: 0,
    lateFeeInterestAmount: 0,
    discountAmount: 0,
    closesReceivable: null,
    ...overrides,
  };
}

function monthlyRow(overrides: Partial<FinanceCashFlowExecutiveMonthlyRow>): FinanceCashFlowExecutiveMonthlyRow {
  return {
    year: 2026,
    month: 1,
    monthLabel: "Jan",
    received: 0,
    receivableOpenDue: 0,
    estimatedInflow: 0,
    paid: 0,
    payableOpenDue: 0,
    estimatedOutflow: 0,
    netFlow: 0,
    accumulatedNet: 0,
    ...overrides,
  };
}

describe("financeCashFlowCanonicalCash — injeção de caixa real no Fluxo de Caixa", () => {
  it("1. receipt em 31/08 + baixa em 05/09: caixa fica em Agosto, nunca em Setembro (exemplo mandatório da missão)", () => {
    const events = [
      receiptEvent({ receivableExternalId: 100, receiptDate: "2026-08-31", receivedAmount: 4000 }),
      receiptEvent({ receivableExternalId: 100, receiptDate: "2026-09-05", receivedAmount: 6000 }),
    ];
    const cashByCivilMonth = sumReceivedAmountByCivilMonth(events);
    const rows = [monthlyRow({ month: 8, received: 0 }), monthlyRow({ month: 9, received: 10000 })];
    const injected = injectCashReceivedIntoMonthlyRows(rows, 2026, cashByCivilMonth);
    assert.equal(injected.find((r) => r.month === 8)!.receivedCash, 4000);
    assert.equal(injected.find((r) => r.month === 9)!.receivedCash, 6000);
    assert.notEqual(injected.find((r) => r.month === 9)!.receivedCash, 10000);
  });

  it("2. parcial cross-month: R$4.000 em 31/08 e R$6.000 em 05/09 — caixa agosto=4000, setembro=6000", () => {
    const events = [
      receiptEvent({ receivableExternalId: 200, receiptDate: "2026-08-31", receivedAmount: 4000 }),
      receiptEvent({ receivableExternalId: 200, receiptDate: "2026-09-05", receivedAmount: 6000 }),
    ];
    const cashByCivilMonth = sumReceivedAmountByCivilMonth(events);
    assert.equal(cashByCivilMonth.get("2026-08"), 4000);
    assert.equal(cashByCivilMonth.get("2026-09"), 6000);
  });

  it("3. receipt retroativo: createdAtNomus 10/09 mas receiptDate 26/08 — caixa pertence a agosto", () => {
    const events = [
      receiptEvent({
        receivableExternalId: 300,
        receiptDate: "2026-08-26",
        receivedAmount: 1500,
      }),
    ];
    const cashByCivilMonth = sumReceivedAmountByCivilMonth(events);
    const rows = [monthlyRow({ month: 8 }), monthlyRow({ month: 9 })];
    const injected = injectCashReceivedIntoMonthlyRows(rows, 2026, cashByCivilMonth);
    assert.equal(injected.find((r) => r.month === 8)!.receivedCash, 1500);
    assert.equal(injected.find((r) => r.month === 9)!.receivedCash, null);
  });

  it("4. MISSÃO — caso LIVE CR 19497/RECEIPT 11522: realizado em 04/09 (receiptDate), nunca 10/09 (settlementDate/createdAtNomus)", () => {
    const events = [
      receiptEvent({
        receiptExternalId: 11522,
        receivableExternalId: 19497,
        receiptDate: "2026-09-04",
        receivedAmount: 1488,
      }),
    ];
    const cashByCivilMonth = sumReceivedAmountByCivilMonth(events);
    const rows = [monthlyRow({ month: 9 })];
    const injected = injectCashReceivedIntoMonthlyRows(rows, 2026, cashByCivilMonth);
    assert.equal(injected[0].receivedCash, 1488);
    assert.equal(cashByCivilMonth.get("2026-10"), undefined);
  });

  it("5. YTD usa receiptDate: soma dos meses do mapa canônico diverge do YTD por settlementDate quando as datas divergem", () => {
    const events = [
      receiptEvent({ receivableExternalId: 400, receiptDate: "2026-01-15", receivedAmount: 1000 }),
      receiptEvent({ receivableExternalId: 401, receiptDate: "2026-03-20", receivedAmount: 2000 }),
    ];
    const cashByCivilMonth = sumReceivedAmountByCivilMonth(events);
    const cashYtd = [...cashByCivilMonth.entries()]
      .filter(([key]) => key.startsWith("2026-"))
      .reduce((sum, [, amount]) => sum + amount, 0);
    assert.equal(cashYtd, 3000);
    const settledYtd = 5000;
    assert.notEqual(cashYtd, settledYtd);
  });

  it("6. comparativo anual usa receiptDate — receivedAmount (dueDate/coorte) permanece intocado", () => {
    const months = [
      { month: 8, monthLabel: "ago", receivedAmount: 9999, receivableOpenAmount: 0, cashInTotalAmount: 0, paidAmount: 0, payableOpenAmount: 0, cashOutTotalAmount: 0, netCashAmount: 0, accumulatedCashAmount: 0, plannedNetCashAmount: 0, differenceAgainstPlanned: 0, receivableGoal: null },
      { month: 9, monthLabel: "set", receivedAmount: 0, receivableOpenAmount: 0, cashInTotalAmount: 0, paidAmount: 0, payableOpenAmount: 0, cashOutTotalAmount: 0, netCashAmount: 0, accumulatedCashAmount: 0, plannedNetCashAmount: 0, differenceAgainstPlanned: 0, receivableGoal: null },
    ];
    const events = [
      receiptEvent({ receivableExternalId: 500, receiptDate: "2026-08-31", receivedAmount: 4000 }),
      receiptEvent({ receivableExternalId: 500, receiptDate: "2026-09-05", receivedAmount: 6000 }),
    ];
    const cashByCivilMonth = sumReceivedAmountByCivilMonth(events);
    const injected = injectCashReceivedIntoAnnualComparisonMonths(months, 2026, cashByCivilMonth);
    assert.equal(injected.find((m) => m.month === 8)!.receivedCashAmount, 4000);
    assert.equal(injected.find((m) => m.month === 9)!.receivedCashAmount, 6000);
    // receivedAmount (dueDate/coorte) não é alterado pela injeção aditiva.
    assert.equal(injected.find((m) => m.month === 8)!.receivedAmount, 9999);
    assert.equal(injected.find((m) => m.month === 9)!.receivedAmount, 0);
  });

  it("7. timeline cria um evento por receipt: dois recebimentos do mesmo título no mesmo mês somam; meses diferentes não se misturam", () => {
    const events = [
      receiptEvent({ receivableExternalId: 600, receiptDate: "2026-05-10", receivedAmount: 300 }),
      receiptEvent({ receivableExternalId: 600, receiptDate: "2026-05-20", receivedAmount: 200 }),
      receiptEvent({ receivableExternalId: 600, receiptDate: "2026-06-01", receivedAmount: 100 }),
    ];
    const cashByCivilMonth = sumReceivedAmountByCivilMonth(events);
    assert.equal(cashByCivilMonth.get("2026-05"), 500);
    assert.equal(cashByCivilMonth.get("2026-06"), 100);
  });

  it("8. settled-without-receipt não inventa caixa: mês sem nenhum evento fica null, nunca 0 fictício nem o valor da baixa", () => {
    const cashByCivilMonth = sumReceivedAmountByCivilMonth([]);
    const rows = [monthlyRow({ month: 7, received: 8000 })];
    const injected = injectCashReceivedIntoMonthlyRows(rows, 2026, cashByCivilMonth);
    assert.equal(injected[0].receivedCash, null);
    assert.notEqual(injected[0].receivedCash, 0);
    assert.notEqual(injected[0].receivedCash, 8000);
  });

  it("9. dueDate/coorte (forecast) permanece disponível — injeção é aditiva, não substitui `received`", () => {
    const cashByCivilMonth = sumReceivedAmountByCivilMonth([
      receiptEvent({ receivableExternalId: 700, receiptDate: "2026-04-10", receivedAmount: 250 }),
    ]);
    const rows = [monthlyRow({ month: 4, received: 999 })];
    const injected = injectCashReceivedIntoMonthlyRows(rows, 2026, cashByCivilMonth);
    assert.equal(injected[0].received, 999, "received (settlementDate/dueDate conforme eixo) não muda");
    assert.equal(injected[0].receivedCash, 250);
  });

  it("10. baixa administrativa (settlementDate) continua disponível para fins administrativos — campo irmão, não removido", () => {
    const row = monthlyRow({ month: 2, received: 4242 });
    const injected = injectCashReceivedIntoMonthlyRows([row], 2026, new Map());
    assert.equal(injected[0].received, 4242);
    assert.equal(injected[0].receivedCash, null);
  });
});
