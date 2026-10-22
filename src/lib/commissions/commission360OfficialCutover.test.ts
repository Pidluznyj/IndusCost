/**
 * Visão 360° — corte temporal oficial da série principal.
 *
 * Até 30/09/2026 o Nomus é a fonte (espelho técnico); a partir de 01/10/2026 vale o fechamento
 * oficial do IndusCost; 09/2026 é o marco da previsão. A série principal só mostra o motor
 * oficial; legado e ajustes retroativos ficam em `legacySection`. Competência = receiptDate.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { projectCommissionPortfolioOutlookLines, type OutlookScheduleInput } from "./commissionPortfolioOutlook.js";
import {
  buildCommission360ReleasedNotPaid,
  buildCommission360View,
  classifyCommission360BatchCompetence,
  classifyCommission360Receipt,
  isCommission360OperationalLedgerLine,
  parseCommission360Query,
  type Commission360BatchInput,
  type Commission360Facts,
  type Commission360LedgerLineInput,
} from "./commission360View.js";

const TODAY = "2026-12-05";
const ANA = "11111111-1111-4111-8111-111111111111";
const BRUNO = "22222222-2222-4222-8222-222222222222";

function fact(over: Partial<OutlookScheduleInput> = {}): OutlookScheduleInput {
  return {
    scheduleId: "sch-1",
    scheduleStatus: "ACTIVE",
    orderSnapshotStatus: "ACTIVE",
    scheduleCreatedAt: "2026-08-01T00:00:00.000Z",
    salesOrderId: "so-1",
    orderCode: "PV-001",
    customerId: "c-1",
    customerName: "Cliente Alfa",
    canonicalSellerId: ANA,
    canonicalSellerName: "Ana",
    rawSellerId: 10,
    sellerResolutionStatus: "RESOLVED_BY_NOMUS_PERSON_ID",
    nfeNumber: "100",
    receivableId: 1001,
    receivableCode: "100",
    installmentNumber: 1,
    dueDate: "2026-12-20",
    nominalAmount: 1000,
    allocatedCommission: 30,
    sharePercent: 100,
    balanceReceivable: 1000,
    amountReceivedOnTitle: 0,
    paidToSellerAmount: 0,
    receipts: [],
    ...over,
  };
}

const receipt = (externalId: number, receiptDate: string, receivedAmount: number, coverageSource: "NOMUS_LEGACY" | "INDUSCOST_CLOSING" | "MANUAL_ADJUSTMENT" | null = null) => ({
  externalId,
  receiptDate,
  receivedAmount,
  coverageSource,
  coveredCommissionAmount: null,
});

function batch(over: Partial<Commission360BatchInput> = {}): Commission360BatchInput {
  return {
    batchId: "b-1",
    status: "PAID",
    paymentDate: "2026-10-25",
    periodStart: "2026-10-01",
    periodEnd: "2026-10-31",
    commissionPersonId: ANA,
    sellerName: "Ana",
    totalPaid: 100,
    items: [{ itemId: "i-1", status: "PAID", amountPaid: 100, receivableId: null }],
    ...over,
  };
}

function ledger(over: Partial<Commission360LedgerLineInput> = {}): Commission360LedgerLineInput {
  return {
    lineId: "l-1",
    closingId: "closing-2026-10",
    closingStatus: "CLOSED",
    year: 2026,
    month: 10,
    canonicalSellerId: ANA,
    rawSellerId: 10,
    sellerName: "Ana",
    releasedCommissionAmount: 100,
    commissionRecordId: null,
    inclusionType: "NORMAL",
    naturalYear: 2026,
    naturalMonth: 10,
    ...over,
  };
}

function facts(over: Partial<Commission360Facts> = {}): Commission360Facts {
  return { outlookLines: [], batches: [], legacyCoverages: [], ledgerLines: [], potentialOrders: [], receivables: [], ...over };
}

const query = (raw: Record<string, unknown> = {}) =>
  parseCommission360Query({ from: "2026-01", to: "2027-01", ...raw }, { dataScope: "global", nomusSellerId: null }, TODAY);

const month = (view: ReturnType<typeof buildCommission360View>, key: string) => view.months.find((m) => m.month === key);

describe("corte oficial — regras reaproveitadas do sistema", () => {
  it("recebimento: competência natural pelo receiptDate; Nomus e pré-corte são legado; ajuste manual fora", () => {
    assert.equal(classifyCommission360Receipt({ receiptDate: "2026-09-30", coverageSource: null }), "LEGADO_PRE_CORTE");
    assert.equal(classifyCommission360Receipt({ receiptDate: "2026-09-30", coverageSource: "INDUSCOST_CLOSING" }), "LEGADO_PRE_CORTE");
    assert.equal(classifyCommission360Receipt({ receiptDate: "2026-10-01", coverageSource: null }), "OFICIAL");
    assert.equal(classifyCommission360Receipt({ receiptDate: "2026-10-15", coverageSource: "NOMUS_LEGACY" }), "LEGADO_NOMUS");
    assert.equal(classifyCommission360Receipt({ receiptDate: "2026-10-15", coverageSource: "MANUAL_ADJUSTMENT" }), "AJUSTE_MANUAL");
  });

  it("linha de fechamento: NORMAL/LATE_CARRYOVER com natural ≥ 10/2026 é operacional; o resto é ajuste retroativo", () => {
    assert.equal(isCommission360OperationalLedgerLine(ledger()), true);
    assert.equal(isCommission360OperationalLedgerLine(ledger({ month: 11, inclusionType: "LATE_CARRYOVER", naturalMonth: 10 })), true);
    assert.equal(isCommission360OperationalLedgerLine(ledger({ inclusionType: "LEGACY_CARRYOVER", naturalMonth: 9 })), false);
    assert.equal(isCommission360OperationalLedgerLine(ledger({ inclusionType: "MANUAL_ADJUSTMENT" })), false);
    assert.equal(isCommission360OperationalLedgerLine(ledger({ inclusionType: "NORMAL", naturalMonth: 9 })), false);
  });

  it("lote: competência pelo período, nunca pela data de pagamento", () => {
    assert.deepEqual(classifyCommission360BatchCompetence(batch()), { official: true, reason: null });
    assert.equal(classifyCommission360BatchCompetence(batch({ periodStart: "2026-09-01", periodEnd: "2026-09-30" })).official, false);
    assert.match(classifyCommission360BatchCompetence(batch({ periodStart: "2026-09-15", periodEnd: "2026-10-15" })).reason!, /atravessa o corte/);
  });
});

describe("corte oficial — testes obrigatórios", () => {
  it("1. comissão Nomus de setembro/2026 não entra no gráfico oficial", () => {
    const view = buildCommission360View(
      facts({
        outlookLines: projectCommissionPortfolioOutlookLines(
          [fact({ balanceReceivable: 0, receipts: [receipt(1, "2026-09-20", 1000, "NOMUS_LEGACY")] })],
          TODAY
        ),
        legacyCoverages: [
          { coverageId: "cv-1", coverageSource: "NOMUS_LEGACY", coverageStatus: "COVERED", receiptExternalId: 1, receivableId: 1001, coveredYear: 2026, coveredMonth: 9, coveredCommissionAmount: 30, legacyImportId: "imp-09" },
        ],
      }),
      query(),
      TODAY
    );
    assert.equal(month(view, "2026-09")!.realized, null, "setembro não tem série histórica oficial");
    assert.equal(month(view, "2026-09")!.paidConfirmed, null);
    assert.ok(view.months.every((m) => (m.realized ?? 0) === 0 && (m.paidConfirmed ?? 0) === 0));
    assert.equal(view.cards.realizedAwaitingClosing, 0);
    assert.equal(view.legacySection.totals.nomusLegacyCovered, 30);
    assert.equal(view.legacySection.totals.legacyRealized, 30);
    assert.deepEqual(view.legacySection.byMonth, [{ month: "2026-09", label: "SET/26", nomusLegacyCovered: 30, legacyRealized: 30, retroactiveReleased: 0 }]);
  });

  it("2. comissão legado paga em novembro/2026 fica fora da série operacional e aparece separada", () => {
    const view = buildCommission360View(
      facts({
        batches: [
          batch({ batchId: "b-legado", paymentDate: "2026-11-10", periodStart: "2026-09-01", periodEnd: "2026-09-30" }),
          batch({ batchId: "b-cruza", paymentDate: "2026-11-12", periodStart: "2026-09-15", periodEnd: "2026-10-15", items: [{ itemId: "i-2", status: "PAID", amountPaid: 40, receivableId: null }] }),
        ],
      }),
      query({ section: "paid" }),
      TODAY
    );
    assert.equal(month(view, "2026-11")!.paidConfirmed, 0, "pagamento de competência legada não vira comissão de novembro");
    assert.equal(view.cards.paidConfirmed, 0);
    assert.equal(view.detail.payments!.length, 0);
    assert.deepEqual(view.bySeller.map((row) => row.paidConfirmed), []);
    assert.deepEqual(view.legacySection.payments.map((row) => [row.batchId, row.month, row.amountPaid]), [
      ["b-legado", "2026-11", 100],
      ["b-cruza", "2026-11", 40],
    ]);
    assert.equal(view.legacySection.totals.legacyPayments, 140);
    assert.match(view.legacySection.payments[0]!.reason, /anterior ao fechamento oficial/);
  });

  it("3. comissão oficial de outubro/2026 aparece normalmente", () => {
    const view = buildCommission360View(
      facts({
        outlookLines: projectCommissionPortfolioOutlookLines([fact({ balanceReceivable: 0, receipts: [receipt(1, "2026-10-10", 1000)] })], TODAY),
        batches: [batch()],
      }),
      query(),
      TODAY
    );
    assert.equal(month(view, "2026-10")!.realized, 30);
    assert.equal(month(view, "2026-10")!.paidConfirmed, 100);
    assert.equal(month(view, "2026-10")!.official, true);
    assert.equal(view.cards.realizedAwaitingClosing, 30);
    assert.equal(view.legacySection.totals.legacyRealized, 0);
  });

  it("4. recebimento parcial entre outubro e novembro: cada parcela no mês do recebimento real", () => {
    const view = buildCommission360View(
      facts({
        outlookLines: projectCommissionPortfolioOutlookLines(
          [fact({ balanceReceivable: 300, receipts: [receipt(1, "2026-10-20", 400), receipt(2, "2026-11-05", 300)] })],
          TODAY
        ),
      }),
      query(),
      TODAY
    );
    assert.equal(month(view, "2026-10")!.realized, 12);
    assert.equal(month(view, "2026-11")!.realized, 9);
    assert.equal(month(view, "2026-12")!.forecast, 9, "saldo de R$ 300 no vencimento");
  });

  it("4b. parcela de setembro do mesmo título fica no legado; a de outubro entra na série", () => {
    const view = buildCommission360View(
      facts({
        outlookLines: projectCommissionPortfolioOutlookLines(
          [fact({ balanceReceivable: 400, receipts: [receipt(1, "2026-09-25", 300, "NOMUS_LEGACY"), receipt(2, "2026-10-03", 300)] })],
          TODAY
        ),
      }),
      query(),
      TODAY
    );
    assert.equal(month(view, "2026-10")!.realized, 9);
    assert.equal(view.legacySection.byMonth.find((m) => m.month === "2026-09")!.legacyRealized, 9);
    assert.equal(view.cards.realizedAwaitingClosing, 9);
  });

  it("5. ajuste de competência anterior registrado depois não altera a série operacional", () => {
    const lines = projectCommissionPortfolioOutlookLines(
      [
        // Recebimento de 28/09 fechado no fechamento de 10/2026 (LEGACY_CARRYOVER).
        fact({ balanceReceivable: 0, receipts: [receipt(1, "2026-09-28", 1000, "INDUSCOST_CLOSING")] }),
        // Recebimento de 30/10 fechado só no fechamento de 11/2026 (LATE_CARRYOVER): continua outubro.
        fact({ scheduleId: "sch-2", receivableId: 1002, balanceReceivable: 0, receipts: [receipt(2, "2026-10-30", 1000, "INDUSCOST_CLOSING")] }),
      ],
      TODAY
    );
    const view = buildCommission360View(
      facts({
        outlookLines: lines,
        ledgerLines: [
          ledger({ lineId: "retro", inclusionType: "LEGACY_CARRYOVER", naturalMonth: 9, releasedCommissionAmount: 30 }),
          ledger({ lineId: "late", closingId: "closing-2026-11", month: 11, inclusionType: "LATE_CARRYOVER", naturalMonth: 10, releasedCommissionAmount: 30 }),
          ledger({ lineId: "manual", closingId: "closing-2026-11", month: 11, inclusionType: "MANUAL_ADJUSTMENT", naturalMonth: 11, releasedCommissionAmount: 5 }),
        ],
      }),
      query({ section: "realized" }),
      TODAY
    );
    assert.equal(month(view, "2026-10")!.realized, 30, "só o recebimento de 30/10; o de 28/09 não entra");
    assert.equal(month(view, "2026-11")!.realized, 0, "o fechamento de novembro não desloca o recebimento de outubro");
    assert.equal(view.legacySection.byMonth.find((m) => m.month === "2026-09")!.legacyRealized, 30);
    // Liberada: o LATE_CARRYOVER é operacional (novembro); o LEGACY_CARRYOVER e o ajuste manual não.
    assert.equal(view.cards.releasedNotPaid, 30);
    assert.equal(view.legacySection.totals.retroactiveReleased, 35);
    assert.equal(view.legacySection.totals.retroactiveNotPaid, 35);
    assert.deepEqual(
      view.legacySection.retroactiveLines.map((row) => [row.competence, row.naturalMonth, row.inclusionType, row.released]),
      [
        ["2026-10", "2026-09", "LEGACY_CARRYOVER", 30],
        ["2026-11", "2026-11", "MANUAL_ADJUSTMENT", 5],
      ]
    );
    const oct = view.detail.released!.find((row) => row.competence === "2026-10")!;
    assert.deepEqual([oct.releasedOperational, oct.releasedAdjustment, oct.releasedNotPaid, oct.adjustmentNotPaid], [0, 30, 0, 30]);
  });

  it("6. sem duplicidade entre previsão, realizado, liberado e pago", () => {
    const lines = projectCommissionPortfolioOutlookLines(
      [fact({ balanceReceivable: 400, receipts: [receipt(1, "2026-10-10", 600, "INDUSCOST_CLOSING")] })],
      TODAY
    );
    const view = buildCommission360View(
      facts({
        outlookLines: lines,
        ledgerLines: [ledger({ releasedCommissionAmount: 18 })],
        batches: [batch({ totalPaid: 18, items: [{ itemId: "i-1", status: "PAID", amountPaid: 18, receivableId: null }] })],
      }),
      query(),
      TODAY
    );
    const realized = view.months.reduce((sum, m) => sum + (m.realized ?? 0), 0);
    const forecast = view.months.reduce((sum, m) => sum + m.forecast, 0);
    const paid = view.months.reduce((sum, m) => sum + (m.paidConfirmed ?? 0), 0);
    assert.equal(realized, 18);
    assert.equal(forecast, 12);
    assert.ok(realized + forecast <= 30 + 0.001, "realizado + previsto nunca passa da comissão alocada");
    assert.equal(paid, 18);
    assert.equal(view.cards.forecastOnReceivables, forecast, "card = soma do gráfico");
    assert.equal(view.cards.paidConfirmed, paid, "card = soma do gráfico");
    assert.equal(view.cards.realizedAwaitingClosing, 0, "realizado já coberto não fica aguardando");
    assert.equal(view.cards.releasedNotPaid, 0, "liberado e pago não aparece como a pagar");
  });
});

describe("corte oficial — consistência entre gráfico, cards, vendedor e detalhe", () => {
  const all = facts({
    outlookLines: projectCommissionPortfolioOutlookLines(
      [
        fact({ balanceReceivable: 0, receipts: [receipt(1, "2026-10-10", 1000)] }),
        fact({ scheduleId: "sch-b", receivableId: 2001, canonicalSellerId: BRUNO, canonicalSellerName: "Bruno", rawSellerId: 20, balanceReceivable: 0, receipts: [receipt(2, "2026-09-10", 1000)] }),
        fact({ scheduleId: "sch-old", receivableId: 3001, dueDate: "2026-08-15", balanceReceivable: 1000 }),
      ],
      TODAY
    ),
    batches: [batch(), batch({ batchId: "b-bruno-legado", commissionPersonId: BRUNO, sellerName: "Bruno", periodStart: "2026-09-01", periodEnd: "2026-09-30", paymentDate: "2026-11-01" })],
  });

  it("filtro por vendedor aplica o mesmo corte ao gráfico, cards, tabela e seção legado", () => {
    const bruno = buildCommission360View(all, query({ sellerId: BRUNO }), TODAY);
    assert.ok(bruno.months.every((m) => (m.realized ?? 0) === 0 && (m.paidConfirmed ?? 0) === 0));
    assert.equal(bruno.cards.paidConfirmed, 0);
    assert.equal(bruno.cards.realizedAwaitingClosing, 0);
    assert.deepEqual(bruno.legacySection.bySeller.map((row) => [row.sellerName, row.legacyRealized, row.legacyPayments]), [["Bruno", 30, 100]]);
    const ana = buildCommission360View(all, query({ sellerId: ANA }), TODAY);
    assert.equal(month(ana, "2026-10")!.realized, 30);
    assert.equal(ana.cards.paidConfirmed, 100);
    assert.deepEqual(ana.bySeller.map((row) => [row.sellerName, row.paidConfirmed, row.realizedAwaitingClosing]), [["Ana", 100, 30]]);
    assert.equal(ana.legacySection.totals.legacyPayments, 0);
  });

  it("previsão de título vencido antes de 09/2026 fica fora da série e aparece no legado", () => {
    const view = buildCommission360View(all, query({ section: "forecast" }), TODAY);
    assert.equal(view.cards.forecastOnReceivables, 0);
    assert.equal(view.detail.forecast!.length, 0);
    assert.equal(view.legacySection.totals.forecastBeforeStart, 30);
    assert.equal(view.legacySection.totals.forecastBeforeStartCount, 1);
    assert.equal(view.months[0]!.month, "2026-09");
  });

  it("cards e soma do gráfico usam a mesma regra (pago e previsão)", () => {
    const view = buildCommission360View(all, query(), TODAY);
    assert.equal(view.cards.paidConfirmed, view.months.reduce((sum, m) => sum + (m.paidConfirmed ?? 0), 0));
    assert.equal(view.cards.forecastOnReceivables, view.months.reduce((sum, m) => sum + m.forecast, 0));
    assert.equal(view.series.officialStartMonth, "2026-10");
    assert.equal(view.series.forecastStartMonth, "2026-09");
  });
});

describe("liberada: pagamento parcial sobre parte operacional + ajuste retroativo", () => {
  it("sem pagamento: separa não paga operacional e ajuste não pago", () => {
    const { rows } = buildCommission360ReleasedNotPaid({
      ledgerLines: [ledger(), ledger({ lineId: "retro", inclusionType: "LEGACY_CARRYOVER", naturalMonth: 9, releasedCommissionAmount: 50 })],
      batches: [],
    });
    assert.deepEqual([rows[0]!.releasedOperational, rows[0]!.releasedAdjustment, rows[0]!.releasedNotPaid, rows[0]!.adjustmentNotPaid], [100, 50, 100, 50]);
  });

  it("pagamento parcial do fechamento com as duas partes em aberto: não é atribuído a nenhuma", () => {
    const { rows } = buildCommission360ReleasedNotPaid({
      ledgerLines: [ledger(), ledger({ lineId: "retro", inclusionType: "LEGACY_CARRYOVER", naturalMonth: 9, releasedCommissionAmount: 50 })],
      batches: [batch({ items: [{ itemId: "i-1", status: "PAID", amountPaid: 60, receivableId: null }] })],
    });
    assert.equal(rows[0]!.status, "PAGO_PARCIAL");
    assert.deepEqual([rows[0]!.releasedNotPaid, rows[0]!.adjustmentNotPaid, rows[0]!.unreconciledAmount], [0, 0, 90]);
  });

  it("pagamento parcial sem ajuste retroativo: abate só a parte operacional", () => {
    const { rows } = buildCommission360ReleasedNotPaid({
      ledgerLines: [ledger()],
      batches: [batch({ items: [{ itemId: "i-1", status: "PAID", amountPaid: 60, receivableId: null }] })],
    });
    assert.deepEqual([rows[0]!.releasedNotPaid, rows[0]!.adjustmentNotPaid, rows[0]!.unreconciledAmount], [40, 0, 0]);
  });
});

describe("lotes com valores mistos (operacional + ajuste retroativo)", () => {
  const closing = [ledger({ lineId: "op", releasedCommissionAmount: 100 }), ledger({ lineId: "retro", inclusionType: "LEGACY_CARRYOVER", naturalMonth: 9, releasedCommissionAmount: 50 })];
  const paidIn = (view: ReturnType<typeof buildCommission360View>) => view.months.reduce((sum, m) => sum + (m.paidConfirmed ?? 0), 0);

  it("um lote que quita o fechamento inteiro: só a parte operacional entra na série", () => {
    const view = buildCommission360View(
      facts({ ledgerLines: closing, batches: [batch({ paymentDate: "2026-11-05", items: [{ itemId: "i-1", status: "PAID", amountPaid: 150, receivableId: null }] })] }),
      query({ section: "paid" }),
      TODAY
    );
    assert.equal(month(view, "2026-11")!.paidConfirmed, 100);
    assert.equal(view.cards.paidConfirmed, 100);
    assert.deepEqual(view.legacySection.payments.map((p) => [p.batchId, p.amountPaid]), [["b-1", 50]]);
    assert.match(view.legacySection.payments[0]!.reason, /ajuste retroativo/);
    assert.equal(view.detail.payments![0]!.amountPaid, 100);
    assert.match(view.detail.payments![0]!.notes!, /só 100\.00 é comissão operacional/);
  });

  it("pagamento parcial de fechamento misto: nada é atribuído à série operacional", () => {
    const view = buildCommission360View(
      facts({ ledgerLines: closing, batches: [batch({ items: [{ itemId: "i-1", status: "PAID", amountPaid: 120, receivableId: null }] })] }),
      query(),
      TODAY
    );
    assert.equal(paidIn(view), 0);
    assert.deepEqual(view.legacySection.payments.map((p) => [p.amountPaid, /Valor misto/.test(p.reason)]), [[120, true]]);
  });

  it("dois lotes no mesmo fechamento misto: sem vínculo para separar, ambos ficam fora da série", () => {
    const view = buildCommission360View(
      facts({
        ledgerLines: closing,
        batches: [
          batch({ batchId: "b-1", items: [{ itemId: "i-1", status: "PAID", amountPaid: 100, receivableId: null }] }),
          batch({ batchId: "b-2", items: [{ itemId: "i-2", status: "PAID", amountPaid: 50, receivableId: null }] }),
        ],
      }),
      query(),
      TODAY
    );
    assert.equal(paidIn(view), 0);
    assert.equal(view.legacySection.totals.legacyPayments, 150);
  });

  it("vínculo por linha separa exatamente cada parte, mesmo em lote misto", () => {
    const view = buildCommission360View(
      facts({
        ledgerLines: [ledger({ lineId: "op", commissionRecordId: "rec-op" }), ledger({ lineId: "retro", inclusionType: "LEGACY_CARRYOVER", naturalMonth: 9, releasedCommissionAmount: 50, commissionRecordId: "rec-retro" })],
        batches: [
          batch({
            items: [
              { itemId: "i-op", status: "PAID", amountPaid: 100, receivableId: null, commissionRecordId: "rec-op" },
              { itemId: "i-retro", status: "PAID", amountPaid: 50, receivableId: null, commissionRecordId: "rec-retro" },
            ],
          }),
        ],
      }),
      query(),
      TODAY
    );
    assert.equal(paidIn(view), 100);
    assert.deepEqual(view.legacySection.payments.map((p) => p.amountPaid), [50]);
  });

  it("dois lotes num fechamento só operacional: o saldo é consumido uma vez; o excesso fica fora", () => {
    const view = buildCommission360View(
      facts({
        ledgerLines: [ledger()],
        batches: [
          batch({ batchId: "b-1", items: [{ itemId: "i-1", status: "PAID", amountPaid: 60, receivableId: null }] }),
          batch({ batchId: "b-2", items: [{ itemId: "i-2", status: "PAID", amountPaid: 60, receivableId: null }] }),
        ],
      }),
      query(),
      TODAY
    );
    assert.equal(paidIn(view), 100);
    assert.deepEqual(view.legacySection.payments.map((p) => [p.batchId, p.amountPaid]), [["b-2", 20]]);
  });

  it("lote de período oficial que atravessa meses com ajuste retroativo numa competência: fora da série", () => {
    const view = buildCommission360View(
      facts({ ledgerLines: closing, batches: [batch({ periodStart: "2026-10-01", periodEnd: "2026-11-30", paymentDate: "2026-12-01" })] }),
      query(),
      TODAY
    );
    assert.equal(paidIn(view), 0);
    assert.equal(view.legacySection.totals.legacyPayments, 100);
  });

  it("card, gráfico, tabela por vendedor e detalhe de pagamentos conciliam (com lote misto)", () => {
    const view = buildCommission360View(
      facts({
        ledgerLines: [...closing, ledger({ lineId: "bruno", canonicalSellerId: BRUNO, rawSellerId: 20, sellerName: "Bruno", releasedCommissionAmount: 80 })],
        batches: [
          batch({ items: [{ itemId: "i-1", status: "PAID", amountPaid: 150, receivableId: null }] }),
          batch({ batchId: "b-bruno", commissionPersonId: BRUNO, sellerName: "Bruno", items: [{ itemId: "i-b", status: "PAID", amountPaid: 80, receivableId: null }] }),
        ],
      }),
      query({ section: "paid" }),
      TODAY
    );
    const chart = paidIn(view);
    const sellers = view.bySeller.reduce((sum, row) => sum + row.paidConfirmed, 0);
    const detail = view.detail.payments!.reduce((sum, row) => sum + row.amountPaid, 0);
    assert.deepEqual([view.cards.paidConfirmed, chart, sellers, detail], [180, 180, 180, 180]);
    assert.equal(view.legacySection.totals.legacyPayments, 50);
    const ana = buildCommission360View(facts({ ledgerLines: closing, batches: [batch({ items: [{ itemId: "i-1", status: "PAID", amountPaid: 150, receivableId: null }] })] }), query({ sellerId: ANA }), TODAY);
    assert.deepEqual([ana.cards.paidConfirmed, paidIn(ana), ana.legacySection.totals.legacyPayments], [100, 100, 50]);
  });
});
