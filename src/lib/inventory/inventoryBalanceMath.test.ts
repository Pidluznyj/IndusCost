import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyMovementToBalance,
  applyTransferDestinationImpact,
  assertBalanceFormula,
  resolveMovementImpact,
  resolveReversalImpact,
} from "./inventoryBalanceMath.js";
import {
  calculateAvailableBalance,
  emptyInventoryBalance,
  normalizeInventoryBalance,
  snapshotFromBalance,
} from "./inventoryTypes.js";

describe("inventoryBalanceMath", () => {
  it("1. entrada aumenta saldo físico e disponível", () => {
    const base = emptyInventoryBalance();
    const next = applyMovementToBalance(base, "MANUAL_ENTRY", 10);
    assert.equal(next.physicalQuantity, 10);
    assert.equal(next.availableQuantity, 10);
    assertBalanceFormula(next);
  });

  it("2. saída reduz saldo físico e disponível", () => {
    const base = snapshotFromBalance({ physicalQuantity: 20, availableQuantity: 20 });
    const next = applyMovementToBalance(base, "MANUAL_EXIT", 5);
    assert.equal(next.physicalQuantity, 15);
    assert.equal(next.availableQuantity, 15);
  });

  it("3. reserva reduz disponível, mas não físico", () => {
    const base = snapshotFromBalance({ physicalQuantity: 20 });
    const next = applyMovementToBalance(base, "RESERVE", 4);
    assert.equal(next.physicalQuantity, 20);
    assert.equal(next.reservedQuantity, 4);
    assert.equal(next.availableQuantity, 16);
  });

  it("4. cancelamento de reserva libera disponível", () => {
    const base = snapshotFromBalance({ physicalQuantity: 20, reservedQuantity: 4 });
    const next = applyMovementToBalance(base, "CANCEL_RESERVATION", 4);
    assert.equal(next.reservedQuantity, 0);
    assert.equal(next.availableQuantity, 20);
  });

  it("5. bloqueio reduz disponível, mas não físico", () => {
    const base = snapshotFromBalance({ physicalQuantity: 12 });
    const next = applyMovementToBalance(base, "BLOCK", 3);
    assert.equal(next.physicalQuantity, 12);
    assert.equal(next.blockedQuantity, 3);
    assert.equal(next.availableQuantity, 9);
  });

  it("6. desbloqueio libera disponível", () => {
    const base = snapshotFromBalance({ physicalQuantity: 12, blockedQuantity: 3 });
    const next = applyMovementToBalance(base, "UNBLOCK", 3);
    assert.equal(next.blockedQuantity, 0);
    assert.equal(next.availableQuantity, 12);
  });

  it("7. transferência reduz origem; destino aumenta via helper", () => {
    const source = snapshotFromBalance({ physicalQuantity: 30 });
    const afterSource = applyMovementToBalance(source, "TRANSFER", 8);
    assert.equal(afterSource.physicalQuantity, 22);

    const dest = applyTransferDestinationImpact(emptyInventoryBalance(), 8);
    assert.equal(dest.physicalQuantity, 8);
  });

  it("8. ajuste positivo aumenta físico", () => {
    const next = applyMovementToBalance(emptyInventoryBalance(), "POSITIVE_ADJUSTMENT", 2.5);
    assert.equal(next.physicalQuantity, 2.5);
  });

  it("9. ajuste negativo reduz físico", () => {
    const next = applyMovementToBalance(snapshotFromBalance({ physicalQuantity: 10 }), "NEGATIVE_ADJUSTMENT", 2);
    assert.equal(next.physicalQuantity, 8);
  });

  it("17. fórmula de availableQuantity é sempre respeitada", () => {
    const balance = normalizeInventoryBalance({
      physicalQuantity: 100,
      reservedQuantity: 10,
      blockedQuantity: 5,
      quarantineQuantity: 3,
      availableQuantity: 999,
    });
    assert.equal(balance.availableQuantity, 82);
    assertBalanceFormula(balance);
  });

  it("estorno inverte impacto original", () => {
    const impact = resolveReversalImpact("MANUAL_EXIT", 5);
    assert.equal(impact.physicalDelta, 5);
    const fromExit = resolveMovementImpact("MANUAL_EXIT", 5);
    assert.equal(impact.physicalDelta, -fromExit.physicalDelta);
  });

  it("quantidade zero é inválida no impacto", () => {
    assert.throws(() => resolveMovementImpact("MANUAL_ENTRY", 0));
  });

  it("calculateAvailableBalance isolado", () => {
    assert.equal(
      calculateAvailableBalance({
        physicalQuantity: 50,
        reservedQuantity: 5,
        blockedQuantity: 2,
        quarantineQuantity: 3,
      }),
      40
    );
  });
});
