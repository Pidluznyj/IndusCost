import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { getSalesOrderResultApiPath } from "./salesOrderResultApi.js";
import { parseSalesOrderResultFilters } from "./salesOrderResultEngine.server.js";

function read(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

describe("salesOrderResult official list scope", () => {
  it("API path envia parâmetros canônicos da listagem", () => {
    const path = getSalesOrderResultApiPath({
      year: 2026,
      month: 4,
      customerId: "c1",
      sellerKey: "seller:12",
      status: "OPEN",
      hasInvoice: "true",
      receivableStatus: "open",
      asOfDate: "2026-07-20",
    });
    assert.match(path, /\/api\/sales-orders\/results\?/);
    assert.match(path, /year=2026/);
    assert.match(path, /month=4/);
    assert.match(path, /customerId=c1/);
    assert.match(path, /sellerKey=seller%3A12|sellerKey=seller:12/);
    assert.match(path, /status=OPEN/);
    assert.match(path, /hasInvoice=true/);
    assert.match(path, /receivableStatus=open/);
    assert.doesNotMatch(path, /responsible=/);
  });

  it("parse de filtros usa parseSalesOrderListQuery (não indicators)", () => {
    const filters = parseSalesOrderResultFilters({
      year: "2026",
      month: "6",
      customerId: "cust-1",
      sellerKey: "no_seller",
      status: "CANCELLED",
      hasInvoice: "false",
      receivableStatus: "none",
      productId: "prod-1",
      asOfDate: "2026-06-15",
    });
    assert.equal(filters.year, 2026);
    assert.equal(filters.month, 6);
    assert.equal(filters.customerId, "cust-1");
    assert.equal(filters.sellerKey, "no_seller");
    assert.equal(filters.status, "CANCELLED");
    assert.equal(filters.hasInvoice, "false");
    assert.equal(filters.receivableStatus, "none");
    assert.equal(filters.productId, "prod-1");
    assert.equal(filters.asOfDate, "2026-06-15");
  });

  it("engine Resultado consome where oficial da listagem e margem oficial", () => {
    const engine = read("src/lib/salesOrderResultEngine.server.ts");
    assert.match(engine, /parseSalesOrderListQuery/);
    assert.match(engine, /resolveSalesOrderListWhere/);
    assert.match(engine, /resolveSalesOrderListSellerWhere/);
    assert.match(engine, /buildSalesOrderMarginContext/);
    assert.match(engine, /buildOfficialSalesMarginRulesResult/);
    assert.match(engine, /SALES_ORDER_RULES_PRISMA_SELECT/);
    assert.match(engine, /SALES_ORDER_ITEM_MARGIN_SELECT/);
    assert.doesNotMatch(engine, /buildSalesOrderMarginIndicatorWhere/);
    assert.doesNotMatch(engine, /parseSalesOrderMarginIndicatorFilters/);
  });

  it("UI Resultado usa filtros alinhados à listagem", () => {
    const page = read("src/components/sales/SalesOrderResultPage.tsx");
    assert.match(page, /sellerKey/);
    assert.match(page, /hasInvoice/);
    assert.match(page, /receivableStatus/);
    assert.match(page, /getSalesOrderSellerFilterOptionsUrl/);
    assert.match(page, /sales-order-result-filter-seller/);
    assert.match(page, /mesmo escopo|Mesmo escopo/i);
  });
});
