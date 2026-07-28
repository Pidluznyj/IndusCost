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
    description: "Aço carbono laminado a frio para estrutura industrial",
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
  filter: "ALL" as const,
  onFilterChange: () => {},
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

    const empty = renderToStaticMarkup(
      <MaterialStockConferenceWorkspace
        {...base}
        viewKind="empty"
        layoutMode="split"
      />
    );
    assert.ok(empty.includes(MATERIAL_STOCK_CONFERENCE_EMPTY_MESSAGE));

    const error = renderToStaticMarkup(
      <MaterialStockConferenceWorkspace
        {...base}
        viewKind="error"
        layoutMode="split"
        error="Falha de rede"
      />
    );
    assert.match(error, /Falha de rede/);
    assert.match(error, /Tentar novamente/);
  });

  it("lista com filtros, badge textual, estoque+unidade e mais resultados", () => {
    const html = renderToStaticMarkup(
      <MaterialStockConferenceWorkspace
        {...base}
        viewKind="ready"
        layoutMode="split"
        rows={[sampleRow()]}
        selectedId="mat-1"
        hasMore
        totalCount={90}
      />
    );
    assert.match(html, /stock-conference-filters/);
    assert.match(html, /stock-conference-filter-CRITICO/);
    assert.match(html, /Saudável/);
    assert.match(html, /500 kg|500/);
    assert.match(html, /kg/);
    assert.match(html, /há mais resultados/);
    assert.match(html, /stock-conference-load-more/);
    assert.doesNotMatch(html, /currentCost|landedCost|custo unit/i);
  });

  it("layout vertical: detalhe tela cheia com voltar", () => {
    const html = renderToStaticMarkup(
      <MaterialStockConferenceWorkspace
        {...base}
        viewKind="ready"
        layoutMode="stacked"
        rows={[sampleRow()]}
        selectedId="mat-1"
      />
    );
    assert.match(html, /data-layout="stacked"/);
    assert.match(html, /stock-conference-back/);
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

  it("página conecta busca com AbortController, debounce e filtros", () => {
    const page = readFileSync(
      join(root, "src/components/materials/MaterialStockConferencePage.tsx"),
      "utf8"
    );
    assert.match(page, /AbortController/);
    assert.match(page, /fetchMaterialStockTabletSearch/);
    assert.match(page, /MATERIAL_STOCK_LIST_SEARCH_DEBOUNCE_MS/);
    assert.match(page, /isMaterialStockSearchAbortError/);
    assert.match(page, /requestGenRef/);
    assert.match(page, /shouldAutoSelectFirstStockItem/);
    assert.match(page, /appendStockTabletSearchPages/);
    assert.doesNotMatch(page, /currentCost|landedCost/);
  });
});
