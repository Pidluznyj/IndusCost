import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatStockConferenceQuantity,
  MATERIAL_STOCK_CONFERENCE_UI_FORBIDDEN_COST_KEYS,
  resolveMaterialStockConferenceLayout,
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

  it("lista chaves de custo proibidas na UI", () => {
    assert.ok(MATERIAL_STOCK_CONFERENCE_UI_FORBIDDEN_COST_KEYS.includes("currentCost"));
    assert.ok(MATERIAL_STOCK_CONFERENCE_UI_FORBIDDEN_COST_KEYS.includes("landedCost"));
  });
});
