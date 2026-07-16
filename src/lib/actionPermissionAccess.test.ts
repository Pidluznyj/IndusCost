import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AuthUser } from "@/src/lib/appAuthClient.js";
import type { EffectiveAccessMeDto } from "@/src/lib/effectiveAccessDtoTypes.js";
import { EFFECTIVE_ACCESS_PERMISSIONS_VERSION_PLACEHOLDER } from "@/src/lib/effectiveAccessDtoTypes.js";
import {
  ACTION_GATE_RESOURCES,
  capabilitiesFromActions,
  dtoAllowsAction,
  listP14PendingActionEndpoints,
  projectContractActionsFromLegacyBag,
  UI_ACTION_TO_DTO_ACTION,
} from "./actionPermissionAccess.ts";
import {
  canPerformAction,
  navigationAccessContextFromAuth,
} from "./resourceNavigationAccess.ts";

function emptyDto(
  partial: Partial<EffectiveAccessMeDto> & {
    actionsByResource?: EffectiveAccessMeDto["actionsByResource"];
    capabilities?: EffectiveAccessMeDto["capabilities"];
  }
): EffectiveAccessMeDto {
  return {
    permissionsVersion: EFFECTIVE_ACCESS_PERMISSIONS_VERSION_PLACEHOLDER,
    role: partial.role ?? "ADMIN",
    isSuperAdmin: partial.isSuperAdmin ?? false,
    allowedResources: partial.allowedResources ?? Object.keys(partial.actionsByResource ?? {}),
    actionsByResource: partial.actionsByResource ?? {},
    navigationReveal: partial.navigationReveal ?? [],
    capabilities: partial.capabilities ?? {},
    compatibility: {
      mode: "shadow",
      legacyBagAuthoritative: true,
      legacyPermissionsPresent: true,
      legacyCompatApplied: true,
    },
  };
}

function user(partial: {
  role: AuthUser["role"];
  permissions?: string[];
  isActive?: boolean;
  effectiveAccess?: EffectiveAccessMeDto | null;
}): AuthUser & { effectiveAccess?: EffectiveAccessMeDto | null } {
  const permissions = partial.permissions ?? [];
  return {
    id: "u1",
    name: "Test",
    email: "t@example.com",
    role: partial.role,
    permissions,
    effectivePermissions: permissions,
    accessProfileId: null,
    accessProfileName: null,
    employeeId: null,
    employeeName: null,
    employeeDepartment: null,
    isActive: partial.isActive ?? true,
    externalSellerId: null,
    externalSellerIds: [],
    sellerResponsibleName: null,
    lastLoginAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    effectiveAccess: partial.effectiveAccess,
  } as AuthUser & { effectiveAccess?: EffectiveAccessMeDto | null };
}

describe("actionPermissionAccess — projection", () => {
  it("export AP exige primary .export — view não promove export", () => {
    const viewOnly = projectContractActionsFromLegacyBag(["finance.accountsPayable.view"]);
    assert.ok(!viewOnly["finance.accounts_payable"]?.includes("export"));

    const withExport = projectContractActionsFromLegacyBag([
      "finance.accountsPayable.export",
    ]);
    assert.ok(withExport["finance.accounts_payable"]?.includes("export"));
  });

  it("close / reprocess projetam a partir das keys manage", () => {
    const closeMap = projectContractActionsFromLegacyBag(["commissions.payments.manage"]);
    assert.ok(closeMap["commercial.commissions.monthly_closing"]?.includes("close"));

    const reprocessMap = projectContractActionsFromLegacyBag(["commissions.rules.manage"]);
    assert.ok(reprocessMap["commercial.commissions.reprocess"]?.includes("reprocess"));
  });

  it("aliases UI mapeiam para DTO canônico", () => {
    assert.equal(UI_ACTION_TO_DTO_ACTION.synchronize, "execute");
    assert.equal(UI_ACTION_TO_DTO_ACTION.cancel, "manage");
    assert.equal(UI_ACTION_TO_DTO_ACTION.publish, "manage");
    assert.equal(UI_ACTION_TO_DTO_ACTION.reverse, "execute");
  });

  it("capabilitiesFromActions não marca canExecute só com view", () => {
    const caps = capabilitiesFromActions(["view"]);
    assert.equal(caps.canView, true);
    assert.equal(caps.canExecute, false);
    assert.equal(caps.canManage, false);
  });
});

describe("dtoAllowsAction", () => {
  it("SUPER_ADMIN libera qualquer action", () => {
    const dto = emptyDto({ isSuperAdmin: true, role: "SUPER_ADMIN", actionsByResource: {} });
    assert.equal(dtoAllowsAction(dto, ACTION_GATE_RESOURCES.financeAccountsPayable, "export"), true);
    assert.equal(dtoAllowsAction(dto, ACTION_GATE_RESOURCES.commissionsReprocess, "reprocess"), true);
  });

  it("deny: view listada não autoriza export", () => {
    const dto = emptyDto({
      actionsByResource: {
        "finance.accounts_payable": ["view"],
      },
      capabilities: {
        "finance.accounts_payable": { canView: true, canExecute: false, canManage: false },
      },
    });
    assert.equal(dtoAllowsAction(dto, "finance.accounts_payable", "view"), true);
    assert.equal(dtoAllowsAction(dto, "finance.accounts_payable", "export"), false);
  });

  it("deny: canExecute genérico não promove export", () => {
    const dto = emptyDto({
      actionsByResource: {
        "finance.accounts_payable": ["view", "execute"],
      },
      capabilities: {
        "finance.accounts_payable": { canView: true, canExecute: true, canManage: false },
      },
    });
    assert.equal(dtoAllowsAction(dto, "finance.accounts_payable", "execute"), true);
    assert.equal(dtoAllowsAction(dto, "finance.accounts_payable", "export"), false);
  });

  it("allow: export listado", () => {
    const dto = emptyDto({
      actionsByResource: {
        "finance.accounts_payable": ["view", "export"],
      },
      capabilities: {
        "finance.accounts_payable": { canView: true, canExecute: true, canManage: false },
      },
    });
    assert.equal(dtoAllowsAction(dto, "finance.accounts_payable", "export"), true);
  });

  it("allow: synchronize alias → execute em nomus_sync", () => {
    const dto = emptyDto({
      actionsByResource: {
        "admin.settings.nomus_sync": ["view", "execute"],
      },
      capabilities: {
        "admin.settings.nomus_sync": { canView: true, canExecute: true, canManage: false },
      },
    });
    assert.equal(
      dtoAllowsAction(dto, ACTION_GATE_RESOURCES.adminSettingsNomus, "synchronize"),
      true
    );
  });

  it("allow: close / reprocess listados", () => {
    const dto = emptyDto({
      actionsByResource: {
        "commercial.commissions.monthly_closing": ["view", "close", "manage"],
        "commercial.commissions.reprocess": ["view", "reprocess"],
      },
    });
    assert.equal(
      dtoAllowsAction(dto, ACTION_GATE_RESOURCES.commissionsMonthlyClosing, "close"),
      true
    );
    assert.equal(
      dtoAllowsAction(dto, ACTION_GATE_RESOURCES.commissionsReprocess, "reprocess"),
      true
    );
  });
});

describe("canPerformAction — loading / deny / SA", () => {
  it("loading e session error negam", () => {
    const u = user({ role: "ADMIN", permissions: ["finance.accountsPayable.export"] });
    assert.equal(
      canPerformAction("finance.accounts_payable", "export", {
        user: u,
        checker: {
          hasPermission: () => true,
          hasAnyPermission: () => true,
          authUser: u,
        },
        authLoading: true,
        authError: null,
      }),
      false
    );
    assert.equal(
      canPerformAction("finance.accounts_payable", "export", {
        user: u,
        checker: {
          hasPermission: () => true,
          hasAnyPermission: () => true,
          authUser: u,
        },
        authLoading: false,
        authError: "boom",
      }),
      false
    );
  });

  it("SUPER_ADMIN via contexto", () => {
    const u = user({ role: "SUPER_ADMIN", permissions: [] });
    const ctx = navigationAccessContextFromAuth({
      authUser: u,
      authLoading: false,
      authError: null,
      effectiveAccess: null,
      hasPermission: () => false,
      hasAnyPermission: () => false,
    });
    assert.equal(canPerformAction("finance.accounts_payable", "delete", ctx), true);
    assert.equal(canPerformAction("admin.settings.nomus_sync", "synchronize", ctx), true);
  });

  it("usuário inativo (não SA) nega", () => {
    const u = user({
      role: "ADMIN",
      permissions: ["finance.accountsPayable.export"],
      isActive: false,
    });
    assert.equal(
      canPerformAction("finance.accounts_payable", "export", {
        user: u,
        checker: {
          hasPermission: (k) => k === "finance.accountsPayable.export",
          hasAnyPermission: (list) => list.includes("finance.accountsPayable.export"),
          authUser: u,
        },
        authLoading: false,
        authError: null,
      }),
      false
    );
  });
});

describe("P14 pending endpoints registry", () => {
  it("lista endpoints críticos para guards de API", () => {
    const list = listP14PendingActionEndpoints();
    assert.ok(list.length >= 4);
    assert.ok(list.some((e) => e.path.includes("accounts-receivable/export") && e.action === "export"));
    assert.ok(list.some((e) => e.action === "reprocess"));
    assert.ok(list.some((e) => e.resourceKey === "admin.settings.nomus_sync"));
  });
});
