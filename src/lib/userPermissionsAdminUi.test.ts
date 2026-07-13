import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  draftFromPayloadTree,
  filterAdminUsersList,
  formatPermissionFlagsHuman,
  isPermissionDraftDirty,
  overridesPayloadFromDraft,
  permissionResourceTypeLabel,
  setModuleFlags,
} from "./userPermissionsAdminUi.ts";
import type { EditableTreeNodeDto } from "./userPermissionsAdminClient.ts";

const sampleTree: EditableTreeNodeDto[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    description: "d",
    type: "MENU",
    module: "dashboard",
    parentKey: null,
    roleFlags: { canView: true, canExecute: false, canManage: false },
    override: null,
    effectiveFlags: { canView: true, canExecute: false, canManage: false },
    children: [],
  },
  {
    key: "financeiro",
    label: "Financeiro",
    description: "f",
    type: "MENU",
    module: "finance",
    parentKey: null,
    roleFlags: { canView: false, canExecute: false, canManage: false },
    override: null,
    effectiveFlags: { canView: false, canExecute: false, canManage: false },
    children: [
      {
        key: "financeiro.conciliacao_carteira",
        label: "Conciliação",
        description: "c",
        type: "SUBMENU",
        module: "finance",
        parentKey: "financeiro",
        roleFlags: { canView: false, canExecute: false, canManage: false },
        override: null,
        effectiveFlags: { canView: false, canExecute: false, canManage: false },
        children: [],
      },
    ],
  },
];

describe("userPermissionsAdminUi", () => {
  it("filtra lista por busca, role, ativo e customizada", () => {
    const users = [
      {
        id: "1",
        name: "Ana",
        email: "ana@x.com",
        role: "ADMIN" as const,
        permissions: [],
        effectivePermissions: [],
        accessProfileId: null,
        accessProfileName: null,
        isActive: true,
        externalSellerId: null,
        sellerResponsibleName: null,
        lastLoginAt: null,
        createdAt: "",
        updatedAt: "",
        hasCustomPermissions: true,
      },
      {
        id: "2",
        name: "Bob",
        email: "bob@x.com",
        role: "VIEWER" as const,
        permissions: [],
        effectivePermissions: [],
        accessProfileId: null,
        accessProfileName: null,
        isActive: false,
        externalSellerId: null,
        sellerResponsibleName: null,
        lastLoginAt: null,
        createdAt: "",
        updatedAt: "",
        hasCustomPermissions: false,
      },
    ];
    assert.equal(
      filterAdminUsersList(users, {
        search: "ana",
        role: "ALL",
        active: "ALL",
        customOnly: false,
      }).length,
      1
    );
    assert.equal(
      filterAdminUsersList(users, {
        search: "",
        role: "VIEWER",
        active: "INACTIVE",
        customOnly: false,
      }).length,
      1
    );
    assert.equal(
      filterAdminUsersList(users, {
        search: "",
        role: "ALL",
        active: "ALL",
        customOnly: true,
      }).length,
      1
    );
  });

  it("draft e dirty detectam alteração vs baseline", () => {
    const draft = draftFromPayloadTree(sampleTree);
    const defaults = [
      { resourceKey: "dashboard", flags: sampleTree[0]!.roleFlags },
      { resourceKey: "financeiro", flags: sampleTree[1]!.roleFlags },
      {
        resourceKey: "financeiro.conciliacao_carteira",
        flags: sampleTree[1]!.children[0]!.roleFlags,
      },
    ];
    assert.equal(isPermissionDraftDirty(draft, defaults, []), false);
    draft.financeiro = { canView: true, canExecute: false, canManage: false };
    assert.equal(isPermissionDraftDirty(draft, defaults, []), true);
    const payload = overridesPayloadFromDraft(draft, defaults);
    assert.ok(payload.some((p) => p.resourceKey === "financeiro" && p.canView === true));
  });

  it("setModuleFlags marca módulo e filhos", () => {
    const draft = draftFromPayloadTree(sampleTree);
    const next = setModuleFlags(draft, sampleTree, "financeiro", {
      canView: true,
      canExecute: true,
      canManage: false,
    });
    assert.equal(next.financeiro?.canView, true);
    assert.equal(next["financeiro.conciliacao_carteira"]?.canExecute, true);
  });

  it("rótulos amigáveis de tipo e flags", () => {
    assert.equal(permissionResourceTypeLabel("TAB"), "Aba");
    assert.equal(
      formatPermissionFlagsHuman({ canView: true, canExecute: false, canManage: true }),
      "Ver · Gerenciar"
    );
  });
});
