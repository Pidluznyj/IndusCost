import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  andSalesOrderListWhere,
  buildSalesOrderListReceivableStatusWhereFromSets,
  parseSalesOrderListReceivableStatusParam,
} from "./salesOrderListReceivableFilter.js";
import { parseSalesOrderListQuery } from "./salesOrderListQuery.server.js";

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("parseSalesOrderListReceivableStatusParam", () => {
  it("aceita open/settled/none e rejeita inválido", () => {
    assert.equal(parseSalesOrderListReceivableStatusParam("open"), "open");
    assert.equal(parseSalesOrderListReceivableStatusParam("settled"), "settled");
    assert.equal(parseSalesOrderListReceivableStatusParam("none"), "none");
    assert.equal(parseSalesOrderListReceivableStatusParam(""), null);
    assert.equal(parseSalesOrderListReceivableStatusParam("aberto"), null);
  });
});

describe("buildSalesOrderListReceivableStatusWhereFromSets", () => {
  const sets = {
    withAnyCr: new Set(["a", "b", "c"]),
    withOpenCr: new Set(["a", "b"]),
  };

  it("open → só pedidos com saldo em aberto", () => {
    const where = buildSalesOrderListReceivableStatusWhereFromSets("open", sets);
    assert.deepEqual(where, { id: { in: ["a", "b"] } });
  });

  it("settled → tem CR e sem aberto", () => {
    const where = buildSalesOrderListReceivableStatusWhereFromSets("settled", sets);
    assert.deepEqual(where, { id: { in: ["c"] } });
  });

  it("none → exclui quem tem CR", () => {
    const where = buildSalesOrderListReceivableStatusWhereFromSets("none", sets);
    assert.deepEqual(where, { id: { notIn: ["a", "b", "c"] } });
  });

  it("none sem nenhum CR → where vazio (todos)", () => {
    const where = buildSalesOrderListReceivableStatusWhereFromSets("none", {
      withAnyCr: new Set(),
      withOpenCr: new Set(),
    });
    assert.deepEqual(where, {});
  });
});

describe("andSalesOrderListWhere", () => {
  it("combina base + extra", () => {
    const merged = andSalesOrderListWhere(
      { status: "SENT_TO_NOMUS" },
      { id: { in: ["x"] } }
    );
    assert.deepEqual(merged, {
      AND: [{ status: "SENT_TO_NOMUS" }, { id: { in: ["x"] } }],
    });
  });
});

describe("parseSalesOrderListQuery — receivableStatus", () => {
  it("propaga receivableStatus=open", () => {
    const parsed = parseSalesOrderListQuery({ receivableStatus: "open" });
    assert.equal(parsed.receivableStatus, "open");
  });
});

describe("SalesOrdersModule — filtro Status CR", () => {
  it("expõe select e envia receivableStatus na query/export", () => {
    const module = read("src/components/SalesOrdersModule.tsx");
    assert.match(module, /RECEIVABLE_STATUS_FILTER_OPTIONS/);
    assert.match(module, /sales-orders-filter-receivable-status/);
    assert.match(module, /params\.set\("receivableStatus", receivableStatus\)/);
    assert.match(module, /setReceivableStatus\(""\)/);
  });
});
