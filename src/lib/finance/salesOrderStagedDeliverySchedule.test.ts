/**
 * FIN-13 — entregas parciais sem rateio sobre todas as parcelas.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  allocateResidualToOriginalInstallments,
  buildSalesOrderEffectiveFinancialSchedule,
  sumActiveOrderResidual,
} from "./salesOrderEffectiveFinancialSchedule.js";
import {
  allocateStagedDeliveryResidual,
  buildStagedDeliveryBlocks,
  resolveEffectiveScheduleMaterializationMode,
} from "./salesOrderStagedDeliverySchedule.js";
import type { SalesOrderItemFinancialAmounts } from "./salesOrderItemFinancialAmounts.js";

function d(v: string) {
  return new Prisma.Decimal(v);
}

function assertMoney(actual: Prisma.Decimal, expected: string) {
  assert.equal(actual.toFixed(2), d(expected).toFixed(2));
}

function itemPartial(activeResidual: string): SalesOrderItemFinancialAmounts {
  return {
    salesOrderItemId: "i1",
    classification: "PARTIALLY_FULFILLED",
    fulfillment: {} as never,
    plannedNetValue: d("300000"),
    coveredByValidDocuments: d("0"),
    documentAllocatedByOrderPriceRaw: d("0"),
    documentAllocatedByDocumentPriceRaw: d("0"),
    crReceivableRaw: d("0"),
    crReceivedRaw: d("0"),
    crOpenRaw: d("0"),
    activeResidual: d(activeResidual),
    cutAmount: d("0"),
    canceledAmount: d("0"),
    unresolvedResidual: d("0"),
    evidence: {
      orderedQuantity: null,
      fulfilledQuantity: null,
      remainingQuantity: null,
      quantityShareActive: null,
      documentAllocationKeysUsed: [],
      crAllocationKeysUsed: [],
      classificationPendingAlert: false,
    },
  };
}

function order300kThreePositions(overrides: {
  docAmount: string;
  fulfilledQty?: number;
  docDate?: string;
  secondDocAmount?: string;
  secondDocDate?: string;
  crSplit?: boolean;
  unequal?: boolean;
  cut?: boolean;
  canceled?: boolean;
  manual?: boolean;
}) {
  const positions = overrides.unequal
    ? [
        { installmentNumber: 1, dueDate: "2026-08-01", amount: "60000.00" },
        { installmentNumber: 2, dueDate: "2026-09-01", amount: "90000.00" },
        { installmentNumber: 3, dueDate: "2026-10-01", amount: "150000.00" },
      ]
    : [
        { installmentNumber: 1, dueDate: "2026-08-01", amount: "100000.00" },
        { installmentNumber: 2, dueDate: "2026-09-01", amount: "100000.00" },
        { installmentNumber: 3, dueDate: "2026-10-01", amount: "100000.00" },
      ];

  const delivered = Number(overrides.docAmount) + Number(overrides.secondDocAmount ?? 0);
  const planned = 300000;
  const status = overrides.cut
    ? 5
    : overrides.canceled
      ? 6
      : delivered >= planned
        ? 4
        : 3;
  const fulfilledQuantity = overrides.fulfilledQty ?? delivered / 10000;

  const documents = [
    {
      documentKey: "doc-1",
      sourceInvoiceId: 91001,
      allocatedByOrderPrice: overrides.docAmount,
      documentDate: overrides.docDate ?? "2026-06-01",
      provenInstallments: [
        {
          installmentNumber: 1,
          dueDate: "2026-07-15",
          amount: overrides.docAmount,
        },
      ],
    },
  ];
  if (overrides.secondDocAmount) {
    documents.push({
      documentKey: "doc-2",
      sourceInvoiceId: 91002,
      allocatedByOrderPrice: overrides.secondDocAmount,
      documentDate: overrides.secondDocDate ?? "2026-07-01",
      provenInstallments: [
        {
          installmentNumber: 1,
          dueDate: "2026-08-15",
          amount: overrides.secondDocAmount,
        },
      ],
    });
  }

  const realReceivables = overrides.crSplit
    ? [
        {
          externalId: 1,
          sourceInvoiceId: 91001,
          dueDate: "2026-07-15",
          amountReceivable: "50000.00",
          balanceReceivable: "50000.00",
        },
        {
          externalId: 2,
          sourceInvoiceId: 91001,
          dueDate: "2026-08-15",
          amountReceivable: "50000.00",
          balanceReceivable: "50000.00",
        },
      ]
    : [
        {
          externalId: 1,
          sourceInvoiceId: 91001,
          dueDate: "2026-07-15",
          amountReceivable: overrides.docAmount,
          balanceReceivable: overrides.docAmount,
        },
      ];

  return buildSalesOrderEffectiveFinancialSchedule({
    salesOrderId: "so-fin13",
    orderCode: "PD 02596",
    referenceDate: new Date(2026, 6, 17),
    originalInstallments: positions,
    items: [
      {
        salesOrderItemId: "item-1",
        plannedNetValue: "300000.00",
        status,
        orderedQuantity: 30,
        fulfilledQuantity: overrides.cut
          ? 10
          : overrides.canceled
            ? 0
            : fulfilledQuantity,
        documentAllocations: documents.map((doc, i) => ({
          allocationKey: `a${i}`,
          allocatedByOrderPrice: doc.allocatedByOrderPrice,
        })),
      },
    ],
    documents: overrides.canceled
      ? [{ ...documents[0]!, isValid: false }]
      : documents,
    realReceivables: overrides.cut || overrides.canceled ? [] : realReceivables,
    manualResidualSchedule: overrides.manual
      ? [
          { installmentNumber: 2, dueDate: "2026-11-01", amount: "120000.00" },
          { installmentNumber: 3, dueDate: "2026-12-01", amount: "80000.00" },
        ]
      : null,
  });
}

describe("FIN-13 allocateStagedDeliveryResidual", () => {
  it("entrega 100k em 3×100k → residual 100+100 nas posições 2 e 3", () => {
    const r = allocateStagedDeliveryResidual({
      positions: [
        { installmentNumber: 1, dueDate: "2026-08-01", originalAmount: d("100000") },
        { installmentNumber: 2, dueDate: "2026-09-01", originalAmount: d("100000") },
        { installmentNumber: 3, dueDate: "2026-10-01", originalAmount: d("100000") },
      ],
      deliveryBlocks: [
        {
          key: "doc:1",
          commercialAmount: d("100000"),
          sortDate: "2026-06-01",
          sortKey: "doc:1",
        },
      ],
      residualTotal: "200000",
    });
    assertMoney(r.residualParts[0]!, "0.00");
    assertMoney(r.residualParts[1]!, "100000.00");
    assertMoney(r.residualParts[2]!, "100000.00");
  });

  it("entrega 80k → residual 110+110", () => {
    const r = allocateStagedDeliveryResidual({
      positions: [
        { installmentNumber: 1, dueDate: null, originalAmount: d("100000") },
        { installmentNumber: 2, dueDate: null, originalAmount: d("100000") },
        { installmentNumber: 3, dueDate: null, originalAmount: d("100000") },
      ],
      deliveryBlocks: [
        {
          key: "d",
          commercialAmount: d("80000"),
          sortDate: "2026-01-01",
          sortKey: "d",
        },
      ],
      residualTotal: "220000",
    });
    assertMoney(r.residualParts[1]!, "110000.00");
    assertMoney(r.residualParts[2]!, "110000.00");
  });

  it("pesos desiguais nas restantes", () => {
    const r = allocateStagedDeliveryResidual({
      positions: [
        { installmentNumber: 1, dueDate: null, originalAmount: d("60000") },
        { installmentNumber: 2, dueDate: null, originalAmount: d("90000") },
        { installmentNumber: 3, dueDate: null, originalAmount: d("150000") },
      ],
      deliveryBlocks: [
        {
          key: "d",
          commercialAmount: d("100000"),
          sortDate: "2026-01-01",
          sortKey: "d",
        },
      ],
      residualTotal: "200000",
    });
    assertMoney(r.residualParts[1]!, "75000.00");
    assertMoney(r.residualParts[2]!, "125000.00");
  });

  it("mais entregas que posições → orphan", () => {
    const r = allocateStagedDeliveryResidual({
      positions: [
        { installmentNumber: 1, dueDate: null, originalAmount: d("100") },
        { installmentNumber: 2, dueDate: null, originalAmount: d("100") },
      ],
      deliveryBlocks: [
        { key: "a", commercialAmount: d("1"), sortDate: "2026-01-01", sortKey: "a" },
        { key: "b", commercialAmount: d("1"), sortDate: "2026-01-02", sortKey: "b" },
        { key: "c", commercialAmount: d("1"), sortDate: "2026-01-03", sortKey: "c" },
      ],
      residualTotal: "50",
    });
    assertMoney(r.stagedResidualWithoutPosition, "50.00");
    assert.deepEqual(r.occupiedPositionIndexes, [0, 1]);
  });
});

describe("FIN-13 motor — cenários obrigatórios", () => {
  it("1. Pedido sem Documento mantém agenda original", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule({
      salesOrderId: "so",
      orderCode: "PD 1",
      originalInstallments: [
        { installmentNumber: 1, dueDate: "2026-08-01", amount: "100000" },
        { installmentNumber: 2, dueDate: "2026-09-01", amount: "100000" },
        { installmentNumber: 3, dueDate: "2026-10-01", amount: "100000" },
      ],
      items: [
        {
          salesOrderItemId: "i",
          plannedNetValue: "300000",
          status: 2,
          orderedQuantity: 30,
          fulfilledQuantity: 0,
        },
      ],
      referenceDate: new Date(2026, 6, 17),
    });
    assert.equal(schedule.coverageSummary.materializationMode, "NO_MATERIALIZATION");
    assertMoney(sumActiveOrderResidual(schedule.activeOrderResidualSchedule), "300000.00");
    assertMoney(schedule.activeOrderResidualSchedule[0]!.residualAmount, "100000.00");
  });

  it("2/3. Documento integral — substituição integral sem residual", () => {
    const schedule = order300kThreePositions({
      docAmount: "300000.00",
      fulfilledQty: 30,
    });
    // item FULLY_FULFILLED with full doc
    assertMoney(sumActiveOrderResidual(schedule.activeOrderResidualSchedule), "0.00");
    assert.ok(
      schedule.coverageSummary.materializationMode === "FULL_SUBSTITUTION" ||
        schedule.coverageSummary.materializationMode === "CLOSED_WITH_CUT"
    );
  });

  it("4. Entrega 100k → real + residual 100 + 100", () => {
    const schedule = order300kThreePositions({ docAmount: "100000.00", fulfilledQty: 10 });
    assert.equal(schedule.coverageSummary.materializationMode, "STAGED_AUTOMATIC");
    assert.equal(schedule.activeOrderResidualSchedule.length, 2);
    assertMoney(schedule.activeOrderResidualSchedule[0]!.residualAmount, "100000.00");
    assertMoney(schedule.activeOrderResidualSchedule[1]!.residualAmount, "100000.00");
    assert.equal(schedule.activeOrderResidualSchedule[0]!.installmentNumber, 2);
    assert.equal(schedule.occupiedPositionIndexes.length, 1);
  });

  it("5. Entrega 80k → 110 + 110", () => {
    const schedule = order300kThreePositions({ docAmount: "80000.00", fulfilledQty: 8 });
    assertMoney(schedule.activeOrderResidualSchedule[0]!.residualAmount, "110000.00");
    assertMoney(schedule.activeOrderResidualSchedule[1]!.residualAmount, "110000.00");
  });

  it("6. Entrega 150k → 75 + 75", () => {
    const schedule = order300kThreePositions({ docAmount: "150000.00", fulfilledQty: 15 });
    assertMoney(schedule.activeOrderResidualSchedule[0]!.residualAmount, "75000.00");
    assertMoney(schedule.activeOrderResidualSchedule[1]!.residualAmount, "75000.00");
  });

  it("7. Dois CRs da mesma NF ocupam uma posição", () => {
    const schedule = order300kThreePositions({
      docAmount: "100000.00",
      fulfilledQty: 10,
      crSplit: true,
    });
    assert.equal(schedule.occupiedPositionIndexes.length, 1);
    assert.equal(schedule.activeOrderResidualSchedule.length, 2);
    const blocks = buildStagedDeliveryBlocks({
      documents: [
        {
          documentKey: "doc-1",
          sourceInvoiceId: 91001,
          allocatedByOrderPrice: "100000",
        },
      ],
      realReceivables: [
        { externalId: 1, sourceInvoiceId: 91001, amountReceivable: "50000" },
        { externalId: 2, sourceInvoiceId: 91001, amountReceivable: "50000" },
      ],
    });
    assert.equal(blocks.length, 1);
  });

  it("8. Duas entregas 80 + 120 → residual 100 na última", () => {
    const schedule = order300kThreePositions({
      docAmount: "80000.00",
      secondDocAmount: "120000.00",
      fulfilledQty: 20,
    });
    assert.equal(schedule.occupiedPositionIndexes.length, 2);
    assert.equal(schedule.activeOrderResidualSchedule.length, 1);
    assertMoney(schedule.activeOrderResidualSchedule[0]!.residualAmount, "100000.00");
    assert.equal(schedule.activeOrderResidualSchedule[0]!.installmentNumber, 3);
  });

  it("9. Parcelas desiguais preservam pesos", () => {
    const schedule = order300kThreePositions({
      docAmount: "100000.00",
      fulfilledQty: 10,
      unequal: true,
    });
    assertMoney(schedule.activeOrderResidualSchedule[0]!.residualAmount, "75000.00");
    assertMoney(schedule.activeOrderResidualSchedule[1]!.residualAmount, "125000.00");
  });

  it("10. Agenda manual não redistribui automaticamente", () => {
    const schedule = order300kThreePositions({
      docAmount: "100000.00",
      fulfilledQty: 10,
      manual: true,
    });
    assert.equal(schedule.coverageSummary.materializationMode, "STAGED_MANUAL");
    const byInst = new Map(
      schedule.activeOrderResidualSchedule.map((l) => [
        l.installmentNumber,
        l.residualAmount.toFixed(2),
      ])
    );
    assert.equal(byInst.get(2), "120000.00");
    assert.equal(byInst.get(3), "80000.00");
    assert.ok(!byInst.has(1));
  });

  it("11. Corte — residual zero", () => {
    const schedule = order300kThreePositions({
      docAmount: "100000.00",
      cut: true,
      fulfilledQty: 10,
    });
    assertMoney(sumActiveOrderResidual(schedule.activeOrderResidualSchedule), "0.00");
    assert.ok(schedule.cutAmount.gt(0));
  });

  it("12. Cancelamento — residual zero", () => {
    const schedule = order300kThreePositions({
      docAmount: "100000.00",
      canceled: true,
    });
    assertMoney(sumActiveOrderResidual(schedule.activeOrderResidualSchedule), "0.00");
  });

  it("16. CR substitui Documento mesma NF — sem duplicar", () => {
    const schedule = order300kThreePositions({
      docAmount: "100000.00",
      fulfilledQty: 10,
    });
    assert.equal(schedule.documentSchedule.length, 0);
    assert.equal(schedule.realReceivables.length, 1);
  });

  it("17. CR maior que base comercial — residual usa base de itens", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule({
      salesOrderId: "so",
      orderCode: "PD X",
      referenceDate: new Date(2026, 6, 17),
      originalInstallments: [
        { installmentNumber: 1, dueDate: "2026-08-01", amount: "100000" },
        { installmentNumber: 2, dueDate: "2026-09-01", amount: "100000" },
        { installmentNumber: 3, dueDate: "2026-10-01", amount: "100000" },
      ],
      items: [
        {
          salesOrderItemId: "i",
          plannedNetValue: "300000",
          status: 3,
          orderedQuantity: 30,
          fulfilledQuantity: 10,
          documentAllocations: [
            { allocationKey: "d", allocatedByOrderPrice: "100000" },
          ],
        },
      ],
      documents: [
        {
          documentKey: "doc",
          sourceInvoiceId: 1,
          allocatedByOrderPrice: "100000",
          documentDate: "2026-06-01",
          provenInstallments: [
            { installmentNumber: 1, dueDate: "2026-07-01", amount: "100000" },
          ],
        },
      ],
      realReceivables: [
        {
          externalId: 9,
          sourceInvoiceId: 1,
          amountReceivable: "101500",
          balanceReceivable: "101500",
        },
      ],
    });
    assertMoney(schedule.coverageSummary.itemActiveResidualTotal, "200000.00");
    assertMoney(sumActiveOrderResidual(schedule.activeOrderResidualSchedule), "200000.00");
    assertMoney(schedule.realReceivables[0]!.amountReceivable, "101500.00");
  });

  it("19. Centavos — soma exata na última", () => {
    const parts = allocateResidualToOriginalInstallments(
      [d("100"), d("100"), d("100")],
      "100.00"
    );
    const sum = parts.reduce((s, p) => s.add(p), d("0"));
    assertMoney(sum, "100.00");
  });

  it("20. Idempotente", () => {
    const a = order300kThreePositions({ docAmount: "100000.00", fulfilledQty: 10 });
    const b = order300kThreePositions({ docAmount: "100000.00", fulfilledQty: 10 });
    assert.equal(
      JSON.stringify(a.activeOrderResidualSchedule.map((l) => l.residualAmount.toFixed(2))),
      JSON.stringify(b.activeOrderResidualSchedule.map((l) => l.residualAmount.toFixed(2)))
    );
  });

  it("22. Pedido comum integral — regressão sem residual", () => {
    const schedule = order300kThreePositions({
      docAmount: "300000.00",
      fulfilledQty: 30,
    });
    assertMoney(sumActiveOrderResidual(schedule.activeOrderResidualSchedule), "0.00");
    assert.equal(schedule.realReceivables.length, 1);
  });
});

describe("FIN-13 mode resolver", () => {
  it("não ativa staged só porque Documento < Pedido sem item aberto", () => {
    const mode = resolveEffectiveScheduleMaterializationMode({
      itemAmounts: [
        {
          ...itemPartial("0"),
          classification: "FULFILLED_WITH_CUT",
          activeResidual: d("0"),
          cutAmount: d("200000"),
        },
      ],
      deliveryBlockCount: 1,
      originalPositionCount: 3,
      itemActiveResidualTotal: d("0"),
      cutAmount: d("200000"),
      canceledAmount: d("0"),
      unresolvedAmount: d("0"),
    });
    assert.equal(mode, "CLOSED_WITH_CUT");
  });
});
