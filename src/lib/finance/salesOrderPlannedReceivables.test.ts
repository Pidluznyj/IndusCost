/**
 * PDV-01 — Precedência financeira CR > Documento > Previsão do Pedido.
 * Âncora: PD 02590 (1 previsão → 2 CRs sem match de parcela).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allocateResidualPlannedAmounts,
  buildSalesOrderPlannedReceivables,
  computeSalesOrderFinancialCoverage,
} from "./salesOrderPlannedReceivables.js";

const PD_02590 = {
  orderActive: 6957.79,
  plannedDue: new Date("2026-06-19T12:00:00Z"),
  cr1: { amount: 3478.9, due: new Date("2026-07-28T12:00:00Z"), id: 91001 },
  cr2: { amount: 3478.89, due: new Date("2026-08-04T12:00:00Z"), id: 91002 },
};

describe("computeSalesOrderFinancialCoverage", () => {
  it("CR 100% zera residual sem negativo", () => {
    const c = computeSalesOrderFinancialCoverage({
      orderActiveValue: 100_000,
      realReceivableTotal: 100_000,
      validDocumentAllocatedValue: 100_000,
    });
    assert.equal(c.remainingPlannedValue, 0);
    assert.equal(c.fullySuperseded, true);
    assert.equal(c.coveredByDocumentsWithoutRealReceivable, 0);
    assert.equal(c.precedenceSource, "REAL_RECEIVABLE");
  });

  it("faturamento parcial 60/40", () => {
    const c = computeSalesOrderFinancialCoverage({
      orderActiveValue: 100_000,
      realReceivableTotal: 60_000,
      validDocumentAllocatedValue: 60_000,
    });
    assert.equal(c.coveredByRealReceivables, 60_000);
    assert.equal(c.remainingPlannedValue, 40_000);
    assert.equal(c.partiallySuperseded, true);
  });

  it("documento cobre sem CR; cobertura > pedido vira residual 0", () => {
    const c = computeSalesOrderFinancialCoverage({
      orderActiveValue: 10_000,
      realReceivableTotal: 0,
      validDocumentAllocatedValue: 12_000,
    });
    assert.equal(c.coveredByDocumentsWithoutRealReceivable, 10_000);
    assert.equal(c.remainingPlannedValue, 0);
    assert.equal(c.precedenceSource, "OUTPUT_DOCUMENT");
  });
});

describe("allocateResidualPlannedAmounts", () => {
  it("soma das parcelas residuais = residual exato (centavos na última)", () => {
    const out = allocateResidualPlannedAmounts([100, 100, 100], 100.01);
    assert.equal(out.reduce((s, n) => s + n, 0), 100.01);
    assert.equal(out.length, 3);
  });
});

describe("buildSalesOrderPlannedReceivables — PD 02590", () => {
  it("CR em 2 parcelas substitui previsão 1/1 vencida sem duplicar", () => {
    const result = buildSalesOrderPlannedReceivables({
      salesOrderId: "so-02590",
      orderCode: "PD 02590",
      issueDate: new Date("2026-05-20T12:00:00Z"),
      totalActiveValue: PD_02590.orderActive,
      paymentTerms: "à vista",
      paymentMethod: "Boleto",
      nomusRawResponse: {
        parcelas: [
            {
              numeroParcela: 1,
              valor: PD_02590.orderActive,
              dataVencimento: "19/06/2026",
            },
          ],
      },
      realReceivables: [
        {
          externalId: PD_02590.cr1.id,
          sourceInvoiceId: 88001,
          sourceInvoiceNumber: "2590",
          dueDate: PD_02590.cr1.due,
          amountReceivable: PD_02590.cr1.amount,
          amountReceived: 0,
          balanceReceivable: PD_02590.cr1.amount,
          settlementDate: null,
        },
        {
          externalId: PD_02590.cr2.id,
          sourceInvoiceId: 88001,
          sourceInvoiceNumber: "2590",
          dueDate: PD_02590.cr2.due,
          amountReceivable: PD_02590.cr2.amount,
          amountReceived: 0,
          balanceReceivable: PD_02590.cr2.amount,
          settlementDate: null,
        },
      ],
      nfeDocuments: ["2590"],
      validDocumentAllocatedValue: PD_02590.orderActive,
      referenceDate: new Date("2026-07-10T12:00:00Z"),
    });

    const active = result.planned.filter((p) => !p.replacedByRealCr);
    const superseded = result.planned.filter((p) => p.replacedByRealCr);

    assert.equal(active.length, 0);
    assert.ok(superseded.length >= 1);
    assert.equal(result.totals.applicableExpected, 0);
    assert.equal(result.totals.openExpected, 0);
    assert.equal(result.totals.overdueCount, 0);
    assert.equal(result.totals.fullySuperseded, true);
    assert.equal(result.coverage.coveredByRealReceivables, PD_02590.orderActive);
    assert.ok(superseded.every((p) => p.statusLabel === "Substituída"));
    assert.ok(superseded.every((p) => p.statusLabel !== "Vencido"));
    // Sem dupla contagem: original + CR = 6957.79, não 13915.58
    assert.equal(result.totals.totalExpected, PD_02590.orderActive);
  });

  it("idempotência: duas leituras iguais", () => {
    const input = {
      salesOrderId: "so-02590",
      orderCode: "PD 02590",
      issueDate: new Date("2026-05-20T12:00:00Z"),
      totalActiveValue: PD_02590.orderActive,
      paymentTerms: "à vista",
      paymentMethod: "Boleto",
      nomusRawResponse: {
        parcelas: [{ numeroParcela: 1, valor: PD_02590.orderActive, dataVencimento: "19/06/2026" }],
      },
      realReceivables: [
        {
          externalId: 1,
          sourceInvoiceId: 1,
          sourceInvoiceNumber: "1",
          dueDate: PD_02590.cr1.due,
          amountReceivable: PD_02590.cr1.amount,
          amountReceived: 0,
          balanceReceivable: PD_02590.cr1.amount,
          settlementDate: null,
        },
        {
          externalId: 2,
          sourceInvoiceId: 1,
          sourceInvoiceNumber: "1",
          dueDate: PD_02590.cr2.due,
          amountReceivable: PD_02590.cr2.amount,
          amountReceived: 0,
          balanceReceivable: PD_02590.cr2.amount,
          settlementDate: null,
        },
      ],
      referenceDate: new Date("2026-07-10T12:00:00Z"),
    };
    const a = buildSalesOrderPlannedReceivables(input);
    const b = buildSalesOrderPlannedReceivables(input);
    assert.deepEqual(a.totals, b.totals);
    assert.equal(a.planned.length, b.planned.length);
  });
});

describe("buildSalesOrderPlannedReceivables — cobertura parcial e documento", () => {
  it("CR 60% deixa residual 40% ativo", () => {
    const result = buildSalesOrderPlannedReceivables({
      salesOrderId: "so-partial",
      orderCode: "PD PART",
      issueDate: new Date("2026-01-01T12:00:00Z"),
      totalActiveValue: 100_000,
      paymentTerms: "30 dias",
      paymentMethod: null,
      nomusRawResponse: {
        parcelas: [{ numeroParcela: 1, valor: 100_000, dataVencimento: "01/02/2026" }],
      },
      realReceivables: [
        {
          externalId: 1,
          sourceInvoiceId: 10,
          sourceInvoiceNumber: "10",
          dueDate: new Date("2026-03-01T12:00:00Z"),
          amountReceivable: 60_000,
          amountReceived: 0,
          balanceReceivable: 60_000,
          settlementDate: null,
        },
      ],
      referenceDate: new Date("2026-01-15T12:00:00Z"),
    });
    const active = result.planned.filter((p) => !p.replacedByRealCr);
    assert.equal(active.length, 1);
    assert.equal(active[0]!.expectedAmount, 40_000);
    assert.equal(result.totals.applicableExpected, 40_000);
    assert.equal(result.totals.partiallySuperseded, true);
  });

  it("documento 100% sem CR substitui previsão", () => {
    const result = buildSalesOrderPlannedReceivables({
      salesOrderId: "so-doc",
      orderCode: "PD DOC",
      issueDate: new Date("2026-01-01T12:00:00Z"),
      totalActiveValue: 5000,
      paymentTerms: "30",
      paymentMethod: null,
      nomusRawResponse: {
        parcelas: [{ numeroParcela: 1, valor: 5000, dataVencimento: "10/01/2026" }],
      },
      realReceivables: [],
      validDocumentAllocatedValue: 5000,
      referenceDate: new Date("2026-02-01T12:00:00Z"),
    });
    assert.equal(result.planned.every((p) => p.replacedByRealCr), true);
    assert.equal(result.totals.applicableExpected, 0);
    assert.equal(result.totals.overdueCount, 0);
    assert.ok(result.planned.every((p) => p.statusLabel === "Substituída"));
  });

  it("pedido sem cobertura mantém previsão integral", () => {
    const result = buildSalesOrderPlannedReceivables({
      salesOrderId: "so-open",
      orderCode: "PD OPEN",
      issueDate: new Date("2026-01-01T12:00:00Z"),
      totalActiveValue: 2000,
      paymentTerms: "30",
      paymentMethod: null,
      nomusRawResponse: {
        parcelas: [{ numeroParcela: 1, valor: 2000, dataVencimento: "01/03/2026" }],
      },
      realReceivables: [],
      referenceDate: new Date("2026-01-15T12:00:00Z"),
    });
    assert.equal(result.planned.length, 1);
    assert.equal(result.planned[0]!.replacedByRealCr, false);
    assert.equal(result.totals.applicableExpected, 2000);
    assert.equal(result.coverage.precedenceSource, "ORDER_PLAN");
  });
});
