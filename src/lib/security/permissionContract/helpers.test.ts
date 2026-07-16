/**
 * P01 — helpers do contrato tipado (sem runtime).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPermissionContractCatalog,
  classifyLegacyAliasStatus,
  detectCrossResourceLegacyKeys,
  getCanonicalLegacyAlias,
  getPermissionContractCatalogEntry,
  hasPermissionParentCycle,
  isDeprecatedPermissionResource,
  isHardMegaKey,
  isKnownPermissionAction,
  isKnownPermissionResource,
  listLegacyAliasesForResource,
  listPermissionAncestors,
  listPermissionChildren,
  listPermissionMegaKeyRecords,
  listPermissionParentCycles,
  listSupportedActions,
  supportsPermissionAction,
  validatePermissionParentLink,
} from "./index.ts";
import { PERMISSION_CONTRACT_RESOURCES } from "./resources.ts";
import { validatePermissionContract } from "./validate.ts";

describe("permissionContract helpers (P01)", () => {
  it("valida recurso e ação conhecidos", () => {
    assert.equal(isKnownPermissionResource("finance.accounts_payable"), true);
    assert.equal(isKnownPermissionResource("nao.existe"), false);
    assert.equal(isKnownPermissionAction("view"), true);
    assert.equal(isKnownPermissionAction("fly"), false);
  });

  it("lista parent, ancestrais e filhos", () => {
    assert.deepEqual(listPermissionAncestors("finance.accounts_payable"), ["finance"]);
    assert.ok(listPermissionChildren("finance").includes("finance.accounts_payable"));
    assert.ok(listPermissionChildren("finance").includes("finance.portfolio_reconciliation"));
  });

  it("não há ciclos no contrato oficial", () => {
    assert.deepEqual(listPermissionParentCycles(), []);
    assert.equal(hasPermissionParentCycle("finance.accounts_payable"), false);
  });

  it("detecta ciclo se parent for invertido", () => {
    const broken = PERMISSION_CONTRACT_RESOURCES.map((r) => {
      if (r.resourceKey === "finance") {
        return { ...r, parentKey: "finance.accounts_payable" };
      }
      return r;
    });
    assert.equal(hasPermissionParentCycle("finance", broken), true);
    assert.ok(listPermissionParentCycles(broken).length > 0);
  });

  it("ações suportadas e unsupported", () => {
    const actions = listSupportedActions("finance.accounts_payable");
    assert.ok(actions.includes("view"));
    assert.equal(supportsPermissionAction("finance.accounts_payable", "view"), true);
    assert.equal(supportsPermissionAction("finance.accounts_payable", "approve"), false);
  });

  it("aliases classificados; mega-keys hard marcadas", () => {
    assert.equal(isHardMegaKey("costs.view"), true);
    const status = classifyLegacyAliasStatus("costs.view", "finance.opex", 1);
    assert.equal(status, "mega_key_temporary");

    const apAliases = listLegacyAliasesForResource("finance.accounts_payable");
    const apView = apAliases.find(
      (a) => a.action === "view" && a.legacyKey === "finance.accountsPayable.view"
    );
    assert.ok(apView);
    assert.equal(apView!.index, 0);

    const canonical = getCanonicalLegacyAlias("finance.accounts_payable", "view");
    assert.equal(canonical, "finance.accountsPayable.view");
  });

  it("inventário de mega-keys inclui costs.view e finance.view", () => {
    const mega = listPermissionMegaKeyRecords();
    const keys = mega.map((m) => m.legacyKey);
    assert.ok(keys.includes("costs.view"));
    assert.ok(keys.includes("finance.view"));
    const costs = mega.find((m) => m.legacyKey === "costs.view")!;
    assert.equal(costs.kind, "mega_key");
    assert.equal(costs.migrationStatus, "mega_key_temporary");
    assert.ok(costs.resourceKeys.length >= 1);
  });

  it("detecta legacy keys cross-resource no contrato", () => {
    const cross = detectCrossResourceLegacyKeys();
    assert.ok(cross.has("costs.view") || cross.size >= 1);
  });

  it("catálogo tipado tem campos obrigatórios P01", () => {
    const catalog = buildPermissionContractCatalog();
    assert.equal(catalog.length, PERMISSION_CONTRACT_RESOURCES.length);
    const ap = getPermissionContractCatalogEntry("finance.accounts_payable");
    assert.ok(ap);
    assert.equal(ap!.resourceKey, "finance.accounts_payable");
    assert.equal(ap!.label, "Contas a Pagar");
    assert.equal(ap!.group, "finance");
    assert.equal(ap!.parentKey, "finance");
    assert.equal(typeof ap!.order, "number");
    assert.ok(ap!.supportedActions.includes("view"));
    assert.equal(ap!.sensitivity, "critical");
    assert.equal(ap!.metadata.route, "/finance/accounts-payable");
    assert.equal(ap!.metadata.isTab, true);
    assert.ok(Array.isArray(ap!.legacyAliases));
    assert.equal(ap!.deprecated, false);
    assert.deepEqual(ap!.replacementKeys, []);
    assert.equal(ap!.migrationStatus, "active");
  });

  it("recursos depreciados (nenhum no contrato atual por default)", () => {
    assert.equal(isDeprecatedPermissionResource("finance.accounts_payable"), false);
  });

  it("validatePermissionParentLink rejeita parent inválido", () => {
    assert.equal(validatePermissionParentLink("finance.accounts_payable", "finance"), null);
    assert.ok(validatePermissionParentLink("finance.accounts_payable", "nao.existe"));
    assert.ok(validatePermissionParentLink("finance", "finance"));
  });

  it("contrato estrutural continua limpo", () => {
    assert.deepEqual(validatePermissionContract(), []);
  });
});
