import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertMaterializedMatchesLedger,
  assertOfficialUnitMatchesMaterial,
  assertStockSnapshotLineFormula,
  projectBalancesFromLedger,
  type InventoryLedgerMovementFact,
} from "./inventoryLedgerProjection.js";
import { InventoryValidationError, snapshotFromBalance } from "./inventoryTypes.js";

function fact(
  partial: Omit<InventoryLedgerMovementFact, "unit" | "movementDate"> & {
    unit?: string;
    movementDate?: string;
  }
): InventoryLedgerMovementFact {
  return {
    unit: "KG",
    movementDate: "2026-08-04T12:00:00.000Z",
    ...partial,
  };
}

describe("inventoryLedgerProjection invariants", () => {
  it("projeta saldo a partir do ledger (entrada → reserva → bloqueio)", () => {
    const projected = projectBalancesFromLedger([
      fact({
        id: "m1",
        movementType: "PURCHASE_ENTRY",
        quantity: 100,
        warehouseId: "wh-1",
      }),
      fact({
        id: "m2",
        movementType: "RESERVE",
        quantity: 20,
        warehouseId: "wh-1",
      }),
      fact({
        id: "m3",
        movementType: "BLOCK",
        quantity: 10,
        warehouseId: "wh-1",
      }),
    ]);

    const balance = projected.get("wh-1");
    assert.ok(balance);
    assert.equal(balance.physicalQuantity, 100);
    assert.equal(balance.reservedQuantity, 20);
    assert.equal(balance.blockedQuantity, 10);
    assert.equal(balance.availableQuantity, 70);
    assert.equal(balance.lastMovementId, "m3");
  });

  it("transferência move físico entre escopos sem editar saldo livremente", () => {
    const projected = projectBalancesFromLedger([
      fact({
        id: "m1",
        movementType: "MANUAL_ENTRY",
        quantity: 50,
        warehouseId: "wh-a",
      }),
      fact({
        id: "m2",
        movementType: "TRANSFER",
        quantity: 15,
        warehouseId: "wh-a",
        destinationWarehouseId: "wh-b",
      }),
    ]);

    assert.equal(projected.get("wh-a")?.physicalQuantity, 35);
    assert.equal(projected.get("wh-b")?.physicalQuantity, 15);
    assert.equal(projected.get("wh-a")?.availableQuantity, 35);
  });

  it("REVERSAL inverte impacto e impede duplo estorno", () => {
    const once = projectBalancesFromLedger([
      fact({
        id: "m1",
        movementType: "MANUAL_ENTRY",
        quantity: 40,
        warehouseId: "wh-1",
      }),
      fact({
        id: "m2",
        movementType: "REVERSAL",
        quantity: 40,
        warehouseId: "wh-1",
        reversedMovementId: "m1",
        originalMovementType: "MANUAL_ENTRY",
      }),
    ]);
    assert.equal(once.get("wh-1")?.physicalQuantity, 0);

    assert.throws(
      () =>
        projectBalancesFromLedger([
          fact({
            id: "m1",
            movementType: "MANUAL_ENTRY",
            quantity: 40,
            warehouseId: "wh-1",
          }),
          fact({
            id: "m2",
            movementType: "REVERSAL",
            quantity: 40,
            warehouseId: "wh-1",
            reversedMovementId: "m1",
            originalMovementType: "MANUAL_ENTRY",
          }),
          fact({
            id: "m3",
            movementType: "REVERSAL",
            quantity: 40,
            warehouseId: "wh-1",
            reversedMovementId: "m1",
            originalMovementType: "MANUAL_ENTRY",
          }),
        ]),
      (err: unknown) =>
        err instanceof InventoryValidationError && err.code === "DOUBLE_REVERSAL"
    );
  });

  it("saldo materializado deve bater com projeção do ledger", () => {
    const projected = projectBalancesFromLedger([
      fact({
        id: "m1",
        movementType: "MANUAL_ENTRY",
        quantity: 12,
        warehouseId: "wh-1",
        locationId: "loc-1",
      }),
      fact({
        id: "m2",
        movementType: "MANUAL_EXIT",
        quantity: 2,
        warehouseId: "wh-1",
        locationId: "loc-1",
      }),
    ]);
    const key = "wh-1:loc-1";
    const fromLedger = projected.get(key)!;
    const materialized = snapshotFromBalance(fromLedger);
    assertMaterializedMatchesLedger(materialized, fromLedger);

    assert.throws(
      () =>
        assertMaterializedMatchesLedger(
          snapshotFromBalance({ physicalQuantity: 99, availableQuantity: 99 }),
          fromLedger
        ),
      (err: unknown) =>
        err instanceof InventoryValidationError && err.code === "BALANCE_LEDGER_MISMATCH"
    );
  });

  it("unidade oficial do item deve espelhar Material.unit quando vinculado", () => {
    assert.doesNotThrow(() => assertOfficialUnitMatchesMaterial("KG", "KG"));
    assert.throws(
      () => assertOfficialUnitMatchesMaterial("KG", "UN"),
      (err: unknown) =>
        err instanceof InventoryValidationError && err.code === "OFFICIAL_UNIT_MISMATCH"
    );
  });

  it("linha de snapshot respeita fórmula de disponível", () => {
    assert.doesNotThrow(() =>
      assertStockSnapshotLineFormula(
        snapshotFromBalance({
          physicalQuantity: 30,
          reservedQuantity: 5,
          blockedQuantity: 5,
          quarantineQuantity: 0,
        })
      )
    );
  });
});
