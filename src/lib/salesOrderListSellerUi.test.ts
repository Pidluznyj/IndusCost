import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveSalesOrderListSellerLabel } from "./salesOrderListSellerUi.js";

describe("salesOrderListSellerUi", () => {
  it("NO_SELLER → —", () => {
    assert.equal(
      resolveSalesOrderListSellerLabel({
        seller: { externalSellerId: null, name: null, resolutionStatus: "NO_SELLER" },
      }),
      "—"
    );
  });

  it("RESOLVED usa name", () => {
    assert.equal(
      resolveSalesOrderListSellerLabel({
        seller: {
          externalSellerId: 464,
          name: "GISLENE LIMA",
          resolutionStatus: "RESOLVED",
        },
      }),
      "GISLENE LIMA"
    );
  });

  it("SELLER_UNRESOLVED → rótulo técnico com ID", () => {
    assert.equal(
      resolveSalesOrderListSellerLabel({
        seller: {
          externalSellerId: 7777,
          name: null,
          resolutionStatus: "SELLER_UNRESOLVED",
        },
      }),
      "Vendedor Nomus não mapeado: ID 7777"
    );
  });

  it("sem seller DTO e sem responsible → — (nunca Sem responsável)", () => {
    assert.equal(resolveSalesOrderListSellerLabel({}), "—");
  });
});
