import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  countCommissionRowAsWithoutSeller,
  formatCommissionSellerLabel,
} from "./commissionSellerUi.js";

describe("commissionSellerUi", () => {
  it("exibe CommissionPerson.name na coluna Vendedor quando resolvido", () => {
    const label = formatCommissionSellerLabel({
      id: "p1",
      name: "GISLENE LIMA",
      nomusPersonId: 464,
      resolutionStatus: "RESOLVED",
      source: "COMMISSION_PERSON",
      label: "GISLENE LIMA",
    });
    assert.equal(label, "GISLENE LIMA");
  });

  it("card sem vendedor não conta registro com commissionPerson resolvido", () => {
    assert.equal(
      countCommissionRowAsWithoutSeller({
        id: "p1",
        name: "GISLENE LIMA",
        nomusPersonId: 464,
        resolutionStatus: "RESOLVED",
        source: "COMMISSION_PERSON",
        label: "GISLENE LIMA",
      }),
      false
    );
  });

  it("conta SELLER_UNRESOLVED e NO_SELLER", () => {
    assert.equal(
      countCommissionRowAsWithoutSeller({
        id: null,
        name: null,
        nomusPersonId: 1189,
        resolutionStatus: "SELLER_UNRESOLVED",
        source: "UNRESOLVED",
        label: "Vendedor Nomus não mapeado: ID 1189",
      }),
      true
    );
    assert.equal(
      countCommissionRowAsWithoutSeller({
        id: null,
        name: null,
        nomusPersonId: null,
        resolutionStatus: "NO_SELLER",
        source: "UNRESOLVED",
        label: "Sem vendedor no pedido Nomus",
      }),
      true
    );
  });
});
