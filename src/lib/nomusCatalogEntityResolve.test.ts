import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeSku } from "./nomusBomComparison.js";
import {
  buildCatalogEntityLookupMaps,
  materialBlocksProductMutation,
  resolveCatalogEntityByCode,
} from "./nomusCatalogEntityResolve.js";
import { pickNomusApplyRegistryLink } from "./nomusComponentRegistryResolve.js";

describe("nomusCatalogEntityResolve — precedência Material", () => {
  it("normalizeSku preserva hífens de 160.08-- e distingue semelhantes", () => {
    assert.equal(normalizeSku(" 160.08-- "), "160.08--");
    assert.equal(normalizeSku("160.08"), "160.08");
    assert.equal(normalizeSku("160.08-A"), "160.08-A");
    assert.notEqual(normalizeSku("160.08--"), normalizeSku("160.08"));
    assert.notEqual(normalizeSku("160.08--"), normalizeSku("160.08-A"));
  });

  it("1–2. Material ativo impede create PRODUCT e COMPONENT", () => {
    const maps = buildCatalogEntityLookupMaps({
      materials: [{ id: "m1", code: "160.08--", status: "ACTIVE" }],
      products: [],
    });
    const r = resolveCatalogEntityByCode("160.08--", maps);
    assert.equal(r.status, "material");
    assert.equal(r.mayCreateProduct, false);
    assert.equal(materialBlocksProductMutation(r), true);
    assert.equal(r.importDecision, "RECOGNIZED_AS_MATERIAL");
  });

  it("3. Material ativo resolve BOM com materialId (XOR)", () => {
    const maps = buildCatalogEntityLookupMaps({
      materials: [{ id: "m1", code: "160.08--", status: "ACTIVE" }],
      products: [],
    });
    const r = resolveCatalogEntityByCode("160.08--", maps);
    assert.equal(r.bomLink.kind, "material");
    if (r.bomLink.kind === "material") {
      assert.equal(r.bomLink.materialId, "m1");
      assert.equal(r.bomLink.childProductId, null);
    }
  });

  it("4. Material ativo + COMPONENT histórico → materialId + conflito", () => {
    const maps = buildCatalogEntityLookupMaps({
      materials: [{ id: "m1", code: "160.08--", status: "ACTIVE" }],
      products: [{ id: "c1", sku: "160.08--", status: "ACTIVE", type: "COMPONENT" }],
    });
    const r = resolveCatalogEntityByCode("160.08--", maps);
    assert.equal(r.status, "material");
    assert.equal(r.hasHistoricalConflict, true);
    assert.deepEqual(r.conflictingProductIds, ["c1"]);
    assert.equal(r.importDecision, "HISTORICAL_CLASSIFICATION_CONFLICT");
    assert.equal(r.bomLink.kind, "material");
    assert.match(r.message, /Product históricos/i);
  });

  it("5. Material ativo + PRODUCT histórico → materialId + conflito", () => {
    const maps = buildCatalogEntityLookupMaps({
      materials: [{ id: "m1", code: "160.08--", status: "ACTIVE" }],
      products: [{ id: "p1", sku: "160.08--", status: "ACTIVE", type: "PRODUCT" }],
    });
    const r = resolveCatalogEntityByCode("160.08--", maps);
    assert.equal(r.status, "material");
    assert.deepEqual(r.conflictingProductIds, ["p1"]);
    assert.equal(r.bomLink.kind, "material");
  });

  it("5.4 Material + COMPONENT + PRODUCT → Material escolhido, conflito completo", () => {
    const maps = buildCatalogEntityLookupMaps({
      materials: [{ id: "m1", code: "X", status: "ACTIVE" }],
      products: [
        { id: "c1", sku: "X", status: "ACTIVE", type: "COMPONENT" },
        { id: "p1", sku: "X", status: "ACTIVE", type: "PRODUCT" },
      ],
    });
    const r = resolveCatalogEntityByCode("X", maps);
    assert.equal(r.status, "material");
    assert.equal(r.conflictingProductIds.length, 2);
    assert.equal(r.mayCreateProduct, false);
  });

  it("8–9. Material inativo impede create e bloqueia BOM", () => {
    const maps = buildCatalogEntityLookupMaps({
      materials: [{ id: "m-off", code: "ABC", status: "INACTIVE" }],
      products: [],
    });
    const r = resolveCatalogEntityByCode("abc", maps);
    assert.equal(r.status, "material_inactive");
    assert.equal(r.mayCreateProduct, false);
    assert.equal(r.bomLink.kind, "blocked");
    assert.equal(r.importDecision, "MATERIAL_INACTIVE_REQUIRES_REVIEW");
    assert.equal(materialBlocksProductMutation(r), true);
  });

  it("10–13. Sem Material: COMPONENT / PRODUCT / not_found", () => {
    const componentMaps = buildCatalogEntityLookupMaps({
      materials: [],
      products: [{ id: "c1", sku: "COMP-1", status: "ACTIVE", type: "COMPONENT" }],
    });
    assert.equal(resolveCatalogEntityByCode("comp-1", componentMaps).status, "component");

    const productMaps = buildCatalogEntityLookupMaps({
      materials: [],
      products: [{ id: "p1", sku: "FIN-1", status: "ACTIVE", type: "PRODUCT" }],
    });
    assert.equal(resolveCatalogEntityByCode("fin-1", productMaps).status, "product");

    const empty = buildCatalogEntityLookupMaps({ materials: [], products: [] });
    const nf = resolveCatalogEntityByCode("NEW.01", empty);
    assert.equal(nf.status, "not_found");
    assert.equal(nf.mayCreateProduct, true);
    assert.equal(materialBlocksProductMutation(nf), false);
  });

  it("14–19. Normalização canônica e códigos semelhantes distintos", () => {
    const maps = buildCatalogEntityLookupMaps({
      materials: [{ id: "m", code: "160.08--", status: "ACTIVE" }],
      products: [],
    });
    assert.equal(resolveCatalogEntityByCode(" 160.08-- ", maps).status, "material");
    assert.equal(resolveCatalogEntityByCode("160.08--", maps).normalizedCode, "160.08--");
    assert.equal(resolveCatalogEntityByCode("160.08", maps).status, "not_found");
    assert.equal(resolveCatalogEntityByCode("160.08-A", maps).status, "not_found");
    assert.equal(normalizeSku("a  b"), normalizeSku("A  B"));
  });

  it("29. pickNomusApplyRegistryLink BOTH → materialId XOR childProductId", () => {
    const r = pickNomusApplyRegistryLink({
      componentCode: "160.08--",
      resolvedKind: "BOTH",
      productId: "p-hist",
      materialId: "m-official",
    });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.materialId, "m-official");
      assert.equal(r.childProductId, null);
    }
  });

  it("31. Allowlist não é pré-requisito — código fora da lista usa Material", () => {
    const r = pickNomusApplyRegistryLink({
      componentCode: "NOT.IN.ALLOWLIST",
      resolvedKind: "BOTH",
      productId: "p",
      materialId: "m",
    });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.resolvedKind, "MATERIAL");
  });

  it("Material inativo em pick bloqueia revisão", () => {
    const r = pickNomusApplyRegistryLink({
      componentCode: "160.08--",
      resolvedKind: "NONE",
      productId: null,
      materialId: null,
      inactiveMaterialIds: ["mat-inactive"],
    });
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /MATERIAL_INACTIVE/);
  });
});
