import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { MaterialStockTabletListItem } from "@/src/lib/materialStockTabletTypes.js";
import { MaterialStockConferenceDialog } from "./MaterialStockConferenceDialog.js";

const root = process.cwd();

function sampleItem(): MaterialStockTabletListItem {
  return {
    id: "mat-1",
    code: "MP-100",
    description: "Aço",
    unit: "kg",
    currentQuantity: 500,
    contingencyQuantity: 50,
    minimumQuantity: 100,
    recommendedQuantity: 200,
    stockStatus: "SAUDAVEL",
    lastStockConferenceAt: null,
    lastStockConferenceUser: null,
    stockConferenceVersion: 3,
    updatedAt: "2026-07-28T10:00:00.000Z",
  };
}

describe("MaterialStockConferenceDialog", () => {
  it("renderiza formulário com teclado numérico, unidade, salvar e cancelar", () => {
    const html = renderToStaticMarkup(
      <MaterialStockConferenceDialog
        item={sampleItem()}
        open
        onClose={() => {}}
        onSuccess={() => {}}
        onReloadRequired={() => {}}
      />
    );
    assert.match(html, /stock-conference-dialog/);
    assert.match(html, /inputMode="decimal"/);
    assert.match(html, /stock-conference-contingency-input/);
    assert.match(html, /stock-conference-recommended-input/);
    assert.match(html, /stock-conference-reported-input/);
    assert.match(html, /Estoque contingência\*/);
    assert.match(html, /Estoque recomendado/);
    assert.match(html, /Saldo contado\*/);
    assert.match(html, /stock-conference-system-balance/);
    assert.match(html, /Saldo atual/);
    assert.match(html, /stock-conference-unit/);
    assert.match(html, />kg</);
    assert.match(html, /Salvar conferência/);
    assert.match(html, /Cancelar/);
    assert.match(html, /Saldo atual \(sistema\)/);
    assert.match(html, /Conferência física/);
    assert.match(html, /só muda após a confirmação do servidor/);
    assert.doesNotMatch(html, /currentCost|freight|standardLoss|conversionFactor|landedCost/i);
  });

  it("não renderiza quando fechado", () => {
    const html = renderToStaticMarkup(
      <MaterialStockConferenceDialog
        item={sampleItem()}
        open={false}
        onClose={() => {}}
        onSuccess={() => {}}
        onReloadRequired={() => {}}
      />
    );
    assert.equal(html, "");
  });

  it("página abre diálogo e aplica sucesso na lista", () => {
    const page = readFileSync(
      join(root, "src/components/materials/MaterialStockConferencePage.tsx"),
      "utf8"
    );
    const dialog = readFileSync(
      join(root, "src/components/materials/MaterialStockConferenceDialog.tsx"),
      "utf8"
    );
    assert.match(page, /MaterialStockConferenceDialog/);
    assert.match(page, /applyConferenceSuccessToListItem/);
    assert.match(page, /setConferenceOpen\(true\)/);
    assert.match(dialog, /inFlightRef/);
    assert.match(dialog, /Idempotency|idempotencyKey/);
    assert.match(dialog, /stock-conference-conflict/);
    assert.match(dialog, /disabled=\{saving\}/);
    assert.doesNotMatch(dialog, /currentCost|freight|standardLoss/);
  });
});
