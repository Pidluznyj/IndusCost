import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PermissionsTree } from "./PermissionsTree";
import {
  PermissionsTreeFixtureExample,
  PermissionsTreeStatesExample,
  PermissionsTreeViewportGallery,
} from "./PermissionsTree.examples";
import {
  buildPermissionsTreeFixture,
  buildPermissionsTreeFixtureDecisions,
} from "@/src/lib/security/permissionsTreeUi/index.ts";

describe("PermissionsTree component", () => {
  it("loading", () => {
    const html = renderToStaticMarkup(
      <PermissionsTreeStatesExample mode="loading" />
    );
    assert.ok(html.includes("permissions-tree-loading"));
    assert.ok(html.includes("Carregando"));
  });

  it("erro", () => {
    const html = renderToStaticMarkup(
      <PermissionsTreeStatesExample mode="error" />
    );
    assert.ok(html.includes("permissions-tree-error"));
    assert.ok(html.includes("500") || html.includes("Falha"));
  });

  it("fixture renderiza colunas, counters e segmented", () => {
    const html = renderToStaticMarkup(<PermissionsTreeFixtureExample />);
    assert.ok(html.includes("permissions-tree"));
    assert.ok(html.includes("permissions-tree-header"));
    assert.ok(html.includes("permissions-tree-search"));
    assert.ok(html.includes("permissions-tree-expand-all"));
    assert.ok(html.includes("permissions-tree-collapse-all"));
    assert.ok(html.includes("permissions-tree-counters"));
    assert.ok(html.includes("Recurso"));
    assert.ok(html.includes("Origem/perfil"));
    assert.ok(html.includes("Decisão individual"));
    assert.ok(html.includes("Resultado efetivo"));
    assert.ok(html.includes("Herdar"));
    assert.ok(html.includes("Permitir"));
    assert.ok(html.includes("Negar"));
    assert.ok(html.includes("Engenharia") || html.includes("Produtos"));
  });

  it("ações aparecem como linhas (não só metadados técnicos)", () => {
    const nodes = buildPermissionsTreeFixture();
    const decisions = buildPermissionsTreeFixtureDecisions();
    const html = renderToStaticMarkup(
      <PermissionsTree
        nodes={nodes}
        decisions={decisions}
        onDecisionsChange={() => undefined}
      />
    );
    assert.ok(html.includes("Criar cliente") || html.includes("Visualizar"));
    assert.ok(!html.includes("canonical_from_contract"));
    assert.ok(!html.includes("Pai bloqueado"));
  });

  it("viewport presets 1366 e 1920", () => {
    const html1366 = renderToStaticMarkup(
      <PermissionsTreeFixtureExample viewportPreset="1366" />
    );
    const html1920 = renderToStaticMarkup(
      <PermissionsTreeFixtureExample viewportPreset="1920" />
    );
    assert.ok(html1366.includes('data-viewport="1366"'));
    assert.ok(html1366.includes("w-[1366px]") || html1366.includes("1366"));
    assert.ok(html1920.includes('data-viewport="1920"'));
    assert.ok(html1920.includes("w-[1920px]") || html1920.includes("1920"));

    const gallery = renderToStaticMarkup(<PermissionsTreeViewportGallery />);
    assert.ok(gallery.includes("permissions-tree-viewport-1366"));
    assert.ok(gallery.includes("permissions-tree-viewport-1920"));
    assert.ok(gallery.includes("1366×768"));
    assert.ok(gallery.includes("1920×1080"));
  });

  it("smoke render fixture completa < 3s", () => {
    const nodes = buildPermissionsTreeFixture();
    const decisions = buildPermissionsTreeFixtureDecisions();
    const started = Date.now();
    const html = renderToStaticMarkup(
      <PermissionsTree
        nodes={nodes}
        decisions={decisions}
        onDecisionsChange={() => undefined}
      />
    );
    const elapsed = Date.now() - started;
    assert.ok(html.includes("permissions-tree"));
    assert.ok(elapsed < 3000, `render too slow: ${elapsed}ms`);
  });

  it("barra de lote no ramo selecionável (PERM-34)", () => {
    const nodes = buildPermissionsTreeFixture();
    const decisions = buildPermissionsTreeFixtureDecisions();
    const html = renderToStaticMarkup(
      <PermissionsTree
        nodes={nodes}
        decisions={decisions}
        onDecisionsChange={() => undefined}
        enableBranchBatch
        configuredColumnLabel="Estado configurado"
        resultColumnLabel="Resultado do perfil"
      />
    );
    assert.ok(html.includes("permissions-tree-batch-bar"));
    assert.ok(html.includes("Estado configurado"));
    assert.ok(html.includes("Resultado do perfil"));
    assert.ok(html.includes("Selecionar") || html.includes("Lote"));
  });
});
