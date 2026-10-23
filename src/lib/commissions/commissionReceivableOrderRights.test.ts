/**
 * Regras puras do direito por pedido no título (N:N): seleção do schedule
 * vigente, classificação do vínculo, guarda R1, atribuição da âncora financeira
 * e guarda de cobertura. Complementa commissionNnCardinality.test.ts, que
 * exercita o motor, o fechamento e a cobertura de ponta a ponta.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  attributeFinancialAnchorAmount,
  detectOrdersOverAllocatedAcrossNfes,
  findReceiptRightConflicts,
  resolveOrderAttributionWeight,
  resolveReceivableOrderRights,
  selectVigentScheduleForOrder,
  type ReceivableRightScheduleInput,
  type VigentOrderSnapshotFact,
} from "./commissionReceivableOrderRights.js";
import { isCoverageFinalLineStatus } from "./commissionReceiptCoverage.shared.js";
import { indexAllOrderBundlesByNfeId } from "./commissionSalesOrderNfeLinkResolution.js";
import { resolveOutlookPaidToSellerAmount } from "./commissionPortfolioOutlook.js";
import { auditCommissionScheduleConsistency } from "./commissionScheduleConsistencyAudit.js";
import {
  attributedReceivedAmountOf,
  sumReceivedForLineGroup,
} from "./commissionReceiptFinancialAnchor.shared.js";
import type { CommissionOrderSourceBundle } from "./commission-types.js";

function schedule(partial: Partial<ReceivableRightScheduleInput> & Pick<ReceivableRightScheduleInput, "id" | "salesOrderId">): ReceivableRightScheduleInput {
  return {
    orderSnapshotId: `snap-${partial.salesOrderId}`,
    orderCode: partial.salesOrderId.toUpperCase(),
    nfeId: 100,
    scheduleStatus: "ACTIVE",
    orderSnapshotStatus: "ACTIVE",
    orderSnapshotSoldAmount: 1000,
    ...partial,
  };
}

function bundle(
  localOrderId: string,
  nfes: Array<{ id: number; cancelled?: boolean; output?: boolean }>,
  items: Array<{ id: string; net: number }> = [{ id: `${localOrderId}-i1`, net: 1000 }]
): CommissionOrderSourceBundle {
  const linkedNfes = nfes.map((nfe) => ({
    nfeExternalId: nfe.id,
    nfeNumber: String(nfe.id),
    nfeStatus: nfe.cancelled ? 7 : 4,
    tipoOperacao: nfe.output === false ? 0 : 1,
    dataProcessamento: null,
    nfeValue: 0,
    isAuthorized: !nfe.cancelled,
    isCancelled: nfe.cancelled === true,
    isOutputOperation: nfe.output !== false,
    nomusNfeLocalId: null,
  }));
  return {
    localOrderId,
    nomusOrderId: null,
    orderCode: localOrderId.toUpperCase(),
    issueDate: new Date("2026-09-01"),
    status: "CONFIRMED",
    paymentTerms: null,
    paymentMethod: null,
    companyExternalId: null,
    customerExternalId: null,
    customerName: null,
    seller: { nomusSellerId: 464, responsibleName: "VENDEDORA SINTÉTICA 464" },
    representative: { nomusRepresentativeId: null, name: null },
    items: items.map((item) => ({
      localItemId: item.id,
      localProductId: `p-${item.id}`,
      nomusOrderItemId: null,
      nomusProductId: null,
      productCode: item.id,
      productName: item.id,
      quantity: 1,
      unitPrice: item.net,
      discount: 0,
      surcharge: 0,
      itemNetAmount: item.net,
    })),
    forecastInstallments: [],
    linkedNfes,
    authorizedOutputNfes: linkedNfes.filter((nfe) => nfe.isAuthorized),
    outputDocumentsByNfeId: new Map(),
    receivablesByNfeId: new Map(),
  } as CommissionOrderSourceBundle;
}

function fact(partial: Partial<VigentOrderSnapshotFact> & Pick<VigentOrderSnapshotFact, "snapshotId" | "nfeId">): VigentOrderSnapshotFact {
  return {
    totalSoldAmount: 1000,
    totalFinalCommissionAmount: 100,
    itemStatuses: ["COMMISSIONABLE"],
    items: [],
    ...partial,
  };
}

describe("seleção do schedule vigente por pedido", () => {
  it("ACTIVE vence; versão substituída nunca entra", () => {
    const result = selectVigentScheduleForOrder([
      schedule({ id: "old", salesOrderId: "a", orderSnapshotStatus: "SUPERSEDED" }),
      schedule({ id: "stale", salesOrderId: "a", scheduleStatus: "STALE" }),
      schedule({ id: "vigente", salesOrderId: "a" }),
    ]);
    assert.equal(result.schedule?.id, "vigente");
    assert.deepEqual(result.duplicates, []);
  });

  it("dois schedules vivos do mesmo pedido = duplicidade (escolha determinística)", () => {
    const result = selectVigentScheduleForOrder([
      schedule({ id: "z", salesOrderId: "a", orderSnapshotId: "s2" }),
      schedule({ id: "b", salesOrderId: "a", orderSnapshotId: "s1" }),
    ]);
    assert.equal(result.schedule?.id, "b");
    assert.deepEqual(result.duplicates.map((row) => row.id), ["z"]);
  });

  it("só linhas STALE da versão vigente: devolve a primeira (vira STALE_SCHEDULE no motor)", () => {
    const result = selectVigentScheduleForOrder([schedule({ id: "s", salesOrderId: "a", scheduleStatus: "STALE" })]);
    assert.equal(result.schedule?.id, "s");
  });
});

describe("classificação do direito de cada pedido no título", () => {
  const linked = [bundle("a", [{ id: 100 }]), bundle("b", [{ id: 100 }])];

  it("N pedidos vinculados com schedule: um direito SCHEDULED por pedido, ordem por código", () => {
    const rights = resolveReceivableOrderRights({
      receivableNfeId: 100,
      schedules: [schedule({ id: "sb", salesOrderId: "b" }), schedule({ id: "sa", salesOrderId: "a" })],
      linkedOrders: [...linked].reverse(),
    });
    assert.deepEqual(rights.map((right) => [right.salesOrderId, right.resolution]), [
      ["a", "SCHEDULED"],
      ["b", "SCHEDULED"],
    ]);
  });

  it("pedido vinculado sem schedule = MISSING_SCHEDULE; schedule de pedido não vinculado = CONTRADICTORY_LINK", () => {
    const rights = resolveReceivableOrderRights({
      receivableNfeId: 100,
      schedules: [schedule({ id: "sa", salesOrderId: "a" }), schedule({ id: "sx", salesOrderId: "x" })],
      linkedOrders: linked,
    });
    assert.deepEqual(rights.map((right) => [right.salesOrderId, right.resolution]), [
      ["a", "SCHEDULED"],
      ["b", "MISSING_SCHEDULE"],
      ["x", "CONTRADICTORY_LINK"],
    ]);
  });

  it("schedule com NF-e diferente do título = CONTRADICTORY_LINK", () => {
    const [right] = resolveReceivableOrderRights({
      receivableNfeId: 100,
      schedules: [schedule({ id: "sa", salesOrderId: "a", nfeId: 999 })],
      linkedOrders: [linked[0]!],
    });
    assert.equal(right!.resolution, "CONTRADICTORY_LINK");
  });

  it("sem evidência de vínculo: confia no schedule (histórico), salvo NF-e sabidamente de vários pedidos", () => {
    const trusted = resolveReceivableOrderRights({
      receivableNfeId: 100,
      schedules: [schedule({ id: "sa", salesOrderId: "a" })],
      linkedOrders: null,
    });
    assert.equal(trusted[0]!.resolution, "SCHEDULED");
    const unverified = resolveReceivableOrderRights({
      receivableNfeId: 100,
      schedules: [schedule({ id: "sa", salesOrderId: "a" })],
      linkedOrders: null,
      multiOrderNfe: true,
    });
    assert.equal(unverified[0]!.resolution, "CONTRADICTORY_LINK");
  });

  it("pedido sobrealocado entre NF-e (R1) = OVER_ALLOCATED_ACROSS_NFE", () => {
    const [right] = resolveReceivableOrderRights({
      receivableNfeId: 100,
      schedules: [schedule({ id: "sa", salesOrderId: "a" })],
      linkedOrders: [linked[0]!],
      overAllocatedOrderIds: new Set(["a"]),
    });
    assert.equal(right!.resolution, "OVER_ALLOCATED_ACROSS_NFE");
  });
});

describe("guarda R1 — mesma venda em mais de uma NF-e", () => {
  const items = [{ salesOrderItemId: "a-i1", soldAmount: 1000 }];

  it("snapshot integral em duas NF-e vinculadas = sobrealocado", () => {
    const result = detectOrdersOverAllocatedAcrossNfes({
      orderIds: ["a"],
      snapshotsByOrderId: new Map([["a", [fact({ snapshotId: "s1", nfeId: 100, items }), fact({ snapshotId: "s2", nfeId: 101, items })]]]),
      bundlesByOrderId: new Map([["a", bundle("a", [{ id: 100 }, { id: 101 }], [{ id: "a-i1", net: 1000 }])]]),
    });
    assert.deepEqual(result.get("a")?.nfeIds, [100, 101]);
    assert.equal(result.get("a")?.claimedSoldAmount, 2000);
  });

  it("reemissão: snapshot da NF-e cancelada não conta", () => {
    const result = detectOrdersOverAllocatedAcrossNfes({
      orderIds: ["a"],
      snapshotsByOrderId: new Map([["a", [fact({ snapshotId: "s1", nfeId: 100, items }), fact({ snapshotId: "s2", nfeId: 101, items })]]]),
      bundlesByOrderId: new Map([["a", bundle("a", [{ id: 100, cancelled: true }, { id: 101 }], [{ id: "a-i1", net: 1000 }])]]),
    });
    assert.equal(result.size, 0);
  });

  it("NF-e vinculada que não é de saída (devolução/remessa) não conta", () => {
    const result = detectOrdersOverAllocatedAcrossNfes({
      orderIds: ["a"],
      snapshotsByOrderId: new Map([["a", [fact({ snapshotId: "s1", nfeId: 100, items }), fact({ snapshotId: "s2", nfeId: 101, items })]]]),
      bundlesByOrderId: new Map([["a", bundle("a", [{ id: 100 }, { id: 101, output: false }], [{ id: "a-i1", net: 1000 }])]]),
    });
    assert.equal(result.size, 0);
  });

  it("snapshots parciais por NF-e (alocação por item, B5) não são sobrealocação", () => {
    const result = detectOrdersOverAllocatedAcrossNfes({
      orderIds: ["a"],
      snapshotsByOrderId: new Map([
        [
          "a",
          [
            fact({ snapshotId: "s1", nfeId: 100, totalSoldAmount: 400, items: [{ salesOrderItemId: "a-i1", soldAmount: 400 }] }),
            fact({ snapshotId: "s2", nfeId: 101, totalSoldAmount: 600, items: [{ salesOrderItemId: "a-i1", soldAmount: 600 }] }),
          ],
        ],
      ]),
      bundlesByOrderId: new Map([["a", bundle("a", [{ id: 100 }, { id: 101 }], [{ id: "a-i1", net: 1000 }])]]),
    });
    assert.equal(result.size, 0);
  });

  it("snapshot sem NF-e (pré-faturamento) e NF-e única não contam", () => {
    const result = detectOrdersOverAllocatedAcrossNfes({
      orderIds: ["a"],
      snapshotsByOrderId: new Map([["a", [fact({ snapshotId: "s0", nfeId: null, items }), fact({ snapshotId: "s1", nfeId: 100, items })]]]),
      bundlesByOrderId: new Map([["a", bundle("a", [{ id: 100 }], [{ id: "a-i1", net: 1000 }])]]),
    });
    assert.equal(result.size, 0);
  });
});

describe("atribuição da âncora financeira", () => {
  it("reparte pelo peso com resto exato no último", () => {
    const result = attributeFinancialAnchorAmount({
      amount: 4435.5,
      weights: [
        { key: "a", weight: 3045.9 },
        { key: "b", weight: 10395 },
      ],
    });
    assert.equal(result.attribution, "ATTRIBUTED");
    assert.equal(result.amounts.get("a"), 1005.15);
    assert.equal(result.amounts.get("b"), 3430.35);
    assert.equal(Math.round(((result.amounts.get("a") ?? 0) + (result.amounts.get("b") ?? 0)) * 100) / 100, 4435.5);
  });

  it("peso ausente ou zero: nada é repartido (nunca divide por igual)", () => {
    for (const weight of [null, 0]) {
      const result = attributeFinancialAnchorAmount({
        amount: 1000,
        weights: [
          { key: "a", weight: 500 },
          { key: "b", weight },
        ],
      });
      assert.equal(result.attribution, "UNATTRIBUTED");
      assert.deepEqual([...result.amounts.values()], [0, 0]);
    }
  });

  it("peso do pedido: snapshot vigente da NF-e; sem snapshot, valor do pedido; R1 sem lastro", () => {
    const facts = new Map([["a", [fact({ snapshotId: "snap-a", nfeId: 100, totalSoldAmount: 3045.9 })]]]);
    assert.equal(
      resolveOrderAttributionWeight({
        right: { salesOrderId: "a", order: null, schedule: schedule({ id: "sa", salesOrderId: "a" }), resolution: "SCHEDULED" },
        receivableNfeId: 100,
        snapshotsByOrderId: facts,
      }),
      3045.9
    );
    assert.equal(
      resolveOrderAttributionWeight({
        right: { salesOrderId: "b", order: bundle("b", [{ id: 100 }], [{ id: "b-i1", net: 250 }]), schedule: null, resolution: "MISSING_SCHEDULE" },
        receivableNfeId: 100,
      }),
      250
    );
    assert.equal(
      resolveOrderAttributionWeight({
        right: { salesOrderId: "a", order: null, schedule: schedule({ id: "sa", salesOrderId: "a" }), resolution: "OVER_ALLOCATED_ACROSS_NFE" },
        receivableNfeId: 100,
        snapshotsByOrderId: facts,
      }),
      null
    );
  });

  it("agrupamentos somam a parcela atribuída e contam título não compartilhado uma vez", () => {
    const lines = [
      { key: "1", receivedAmount: 100 },
      { key: "1", receivedAmount: 100 },
      { key: "2", receivedAmount: 4435.5, financialAnchorShared: true, financialAnchorAttribution: "ATTRIBUTED" as const, attributedReceivedAmount: 1005.15 },
      { key: "2", receivedAmount: 4435.5, financialAnchorShared: true, financialAnchorAttribution: "UNATTRIBUTED" as const, attributedReceivedAmount: 0 },
    ];
    assert.equal(sumReceivedForLineGroup(lines, (line) => line.key), 1105.15);
    assert.equal(attributedReceivedAmountOf(lines[3]!), 0);
  });
});

describe("guarda de cobertura (evento × direito)", () => {
  it("pedidos distintos final × pendente no mesmo evento NÃO conflitam (cobertura por direito)", () => {
    const conflicts = findReceiptRightConflicts(
      [
        { nomusReceivableId: 1, status: "COMMISSIONABLE", receiptIds: [10], orderCode: "A", localOrderId: "a" },
        { nomusReceivableId: 1, status: "NO_SCHEDULE", receiptIds: [10], orderCode: "B", localOrderId: "b" },
      ],
      isCoverageFinalLineStatus
    );
    assert.deepEqual(conflicts, []);
  });

  it("linhas sem pedido do mesmo evento, uma final e outra pendente = conflito (cobriria o evento e perderia a pendente)", () => {
    const conflicts = findReceiptRightConflicts(
      [
        { nomusReceivableId: 1, status: "COMMISSIONABLE", receiptIds: [10], orderCode: "A" },
        { nomusReceivableId: 1, status: "NO_SCHEDULE", receiptIds: [10], orderCode: "B" },
        { nomusReceivableId: 2, status: "COMMISSIONABLE", receiptIds: [20], orderCode: "C" },
        { nomusReceivableId: 2, status: "ZERO_AMOUNT", receiptIds: [20], orderCode: "D" },
        { nomusReceivableId: 3, status: "ERROR", receiptIds: [30], orderCode: "E" },
      ],
      isCoverageFinalLineStatus
    );
    assert.deepEqual(
      conflicts.map((row) => [row.receiptExternalId, row.kind, row.pendingRights.map((right) => right.orderCode)]),
      [[10, "MIXED_EVENT_LINES", ["B"]]]
    );
  });

  it("'sem vínculo de venda' (evento inteiro) ao lado de direito de pedido = conflito", () => {
    const conflicts = findReceiptRightConflicts(
      [
        { nomusReceivableId: 1, status: "NO_SALES_LINK", receiptIds: [10] },
        { nomusReceivableId: 1, status: "COMMISSIONABLE", receiptIds: [10], orderCode: "A", localOrderId: "a" },
      ],
      isCoverageFinalLineStatus
    );
    assert.equal(conflicts[0]?.kind, "EVENT_LINE_WITH_RIGHTS");
  });
});

describe("índice N:N, pagamentos e auditoria de consistência", () => {
  it("todas as NF-e pedidas ganham entrada (vazia = sem vínculo), pedidos ordenados", () => {
    const index = indexAllOrderBundlesByNfeId([bundle("b", [{ id: 100 }]), bundle("a", [{ id: 100 }, { id: 101 }])], [100, 101, 102]);
    assert.deepEqual(index.get(100)?.map((row) => row.localOrderId), ["a", "b"]);
    assert.deepEqual(index.get(101)?.map((row) => row.localOrderId), ["a"]);
    assert.deepEqual(index.get(102), []);
  });

  it("pago ao vendedor: título de um pedido soma tudo; de N pedidos, só o pagamento do próprio pedido", () => {
    const paidByReceivable = new Map([[19809, 50]]);
    const paidByReceivableOrder = new Map([["19809|2934", 20]]);
    assert.equal(
      resolveOutlookPaidToSellerAmount({ receivableId: 19809, nomusOrderId: 2934, ordersOnTitle: 1, paidByReceivable, paidByReceivableOrder }),
      50
    );
    assert.equal(
      resolveOutlookPaidToSellerAmount({ receivableId: 19809, nomusOrderId: 2934, ordersOnTitle: 2, paidByReceivable, paidByReceivableOrder }),
      20
    );
    assert.equal(
      resolveOutlookPaidToSellerAmount({ receivableId: 19809, nomusOrderId: 2998, ordersOnTitle: 2, paidByReceivable, paidByReceivableOrder }),
      0
    );
  });

  it("auditoria de consistência: N pedidos no título não é ambiguidade; o mesmo pedido em dois snapshots é", () => {
    const snapshots = [
      { snapshotId: "s-a", salesOrderId: "a", orderCode: "A", nfeId: 100, status: "ACTIVE", totalFinalCommissionAmount: 91.24 },
      { snapshotId: "s-b", salesOrderId: "b", orderCode: "B", nfeId: 100, status: "ACTIVE", totalFinalCommissionAmount: 323.57 },
      { snapshotId: "s-b2", salesOrderId: "b", orderCode: "B", nfeId: 100, status: "ACTIVE", totalFinalCommissionAmount: 323.57 },
    ];
    const legit = auditCommissionScheduleConsistency({
      snapshots: snapshots.slice(0, 2),
      schedules: [
        { scheduleId: "1", orderSnapshotId: "s-a", receivableId: 19809, salesOrderId: "a", status: "ACTIVE", scheduledCommissionAmount: 30.11 },
        { scheduleId: "2", orderSnapshotId: "s-b", receivableId: 19809, salesOrderId: "b", status: "ACTIVE", scheduledCommissionAmount: 106.78 },
      ],
    });
    assert.equal(legit.findings.filter((row) => row.kind === "MULTIPLE_EFFECTIVE_SETS_FOR_RECEIVABLE").length, 0);
    const duplicated = auditCommissionScheduleConsistency({
      snapshots,
      schedules: [
        { scheduleId: "2", orderSnapshotId: "s-b", receivableId: 19809, salesOrderId: "b", status: "ACTIVE", scheduledCommissionAmount: 106.78 },
        { scheduleId: "3", orderSnapshotId: "s-b2", receivableId: 19809, salesOrderId: "b", status: "ACTIVE", scheduledCommissionAmount: 106.78 },
      ],
    });
    assert.equal(duplicated.findings.filter((row) => row.kind === "MULTIPLE_EFFECTIVE_SETS_FOR_RECEIVABLE").length, 1);
  });
});
