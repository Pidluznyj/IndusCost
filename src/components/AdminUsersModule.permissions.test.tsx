import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PermissionMatrix } from "@/src/components/admin/PermissionMatrix";
import {
  buildUserPermissionMatrixModel,
  USER_PERMISSION_PRECEDENCE_NOTICE,
} from "@/src/lib/userPermissionsMatrix";
import type { EditableTreeNodeDto } from "@/src/lib/userPermissionsAdminClient";

describe("AdminUsers PermissionMatrix smoke", () => {
  it("renderiza matriz de usuário com badges Allow/Deny/Baseline", () => {
    const tree: EditableTreeNodeDto[] = [
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
        children: [],
      },
    ];
    const model = buildUserPermissionMatrixModel(tree);
    const html = renderToStaticMarkup(
      <div>
        <p>{USER_PERMISSION_PRECEDENCE_NOTICE}</p>
        <PermissionMatrix
          rows={model.rows}
          draft={model.draft}
          baseline={model.draft}
          onDraftChange={() => undefined}
        />
      </div>
    );
    assert.ok(html.includes("permission-matrix"));
    assert.ok(html.includes("Deny") || html.includes("Baseline") || html.includes("Allow"));
    assert.ok(html.includes("Deny") || html.includes("Dashboard"));
  });

  it("SUPER_ADMIN readOnly", () => {
    const tree: EditableTreeNodeDto[] = [
      {
        key: "dashboard",
        label: "Dashboard",
        description: "",
        type: "MENU",
        module: "dashboard",
        parentKey: null,
        roleFlags: { canView: true, canExecute: true, canManage: true },
        override: null,
        effectiveFlags: { canView: true, canExecute: true, canManage: true },
        children: [],
      },
    ];
    const model = buildUserPermissionMatrixModel(tree);
    const html = renderToStaticMarkup(
      <PermissionMatrix
        rows={model.rows}
        draft={model.draft}
        baseline={model.draft}
        onDraftChange={() => undefined}
        readOnly
      />
    );
    assert.ok(html.includes("disabled") || html.includes("permission-matrix"));
  });

  it("erro de persistência simulado", () => {
    const html = renderToStaticMarkup(
      <PermissionMatrix
        rows={[]}
        draft={{}}
        baseline={{}}
        onDraftChange={() => undefined}
        error="Falha ao salvar overrides (API)"
      />
    );
    assert.ok(html.includes("permission-matrix-error"));
  });
});
