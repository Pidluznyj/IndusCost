import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  commissionSellerDisplayLabel,
  isCommissionRecordWithoutResolvedSeller,
  resolveCommissionSellerDisplay,
} from "./commissionSellerDisplay.js";

describe("commissionSellerDisplay", () => {
  it("retorna seller.name quando commissionPersonId e CommissionPerson existem", () => {
    const seller = resolveCommissionSellerDisplay({
      commissionPersonId: "person-gislene",
      commissionPerson: {
        id: "person-gislene",
        name: "GISLENE LIMA",
        nomusPersonId: 464,
      },
      nomusSellerId: null,
    });

    assert.equal(seller.resolutionStatus, "RESOLVED");
    assert.equal(seller.source, "COMMISSION_PERSON");
    assert.equal(seller.name, "GISLENE LIMA");
    assert.equal(commissionSellerDisplayLabel(seller), "GISLENE LIMA");
    assert.equal(isCommissionRecordWithoutResolvedSeller({
      commissionPersonId: "person-gislene",
      commissionPerson: { id: "person-gislene", name: "GISLENE LIMA" },
    }), false);
  });

  it("commissionPersonId preenchido e nomusSellerId null aparece com vendedor", () => {
    const seller = resolveCommissionSellerDisplay({
      commissionPersonId: "person-rodrigo",
      commissionPerson: {
        id: "person-rodrigo",
        name: "Rodrigo Da Silva Ramos",
        nomusPersonId: 1399,
      },
      nomusSellerId: null,
    });

    assert.equal(seller.resolutionStatus, "RESOLVED");
    assert.equal(seller.name, "Rodrigo Da Silva Ramos");
    assert.equal(isCommissionRecordWithoutResolvedSeller({
      commissionPersonId: "person-rodrigo",
      commissionPerson: { id: "person-rodrigo", name: "Rodrigo Da Silva Ramos" },
      nomusSellerId: null,
    }), false);
  });

  it("commissionPersonId null e nomusSellerId preenchido → SELLER_UNRESOLVED", () => {
    const seller = resolveCommissionSellerDisplay({
      commissionPersonId: null,
      nomusSellerId: 1189,
    });

    assert.equal(seller.resolutionStatus, "SELLER_UNRESOLVED");
    assert.equal(seller.label, "Vendedor Nomus não mapeado: ID 1189");
    assert.equal(isCommissionRecordWithoutResolvedSeller({
      commissionPersonId: null,
      nomusSellerId: 1189,
    }), true);
  });

  it("ambos nulos → NO_SELLER", () => {
    const seller = resolveCommissionSellerDisplay({
      commissionPersonId: null,
      nomusSellerId: null,
    });

    assert.equal(seller.resolutionStatus, "NO_SELLER");
    assert.equal(seller.label, "Sem vendedor no pedido Nomus");
    assert.equal(isCommissionRecordWithoutResolvedSeller({
      commissionPersonId: null,
      nomusSellerId: null,
    }), true);
  });

  it("commissionPersonId sem join → referência quebrada", () => {
    const seller = resolveCommissionSellerDisplay({
      commissionPersonId: "missing-person",
      commissionPerson: null,
      nomusSellerId: 464,
    });

    assert.equal(seller.resolutionStatus, "BROKEN_COMMISSION_PERSON_REFERENCE");
    assert.equal(seller.label, "Pessoa comissionada não encontrada");
    assert.equal(isCommissionRecordWithoutResolvedSeller({
      commissionPersonId: "missing-person",
      commissionPerson: null,
    }), false);
  });

  it("nomusPersonId vem de CommissionPerson, não de nomusSellerId quando resolvido", () => {
    const seller = resolveCommissionSellerDisplay({
      commissionPersonId: "p1",
      commissionPerson: { id: "p1", name: "JOSE EDUARDO", nomusPersonId: 1189 },
      nomusSellerId: 999,
    });

    assert.equal(seller.nomusPersonId, 1189);
  });
});
