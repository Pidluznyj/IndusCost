import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  andSalesOrderListWhere,
  buildSalesOrderListReceivableStatusWhereFromSets,
  buildSalesOrderListReceivableStatusesWhereFromSets,
  formatSalesOrderListReceivableStatusParam,
  parseSalesOrderListReceivableStatusParam,
  parseSalesOrderListReceivableStatusParams,
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

describe("parseSalesOrderListReceivableStatusParams", () => {
  it("aceita valor único e CSV", () => {
    assert.deepEqual(parseSalesOrderListReceivableStatusParams("open"), ["open"]);
    assert.deepEqual(parseSalesOrderListReceivableStatusParams("open,settled"), [
      "open",
      "settled",
    ]);
    assert.deepEqual(parseSalesOrderListReceivableStatusParams("settled,open"), [
      "open",
      "settled",
    ]);
  });

  it("ignora lixo e trata os 3 como Todos", () => {
    assert.deepEqual(parseSalesOrderListReceivableStatusParams("open,foo,settled"), [
      "open",
      "settled",
    ]);
    assert.deepEqual(
      parseSalesOrderListReceivableStatusParams("open,settled,none"),
      []
    );
    assert.deepEqual(parseSalesOrderListReceivableStatusParams(""), []);
  });

  it("format round-trip", () => {
    assert.equal(formatSalesOrderListReceivableStatusParam(["settled", "open"]), "open,settled");
    assert.equal(formatSalesOrderListReceivableStatusParam([]), "");
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

describe("buildSalesOrderListReceivableStatusesWhereFromSets — OR", () => {
  const sets = {
    withAnyCr: new Set(["a", "b", "c"]),
    withOpenCr: new Set(["a", "b"]),
  };

  it("vazio ou os 3 → null", () => {
    assert.equal(buildSalesOrderListReceivableStatusesWhereFromSets([], sets), null);
    assert.equal(
      buildSalesOrderListReceivableStatusesWhereFromSets(["open", "settled", "none"], sets),
      null
    );
  });

  it("open+settled → qualquer CR", () => {
    const where = buildSalesOrderListReceivableStatusesWhereFromSets(
      ["open", "settled"],
      sets
    );
    assert.deepEqual(where, { id: { in: ["a", "b", "c"] } });
  });

  it("open+none → OR", () => {
    const where = buildSalesOrderListReceivableStatusesWhereFromSets(["open", "none"], sets);
    assert.deepEqual(where, {
      OR: [{ id: { in: ["a", "b"] } }, { id: { notIn: ["a", "b", "c"] } }],
    });
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

describe("parseSalesOrderListQuery — receivableStatuses", () => {
  it("propaga receivableStatus=open", () => {
    const parsed = parseSalesOrderListQuery({ receivableStatus: "open" });
    assert.deepEqual(parsed.receivableStatuses, ["open"]);
  });

  it("propaga CSV multi", () => {
    const parsed = parseSalesOrderListQuery({ receivableStatus: "open,none" });
    assert.deepEqual(parsed.receivableStatuses, ["open", "none"]);
  });
});

describe("SalesOrdersModule — filtro Status CR", () => {
  it("expõe multi-select e envia receivableStatus na query/export", () => {
    const module = read("src/components/SalesOrdersModule.tsx");
    assert.match(module, /SalesOrderReceivableStatusMultiSelect/);
    assert.match(module, /sales-orders-filter-receivable-status/);
    assert.match(module, /params\.set\("receivableStatus"/);
    assert.match(module, /setReceivableStatus\(""\)/);
  });
});
