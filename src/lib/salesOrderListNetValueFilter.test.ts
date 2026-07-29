import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildSalesOrderListFilterLabels,
  parseSalesOrderListNetValueParam,
  parseSalesOrderListQuery,
} from "./salesOrderListQuery.server.js";

describe("salesOrderListQuery — valor líquido", () => {
  it("parse aceita número, vírgula BR e rejeita inválido", () => {
    assert.equal(parseSalesOrderListNetValueParam("1500.5"), 1500.5);
    assert.equal(parseSalesOrderListNetValueParam("1500,5"), 1500.5);
    assert.equal(parseSalesOrderListNetValueParam(" 2000 "), 2000);
    assert.equal(parseSalesOrderListNetValueParam(""), null);
    assert.equal(parseSalesOrderListNetValueParam("-10"), null);
    assert.equal(parseSalesOrderListNetValueParam("abc"), null);
  });

  it("parseSalesOrderListQuery inclui minNetValue/maxNetValue", () => {
    const q = parseSalesOrderListQuery({
      minNetValue: "1000",
      maxNetValue: "5000,50",
    });
    assert.equal(q.minNetValue, 1000);
    assert.equal(q.maxNetValue, 5000.5);
  });

  it("labels de filtro exibem Valor de/até", () => {
    const labels = buildSalesOrderListFilterLabels(
      parseSalesOrderListQuery({ minNetValue: "1000", maxNetValue: "2000" })
    );
    assert.ok(labels.some((l) => l.label === "Valor de"));
    assert.ok(labels.some((l) => l.label === "Valor até"));
  });
});
