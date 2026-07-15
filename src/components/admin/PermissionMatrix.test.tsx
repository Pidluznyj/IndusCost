import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PermissionMatrix } from "./PermissionMatrix";
import { PermissionMatrixStatesExample } from "./PermissionMatrix.examples";
import {
  buildLargeSyntheticMatrixRows,
  type PermissionMatrixDraft,
} from "@/src/lib/security/permissionMatrixUi/index.ts";

function draftFromRows(
  rows: ReturnType<typeof buildLargeSyntheticMatrixRows>
): PermissionMatrixDraft {
  const draft: PermissionMatrixDraft = {};
  const walk = (list: typeof rows) => {
    for (const r of list) {
      draft[r.resourceKey] = { ...r.values };
      walk(r.children);
    }
  };
  walk(rows);
  return draft;
}

describe("PermissionMatrix component", () => {
  it("loading", () => {
    const html = renderToStaticMarkup(
      <PermissionMatrix
        rows={[]}
        draft={{}}
        baseline={{}}
        onDraftChange={() => undefined}
        loading
      />
    );
    assert.ok(html.includes("permission-matrix-loading"));
    assert.ok(html.includes("Carregando"));
  });

  it("erro de API", () => {
    const html = renderToStaticMarkup(
      <PermissionMatrixStatesExample mode="error" />
    );
    assert.ok(html.includes("permission-matrix-error"));
    assert.ok(html.includes("500") || html.includes("indisponível"));
  });

  it("ação não suportada renderiza —", () => {
    const rows = buildLargeSyntheticMatrixRows(1, 1);
    const draft = draftFromRows(rows);
    const html = renderToStaticMarkup(
      <PermissionMatrix
        rows={rows}
        draft={draft}
        baseline={draft}
        onDraftChange={() => undefined}
      />
    );
    assert.ok(html.includes("permission-matrix"));
    assert.ok(html.includes("—"));
    assert.ok(html.includes("Criar") || html.includes("Ver"));
  });

  it("parent bloqueado + inherited labels", () => {
    const rows = buildLargeSyntheticMatrixRows(1, 1);
    const baseline = draftFromRows(rows);
    const draft: PermissionMatrixDraft = {
      ...baseline,
      "mod.0": { ...baseline["mod.0"], view: false },
    };
    const html = renderToStaticMarkup(
      <PermissionMatrix
        rows={rows}
        draft={draft}
        baseline={baseline}
        onDraftChange={() => undefined}
      />
    );
    assert.ok(html.includes("permission-matrix-parent-blocked"));
    assert.ok(html.includes("Alterações não salvas") || html.includes("permission-matrix-dirty"));
    assert.ok(html.includes("Herdado") || html.includes("Negado") || html.includes("Concedido"));
  });

  it("árvore grande visível só com pais (performance smoke)", () => {
    const rows = buildLargeSyntheticMatrixRows(30, 20);
    const draft = draftFromRows(rows);
    const started = Date.now();
    const html = renderToStaticMarkup(
      <PermissionMatrix
        rows={rows}
        draft={draft}
        baseline={draft}
        onDraftChange={() => undefined}
      />
    );
    const elapsed = Date.now() - started;
    assert.ok(html.includes("permission-matrix"));
    assert.ok(html.includes("permission-matrix-search"));
    assert.ok(elapsed < 5000, `render too slow: ${elapsed}ms`);
  });

  it("reset control aparece", () => {
    const rows = buildLargeSyntheticMatrixRows(1, 0);
    const baseline = draftFromRows(rows);
    const draft = {
      ...baseline,
      "mod.0": { view: false, execute: false, manage: false },
    };
    const html = renderToStaticMarkup(
      <PermissionMatrix
        rows={rows}
        draft={draft}
        baseline={baseline}
        onDraftChange={() => undefined}
      />
    );
    assert.ok(html.includes("permission-matrix-reset"));
    assert.ok(html.includes("permission-matrix-impact"));
  });
});
