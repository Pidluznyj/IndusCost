import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  TreasuryReconciliationAllocationDto,
  TreasuryReconciliationMatchDto,
} from "../contracts/treasuryDto.js";
import {
  buildCashSupportReconciliationActions,
  summarizeCashSupportReconciliationForMovement,
} from "./cashSupportReconciliationAdapter.js";

function allocation(
  overrides: Partial<TreasuryReconciliationAllocationDto>
): TreasuryReconciliationAllocationDto {
  return {
    id: "alloc-1",
    matchId: "match-1",
    kind: "TITLE",
    amount: "100.00",
    memo: null,
    nomusSide: "AR",
    officialTitleId: "title-1",
    nomusExternalId: 1,
    transferId: null,
    transferGroupId: null,
    ledgerEntryId: null,
    differenceCode: null,
    sortOrder: 0,
    ...overrides,
  };
}

function match(overrides: Partial<TreasuryReconciliationMatchDto>): TreasuryReconciliationMatchDto {
  return {
    id: "match-1",
    companyCode: "EMP1",
    accountId: "acc-1",
    status: "MATCHED",
    matchedAmount: "100.00",
    currency: "BRL",
    matchedCivilDate: "2026-07-20",
    justification: "Recebimento",
    suggestionKey: null,
    algorithmVersion: null,
    suggestionScore: null,
    suggestionConfidence: null,
    suggestionReasons: null,
    version: 1,
    movements: [],
    allocations: [allocation({})],
    createdAt: "2026-07-20T10:00:00.000Z",
    createdByUserId: "u1",
    updatedAt: "2026-07-20T10:00:00.000Z",
    updatedByUserId: null,
    unmatchedAt: null,
    unmatchedByUserId: null,
    unmatchReason: null,
    isReversed: false,
    ...overrides,
  } as TreasuryReconciliationMatchDto;
}

describe("cashSupportReconciliationAdapter", () => {
  it("sem matches ativos: allocatedAmount zero, sem ação de unmatch/reverse", () => {
    const summary = summarizeCashSupportReconciliationForMovement([]);
    assert.equal(summary.allocatedAmount, "0.00");
    assert.equal(summary.reconciliationState, "PENDING");

    const actions = buildCashSupportReconciliationActions(summary);
    assert.equal(actions.find((a) => a.kind === "UNMATCH")!.enabled, false);
    assert.equal(actions.find((a) => a.kind === "REVERSE")!.enabled, false);
  });

  it("1:1 — TITLE isolado soma em titleAllocatedAmount e allocatedAmount", () => {
    const summary = summarizeCashSupportReconciliationForMovement([
      match({ allocations: [allocation({ kind: "TITLE", amount: "1000.00" })] }),
    ]);
    assert.equal(summary.titleAllocatedAmount, "1000.00");
    assert.equal(summary.allocatedAmount, "1000.00");
    assert.equal(summary.adjustmentAmount, "0.00");
    assert.equal(summary.reconciliationState, "MATCHED");
  });

  it("tarifa: título 10.000 + FEE 50 sobre movimento de 10.050", () => {
    const summary = summarizeCashSupportReconciliationForMovement([
      match({
        allocations: [
          allocation({ kind: "TITLE", amount: "10000.00" }),
          allocation({ kind: "FEE", amount: "50.00", officialTitleId: null, nomusExternalId: null }),
        ],
      }),
    ]);
    assert.equal(summary.titleAllocatedAmount, "10000.00");
    assert.equal(summary.adjustmentAmount, "50.00");
    assert.equal(summary.allocatedAmount, "10050.00", "banco recebeu 10.050 no total");
  });

  it("desconto: título 10.000 coberto por movimento de 9.950 + DISCOUNT 50", () => {
    const summary = summarizeCashSupportReconciliationForMovement([
      match({
        matchedAmount: "9950.00",
        allocations: [
          allocation({ kind: "TITLE", amount: "10000.00" }),
          allocation({ kind: "DISCOUNT", amount: "50.00", officialTitleId: null, nomusExternalId: null }),
        ],
      }),
    ]);
    assert.equal(summary.titleAllocatedAmount, "10000.00", "título cobre no valor cheio");
    assert.equal(summary.adjustmentAmount, "-50.00", "desconto não cria dinheiro bancário");
    assert.equal(
      summary.allocatedAmount,
      "9950.00",
      "banco só recebeu 9.950 — desconto não é dinheiro adicional"
    );
  });

  it("1:N — dois títulos no mesmo match somam em titleAllocatedAmount", () => {
    const summary = summarizeCashSupportReconciliationForMovement([
      match({
        allocations: [
          allocation({ kind: "TITLE", amount: "600.00", officialTitleId: "t-1" }),
          allocation({ kind: "TITLE", amount: "400.00", officialTitleId: "t-2" }),
        ],
      }),
    ]);
    assert.equal(summary.titleAllocatedAmount, "1000.00");
  });

  it("N:1 — vários matches ativos sobre o mesmo movimento somam juntos", () => {
    const summary = summarizeCashSupportReconciliationForMovement([
      match({ id: "m1", allocations: [allocation({ kind: "TITLE", amount: "300.00" })] }),
      match({ id: "m2", allocations: [allocation({ kind: "TITLE", amount: "200.00" })] }),
    ]);
    assert.equal(summary.titleAllocatedAmount, "500.00");
    assert.equal(summary.activeMatchIds.length, 2);
  });

  it("UNIDENTIFIED soma no allocatedAmount mas não em titleAllocatedAmount", () => {
    const summary = summarizeCashSupportReconciliationForMovement([
      match({
        allocations: [
          allocation({ kind: "UNIDENTIFIED", amount: "500.00", officialTitleId: null, nomusExternalId: null }),
        ],
      }),
    ]);
    assert.equal(summary.titleAllocatedAmount, "0.00");
    assert.equal(summary.allocatedAmount, "500.00");
  });

  it("estado PENDING é preservado quando nenhum match está MATCHED", () => {
    const summary = summarizeCashSupportReconciliationForMovement([
      match({ status: "PENDING" }),
    ]);
    assert.equal(summary.reconciliationState, "PENDING");
  });

  it("com match ativo: UNMATCH e REVERSE habilitados", () => {
    const summary = summarizeCashSupportReconciliationForMovement([match({})]);
    const actions = buildCashSupportReconciliationActions(summary);
    assert.equal(actions.find((a) => a.kind === "UNMATCH")!.enabled, true);
    assert.equal(actions.find((a) => a.kind === "REVERSE")!.enabled, true);
  });

  it("nenhum valor monetário é number", () => {
    const summary = summarizeCashSupportReconciliationForMovement([match({})]);
    assert.equal(typeof summary.allocatedAmount, "string");
    assert.equal(typeof summary.titleAllocatedAmount, "string");
    assert.equal(typeof summary.adjustmentAmount, "string");
  });

  it("auditReference aponta para um match real, nunca inventado", () => {
    const summary = summarizeCashSupportReconciliationForMovement([match({ id: "match-xyz" })]);
    assert.equal(summary.auditReference, "match-xyz");
    assert.equal(summarizeCashSupportReconciliationForMovement([]).auditReference, null);
  });
});
