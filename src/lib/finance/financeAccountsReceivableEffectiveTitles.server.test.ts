/**
 * FIN-08 server — carga de contextos do portfólio (query exata por pedido/NF).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildExactPortfolioSalesOrderWhere } from "./financeAccountsReceivableEffectiveTitles.server.js";

describe("buildExactPortfolioSalesOrderWhere", () => {
  it("usa equals por código — sem contains que estoura o take", () => {
    const where = buildExactPortfolioSalesOrderWhere(["PD 02719"], []);
    assert.deepEqual(where, {
      orderCode: { equals: "PD 02719", mode: "insensitive" },
    });
  });

  it("inclui salesOrderId das NF vinculadas", () => {
    const where = buildExactPortfolioSalesOrderWhere(
      [],
      ["aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"]
    );
    assert.deepEqual(where, {
      id: { in: ["aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"] },
    });
  });

  it("combina códigos exatos e ids em OR", () => {
    const where = buildExactPortfolioSalesOrderWhere(
      ["PD 02719"],
      ["so-id-1"]
    );
    assert.deepEqual(where, {
      OR: [
        { orderCode: { equals: "PD 02719", mode: "insensitive" } },
        { id: { in: ["so-id-1"] } },
      ],
    });
  });
});
