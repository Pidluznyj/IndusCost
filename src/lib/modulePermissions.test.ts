import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canAccessModule,
  getVisibleProductTabs,
  type PermissionChecker,
} from "./modulePermissions.js";

function checker(perms: string[]): PermissionChecker {
  const set = new Set(perms);
  return {
    hasPermission: (p) => set.has(p),
    hasAnyPermission: (list) => list.some((p) => set.has(p)),
  };
}

describe("modulePermissions — alinhamento UI/API (INT-008, INT-009, INT-010)", () => {
  it("INT-009: só settings.view não abre Manutenção", () => {
    assert.equal(canAccessModule("maintenance", checker(["settings.view"])), false);
    assert.equal(canAccessModule("maintenance", checker(["maintenance.view"])), true);
  });

  it("INT-010: só pricing.view não abre Impostos", () => {
    assert.equal(canAccessModule("taxes", checker(["pricing.view"])), false);
    assert.equal(canAccessModule("taxes", checker(["taxes.view"])), true);
  });

  it("projects.view abre módulo Projetos", () => {
    assert.equal(canAccessModule("projects", checker(["settings.view"])), false);
    assert.equal(canAccessModule("projects", checker(["projects.view"])), true);
  });

  it("INT-008: só products.view não mostra abas cost/composition", () => {
    const tabs = getVisibleProductTabs(checker(["products.view"]));
    assert.equal(tabs.includes("cost"), false);
    assert.equal(tabs.includes("composition"), false);
    assert.equal(tabs.length, 0);
  });

  it("INT-008: products.tab.cost exibe aba cost", () => {
    const tabs = getVisibleProductTabs(checker(["products.tab.cost", "products.tab.info"]));
    assert.equal(tabs.includes("cost"), true);
    assert.equal(tabs.includes("info"), true);
  });
});

describe("modulePermissions — P09 costs.view sem cross-module", () => {
  it("INT-002: costs.view NÃO abre employees (P09)", () => {
    assert.equal(canAccessModule("employees", checker(["costs.view"])), false);
    assert.equal(canAccessModule("employees", checker(["employees.view"])), true);
  });

  it("costs.view ainda abre opex (legado identificado)", () => {
    assert.equal(canAccessModule("opex", checker(["costs.view"])), true);
  });

  it("INT-003: dashboard.view ainda abre Relatórios (legado preservado)", () => {
    assert.equal(canAccessModule("reports", checker(["dashboard.view"])), true);
  });
});
