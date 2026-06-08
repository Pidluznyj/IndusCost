import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CUSTOMER_LIST_DEFAULT_LIMIT,
  CUSTOMER_LIST_MAX_LIMIT,
  buildCustomerListResponse,
  customerListMeta,
  formatCustomerListRange,
  parseCustomerListQuery,
  shouldUseCustomerPagination,
} from "./customerListQuery.js";

describe("customerListQuery", () => {
  it("uses limit=20 by default", () => {
    const q = parseCustomerListQuery({});
    assert.equal(q.limit, CUSTOMER_LIST_DEFAULT_LIMIT);
    assert.equal(q.page, 1);
    assert.equal(q.skip, 0);
  });

  it("search resets pagination math on page 1", () => {
    const q = parseCustomerListQuery({ page: "1", limit: "20", search: "acme" });
    assert.equal(q.search, "acme");
    assert.equal(q.skip, 0);
  });

  it("calculates totalPages correctly", () => {
    assert.equal(customerListMeta(45, 1, 20).totalPages, 3);
    assert.equal(customerListMeta(0, 1, 20).totalPages, 1);
  });

  it("respects limit maximum", () => {
    const q = parseCustomerListQuery({ limit: "999" });
    assert.equal(q.limit, CUSTOMER_LIST_MAX_LIMIT);
  });

  it("buildCustomerListResponse exposes items and legacy customers key", () => {
    const body = buildCustomerListResponse([{ id: "1" }], customerListMeta(1, 1, 20));
    assert.equal(body.total, 1);
    assert.equal(body.totalPages, 1);
    assert.deepEqual(body.items, [{ id: "1" }]);
    assert.deepEqual(body.customers, [{ id: "1" }]);
  });

  it("formatCustomerListRange avoids NaN", () => {
    assert.equal(formatCustomerListRange(customerListMeta(0, 1, 20)), "Nenhum cliente encontrado");
    assert.equal(formatCustomerListRange(customerListMeta(25, 2, 20)), "Mostrando 21–25 de 25 clientes");
  });

  it("shouldUseCustomerPagination detects paginated requests", () => {
    assert.equal(shouldUseCustomerPagination({}), false);
    assert.equal(shouldUseCustomerPagination({ page: "1" }), true);
    assert.equal(shouldUseCustomerPagination({ search: "x" }), true);
  });
});
