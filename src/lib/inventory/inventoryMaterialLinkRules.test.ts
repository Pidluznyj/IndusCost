import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertDefaultLocationBelongsToWarehouse,
  assertNoActiveMaterialDuplicate,
  assertOfficialMaterialEligibleForStock,
  buildMaterialSnapshots,
} from "./inventoryMaterialLinkRules.js";
import { InventoryValidationError } from "./inventoryTypes.js";
import {
  parseLinkOfficialMaterialBody,
  parseUpdateMaterialStockLinkBody,
} from "./inventoryValidation.js";

describe("inventoryMaterialLinkRules", () => {
  it("exige MP oficial ativa e completa", () => {
    const ok = assertOfficialMaterialEligibleForStock({
      id: "m1",
      code: "MP-01",
      description: "Resina",
      unit: "KG",
      category: "POL",
      status: "ACTIVE",
    });
    assert.equal(ok.code, "MP-01");
    assert.throws(
      () =>
        assertOfficialMaterialEligibleForStock({
          id: "m2",
          code: "X",
          description: "Y",
          unit: "UN",
          category: null,
          status: "INACTIVE",
        }),
      (e: unknown) => e instanceof InventoryValidationError && e.code === "OFFICIAL_MATERIAL_INACTIVE"
    );
  });

  it("monta snapshots sem duplicar cadastro oficial", () => {
    const snap = buildMaterialSnapshots({
      id: "m1",
      code: " MP-01 ",
      description: " Resina ",
      unit: " KG ",
      category: "POL",
      status: "ACTIVE",
    });
    assert.equal(snap.materialId, "m1");
    assert.equal(snap.materialCodeSnapshot, "MP-01");
    assert.equal(snap.unit, "KG");
  });

  it("impede duplicidade ativa da mesma MP", () => {
    assert.throws(
      () => assertNoActiveMaterialDuplicate("item-1"),
      (e: unknown) =>
        e instanceof InventoryValidationError && e.code === "MATERIAL_ALREADY_LINKED_ACTIVE"
    );
    assert.doesNotThrow(() => assertNoActiveMaterialDuplicate(null));
  });

  it("valida local padrão no almoxarifado", () => {
    assert.throws(
      () => assertDefaultLocationBelongsToWarehouse("wh-b", "wh-a", true),
      (e: unknown) =>
        e instanceof InventoryValidationError && e.code === "DEFAULT_LOCATION_WAREHOUSE_MISMATCH"
    );
    assert.doesNotThrow(() =>
      assertDefaultLocationBelongsToWarehouse("wh-a", "wh-a", true)
    );
  });

  it("parse do vínculo e bloqueio de campos oficiais no update", () => {
    const body = parseLinkOfficialMaterialBody({
      materialId: "m1",
      controlsStock: true,
      safetyStock: 5,
      allowsReservation: false,
    });
    assert.equal(body.materialId, "m1");
    assert.equal(body.safetyStock, 5);
    assert.equal(body.allowsReservation, false);

    assert.throws(
      () => parseUpdateMaterialStockLinkBody({ code: "HACK", description: "x" }),
      (e: unknown) =>
        e instanceof InventoryValidationError && e.code === "OFFICIAL_MATERIAL_FIELDS_READONLY"
    );
  });
});
