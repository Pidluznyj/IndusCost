import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyParametersSuccessToListItem,
  assertParametersPayloadHasNoCostFields,
  buildParametersRequestBody,
  parseCurrentQuantityParameterInput,
  parseStockLevelParameterInput,
  toCurrentQuantityInputValue,
  validateStockParametersForm,
} from "./materialStockParametersClient.js";
import type { MaterialStockTabletListItem } from "./materialStockTabletTypes.js";
import { canEditMaterialStockParameters } from "./materialStockConferenceUi.js";

function item(overrides: Partial<MaterialStockTabletListItem> = {}): MaterialStockTabletListItem {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
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
    ...overrides,
  };
}

describe("materialStockParametersClient — null e validação", () => {
  it("aceita null/vazio e zero configurado", () => {
    assert.deepEqual(parseStockLevelParameterInput(""), { ok: true, value: null });
    assert.deepEqual(parseStockLevelParameterInput("null"), { ok: true, value: null });
    assert.deepEqual(parseStockLevelParameterInput("0"), { ok: true, value: 0 });
    assert.deepEqual(parseStockLevelParameterInput("10,5"), { ok: true, value: 10.5 });
    assert.equal(parseStockLevelParameterInput("abc").ok, false);
  });

  it("saldo atual é obrigatório e aceita zero", () => {
    assert.equal(parseCurrentQuantityParameterInput("").ok, false);
    assert.deepEqual(parseCurrentQuantityParameterInput("0"), { ok: true, value: 0 });
    assert.deepEqual(parseCurrentQuantityParameterInput("10,5"), { ok: true, value: 10.5 });
    assert.equal(toCurrentQuantityInputValue(0), "0");
    assert.equal(toCurrentQuantityInputValue(null), "0");
    assert.equal(toCurrentQuantityInputValue(500), "500");
  });

  it("valida hierarquia e permite todos nulos", () => {
    assert.equal(
      validateStockParametersForm({
        contingencyQuantity: null,
        minimumQuantity: null,
        recommendedQuantity: null,
      }).ok,
      true
    );
    assert.equal(
      validateStockParametersForm({
        contingencyQuantity: 10,
        minimumQuantity: 20,
        recommendedQuantity: 30,
      }).ok,
      true
    );
    assert.equal(
      validateStockParametersForm({
        contingencyQuantity: 30,
        minimumQuantity: 10,
        recommendedQuantity: 5,
      }).ok,
      false
    );
  });

  it("body de parâmetros inclui saldo e não inclui custos", () => {
    const body = buildParametersRequestBody({
      currentQuantity: 0,
      contingencyQuantity: 1,
      minimumQuantity: 2,
      recommendedQuantity: 3,
    });
    assert.deepEqual(assertParametersPayloadHasNoCostFields(body), []);
    assert.equal(body.currentQuantity, 0);
    assert.equal(body.contingencyQuantity, 1);
  });
});

describe("materialStockParametersClient — permissão e apply", () => {
  it("permissão de edição exige update / materials.edit", () => {
    assert.equal(
      canEditMaterialStockParameters({
        canPerformAction: () => false,
        effectivePermissions: [],
        role: "VIEWER",
      }),
      false
    );
    assert.equal(
      canEditMaterialStockParameters({
        canPerformAction: (k, a) => k === "engineering.materials" && a === "update",
        effectivePermissions: [],
        role: "USER",
      }),
      true
    );
    assert.equal(
      canEditMaterialStockParameters({
        canPerformAction: () => false,
        effectivePermissions: ["materials.edit"],
        role: "USER",
      }),
      true
    );
  });

  it("apply atualiza saldo e níveis/status sem custos", () => {
    const before = item({ currentQuantity: 500 });
    const after = applyParametersSuccessToListItem(before, {
      ok: true,
      material: {
        id: before.id,
        code: before.code,
        quantity: 480,
        contingencyQuantity: 10,
        minimumQuantity: 20,
        recommendedQuantity: 50,
        stockStatus: "SAUDAVEL",
        stockConferenceVersion: 1,
        updatedAt: "2026-07-28T12:00:00.000Z",
      },
      auditId: "a1",
    });
    assert.equal(after.currentQuantity, 480);
    assert.equal(after.contingencyQuantity, 10);
    assert.equal(after.minimumQuantity, 20);
    assert.equal(after.recommendedQuantity, 50);
    assert.equal(after.stockStatus, "SAUDAVEL");
    assert.ok(!("currentCost" in after));
    assert.ok(!("freight" in after));
  });
});
