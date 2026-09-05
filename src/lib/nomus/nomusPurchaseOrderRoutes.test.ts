import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseNomusPurchaseOrderListFilters } from "./nomusPurchaseOrderQuery.js";

const VIEW_PERMISSIONS = [
  "purchases.nomusPurchaseOrders.view",
  "purchases.view",
  "settings.nomus.view",
];

describe("nomusPurchaseOrder API contract", () => {
  it("listagem pagina e filtra no backend", () => {
    const filters = parseNomusPurchaseOrderListFilters({
      fornecedor: "Acme",
      somenteAtrasados: "true",
      page: "3",
      pageSize: "25",
    });
    assert.equal(filters.supplier, "Acme");
    assert.equal(filters.overdueOnly, true);
    assert.equal(filters.page, 3);
    assert.equal(filters.pageSize, 25);
  });

  it("permissões de leitura não incluem escrita", () => {
    assert.ok(VIEW_PERMISSIONS.includes("purchases.nomusPurchaseOrders.view"));
    assert.ok(!VIEW_PERMISSIONS.some((key) => /create|edit|delete|approve|sync/i.test(key)));
  });
});
