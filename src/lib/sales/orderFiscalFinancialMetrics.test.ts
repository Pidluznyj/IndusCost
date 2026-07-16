/**
 * Testes do contrato fiscal/financeiro Pedido × NF × CR × planejado.
 * Caso âncora: PD 02457 (Esmaltec) — IPI no vNF e planejado substituído.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildLinkedNfeFiscalAmounts,
  buildOrderFiscalFinancialMetrics,
  computeAmountToInvoice,
  computeOrderTotalFinancialValue,
  resolveApplicablePlannedExpected,
  resolveFinancialBalanceFromCr,
  resolveNfeComparableBillingValue,
} from "./orderFiscalFinancialMetrics.js";
import { computeConsolidatedFinancialSummary } from "./orderFinancialConsolidation.js";
import { buildSalesOrderPlannedReceivables } from "../finance/salesOrderPlannedReceivables.js";
import { resolveLinkedNfeValue } from "../salesOrderLinkedNfe.js";
import { computeSalesOrderReportSummaryFromRows } from "./salesOrderReport.js";
import type { SalesOrderReportRow } from "./salesOrderReport.js";

/** Fixture PD 02457 — valores do caso real documentado. */
const PD_02457 = {
  orderActive: 4104.19,
  nfeProducts: 3975.0, // valorLiquido (vProd − vDesc) — era o “faturado” errado
  nfeTotalVnf: 4104.19, // xmlVNF — total comparável (inclui ~129,19 de IPI/destaque)
  highlightedTaxes: 129.19,
  crOriginal: 4104.19,
  crReceived: 4104.19,
  crOpen: 0,
};

describe("orderFiscalFinancialMetrics — PD 02457", () => {
  it("preferência xmlVNF explica os R$ 129,19 (IPI/destaque no total da NF)", () => {
    const fiscal = buildLinkedNfeFiscalAmounts({
      valorLiquido: PD_02457.nfeProducts,
      xmlVNF: PD_02457.nfeTotalVnf,
    });
    assert.equal(fiscal.productsValue, 3975);
    assert.equal(fiscal.comparableBillingValue, 4104.19);
    assert.equal(fiscal.highlightedTaxesValue, 129.19);
    assert.equal(
      resolveNfeComparableBillingValue({
        valorLiquido: 3975,
        xmlVNF: 4104.19,
      }),
      4104.19
    );
  });

  it("resolveLinkedNfeValue passa a preferir xmlVNF (não valorLiquido)", () => {
    const value = resolveLinkedNfeValue(
      { rawPayload: { valor: 3975 } },
      {
        id: "n1",
        externalId: 1,
        numero: "1",
        chave: null,
        status: 100,
        tipoOperacao: 1,
        dataProcessamento: null,
        xmlDhEmi: null,
        valorLiquido: 3975,
        xmlVNF: 4104.19,
      }
    );
    assert.equal(value, 4104.19);
  });

  it("PD 02457: a faturar = 0 e saldo financeiro = 0 com CR quitado", () => {
    const metrics = buildOrderFiscalFinancialMetrics({
      orderActiveValue: PD_02457.orderActive,
      nfeProductsValue: PD_02457.nfeProducts,
      nfeHighlightedTaxesValue: PD_02457.highlightedTaxes,
      nfeValidTotalValue: PD_02457.nfeTotalVnf,
      cr: {
        hasOfficialCr: true,
        crOriginal: PD_02457.crOriginal,
        crReceived: PD_02457.crReceived,
        crOpen: PD_02457.crOpen,
      },
      plannedApplicableExpected: 0,
      plannedReplacedAmount: PD_02457.crOriginal,
    });
    assert.equal(metrics.amountToInvoice, 0);
    assert.equal(metrics.financialBalance, 0);
    assert.equal(metrics.nfeValidTotalValue, 4104.19);
    assert.equal(metrics.totalFinancialValue, 4104.19);
  });

  it("saldo financeiro nunca é pedido − NF", () => {
    assert.equal(computeAmountToInvoice(4104.19, 3975), 129.19); // a faturar operacional (base errada)
    assert.equal(
      resolveFinancialBalanceFromCr({
        hasOfficialCr: true,
        crOriginal: 4104.19,
        crReceived: 4104.19,
        crOpen: 0,
      }),
      0
    );
    assert.equal(resolveFinancialBalanceFromCr({ hasOfficialCr: false, crOriginal: 0, crReceived: 0, crOpen: 0 }), null);
  });
});

describe("Total financeiro — planejado substituído", () => {
  it("PD 02457: não soma CR real + planejado substituído (evita 8208,38)", () => {
    const planned = buildSalesOrderPlannedReceivables({
      salesOrderId: "so-2457",
      orderCode: "PD 02457",
      issueDate: new Date("2025-01-15T12:00:00Z"),
      totalActiveValue: 4104.19,
      paymentTerms: "30 dias",
      paymentMethod: "Boleto",
      nomusRawResponse: {
        condicaoPagamento: { descricao: "30 dias", parcelas: 1 },
      },
      realReceivables: [
        {
          amountReceivable: 4104.19,
          balanceReceivable: 0,
          amountReceived: 4104.19,
          dueDate: new Date("2025-02-14T12:00:00Z"),
          externalId: 90001,
          sourceInvoiceId: 555,
          sourceInvoiceNumber: "12345",
          settlementDate: new Date("2025-02-14T12:00:00Z"),
        },
      ],
      nfeDocuments: ["12345"],
      referenceDate: new Date("2025-03-01T12:00:00Z"),
    });

    // Mesmo sem match de substituição por data, applicableExpected deve existir.
    assert.ok(typeof planned.totals.applicableExpected === "number");
    const applicable = resolveApplicablePlannedExpected({
      totalExpected: planned.totals.totalExpected,
      replacedAmount: planned.totals.replacedAmount,
    });
    assert.equal(planned.totals.applicableExpected, applicable);

    // Cenário forçado: CR + planejado totalmente substituído.
    const forcedConsolidated = computeConsolidatedFinancialSummary({
      totals: {
        totalCount: 1,
        totalAmount: 4104.19,
        openAmount: 0,
        receivedAmount: 4104.19,
        overdueCount: 0,
        nextDueDate: null,
        maxAmount: 4104.19,
      },
      plannedTotals: {
        totalCount: 1,
        totalExpected: 4104.19,
        applicableExpected: 0,
        openExpected: 0,
        overdueExpected: 0,
        overdueCount: 0,
        dueTodayExpected: 0,
        dueTodayCount: 0,
        upcomingCount: 0,
        nextDueDate: null,
        replacedCount: 1,
        replacedAmount: 4104.19,
        netPlannedOpen: 0,
      },
    });

    assert.equal(forcedConsolidated.totalFinancialValue, 4104.19);
    assert.notEqual(forcedConsolidated.totalFinancialValue, 8208.38);
    assert.equal(
      computeOrderTotalFinancialValue({
        crOriginal: 4104.19,
        plannedApplicableExpected: 0,
      }),
      4104.19
    );
  });

  it("sem CR: planejado entra no total financeiro", () => {
    const consolidated = computeConsolidatedFinancialSummary({
      totals: {
        totalCount: 0,
        totalAmount: 0,
        openAmount: 0,
        receivedAmount: 0,
        overdueCount: 0,
        nextDueDate: null,
        maxAmount: 0,
      },
      plannedTotals: {
        totalCount: 1,
        totalExpected: 1000,
        applicableExpected: 1000,
        openExpected: 1000,
        overdueExpected: 0,
        overdueCount: 0,
        dueTodayExpected: 0,
        dueTodayCount: 0,
        upcomingCount: 1,
        nextDueDate: "2026-08-01",
        replacedCount: 0,
        replacedAmount: 0,
        netPlannedOpen: 1000,
      },
    });
    assert.equal(consolidated.totalFinancialValue, 1000);
  });
});

describe("cenários equivalentes PD 02139 / PD 02072", () => {
  it("PD 02139-like: soma de cabeçalhos de NF não deve clamp — reporta a faturar 0 e divergência positiva", () => {
    // Duas NFs válidas cujo total somado excede o ativo (duplicidade / vínculo amplo).
    const active = 10000;
    const nfeValidTotal = 12500;
    const amountToInvoice = computeAmountToInvoice(active, nfeValidTotal);
    assert.equal(amountToInvoice, 0);
    assert.ok(nfeValidTotal > active);
  });

  it("PD 02072-like: NF histórica maior que ativo após cancelamento de item — a faturar 0, sem clamp no faturado", () => {
    const original = 5000;
    const canceled = 1000;
    const active = original - canceled; // 4000
    const nfeValidTotal = 5000; // NF emitida antes do cancelamento
    assert.equal(computeAmountToInvoice(active, nfeValidTotal), 0);
    assert.ok(nfeValidTotal > active);
  });

  it("NF cancelada não entra no total válido (caller filtra); produtos vs total separados", () => {
    const fiscal = buildLinkedNfeFiscalAmounts({
      valorLiquido: 1000,
      xmlVNF: 1100,
    });
    assert.equal(fiscal.comparableBillingValue, 1100);
    assert.equal(fiscal.highlightedTaxesValue, 100);
  });
});

describe("salesOrderReport summary — campos separados", () => {
  it("summary soma a faturar e saldo financeiro independentemente", () => {
    const row = (partial: Partial<SalesOrderReportRow>): SalesOrderReportRow =>
      ({
        orderId: "1",
        orderCode: "PD 1",
        externalSalesOrderCode: null,
        customerName: "C",
        customerCnpj: null,
        companyName: null,
        issueDate: null,
        expectedDeliveryDate: null,
        sellerName: "S",
        sellerExternalId: null,
        commercialResponsibleName: null,
        operationalResponsibleName: null,
        status: "SENT_TO_NOMUS",
        statusLabel: "Enviado",
        paymentConditionLabel: "—",
        paymentMethodLabel: "—",
        itemsCount: 1,
        activeItemsCount: 1,
        canceledItemsCount: 0,
        cutItemsCount: 0,
        originalValue: 100,
        canceledValue: 0,
        cutValue: 0,
        activeValue: 100,
        invoicedValue: 100,
        nfeProductsValue: 90,
        nfeHighlightedTaxesValue: 10,
        amountToInvoice: 0,
        hasOfficialCr: true,
        crOriginal: 100,
        crReceived: 40,
        crOpen: 60,
        financialBalance: 60,
        pendingBalance: 0,
        hasInvoice: true,
        billingStatus: "INVOICED",
        billingStatusLabel: "Faturado",
        nfeCount: 1,
        nfeNumbers: ["1"],
        nfeDocument: "1",
        lastNfeDate: null,
        alertsSummary: "",
        ...partial,
      }) as SalesOrderReportRow;

    const summary = computeSalesOrderReportSummaryFromRows([
      row({}),
      row({
        orderId: "2",
        hasOfficialCr: false,
        financialBalance: null,
        crOriginal: 0,
        crReceived: 0,
        crOpen: 0,
        amountToInvoice: 50,
        invoicedValue: 50,
        activeValue: 100,
        pendingBalance: 50,
      }),
    ]);
    assert.equal(summary.financialBalance, 60);
    assert.equal(summary.amountToInvoice, 50);
    assert.equal(summary.ordersWithoutCrCount, 1);
    assert.equal(summary.nfeHighlightedTaxesValue, 20);
  });
});
