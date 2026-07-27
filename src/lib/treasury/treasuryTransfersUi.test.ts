import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createEmptyTreasuryTransferForm,
  resolveTreasuryTransfersViewKind,
  validateTreasuryTransferForm,
} from "./treasuryTransfersUi.js";

describe("treasuryTransfersUi", () => {
  it("valida formulário básico", () => {
    const form = createEmptyTreasuryTransferForm("2026-08-10");
    assert.ok(validateTreasuryTransferForm(form));
    form.fromAccountId = "a";
    form.toAccountId = "a";
    form.amount = "10.00";
    assert.match(validateTreasuryTransferForm(form) ?? "", /distintos/);
    form.toAccountId = "b";
    form.amount = "0";
    assert.match(validateTreasuryTransferForm(form) ?? "", /positivo/);
    form.amount = "10.50";
    assert.equal(validateTreasuryTransferForm(form), null);
  });

  it("resolve view kinds", () => {
    assert.equal(
      resolveTreasuryTransfersViewKind({
        canView: false,
        loading: false,
        error: null,
        itemCount: 0,
      }),
      "denied"
    );
    assert.equal(
      resolveTreasuryTransfersViewKind({
        canView: true,
        loading: true,
        error: null,
        itemCount: 0,
      }),
      "loading"
    );
    assert.equal(
      resolveTreasuryTransfersViewKind({
        canView: true,
        loading: false,
        error: null,
        itemCount: 0,
      }),
      "empty"
    );
    assert.equal(
      resolveTreasuryTransfersViewKind({
        canView: true,
        loading: false,
        error: null,
        itemCount: 2,
      }),
      "ready"
    );
  });
});
