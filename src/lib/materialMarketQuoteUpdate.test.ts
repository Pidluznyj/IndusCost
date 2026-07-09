import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMaterialMarketQuotePatchData,
  guardMaterialMarketQuoteDelete,
  guardMaterialMarketQuoteEdit,
  mergeMaterialMarketQuoteEditBody,
} from "./materialMarketQuoteUpdate.js";

const EXISTING = {
  supplierId: null,
  supplierName: "Fornecedor A",
  quoteDate: new Date("2026-06-01"),
  price: 100,
  currency: "BRL",
  unit: "kg",
  origin: null,
  manufacturer: null,
  freightValue: 10,
  taxValue: 5,
  paymentTerms: null,
  proposalValidityDate: null,
  notes: "obs",
  status: "ACTIVE",
};

describe("materialMarketQuoteUpdate", () => {
  it("recalcula preço líquido no patch", () => {
    const data = buildMaterialMarketQuotePatchData(EXISTING, {
      price: 120,
      freightValue: 8,
      taxValue: 2,
    });
    assert.equal(data.netPrice, 130);
  });

  it("merge de edição preserva campos não enviados e recalcula líquido", () => {
    const merged = mergeMaterialMarketQuoteEditBody(EXISTING, { price: 90 }, { unit: "kg" });
    assert.equal(merged.ok, true);
    if (!merged.ok) return;
    assert.equal(merged.value.price, 90);
    assert.equal(merged.value.netPrice, 105);
    assert.equal(merged.value.supplierName, "Fornecedor A");
  });

  it("bloqueia edição de cotação oficial", () => {
    const guard = guardMaterialMarketQuoteEdit({
      status: "ACTIVE",
      isOfficialReference: true,
      officialStatus: "OFFICIAL",
    });
    assert.equal(guard.ok, false);
    if (guard.ok) return;
    assert.equal(guard.code, "QUOTE_OFFICIAL_LOCKED");
    assert.equal(guard.httpStatus, 409);
  });

  it("bloqueia exclusão com vínculo de compra", () => {
    const guard = guardMaterialMarketQuoteDelete({
      status: "ACTIVE",
      isOfficialReference: false,
      officialStatus: "DRAFT",
      purchaseLinkCount: 1,
    });
    assert.equal(guard.ok, false);
    if (guard.ok) return;
    assert.equal(guard.code, "QUOTE_HAS_PURCHASE_LINK");
  });

  it("permite edição de cotação manual comum", () => {
    const guard = guardMaterialMarketQuoteEdit({
      status: "ACTIVE",
      isOfficialReference: false,
      officialStatus: "DRAFT",
    });
    assert.equal(guard.ok, true);
  });
});
