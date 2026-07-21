import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertCanDeactivateLocation,
  assertCanDeactivateWarehouse,
  assertLocationCodeNotDuplicate,
  assertNoLocationCycle,
  assertParentHierarchy,
  assertValidLocationCode,
  assertValidLocationName,
  formatLocationAddress,
  parseInventoryLocationType,
  wouldCreateLocationCycle,
} from "./inventoryLocationRules.js";
import { InventoryValidationError } from "./inventoryTypes.js";

describe("inventoryLocationRules", () => {
  it("valida código e nome", () => {
    assert.equal(assertValidLocationCode(" a1 "), "A1");
    assert.equal(assertValidLocationName("  Corredor  1 "), "Corredor 1");
    assert.throws(() => assertValidLocationCode(""), (e: unknown) => e instanceof InventoryValidationError);
    assert.throws(() => assertValidLocationName(""), (e: unknown) => e instanceof InventoryValidationError);
  });

  it("parseia tipos de local", () => {
    assert.equal(parseInventoryLocationType("quarantine"), "QUARANTINE");
    assert.throws(() => parseInventoryLocationType("X"), (e: unknown) => e instanceof InventoryValidationError);
  });

  it("impede código duplicado", () => {
    assert.throws(
      () => assertLocationCodeNotDuplicate("A-1", ["a-1"]),
      (e: unknown) =>
        e instanceof InventoryValidationError && e.code === "LOCATION_CODE_DUPLICATE"
    );
  });

  it("valida hierarquia pai/filho e ciclo", () => {
    assertParentHierarchy("loc-2", "wh-1", {
      id: "loc-1",
      warehouseId: "wh-1",
      parentLocationId: null,
      status: "ACTIVE",
      code: "C1",
      name: "Corredor",
    });
    assert.throws(
      () =>
        assertParentHierarchy("loc-1", "wh-1", {
          id: "loc-1",
          warehouseId: "wh-1",
          parentLocationId: null,
          status: "ACTIVE",
          code: "C1",
          name: "Corredor",
        }),
      (e: unknown) => e instanceof InventoryValidationError && e.code === "LOCATION_PARENT_SELF"
    );

    const nodes = new Map([
      [
        "a",
        {
          id: "a",
          warehouseId: "wh",
          parentLocationId: null as string | null,
          status: "ACTIVE" as const,
          code: "A",
          name: "A",
        },
      ],
      [
        "b",
        {
          id: "b",
          warehouseId: "wh",
          parentLocationId: "a",
          status: "ACTIVE" as const,
          code: "B",
          name: "B",
        },
      ],
    ]);
    assert.equal(wouldCreateLocationCycle("a", "b", nodes), true);
    assert.throws(
      () => assertNoLocationCycle("a", "b", nodes),
      (e: unknown) => e instanceof InventoryValidationError && e.code === "LOCATION_HIERARCHY_CYCLE"
    );
  });

  it("impede inativação indevida de local e almoxarifado", () => {
    assert.throws(
      () =>
        assertCanDeactivateLocation({
          hasPositiveBalance: true,
          hasActiveReservation: false,
          hasActiveBlock: false,
          hasActiveChildren: false,
          isReferencedByMovements: true,
        }),
      (e: unknown) => e instanceof InventoryValidationError && e.code === "LOCATION_HAS_BALANCE"
    );
    assert.throws(
      () =>
        assertCanDeactivateWarehouse({
          hasPositiveBalance: false,
          hasActiveReservation: false,
          hasOpenCountSession: true,
          hasActiveLocationsWithStock: false,
        }),
      (e: unknown) => e instanceof InventoryValidationError && e.code === "WAREHOUSE_HAS_OPEN_COUNT"
    );
    assert.doesNotThrow(() =>
      assertCanDeactivateLocation({
        hasPositiveBalance: false,
        hasActiveReservation: false,
        hasActiveBlock: false,
        hasActiveChildren: false,
        isReferencedByMovements: true,
      })
    );
  });

  it("formata endereço corredor/estante/posição", () => {
    assert.equal(formatLocationAddress({ aisle: "C1", shelf: "E2", position: "P3" }), "C1 / E2 / P3");
    assert.equal(formatLocationAddress({ aisle: null, shelf: "", position: null }), null);
  });
});
