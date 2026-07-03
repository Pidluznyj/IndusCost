import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  DEFAULT_PRODUCTION_COST_DRAFT_ITEM_SCOPE,
  PRODUCTION_COST_DRAFT_ITEM_SCOPE_OPTIONS,
  countActiveMaterialsOutsideProductionCostDraftScope,
  matchesProductionCostDraftItemScope,
  parseProductionCostDraftItemScope,
  prismaProductTypeFilterForProductionCostDraftScope,
  productionCostDraftIncludeAllLabel,
} from "./productionCostDraftItemScope.js";

function readSrc(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

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

  it("escopo de DRAFT nunca inclui MATERIAL como Product.type", () => {
    for (const option of PRODUCTION_COST_DRAFT_ITEM_SCOPE_OPTIONS) {
      assert.notEqual(option.value, "MATERIAL");
      assert.doesNotMatch(option.label, /matéria-prima/i);
    }
    assert.equal(matchesProductionCostDraftItemScope("MATERIAL", "PRODUCT_AND_COMPONENT"), false);
    const filter = prismaProductTypeFilterForProductionCostDraftScope("PRODUCT_AND_COMPONENT");
    assert.deepEqual(filter, { in: ["PRODUCT", "COMPONENT"] });
  });

  it("countActiveMaterialsOutsideProductionCostDraftScope consulta Material, não Product", async () => {
    let materialCountCalls = 0;
    let productCountCalls = 0;
    const db = {
      material: {
        count: async ({ where }: { where: { status: string } }) => {
          materialCountCalls += 1;
          assert.equal(where.status, "ACTIVE");
          return 7;
        },
      },
      product: {
        count: async () => {
          productCountCalls += 1;
          return 0;
        },
      },
    };
    const total = await countActiveMaterialsOutsideProductionCostDraftScope(db as never);
    assert.equal(total, 7);
    assert.equal(materialCountCalls, 1);
    assert.equal(productCountCalls, 0);
  });

  it("generateProductionCostTableDraftFromProducts não consulta Product.type MATERIAL", () => {
    const pub = readSrc("src/lib/productionCostPublication.server.ts");
    const snapshot = readSrc("src/lib/productEngineeringCostSnapshot.server.ts");
    assert.doesNotMatch(pub, /product\.count\(\{[^}]*type:\s*"MATERIAL"/);
    assert.doesNotMatch(snapshot, /product\.count\(\{[^}]*type:\s*"MATERIAL"/);
    assert.match(pub, /countActiveMaterialsOutsideProductionCostDraftScope/);
  });
});
