/**
 * P08 — derivação seed ← contrato.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PERMISSION_CONTRACT_RESOURCES } from "@/src/lib/security/permissionContract/index.js";
import {
  derivePermissionResourceSeedsFromContract,
  mergeLegacyAndContractSeeds,
} from "./permissionSeedFromContract.ts";
import {
  listPermissionResourceKeys,
  PERMISSION_RESOURCE_SEEDS,
  validatePermissionResourceCatalog,
} from "@/src/lib/permissionResourceSeedData.js";

describe("permissionSeedFromContract", () => {
  it("deriva todas as chaves do contrato com parents válidos", () => {
    const derived = derivePermissionResourceSeedsFromContract();
    assert.equal(derived.length, PERMISSION_CONTRACT_RESOURCES.length);
    const keys = new Set(derived.map((r) => r.key));
    for (const row of derived) {
      if (row.parentKey) {
        assert.ok(keys.has(row.parentKey), `${row.key} → ${row.parentKey}`);
      }
    }
    assert.ok(keys.has("engineering"));
    assert.ok(keys.has("admin.employees"));
    assert.ok(keys.has("finance.opex"));
  });

  it("merge é idempotente e não remove legado", () => {
    const legacy = [
      { key: "comercial", label: "pt" },
      { key: "dashboard", label: "pt-dash" },
    ];
    const derived = [
      { key: "dashboard", label: "canonical" },
      { key: "engineering", label: "eng" },
    ];
    const once = mergeLegacyAndContractSeeds(legacy, derived);
    const twice = mergeLegacyAndContractSeeds(once, derived);
    assert.deepEqual(
      once.map((r) => r.key),
      twice.map((r) => r.key)
    );
    assert.equal(once.find((r) => r.key === "dashboard")!.label, "pt-dash");
    assert.ok(once.some((r) => r.key === "engineering"));
    assert.ok(once.some((r) => r.key === "comercial"));
  });
});

describe("PERMISSION_RESOURCE_SEEDS (P08 merge)", () => {
  it("inclui engineering.*, admin.employees* e configuracoes deprecated", () => {
    const keys = new Set(listPermissionResourceKeys());
    for (const required of [
      "engineering",
      "engineering.products",
      "admin.employees",
      "admin.employees.personal_data",
      "admin.guide",
      "admin.settings",
      "commercial.customers",
      "configuracoes",
      "finance.opex",
    ]) {
      assert.ok(keys.has(required), required);
    }
    const cfg = PERMISSION_RESOURCE_SEEDS.find((r) => r.key === "configuracoes");
    assert.ok(cfg?.description.includes("[deprecated]"));
  });

  it("validador estrito do catálogo seed sem issues", () => {
    assert.deepEqual(validatePermissionResourceCatalog(), []);
  });
});
