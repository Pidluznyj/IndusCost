/**
 * Isolamento das chaves que antes eram compartilhadas.
 * A prévia usa o resolvedor oficial. Perfil vazio evita o baseline da role.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SETTINGS_HUB_UI_SECTIONS, INVENTORY_UI_TABS, COMMISSIONS_LIVE_UI_TABS, TabResourceKeys } from "@/src/lib/moduleTabResources.js";
import { canViewCommissionsSection } from "@/src/lib/commissionsModulePermissions.js";
import { canViewInventoryTab } from "@/src/lib/operationsAdminPermissions.js";
import { OPERATIONS_RESOURCE_KEYS } from "@/src/lib/operationsAccess.js";
import { COMMERCIAL_RESOURCE_KEYS } from "@/src/lib/commercialAccess.js";
import { ADMIN_SETTINGS_RESOURCE_KEYS } from "@/src/lib/adminSettingsAccess.js";
import {
  canEffectiveAccess,
  resolveEffectiveAccess,
} from "@/src/lib/security/effectiveAccess/index.js";

function only(resourceKey: string, action: "view" | "manage" | "create" | "export" = "view") {
  return resolveEffectiveAccess({
    userId: "isolado",
    role: "SELLER",
    profileSnapshot: {},
    overrides: { [resourceKey]: { [action]: "allow" } },
  });
}

describe("isolamento de permissões que compartilhavam chave", () => {
  it("Previsão, Visão 360° e Relatórios são chaves diferentes", () => {
    const keys = COMMISSIONS_LIVE_UI_TABS.map((tab) => tab.resourceKey);
    assert.equal(new Set(keys).size, keys.length);
    assert.equal(
      COMMISSIONS_LIVE_UI_TABS.find((tab) => tab.id === "portfolioOutlook")?.resourceKey,
      TabResourceKeys.COMISSOES_PREVISAO
    );
    assert.equal(
      COMMISSIONS_LIVE_UI_TABS.find((tab) => tab.id === "view360")?.resourceKey,
      TabResourceKeys.COMISSOES_VISAO_360
    );
    assert.equal(
      COMMISSIONS_LIVE_UI_TABS.find((tab) => tab.id === "reports")?.resourceKey,
      TabResourceKeys.COMISSOES_RELATORIOS
    );
  });

  it("previsão permitida não abre Visão 360° nem Relatórios", () => {
    const checker = {
      hasPermission: () => false,
      hasAnyPermission: () => true,
      canViewResource: (key: string) => key === TabResourceKeys.COMISSOES_PREVISAO,
    };
    assert.equal(canViewCommissionsSection("portfolioOutlook", checker), true);
    assert.equal(canViewCommissionsSection("view360", checker), false);
    assert.equal(canViewCommissionsSection("reports", checker), false);

    const access = only(COMMERCIAL_RESOURCE_KEYS.commissionsPortfolioOutlook);
    assert.equal(canEffectiveAccess(access, COMMERCIAL_RESOURCE_KEYS.commissionsPortfolioOutlook, "view"), true);
    assert.equal(canEffectiveAccess(access, COMMERCIAL_RESOURCE_KEYS.commissionsView360, "view"), false);
    assert.equal(canEffectiveAccess(access, COMMERCIAL_RESOURCE_KEYS.commissionsReports, "view"), false);
  });

  it("saldos não libera movimentações, implantação, reservas nem auditoria", () => {
    const byId = Object.fromEntries(INVENTORY_UI_TABS.map((tab) => [tab.id, tab.resourceKey]));
    assert.equal(byId.balances, OPERATIONS_RESOURCE_KEYS.inventoryBalances);
    assert.notEqual(byId.balances, byId.movements);
    assert.notEqual(byId.movements, byId.implantation);
    assert.notEqual(byId.counts, byId.collectorDevices);
    assert.notEqual(byId.warehouses, byId.stockSectors);
    assert.notEqual(byId.balances, byId.reservations);
    assert.notEqual(byId.balances, byId.audit);

    const access = only(OPERATIONS_RESOURCE_KEYS.inventoryBalances);
    assert.equal(canEffectiveAccess(access, OPERATIONS_RESOURCE_KEYS.inventoryBalances, "view"), true);
    assert.equal(canEffectiveAccess(access, OPERATIONS_RESOURCE_KEYS.inventoryMovements, "view"), false);
    assert.equal(canEffectiveAccess(access, OPERATIONS_RESOURCE_KEYS.inventoryImplantation, "create"), false);
    assert.equal(canEffectiveAccess(access, OPERATIONS_RESOURCE_KEYS.inventoryReservations, "view"), false);
    assert.equal(canEffectiveAccess(access, OPERATIONS_RESOURCE_KEYS.inventoryAudit, "view"), false);
    assert.equal(canEffectiveAccess(access, "operations.inventory.adjustment", "create"), false);
  });

  it("conferência física não administra o coletor", () => {
    const access = only(OPERATIONS_RESOURCE_KEYS.inventoryCounts);
    assert.equal(canEffectiveAccess(access, OPERATIONS_RESOURCE_KEYS.inventoryCounts, "view"), true);
    assert.equal(canEffectiveAccess(access, OPERATIONS_RESOURCE_KEYS.inventoryCollectorDevices, "view"), false);
    assert.equal(canEffectiveAccess(access, OPERATIONS_RESOURCE_KEYS.inventoryCollectorDevices, "manage"), false);
  });

  it("integrações não abre Sistema", () => {
    const integrations = SETTINGS_HUB_UI_SECTIONS.find((section) => section.id === "integrations");
    const system = SETTINGS_HUB_UI_SECTIONS.find((section) => section.id === "system");
    assert.equal(integrations?.resourceKey, ADMIN_SETTINGS_RESOURCE_KEYS.integrations);
    assert.equal(system?.resourceKey, ADMIN_SETTINGS_RESOURCE_KEYS.system);
    assert.notEqual(integrations?.resourceKey, system?.resourceKey);

    const access = only(ADMIN_SETTINGS_RESOURCE_KEYS.integrations);
    assert.equal(canEffectiveAccess(access, ADMIN_SETTINGS_RESOURCE_KEYS.integrations, "view"), true);
    assert.equal(canEffectiveAccess(access, ADMIN_SETTINGS_RESOURCE_KEYS.system, "view"), false);
    assert.equal(canEffectiveAccess(access, ADMIN_SETTINGS_RESOURCE_KEYS.security, "manage"), false);
  });

  it("aba de saldo consulta a própria chave, não o módulo inteiro", () => {
    const auth = {
      hasPermission: () => true,
      hasAnyPermission: () => true,
      canViewResource: () => true,
      canPerformAction: (key: string) => key === OPERATIONS_RESOURCE_KEYS.inventory || key === OPERATIONS_RESOURCE_KEYS.inventoryBalances,
    };
    assert.equal(canViewInventoryTab("balances", auth), true);
    assert.equal(canViewInventoryTab("movements", auth), false);
    assert.equal(canViewInventoryTab("audit", auth), false);
  });
});
