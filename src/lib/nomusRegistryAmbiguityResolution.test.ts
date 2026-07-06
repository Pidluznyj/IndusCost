import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAmbiguityPlanHash,
  classifyAmbiguityRelinkLine,
  confirmationTextForAmbiguityResolution,
} from "./nomusRegistryAmbiguityResolution";
import {
  pickNomusApplyRegistryLink,
  prefersMaterialForNomusComponent,
  registerPreferMaterialComponentCode,
} from "./nomusComponentRegistryResolve";

describe("nomusRegistryAmbiguityResolution", () => {
  it("confirmationText MATERIAL", () => {
    assert.equal(
      confirmationTextForAmbiguityResolution("420.01A-", "MATERIAL"),
      "RESOLVER AMBIGUIDADE 420.01A- MATERIAL"
    );
  });

  it("classify — Product Nomus-controlled → RELINK_TO_MATERIAL", () => {
    const r = classifyAmbiguityRelinkLine({
      prefer: "MATERIAL",
      row: {
        id: "line-1",
        materialId: null,
        childProductId: "prod-1",
        localException: false,
        isNomusControlled: true,
        productId: "parent-1",
        materialTargetId: "mat-1",
        productTargetId: "prod-1",
      },
    });
    assert.equal(r.action, "RELINK_TO_MATERIAL");
    assert.equal(r.eligibility, "ALLOWED");
    assert.equal(r.currentLink, "PRODUCT");
    assert.equal(r.targetLink, "MATERIAL");
  });

  it("classify — já em Material → NO_CHANGE", () => {
    const r = classifyAmbiguityRelinkLine({
      prefer: "MATERIAL",
      row: {
        id: "line-2",
        materialId: "mat-1",
        childProductId: null,
        localException: false,
        isNomusControlled: true,
        productId: "parent-1",
        materialTargetId: "mat-1",
        productTargetId: "prod-1",
      },
    });
    assert.equal(r.action, "NO_CHANGE");
    assert.equal(r.currentLink, "MATERIAL");
  });

  it("classify — localException bloqueia", () => {
    const r = classifyAmbiguityRelinkLine({
      prefer: "MATERIAL",
      row: {
        id: "line-3",
        materialId: null,
        childProductId: "prod-1",
        localException: true,
        isNomusControlled: true,
        productId: "parent-1",
        materialTargetId: "mat-1",
        productTargetId: "prod-1",
      },
    });
    assert.equal(r.eligibility, "BLOCKED");
    assert.equal(r.blockReason, "LOCAL_EXCEPTION");
    assert.equal(r.action, "SKIP");
  });

  it("classify — linha manual (não Nomus) → SKIP sem bloquear apply", () => {
    const r = classifyAmbiguityRelinkLine({
      prefer: "MATERIAL",
      row: {
        id: "line-4",
        materialId: null,
        childProductId: "prod-1",
        localException: false,
        isNomusControlled: false,
        productId: "parent-1",
        materialTargetId: "mat-1",
        productTargetId: "prod-1",
      },
    });
    assert.equal(r.action, "SKIP");
    assert.equal(r.eligibility, "ALLOWED");
  });

  it("planHash estável para mesmas linhas", () => {
    const h1 = buildAmbiguityPlanHash({
      code: "420.01A-",
      prefer: "MATERIAL",
      lineIds: ["a", "b"],
      reactivateMaterial: true,
    });
    const h2 = buildAmbiguityPlanHash({
      code: "420.01A-",
      prefer: "MATERIAL",
      lineIds: ["b", "a"],
      reactivateMaterial: true,
    });
    assert.equal(h1, h2);
    assert.notEqual(
      buildAmbiguityPlanHash({
        code: "420.01A-",
        prefer: "MATERIAL",
        lineIds: ["a"],
        reactivateMaterial: false,
      }),
      h1
    );
  });
});

describe("pickNomusApplyRegistryLink (ambiguidade)", () => {
  it("BOTH sem allowlist → bloqueia", () => {
    const r = pickNomusApplyRegistryLink({
      componentCode: "999.99X",
      resolvedKind: "BOTH",
      productId: "p1",
      materialId: "m1",
    });
    assert.equal(r.ok, false);
  });

  it("BOTH com allowlist → Material", () => {
    assert.equal(prefersMaterialForNomusComponent("420.01A-"), true);
    const r = pickNomusApplyRegistryLink({
      componentCode: "420.01A-",
      resolvedKind: "BOTH",
      productId: "p1",
      materialId: "m1",
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.resolvedKind, "MATERIAL");
      assert.equal(r.materialId, "m1");
      assert.equal(r.childProductId, null);
    }
  });

  it("PRODUCT + Material inativo + allowlist → bloqueia até resolução", () => {
    const r = pickNomusApplyRegistryLink({
      componentCode: "420.01A-",
      resolvedKind: "PRODUCT",
      productId: "p1",
      materialId: null,
      inactiveMaterialIds: ["m-inactive"],
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /resolução de ambiguidade/i);
  });

  it("após registerPreferMaterial + Material ativo em BOTH → Material", () => {
    registerPreferMaterialComponentCode("TEST.01");
    const r = pickNomusApplyRegistryLink({
      componentCode: "TEST.01",
      resolvedKind: "BOTH",
      productId: "p1",
      materialId: "m1",
    });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.resolvedKind, "MATERIAL");
  });
});
