import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { MaterialStockTabletListItem } from "@/src/lib/materialStockTabletTypes.js";
import { MaterialStockParametersDialog } from "./MaterialStockParametersDialog.js";

function item(): MaterialStockTabletListItem {
  return {
    id: "mat-1",
    code: "MP-1",
    description: "Aço",
    unit: "kg",
    currentQuantity: 500,
    contingencyQuantity: 10,
    minimumQuantity: 20,
    recommendedQuantity: 50,
    stockStatus: "SAUDAVEL",
    lastStockConferenceAt: null,
    lastStockConferenceUser: null,
    stockConferenceVersion: 1,
    updatedAt: null,
  };
}

describe("MaterialStockParametersDialog", () => {
  it("explica que parâmetros não somam ao estoque e usa unidade", () => {
    const html = renderToStaticMarkup(
      <MaterialStockParametersDialog
        item={item()}
        open
        onClose={() => {}}
        onSuccess={() => {}}
      />
    );
    assert.match(html, /stock-parameters-dialog/);
    assert.match(html, /não são somados/);
    assert.match(html, /não altera o\s+saldo nem os custos/);
    assert.match(html, /stock-parameters-contingency/);
    assert.match(html, /inputMode="decimal"/);
    assert.match(html, />kg</);
    assert.doesNotMatch(html, /currentCost|freight|standardLoss/i);
  });

  it("não renderiza fechado", () => {
    const html = renderToStaticMarkup(
      <MaterialStockParametersDialog
        item={item()}
        open={false}
        onClose={() => {}}
        onSuccess={() => {}}
      />
    );
    assert.equal(html, "");
  });
});
