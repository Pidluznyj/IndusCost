import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SidebarAccessibleNavigation } from "@/src/lib/sidebarNavigation.js";
import {
  canViewTreasuryModule,
  filterTreasuryMenuNavigation,
  TREASURY_MODULE_ID,
} from "./treasuryNavigation.js";

function navWithTreasury(): SidebarAccessibleNavigation {
  const treasuryItem = {
    groupId: "financeiro" as const,
    itemId: TREASURY_MODULE_ID,
    label: "Tesouraria",
    path: "/finance/treasury",
    requiredPermissions: ["finance.treasury.view"],
    resourceKey: "finance.treasury",
    originalItem: {
      id: TREASURY_MODULE_ID,
      label: "Tesouraria",
      path: "/finance/treasury",
    },
  };
  const financeItem = {
    groupId: "financeiro" as const,
    itemId: "finance" as const,
    label: "Financeiro",
    path: "/finance",
    requiredPermissions: ["finance.view"],
    resourceKey: "financeiro",
    originalItem: {
      id: "finance" as const,
      label: "Financeiro",
      path: "/finance",
    },
  };
  return {
    directItems: [],
    groups: [
      {
        id: "financeiro",
        label: "Financeiro",
        iconKey: "Banknote",
        order: 1,
        isDirect: false,
        itemIds: ["finance", TREASURY_MODULE_ID],
        resourceKey: null,
        items: [financeItem, treasuryItem],
      },
    ],
    fallbackGroup: null,
    flatAccessibleItems: [
      { id: "finance", label: "Financeiro", path: "/finance" },
      { id: TREASURY_MODULE_ID, label: "Tesouraria", path: "/finance/treasury" },
    ],
  };
}

describe("treasuryNavigation", () => {
  it("exibe Tesouraria só com flag true e view", () => {
    const out = filterTreasuryMenuNavigation(navWithTreasury(), {
      featureEnabled: true,
      hasTreasuryViewAccess: true,
    });
    assert.ok(out.flatAccessibleItems.some((i) => i.id === TREASURY_MODULE_ID));
    assert.ok(
      out.groups[0]?.items.some((i) => i.itemId === TREASURY_MODULE_ID)
    );
  });

  it("oculta quando flag null/false (fail-closed no menu)", () => {
    for (const featureEnabled of [null, false] as const) {
      const out = filterTreasuryMenuNavigation(navWithTreasury(), {
        featureEnabled,
        hasTreasuryViewAccess: true,
      });
      assert.equal(
        out.flatAccessibleItems.some((i) => i.id === TREASURY_MODULE_ID),
        false
      );
    }
  });

  it("oculta quando usuário não tem finance.treasury.view", () => {
    const out = filterTreasuryMenuNavigation(navWithTreasury(), {
      featureEnabled: true,
      hasTreasuryViewAccess: false,
    });
    assert.equal(
      out.flatAccessibleItems.some((i) => i.id === TREASURY_MODULE_ID),
      false
    );
  });

  it("canViewTreasuryModule aceita canPerformAction ou bag legada", () => {
    assert.equal(
      canViewTreasuryModule({
        hasPermission: () => false,
        canPerformAction: (resource, action) =>
          resource === "finance.treasury" && action === "view",
      }),
      true
    );
    assert.equal(
      canViewTreasuryModule({
        hasPermission: (p) => p === "finance.treasury.view",
      }),
      true
    );
    assert.equal(
      canViewTreasuryModule({
        hasPermission: () => false,
      }),
      false
    );
  });
});
