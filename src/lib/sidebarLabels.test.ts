import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MODULE_SHORT_LABELS,
  NAVIGATION_GROUP_SHORT_LABELS,
  resolveAppHeaderBreadcrumb,
  resolveModuleShortLabel,
  resolveNavigationGroupShortLabel,
} from "./sidebarLabels.js";
import { MODULE_LABELS } from "./modulePermissions.js";

describe("sidebarLabels — rótulos curtos visíveis", () => {
  it("grupos principais têm abreviação touch-friendly", () => {
    assert.equal(NAVIGATION_GROUP_SHORT_LABELS.engenharia, "Eng.");
    assert.equal(NAVIGATION_GROUP_SHORT_LABELS.cadeia_suprimentos, "Cad.");
    assert.equal(NAVIGATION_GROUP_SHORT_LABELS.comercial, "Com.");
    assert.equal(NAVIGATION_GROUP_SHORT_LABELS.financeiro, "Fin.");
    assert.equal(NAVIGATION_GROUP_SHORT_LABELS.operacoes, "Ops.");
  });

  it("módulos têm rótulo curto distinto do tooltip", () => {
    assert.equal(resolveModuleShortLabel("materials"), "Supr.");
    assert.equal(resolveModuleShortLabel("products"), "Prod.");
    assert.equal(resolveModuleShortLabel("commissions"), "Comiss.");
    assert.equal(MODULE_SHORT_LABELS.dashboard, "Home");
  });

  it("fallback usa MODULE_LABELS quando módulo não mapeado", () => {
    const fakeId = "dashboard" as const;
    assert.equal(resolveModuleShortLabel(fakeId), MODULE_SHORT_LABELS[fakeId]);
  });

  it("resolveNavigationGroupShortLabel cobre todos os grupos", () => {
    for (const groupId of Object.keys(NAVIGATION_GROUP_SHORT_LABELS)) {
      assert.ok(resolveNavigationGroupShortLabel(groupId as keyof typeof NAVIGATION_GROUP_SHORT_LABELS));
    }
  });
});

describe("sidebarLabels — breadcrumb do header", () => {
  it("dashboard retorna apenas o módulo", () => {
    assert.deepEqual(resolveAppHeaderBreadcrumb("/dashboard"), [
      { label: MODULE_LABELS.dashboard },
    ]);
  });

  it("módulo em grupo retorna grupo › módulo", () => {
    assert.deepEqual(resolveAppHeaderBreadcrumb("/materials"), [
      { label: "Cadeia de Suprimentos" },
      { label: MODULE_LABELS.materials, path: "/materials" },
    ]);
  });

  it("comercial › comissões", () => {
    assert.deepEqual(resolveAppHeaderBreadcrumb("/commissions"), [
      { label: "Comercial" },
      { label: MODULE_LABELS.commissions, path: "/commissions" },
    ]);
  });

  it("financeiro › fornecedores", () => {
    assert.deepEqual(resolveAppHeaderBreadcrumb("/finance/suppliers"), [
      { label: "Financeiro" },
      { label: MODULE_LABELS.suppliers, path: "/finance/suppliers" },
    ]);
  });

  it("financeiro › relatórios", () => {
    assert.deepEqual(resolveAppHeaderBreadcrumb("/reports"), [
      { label: "Financeiro" },
      { label: MODULE_LABELS.reports, path: "/reports" },
    ]);
  });

  it("rota desconhecida cai em Dashboard", () => {
    assert.deepEqual(resolveAppHeaderBreadcrumb("/"), [{ label: MODULE_LABELS.dashboard }]);
  });
});
