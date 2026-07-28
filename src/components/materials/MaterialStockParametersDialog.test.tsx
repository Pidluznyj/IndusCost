import assert from "node:assert/strict";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { MaterialStockTabletListItem } from "@/src/lib/materialStockTabletTypes.js";
import { MaterialStockParametersDialog } from "./MaterialStockParametersDialog.js";

function item(overrides: Partial<MaterialStockTabletListItem> = {}): MaterialStockTabletListItem {
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
    ...overrides,
  };
}

describe("MaterialStockParametersDialog", () => {
  it("exige saldo atual preenchido e não altera custos", () => {
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
    assert.match(html, /não altera os custos/);
    assert.match(html, /stock-parameters-current-quantity/);
    assert.match(html, /Saldo atual/);
    assert.match(html, /value="500"/);
    assert.match(html, /stock-parameters-contingency/);
    assert.match(html, /inputMode="decimal"/);
    assert.match(html, />kg</);
    assert.doesNotMatch(html, /currentCost|freight|standardLoss/i);
    assert.doesNotMatch(html, /somente leitura/);
  });

  it("preenche saldo zerado com 0", () => {
    const html = renderToStaticMarkup(
      <MaterialStockParametersDialog
        item={item({ currentQuantity: 0 })}
        open
        onClose={() => {}}
        onSuccess={() => {}}
      />
    );
    assert.match(html, /stock-parameters-current-quantity[^>]*value="0"/);
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
