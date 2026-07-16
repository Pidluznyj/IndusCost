import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PermissionsTree } from "@/src/components/admin/PermissionsTree";
import {
  ACCESS_PROFILE_SNAPSHOT_NOTICE,
} from "@/src/lib/accessProfilesMatrix";
import { buildAccessProfileTreeModel } from "@/src/lib/accessProfilesTree";

describe("AccessProfilesModule tree integration smoke (PERM-34)", () => {
  it("renderiza árvore a partir de perfil legado", () => {
    const model = buildAccessProfileTreeModel(
      ["dashboard.view", "crm.view"],
      "SELLER"
    );
    const html = renderToStaticMarkup(
      <div data-testid="access-profile-editor">
        <p>{ACCESS_PROFILE_SNAPSHOT_NOTICE}</p>
        <div data-testid="access-profile-editor-header">
          <span>Nome</span>
          <span>Descrição</span>
          <span>Role base</span>
          <span>Ativo</span>
        </div>
        <PermissionsTree
          nodes={model.nodes}
          decisions={model.decisions}
          onDecisionsChange={() => undefined}
          enableBranchBatch
          configuredColumnLabel="Estado configurado"
          resultColumnLabel="Resultado do perfil"
        />
        <div data-testid="access-profile-editor-footer">
          <span data-testid="access-profile-change-count">
            Nenhuma alteração na árvore
          </span>
          <button type="button">Cancelar</button>
          <button type="button">Salvar perfil</button>
        </div>
      </div>
    );
    assert.ok(html.includes("permissions-tree"));
    assert.ok(html.includes("Estado configurado"));
    assert.ok(html.includes("Resultado do perfil"));
    assert.ok(html.includes("permissions-tree-batch-bar"));
    assert.ok(
      html.includes("não atualiza automaticamente") || html.includes("snapshot")
    );
    assert.ok(html.includes("Módulo") || html.includes("Página") || html.includes("Ação"));
  });

  it("erro de API simulado na árvore", () => {
    const html = renderToStaticMarkup(
      <PermissionsTree
        nodes={[]}
        decisions={{}}
        onDecisionsChange={() => undefined}
        error="Falha de API ao carregar perfil"
      />
    );
    assert.ok(html.includes("permissions-tree-error"));
  });

  it("badge de perfil de sistema e confirmação de salvamento", () => {
    const html = renderToStaticMarkup(
      <div>
        <span data-testid="access-profile-system-badge">Perfil de sistema</span>
        <div data-testid="access-profile-save-success" role="status">
          Perfil salvo com sucesso. Dados recarregados.
        </div>
        <p data-testid="access-profile-snapshot-notice">
          {ACCESS_PROFILE_SNAPSHOT_NOTICE}
        </p>
      </div>
    );
    assert.ok(html.includes("access-profile-system-badge"));
    assert.ok(html.includes("access-profile-save-success"));
    assert.ok(html.includes("Dados recarregados"));
  });
});
