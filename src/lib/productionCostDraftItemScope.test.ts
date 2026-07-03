import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_PRODUCTION_COST_DRAFT_ITEM_SCOPE,
  matchesProductionCostDraftItemScope,
  parseProductionCostDraftItemScope,
  prismaProductTypeFilterForProductionCostDraftScope,
  productionCostDraftIncludeAllLabel,
} from "./productionCostDraftItemScope.js";

describe("productionCostDraftItemScope", () => {
  it("default é PRODUCT_AND_COMPONENT", () => {
    assert.equal(DEFAULT_PRODUCTION_COST_DRAFT_ITEM_SCOPE, "PRODUCT_AND_COMPONENT");
    assert.equal(parseProductionCostDraftItemScope(undefined), "PRODUCT_AND_COMPONENT");
    assert.equal(parseProductionCostDraftItemScope("all"), "PRODUCT_AND_COMPONENT");
  });

  it("parse aceita aliases comuns", () => {
    assert.equal(parseProductionCostDraftItemScope("PRODUCT"), "PRODUCT");
    assert.equal(parseProductionCostDraftItemScope("component"), "COMPONENT");
    assert.equal(parseProductionCostDraftItemScope("sold_components"), "SOLD_COMPONENTS");
  });

  it("matchesProductionCostDraftItemScope filtra por tipo", () => {
    assert.equal(matchesProductionCostDraftItemScope("PRODUCT", "PRODUCT"), true);
    assert.equal(matchesProductionCostDraftItemScope("COMPONENT", "PRODUCT"), false);
    assert.equal(matchesProductionCostDraftItemScope("COMPONENT", "COMPONENT"), true);
    assert.equal(matchesProductionCostDraftItemScope("PRODUCT", "PRODUCT_AND_COMPONENT"), true);
    assert.equal(matchesProductionCostDraftItemScope("COMPONENT", "SOLD_COMPONENTS"), true);
  });

  it("prismaProductTypeFilterForProductionCostDraftScope inclui ambos no default", () => {
    const filter = prismaProductTypeFilterForProductionCostDraftScope("PRODUCT_AND_COMPONENT");
    assert.deepEqual(filter, { in: ["PRODUCT", "COMPONENT"] });
    assert.equal(prismaProductTypeFilterForProductionCostDraftScope("PRODUCT"), "PRODUCT");
    assert.equal(prismaProductTypeFilterForProductionCostDraftScope("SOLD_COMPONENTS"), "COMPONENT");
  });

  it("label de include-all deixa explícito produtos e componentes", () => {
    assert.match(
      productionCostDraftIncludeAllLabel("PRODUCT_AND_COMPONENT"),
      /Produtos e componentes/
    );
  });
});
