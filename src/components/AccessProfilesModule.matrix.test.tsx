import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PermissionMatrix } from "@/src/components/admin/PermissionMatrix";
import {
  ACCESS_PROFILE_SNAPSHOT_NOTICE,
  buildAccessProfileMatrixModel,
} from "@/src/lib/accessProfilesMatrix";

describe("AccessProfilesModule matrix integration smoke", () => {
  it("renderiza matriz a partir de perfil legado", () => {
    const model = buildAccessProfileMatrixModel(
      ["dashboard.view", "crm.view"],
      "SELLER"
    );
    const html = renderToStaticMarkup(
      <div>
        <p>{ACCESS_PROFILE_SNAPSHOT_NOTICE}</p>
        <PermissionMatrix
          rows={model.rows}
          draft={model.draft}
          baseline={model.baseline}
          onDraftChange={() => undefined}
        />
      </div>
    );
    assert.ok(html.includes("permission-matrix"));
    assert.ok(html.includes("não atualiza automaticamente") || html.includes("snapshot"));
    assert.ok(html.includes("—"));
  });

  it("erro de API simulado na matriz", () => {
    const html = renderToStaticMarkup(
      <PermissionMatrix
        rows={[]}
        draft={{}}
        baseline={{}}
        onDraftChange={() => undefined}
        error="Falha de API ao carregar perfil"
      />
    );
    assert.ok(html.includes("permission-matrix-error"));
  });
});
