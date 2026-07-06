import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { validateMovementRequest, previewMovementImpact } from "./inventoryMovementRules.js";
import { InventoryValidationError, snapshotFromBalance } from "./inventoryTypes.js";
import { calculateInventoryStatus } from "./inventoryStatus.js";

describe("inventoryMovementRules", () => {
  it("10. saída maior que disponível é bloqueada", () => {
    const balance = snapshotFromBalance({ physicalQuantity: 10, reservedQuantity: 6 });
    assert.throws(
      () =>
        validateMovementRequest(balance, {
          movementType: "MANUAL_EXIT",
          quantity: 5,
          reason: "Teste",
        }),
      (e: unknown) =>
        e instanceof InventoryValidationError &&
        (e as InventoryValidationError).code === "INSUFFICIENT_AVAILABLE"
    );
  });

  it("11. quantidade zero ou negativa é inválida", () => {
    assert.throws(() =>
      validateMovementRequest(emptyBalance(), { movementType: "MANUAL_ENTRY", quantity: 0, reason: "x" })
    );
    assert.throws(() =>
      validateMovementRequest(emptyBalance(), { movementType: "MANUAL_ENTRY", quantity: -1, reason: "x" })
    );
  });

  it("12. transferência para mesmo local é inválida", () => {
    const wh = "11111111-1111-4111-8111-111111111111";
    assert.throws(
      () =>
        validateMovementRequest(emptyBalance(), {
          movementType: "TRANSFER",
          quantity: 1,
          reason: "Transferir",
          sourceWarehouseId: wh,
          destinationWarehouseId: wh,
        }),
      (e: unknown) => e instanceof InventoryValidationError && (e as InventoryValidationError).code === "TRANSFER_SAME_LOCATION"
    );
  });

  it("13. saída de suprimento administrativo exige centro de custo", () => {
    assert.throws(
      () =>
        validateMovementRequest(snapshotFromBalance({ physicalQuantity: 10 }), {
          movementType: "REQUISITION_EXIT",
          quantity: 1,
          reason: "Uso administrativo",
          itemType: "ADMINISTRATIVE_SUPPLY",
        }),
      (e: unknown) => e instanceof InventoryValidationError && (e as InventoryValidationError).code === "COST_CENTER_REQUIRED"
    );

    const ok = validateMovementRequest(snapshotFromBalance({ physicalQuantity: 10 }), {
      movementType: "REQUISITION_EXIT",
      quantity: 1,
      reason: "Uso administrativo",
      itemType: "ADMINISTRATIVE_SUPPLY",
      costCenterId: "cc-1",
    });
    assert.equal(ok.availableQuantity, 9);
  });

  it("14. status CRITICAL funciona", () => {
    const status = calculateInventoryStatus(snapshotFromBalance({ physicalQuantity: 4 }), {
      minimumStock: 10,
      reorderPoint: 20,
    });
    assert.equal(status, "CRITICAL");
  });

  it("15. status OUT_OF_STOCK funciona", () => {
    const status = calculateInventoryStatus(emptyBalance());
    assert.equal(status, "OUT_OF_STOCK");
  });

  it("16. status NEGATIVE funciona", () => {
    const status = calculateInventoryStatus(
      snapshotFromBalance({ physicalQuantity: -1, availableQuantity: -1 })
    );
    assert.equal(status, "NEGATIVE");
  });

  it("ajuste positivo exige motivo", () => {
    assert.throws(() =>
      validateMovementRequest(emptyBalance(), {
        movementType: "POSITIVE_ADJUSTMENT",
        quantity: 1,
      })
    );
  });

  it("previewMovementImpact retorna próximo saldo", () => {
    const preview = previewMovementImpact(emptyBalance(), "MANUAL_ENTRY", 3);
    assert.equal(preview.nextBalance.physicalQuantity, 3);
  });

  it("18. arquivos puros não importam Prisma", () => {
    const root = join(process.cwd(), "src/lib/inventory");
    for (const file of [
      "inventoryTypes.ts",
      "inventoryBalanceMath.ts",
      "inventoryMovementRules.ts",
      "inventoryStatus.ts",
    ]) {
      const src = readFileSync(join(root, file), "utf8");
      assert.doesNotMatch(src, /@prisma\/client/);
      assert.doesNotMatch(src, /PrismaClient/);
    }
  });
});

function emptyBalance() {
  return snapshotFromBalance({});
}
