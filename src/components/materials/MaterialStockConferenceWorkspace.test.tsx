import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { MaterialStockTabletListItem } from "@/src/lib/materialStockTabletTypes.js";
import {
  MATERIAL_STOCK_CONFERENCE_EMPTY_MESSAGE,
  MATERIAL_STOCK_CONFERENCE_SELECT_HINT,
} from "@/src/lib/materialStockConferenceUi.js";
import { MaterialStockConferenceWorkspace } from "./MaterialStockConferenceWorkspace.js";

const root = process.cwd();

function sampleRow(overrides: Partial<MaterialStockTabletListItem> = {}): MaterialStockTabletListItem {
  return {
    id: "mat-1",
    code: "MP-100",
    description: "Aço carbono",
    unit: "kg",
    currentQuantity: 500,
    contingencyQuantity: 50,
    minimumQuantity: 100,
    recommendedQuantity: 200,
    stockStatus: "SAUDAVEL",
    lastStockConferenceAt: "2026-07-20T12:00:00.000Z",
    lastStockConferenceUser: { id: "u1", name: "Operador" },
    stockConferenceVersion: 3,
    updatedAt: "2026-07-20T12:00:00.000Z",
    ...overrides,
  };
}

const base = {
  search: "",
  onSearchChange: () => {},
  rows: [] as MaterialStockTabletListItem[],
  selectedId: null as string | null,
  onSelect: () => {},
  onClearSelection: () => {},
  error: null as string | null,
  onRetry: () => {},
  canViewHistory: true,
  canConference: true,
  onConference: () => {},
  onHistory: () => {},
};

describe("MaterialStockConferenceWorkspace", () => {
  it("renderiza loading, vazio e erro com nova tentativa", () => {
    const loading = renderToStaticMarkup(
      <MaterialStockConferenceWorkspace
        {...base}
        viewKind="loading"
        layoutMode="split"
      />
    );
    assert.match(loading, /stock-conference-loading/);
    assert.match(loading, /Carregando matérias-primas/);

    const empty = renderToStaticMarkup(
      <MaterialStockConferenceWorkspace
        {...base}
        viewKind="empty"
        layoutMode="split"
      />
    );
    assert.match(empty, /stock-conference-empty/);
    assert.ok(empty.includes(MATERIAL_STOCK_CONFERENCE_EMPTY_MESSAGE));

    const error = renderToStaticMarkup(
      <MaterialStockConferenceWorkspace
        {...base}
        viewKind="error"
        layoutMode="split"
        error="Falha de rede"
      />
    );
    assert.match(error, /stock-conference-error/);
    assert.match(error, /Falha de rede/);
    assert.match(error, /Tentar novamente/);
  });

  it("layout horizontal: lista + detalhe; seleção destacada", () => {
    const row = sampleRow();
    const html = renderToStaticMarkup(
      <MaterialStockConferenceWorkspace
        {...base}
        viewKind="ready"
        layoutMode="split"
        rows={[row]}
        selectedId={row.id}
      />
    );
    assert.match(html, /data-layout="split"/);
    assert.match(html, /stock-conference-list-panel/);
    assert.match(html, /stock-conference-detail/);
    assert.match(html, /MP-100/);
    assert.match(html, /Estoque atual/);
    assert.match(html, /Disponível acima da contingência/);
    assert.match(html, /Sugestão de reposição/);
    assert.match(html, /Conferir e atualizar estoque/);
    assert.match(html, /Histórico/);
    assert.doesNotMatch(html, /currentCost|landedCost|custo unit/i);
  });

  it("layout vertical: detalhe tela cheia com voltar; sem duas colunas estreitas", () => {
    const row = sampleRow();
    const html = renderToStaticMarkup(
      <MaterialStockConferenceWorkspace
        {...base}
        viewKind="ready"
        layoutMode="stacked"
        rows={[row]}
        selectedId={row.id}
      />
    );
    assert.match(html, /data-layout="stacked"/);
    assert.match(html, /stock-conference-back/);
    assert.match(html, /Voltar/);
    assert.match(html, /stock-conference-detail/);
  });

  it("sem seleção no split mostra dica; histórico oculto sem permissão", () => {
    const html = renderToStaticMarkup(
      <MaterialStockConferenceWorkspace
        {...base}
        viewKind="ready"
        layoutMode="split"
        rows={[sampleRow()]}
        selectedId={null}
        canViewHistory={false}
      />
    );
    assert.ok(html.includes(MATERIAL_STOCK_CONFERENCE_SELECT_HINT));
    assert.doesNotMatch(html, /stock-conference-history/);
  });

  it("página e módulo usam deep link e permissão view", () => {
    const page = readFileSync(
      join(root, "src/components/materials/MaterialStockConferencePage.tsx"),
      "utf8"
    );
    const workspace = readFileSync(
      join(root, "src/components/materials/MaterialStockConferenceWorkspace.tsx"),
      "utf8"
    );
    const module = readFileSync(join(root, "src/components/MaterialsModule.tsx"), "utf8");
    const nav = readFileSync(join(root, "src/lib/materialsNavigation.ts"), "utf8");
    assert.match(page, /stock-conference-page/);
    assert.match(page, /MATERIAL_STOCK_TABLET_SEARCH_PATH/);
    assert.match(page, /canViewTabResource/);
    assert.doesNotMatch(page, /currentCost|landedCost/);
    assert.match(workspace, /inputMode="search"/);
    assert.match(workspace, /min-h-12/);
    assert.match(module, /stock-conference\/:materialId/);
    assert.match(module, /MaterialStockConferencePage/);
    assert.match(module, /canStockConference/);
    assert.match(nav, /stock-conference/);
    assert.match(nav, /stockConference/);
  });
});
