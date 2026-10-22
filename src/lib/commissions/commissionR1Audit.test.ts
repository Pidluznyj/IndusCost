/**
 * Auditoria R1 — testes sintéticos (1–11 da missão). Banco simulado; nenhum banco real.
 */
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { buildCommissionReceivableScheduleDrafts } from "./commissionReceivableScheduler.js";
import { createCommission360ReadOnlyPrisma } from "./commission360ReadOnlyGuard.js";
import {
  auditR1Order,
  buildR1ItemsCsv,
  buildR1MonthCsv,
  buildR1OrdersCsv,
  buildR1SellerCsv,
  buildR1TitlesCsv,
  summarizeR1Audit,
  type R1OrderInput,
  type R1SnapshotInput,
  type R1TitleInput,
} from "./commissionR1Audit.js";

const SELLER = "11111111-1111-4111-8111-111111111111";
const ITEM = "item-1";

function snapshot(over: Partial<R1SnapshotInput> = {}): R1SnapshotInput {
  return {
    id: "snap-a",
    status: "ACTIVE",
    nfeId: 7001,
    totalFinalCommissionAmount: 240,
    saleDate: "2026-06-15",
    canonicalSellerId: SELLER,
    canonicalSellerName: "Ana",
    rawSellerId: 42,
    items: [{ salesOrderItemId: ITEM, productName: "Produto 1", finalCommissionAmount: 240, commissionRatePercent: 2, marginPercent: 66.67, status: "COMMISSIONABLE" }],
    ...over,
  };
}

function title(over: Partial<R1TitleInput> = {}): R1TitleInput {
  return {
    scheduleId: "sch-a",
    scheduleStatus: "ACTIVE",
    snapshotId: "snap-a",
    snapshotStatus: "ACTIVE",
    receivableId: 9001,
    nfeId: 7001,
    nominalAmount: 4800,
    dueDate: "2026-11-20",
    scheduledCommissionAmount: 240,
    validInOutlook: true,
    outlookAllocated: 240,
    realizedCommission: 0,
    ...over,
  };
}

function order(over: Partial<R1OrderInput> = {}): R1OrderInput {
  return {
    salesOrderId: "so-1",
    orderCode: "PV-1001",
    orderStatus: "SENT_TO_NOMUS",
    customerName: "Cliente Alfa",
    nfes: [{ nfeId: 7001, number: "7001", status: 4 }],
    snapshots: [snapshot()],
    flows: [{ salesOrderItemId: ITEM, orderedQuantity: 1000, shipTargetQuantity: 1000, invoicedQuantity: 1000, requiresProduction: true }],
    titles: [title({ nominalAmount: 12000 })],
    releases: [],
    payments: [],
    ...over,
  };
}

/** Cenário duplicado com a alocação produzida pelo scheduler OFICIAL (um snapshot por NF-e). */
function duplicated(over: Partial<R1OrderInput> = {}): R1OrderInput {
  const draft = (snapshotId: string, nfeId: number, receivableId: number, nominal: number) =>
    buildCommissionReceivableScheduleDrafts({
      snapshot: { id: snapshotId, sourceHash: snapshotId, salesOrderId: "so-1", nfeId, customerId: "c", canonicalSellerId: SELLER, totalFinalCommissionAmount: 240, itemStatuses: ["COMMISSIONABLE"] },
      receivables: [{ receivableId, receivableCode: String(nfeId), installmentNumber: 1, receivableNominalAmount: nominal }],
    })[0]!;
  const a = draft("snap-a", 7001, 9001, 4800);
  const b = draft("snap-b", 7002, 9002, 7200);
  return order({
    nfes: [
      { nfeId: 7001, number: "7001", status: 4 },
      { nfeId: 7002, number: "7002", status: 4 },
    ],
    snapshots: [snapshot(), snapshot({ id: "snap-b", nfeId: 7002 })],
    titles: [
      title({ scheduledCommissionAmount: a.scheduledCommissionAmount, outlookAllocated: a.scheduledCommissionAmount }),
      title({ scheduleId: "sch-b", snapshotId: "snap-b", receivableId: 9002, nfeId: 7002, nominalAmount: 7200, scheduledCommissionAmount: b.scheduledCommissionAmount, outlookAllocated: b.scheduledCommissionAmount }),
    ],
    ...over,
  });
}

describe("Auditoria R1 — regras por pedido", () => {
  it("1. PV com uma NF-e, totalmente faturado: sem excesso", () => {
    const row = auditR1Order(order());
    assert.equal(row.orderCommission, 240);
    assert.equal(row.allocated, 240);
    assert.equal(row.overAllocation, 0);
    assert.equal(row.anticipation, 0);
    assert.equal(row.classification, "SEM_EXCESSO");
    assert.equal(row.needsReview, false);
    assert.equal(row.nfeCount, 1);
  });

  it("2. PV com duas NF-e e alocação duplicada pelo scheduler oficial: sobrealocação confirmada por título", () => {
    const row = auditR1Order(duplicated());
    assert.equal(row.activeSnapshotCount, 2);
    assert.equal(row.activeSnapshotsCommission, 480, "Σ snapshots vigentes mostra a duplicação");
    assert.equal(row.orderCommission, 240, "comissão original conta cada item uma vez");
    assert.equal(row.allocated, 480);
    assert.equal(row.overAllocation, 240);
    assert.equal(row.classification, "SOBREALOCACAO_CONFIRMADA");
    assert.deepEqual(row.titles.map((t) => [t.receivableId, t.allocated, t.attributable, t.excess]), [
      [9001, 240, 96, 144],
      [9002, 240, 144, 96],
    ]);
  });

  it("3. PV parcialmente faturado: antecipação (não confirmada como sobrealocação)", () => {
    const row = auditR1Order(order({ flows: [{ salesOrderItemId: ITEM, orderedQuantity: 1000, shipTargetQuantity: 1000, invoicedQuantity: 400, requiresProduction: true }], titles: [title()] }));
    assert.equal(row.fullyInvoiced, false);
    assert.equal(row.invoicedCommission, 96);
    assert.equal(row.overAllocation, 0);
    assert.equal(row.anticipation, 144);
    assert.equal(row.classification, "ANTECIPACAO_FATURAMENTO_PARCIAL");
    assert.equal(row.needsReview, true);
  });

  it("4. NF-e cancelada: schedule válido na NF-e cancelada é suspeita; cancelada substituída sem schedule válido não é", () => {
    const withValidSchedule = auditR1Order(
      duplicated({ nfes: [{ nfeId: 7001, number: "7001", status: 7 }, { nfeId: 7002, number: "7002", status: 4 }], snapshots: [snapshot({ id: "snap-b", nfeId: 7002 })] })
    );
    assert.equal(withValidSchedule.cancelledNfeCount, 1);
    assert.ok(withValidSchedule.reasons.some((reason) => /NF-e cancelada/.test(reason)));
    assert.ok(withValidSchedule.reasons.some((reason) => /Schedule válido em título de NF-e cancelada/.test(reason)));
    const replaced = auditR1Order(
      order({
        nfes: [{ nfeId: 7000, number: "7000", status: 7 }, { nfeId: 7001, number: "7001", status: 4 }],
        snapshots: [snapshot({ id: "snap-old", nfeId: 7000, status: "SUPERSEDED" }), snapshot()],
      })
    );
    assert.equal(replaced.classification, "SEM_EXCESSO");
    assert.ok(replaced.reasons.some((reason) => /possível substituição/.test(reason)));
  });

  it("5. snapshot substituído não é somado; schedule de versão substituída não conta", () => {
    const row = auditR1Order(
      order({
        snapshots: [snapshot({ id: "snap-old", status: "SUPERSEDED", items: [{ ...snapshot().items[0]!, finalCommissionAmount: 300 }] }), snapshot()],
        titles: [
          title({ scheduleId: "sch-old", snapshotId: "snap-old", snapshotStatus: "SUPERSEDED", validInOutlook: false, outlookAllocated: 300, nominalAmount: 12000 }),
          title({ nominalAmount: 12000 }),
        ],
      })
    );
    assert.equal(row.supersededSnapshotCount, 1);
    assert.equal(row.orderCommission, 240);
    assert.equal(row.activeSnapshotsCommission, 240);
    assert.equal(row.allocated, 240);
    assert.equal(row.classification, "SEM_EXCESSO");
  });

  it("6. comissão parcialmente recebida: excesso realizado na proporção do título", () => {
    const base = duplicated();
    base.titles[0] = { ...base.titles[0]!, realizedCommission: 120 };
    const row = auditR1Order(base);
    assert.equal(row.realized, 120);
    assert.equal(row.titles[0]!.realizedExcess, 72, "120 × 144/240");
    assert.equal(row.excessRealized, 72);
  });

  it("7. fechada e não paga: excesso liberado sem pagamento", () => {
    const row = auditR1Order(
      duplicated({ releases: [{ lineId: "l-1", receivableId: 9001, closingId: "closing-10", competence: "2026-10", releasedCommissionAmount: 240, commissionRecordId: null }] })
    );
    assert.equal(row.released, 240);
    assert.equal(row.excessReleased, 144);
    assert.equal(row.paidProven, 0);
    assert.equal(row.excessPaidProven, 0);
    assert.equal(row.paymentNotAttributable, false);
  });

  it("8. paga com vínculo comprovado (título do CommissionPaymentSchedule ou mesmo CommissionRecord)", () => {
    const viaSchedule = auditR1Order(
      duplicated({
        releases: [{ lineId: "l-1", receivableId: 9001, closingId: "c", competence: "2026-10", releasedCommissionAmount: 240, commissionRecordId: null }],
        payments: [{ itemId: "pi-1", batchId: "b-1", paymentDate: "2026-11-10", amountPaid: 240, receivableId: 9001, commissionRecordId: "rec-x" }],
      })
    );
    assert.equal(viaSchedule.paidProven, 240);
    assert.equal(viaSchedule.excessPaidProven, 144);
    const viaRecord = auditR1Order(
      duplicated({
        releases: [{ lineId: "l-2", receivableId: 9002, closingId: "c", competence: "2026-10", releasedCommissionAmount: 240, commissionRecordId: "rec-9" }],
        payments: [{ itemId: "pi-2", batchId: "b-2", paymentDate: "2026-11-10", amountPaid: 240, receivableId: null, commissionRecordId: "rec-9" }],
      })
    );
    assert.equal(viaRecord.titles[1]!.paidProven, 240);
    assert.equal(viaRecord.excessPaidProven, 96);
  });

  it("9. lote pago sem vínculo ao PV: 'Pagamento não atribuível ao PV', sem valor estimado", () => {
    const row = auditR1Order(
      duplicated({ releases: [{ lineId: "l-1", receivableId: 9001, closingId: "c", competence: "2026-10", releasedCommissionAmount: 240, commissionRecordId: null }] }),
      [{ batchId: "b-ana", commissionPersonId: SELLER, periodStart: "2026-10-01", periodEnd: "2026-10-31" }]
    );
    assert.equal(row.paymentNotAttributable, true);
    assert.equal(row.paidProven, 0);
    assert.equal(row.excessPaidProven, 0);
    assert.ok(row.reasons.some((reason) => /Pagamento não atribuível ao PV/.test(reason)));
    const summary = summarizeR1Audit([row]);
    assert.equal(summary.totals.ordersPaymentNotAttributable, 1);
    assert.equal(summary.totals.excessPaidProven, 0);
  });

  it("10. itens com percentuais e margens diferentes: comissão e faturado por item, nunca pelo total", () => {
    const row = auditR1Order(
      order({
        snapshots: [
          snapshot({
            totalFinalCommissionAmount: 320,
            items: [
              { salesOrderItemId: ITEM, productName: "Produto 1", finalCommissionAmount: 240, commissionRatePercent: 2, marginPercent: 66.67, status: "COMMISSIONABLE" },
              { salesOrderItemId: "item-2", productName: "Produto 2", finalCommissionAmount: 80, commissionRatePercent: 4, marginPercent: 80, status: "COMMISSIONABLE" },
            ],
          }),
        ],
        flows: [
          { salesOrderItemId: ITEM, orderedQuantity: 1000, shipTargetQuantity: 1000, invoicedQuantity: 1000, requiresProduction: true },
          { salesOrderItemId: "item-2", orderedQuantity: 10, shipTargetQuantity: 10, invoicedQuantity: 0, requiresProduction: false },
        ],
        titles: [title({ outlookAllocated: 320, scheduledCommissionAmount: 320, nominalAmount: 12000 })],
      })
    );
    assert.equal(row.distinctRates, 2);
    assert.equal(row.stockFulfilledItems, 1);
    assert.equal(row.orderCommission, 320);
    assert.equal(row.invoicedCommission, 240);
    assert.equal(row.anticipation, 80);
    assert.deepEqual(row.items.map((item) => [item.salesOrderItemId, item.ratePercent, item.invoicedCommission]), [
      [ITEM, 2, 240],
      ["item-2", 4, 0],
    ]);
  });

  it("snapshots vigentes com valores diferentes para o mesmo item: suspeita, sem excesso inventado", () => {
    const row = auditR1Order(duplicated({ snapshots: [snapshot(), snapshot({ id: "snap-b", nfeId: 7002, items: [{ ...snapshot().items[0]!, finalCommissionAmount: 250 }] })] }));
    assert.equal(row.orderCommission, null);
    assert.equal(row.overAllocation, null);
    assert.equal(row.classification, "SUSPEITA");
  });
});

describe("Auditoria R1 — consolidado e CSV", () => {
  const rows = [
    auditR1Order(duplicated({ releases: [{ lineId: "l-1", receivableId: 9001, closingId: "c", competence: "2026-10", releasedCommissionAmount: 240, commissionRecordId: null }] })),
    auditR1Order(order({ salesOrderId: "so-2", orderCode: "PV-2", flows: [{ salesOrderItemId: ITEM, orderedQuantity: 1000, shipTargetQuantity: 1000, invoicedQuantity: 400, requiresProduction: null }], titles: [title()] })),
    auditR1Order(order({ salesOrderId: "so-3", orderCode: "=CMD()", customerName: "+Cliente" })),
  ];

  it("indicadores separam confirmados de suspeitas/antecipações e desdobram por vendedor e mês", () => {
    const summary = summarizeR1Audit(rows);
    assert.deepEqual(
      [summary.totals.ordersExamined, summary.totals.ordersWithMultipleNfes, summary.totals.ordersConfirmed, summary.totals.ordersAnticipation, summary.totals.ordersNeedingReview],
      [3, 1, 1, 1, 2]
    );
    assert.equal(summary.totals.confirmedOrderCommission, 240);
    assert.equal(summary.totals.confirmedAllocated, 480);
    assert.equal(summary.totals.confirmedOverAllocation, 240);
    assert.equal(summary.totals.excessReleased, 144);
    assert.equal(summary.totals.anticipationAmount, 144);
    assert.equal(summary.bySeller.length, 1);
    assert.equal(summary.byMonth[0]!.month, "2026-06");
    assert.match(buildR1MonthCsv(summary), /\nTotal;3;1;1;240,00;480,00;240,00;/);
    assert.match(buildR1SellerCsv(summary), /\nAna;3;/);
  });

  it("CSVs por pedido, título e item são seguros para Excel", () => {
    const orders = buildR1OrdersCsv(rows);
    assert.ok(orders.startsWith("﻿"));
    assert.match(orders, /;'=CMD\(\);/);
    assert.match(orders, /;'\+Cliente;/);
    assert.match(buildR1TitlesCsv(rows), /\nPV-1001;9001;7001;sch-a;snap-a;sim;4800,00;240,00;96,00;144,00;/);
    assert.match(buildR1ItemsCsv(rows), /\nPV-1001;item-1;Produto 1;240,00;2%;66\.67%;1000;1000;240,00;não/);
  });
});

// ---------------------------------------------------------------------------
// 11. Loader real por trás da trava, sobre banco simulado congelado
// ---------------------------------------------------------------------------

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const seller = { id: SELLER, name: "Ana", nomusPersonId: 42, type: "SELLER" };
const snapRow = (id: string, nfeId: number) => ({
  id,
  status: "ACTIVE",
  salesOrderId: "so-1",
  nfeId,
  totalFinalCommissionAmount: 240,
  saleDate: d("2026-06-15"),
  canonicalSellerId: SELLER,
  canonicalSellerName: "Ana",
  rawSellerId: 42,
  customerNameSnapshot: "Cliente Alfa",
  sellerResolutionStatus: "RESOLVED_BY_NOMUS_PERSON_ID",
  items: [{ salesOrderItemId: ITEM, productNameSnapshot: "Produto 1", finalCommissionAmount: 240, commissionRatePercent: 2, marginPercent: 66.67, status: "COMMISSIONABLE" }],
});
const scheduleRow = (id: string, snapshotId: string, receivableId: number, nfeId: number, nominal: number) => ({
  id,
  status: "ACTIVE",
  createdAt: d("2026-07-01"),
  salesOrderId: "so-1",
  receivableId,
  receivableCode: String(nfeId),
  installmentNumber: 1,
  nfeId,
  orderSnapshotId: snapshotId,
  customerId: "cust-1",
  canonicalSellerId: SELLER,
  receivableNominalAmount: nominal,
  receivableSharePercent: 100,
  scheduledCommissionAmount: 240,
  salesOrder: { orderCode: "PV-1001", externalSellerId: 42 },
  customer: { companyName: "Cliente Alfa", tradeName: "Cliente Alfa", taxId: "1", nomusExternalPersonId: 5 },
  canonicalSeller: seller,
  orderSnapshot: { status: "ACTIVE", saleDate: d("2026-06-15"), rawSellerId: 42, sellerResolutionStatus: "RESOLVED_BY_NOMUS_PERSON_ID", canonicalSellerName: "Ana", customerNameSnapshot: "Cliente Alfa" },
});
const arRow = (externalId: number, nfeId: number, amount: number) => ({
  externalId,
  sourceInvoiceId: nfeId,
  sourceInvoiceNumber: String(nfeId),
  dueDate: d("2026-11-20"),
  settlementDate: null,
  amountReceivable: amount,
  amountReceived: 0,
  balanceReceivable: amount,
  status: false,
  suspendCollection: false,
  sourcePresenceStatus: "PRESENT",
  personName: "Cliente Alfa",
  personCnpj: "11222333000144",
});

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

const seed = deepFreeze({
  commissionReceivableSchedule: [scheduleRow("sch-a", "snap-a", 9001, 7001, 4800), scheduleRow("sch-b", "snap-b", 9002, 7002, 7200)],
  salesOrder: [{ id: "so-1", orderCode: "PV-1001", status: "SENT_TO_NOMUS", Customer: { companyName: "Cliente Alfa Ltda", tradeName: "Cliente Alfa" } }],
  commissionOrderSnapshot: [snapRow("snap-a", 7001), snapRow("snap-b", 7002)],
  salesOrderNfeLink: [
    { salesOrderId: "so-1", nfeExternalId: 7001, nfeNumber: "7001", nfeStatus: 4 },
    { salesOrderId: "so-1", nfeExternalId: 7002, nfeNumber: "7002", nfeStatus: 4 },
  ],
  nomusNfe: [
    { externalId: 7001, status: 4 },
    { externalId: 7002, status: 4 },
  ],
  salesOrderItemFlowSnapshot: [{ salesOrderId: "so-1", salesOrderItemId: ITEM, orderedQuantity: 1000, shipTargetQuantity: 1000, invoicedQuantity: 1000, requiresProduction: true }],
  nomusAccountsReceivable: [arRow(9001, 7001, 4800), arRow(9002, 7002, 7200)],
  nomusReceivableReceipt: [{ externalId: 1, receivableExternalId: 9001, receiptDate: d("2026-10-10"), receivedAmount: 4800 }],
  commissionReceiptCoverage: [{ receiptExternalId: 1, receivableExternalId: 9001, coverageSource: "INDUSCOST_CLOSING", coveredCommissionAmount: 240, coverageStatus: "COVERED" }],
  commissionPaymentSchedule: [],
  commissionCustomerExclusionRule: [],
  commissionReceiptLedgerLine: [
    { id: "ll-1", nomusReceivableId: 9001, closingId: "closing-10", year: 2026, month: 10, releasedCommissionAmount: 240, commissionRecordId: null, closing: { status: "CLOSED" } },
  ],
  commissionPaymentBatchItem: [],
  commissionPaymentBatch: [{ id: "b-ana", status: "PAID", commissionPersonId: SELLER, periodStart: d("2026-10-01"), periodEnd: d("2026-10-31") }],
}) as Record<string, ReadonlyArray<Record<string, unknown>>>;
const fingerprint = JSON.stringify(seed);

function cmp(value: unknown): unknown {
  return value instanceof Date ? value.getTime() : value;
}

function matches(row: unknown, where: unknown): boolean {
  if (!where || typeof where !== "object") return true;
  return Object.entries(where as Record<string, unknown>).every(([key, cond]) => {
    if (cond === undefined) return true;
    if (key === "OR") return (cond as unknown[]).some((part) => matches(row, part));
    if (key === "AND") return (cond as unknown[]).every((part) => matches(row, part));
    const value = (row as Record<string, unknown>)[key];
    if (cond !== null && typeof cond === "object" && !(cond instanceof Date)) {
      const ops = cond as Record<string, unknown>;
      if ("in" in ops) return (ops.in as unknown[]).some((item) => cmp(item) === cmp(value));
      if ("not" in ops) return cmp(value) !== cmp(ops.not);
      if (value == null || typeof value !== "object") return false;
      return matches(value, cond);
    }
    return cmp(value) === cmp(cond);
  });
}

const writes: string[] = [];
const fake = new Proxy(
  {},
  {
    get(_target, model: string) {
      if (model === "then") return undefined;
      return new Proxy(
        {},
        {
          get(_t, method: string) {
            return async (args: { where?: unknown } = {}) => {
              if (method !== "findMany") {
                writes.push(`${model}.${method}`);
                throw new Error(`proibido: ${model}.${method}`);
              }
              return (seed[model] ?? []).filter((row) => matches(row, args.where));
            };
          },
        }
      );
    },
  }
);
const guard = createCommission360ReadOnlyPrisma(fake as Record<string, unknown>);
(globalThis as unknown as { prisma: unknown }).prisma = guard.client;

let loader: typeof import("./commissionR1Audit.server.js");
before(async () => {
  loader = await import("./commissionR1Audit.server.js");
});

describe("Auditoria R1 — 11. loader real, só leitura, base intacta", () => {
  it("monta o PV duplicado a partir dos registros e não altera nada", async () => {
    const ids = await loader.listR1CandidateOrderIds();
    assert.deepEqual(ids, ["so-1"]);
    const batches = await loader.loadR1SellerBatches();
    const [input] = await loader.loadR1OrderInputs(ids, "2026-10-22");
    const row = auditR1Order(input!, batches);
    assert.equal(row.classification, "SOBREALOCACAO_CONFIRMADA");
    assert.equal(row.orderCommission, 240);
    assert.equal(row.allocated, 480);
    assert.equal(row.overAllocation, 240);
    assert.equal(row.realized, 240, "recebimento integral do título A pelo motor da Previsão");
    assert.equal(row.excessRealized, 144);
    assert.equal(row.released, 240);
    assert.equal(row.excessReleased, 144);
    assert.equal(row.paidProven, 0);
    assert.equal(row.paymentNotAttributable, true, "há lote pago da vendedora em 10/2026, sem vínculo ao título");
    assert.deepEqual(writes, []);
    assert.deepEqual(guard.blocked, []);
    assert.equal(JSON.stringify(seed), fingerprint);
  });
});
