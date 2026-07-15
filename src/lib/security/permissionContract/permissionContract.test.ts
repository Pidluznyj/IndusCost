import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ALL_PERMISSION_KEYS } from "../../permissionCatalog.ts";
import { listPermissionResourceKeys } from "../../permissionResourceSeedData.ts";
import {
  PERMISSION_CONTRACT_FORBIDDEN_DELETE_KEYS,
  PERMISSION_CONTRACT_RESOURCES,
} from "./resources.ts";
import {
  countPermissionContractActions,
  formatPermissionTargetMatrixMarkdown,
  listPermissionContractLegacyAliases,
  listPermissionContractResourceKeys,
  summarizePermissionContract,
  validatePermissionContract,
} from "./validate.ts";
import { SIDEBAR_MODULE_ORDER } from "../../modulePermissions.ts";

describe("permissionContract (Prompt 02)", () => {
  it("validatePermissionContract sem issues", () => {
    const issues = validatePermissionContract();
    assert.deepEqual(
      issues,
      [],
      issues.map((i) => `${i.code}: ${i.message}`).join("\n")
    );
  });

  it("resourceKeys únicos e com formato estável", () => {
    const keys = listPermissionContractResourceKeys();
    assert.equal(keys.length, new Set(keys).size);
    for (const key of keys) {
      assert.match(key, /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*)*$/);
    }
  });

  it("parents existem e não há ciclo", () => {
    const byKey = new Map(PERMISSION_CONTRACT_RESOURCES.map((r) => [r.resourceKey, r]));
    for (const r of PERMISSION_CONTRACT_RESOURCES) {
      if (!r.parentKey) continue;
      assert.ok(byKey.has(r.parentKey), `missing parent ${r.parentKey}`);
      const seen = new Set<string>();
      let cur: string | null = r.resourceKey;
      while (cur) {
        assert.ok(!seen.has(cur), `cycle at ${cur}`);
        seen.add(cur);
        cur = byKey.get(cur)?.parentKey ?? null;
      }
    }
  });

  it("ações proibidas de delete nos ledgers/fiscais/pedidos", () => {
    for (const key of PERMISSION_CONTRACT_FORBIDDEN_DELETE_KEYS) {
      const resource = PERMISSION_CONTRACT_RESOURCES.find((r) => r.resourceKey === key);
      assert.ok(resource, key);
      assert.ok(
        !resource!.actions.some((a) => a.action === "delete"),
        `${key} não deve ter delete`
      );
    }
  });

  it("todas as legacy keys existem no PERMISSION_CATALOG", () => {
    const known = new Set(ALL_PERMISSION_KEYS);
    for (const alias of listPermissionContractLegacyAliases()) {
      assert.ok(known.has(alias), alias);
    }
  });

  it("módulos sidebar 1:1 cobertos por moduleId quando aparece na sidebar", () => {
    const sidebarModules = new Set(
      PERMISSION_CONTRACT_RESOURCES.filter((r) => r.appearsInSidebar && r.moduleId).map(
        (r) => r.moduleId
      )
    );
    for (const moduleId of SIDEBAR_MODULE_ORDER) {
      assert.ok(
        sidebarModules.has(moduleId),
        `SIDEBAR_MODULE_ORDER ${moduleId} sem recurso appearsInSidebar`
      );
    }
  });

  it("aliases relacionais do contrato ⊆ seed atual (quando informados)", () => {
    const seedKeys = new Set(listPermissionResourceKeys());
    for (const r of PERMISSION_CONTRACT_RESOURCES) {
      for (const rel of r.relationalResourceKeys) {
        assert.ok(
          seedKeys.has(rel),
          `${r.resourceKey} referencia relational key ausente do seed: ${rel}`
        );
      }
    }
  });

  it("matriz markdown cobre todos os recursos", () => {
    const md = formatPermissionTargetMatrixMarkdown();
    for (const key of listPermissionContractResourceKeys()) {
      assert.ok(md.includes(`\`${key}\``), key);
    }
    assert.ok(md.includes("| Ver |"));
    assert.ok(md.includes("n/a"));
  });

  it("sumário tem volumes esperados (regressão mínima)", () => {
    const s = summarizePermissionContract();
    assert.ok(s.resourceCount >= 60, `resources ${s.resourceCount}`);
    assert.ok(s.actionBindingCount >= 80, `actions ${s.actionBindingCount}`);
    assert.ok(s.legacyAliasCount >= 40, `aliases ${s.legacyAliasCount}`);
    assert.equal(s.issueCount, 0);
    assert.equal(s.resourceCount, PERMISSION_CONTRACT_RESOURCES.length);
    assert.equal(s.actionBindingCount, countPermissionContractActions());
  });
});
