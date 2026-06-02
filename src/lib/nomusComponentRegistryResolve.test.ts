import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isRegistryActiveStatus,
  pickRegistryRecordForAutoResolve,
  prefersMaterialForNomusComponent,
  resolveRegistryPairForComponentCode,
} from "./nomusComponentRegistryResolve";

describe("nomusComponentRegistryResolve", () => {
  it("isRegistryActiveStatus — ACTIVE e vazio são ativos", () => {
    assert.equal(isRegistryActiveStatus("ACTIVE"), true);
    assert.equal(isRegistryActiveStatus(null), true);
    assert.equal(isRegistryActiveStatus("INACTIVE"), false);
  });

  it("pickRegistryRecordForAutoResolve — ignora inativo", () => {
    const picked = pickRegistryRecordForAutoResolve({
      records: [
        { id: "inactive", status: "INACTIVE" },
        { id: "active", status: "ACTIVE" },
      ],
      isActive: (r) => isRegistryActiveStatus(r.status),
    });
    assert.equal(picked?.id, "active");
  });

  it("pickRegistryRecordForAutoResolve — só inativos retorna null", () => {
    const picked = pickRegistryRecordForAutoResolve({
      records: [{ id: "m1", status: "INACTIVE" }],
      isActive: (r) => isRegistryActiveStatus(r.status),
    });
    assert.equal(picked, null);
  });

  it("resolveRegistryPair — Material inativo + Product ativo → PRODUCT", () => {
    const resolved = resolveRegistryPairForComponentCode({
      componentCode: "420.01A",
      product: { id: "prod-1" },
      material: null,
      inactiveMaterialIds: ["mat-old"],
    });
    assert.equal(resolved.resolvedKind, "PRODUCT");
    assert.equal(resolved.productId, "prod-1");
    assert.equal(resolved.materialId, null);
  });

  it("resolveRegistryPair — ambos ativos → BOTH", () => {
    const resolved = resolveRegistryPairForComponentCode({
      componentCode: "420.01A-",
      product: { id: "p1" },
      material: { id: "m1" },
    });
    assert.equal(resolved.resolvedKind, "BOTH");
    assert.equal(resolved.productId, "p1");
    assert.equal(resolved.materialId, "m1");
  });

  it("420.01A- está na allowlist PREFER_MATERIAL", () => {
    assert.equal(prefersMaterialForNomusComponent("420.01A-"), true);
    assert.equal(prefersMaterialForNomusComponent("420.01A"), false);
  });
});
