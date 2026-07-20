import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildSalesOrderListWhereForQuery,
  parseSalesOrderListHasInvoiceParam,
  parseSalesOrderListQuery,
} from "./salesOrderListQuery.server.js";
import { parseSalesOrderSellerKey } from "./salesOrderNomusSellerDisplay.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("parseSalesOrderListHasInvoiceParam", () => {
  it("aceita true/false e aliases 1/0", () => {
    assert.equal(parseSalesOrderListHasInvoiceParam("true"), true);
    assert.equal(parseSalesOrderListHasInvoiceParam("false"), false);
    assert.equal(parseSalesOrderListHasInvoiceParam("1"), true);
    assert.equal(parseSalesOrderListHasInvoiceParam("0"), false);
    assert.equal(parseSalesOrderListHasInvoiceParam(""), null);
    assert.equal(parseSalesOrderListHasInvoiceParam("todos"), null);
  });
});

describe("parseSalesOrderListQuery — hasInvoice", () => {
  it("propaga hasInvoice para o where da listagem", () => {
    const withNf = parseSalesOrderListQuery({ hasInvoice: "true", page: "1" });
    assert.equal(withNf.hasInvoice, true);
    const whereWith = buildSalesOrderListWhereForQuery(withNf, null);
    assert.match(JSON.stringify(whereWith), /"some"/);

    const withoutNf = parseSalesOrderListQuery({ hasInvoice: "false" });
    assert.equal(withoutNf.hasInvoice, false);
    const whereWithout = buildSalesOrderListWhereForQuery(withoutNf, null);
    assert.match(JSON.stringify(whereWithout), /"none"/);

    const all = parseSalesOrderListQuery({});
    assert.equal(all.hasInvoice, null);
    assert.equal(all.sellerKey.kind, parseSalesOrderSellerKey("").kind);
  });
});

describe("SalesOrdersModule — filtro Vínculo NF", () => {
  it("expõe select e envia hasInvoice na query/export", () => {
    const module = read("src/components/SalesOrdersModule.tsx");
    assert.match(module, /INVOICE_FILTER_OPTIONS/);
    assert.match(module, /sales-orders-filter-has-invoice/);
    assert.match(module, /params\.set\("hasInvoice", hasInvoice\)/);
    assert.match(module, /setHasInvoice\(""\)/);
  });
});
