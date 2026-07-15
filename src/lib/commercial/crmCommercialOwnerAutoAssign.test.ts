import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AUTO_ASSIGN_SOURCE,
  isMappableOrderSeller,
} from "./crmCommercialOwnerAutoAssign.js";

describe("crmCommercialOwnerAutoAssign", () => {
  it("mapeia vendedor Nomus válido", () => {
    assert.equal(
      isMappableOrderSeller({
        nomusSellerName: "Gislene Lima",
        responsible: null,
        externalSellerId: 464,
      }),
      true
    );
  });

  it("rejeita rótulos operacionais", () => {
    assert.equal(
      isMappableOrderSeller({
        nomusSellerName: "FINANCEIRO",
        responsible: null,
        externalSellerId: null,      }),
      false
    );
  });

  it("rejeita sem vendedor", () => {
    assert.equal(
      isMappableOrderSeller({
        nomusSellerName: null,
        responsible: null,
        externalSellerId: null,      }),
      false
    );
  });

  it("fonte AUTO_FROM_SALES_ORDER_SELLER", () => {
    assert.equal(AUTO_ASSIGN_SOURCE, "AUTO_FROM_SALES_ORDER_SELLER");
  });
});
