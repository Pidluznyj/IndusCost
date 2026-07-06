import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateValidSalesOrderRevenueByCustomer,
  getSalesOrderNetValue,
  isInvoicedSalesOrder,
  isOpenPortfolioSalesOrder,
  isOverdueOpenSalesOrder,
  isPurchaseSalesOrder,
  isValidCommercialSalesOrder,
  normalizeCustomerDocument,
  salesOrderMatchesCustomer,
} from "./crmCommercialOrderRules.js";

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";

describe("crmCommercialOrderRules", () => {
  it("pedido CANCELLED não entra em métricas", () => {
    assert.equal(isValidCommercialSalesOrder({ status: "CANCELLED" }), false);
    assert.equal(isOpenPortfolioSalesOrder({ status: "CANCELLED", nomusRawResponse: null }), false);
  });

  it("pedido ERROR não entra em métricas", () => {
    assert.equal(isValidCommercialSalesOrder({ status: "ERROR" }), false);
    assert.equal(isOpenPortfolioSalesOrder({ status: "ERROR", nomusRawResponse: null }), false);
  });

  it("pedido válido entra em receita/carteira", () => {
    assert.equal(isValidCommercialSalesOrder({ status: "READY_TO_SEND" }), true);
    assert.equal(
      isOpenPortfolioSalesOrder({ status: "READY_TO_SEND", nomusRawResponse: { nfes: [] } }),
      true
    );
  });

  it("pedido com NF processada é faturado", () => {
    const order = {
      status: "SENT_TO_NOMUS",
      nomusRawResponse: { nfes: [{ dataProcessamento: "15/01/2025" }] },
    };
    assert.equal(isInvoicedSalesOrder(order), true);
    assert.equal(isOpenPortfolioSalesOrder(order), false);
  });

  it("pedido válido sem NF processada é carteira aberta", () => {
    const order = { status: "READY_TO_SEND", nomusRawResponse: { nfes: [] } };
    assert.equal(isOpenPortfolioSalesOrder(order), true);
    assert.equal(isInvoicedSalesOrder(order), false);
  });

  it("pedido aberto com expectedDeliveryDate vencida é atrasado", () => {
    const today = new Date("2026-06-12T12:00:00.000Z");
    const order = {
      status: "READY_TO_SEND",
      expectedDeliveryDate: new Date("2026-06-01T00:00:00.000Z"),
      nomusRawResponse: { nfes: [] },
    };
    assert.equal(isOverdueOpenSalesOrder(order, today), true);
  });

  it("match por customerId funciona", () => {
    const customer = { id: CUSTOMER_ID, taxId: "12.345.678/0001-90" };
    assert.equal(salesOrderMatchesCustomer(CUSTOMER_ID, customer, null), true);
  });

  it("match por CNPJ normalizado funciona", () => {
    const customer = { id: CUSTOMER_ID, taxId: "12.345.678/0001-90" };
    assert.equal(
      salesOrderMatchesCustomer("other-id", customer, "12345678000190"),
      true
    );
    assert.equal(normalizeCustomerDocument("12.345.678/0001-90"), "12345678000190");
  });

  it("totalNetValue é usado como valor principal quando existir", () => {
    assert.equal(getSalesOrderNetValue({ totalNetValue: 125000.5 }), 125000.5);
    const agg = aggregateValidSalesOrderRevenueByCustomer([
      { customerId: CUSTOMER_ID, totalNetValue: 100, status: "READY_TO_SEND" },
      { customerId: CUSTOMER_ID, totalNetValue: 50, status: "SENT_TO_NOMUS" },
      { customerId: CUSTOMER_ID, totalNetValue: 999, status: "CANCELLED" },
    ]);
    assert.equal(agg[0]?.revenue, 150);
  });

  it("funções não retornam NaN/Infinity", () => {
    assert.equal(getSalesOrderNetValue({ totalNetValue: "invalid" }), 0);
    assert.equal(getSalesOrderNetValue({ totalNetValue: Infinity }), 0);
    assert.ok(Number.isFinite(getSalesOrderNetValue({ totalNetValue: 10 })));
    assert.equal(isPurchaseSalesOrder({ status: "READY_TO_SEND" }), true);
    assert.equal(isPurchaseSalesOrder({ status: "DRAFT" }), false);
  });
});
