/**
 * Validação E2E consolidada — regras críticas, paridade CSV/cards, rotas UI.
 * Não requer banco — complementa scripts CLI com DATABASE_URL.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateMonthlyPayableFromRows,
  buildMonthlyClosingCards,
  buildMonthlyPayableDetailCsv,
  buildMonthlyPayableSellerSummaryCsv,
} from "./commissionMonthlyPayable.js";
import {
  aggregateReceivableForecastFromRows,
  buildReceivableForecastDetailCsv,
  buildReceivableForecastMonthlyCsv,
} from "./commissionReceivableForecast.js";
import {
  buildCommissionReceivablesTimeline,
  enumerateMonthKeys,
  findTimelineMonth,
} from "./commissionReceivablesTimeline.js";
import { buildNomusReconciliationFromPayableRows } from "./commissionNomusReconciliation.js";
import {
  buildVisualAuditRow,
  filterRowsByAppraisalMode,
  computeVisualAuditCards,
} from "./commissionVisualAudit.js";
import { COMMISSIONS_SECTION_PATHS } from "../commissionsNavigation.js";

const JUNE = {
  from: new Date("2026-06-01T00:00:00.000Z"),
  to: new Date("2026-06-30T23:59:59.999Z"),
};

function settled(overrides: Record<string, unknown> = {}) {
  return buildVisualAuditRow({
    lineId: "r1:s1",
    recordId: "r1",
    scheduleId: "s1",
    commissionPersonId: "p-gislene",
    commissionPersonName: "GISLENE LIMA",
    customerName: "Cliente",
    orderCode: "PED-1",
    nfeNumber: "100",
    nomusNfeId: 100,
    confirmedAt: "2026-04-01T00:00:00.000Z",
    documentKey: "p-gislene:100",
    documentBaseAmount: 1000,
    documentCommissionTotal: 25,
    itemBaseAmount: 1000,
    itemCommissionAmount: 25,
    itemRatePercent: 2.5,
    productCode: "P1",
    nomusReceivableId: 999,
    installmentNumber: 1,
    dueDate: "2026-06-01T00:00:00.000Z",
    settlementDate: "2026-06-15T00:00:00.000Z",
    receivableAmount: 500,
    receivedAmount: 500,
    openBalance: 0,
    allocationPercent: 50,
    commissionExpected: 12.5,
    commissionReleased: 12.5,
    hasArLink: true,
    hasSchedule: true,
    customerNoCommission: false,
    isCommissionable: true,
    exclusionReason: null,
    exclusionRuleId: null,
    ...overrides,
  });
}

describe("commission E2E validation", () => {
  it("fluxo completo: PAYABLE junho, FORECAST aberto, timeline, Nomus", () => {
    const juneSettled = settled();
    const juneOpenFuture = settled({
      lineId: "r2:s2",
      scheduleId: "s2",
      recordId: "r2",
      nomusReceivableId: 1000,
      dueDate: "2026-08-01T00:00:00.000Z",
      settlementDate: null,
      receivedAmount: 0,
      openBalance: 400,
      commissionReleased: 0,
      commissionExpected: 10,
    });
    const overdueOpen = settled({
      lineId: "r3:s3",
      scheduleId: "s3",
      recordId: "r3",
      nomusReceivableId: 1001,
      dueDate: "2026-05-01T00:00:00.000Z",
      settlementDate: null,
      receivedAmount: 0,
      openBalance: 300,
      commissionReleased: 0,
      commissionExpected: 8,
    });

    const payableJune = filterRowsByAppraisalMode([juneSettled], "PAYABLE", JUNE);
    const summaryJune = aggregateMonthlyPayableFromRows(payableJune, { year: 2026, month: 6 });
    assert.equal(summaryJune.payableCommissionTotal, 12.5);

    const forecast = aggregateReceivableForecastFromRows(
      [juneOpenFuture, overdueOpen],
      {}
    );
    assert.equal(forecast.cards.futureCommissionTotal, 10);
    assert.equal(forecast.cards.overdueCommissionTotal, 8);

    const timeline = buildCommissionReceivablesTimeline({
      fromMonthKey: "2026-01",
      toMonthKey: "2026-12",
      payableSummaries: [summaryJune],
      forecast,
    });
    const juneRow = findTimelineMonth(timeline, 2026, 6);
    assert.equal(juneRow?.payableCommissionTotal, 12.5);

    const nomus = buildNomusReconciliationFromPayableRows(payableJune, {
      year: 2026,
      month: 6,
      sellerName: "GISLENE",
      nomusBase: 500,
      nomusCommission: 10,
    });
    assert.equal(nomus.indusCommission, 12.5);
    assert.equal(nomus.commissionDiff, 2.5);
  });

  it("regras críticas de recorte temporal", () => {
    const baixadoJunho = settled();
    const futuroSemBaixa = settled({
      lineId: "r2:s2",
      scheduleId: "s2",
      dueDate: "2026-08-01T00:00:00.000Z",
      settlementDate: null,
      receivedAmount: 0,
      commissionReleased: 0,
    });
    const vencidoAberto = settled({
      lineId: "r3:s3",
      scheduleId: "s3",
      dueDate: "2026-05-15T00:00:00.000Z",
      settlementDate: null,
      receivedAmount: 0,
      commissionReleased: 0,
      commissionExpected: 5,
    });
    const nfAntigaBaixaJunho = settled({
      lineId: "r4:s4",
      scheduleId: "s4",
      recordId: "r4",
      nomusReceivableId: 888,
      confirmedAt: "2026-03-01T00:00:00.000Z",
      settlementDate: "2026-06-10T00:00:00.000Z",
    });

    const payable = filterRowsByAppraisalMode(
      [baixadoJunho, futuroSemBaixa, nfAntigaBaixaJunho],
      "PAYABLE",
      JUNE
    );
    const summary = aggregateMonthlyPayableFromRows(payable, { year: 2026, month: 6 });
    assert.equal(summary.payableCommissionTotal, 25);
    assert.equal(summary.uniqueReceivablesCount, 2);

    const forecast = aggregateReceivableForecastFromRows([vencidoAberto, futuroSemBaixa], {});
    assert.ok(forecast.overdue.length >= 1 || forecast.cards.overdueCommissionTotal > 0);
    assert.equal(
      aggregateReceivableForecastFromRows([baixadoJunho], {}).details.length,
      0
    );
  });

  it("CSV resumo e detalhe batem com cards (fechamento)", () => {
    const rows = filterRowsByAppraisalMode([settled()], "PAYABLE", JUNE);
    const summary = aggregateMonthlyPayableFromRows(rows, { year: 2026, month: 6 });
    const cards = buildMonthlyClosingCards(summary, 0);
    const csvSummary = buildMonthlyPayableSellerSummaryCsv(summary);
    const csvDetail = buildMonthlyPayableDetailCsv(summary);
    assert.match(csvSummary, new RegExp(`# total_liberado=${cards.payableCommissionTotal.toFixed(2)}`));
    assert.match(csvDetail, new RegExp(`# total_liberado=${cards.payableCommissionTotal.toFixed(2)}`));
  });

  it("CSV mensal e detalhe batem com cards (previsão)", () => {
    const open = settled({
      settlementDate: null,
      receivedAmount: 0,
      openBalance: 500,
      commissionReleased: 0,
    });
    const forecast = aggregateReceivableForecastFromRows([open], {});
    const csvMonthly = buildReceivableForecastMonthlyCsv(forecast);
    const csvDetail = buildReceivableForecastDetailCsv(forecast);
    assert.match(
      csvMonthly,
      new RegExp(`# comissao_prevista_futura=${forecast.cards.futureCommissionTotal.toFixed(2)}`)
    );
    assert.match(csvDetail, /GISLENE LIMA/);
  });

  it("dedup CR e NF em agregações", () => {
    const dupSchedule = settled({
      lineId: "r1:s2",
      scheduleId: "s2",
      itemBaseAmount: 500,
      commissionReleased: 6.25,
    });
    const payable = filterRowsByAppraisalMode([settled(), dupSchedule], "PAYABLE", JUNE);
    const summary = aggregateMonthlyPayableFromRows(payable, { year: 2026, month: 6 });
    assert.equal(summary.uniqueReceivablesCount, 1);
    assert.equal(summary.payableCommissionTotal, 18.75);
    assert.equal(summary.receivedAmountTotal, 500);
  });

  it("UI expõe abas canônicas incluindo exclusões por cliente", () => {
    assert.equal(COMMISSIONS_SECTION_PATHS.monthlyClosing, "/commissions");
    assert.equal(COMMISSIONS_SECTION_PATHS.receivableForecast, "/commissions/previsao");
    assert.equal(COMMISSIONS_SECTION_PATHS.visualAudit, "/commissions/auditoria");
    assert.equal(COMMISSIONS_SECTION_PATHS.customerExclusions, "/commissions/exclusoes-cliente");
  });

  it("timeline enumera 12 meses de 2026", () => {
    const months = enumerateMonthKeys("2026-01", "2026-12");
    assert.equal(months.length, 12);
    assert.equal(months[0]?.month, 1);
    assert.equal(months[11]?.month, 12);
  });

  it("settlementDate para PAYABLE e dueDate para FORECAST", () => {
    const cardsPayable = computeVisualAuditCards(
      filterRowsByAppraisalMode([settled()], "PAYABLE", JUNE),
      "PAYABLE"
    );
    assert.equal(cardsPayable.commissionReleasedTotal, 12.5);

    const openRow = settled({
      settlementDate: null,
      receivedAmount: 0,
      openBalance: 500,
      commissionPending: 12.5,
      commissionReleased: 0,
    });
    const forecastCards = aggregateReceivableForecastFromRows([openRow], {}).cards;
    assert.ok(forecastCards.futureCommissionTotal >= 0);
  });
});
