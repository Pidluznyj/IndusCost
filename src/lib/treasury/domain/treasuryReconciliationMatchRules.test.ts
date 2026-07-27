import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertTreasuryReconciliationMatchBalanced,
  assertTreasuryReconciliationReverseConfirmPhrase,
  computeTreasuryReconciliationCoveringNet,
  deriveTreasuryBankMovementReconciliationStatus,
  TREASURY_RECONCILIATION_DOES_NOT_REALIZE_OFFICIAL,
} from "./treasuryReconciliationMatchRules.js";
import { TreasuryDomainError } from "./treasuryErrors.js";

describe("treasuryReconciliationMatchRules", () => {
  it("declara que não realiza baixa oficial", () => {
    assert.equal(TREASURY_RECONCILIATION_DOES_NOT_REALIZE_OFFICIAL, true);
  });

  it("1 movimento × 1 título — balanceado", () => {
    const r = assertTreasuryReconciliationMatchBalanced({
      movements: [{ bankMovementId: "m1", amount: "100.00" }],
      allocations: [
        {
          kind: "TITLE",
          amount: "100.00",
          nomusSide: "AR",
          officialTitleId: "t1",
          openBalance: "100.00",
        },
      ],
    });
    assert.equal(r.matchedAmount, "100.00");
    assert.equal(r.coveringNet, "100.00");
  });

  it("1 movimento × N títulos", () => {
    const r = assertTreasuryReconciliationMatchBalanced({
      movements: [{ bankMovementId: "m1", amount: "150.00" }],
      allocations: [
        {
          kind: "TITLE",
          amount: "90.00",
          nomusSide: "AR",
          officialTitleId: "t1",
        },
        {
          kind: "TITLE",
          amount: "60.00",
          nomusSide: "AR",
          officialTitleId: "t2",
        },
      ],
    });
    assert.equal(r.coveringNet, "150.00");
  });

  it("N movimentos × 1 título", () => {
    const r = assertTreasuryReconciliationMatchBalanced({
      movements: [
        { bankMovementId: "m1", amount: "40.00" },
        { bankMovementId: "m2", amount: "60.00" },
      ],
      allocations: [
        {
          kind: "TITLE",
          amount: "100.00",
          nomusSide: "AP",
          officialTitleId: "t1",
        },
      ],
    });
    assert.equal(r.matchedAmount, "100.00");
  });

  it("parcial + diferença + tarifa + juros + desconto + abatimento", () => {
    // TITLE 200 + FEE 5 + INTEREST 10 + DIFFERENCE 3 - DISCOUNT 8 - ABATEMENT 2 = 208
    const net = computeTreasuryReconciliationCoveringNet([
      { kind: "TITLE", amount: "200.00", nomusSide: "AR", officialTitleId: "t" },
      { kind: "FEE", amount: "5.00" },
      { kind: "INTEREST", amount: "10.00" },
      { kind: "DIFFERENCE", amount: "3.00", differenceCode: "ROUNDING" },
      { kind: "DISCOUNT", amount: "8.00" },
      { kind: "ABATEMENT", amount: "2.00" },
    ]);
    assert.equal(net, "208.00");
    const r = assertTreasuryReconciliationMatchBalanced({
      movements: [{ bankMovementId: "m1", amount: "208.00" }],
      allocations: [
        {
          kind: "TITLE",
          amount: "200.00",
          nomusSide: "AR",
          officialTitleId: "t",
          openBalance: "250.00",
        },
        { kind: "FEE", amount: "5.00" },
        { kind: "INTEREST", amount: "10.00" },
        { kind: "DIFFERENCE", amount: "3.00", differenceCode: "ROUNDING" },
        { kind: "DISCOUNT", amount: "8.00" },
        { kind: "ABATEMENT", amount: "2.00" },
      ],
    });
    assert.equal(r.matchedAmount, "208.00");
  });

  it("não identificado / transferência / lançamento manual", () => {
    assertTreasuryReconciliationMatchBalanced({
      movements: [{ bankMovementId: "m1", amount: "50.00" }],
      allocations: [{ kind: "UNIDENTIFIED", amount: "50.00", memo: "s/id" }],
    });
    assertTreasuryReconciliationMatchBalanced({
      movements: [{ bankMovementId: "m2", amount: "70.00" }],
      allocations: [
        { kind: "TRANSFER", amount: "70.00", transferId: "tr-1" },
      ],
    });
    assertTreasuryReconciliationMatchBalanced({
      movements: [{ bankMovementId: "m3", amount: "15.00" }],
      allocations: [
        {
          kind: "MANUAL_LEDGER",
          amount: "15.00",
          ledgerEntryId: "11111111-1111-4111-8111-111111111111",
        },
      ],
    });
  });

  it("rejeita desbalanceamento e TITLE acima do openBalance", () => {
    assert.throws(
      () =>
        assertTreasuryReconciliationMatchBalanced({
          movements: [{ bankMovementId: "m1", amount: "100.00" }],
          allocations: [
            {
              kind: "TITLE",
              amount: "90.00",
              nomusSide: "AR",
              officialTitleId: "t1",
            },
          ],
        }),
      TreasuryDomainError
    );
    assert.throws(
      () =>
        assertTreasuryReconciliationMatchBalanced({
          movements: [{ bankMovementId: "m1", amount: "100.00" }],
          allocations: [
            {
              kind: "TITLE",
              amount: "100.00",
              nomusSide: "AR",
              officialTitleId: "t1",
              openBalance: "50.00",
            },
          ],
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError &&
        err.message.includes("saldo aberto")
    );
  });

  it("exige frase forte REVERTER", () => {
    assert.throws(
      () => assertTreasuryReconciliationReverseConfirmPhrase("reverter"),
      TreasuryDomainError
    );
    assert.doesNotThrow(() =>
      assertTreasuryReconciliationReverseConfirmPhrase("REVERTER")
    );
  });

  it("deriva status PENDING / PARTIAL / MATCHED", () => {
    assert.equal(
      deriveTreasuryBankMovementReconciliationStatus({
        amount: "100.00",
        reconciledAmount: "0.00",
      }),
      "PENDING"
    );
    assert.equal(
      deriveTreasuryBankMovementReconciliationStatus({
        amount: "100.00",
        reconciledAmount: "40.00",
      }),
      "PARTIAL"
    );
    assert.equal(
      deriveTreasuryBankMovementReconciliationStatus({
        amount: "100.00",
        reconciledAmount: "100.00",
      }),
      "MATCHED"
    );
    assert.equal(
      deriveTreasuryBankMovementReconciliationStatus({
        amount: "100.00",
        reconciledAmount: "0.00",
        currentStatus: "IGNORED",
      }),
      "IGNORED"
    );
  });
});
