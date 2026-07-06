import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clampPaymentAmount, roundMoney } from "./commission-money.js";
import { computeBalanceAfterRelease } from "./commission-release-service.js";

describe("commission-payment-service rules", () => {
  it("clampPaymentAmount não permite pagar acima do liberado", () => {
    assert.equal(clampPaymentAmount(150, 100), 100);
    assert.equal(clampPaymentAmount(80, 100), 80);
    assert.equal(clampPaymentAmount(0, 100), 0);
  });

  it("computeBalanceAfterRelease reflete saldo após pagamento parcial", () => {
    const balance = computeBalanceAfterRelease(1000, 600, 200);
    assert.equal(balance, 200);
  });

  it("availableToPay é liberado menos pago", () => {
    const released = 500;
    const paid = 150;
    const available = roundMoney(Math.max(0, released - paid));
    assert.equal(available, 350);
  });
});
