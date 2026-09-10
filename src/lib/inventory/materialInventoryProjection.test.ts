import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { selectCanonicalPhysicalBalanceRows } from "./materialInventoryProjection.js";
import { classifyMaterialInventoryBalance, unitsCompatible } from "./materialInventoryBalanceDiagnostic.js";
import {
  resolveMaterialCreateQuantity,
  resolveMaterialUpdateQuantity,
  MATERIAL_QUANTITY_NOT_EDITABLE,
} from "../materialQuantityWriteGuard.js";
import { computeMaterialTotalValue } from "../materialQuantityTotal.js";

describe("selectCanonicalPhysicalBalanceRows", () => {
  it("não soma warehouse-level e location-level juntos", () => {
    const rows = [
      { locationId: null, physicalQuantity: 100 },
      { locationId: "loc-a", physicalQuantity: 40 },
    ];
    const warehouse = selectCanonicalPhysicalBalanceRows(rows, false);
    assert.equal(warehouse.length, 1);
    assert.equal(warehouse[0]?.physicalQuantity, 100);
    const located = selectCanonicalPhysicalBalanceRows(rows, true);
    assert.equal(located.length, 1);
    assert.equal(located[0]?.physicalQuantity, 40);
  });

  it("agrega vários warehouses quando não controla local", () => {
    const rows = [
      { locationId: null, physicalQuantity: 4000 },
      { locationId: null, physicalQuantity: 2525 },
    ];
    const selected = selectCanonicalPhysicalBalanceRows(rows, false);
    assert.equal(selected.length, 2);
  });
});

describe("classifyMaterialInventoryBalance", () => {
  it("MATCH vs QUANTITY_DIVERGENCE vs NO_INVENTORY_LINK", () => {
    assert.equal(
      classifyMaterialInventoryBalance({
        materialId: "m1",
        activeLinkCount: 1,
        hasBalanceRow: true,
        quantityEqualsCanonical: true,
      }),
      "MATCH"
    );
    assert.equal(
      classifyMaterialInventoryBalance({
        materialId: "m1",
        activeLinkCount: 1,
        hasBalanceRow: true,
        quantityEqualsCanonical: false,
      }),
      "QUANTITY_DIVERGENCE"
    );
    assert.equal(
      classifyMaterialInventoryBalance({
        materialId: "m1",
        activeLinkCount: 0,
        hasBalanceRow: false,
        quantityEqualsCanonical: false,
      }),
      "NO_INVENTORY_LINK"
    );
    assert.equal(
      classifyMaterialInventoryBalance({
        materialId: "m1",
        activeLinkCount: 2,
        hasBalanceRow: true,
        quantityEqualsCanonical: false,
      }),
      "MULTIPLE_ACTIVE_LINKS"
    );
    assert.equal(
      classifyMaterialInventoryBalance({
        materialId: "m1",
        activeLinkCount: 1,
        materialUnit: "KG",
        itemUnit: "UN",
        hasBalanceRow: true,
        quantityEqualsCanonical: true,
      }),
      "UNIT_MISMATCH"
    );
    assert.equal(
      classifyMaterialInventoryBalance({
        materialId: "m1",
        activeLinkCount: 1,
        hasBalanceRow: false,
        quantityEqualsCanonical: true,
      }),
      "NO_BALANCE"
    );
  });

  it("não vincula automaticamente com unidade incompatível", () => {
    assert.equal(unitsCompatible("KG", "UN"), false);
    assert.equal(unitsCompatible("kg", "KG"), true);
  });
});

describe("materialQuantityWriteGuard", () => {
  it("create rejeita quantidade não zero e aceita bootstrap 0", () => {
    assert.equal(resolveMaterialCreateQuantity(undefined).ok, true);
    assert.equal(resolveMaterialCreateQuantity(0).ok, true);
    const rejected = resolveMaterialCreateQuantity(1100);
    assert.equal(rejected.ok, false);
    if (rejected.ok === false) {
      assert.equal(rejected.error, MATERIAL_QUANTITY_NOT_EDITABLE);
    }
  });

  it("update rejeita quantidade diferente e ignora igual/omitida", () => {
    assert.equal(resolveMaterialUpdateQuantity(undefined, 6525).ok, true);
    assert.equal(resolveMaterialUpdateQuantity(6525, 6525).ok, true);
    assert.equal(resolveMaterialUpdateQuantity("6525.000000", 6525).ok, true);
    const rejected = resolveMaterialUpdateQuantity(1100, 6525);
    assert.equal(rejected.ok, false);
  });
});

describe("exemplo H503 — valor em estoque", () => {
  it("6525 × 10.50 = 68512.50 após projeção", () => {
    assert.equal(computeMaterialTotalValue(6525, 10.5), 68512.5);
    assert.equal(computeMaterialTotalValue(1100, 10.5), 11550);
  });
});
