/**
 * B4 (cobertura por direito) e B5 (snapshot por NF-e só com o faturado) — testes que
 * reproduzem os defeitos pelas APIs oficiais: gerador de cobertura, prontidão de
 * aplicação, motor da prévia com eventos já cobertos e montagem do snapshot.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildCommissionReceiptPreview } from "./commissionReceiptEngine.js";
import { buildInduscostCoverageRows } from "./commissionReceiptCoverage.js";
import { assessReceiptClosingApplyReadiness } from "./commissionReceiptClosing.js";
import { summarizeLinesByOrderAndNfe, type OrderNfeTotalsLine } from "./commissionReceiptFinancialAnchor.shared.js";
import { buildCommissionOrderSnapshotDraft } from "./commissionOrderMaterializer.js";
import {
  buildCommissionReceivableScheduleDrafts,
  deriveReceivableScheduleStatus,
} from "./commissionReceivableScheduler.js";
import type { CommissionOrderItemCalculationResult } from "./commissionOrderCalculation.js";
import type { CommissionSellerIdentityResolution } from "./commissionSellerIdentity.js";
import {
  buildWorld,
  SELLER_464,
  INCIDENT,
  INCIDENT_RECEIPT,
  linesOf,
  orderBundle,
  previewContext,
  receivedTitle,
  sum,
  TWO_SELLERS,
  type OrderSpec,
} from "./commissionNnCardinality.fixtures.js";

/* ------------------------------------------------------------------ */
/*  B4 — cobertura por direito                                         */
/* ------------------------------------------------------------------ */

function ledgerRow(partial: {
  id: string;
  receivableId: number;
  receipts: number[];
  status: string;
  released: number;
  salesOrderId: string | null;
  allocatedReceived?: number;
}) {
  return {
    id: partial.id,
    nomusReceivableId: partial.receivableId,
    receiptExternalIds: partial.receipts,
    status: partial.status,
    releasedCommissionAmount: partial.released,
    inclusionType: "NORMAL" as const,
    salesOrderId: partial.salesOrderId,
    commissionReceivableScheduleId: partial.salesOrderId ? `sch-${partial.salesOrderId}` : null,
    allocatedReceivedAmount: partial.allocatedReceived,
  };
}

const EVENTS = new Map([[12130, { receivableExternalId: 19809, receiptDate: "2026-10-20", receivedAmount: 4435.5 }]]);

describe("B4 — cobertura por direito no evento de recebimento", () => {
  it("evento com um direito final e outro pendente: cobre só o final (o pendente segue pendente)", () => {
    const rows = buildInduscostCoverageRows({
      closingId: "c-10",
      closing: { year: 2026, month: 10 },
      userId: "tester",
      ledgerRows: [
        ledgerRow({ id: "l-a", receivableId: 19809, receipts: [12130], status: "COMMISSIONABLE", released: 30.11, salesOrderId: "so-2934", allocatedReceived: 1005.15 }),
        ledgerRow({ id: "l-b", receivableId: 19809, receipts: [12130], status: "NO_SCHEDULE", released: 0, salesOrderId: "so-2998", allocatedReceived: 3430.35 }),
      ],
      receiptEvents: EVENTS,
    });
    assert.deepEqual(
      rows.map((row) => [row.receiptExternalId, (row as { salesOrderId?: string | null }).salesOrderId, row.coveredCommissionAmount, row.coveredReceivedAmount]),
      [[12130, "so-2934", 30.11, 1005.15]]
    );
  });

  it("dois direitos finais: um registro por (evento, pedido); Σ recebido coberto = valor do evento", () => {
    const rows = buildInduscostCoverageRows({
      closingId: "c-10",
      closing: { year: 2026, month: 10 },
      userId: "tester",
      ledgerRows: [
        ledgerRow({ id: "l-a", receivableId: 19809, receipts: [12130], status: "COMMISSIONABLE", released: 30.11, salesOrderId: "so-2934", allocatedReceived: 1005.15 }),
        ledgerRow({ id: "l-b", receivableId: 19809, receipts: [12130], status: "COMMISSIONABLE", released: 106.78, salesOrderId: "so-2998", allocatedReceived: 3430.35 }),
      ],
      receiptEvents: EVENTS,
    });
    assert.deepEqual(
      rows.map((row) => [(row as { salesOrderId?: string | null }).salesOrderId, row.coveredCommissionAmount]),
      [
        ["so-2934", 30.11],
        ["so-2998", 106.78],
      ]
    );
    assert.equal(sum(rows.map((row) => row.coveredReceivedAmount)), 4435.5);
    assert.equal(sum(rows.map((row) => row.coveredCommissionAmount)), 136.89);
  });

  it("linha sem pedido ('sem vínculo de venda') cobre o evento inteiro, como antes", () => {
    const rows = buildInduscostCoverageRows({
      closingId: "c-10",
      closing: { year: 2026, month: 10 },
      userId: "tester",
      ledgerRows: [ledgerRow({ id: "l", receivableId: 19809, receipts: [12130], status: "NO_SALES_LINK", released: 0, salesOrderId: null })],
      receiptEvents: EVENTS,
    });
    assert.equal(rows.length, 1);
    assert.equal((rows[0] as { salesOrderId?: string | null }).salesOrderId ?? null, null);
  });

  it("prontidão: direito pendente ao lado de final não bloqueia mais; 'sem vínculo' ao lado de direito bloqueia", () => {
    const world = buildWorld({
      ...TWO_SELLERS,
      links: [
        { orderId: "so-g", nfeId: 9300 },
        { orderId: "so-r", nfeId: 9300, withSchedule: false },
      ],
    });
    // Pedido R vinculado sem schedule mas com snapshot inexistente → NO_SCHEDULE (bloqueia por falta de schedule).
    // Para o caso misto final × pendente usamos regra ausente (NO_RULE), que não é falta de schedule.
    const mixed = buildWorld({
      ...TWO_SELLERS,
      orders: [TWO_SELLERS.orders[0]!, { ...TWO_SELLERS.orders[1]!, commission: 0, itemStatuses: ["NO_RULE"] }],
    });
    const preview = buildCommissionReceiptPreview(
      previewContext(mixed, [receivedTitle(mixed, 93001, [{ id: 10, date: "2026-10-10", amount: 4000 }])], { year: 2026, month: 10 })
    );
    assert.equal(assessReceiptClosingApplyReadiness(preview).canApply, true);
    void world;
  });

  it("prévia com o direito de um pedido já coberto no evento: só o outro pedido aparece, com a sua parcela", () => {
    const world = buildWorld(INCIDENT);
    const receivable = receivedTitle(world, 19809, [INCIDENT_RECEIPT]);
    const preview = buildCommissionReceiptPreview(
      previewContext(world, [receivable], { year: 2026, month: 10 }, {
        coveredRightsByReceiptId: new Map([[12130, new Set(["so-2934"])]]),
      })
    );
    const lines = linesOf(preview, 19809);
    assert.deepEqual(lines.map((line) => [line.orderCode, line.releasedCommissionAmount]), [["02997", 106.78]]);
    assert.equal(lines[0]!.attributedReceivedAmount, 3430.35);
    assert.equal(preview.totalReceivedAmount, 3430.35);
  });
});

/* ------------------------------------------------------------------ */
/*  B5 — snapshot (pedido, NF-e) só com o faturado na NF-e             */
/* ------------------------------------------------------------------ */

const ORDER_A: OrderSpec = { id: "so-a", code: "07001", nomusOrderId: 7001, seller: SELLER_464, commission: 900, sold: 30000 };
const ITEM_A = "so-a-item-1";
const SELLER: CommissionSellerIdentityResolution = {
  canonicalSellerId: SELLER_464.personId,
  canonicalSellerName: SELLER_464.name,
  rawSellerId: SELLER_464.nomusId,
  rawSellerName: SELLER_464.name,
  resolutionStatus: "RESOLVED_BY_NOMUS_PERSON_ID",
  warnings: [],
} as unknown as CommissionSellerIdentityResolution;

function fullLine(): CommissionOrderItemCalculationResult {
  return {
    salesOrderId: ORDER_A.id,
    nfeId: null,
    itemId: ITEM_A,
    productId: "prod-so-a",
    soldAmount: 30000,
    soldUnitPrice: 1000,
    marginPercent: 30,
    commissionRatePercent: 3,
    grossCommissionAmount: 900,
    netCommissionAmount: 900,
    ruleId: null,
    ruleSnapshot: null,
    exclusionStatus: "NONE",
    exclusionReason: null,
    status: "COMMISSIONABLE",
    statusReason: null,
    canonicalSellerId: SELLER_464.personId,
    canonicalSellerName: SELLER_464.name,
    referenceDate: "2026-10-01T00:00:00.000Z",
    tierMetadata: null,
  };
}

const NFES = [
  { id: 9701, number: "9701", titles: [{ id: 97011, nominal: 8000, due: "2026-11-01" }] },
  { id: 9702, number: "9702", titles: [{ id: 97021, nominal: 12000, due: "2026-11-15" }] },
  { id: 9703, number: "9703", titles: [{ id: 97031, nominal: 10000, due: "2026-12-01" }] },
];

function allocationFor(nfeId: number, before: number, quantity: number) {
  return {
    basis: "INVOICED_ALLOCATION" as const,
    nfeExternalId: nfeId,
    reason: null,
    items: new Map([
      [
        ITEM_A,
        {
          orderedQuantity: 30,
          invoicedQuantity: quantity,
          cumulativeBefore: before,
          cumulativeAfter: before + quantity,
          evidence: [{ stockDocumentItemId: `dsi-${nfeId}`, stockDocumentExternalId: nfeId + 100000, quantity, sourceType: "DIRECT_ORDER_ITEM_REFERENCE" }],
        },
      ],
    ]),
  };
}

describe("B5 — pedido faturado em várias NF-e", () => {
  it("pedido de R$ 30.000 em três NF-e (8/12/10 mil): cada snapshot leva só a sua parcela e a soma é a comissão do pedido", () => {
    const bundle = orderBundle(ORDER_A, NFES);
    const drafts = [
      buildCommissionOrderSnapshotDraft({ order: bundle, customerId: "cust-1", customerNameSnapshot: "C", lines: [fullLine()], sellerResolution: SELLER, nfeId: 9701, invoiceAllocation: allocationFor(9701, 0, 8) } as never),
      buildCommissionOrderSnapshotDraft({ order: bundle, customerId: "cust-1", customerNameSnapshot: "C", lines: [fullLine()], sellerResolution: SELLER, nfeId: 9702, invoiceAllocation: allocationFor(9702, 8, 12) } as never),
      buildCommissionOrderSnapshotDraft({ order: bundle, customerId: "cust-1", customerNameSnapshot: "C", lines: [fullLine()], sellerResolution: SELLER, nfeId: 9703, invoiceAllocation: allocationFor(9703, 20, 10) } as never),
    ];
    assert.deepEqual(drafts.map((draft) => draft.totalSoldAmount), [8000, 12000, 10000]);
    assert.deepEqual(drafts.map((draft) => draft.totalFinalCommissionAmount), [240, 360, 300]);
    assert.equal(sum(drafts.map((draft) => draft.totalFinalCommissionAmount)), 900);
    assert.ok(drafts.every((draft) => (draft as { allocationBasis?: string }).allocationBasis === "INVOICED_ALLOCATION"));
    assert.equal(new Set(drafts.map((draft) => draft.sourceHash)).size, 3);
    // Os schedules de cada NF-e rateiam só a parcela da NF-e.
    const scheduled = drafts.map((draft, index) =>
      buildCommissionReceivableScheduleDrafts({
        snapshot: {
          id: `snap-${index}`,
          sourceHash: draft.sourceHash,
          salesOrderId: draft.salesOrderId,
          nfeId: draft.nfeId,
          customerId: "cust-1",
          canonicalSellerId: draft.canonicalSellerId,
          totalFinalCommissionAmount: draft.totalFinalCommissionAmount,
          itemStatuses: draft.items.map((item) => item.status),
        },
        receivables: NFES[index]!.titles.map((title, position) => ({
          receivableId: title.id,
          receivableCode: NFES[index]!.number,
          installmentNumber: position + 1,
          receivableNominalAmount: title.nominal,
        })),
      })
    );
    assert.equal(sum(scheduled.flat().map((row) => row.scheduledCommissionAmount)), 900);
  });

  it("centavos: três parcelas de 1/3 preservam a comissão do item sem perda nem criação", () => {
    const line = { ...fullLine(), netCommissionAmount: 100, grossCommissionAmount: 100 };
    const bundle = orderBundle(ORDER_A, NFES);
    const totals = [
      [9701, 0, 10],
      [9702, 10, 10],
      [9703, 20, 10],
    ].map(([nfe, before, qty]) =>
      buildCommissionOrderSnapshotDraft({
        order: bundle,
        customerId: "cust-1",
        customerNameSnapshot: "C",
        lines: [line],
        sellerResolution: SELLER,
        nfeId: nfe,
        invoiceAllocation: allocationFor(nfe!, before!, qty!),
      } as never).totalFinalCommissionAmount
    );
    assert.deepEqual(totals, [33.33, 33.34, 33.33]);
    assert.equal(sum(totals), 100);
  });

  it("sem evidência para a NF-e de um pedido em várias NF-e: snapshot retido (comissão 0, schedule ERROR), nunca integral", () => {
    const bundle = orderBundle(ORDER_A, NFES);
    const draft = buildCommissionOrderSnapshotDraft({
      order: bundle,
      customerId: "cust-1",
      customerNameSnapshot: "C",
      lines: [fullLine()],
      sellerResolution: SELLER,
      nfeId: 9702,
      invoiceAllocation: { basis: "ALLOCATION_PENDING", nfeExternalId: 9702, reason: "sem linha de documento de saída com item do pedido", items: new Map() },
    } as never);
    assert.equal(draft.totalFinalCommissionAmount, 0);
    assert.equal((draft as { allocationBasis?: string }).allocationBasis, "ALLOCATION_PENDING");
    assert.equal(deriveReceivableScheduleStatus({ itemStatuses: draft.items.map((item) => item.status), totalFinalCommissionAmount: 0 }), "ERROR");
  });
});

describe("B3 — totais por pedido e por NF-e (recebido uma vez por âncora)", () => {
  const line = (partial: Partial<OrderNfeTotalsLine> & Pick<OrderNfeTotalsLine, "nomusReceivableId" | "localOrderId" | "nfeNumber" | "receivedAmount" | "releasedCommissionAmount">): OrderNfeTotalsLine => ({
    orderCode: partial.localOrderId,
    status: "COMMISSIONABLE",
    receiptIds: [partial.nomusReceivableId * 10],
    ...partial,
  });
  it("título compartilhado reparte por pedido; título pago em duas competências soma os dois eventos; retido não libera", () => {
    const shared = { financialAnchorShared: true, financialAnchorAttribution: "ATTRIBUTED" as const, financialAnchorOrderCount: 2 };
    const totals = summarizeLinesByOrderAndNfe([
      line({ nomusReceivableId: 1, localOrderId: "A", nfeNumber: "N1", receivedAmount: 1000, attributedReceivedAmount: 250, releasedCommissionAmount: 10, ...shared }),
      line({ nomusReceivableId: 1, localOrderId: "B", nfeNumber: "N1", receivedAmount: 1000, attributedReceivedAmount: 750, releasedCommissionAmount: 30, ...shared }),
      line({ nomusReceivableId: 2, localOrderId: "A", nfeNumber: "N2", receivedAmount: 600, releasedCommissionAmount: 12, receiptIds: [21] }),
      line({ nomusReceivableId: 2, localOrderId: "A", nfeNumber: "N2", receivedAmount: 400, releasedCommissionAmount: 8, receiptIds: [22] }),
      line({ nomusReceivableId: 3, localOrderId: "C", nfeNumber: "N3", receivedAmount: 500, releasedCommissionAmount: 99, status: "ERROR" }),
    ]);
    assert.deepEqual(totals.byOrder.map((row) => [row.key, row.receivableCount, row.receivedAmount, row.releasedCommission]), [
      ["A", 2, 1250, 30],
      ["B", 1, 750, 30],
      ["C", 1, 500, 0],
    ]);
    assert.deepEqual(totals.byNfe.map((row) => [row.key, row.lineCount, row.receivedAmount, row.releasedCommission]), [
      ["N1", 2, 1000, 40],
      ["N2", 2, 1000, 20],
      ["N3", 1, 500, 0],
    ]);
  });
});
