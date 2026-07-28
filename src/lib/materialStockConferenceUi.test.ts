import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canEditMaterialStockParameters,
  formatStockConferenceQuantity,
  MATERIAL_STOCK_CONFERENCE_UI_FORBIDDEN_COST_KEYS,
  MATERIAL_STOCK_STATUS_EXPLANATIONS,
  resolveMaterialStockConferenceLayout,
  resolveMaterialStockStatusVisual,
  stockConferenceStatusLabel,
} from "./materialStockConferenceUi.js";

describe("materialStockConferenceUi — layout", () => {
  it("desktop e tablet horizontal usam duas colunas", () => {
    assert.equal(
      resolveMaterialStockConferenceLayout({
        width: 1280,
        orientation: "landscape",
      }),
      "split"
    );
    assert.equal(
      resolveMaterialStockConferenceLayout({
        width: 1024,
        orientation: "landscape",
      }),
      "split"
    );
  });

  it("tablet vertical e mobile usam lista/detalhe empilhado", () => {
    assert.equal(
      resolveMaterialStockConferenceLayout({
        width: 768,
        orientation: "portrait",
      }),
      "stacked"
    );
    assert.equal(
      resolveMaterialStockConferenceLayout({
        width: 390,
        orientation: "portrait",
      }),
      "stacked"
    );
  });
});

describe("materialStockConferenceUi — formatação", () => {
  it("formata quantidade pt-BR e labels de status", () => {
    assert.equal(formatStockConferenceQuantity(1250.5), "1.250,5");
    assert.equal(formatStockConferenceQuantity(null), "—");
    assert.equal(stockConferenceStatusLabel("CRITICO"), "Crítico");
  });

  it("status tem texto, ícone e explicação", () => {
    const visual = resolveMaterialStockStatusVisual("EMERGENCIA");
    assert.equal(visual.label, "Emergência");
    assert.equal(visual.icon, "flame");
    assert.equal(visual.tone, "danger");
    assert.match(visual.explanation, /contingência/i);
    assert.ok(MATERIAL_STOCK_STATUS_EXPLANATIONS.SAUDAVEL.length > 0);
  });

  it("lista chaves de custo proibidas na UI", () => {
    assert.ok(MATERIAL_STOCK_CONFERENCE_UI_FORBIDDEN_COST_KEYS.includes("currentCost"));
    assert.ok(MATERIAL_STOCK_CONFERENCE_UI_FORBIDDEN_COST_KEYS.includes("landedCost"));
  });

  it("parâmetros somente leitura sem permissão específica", () => {
    assert.equal(
      canEditMaterialStockParameters({
        canPerformAction: () => false,
        effectivePermissions: ["materials.view"],
        role: "VIEWER",
      }),
      false
    );
  });
});
