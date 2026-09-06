/**
 * OP-05 — Flags, navegação e acesso dos módulos SC controlados.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canShowSupplyChainModuleNavigation,
  getSupplyChainFeatureFlags,
  isSupplyChainInventoryModuleEnabled,
  isSupplyChainPurchasesModuleEnabled,
  isSupplyChainReceivingModuleEnabled,
  requireSupplyChainModuleEnabled,
  SUPPLY_CHAIN_FEATURE_ENV,
  SUPPLY_CHAIN_MODULE_IDS,
} from "./supplyChainFeatureFlags.js";
import {
  canViewSupplyChainInventoryModule,
  canViewSupplyChainPurchasesModule,
  canViewSupplyChainReceivingModule,
  SUPPLY_CHAIN_VIEW_PERMISSIONS,
} from "./supplyChainAccess.js";
import { filterSupplyChainMenuNavigation } from "./supplyChainNavigation.js";
import { buildSupplyChainModulesAdminStatus } from "./supplyChainModuleStatus.server.js";
import { getModulePath } from "@/src/lib/navigationGroups.js";
import { buildGroupedNavigationStructure } from "@/src/lib/navigationGroups.js";
import { canAccessModule, SIDEBAR_MODULE_ORDER } from "@/src/lib/modulePermissions.js";
import type { SidebarAccessibleNavigation } from "@/src/lib/sidebarNavigation.js";

describe("supplyChainFeatureFlags", () => {
  it("fail closed por padrão", () => {
    assert.equal(isSupplyChainPurchasesModuleEnabled({}), false);
    assert.equal(isSupplyChainInventoryModuleEnabled({}), false);
    assert.equal(isSupplyChainReceivingModuleEnabled({}), false);
    const snap = getSupplyChainFeatureFlags({});
    assert.equal(snap.purchases, false);
    assert.equal(snap.inventory, false);
    assert.equal(snap.receiving, false);
    assert.equal(snap.shadowPlanning, false);
    assert.equal(snap.indicators, false);
    assert.equal(snap.defaultWhenAbsent, false);
  });

  it("ativa só com valores explícitos e flags separadas", () => {
    assert.equal(
      isSupplyChainPurchasesModuleEnabled({
        [SUPPLY_CHAIN_FEATURE_ENV.purchases]: "true",
      }),
      true
    );
    assert.equal(
      isSupplyChainInventoryModuleEnabled({
        [SUPPLY_CHAIN_FEATURE_ENV.purchases]: "true",
      }),
      false
    );
    assert.equal(
      isSupplyChainReceivingModuleEnabled({
        [SUPPLY_CHAIN_FEATURE_ENV.receiving]: "on",
      }),
      true
    );
  });

  it("guard retorna 404 quando desligada", () => {
    let statusCode = 0;
    let nextCalled = false;
    requireSupplyChainModuleEnabled("sc-receiving", {})(
      {} as never,
      {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json() {
          return this;
        },
      } as never,
      () => {
        nextCalled = true;
      }
    );
    assert.equal(statusCode, 404);
    assert.equal(nextCalled, false);
  });

  it("canShow exige flag e permissão", () => {
    assert.equal(
      canShowSupplyChainModuleNavigation({
        featureEnabled: true,
        hasViewAccess: true,
      }),
      true
    );
    assert.equal(
      canShowSupplyChainModuleNavigation({
        featureEnabled: false,
        hasViewAccess: true,
      }),
      false
    );
    assert.equal(
      canShowSupplyChainModuleNavigation({
        featureEnabled: true,
        hasViewAccess: false,
      }),
      false
    );
  });
});

describe("supplyChainAccess — sem mega-keys", () => {
  it("não concede por purchases.view / inventory.view", () => {
    const checker = {
      hasPermission: (p: string) =>
        p === "purchases.view" || p === "inventory.view",
    };
    assert.equal(canViewSupplyChainPurchasesModule(checker), false);
    assert.equal(canViewSupplyChainInventoryModule(checker), false);
    assert.equal(canViewSupplyChainReceivingModule(checker), false);
  });

  it("concede só com chaves específicas", () => {
    assert.equal(
      canViewSupplyChainPurchasesModule({
        hasPermission: (p) => p === SUPPLY_CHAIN_VIEW_PERMISSIONS.purchases,
      }),
      true
    );
    assert.equal(
      canAccessModule("sc-purchases", {
        hasPermission: (p) => p === SUPPLY_CHAIN_VIEW_PERMISSIONS.purchases,
        hasAnyPermission: () => false,
      }),
      true
    );
    assert.equal(
      canAccessModule("sc-purchases", {
        hasPermission: (p) => p === "purchases.view",
        hasAnyPermission: () => false,
      }),
      false
    );
  });
});

describe("supplyChainNavigation — preserva legado", () => {
  const baseNav: SidebarAccessibleNavigation = {
    directItems: [],
    groups: [
      {
        id: "cadeia_suprimentos",
        label: "Cadeia de Suprimentos",
        iconKey: "Truck",
        order: 3,
        itemIds: [
          "materials",
          "purchases",
          "sc-purchases",
          "inventory",
          "sc-inventory",
          "sc-receiving",
        ],
        items: [
          {
            groupId: "cadeia_suprimentos",
            itemId: "materials",
            label: "Suprimentos",
            path: "/materials",
            requiredPermissions: [],
            resourceKey: null,
            originalItem: { id: "materials", label: "Suprimentos", path: "/materials" },
          },
          {
            groupId: "cadeia_suprimentos",
            itemId: "purchases",
            label: "Compras",
            path: "/purchases",
            requiredPermissions: [],
            resourceKey: null,
            originalItem: { id: "purchases", label: "Compras", path: "/purchases" },
          },
          {
            groupId: "cadeia_suprimentos",
            itemId: "sc-purchases",
            label: "Compras SC",
            path: "/supply-chain/purchases",
            requiredPermissions: [],
            resourceKey: null,
            originalItem: {
              id: "sc-purchases",
              label: "Compras SC",
              path: "/supply-chain/purchases",
            },
          },
          {
            groupId: "cadeia_suprimentos",
            itemId: "inventory",
            label: "Estoque",
            path: "/inventory",
            requiredPermissions: [],
            resourceKey: null,
            originalItem: { id: "inventory", label: "Estoque", path: "/inventory" },
          },
          {
            groupId: "cadeia_suprimentos",
            itemId: "sc-inventory",
            label: "Estoque SC",
            path: "/supply-chain/inventory",
            requiredPermissions: [],
            resourceKey: null,
            originalItem: {
              id: "sc-inventory",
              label: "Estoque SC",
              path: "/supply-chain/inventory",
            },
          },
          {
            groupId: "cadeia_suprimentos",
            itemId: "sc-receiving",
            label: "Recebimentos",
            path: "/supply-chain/receiving",
            requiredPermissions: [],
            resourceKey: null,
            originalItem: {
              id: "sc-receiving",
              label: "Recebimentos",
              path: "/supply-chain/receiving",
            },
          },
        ],
      },
    ],
    fallbackGroup: null,
    flatAccessibleItems: [
      { id: "materials", label: "Suprimentos", path: "/materials", resourceKey: null },
      { id: "purchases", label: "Compras", path: "/purchases", resourceKey: null },
      {
        id: "sc-purchases",
        label: "Compras SC",
        path: "/supply-chain/purchases",
        resourceKey: null,
      },
      { id: "inventory", label: "Estoque", path: "/inventory", resourceKey: null },
      {
        id: "sc-inventory",
        label: "Estoque SC",
        path: "/supply-chain/inventory",
        resourceKey: null,
      },
      {
        id: "sc-receiving",
        label: "Recebimentos",
        path: "/supply-chain/receiving",
        resourceKey: null,
      },
    ],
  };

  it("com flags off remove só cascas SC e mantém purchases/inventory", () => {
    const filtered = filterSupplyChainMenuNavigation(
      baseNav,
      { purchases: false, inventory: false, receiving: false },
      { purchases: true, inventory: true, receiving: true }
    );
    const ids = filtered.flatAccessibleItems.map((i) => i.id);
    assert.ok(ids.includes("purchases"));
    assert.ok(ids.includes("inventory"));
    assert.ok(ids.includes("materials"));
    assert.equal(ids.includes("sc-purchases"), false);
    assert.equal(ids.includes("sc-inventory"), false);
    assert.equal(ids.includes("sc-receiving"), false);
  });

  it("com flag+perm on inclui casca correspondente", () => {
    const filtered = filterSupplyChainMenuNavigation(
      baseNav,
      { purchases: true, inventory: false, receiving: true },
      { purchases: true, inventory: true, receiving: true }
    );
    const ids = filtered.flatAccessibleItems.map((i) => i.id);
    assert.ok(ids.includes("sc-purchases"));
    assert.ok(ids.includes("sc-receiving"));
    assert.equal(ids.includes("sc-inventory"), false);
  });
});

describe("rotas e grupo Cadeia de Suprimentos", () => {
  it("módulos SC estão no grupo e paths corretos", () => {
    const structure = buildGroupedNavigationStructure();
    const group = structure.groups.find((g) => g.id === "cadeia_suprimentos");
    assert.ok(group);
    const itemIds = group!.items.map((i) => i.itemId);
    for (const id of SUPPLY_CHAIN_MODULE_IDS) {
      assert.ok(SIDEBAR_MODULE_ORDER.includes(id));
      assert.ok(itemIds.includes(id), id);
    }
    assert.equal(getModulePath("sc-purchases"), "/supply-chain/purchases");
    assert.equal(getModulePath("sc-inventory"), "/supply-chain/inventory");
    assert.equal(getModulePath("sc-receiving"), "/supply-chain/receiving");
    assert.equal(getModulePath("purchases"), "/purchases/nomus-orders");
    assert.equal(getModulePath("inventory"), "/inventory");
  });

  it("status administrativo lista flags e notas de preservação", () => {
    const status = buildSupplyChainModulesAdminStatus({});
    assert.equal(status.modules.length, 3);
    assert.ok(status.modules.every((m) => m.enabled === false));
    assert.ok(status.notes.some((n) => /\/purchases/.test(n)));
  });
});
