import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyDenyOnResource,
  applyAllowOnResource,
  buildMatrixSaveDiff,
  buildSaveOverridesFromMatrix,
  buildUserEffectivePreview,
  buildUserPermissionMatrixModel,
  clearMatrixOverrideForResource,
  draftOverrideMapFromMatrixDraft,
  hasBroadPermissionChanges,
  hasCriticalPermissionChanges,
  resolveAxisWithPrecedence,
  sessionAffectedMessage,
  wouldMatrixRemoveOwnUsersManage,
  USER_PERMISSION_PRECEDENCE_NOTICE,
} from "./userPermissionsMatrix.ts";
import type { EditableTreeNodeDto } from "@/src/lib/userPermissionsAdminClient";

function node(
  partial: Partial<EditableTreeNodeDto> & Pick<EditableTreeNodeDto, "key" | "label">
): EditableTreeNodeDto {
  return {
    description: "",
    type: "MENU",
    module: "admin",
    parentKey: null,
    roleFlags: { canView: true, canExecute: false, canManage: false },
    override: null,
    effectiveFlags: { canView: true, canExecute: false, canManage: false },
    children: [],
    ...partial,
  };
}

describe("userPermissionsMatrix precedence", () => {
  it("deny explícito vence allow/baseline", () => {
    const r = resolveAxisWithPrecedence({ roleValue: true, override: false });
    assert.equal(r.effective, false);
    assert.equal(r.override, false);
  });

  it("allow explícito vence baseline negado", () => {
    const r = resolveAxisWithPrecedence({ roleValue: false, override: true });
    assert.equal(r.effective, true);
  });

  it("null herda baseline", () => {
    assert.equal(
      resolveAxisWithPrecedence({ roleValue: true, override: null }).effective,
      true
    );
  });

  it("notice documenta precedência", () => {
    assert.ok(USER_PERMISSION_PRECEDENCE_NOTICE.toLowerCase().includes("deny"));
  });
});

describe("userPermissionsMatrix model", () => {
  it("usuário só role: draft = baseline efetiva", () => {
    const tree = [
      node({
        key: "dashboard",
        label: "Dashboard",
        roleFlags: { canView: true, canExecute: false, canManage: false },
        effectiveFlags: { canView: true, canExecute: false, canManage: false },
      }),
    ];
    const model = buildUserPermissionMatrixModel(tree);
    assert.equal(model.draft.dashboard.view, true);
    assert.equal(model.baseline.dashboard.view, true);
  });

  it("allow / deny / limpar override", () => {
    const tree = [
      node({
        key: "dashboard",
        label: "Dashboard",
        type: "MENU",
        roleFlags: { canView: true, canExecute: false, canManage: false },
        effectiveFlags: { canView: true, canExecute: false, canManage: false },
      }),
    ];
    const model = buildUserPermissionMatrixModel(tree);
    let draft = applyDenyOnResource(model.draft, "dashboard");
    assert.equal(draft.dashboard.view, false);
    draft = applyAllowOnResource(draft, "dashboard", { view: true });
    assert.equal(draft.dashboard.view, true);
    draft = clearMatrixOverrideForResource(draft, model.baseline, "dashboard");
    assert.equal(draft.dashboard.view, model.baseline.dashboard.view);
  });

  it("conflito: override false gera canView null≠true no payload", () => {
    const tree = [
      node({
        key: "dashboard",
        label: "Dashboard",
        roleFlags: { canView: true, canExecute: false, canManage: false },
        effectiveFlags: { canView: false, canExecute: false, canManage: false },
        override: {
          canView: false,
          canExecute: null,
          canManage: null,
        },
      }),
    ];
    const model = buildUserPermissionMatrixModel(tree);
    const denied = applyDenyOnResource(model.baseline, "dashboard");
    const overrides = buildSaveOverridesFromMatrix(denied, [
      { resourceKey: "dashboard", flags: { canView: true, canExecute: false, canManage: false } },
    ]);
    const row = overrides.find((o) => o.resourceKey === "dashboard");
    assert.ok(row);
    assert.equal(row!.canView, false);
  });

  it("preview parent bloqueado marca filhos", () => {
    const tree = [
      node({
        key: "parent",
        label: "Pai",
        type: "MENU",
        roleFlags: { canView: true, canExecute: false, canManage: false },
        effectiveFlags: { canView: true, canExecute: false, canManage: false },
        children: [
          node({
            key: "child",
            label: "Filho",
            type: "TAB",
            parentKey: "parent",
            roleFlags: { canView: true, canExecute: false, canManage: false },
            effectiveFlags: { canView: true, canExecute: false, canManage: false },
          }),
        ],
      }),
    ];
    const model = buildUserPermissionMatrixModel(tree);
    const denied = applyDenyOnResource(model.draft, "parent");
    const preview = buildUserEffectivePreview(tree, denied, model.baseline);
    assert.ok(preview.menusBlocked.includes("Pai"));
    assert.ok(preview.tabsBlocked.includes("Filho"));
  });

  it("auto-lockout: remover users.manage de si", () => {
    const draft = {
      "admin.usuarios": {
        view: false,
        execute: false,
        manage: false,
      },
    };
    assert.equal(
      wouldMatrixRemoveOwnUsersManage({
        isEditingSelf: true,
        existingRole: "ADMIN",
        matrixDraft: draft,
        roleDefaults: [
          {
            resourceKey: "admin.usuarios",
            flags: { canView: true, canExecute: true, canManage: true },
          },
        ],
      }),
      true
    );
    assert.equal(
      wouldMatrixRemoveOwnUsersManage({
        isEditingSelf: false,
        existingRole: "ADMIN",
        matrixDraft: draft,
        roleDefaults: [
          {
            resourceKey: "admin.usuarios",
            flags: { canView: true, canExecute: true, canManage: true },
          },
        ],
      }),
      false
    );
  });

  it("critical change detection", () => {
    const baseline = {
      "admin.usuarios": { view: true, manage: true, execute: true },
    };
    const draft = {
      "admin.usuarios": { view: true, manage: false, execute: true },
    };
    assert.equal(hasCriticalPermissionChanges(draft, baseline), true);
  });

  it("draftOverrideMapFromMatrixDraft agrega eixos", () => {
    const flags = draftOverrideMapFromMatrixDraft({
      dashboard: { view: true, execute: true, manage: false },
    });
    assert.equal(flags.dashboard.canView, true);
    assert.equal(flags.dashboard.canExecute, true);
  });
});

describe("userPermissionsMatrix P22 — diff e confirmação ampla", () => {
  it("buildMatrixSaveDiff lista grants e revokes", () => {
    const tree = [
      node({
        key: "dashboard",
        label: "Dashboard",
        roleFlags: { canView: true, canExecute: false, canManage: false },
        effectiveFlags: { canView: true, canExecute: false, canManage: false },
      }),
    ];
    const model = buildUserPermissionMatrixModel(tree);
    const before = { ...model.draft };
    const after = applyDenyOnResource(model.draft, "dashboard");
    const diff = buildMatrixSaveDiff(model.rows, before, after);
    assert.ok(diff.some((d) => d.kind === "revoke" && d.resourceKey === "dashboard"));
  });

  it("hasBroadPermissionChanges usa limiar", () => {
    assert.equal(
      hasBroadPermissionChanges({
        dirtyResourceCount: 4,
        grantedCount: 0,
        deniedCount: 0,
        unchangedCount: 0,
        parentBlockedCount: 0,
        unsupportedCellCount: 0,
        changedLabels: [],
      }),
      false
    );
    assert.equal(
      hasBroadPermissionChanges({
        dirtyResourceCount: 5,
        grantedCount: 0,
        deniedCount: 0,
        unchangedCount: 0,
        parentBlockedCount: 0,
        unsupportedCellCount: 0,
        changedLabels: [],
      }),
      true
    );
  });

  it("sessionAffectedMessage diferencia self vs outro", () => {
    assert.ok(sessionAffectedMessage({ isEditingSelf: true, targetName: "Eu" }).includes("Sua sessão"));
    assert.ok(
      sessionAffectedMessage({ isEditingSelf: false, targetName: "Leticia" }).includes("Leticia")
    );
  });
});
