import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { civilDateToLocalDate } from "./financeCivilDate.js";
import {
  buildMaterialCostDraftItemFromMaterial,
  computeMaterialLandedCost,
  isValidMaterialLandedCostForDraft,
  materialCostTableCodeFromEffectiveDateKey,
} from "./materialCostPublication.js";

describe("materialCostPublication", () => {
  it("materialCostTableCodeFromEffectiveDateKey retorna YYYY-MM", () => {
    assert.equal(
      materialCostTableCodeFromEffectiveDateKey(civilDateToLocalDate("2026-07-01")),
      "2026-07"
    );
  });

  it("computeMaterialLandedCost soma currentCost + freight", () => {
    assert.equal(computeMaterialLandedCost({ currentCost: 16, freight: 0.5 }), 16.5);
  });

  it("isValidMaterialLandedCostForDraft rejeita zero e negativo", () => {
    assert.equal(isValidMaterialLandedCostForDraft(0), false);
    assert.equal(isValidMaterialLandedCostForDraft(-1), false);
    assert.equal(isValidMaterialLandedCostForDraft(11.5), true);
  });

  it("buildMaterialCostDraftItemFromMaterial inclui snapshot e hash", () => {
    const item = buildMaterialCostDraftItemFromMaterial(
      {
        id: "mp-1",
        code: "PP H503",
        description: "Polipropileno H503",
        unit: "kg",
        currentCost: 11,
        freight: 0.5,
        averageCost: 10.5,
        standardCost: 11,
        standardLoss: 2,
        status: "ACTIVE",
      },
      new Date("2026-07-01T12:00:00.000Z")
    );
    assert.equal(item.landedCostSnapshot, 11.5);
    assert.equal(item.materialCodeSnapshot, "PP H503");
    assert.ok(item.calculationHash);
    assert.ok(item.calculationSnapshot);
    const snapshot = item.calculationSnapshot as { snapshotKind: string; landedCost: number };
    assert.equal(snapshot.snapshotKind, "FROZEN_AT_GENERATION");
    assert.equal(snapshot.landedCost, 11.5);
  });

  it("material sem custo gera landed zero — inválido para draft", () => {
    const item = buildMaterialCostDraftItemFromMaterial({
      id: "mp-zero",
      code: "SEM-CUSTO",
      description: "Sem custo",
      unit: "kg",
      currentCost: 0,
      freight: 0,
    });
    assert.equal(isValidMaterialLandedCostForDraft(item.landedCostSnapshot), false);
  });
});
