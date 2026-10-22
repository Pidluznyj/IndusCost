/**
 * Visão 360° de Comissões — regras puras (T01–T25, exceto os testes de banco/HTTP,
 * que estão em commission360View.server.test.ts).
 *
 * As linhas de previsão são geradas pelo motor OFICIAL da Previsão
 * (projectCommissionPortfolioOutlookLines): a Visão 360° nunca recalcula comissão.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCommissionPortfolioOutlook,
  projectCommissionPortfolioOutlookLines,
  type OutlookScheduleInput,
} from "./commissionPortfolioOutlook.js";
import {
  buildCommission360Diagnostic,
  buildCommission360Funnel,
  buildCommission360Paid,
  buildCommission360Potential,
  buildCommission360ReceivablesCsv,
  buildCommission360ReleasedNotPaid,
  buildCommission360View,
  classifyCommission360Receivable,
  parseCommission360Query,
  type Commission360BatchInput,
  type Commission360Facts,
  type Commission360LedgerLineInput,
  type Commission360PotentialOrderInput,
  type Commission360ReceivableInput,
  type Commission360SnapshotRef,
} from "./commission360View.js";
import { CommissionQueryParseError } from "./commissionQuery.js";

const TODAY = "2026-10-22";
const SELLER_A = "11111111-1111-4111-8111-111111111111";
const SELLER_B = "22222222-2222-4222-8222-222222222222";
const GLOBAL = { dataScope: "global" as const, nomusSellerId: null };

function fact(over: Partial<OutlookScheduleInput> = {}): OutlookScheduleInput {
  return {
    scheduleId: "sch-1",
    scheduleStatus: "ACTIVE",
    orderSnapshotStatus: "ACTIVE",
    scheduleCreatedAt: "2026-09-01T00:00:00.000Z",
    salesOrderId: "so-1",
    orderCode: "PV-001",
    customerId: "cust-1",
    customerName: "Cliente Alfa",
    canonicalSellerId: SELLER_A,
    canonicalSellerName: "Ana",
    rawSellerId: 10,
    sellerResolutionStatus: "RESOLVED_BY_NOMUS_PERSON_ID",
    nfeNumber: "100",
    receivableId: 1001,
    receivableCode: "100",
    installmentNumber: 1,
    dueDate: "2026-11-10",
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

function lines(...facts: OutlookScheduleInput[]) {
  return projectCommissionPortfolioOutlookLines(facts, TODAY);
}

function snap(over: Partial<Commission360SnapshotRef> = {}): Commission360SnapshotRef {
  return {
    id: "snap-1",
    status: "ACTIVE",
    salesOrderId: "so-1",
    nfeId: 5001,
    sourceHash: "hash-1",
    customerId: "cust-1",
    createdAt: "2026-09-01T00:00:00.000Z",
    totalFinalCommissionAmount: 60,
    itemStatuses: ["COMMISSIONABLE"],
    sellerResolutionStatus: "RESOLVED_BY_NOMUS_PERSON_ID",
    canonicalSellerId: SELLER_A,
    canonicalSellerName: "Ana",
    rawSellerId: 10,
    customerExcludedByActiveRule: false,
    ...over,
  };
}

function cr(over: Partial<Commission360ReceivableInput> = {}): Commission360ReceivableInput {
  return {
    receivableId: 1001,
    invoiceNumber: "100",
    sourceInvoiceId: 5001,
    dueDate: "2026-11-10",
    customerName: "Cliente Alfa",
    nominalAmount: 1000,
    openBalance: 1000,
    suspended: false,
    groupCompany: false,
    orderLinks: [{ salesOrderId: "so-1", orderCode: "PV-001", status: "SENT_TO_NOMUS", externalSellerId: 10 }],
    snapshots: [snap()],
    nfeReceivables: [{ receivableId: 1001, nominalAmount: 1000, dueDate: "2026-11-10", invoiceNumber: "100" }],
    outlookLines: [],
    ...over,
  };
}

function order(over: Partial<Commission360PotentialOrderInput> = {}): Commission360PotentialOrderInput {
  return {
    salesOrderId: "so-9",
    orderCode: "PV-009",
    orderStatus: "SENT_TO_NOMUS",
    saleDate: "2026-10-01",
    customerName: "Cliente Beta",
    canonicalSellerId: SELLER_A,
    sellerName: "Ana",
    rawSellerId: 10,
    sellerResolutionStatus: "RESOLVED_BY_NOMUS_PERSON_ID",
    customerExcludedByActiveRule: false,
    hasActiveSnapshot: true,
    items: [
      {
        salesOrderItemId: "it-1",
        productName: "Produto 1",
        snapshotFinalCommissions: [50],
        snapshotItemStatuses: ["COMMISSIONABLE"],
        flow: { orderedQuantity: 10, shipTargetQuantity: 10, invoicedQuantity: 0 },
      },
    ],
    ...over,
  };
}

function batch(over: Partial<Commission360BatchInput> = {}): Commission360BatchInput {
  return {
    batchId: "batch-1",
    status: "PAID",
    paymentDate: "2026-10-15",
    periodStart: "2026-10-01",
    periodEnd: "2026-10-31",
    commissionPersonId: SELLER_A,
    sellerName: "Ana",
    totalPaid: 100,
    items: [{ itemId: "item-1", status: "PAID", amountPaid: 100, receivableId: null }],
    ...over,
  };
}

function ledger(over: Partial<Commission360LedgerLineInput> = {}): Commission360LedgerLineInput {
  return {
    lineId: "line-1",
    closingId: "closing-10",
    closingStatus: "CLOSED",
    year: 2026,
    month: 10,
    canonicalSellerId: SELLER_A,
    rawSellerId: 10,
    sellerName: "Ana",
    releasedCommissionAmount: 100,
    commissionRecordId: null,
    ...over,
  };
}

function query(raw: Record<string, unknown> = {}, scope: { dataScope: "global" | "own"; nomusSellerId: number | null } = GLOBAL) {
  return parseCommission360Query({ from: "2026-01", to: "2026-12", ...raw }, scope, TODAY);
}

function facts(over: Partial<Commission360Facts> = {}): Commission360Facts {
  return { outlookLines: [], batches: [], legacyCoverages: [], ledgerLines: [], potentialOrders: [], receivables: [], ...over };
}

describe("Visão 360° — potencial em PVs (D)", () => {
  it("T01: PV sem CR mostra a comissão inteira como potencial pendente", () => {
    const [row] = buildCommission360Potential([order()]);
    assert.equal(row!.totalCommission, 50);
    assert.equal(row!.invoicedCommission, 0);
    assert.equal(row!.pendingCommission, 50);
    assert.equal(row!.status, "PENDENTE_FATURAMENTO");
  });

  it("T02: PV parcialmente faturado separa parte faturada e pendente pela quantidade do item", () => {
    const [row] = buildCommission360Potential([
      order({
        items: [
          {
            salesOrderItemId: "it-1",
            productName: "Produto 1",
            snapshotFinalCommissions: [50],
            snapshotItemStatuses: ["COMMISSIONABLE"],
            flow: { orderedQuantity: 10, shipTargetQuantity: 10, invoicedQuantity: 4 },
          },
          {
            salesOrderItemId: "it-2",
            productName: "Produto 2 (taxa diferente)",
            snapshotFinalCommissions: [9],
            snapshotItemStatuses: ["COMMISSIONABLE"],
            flow: { orderedQuantity: 3, shipTargetQuantity: 3, invoicedQuantity: 0 },
          },
        ],
      }),
    ]);
    // Item 1: 50 × 6/10 = 30 pendente; item 2: 9 × 3/3 = 9. Nunca rateio pelo valor total do pedido.
    assert.equal(row!.items[0]!.invoicedCommission, 20);
    assert.equal(row!.items[0]!.pendingCommission, 30);
    assert.equal(row!.items[1]!.pendingCommission, 9);
    assert.equal(row!.pendingCommission, 39);
    assert.equal(row!.totalCommission, 59);
  });

  it("T03: pedido totalmente faturado não tem potencial e sai do detalhe", () => {
    const fullyInvoiced = order({
      items: [
        {
          salesOrderItemId: "it-1",
          productName: "Produto 1",
          snapshotFinalCommissions: [50],
          snapshotItemStatuses: ["COMMISSIONABLE"],
          flow: { orderedQuantity: 10, shipTargetQuantity: 10, invoicedQuantity: 10 },
        },
      ],
    });
    const [row] = buildCommission360Potential([fullyInvoiced]);
    assert.equal(row!.pendingCommission, 0);
    assert.equal(row!.status, "TOTALMENTE_FATURADO");
    const view = buildCommission360View(facts({ potentialOrders: [fullyInvoiced] }), query({ section: "potential" }), TODAY);
    assert.equal(view.detail.totalRows, 0);
    assert.equal(view.cards.potentialOnOrders, 0);
  });

  it("corte/cancelamento parcial: a quantidade cortada não vira potencial", () => {
    const [row] = buildCommission360Potential([
      order({
        items: [
          {
            salesOrderItemId: "it-1",
            productName: "Produto 1",
            snapshotFinalCommissions: [50],
            snapshotItemStatuses: ["COMMISSIONABLE"],
            flow: { orderedQuantity: 10, shipTargetQuantity: 6, invoicedQuantity: 4 },
          },
        ],
      }),
    ]);
    assert.equal(row!.pendingCommission, 10);
    assert.equal(row!.invoicedCommission, 20);
  });
});

describe("Visão 360° — CRs e motor oficial da Previsão (C)", () => {
  it("T04: CR aberto com schedule válido usa exatamente a previsão do motor oficial", () => {
    const official = lines(fact());
    const row = classifyCommission360Receivable(cr({ outlookLines: official }));
    assert.equal(row.status, "COBERTO_FUTURA");
    assert.equal(row.forecastCommission, 30);
    const outlook = buildCommissionPortfolioOutlook([fact()], {
      fromMonth: "2026-01",
      toMonth: "2026-12",
      canonicalSellerId: null,
      customerId: null,
      orderCode: null,
      status: null,
      page: 1,
      pageSize: 25,
      ownNomusSellerId: null,
      sellerLocked: false,
    }, TODAY);
    const view = buildCommission360View(facts({ outlookLines: official }), query(), TODAY);
    assert.equal(view.cards.forecastOnReceivables, outlook.cards.forecast);
    assert.equal(view.months.find((m) => m.month === "2026-11")!.forecast, 30);
  });

  it("T05: CR parcialmente recebido: futura sobre o saldo, realizada aguardando fechamento", () => {
    const official = lines(
      fact({
        balanceReceivable: 600,
        receipts: [{ externalId: 1, receiptDate: "2026-10-05", receivedAmount: 400, coverageSource: null, coveredCommissionAmount: null }],
      })
    );
    const row = classifyCommission360Receivable(cr({ openBalance: 600, outlookLines: official }));
    assert.equal(row.status, "COBERTO_FUTURA");
    assert.equal(row.forecastCommission, 18);
    assert.equal(row.realizedCommission, 12);
    const view = buildCommission360View(facts({ outlookLines: official }), query(), TODAY);
    assert.equal(view.cards.realizedAwaitingClosing, 12);
    assert.equal(view.cards.forecastOnReceivables, 18);
  });

  it("T06: CR integralmente recebido não tem comissão futura", () => {
    const official = lines(
      fact({
        balanceReceivable: 0,
        receipts: [{ externalId: 2, receiptDate: "2026-10-05", receivedAmount: 1000, coverageSource: "INDUSCOST_CLOSING", coveredCommissionAmount: 30 }],
      })
    );
    const row = classifyCommission360Receivable(cr({ openBalance: 0, outlookLines: official }));
    assert.equal(row.status, "COBERTO_REALIZADA");
    assert.equal(row.forecastCommission, 0);
    assert.equal(row.realizedCommission, 30);
  });

  it("T07: CR sem schedule aparece na conciliação com potencial NÃO confirmado e fora da previsão", () => {
    const row = classifyCommission360Receivable(
      cr({
        nfeReceivables: [
          { receivableId: 1001, nominalAmount: 1000, dueDate: "2026-11-10", invoiceNumber: "100" },
          { receivableId: 1002, nominalAmount: 1000, dueDate: "2026-12-10", invoiceNumber: "100" },
        ],
      })
    );
    assert.equal(row.status, "SEM_SCHEDULE");
    assert.equal(row.group, "SEM_COBERTURA");
    assert.equal(row.potentialUncoveredCommission, 30);
    assert.equal(row.forecastCommission, 0);
    const view = buildCommission360View(facts({ receivables: [cr()] }), query(), TODAY);
    assert.equal(view.cards.forecastOnReceivables, 0);
    assert.equal(view.cards.uncoveredReceivablesCount, 1);
    assert.equal(view.cards.uncoveredReceivablesBalance, 1000);
  });

  it("T08: snapshot substituído e schedule de versão substituída", () => {
    const onlySuperseded = classifyCommission360Receivable(cr({ snapshots: [snap({ status: "SUPERSEDED" })] }));
    assert.equal(onlySuperseded.status, "SNAPSHOT_SUBSTITUIDO");
    const orphanSchedule = classifyCommission360Receivable(
      cr({ outlookLines: lines(fact({ orderSnapshotStatus: "SUPERSEDED" })) })
    );
    assert.equal(orphanSchedule.status, "SCHEDULE_INCONSISTENTE");
    assert.equal(orphanSchedule.forecastCommission, 0);
  });

  it("T09: cliente institucional / exceção por cliente / empresa do grupo não têm comissão", () => {
    assert.equal(classifyCommission360Receivable(cr({ snapshots: [snap({ customerExcludedByActiveRule: true })] })).status, "CLIENTE_EXCLUIDO");
    assert.equal(classifyCommission360Receivable(cr({ groupCompany: true })).status, "EMPRESA_GRUPO");
    const excludedLine = classifyCommission360Receivable(cr({ outlookLines: lines(fact({ customerExcludedByActiveRule: true })) }));
    assert.equal(excludedLine.status, "CLIENTE_EXCLUIDO");
    assert.equal(excludedLine.forecastCommission, 0);
    const [potential] = buildCommission360Potential([order({ customerExcludedByActiveRule: true })]);
    assert.equal(potential!.pendingCommission, 0);
    assert.equal(potential!.status, "CLIENTE_EXCLUIDO");
  });

  it("T10: vendedor não resolvido não recebe estimativa", () => {
    const row = classifyCommission360Receivable(cr({ snapshots: [snap({ sellerResolutionStatus: "SELLER_UNRESOLVED" })] }));
    assert.equal(row.status, "VENDEDOR_NAO_COMISSIONAVEL");
    assert.equal(row.potentialUncoveredCommission, null);
    const [potential] = buildCommission360Potential([order({ sellerResolutionStatus: "NO_SELLER" })]);
    assert.equal(potential!.items[0]!.pendingCommission, null);
    assert.equal(potential!.toReconcileItemCount, 1);
  });

  it("T11: pedido cancelado não tem comissão nem potencial", () => {
    const row = classifyCommission360Receivable(
      cr({ orderLinks: [{ salesOrderId: "so-1", orderCode: "PV-001", status: "CANCELLED", externalSellerId: 10 }] })
    );
    assert.equal(row.status, "PEDIDO_CANCELADO");
    const [potential] = buildCommission360Potential([order({ orderStatus: "CANCELLED" })]);
    assert.equal(potential!.pendingCommission, 0);
    assert.equal(potential!.status, "PEDIDO_CANCELADO");
  });

  it("T12: título baixado sem evento de recebimento vira divergência, nunca realizado ou previsto", () => {
    const official = lines(fact({ balanceReceivable: 0 }));
    const row = classifyCommission360Receivable(cr({ openBalance: 0, outlookLines: official }));
    assert.equal(row.status, "DIVERGENCIA_ALOCACAO");
    assert.equal(row.realizedCommission, 0);
    assert.equal(row.forecastCommission, 0);
    const view = buildCommission360View(facts({ outlookLines: official }), query(), TODAY);
    assert.equal(view.cards.realizedAwaitingClosing, 0);
    assert.equal(view.cards.forecastOnReceivables, 0);
  });
});

describe("Visão 360° — pagamentos, liberação e legado (A/B)", () => {
  it("T13: liberada em fechamento CLOSED e não paga; REPROCESSED e competência pré-cutover não contam", () => {
    const { rows } = buildCommission360ReleasedNotPaid({
      ledgerLines: [
        ledger(),
        ledger({ lineId: "line-old", closingId: "closing-10-old", closingStatus: "REPROCESSED" }),
        ledger({ lineId: "line-09", closingId: "closing-09", month: 9 }),
      ],
      batches: [],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.released, 100);
    assert.equal(rows[0]!.releasedNotPaid, 100);
    assert.equal(rows[0]!.status, "NAO_PAGO");
  });

  it("T14: comissão efetivamente paga entra pela data do pagamento e abate a liberada", () => {
    const view = buildCommission360View(facts({ batches: [batch()], ledgerLines: [ledger()] }), query({ section: "paid" }), TODAY);
    assert.equal(view.cards.paidConfirmed, 100);
    assert.equal(view.cards.paidConfirmedCount, 1);
    assert.equal(view.months.find((m) => m.month === "2026-10")!.paidConfirmed, 100);
    assert.equal(view.cards.releasedNotPaid, 0);
    assert.equal(view.detail.payments![0]!.paymentDate, "2026-10-15");
    // Lote ainda não pago não é pagamento.
    const draft = buildCommission360View(facts({ batches: [batch({ status: "APPROVED" })] }), query(), TODAY);
    assert.equal(draft.cards.paidConfirmed, 0);
  });

  it("T15: legado Nomus fica separado como histórico sem confirmação de desembolso", () => {
    const view = buildCommission360View(
      facts({
        legacyCoverages: [
          {
            coverageId: "cov-1",
            coverageSource: "NOMUS_LEGACY",
            coverageStatus: "COVERED",
            receiptExternalId: 9,
            receivableId: 1001,
            coveredYear: 2026,
            coveredMonth: 8,
            coveredCommissionAmount: 40,
            legacyImportId: "imp-1",
          },
        ],
      }),
      query(),
      TODAY
    );
    assert.equal(view.cards.legacyUnconfirmed, 40);
    assert.equal(view.cards.paidConfirmed, 0);
    assert.equal(view.months.find((m) => m.month === "2026-08"), undefined, "legado não entra no gráfico principal");
    assert.equal(view.legacySection.totals.nomusLegacyCovered, 40);
    assert.deepEqual(view.legacySection.byMonth.map((m) => [m.month, m.nomusLegacyCovered]), [["2026-08", 40]]);
  });

  it("T16: o mesmo pagamento em duas fontes (lote + relatório Nomus, item repetido) conta uma vez", () => {
    const paidBatch = batch({
      items: [
        { itemId: "item-1", status: "PAID", amountPaid: 100, receivableId: 1001 },
        { itemId: "item-1", status: "PAID", amountPaid: 100, receivableId: 1001 },
      ],
    });
    const result = buildCommission360Paid({
      batches: [paidBatch, paidBatch],
      legacyCoverages: [
        {
          coverageId: "cov-1",
          coverageSource: "NOMUS_LEGACY",
          coverageStatus: "COVERED",
          receiptExternalId: 9,
          receivableId: 1001,
          coveredYear: 2026,
          coveredMonth: 10,
          coveredCommissionAmount: 100,
          legacyImportId: "imp-1",
        },
        {
          coverageId: "cov-2",
          coverageSource: "NOMUS_LEGACY",
          coverageStatus: "COVERED",
          receiptExternalId: 9,
          receivableId: 1001,
          coveredYear: 2026,
          coveredMonth: 10,
          coveredCommissionAmount: 100,
          legacyImportId: "imp-2",
        },
        {
          coverageId: "cov-3",
          coverageSource: "INDUSCOST_CLOSING",
          coverageStatus: "COVERED",
          receiptExternalId: 10,
          receivableId: 1001,
          coveredYear: 2026,
          coveredMonth: 10,
          coveredCommissionAmount: 100,
          legacyImportId: null,
        },
      ],
      sellerByReceivable: new Map([[1001, { key: SELLER_A, name: "Ana" }]]),
    });
    assert.equal(result.payments.length, 1);
    assert.equal(result.confirmedByMonth.get("2026-10")!.amount, 100);
    assert.equal(result.legacy.length, 1);
    assert.equal(result.legacy[0]!.supersededByConfirmedPayment, true);
    assert.equal(result.legacyByMonth.size, 0);
  });

  it("lote PAID sem data de pagamento e com total divergente vira anomalia, não mês inventado", () => {
    const result = buildCommission360Paid({
      batches: [batch({ paymentDate: null, totalPaid: 90 })],
      legacyCoverages: [],
      sellerByReceivable: new Map(),
    });
    assert.equal(result.confirmedByMonth.size, 0);
    assert.equal(result.anomalies.length, 1);
    assert.match(result.anomalies[0]!, /sem data de pagamento/);
  });

  it("B2: lote cobrindo duas competências não é dividido nem atribuído: tudo fica não conciliado", () => {
    const { rows, unmatchedPayments } = buildCommission360ReleasedNotPaid({
      ledgerLines: [ledger(), ledger({ lineId: "line-11", closingId: "closing-11", month: 11 })],
      batches: [batch({ periodStart: "2026-10-01", periodEnd: "2026-11-30" })],
    });
    assert.deepEqual(rows.map((row) => [row.competence, row.paid, row.releasedNotPaid, row.unreconciledAmount, row.status]), [
      ["2026-10", 0, 0, 100, "NAO_CONCILIADO"],
      ["2026-11", 0, 0, 100, "NAO_CONCILIADO"],
    ]);
    assert.equal(unmatchedPayments.length, 1);
    assert.equal(unmatchedPayments[0]!.amount, 100);
    assert.match(unmatchedPayments[0]!.reason, /mais de uma competência/);
  });

  it("B2: pagamento parcial com lote da competência exata", () => {
    const { rows } = buildCommission360ReleasedNotPaid({
      ledgerLines: [ledger({ releasedCommissionAmount: 300 })],
      batches: [batch({ totalPaid: 120, items: [{ itemId: "i-1", status: "PAID", amountPaid: 120, receivableId: null }] })],
    });
    assert.equal(rows[0]!.paidByCompetence, 120);
    assert.equal(rows[0]!.releasedNotPaid, 180);
    assert.equal(rows[0]!.status, "PAGO_PARCIAL");
  });

  it("B2: lote de competência anterior ao cutover não abate a competência oficial", () => {
    const { rows, unmatchedPayments } = buildCommission360ReleasedNotPaid({
      ledgerLines: [ledger()],
      batches: [batch({ periodStart: "2026-09-01", periodEnd: "2026-09-30", paymentDate: "2026-10-05" })],
    });
    assert.equal(rows[0]!.status, "NAO_PAGO");
    assert.equal(rows[0]!.releasedNotPaid, 100);
    assert.match(unmatchedPayments[0]!.reason, /anterior ao fechamento oficial/);
  });

  it("B2: reprocessamento — só o CLOSED novo conta e recebe o pagamento da competência", () => {
    const { rows } = buildCommission360ReleasedNotPaid({
      ledgerLines: [
        ledger({ lineId: "old", closingId: "closing-10-v1", closingStatus: "REPROCESSED", releasedCommissionAmount: 100 }),
        ledger({ lineId: "new", closingId: "closing-10-v2", releasedCommissionAmount: 130 }),
      ],
      batches: [batch()],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.closingId, "closing-10-v2");
    assert.equal(rows[0]!.released, 130);
    assert.equal(rows[0]!.paid, 100);
    assert.equal(rows[0]!.releasedNotPaid, 30);
  });

  it("B2: vários lotes na mesma competência somam; competências diferentes do mesmo vendedor ficam separadas", () => {
    const { rows, unmatchedPayments } = buildCommission360ReleasedNotPaid({
      ledgerLines: [ledger({ releasedCommissionAmount: 200 }), ledger({ lineId: "l-11", closingId: "closing-11", month: 11, releasedCommissionAmount: 50 })],
      batches: [
        batch({ batchId: "b-1", items: [{ itemId: "i-1", status: "PAID", amountPaid: 120, receivableId: null }] }),
        batch({ batchId: "b-2", items: [{ itemId: "i-2", status: "PAID", amountPaid: 80, receivableId: null }] }),
        batch({ batchId: "b-3", periodStart: "2026-11-01", periodEnd: "2026-11-30", items: [{ itemId: "i-3", status: "PAID", amountPaid: 50, receivableId: null }] }),
      ],
    });
    assert.deepEqual(rows.map((row) => [row.competence, row.paid, row.status, row.matchedBatchIds]), [
      ["2026-10", 200, "PAGO", ["b-1", "b-2"]],
      ["2026-11", 50, "PAGO", ["b-3"]],
    ]);
    assert.equal(unmatchedPayments.length, 0);
  });

  it("B2: vínculo por linha (mesmo CommissionRecord) vale mesmo com período do lote amplo", () => {
    const { rows, unmatchedPayments } = buildCommission360ReleasedNotPaid({
      ledgerLines: [ledger({ commissionRecordId: "rec-1" })],
      batches: [
        batch({
          periodStart: "2026-08-01",
          periodEnd: "2026-12-31",
          items: [{ itemId: "i-1", status: "PAID", amountPaid: 100, receivableId: null, commissionRecordId: "rec-1" }],
        }),
      ],
    });
    assert.equal(rows[0]!.paidByLine, 100);
    assert.equal(rows[0]!.status, "PAGO");
    assert.equal(unmatchedPayments.length, 0);
  });

  it("B2: pagamento acima do liberado e lote de outro vendedor não são atribuídos ao vendedor errado", () => {
    const { rows, unmatchedPayments } = buildCommission360ReleasedNotPaid({
      ledgerLines: [ledger({ releasedCommissionAmount: 60 })],
      batches: [batch(), batch({ batchId: "b-bruno", commissionPersonId: SELLER_B, sellerName: "Bruno", items: [{ itemId: "i-b", status: "PAID", amountPaid: 70, receivableId: null }] })],
    });
    assert.equal(rows[0]!.status, "PAGO_ACIMA_DO_LIBERADO");
    assert.equal(rows[0]!.overpaidAmount, 40);
    assert.equal(rows[0]!.releasedNotPaid, 0);
    assert.equal(unmatchedPayments.length, 1);
    assert.equal(unmatchedPayments[0]!.batchId, "b-bruno");
  });

  it("B2: dois fechamentos CLOSED na mesma competência e vendedor (anomalia) → lote não é atribuído", () => {
    const { rows, unmatchedPayments } = buildCommission360ReleasedNotPaid({
      ledgerLines: [ledger({ canonicalSellerId: SELLER_A }), ledger({ lineId: "x", closingId: "closing-10-b", rawSellerId: 99, canonicalSellerId: SELLER_A })],
      batches: [batch()],
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.released, 200);
    assert.equal(rows[0]!.paid, 0);
    assert.equal(rows[0]!.status, "NAO_CONCILIADO");
    assert.equal(rows[0]!.unreconciledAmount, 200);
    assert.match(unmatchedPayments[0]!.reason, /mais de um fechamento CLOSED/);
  });

  it("B2 no payload: cards separam não paga, não conciliada e lotes sem vínculo", () => {
    const view = buildCommission360View(
      facts({
        ledgerLines: [ledger(), ledger({ lineId: "l-11", closingId: "closing-11", month: 11 })],
        batches: [batch({ batchId: "b-wide", periodStart: "2026-11-01", periodEnd: "2026-12-31" })],
      }),
      query({ section: "realized" }),
      TODAY
    );
    assert.equal(view.cards.releasedNotPaid, 100);
    assert.equal(view.cards.releasedUnreconciled, 100);
    assert.equal(view.cards.unmatchedPaymentsCount, 1);
    assert.equal(view.cards.unmatchedPaymentsAmount, 100);
    assert.equal(view.detail.unmatchedPayments!.length, 1);
  });

  it("T17: recebimentos em competências diferentes ficam no mês de cada receiptDate", () => {
    const official = lines(
      fact({
        balanceReceivable: 500,
        receipts: [
          { externalId: 1, receiptDate: "2026-08-20", receivedAmount: 300, coverageSource: null, coveredCommissionAmount: null },
          { externalId: 2, receiptDate: "2026-09-10", receivedAmount: 200, coverageSource: null, coveredCommissionAmount: null },
        ],
      })
    );
    const view = buildCommission360View(facts({ outlookLines: official }), query(), TODAY);
    // Agosto e setembro são competência natural do Nomus: ficam no legado, cada um no seu mês.
    assert.equal(view.months.find((m) => m.month === "2026-08"), undefined);
    assert.equal(view.months.find((m) => m.month === "2026-09")!.realized, null);
    assert.deepEqual(view.legacySection.byMonth.map((m) => [m.month, m.legacyRealized]), [
      ["2026-08", 9],
      ["2026-09", 6],
    ]);
    assert.equal(view.months.find((m) => m.month === "2026-11")!.forecast, 15);
  });
});

describe("Visão 360° — diagnóstico de novembro/dezembro de 2026", () => {
  const rows = [
    classifyCommission360Receivable(cr({ outlookLines: lines(fact()) })),
    classifyCommission360Receivable(cr({ receivableId: 1002, dueDate: "2026-11-20", snapshots: [] })),
    classifyCommission360Receivable(
      cr({
        receivableId: 2001,
        dueDate: "2026-12-05",
        openBalance: 2000,
        nominalAmount: 2000,
        nfeReceivables: [{ receivableId: 2001, nominalAmount: 2000, dueDate: "2026-12-05", invoiceNumber: "200" }],
      })
    ),
    classifyCommission360Receivable(cr({ receivableId: 2002, dueDate: "2026-12-15", groupCompany: true })),
  ];

  it("T18: CR de novembro/2026 entra na coluna de novembro", () => {
    const [nov] = buildCommission360Diagnostic(rows);
    assert.equal(nov!.month, "2026-11");
    assert.equal(nov!.crCount, 2);
    assert.equal(nov!.openBalance, 2000);
    assert.equal(nov!.coveredBalance, 1000);
    assert.equal(nov!.uncoveredBalance, 1000);
    assert.equal(nov!.forecastCommission, 30);
  });

  it("T19: CR de dezembro/2026 entra na coluna de dezembro e o total soma as duas", () => {
    const [nov, dec, total] = buildCommission360Diagnostic(rows);
    assert.equal(dec!.crCount, 2);
    assert.equal(dec!.uncoveredBalance, 2000);
    assert.equal(dec!.excludedBalance, 1000);
    assert.equal(dec!.potentialUncoveredCommission, 60);
    assert.equal(total!.crCount, nov!.crCount + dec!.crCount);
    assert.equal(total!.openBalance, nov!.openBalance + dec!.openBalance);
    assert.equal(total!.eligibleBalance, nov!.eligibleBalance + dec!.eligibleBalance);
  });

  it("funil: operacionais = excluídos + cobertos + diferenças", () => {
    const funnel = buildCommission360Funnel(rows);
    assert.equal(funnel.operationalCount, 4);
    assert.equal(funnel.coveredCount + funnel.differenceCount + 1, funnel.operationalCount);
    assert.equal(funnel.forecastCommission, 30);
  });
});

describe("Visão 360° — escopo, filtros e conciliação", () => {
  it("T20 (regra pura): vendedor de escopo próprio não vê dados de outro vendedor", () => {
    const own = query({ sellerId: SELLER_B }, { dataScope: "own", nomusSellerId: 10 });
    assert.equal(own.canonicalSellerId, null, "sellerId é ignorado no escopo próprio");
    assert.equal(own.sellerLocked, true);
    const official = lines(
      fact(),
      fact({ scheduleId: "sch-2", receivableId: 3001, canonicalSellerId: SELLER_B, canonicalSellerName: "Bruno", rawSellerId: 20 })
    );
    const view = buildCommission360View(
      facts({
        outlookLines: official,
        potentialOrders: [order(), order({ salesOrderId: "so-b", canonicalSellerId: SELLER_B, rawSellerId: 20 })],
        receivables: [
          cr({ outlookLines: official.filter((l) => l.receivableId === 1001) }),
          cr({
            receivableId: 3001,
            orderLinks: [{ salesOrderId: "so-b", orderCode: "PV-B", status: "SENT_TO_NOMUS", externalSellerId: 20 }],
            snapshots: [snap({ salesOrderId: "so-b", rawSellerId: 20, canonicalSellerId: SELLER_B })],
            outlookLines: official.filter((l) => l.receivableId === 3001),
          }),
          cr({ receivableId: 4001, sourceInvoiceId: null, orderLinks: [], snapshots: [] }),
        ],
      }),
      own,
      TODAY
    );
    assert.equal(view.cards.forecastOnReceivables, 30);
    assert.equal(view.cards.potentialOnOrders, 50);
    assert.deepEqual(view.detail.receivables!.map((row) => row.receivableId), [1001]);
    assert.ok(view.bySeller.every((row) => row.sellerName !== "Bruno"));
  });

  it("T22: filtros, paginação e validação de entrada", () => {
    const receivables = [cr(), cr({ receivableId: 1002, customerName: "Cliente Gama", dueDate: "2026-11-12" })];
    const page1 = buildCommission360View(facts({ receivables }), query({ pageSize: 1 }), TODAY);
    assert.equal(page1.detail.totalRows, 2);
    assert.equal(page1.detail.receivables!.length, 1);
    const page2 = buildCommission360View(facts({ receivables }), query({ pageSize: 1, page: 2 }), TODAY);
    assert.equal(page2.detail.receivables![0]!.receivableId, 1002);
    const byCustomer = buildCommission360View(facts({ receivables }), query({ customer: "gama" }), TODAY);
    assert.deepEqual(byCustomer.detail.receivables!.map((row) => row.receivableId), [1002]);
    const byStatus = buildCommission360View(facts({ receivables }), query({ crStatus: "COBERTO_FUTURA" }), TODAY);
    assert.equal(byStatus.detail.totalRows, 0);
    assert.throws(() => query({ from: "2026-13" }), CommissionQueryParseError);
    assert.throws(() => query({ from: "2026-12", to: "2026-01" }), CommissionQueryParseError);
    assert.throws(() => query({ from: "2020-01", to: "2026-12" }), CommissionQueryParseError);
    assert.throws(() => query({ sellerId: "x' OR 1=1" }), CommissionQueryParseError);
    assert.throws(() => query({ section: "pay" }), CommissionQueryParseError);
    assert.throws(() => query({ crStatus: "QUALQUER" }), CommissionQueryParseError);
    const defaults = parseCommission360Query({}, GLOBAL, TODAY);
    assert.equal(defaults.fromMonth, "2025-11");
    assert.equal(defaults.toMonth, "2027-10");
    assert.equal(defaults.pageSize, 50);
  });

  it("T23: conciliação detalhada por título com motivo e identificadores técnicos", () => {
    const row = classifyCommission360Receivable(cr({ outlookLines: lines(fact()) }));
    assert.equal(row.receivableId, 1001);
    assert.deepEqual(row.scheduleIds, ["sch-1"]);
    assert.deepEqual(row.snapshotIds, ["snap-1"]);
    assert.ok(row.reason.length > 10);
    const csv = buildCommission360ReceivablesCsv([row]);
    const [header, body] = csv.split("\n");
    assert.match(header!, /^Título;NF-e;Vencimento/);
    assert.match(body!, /^1001;100;2026-11-10;Cliente Alfa;PV-001;Ana;1000,00;1000,00;Coberto com comissão futura;/);
  });

  it("T24: registros incompletos não ganham valores fictícios", () => {
    const noNfe = classifyCommission360Receivable(cr({ sourceInvoiceId: null, orderLinks: [], snapshots: [] }));
    assert.equal(noNfe.status, "SEM_VINCULO_NFE");
    assert.equal(noNfe.potentialUncoveredCommission, null);
    const noPv = classifyCommission360Receivable(cr({ orderLinks: [] }));
    assert.equal(noPv.status, "SEM_VINCULO_PV");
    const ambiguous = classifyCommission360Receivable(
      cr({
        orderLinks: [
          { salesOrderId: "so-1", orderCode: "PV-001", status: "SENT_TO_NOMUS", externalSellerId: 10 },
          { salesOrderId: "so-2", orderCode: "PV-002", status: "SENT_TO_NOMUS", externalSellerId: 10 },
        ],
      })
    );
    assert.equal(ambiguous.status, "VINCULO_PV_AMBIGUO");
    assert.equal(ambiguous.potentialUncoveredCommission, null);
    const noItems = classifyCommission360Receivable(cr({ snapshots: [snap({ itemStatuses: [] })] }));
    assert.equal(noItems.status, "DADOS_INSUFICIENTES");
    assert.equal(noItems.potentialUncoveredCommission, null);
    const missing = classifyCommission360Receivable(cr({ openBalance: null }));
    assert.equal(missing.status, "FORA_UNIVERSO");
    assert.equal(classifyCommission360Receivable(cr({ suspended: true })).status, "FORA_UNIVERSO");
    const [noFlow, divergent] = buildCommission360Potential([
      order({
        items: [
          { salesOrderItemId: "it-1", productName: null, snapshotFinalCommissions: [50], snapshotItemStatuses: ["COMMISSIONABLE"], flow: null },
        ],
      }),
      order({
        salesOrderId: "so-10",
        items: [
          {
            salesOrderItemId: "it-1",
            productName: null,
            snapshotFinalCommissions: [50, 80],
            snapshotItemStatuses: ["COMMISSIONABLE", "COMMISSIONABLE"],
            flow: { orderedQuantity: 10, shipTargetQuantity: 10, invoicedQuantity: 0 },
          },
        ],
      }),
    ]);
    assert.equal(noFlow!.items[0]!.status, "SEM_SALDO_OPERACIONAL");
    assert.equal(noFlow!.items[0]!.pendingCommission, null);
    assert.equal(noFlow!.pendingCommission, 0);
    assert.equal(divergent!.items[0]!.status, "SNAPSHOTS_DIVERGENTES");
    assert.equal(divergent!.items[0]!.pendingCommission, null);
    const [noSnapshot] = buildCommission360Potential([order({ hasActiveSnapshot: false, items: [{ ...order().items[0]!, snapshotFinalCommissions: [] }] })]);
    assert.equal(noSnapshot!.status, "SEM_SNAPSHOT");
    assert.equal(noSnapshot!.items[0]!.totalCommission, null);
  });

  it("T25: potencial do PV e previsão do CR não se sobrepõem (parte faturada × não faturada)", () => {
    // Item: comissão 100, pedida 10, faturada 6 → 60 viraram CR (schedule), 40 seguem no PV.
    const potentialOrder = order({
      salesOrderId: "so-1",
      orderCode: "PV-001",
      items: [
        {
          salesOrderItemId: "it-1",
          productName: "Produto 1",
          snapshotFinalCommissions: [100],
          snapshotItemStatuses: ["COMMISSIONABLE"],
          flow: { orderedQuantity: 10, shipTargetQuantity: 10, invoicedQuantity: 6 },
        },
      ],
    });
    const official = lines(fact({ allocatedCommission: 60, nominalAmount: 6000, balanceReceivable: 6000 }));
    const view = buildCommission360View(facts({ outlookLines: official, potentialOrders: [potentialOrder] }), query(), TODAY);
    assert.equal(view.cards.potentialOnOrders, 40);
    assert.equal(view.cards.forecastOnReceivables, 60);
    assert.equal(view.cards.potentialOnOrders + view.cards.forecastOnReceivables, 100);
  });

  it("séries mensais mantêm cada natureza separada (nada é somado entre naturezas)", () => {
    const view = buildCommission360View(facts({ batches: [batch()], outlookLines: lines(fact()) }), query(), TODAY);
    const oct = view.months.find((m) => m.month === "2026-10")!;
    const nov = view.months.find((m) => m.month === "2026-11")!;
    assert.deepEqual([oct.paidConfirmed, oct.realized, oct.forecast, oct.official], [100, 0, 0, true]);
    assert.deepEqual([nov.paidConfirmed, nov.realized, nov.forecast, nov.official], [0, 0, 30, true]);
    // Eixo começa no marco da Previsão (09/2026), não em janeiro: 09, 10, 11, 12.
    assert.deepEqual(view.months.map((m) => m.month), ["2026-09", "2026-10", "2026-11", "2026-12"]);
  });
});
