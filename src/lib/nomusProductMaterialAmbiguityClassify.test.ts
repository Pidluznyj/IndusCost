import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyProductMaterialAmbiguity,
  type ProductMaterialRegistrySnapshot,
} from "./nomusProductMaterialAmbiguityClassify";

function snap(
  partial: Partial<ProductMaterialRegistrySnapshot> &
    Pick<ProductMaterialRegistrySnapshot, "code">
): ProductMaterialRegistrySnapshot {
  return {
    product: null,
    material: null,
    prefersMaterial: false,
    prefersProduct: false,
    nomusControlledBomAsProductCount: 0,
    nomusControlledBomAsMaterialCount: 0,
    ...partial,
  };
}

describe("nomusProductMaterialAmbiguityClassify", () => {
  it("420.01A- — Material ativo com custo, Product fraco, BOM só Material", () => {
    const r = classifyProductMaterialAmbiguity(
      snap({
        code: "420.01A-",
        prefersMaterial: true,
        product: {
          id: "p1",
          active: true,
          ownBomLineCount: 0,
          routingCount: 0,
          costingMode: "OWN_PROCESS",
        },
        material: {
          id: "m1",
          active: true,
          currentCost: 0.04,
          standardCost: 0.04,
        },
        nomusControlledBomAsProductCount: 0,
        nomusControlledBomAsMaterialCount: 131,
      })
    );
    assert.equal(r.status, "RESOLVIDO_COMO_MATERIAL");
    assert.equal(r.suggestedDecision, "PREFER_MATERIAL");
  });

  it("Product+Material ambos usados em BOM Nomus → AMBIGUO_BLOQUEADO", () => {
    const r = classifyProductMaterialAmbiguity(
      snap({
        code: "X.01",
        product: {
          id: "p1",
          active: true,
          ownBomLineCount: 0,
          routingCount: 0,
          costingMode: null,
        },
        material: {
          id: "m1",
          active: true,
          currentCost: 1,
          standardCost: 1,
        },
        nomusControlledBomAsProductCount: 5,
        nomusControlledBomAsMaterialCount: 3,
      })
    );
    assert.equal(r.status, "AMBIGUO_BLOQUEADO");
    assert.equal(r.suggestedDecision, "MANTER_BLOQUEADO");
  });

  it("Product com BOM/roteiro e Material inativo → RESOLVIDO_COMO_PRODUCT", () => {
    const r = classifyProductMaterialAmbiguity(
      snap({
        code: "FAB.01",
        product: {
          id: "p1",
          active: true,
          ownBomLineCount: 2,
          routingCount: 1,
          costingMode: "OWN_PROCESS",
        },
        material: {
          id: "m1",
          active: false,
          currentCost: 0,
          standardCost: 0,
        },
        nomusControlledBomAsProductCount: 4,
        nomusControlledBomAsMaterialCount: 0,
      })
    );
    assert.equal(r.status, "RESOLVIDO_COMO_PRODUCT");
    assert.equal(r.suggestedDecision, "PREFER_PRODUCT");
  });

  it("apenas Material ativo → ALINHADO_MATERIAL", () => {
    const r = classifyProductMaterialAmbiguity(
      snap({
        code: "MP.01",
        material: {
          id: "m1",
          active: true,
          currentCost: 0.5,
          standardCost: 0.5,
        },
      })
    );
    assert.equal(r.status, "ALINHADO_MATERIAL");
  });

  it("apenas Product ativo → ALINHADO_PRODUCT", () => {
    const r = classifyProductMaterialAmbiguity(
      snap({
        code: "PR.01",
        product: {
          id: "p1",
          active: true,
          ownBomLineCount: 0,
          routingCount: 0,
          costingMode: null,
        },
      })
    );
    assert.equal(r.status, "ALINHADO_PRODUCT");
  });
});
