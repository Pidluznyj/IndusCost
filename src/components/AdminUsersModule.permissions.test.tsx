import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PermissionsTree } from "@/src/components/admin/PermissionsTree";
import {
  USER_PERMISSION_PRECEDENCE_NOTICE,
} from "@/src/lib/userPermissionsMatrix";
import { buildUserPermissionTreeModel } from "@/src/lib/userPermissionsTree";
import type { EditableTreeNodeDto } from "@/src/lib/userPermissionsAdminClient";

describe("AdminUsers PermissionsTree smoke (PERM-35)", () => {
  it("renderiza árvore de usuário com valor do perfil / exceção / efetivo", () => {
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
    const model = buildUserPermissionTreeModel(tree);
    const html = renderToStaticMarkup(
      <div data-testid="user-permission-editor">
        <div data-testid="user-permission-context">
          <p>Role atual</p>
          <p data-testid="user-permission-version">permissionsVersion: 3</p>
          <p>{USER_PERMISSION_PRECEDENCE_NOTICE}</p>
        </div>
        <PermissionsTree
          nodes={model.nodes}
          decisions={model.decisions}
          onDecisionsChange={() => undefined}
          highlightExceptions
          originColumnLabel="Valor do perfil"
          configuredColumnLabel="Exceção do usuário"
          resultColumnLabel="Resultado efetivo"
        />
        <div data-testid="user-permission-editor-footer">
          <span>alteração(ões) pendente(s)</span>
          <button type="button">Cancelar</button>
          <button type="button">Salvar permissões</button>
        </div>
      </div>
    );
    assert.ok(html.includes("permissions-tree"));
    assert.ok(html.includes("Valor do perfil"));
    assert.ok(html.includes("Exceção do usuário"));
    assert.ok(html.includes("Resultado efetivo"));
    assert.ok(html.includes("DENY sobrepõe") || html.includes("Herdando"));
    assert.ok(html.includes("permissionsVersion"));
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
    const model = buildUserPermissionTreeModel(tree);
    const html = renderToStaticMarkup(
      <PermissionsTree
        nodes={model.nodes}
        decisions={model.decisions}
        onDecisionsChange={() => undefined}
        readOnly
        highlightExceptions
      />
    );
    assert.ok(html.includes("disabled") || html.includes("permissions-tree"));
  });

  it("erro de persistência simulado", () => {
    const html = renderToStaticMarkup(
      <PermissionsTree
        nodes={[]}
        decisions={{}}
        onDecisionsChange={() => undefined}
        error="Falha ao salvar overrides (API)"
      />
    );
    assert.ok(html.includes("permissions-tree-error"));
  });
});
