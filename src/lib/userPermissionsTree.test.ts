import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EditableTreeNodeDto } from "@/src/lib/userPermissionsAdminClient";
import {
  buildUserPermissionTreeModel,
  decisionsFromUserDraft,
  detectAccessProfileSnapshotDrift,
  draftFromUserDecisions,
  userExceptionHighlight,
  userPermissionActionNodeId,
} from "@/src/lib/userPermissionsTree";

const sampleTree: EditableTreeNodeDto[] = [
  {
    key: "dashboard",
    label: "Dashboard",
    description: "",
    type: "MENU",
    module: "dashboard",
    parentKey: null,
    roleFlags: { canView: true, canExecute: false, canManage: false },
    override: { canView: false, canExecute: null, canManage: null },
    effectiveFlags: { canView: false, canExecute: false, canManage: false },
    children: [
      {
        key: "crm",
        label: "CRM",
        description: "",
        type: "SUBMENU",
        module: "crm",
        parentKey: "dashboard",
        roleFlags: { canView: false, canExecute: false, canManage: false },
        override: { canView: true, canExecute: null, canManage: null },
        effectiveFlags: { canView: true, canExecute: false, canManage: false },
        children: [],
      },
    ],
  },
];

describe("userPermissionsTree (PERM-35)", () => {
  it("monta árvore com valor do perfil e exceções DENY/ALLOW", () => {
    const model = buildUserPermissionTreeModel(sampleTree);
    assert.ok(model.nodes.length > 0);
    assert.equal(model.nodes[0]?.kind, "module");
    assert.ok(model.nodes[0]?.originLabel.includes("perfil"));
    assert.equal(model.decisions.dashboard, "deny");
    assert.equal(model.decisions.crm, "allow");
  });

  it("round-trip decisões ↔ draft preserva exceções", () => {
    const model = buildUserPermissionTreeModel(sampleTree);
    const rematerialized = draftFromUserDecisions(
      model.nodes,
      model.decisions,
      model.baseline,
      model.draft
    );
    const again = decisionsFromUserDraft(
      model.nodes,
      rematerialized,
      model.baseline
    );
    assert.equal(again.dashboard, "deny");
    assert.equal(again.crm, "allow");
    void userPermissionActionNodeId;
  });

  it("highlight DENY/ALLOW sobrepõe e herdando", () => {
    assert.equal(
      userExceptionHighlight("deny", "allowed"),
      "deny-over-profile"
    );
    assert.equal(
      userExceptionHighlight("allow", "denied"),
      "allow-over-profile"
    );
    assert.equal(userExceptionHighlight("inherit", "allowed"), "inheriting");
  });

  it("detecta drift de snapshot do perfil", () => {
    assert.equal(
      detectAccessProfileSnapshotDrift({
        hasAccessProfile: true,
        hasCustomPermissions: false,
        userPermissions: ["dashboard.view"],
        profilePermissions: ["dashboard.view", "crm.view"],
      }),
      true
    );
    assert.equal(
      detectAccessProfileSnapshotDrift({
        hasAccessProfile: true,
        hasCustomPermissions: true,
        userPermissions: ["dashboard.view"],
        profilePermissions: ["crm.view"],
      }),
      false
    );
  });
});
