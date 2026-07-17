/**
 * FIN-05 — testes do motor único da agenda financeira efetiva.
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
  fixtureCanceledItem,
  fixtureCrReplacesDocumentSameNfe,
  fixtureCut10000Doc9000,
  fixtureOrder10000Base,
  fixturePartialWithDoc9000Awaiting,
  fixturePartialWithDoc9000Proven,
  fixtureUnknownPartialCoverage,
} from "./salesOrderEffectiveFinancialSchedule.fixtures.js";

function assertMoney(actual: Prisma.Decimal, expected: string) {
  assert.equal(actual.toFixed(2), new Prisma.Decimal(expected).toFixed(2));
}

describe("allocateResidualToOriginalInstallments", () => {
  it("distribui proporcionalmente e fecha centavos na última", () => {
    const parts = allocateResidualToOriginalInstallments(
      [new Prisma.Decimal("100"), new Prisma.Decimal("100"), new Prisma.Decimal("100")],
      "100.00"
    );
    assert.equal(parts.length, 3);
    const sum = parts.reduce((s, p) => s.add(p), new Prisma.Decimal(0));
    assertMoney(sum, "100.00");
    assertMoney(parts[0]!, "33.33");
    assertMoney(parts[1]!, "33.33");
    assertMoney(parts[2]!, "33.34");
  });

  it("preserva quantidade de parcelas mesmo com residual zero", () => {
    const parts = allocateResidualToOriginalInstallments(
      [new Prisma.Decimal("5000"), new Prisma.Decimal("5000")],
      "0"
    );
    assert.equal(parts.length, 2);
    assertMoney(parts[0]!, "0.00");
    assertMoney(parts[1]!, "0.00");
  });
});

describe("buildSalesOrderEffectiveFinancialSchedule — sem documento", () => {
  it("previsão vigente = parcelas originais do Pedido", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule(fixtureOrder10000Base());
    assert.equal(schedule.realReceivables.length, 0);
    assert.equal(schedule.documentSchedule.length, 0);
    assert.equal(schedule.activeOrderResidualSchedule.length, 2);
    assertMoney(sumActiveOrderResidual(schedule.activeOrderResidualSchedule), "10000.00");
    assert.equal(schedule.activeOrderResidualSchedule[0]!.dueDate, "2026-08-01");
    assert.equal(schedule.activeOrderResidualSchedule[1]!.dueDate, "2026-09-01");
    assertMoney(schedule.cutAmount, "0.00");
    assert.equal(schedule.coverageSummary.precedenceSource, "ORDER_PLAN");
  });
});

describe("Documento sem CR", () => {
  it("sem parcelas comprovadas → DOCUMENT_AWAITING_FINANCIAL_SCHEDULE (sem datas do Pedido)", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule(
      fixturePartialWithDoc9000Awaiting()
    );
    assert.equal(schedule.documentSchedule.length, 1);
    const doc = schedule.documentSchedule[0]!;
    assert.equal(doc.kind, "DOCUMENT_AWAITING_FINANCIAL_SCHEDULE");
    if (doc.kind === "DOCUMENT_AWAITING_FINANCIAL_SCHEDULE") {
      assert.equal(doc.dueDate, null);
      assert.equal(doc.installments.length, 0);
      assertMoney(doc.allocatedByOrderPrice, "9000.00");
    }
    assertMoney(schedule.coverageSummary.activeOrderResidualTotal, "1000.00");
    // FIN-13: 1 entrega ocupa a 1ª posição; residual R$ 1.000 na 2ª.
    assert.equal(schedule.activeOrderResidualSchedule.length, 1);
    assert.equal(schedule.activeOrderResidualSchedule[0]!.installmentNumber, 2);
    assert.equal(schedule.activeOrderResidualSchedule[0]!.dueDate, "2026-09-01");
    assert.equal(schedule.coverageSummary.materializationMode, "STAGED_AUTOMATIC");
    assert.ok(
      schedule.alerts.some((a) => a.code === "DOCUMENT_AWAITING_FINANCIAL_SCHEDULE")
    );
    // Parte coberta não aparece como parcela do Pedido com valor 9000.
    assertMoney(sumActiveOrderResidual(schedule.activeOrderResidualSchedule), "1000.00");
  });

  it("com condição documental → DOCUMENT_SCHEDULE substitui Pedido na parte coberta", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule(
      fixturePartialWithDoc9000Proven()
    );
    assert.equal(schedule.documentSchedule[0]?.kind, "DOCUMENT_SCHEDULE");
    if (schedule.documentSchedule[0]?.kind === "DOCUMENT_SCHEDULE") {
      assert.equal(schedule.documentSchedule[0].installments[0]!.dueDate, "2026-07-20");
      assertMoney(schedule.documentSchedule[0].installments[0]!.amount, "9000.00");
    }
    assertMoney(sumActiveOrderResidual(schedule.activeOrderResidualSchedule), "1000.00");
    assert.ok(schedule.supersededOrderSchedule.length >= 1);
    assert.equal(schedule.coverageSummary.precedenceSource, "MIXED");
  });
});

describe("CR real > Documento mesma NF", () => {
  it("não duplica Documento e CR da mesma NF", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule(
      fixtureCrReplacesDocumentSameNfe()
    );
    assert.equal(schedule.realReceivables.length, 1);
    assertMoney(schedule.realReceivables[0]!.amountReceivable, "10000.00");
    assert.equal(schedule.documentSchedule.length, 0);
    assertMoney(sumActiveOrderResidual(schedule.activeOrderResidualSchedule), "0.00");
    assert.equal(schedule.coverageSummary.precedenceSource, "REAL_RECEIVABLE");
  });

  it("dedupe de CR por externalId", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule(
      fixtureOrder10000Base({
        realReceivables: [
          {
            externalId: 1,
            sourceInvoiceId: 10,
            amountReceivable: "4000",
            balanceReceivable: "4000",
          },
          {
            externalId: 1,
            sourceInvoiceId: 10,
            amountReceivable: "4000",
            balanceReceivable: "4000",
          },
          {
            externalId: 2,
            sourceInvoiceId: 10,
            amountReceivable: "1000",
            balanceReceivable: "1000",
          },
        ],
        items: [
          {
            salesOrderItemId: "item-1",
            plannedNetValue: "10000",
            status: 3,
            orderedQuantity: 10,
            fulfilledQuantity: 5,
            documentAllocations: [
              { allocationKey: "d", allocatedByOrderPrice: "5000" },
            ],
          },
        ],
      })
    );
    assert.equal(schedule.realReceivables.length, 2);
    assertMoney(schedule.coverageSummary.coveredByRealReceivables, "5000.00");
  });
});

describe("corte e cancelamento", () => {
  it("corte: cutAmount 1000, sem previsão residual", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule(fixtureCut10000Doc9000());
    assertMoney(schedule.cutAmount, "1000.00");
    assertMoney(sumActiveOrderResidual(schedule.activeOrderResidualSchedule), "0.00");
    assert.equal(schedule.documentSchedule[0]?.kind, "DOCUMENT_SCHEDULE");
  });

  it("cancelado: canceledAmount 10000, residual zero", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule(fixtureCanceledItem());
    assertMoney(schedule.canceledAmount, "10000.00");
    assertMoney(sumActiveOrderResidual(schedule.activeOrderResidualSchedule), "0.00");
  });
});

describe("UNKNOWN e alertas", () => {
  it("unresolvedAmount e alerta de classificação pendente", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule(
      fixtureUnknownPartialCoverage()
    );
    assertMoney(schedule.unresolvedAmount, "8000.00");
    assertMoney(sumActiveOrderResidual(schedule.activeOrderResidualSchedule), "0.00");
    assert.ok(schedule.alerts.some((a) => a.code === "ITEM_CLASSIFICATION_PENDING"));
  });
});

describe("contrato de saída e soma exata", () => {
  it("expoõe todos os campos do contrato FIN-05", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule(
      fixturePartialWithDoc9000Proven()
    );
    assert.ok(Array.isArray(schedule.realReceivables));
    assert.ok(Array.isArray(schedule.documentSchedule));
    assert.ok(Array.isArray(schedule.activeOrderResidualSchedule));
    assert.ok(Array.isArray(schedule.supersededOrderSchedule));
    assert.ok(schedule.cutAmount instanceof Prisma.Decimal);
    assert.ok(schedule.canceledAmount instanceof Prisma.Decimal);
    assert.ok(schedule.unresolvedAmount instanceof Prisma.Decimal);
    assert.ok(schedule.coverageSummary);
    assert.ok(Array.isArray(schedule.alerts));
  });

  it("soma das parcelas residuais é exata ao residual de itens", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule(
      fixturePartialWithDoc9000Awaiting()
    );
    assertMoney(
      sumActiveOrderResidual(schedule.activeOrderResidualSchedule),
      schedule.coverageSummary.itemActiveResidualTotal.toFixed(2)
    );
  });

  it("FIN-13: entrega parcial ocupa 1ª posição; residual na restante", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule(
      fixtureOrder10000Base({
        items: [
          {
            salesOrderItemId: "item-1",
            plannedNetValue: "10000",
            status: 3,
            orderedQuantity: 10,
            fulfilledQuantity: 5,
            documentAllocations: [
              { allocationKey: "d", allocatedByOrderPrice: "5000" },
            ],
          },
        ],
        documents: [
          {
            documentKey: "doc",
            allocatedByOrderPrice: "5000",
            provenInstallments: [
              { installmentNumber: 1, dueDate: "2026-07-01", amount: "5000" },
            ],
          },
        ],
      })
    );
    assert.equal(schedule.coverageSummary.materializationMode, "STAGED_AUTOMATIC");
    assert.equal(schedule.activeOrderResidualSchedule.length, 1);
    assert.equal(schedule.activeOrderResidualSchedule[0]!.installmentNumber, 2);
    assertMoney(schedule.activeOrderResidualSchedule[0]!.residualAmount, "5000.00");
  });
});

describe("CR sem Documento não duplica previsão (PD 02740)", () => {
  it("CR integral sem NF/Doc zera residual — não conta CR + parcela do Pedido", () => {
    const schedule = buildSalesOrderEffectiveFinancialSchedule(
      fixtureOrder10000Base({
        originalInstallments: [
          { installmentNumber: 1, dueDate: "2026-10-20", amount: "10000.00" },
        ],
        realReceivables: [
          {
            externalId: 17754,
            sourceInvoiceId: null,
            dueDate: "2026-10-20",
            amountReceivable: "10000.00",
            amountReceived: "0",
            balanceReceivable: "10000.00",
          },
        ],
      })
    );
    assertMoney(schedule.coverageSummary.coveredByRealReceivables, "10000.00");
    assertMoney(sumActiveOrderResidual(schedule.activeOrderResidualSchedule), "0.00");
    assert.equal(schedule.realReceivables.length, 1);
    assert.equal(schedule.activeOrderResidualSchedule.length, 0);
  });
});
