/**
 * FIN-04 — cálculo financeiro por item do Pedido.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Prisma } from "@prisma/client";
import {
  computeQuantityProportionalAmount,
  computeSalesOrderItemFinancialAmounts,
} from "./salesOrderItemFinancialAmounts.js";

function d(value: string | number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function assertMoney(actual: Prisma.Decimal, expected: string) {
  assert.equal(actual.toFixed(2), d(expected).toFixed(2));
}

describe("computeQuantityProportionalAmount", () => {
  it("10.000 × 1 ÷ 10 = 1.000,00 (Decimal)", () => {
    const r = computeQuantityProportionalAmount("10000", 1, 10);
    assert.ok(r);
    assertMoney(r!, "1000.00");
    assert.ok(r instanceof Prisma.Decimal);
  });

  it("ajusta centavos de forma determinística", () => {
    const r = computeQuantityProportionalAmount("100.00", "1", "3");
    assert.ok(r);
    assertMoney(r!, "33.33");
  });
});

describe("computeSalesOrderItemFinancialAmounts — status", () => {
  it("não atendido sem documento mantém planejado ativo", () => {
    const r = computeSalesOrderItemFinancialAmounts({
      salesOrderItemId: "i1",
      plannedNetValue: "10000",
      status: 2,
      orderedQuantity: 10,
      fulfilledQuantity: 0,
    });
    assert.equal(r.classification, "NOT_FULFILLED");
    assertMoney(r.plannedNetValue, "10000.00");
    assertMoney(r.activeResidual, "10000.00");
    assertMoney(r.cutAmount, "0.00");
    assertMoney(r.canceledAmount, "0.00");
    assertMoney(r.unresolvedResidual, "0.00");
    assertMoney(r.coveredByValidDocuments, "0.00");
  });

  it("atendimento total → residual zero", () => {
    const r = computeSalesOrderItemFinancialAmounts({
      salesOrderItemId: "i1",
      plannedNetValue: "10000",
      status: 4,
      orderedQuantity: 10,
      fulfilledQuantity: 10,
      documentAllocations: [
        {
          allocationKey: "doc-item-1",
          allocatedByOrderPrice: "10000",
          allocatedByDocumentPrice: "10000",
        },
      ],
    });
    assert.equal(r.classification, "FULLY_FULFILLED");
    assertMoney(r.activeResidual, "0.00");
    assertMoney(r.cutAmount, "0.00");
    assertMoney(r.coveredByValidDocuments, "10000.00");
  });

  it("cancelado → canceledAmount = planejado, residual zero", () => {
    const r = computeSalesOrderItemFinancialAmounts({
      salesOrderItemId: "i1",
      plannedNetValue: "4500.50",
      status: 6,
      orderedQuantity: 5,
      fulfilledQuantity: 0,
    });
    assert.equal(r.classification, "CANCELED");
    assertMoney(r.canceledAmount, "4500.50");
    assertMoney(r.activeResidual, "0.00");
    assertMoney(r.cutAmount, "0.00");
  });

  it("UNKNOWN → unresolvedResidual = não coberto; activeResidual zero", () => {
    const r = computeSalesOrderItemFinancialAmounts({
      salesOrderItemId: "i1",
      plannedNetValue: "10000",
      status: 99,
      orderedQuantity: 10,
      fulfilledQuantity: 2,
      documentAllocations: [
        {
          allocationKey: "d1",
          allocatedByOrderPrice: "2000",
        },
      ],
    });
    assert.equal(r.classification, "UNKNOWN");
    assertMoney(r.activeResidual, "0.00");
    // remaining 8/10 → 8000; uncovered = 8000; min = 8000
    assertMoney(r.unresolvedResidual, "8000.00");
    assert.equal(r.evidence.classificationPendingAlert, true);
  });
});

describe("R$ 10.000 com documento R$ 9.000 — corte e parcial", () => {
  it("corte: residual zero e cutAmount 1.000", () => {
    const r = computeSalesOrderItemFinancialAmounts({
      salesOrderItemId: "cut-1",
      plannedNetValue: "10000",
      status: 5,
      orderedQuantity: 10,
      fulfilledQuantity: 9,
      documentAllocations: [
        {
          allocationKey: "doc-a",
          allocatedByOrderPrice: "9000",
          allocatedByDocumentPrice: "9100",
        },
      ],
      crAllocations: [
        {
          allocationKey: "cr-1",
          amountReceivable: "9100",
          amountReceived: "0",
          balanceReceivable: "9100",
        },
      ],
    });
    assert.equal(r.classification, "FULFILLED_WITH_CUT");
    assertMoney(r.activeResidual, "0.00");
    assertMoney(r.cutAmount, "1000.00");
    assertMoney(r.coveredByValidDocuments, "9000.00");
    // Doc/CR reais preservados (diff não altera saldo comercial).
    assertMoney(r.documentAllocatedByDocumentPriceRaw, "9100.00");
    assertMoney(r.crReceivableRaw, "9100.00");
    assertMoney(r.unresolvedResidual, "0.00");
  });

  it("parcial: activeResidual 1.000", () => {
    const r = computeSalesOrderItemFinancialAmounts({
      salesOrderItemId: "partial-1",
      plannedNetValue: "10000",
      status: 3,
      orderedQuantity: 10,
      fulfilledQuantity: 9,
      documentAllocations: [
        {
          allocationKey: "doc-a",
          allocatedByOrderPrice: "9000",
          allocatedByDocumentPrice: "9000",
        },
      ],
      crAllocations: [
        {
          allocationKey: "cr-1",
          amountReceivable: "8800",
          amountReceived: "0",
          balanceReceivable: "8800",
        },
      ],
    });
    assert.equal(r.classification, "PARTIALLY_FULFILLED");
    assertMoney(r.activeResidual, "1000.00");
    assertMoney(r.cutAmount, "0.00");
    assertMoney(r.coveredByValidDocuments, "9000.00");
    // Diff CR (8800) vs Doc (9000) não muda residual comercial.
    assertMoney(r.crReceivableRaw, "8800.00");
    assertMoney(r.documentAllocatedByDocumentPriceRaw, "9000.00");
  });
});

describe("vários documentos e dedupe", () => {
  it("soma docs distintos e ignora key duplicada", () => {
    const r = computeSalesOrderItemFinancialAmounts({
      salesOrderItemId: "i1",
      plannedNetValue: "10000",
      status: 2,
      orderedQuantity: 10,
      fulfilledQuantity: 0,
      documentAllocations: [
        { allocationKey: "a", allocatedByOrderPrice: "3000" },
        { allocationKey: "b", allocatedByOrderPrice: "2000" },
        { allocationKey: "a", allocatedByOrderPrice: "3000" }, // dup
      ],
    });
    assertMoney(r.documentAllocatedByOrderPriceRaw, "5000.00");
    assertMoney(r.coveredByValidDocuments, "5000.00");
    assertMoney(r.activeResidual, "5000.00");
    assert.deepEqual(r.evidence.documentAllocationKeysUsed, ["a", "b"]);
  });

  it("cobertura nunca excede o planejado", () => {
    const r = computeSalesOrderItemFinancialAmounts({
      salesOrderItemId: "i1",
      plannedNetValue: "1000",
      status: 2,
      orderedQuantity: 1,
      fulfilledQuantity: 0,
      documentAllocations: [
        { allocationKey: "x", allocatedByOrderPrice: "1500" },
      ],
    });
    assertMoney(r.coveredByValidDocuments, "1000.00");
    assertMoney(r.documentAllocatedByOrderPriceRaw, "1500.00");
    assertMoney(r.activeResidual, "0.00");
  });

  it("documento inválido não cobre", () => {
    const r = computeSalesOrderItemFinancialAmounts({
      salesOrderItemId: "i1",
      plannedNetValue: "10000",
      status: 2,
      orderedQuantity: 10,
      fulfilledQuantity: 0,
      documentAllocations: [
        {
          allocationKey: "bad",
          allocatedByOrderPrice: "9000",
          isValid: false,
        },
      ],
    });
    assertMoney(r.coveredByValidDocuments, "0.00");
    assertMoney(r.activeResidual, "10000.00");
  });
});

describe("nunca Number comum no dinheiro", () => {
  it("campos monetários são Prisma.Decimal", () => {
    const r = computeSalesOrderItemFinancialAmounts({
      salesOrderItemId: "i1",
      plannedNetValue: d("99.99"),
      status: 4,
      orderedQuantity: d(1),
      fulfilledQuantity: d(1),
    });
    for (const field of [
      r.plannedNetValue,
      r.coveredByValidDocuments,
      r.activeResidual,
      r.cutAmount,
      r.canceledAmount,
      r.unresolvedResidual,
      r.crReceivableRaw,
    ]) {
      assert.ok(field instanceof Prisma.Decimal, String(field));
    }
  });
});
