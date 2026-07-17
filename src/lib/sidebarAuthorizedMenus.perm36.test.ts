/**
 * PERM-36 — menu lateral só com catálogo oficial + allowedResources do /me.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildGroupedNavigationStructure } from "@/src/lib/navigationGroups.js";
import { SIDEBAR_MODULE_ORDER } from "@/src/lib/modulePermissions.js";
import {
  effectiveAccessDtoFromAllowedResources,
  filterOfficialSidebarByEffectiveAccess,
} from "@/src/lib/sidebarEffectiveAccess.js";

function groupItemIds(
  nav: ReturnType<typeof filterOfficialSidebarByEffectiveAccess>,
  groupId: string
): string[] {
  const g = nav.groups.find((x) => x.id === groupId);
  return g ? g.items.map((i) => i.itemId) : [];
}

function officialComercialOrder(): string[] {
  const structure = buildGroupedNavigationStructure();
  const g = structure.groups.find((x) => x.id === "comercial");
  return g ? g.items.map((i) => i.itemId) : [];
}

describe("PERM-36 — filterOfficialSidebarByEffectiveAccess", () => {
  it("allowedResources vazio → menu vazio (não SUPER_ADMIN)", () => {
    const dto = effectiveAccessDtoFromAllowedResources([]);
    const nav = filterOfficialSidebarByEffectiveAccess(dto);
    assert.equal(nav.flatAccessibleItems.length, 0);
    assert.equal(nav.groups.length, 0);
    assert.equal(nav.directItems.length, 0);
  });

  it("SUPER_ADMIN vê toda a navegação na ordem oficial", () => {
    const dto = effectiveAccessDtoFromAllowedResources([], {
      isSuperAdmin: true,
      role: "SUPER_ADMIN",
    });
    const nav = filterOfficialSidebarByEffectiveAccess(dto);
    assert.equal(nav.flatAccessibleItems.length, SIDEBAR_MODULE_ORDER.length);
    assert.deepEqual(
      nav.flatAccessibleItems.map((i) => i.id),
      [...SIDEBAR_MODULE_ORDER]
    );
    assert.ok(nav.groups.some((g) => g.id === "comercial"));
    assert.ok(nav.groups.some((g) => g.id === "financeiro"));
  });

  it("recurso desconhecido não revela nenhum item", () => {
    const dto = effectiveAccessDtoFromAllowedResources(["unknown.resource"]);
    const nav = filterOfficialSidebarByEffectiveAccess(dto);
    assert.equal(nav.flatAccessibleItems.length, 0);
    assert.equal(nav.groups.length, 0);
  });

  it("Comercial oculto quando nenhum recurso comercial está permitido", () => {
    const dto = effectiveAccessDtoFromAllowedResources([
      "engineering.products",
      "finance.accounts_payable",
    ]);
    const nav = filterOfficialSidebarByEffectiveAccess(dto);
    assert.equal(
      nav.groups.some((g) => g.id === "comercial"),
      false,
      "grupo Comercial não deve aparecer"
    );
    assert.ok(nav.groups.some((g) => g.id === "engenharia"));
    assert.ok(nav.groups.some((g) => g.id === "financeiro"));
    assert.deepEqual(groupItemIds(nav, "engenharia"), ["products"]);
    assert.deepEqual(groupItemIds(nav, "financeiro"), ["finance"]);
  });

  it("módulo com um filho permitido aparece; irmão negado some", () => {
    const dto = effectiveAccessDtoFromAllowedResources([
      "commercial.sales_orders",
    ]);
    const nav = filterOfficialSidebarByEffectiveAccess(dto);
    assert.deepEqual(groupItemIds(nav, "comercial"), ["sales-orders"]);
    assert.equal(groupItemIds(nav, "comercial").includes("crm-commercial"), false);
    assert.equal(groupItemIds(nav, "comercial").includes("customers"), false);
    assert.equal(nav.groups.some((g) => g.id === "financeiro"), false);
  });

  it("vários filhos comerciais: ordem = catálogo oficial", () => {
    const dto = effectiveAccessDtoFromAllowedResources([
      "commercial.commissions",
      "commercial.crm",
      "commercial.customers",
      "commercial.sales_orders",
    ]);
    const nav = filterOfficialSidebarByEffectiveAccess(dto);
    const visible = groupItemIds(nav, "comercial");
    const official = officialComercialOrder().filter((id) =>
      ["crm-commercial", "customers", "sales-orders", "commissions"].includes(id)
    );
    assert.deepEqual(visible, official);
  });

  it("financeiro: AP revela shell finance; portfolio negado não aparece", () => {
    const dto = effectiveAccessDtoFromAllowedResources([
      "finance.accounts_payable",
    ]);
    const nav = filterOfficialSidebarByEffectiveAccess(dto);
    assert.deepEqual(groupItemIds(nav, "financeiro"), ["finance"]);
    assert.equal(
      nav.flatAccessibleItems.some((i) => i.id === "portfolio-reconciliation"),
      false
    );
  });

  it("módulo sem filhos permitidos (grupo vazio) não aparece", () => {
    const dto = effectiveAccessDtoFromAllowedResources(["admin.employees"]);
    const nav = filterOfficialSidebarByEffectiveAccess(dto);
    assert.ok(nav.groups.some((g) => g.id === "administracao"));
    assert.deepEqual(groupItemIds(nav, "administracao"), ["employees"]);
    assert.equal(nav.groups.some((g) => g.id === "comercial"), false);
    assert.equal(nav.groups.some((g) => g.id === "engenharia"), false);
    assert.equal(nav.groups.some((g) => g.id === "operacoes"), false);
  });

  it("dashboard direto só com dashboard allowed", () => {
    const dto = effectiveAccessDtoFromAllowedResources(["dashboard"]);
    const nav = filterOfficialSidebarByEffectiveAccess(dto);
    assert.deepEqual(
      nav.directItems.map((i) => i.itemId),
      ["dashboard"]
    );
    assert.equal(nav.groups.length, 0);
  });

  it("ordem dos grupos permanece a do catálogo oficial", () => {
    const dto = effectiveAccessDtoFromAllowedResources([
      "dashboard",
      "engineering.products",
      "commercial.crm",
      "finance.accounts_payable",
      "operations.inventory",
      "admin.settings",
    ]);
    const nav = filterOfficialSidebarByEffectiveAccess(dto);
    const structure = buildGroupedNavigationStructure();
    const relativeOfficial = structure.groups
      .map((g) => g.id)
      .filter((id) => nav.groups.some((g) => g.id === id));
    assert.deepEqual(nav.groups.map((g) => g.id), relativeOfficial);
    assert.ok(nav.directItems.some((i) => i.itemId === "dashboard"));
  });
});
