import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatSalesOrderListInvoicedLabel,
  salesOrderListInvoicedBadgeClass,
} from "./salesOrderListInvoicing.js";

describe("salesOrderListInvoicing", () => {
  it("rótulo Sim/Não conforme hasInvoice", () => {
    assert.equal(formatSalesOrderListInvoicedLabel(true), "Sim");
    assert.equal(formatSalesOrderListInvoicedLabel(false), "Não");
  });

  it("badge CSS verde para faturado e âmbar para não faturado", () => {
    assert.match(salesOrderListInvoicedBadgeClass(true), /--yes/);
    assert.match(salesOrderListInvoicedBadgeClass(false), /--no/);
  });
});
