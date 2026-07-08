import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSalesOrderListPaymentOpeningRows,
  buildSalesOrderListPaymentReportSummary,
  extractSalesOrderForecastInstallments,
  formatSalesOrderListPaymentScheduleText,
  resolveSalesOrderListPaymentSummary,
  SALES_ORDER_PAYMENT_CASH_LABEL,
  SALES_ORDER_PAYMENT_NOT_INFORMED,
  SALES_ORDER_PAYMENT_SOURCE_AR,
  SALES_ORDER_PAYMENT_SOURCE_FORECAST,
} from "./salesOrderListPaymentSchedule.js";

describe("salesOrderListPaymentSchedule", () => {
  const issueDate = new Date("2026-07-08T12:00:00.000Z");

  it("pedido com títulos reais usa vencimentos do Contas a Receber", () => {
    const payment = resolveSalesOrderListPaymentSummary({
      paymentTerms: "30/60/90",
      paymentMethod: "Boleto",
      issueDate,
      totalNetValue: 30000,
      nomusRawResponse: null,
      nfeDocuments: ["12345"],
      receivables: [
        {
          externalId: 1,
          sourceInvoiceId: 99,
          sourceInvoiceNumber: "12345",
          dueDate: new Date("2026-08-08T12:00:00.000Z"),
          amountReceivable: 10000,
          amountReceived: 0,
          balanceReceivable: 10000,
          settlementDate: null,
        },
        {
          externalId: 2,
          sourceInvoiceId: 99,
          sourceInvoiceNumber: "12345",
          dueDate: new Date("2026-09-08T12:00:00.000Z"),
          amountReceivable: 20000,
          amountReceived: 0,
          balanceReceivable: 20000,
          settlementDate: null,
        },
      ],
    });

    assert.equal(payment.paymentSourceLabel, SALES_ORDER_PAYMENT_SOURCE_AR);
    assert.equal(payment.installmentCount, 2);
    assert.match(payment.scheduleText, /08\/08\/2026/);
    assert.match(payment.scheduleText, /08\/09\/2026/);
    assert.equal(payment.financialStatusLabel, "A vencer");
  });

  it("pedido sem títulos usa condição prevista do pedido", () => {
    const payment = resolveSalesOrderListPaymentSummary({
      paymentTerms: "30/60",
      paymentMethod: null,
      issueDate,
      totalNetValue: 20000,
      nomusRawResponse: {
        parcelas: [
          { numeroParcela: 1, dataVencimento: "08/08/2026", valor: 10000 },
          { numeroParcela: 2, dataVencimento: "08/09/2026", valor: 10000 },
        ],
      },
      nfeDocuments: [],
      receivables: [],
    });

    assert.equal(payment.paymentSourceLabel, SALES_ORDER_PAYMENT_SOURCE_FORECAST);
    assert.equal(payment.installmentCount, 2);
    assert.match(payment.scheduleText, /2x:/);
  });

  it("pedido à vista com evidência textual", () => {
    const payment = resolveSalesOrderListPaymentSummary({
      paymentTerms: "À vista",
      paymentMethod: null,
      issueDate,
      totalNetValue: 10000,
      nomusRawResponse: null,
      nfeDocuments: [],
      receivables: [],
    });

    assert.equal(payment.scheduleText, SALES_ORDER_PAYMENT_CASH_LABEL);
    assert.equal(payment.isCashPayment, true);
  });

  it("pedido sem dados de pagamento mostra Não informado", () => {
    const payment = resolveSalesOrderListPaymentSummary({
      paymentTerms: null,
      paymentMethod: null,
      issueDate,
      totalNetValue: 10000,
      nomusRawResponse: null,
      nfeDocuments: [],
      receivables: [],
    });

    assert.equal(payment.scheduleText, SALES_ORDER_PAYMENT_NOT_INFORMED);
    assert.equal(payment.paymentSourceLabel, SALES_ORDER_PAYMENT_NOT_INFORMED);
  });

  it("cronograma parcelado formata múltiplas parcelas", () => {
    const lines = [
      {
        installmentNumber: 1,
        dueDate: new Date("2026-07-08T12:00:00.000Z"),
        amount: 10000,
        statusLabel: null,
        settlementDate: null,
        amountReceived: null,
        openBalance: null,
        nomusReceivableId: null,
        nfeDocument: null,
      },
      {
        installmentNumber: 2,
        dueDate: new Date("2026-08-08T12:00:00.000Z"),
        amount: 10000,
        statusLabel: null,
        settlementDate: null,
        amountReceived: null,
        openBalance: null,
        nomusReceivableId: null,
        nfeDocument: null,
      },
    ];
    const text = formatSalesOrderListPaymentScheduleText(lines);
    assert.match(text, /2x:/);
    assert.match(text, /08\/07\/2026/);
    assert.match(text, /08\/08\/2026/);
  });

  it("abertura de pagamentos gera uma linha por parcela/título", () => {
    const payment = resolveSalesOrderListPaymentSummary({
      paymentTerms: "30/60",
      paymentMethod: null,
      issueDate,
      totalNetValue: 20000,
      nomusRawResponse: {
        parcelas: [
          { numeroParcela: 1, dataVencimento: "08/08/2026", valor: 10000 },
          { numeroParcela: 2, dataVencimento: "08/09/2026", valor: 10000 },
        ],
      },
      nfeDocuments: [],
      receivables: [],
    });

    const opening = buildSalesOrderListPaymentOpeningRows({
      orderCode: "PD-0001",
      customerName: "Cliente A",
      sellerName: "Vendedor A",
      nfeDocument: "",
      payment,
    });

    assert.equal(opening.length, 2);
    assert.equal(opening[0]?.installmentNumber, 1);
    assert.equal(opening[1]?.installmentNumber, 2);
  });

  it("resumo agrega indicadores de pagamento", () => {
    const cash = resolveSalesOrderListPaymentSummary({
      paymentTerms: "À vista",
      paymentMethod: null,
      issueDate,
      totalNetValue: 1000,
      nomusRawResponse: null,
      nfeDocuments: [],
      receivables: [],
    });
    const forecast = resolveSalesOrderListPaymentSummary({
      paymentTerms: "30/60",
      paymentMethod: null,
      issueDate,
      totalNetValue: 2000,
      nomusRawResponse: {
        parcelas: [
          { numeroParcela: 1, dataVencimento: "08/08/2026", valor: 1000 },
          { numeroParcela: 2, dataVencimento: "08/09/2026", valor: 1000 },
        ],
      },
      nfeDocuments: [],
      receivables: [],
    });
    const unknown = resolveSalesOrderListPaymentSummary({
      paymentTerms: null,
      paymentMethod: null,
      issueDate,
      totalNetValue: 500,
      nomusRawResponse: null,
      nfeDocuments: [],
      receivables: [],
    });

    const summary = buildSalesOrderListPaymentReportSummary({
      payments: [cash, forecast, unknown],
    });

    assert.equal(summary.cashOrdersCount, 1);
    assert.equal(summary.installmentOrdersCount, 1);
    assert.equal(summary.noPaymentInfoCount, 1);
    assert.equal(summary.withForecastOnlyCount, 2);
  });

  it("extractSalesOrderForecastInstallments lê parcelas do raw Nomus", () => {
    const installments = extractSalesOrderForecastInstallments(
      {
        condicaoPagamentoParcelas: [
          { numeroParcela: 1, dataVencimento: "08/08/2026", valorParcela: 1500 },
        ],
      },
      1500,
      issueDate
    );
    assert.equal(installments.length, 1);
    assert.equal(installments[0]?.expectedAmount, 1500);
  });
});
