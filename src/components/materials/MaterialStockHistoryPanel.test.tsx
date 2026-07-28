import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { MaterialStockTabletListItem } from "@/src/lib/materialStockTabletTypes.js";
import { MaterialStockHistoryPanel } from "./MaterialStockHistoryPanel.js";

function item(): MaterialStockTabletListItem {
  return {
    id: "mat-1",
    code: "MP-1",
    description: "Aço",
    unit: "kg",
    currentQuantity: 500,
    contingencyQuantity: null,
    minimumQuantity: null,
    recommendedQuantity: null,
    stockStatus: "NAO_CONFIGURADO",
    lastStockConferenceAt: null,
    lastStockConferenceUser: null,
    stockConferenceVersion: 1,
    updatedAt: null,
  };
}

describe("MaterialStockHistoryPanel", () => {
  it("renderiza painel simples de histórico", () => {
    const html = renderToStaticMarkup(
      <MaterialStockHistoryPanel item={item()} open onClose={() => {}} />
    );
    assert.match(html, /stock-history-panel/);
    assert.match(html, /Histórico de conferência/);
    assert.match(html, /stock-history-loading|Carregando histórico/);
    assert.doesNotMatch(html, /currentCost|WMS|landedCost/i);
  });

  it("não renderiza fechado", () => {
    const html = renderToStaticMarkup(
      <MaterialStockHistoryPanel item={item()} open={false} onClose={() => {}} />
    );
    assert.equal(html, "");
  });
});
