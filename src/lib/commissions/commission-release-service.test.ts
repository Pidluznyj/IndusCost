import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeReleaseForSchedule,
  computeScheduleReleaseTarget,
  recomputeCommissionRecordRelease,
} from "./commission-release-service.js";

function baseSchedule(overrides: Partial<{
  commissionExpectedAmount: number;
  commissionReleasedAmount: number;
  receivableAmount: number;
  receivedAmount: number;
  allocationPercent: number;
}> = {}) {
  return {
    scheduleKey: "sch-1",
    source: "ACCOUNTS_RECEIVABLE" as const,
    status: "ACTIVE" as const,
    nomusOrderId: 2579,
    nomusNfeId: 7147,
    nomusReceivableId: 16662,
    installmentNumber: 1,
    dueDate: null,
    expectedAmount: null,
    receivableAmount: 1000,
    receivedAmount: 1000,
    openBalance: 0,
    allocationPercent: overrides.allocationPercent ?? 100,
    commissionExpectedAmount: overrides.commissionExpectedAmount ?? 75,
    commissionReleasedAmount: overrides.commissionReleasedAmount ?? 0,
  };
}

function baseReceivable(overrides: Partial<{ amountReceivable: number; amountReceived: number }> = {}) {
  return {
    nomusReceivableId: 16662,
    nomusNfeId: 7147,
    installmentNumber: 1,
    dueDate: null,
    amountReceivable: overrides.amountReceivable ?? 1000,
    amountReceived: overrides.amountReceived ?? 1000,
    balanceReceivable: 0,
    settlementDate: null,
  };
}

describe("commission-release-service — rateio por schedule", () => {
  it("allocationPercent 30% com título pago integral libera commissionExpectedAmount, não record total", () => {
    const target = computeScheduleReleaseTarget({
      releaseRule: "EACH_RECEIVABLE_PAID",
      schedule: {
        commissionExpectedAmount: 22.5,
        receivableAmount: 1000,
        receivedAmount: 1000,
      },
      receivable: baseReceivable(),
      isFirstReceivablePaidInOrder: true,
    });
    assert.equal(target, 22.5);

    const result = computeReleaseForSchedule({
      releaseRule: "EACH_RECEIVABLE_PAID",
      commissionAmount: 75,
      alreadyReleased: 0,
      isFirstReceivablePaidInOrder: true,
      receivable: baseReceivable(),
      schedule: baseSchedule({
        commissionExpectedAmount: 22.5,
        allocationPercent: 30,
      }),
    });
    assert.equal(result.scheduleReleasedAmount, 22.5);
    assert.equal(result.releasedDelta, 22.5);
    assert.equal(result.newReleasedTotal, 22.5);
    assert.notEqual(result.scheduleReleasedAmount, 75);
  });

  it("allocationPercent 100% com título pago integral libera commissionExpectedAmount integral", () => {
    const target = computeScheduleReleaseTarget({
      releaseRule: "EACH_RECEIVABLE_PAID",
      schedule: {
        commissionExpectedAmount: 75,
        receivableAmount: 1000,
        receivedAmount: 1000,
      },
      receivable: baseReceivable(),
      isFirstReceivablePaidInOrder: true,
    });
    assert.equal(target, 75);
  });

  it("allocationPercent 50% com título pago integral libera metade da comissão do registro na linha", () => {
    const target = computeScheduleReleaseTarget({
      releaseRule: "EACH_RECEIVABLE_PAID",
      schedule: {
        commissionExpectedAmount: 37.5,
        receivableAmount: 500,
        receivedAmount: 500,
      },
      receivable: baseReceivable({ amountReceivable: 500, amountReceived: 500 }),
      isFirstReceivablePaidInOrder: true,
    });
    assert.equal(target, 37.5);
  });

  it("recebimento parcial libera proporcionalmente limitado ao commissionExpectedAmount", () => {
    const target = computeScheduleReleaseTarget({
      releaseRule: "EACH_RECEIVABLE_PAID",
      schedule: {
        commissionExpectedAmount: 100,
        receivableAmount: 1000,
        receivedAmount: 250,
      },
      receivable: baseReceivable({ amountReceivable: 1000, amountReceived: 250 }),
      isFirstReceivablePaidInOrder: false,
    });
    assert.equal(target, 25);
  });

  it("recebimento acima do título não libera acima do commissionExpectedAmount", () => {
    const target = computeScheduleReleaseTarget({
      releaseRule: "EACH_RECEIVABLE_PAID",
      schedule: {
        commissionExpectedAmount: 22.5,
        receivableAmount: 1000,
        receivedAmount: 1500,
      },
      receivable: baseReceivable({ amountReceivable: 1000, amountReceived: 1500 }),
      isFirstReceivablePaidInOrder: true,
    });
    assert.equal(target, 22.5);
  });

  it("recompute soma schedules e limita releasedAmount ao commissionAmount do registro", () => {
    const recomputed = recomputeCommissionRecordRelease({
      releaseRule: "EACH_RECEIVABLE_PAID",
      commissionAmount: 75,
      paidAmount: 0,
      schedules: [
        {
          id: "s1",
          commissionExpectedAmount: 22.5,
          commissionReleasedAmount: 75,
          receivableAmount: 1000,
          receivedAmount: 1000,
          receivable: baseReceivable(),
        },
        {
          id: "s2",
          commissionExpectedAmount: 52.5,
          commissionReleasedAmount: 0,
          receivableAmount: 2000,
          receivedAmount: 0,
          receivable: baseReceivable({ amountReceivable: 2000, amountReceived: 0 }),
        },
      ],
    });
    assert.equal(recomputed.scheduleUpdates[0]?.commissionReleasedAmount, 22.5);
    assert.equal(recomputed.scheduleUpdates[1]?.commissionReleasedAmount, 0);
    assert.equal(recomputed.releasedAmount, 22.5);
    assert.ok(
      recomputed.scheduleUpdates.every(
        (s, idx) =>
          s.commissionReleasedAmount <=
          (idx === 0 ? 22.5 : 52.5)
      )
    );
  });

  it("múltiplas linhas no mesmo recebível respeitam teto individual", () => {
    const recomputed = recomputeCommissionRecordRelease({
      releaseRule: "EACH_RECEIVABLE_PAID",
      commissionAmount: 200,
      paidAmount: 0,
      schedules: [
        {
          id: "a",
          commissionExpectedAmount: 100,
          commissionReleasedAmount: 0,
          receivableAmount: 1000,
          receivedAmount: 500,
          receivable: baseReceivable({ amountReceivable: 1000, amountReceived: 500 }),
        },
        {
          id: "b",
          commissionExpectedAmount: 100,
          commissionReleasedAmount: 0,
          receivableAmount: 1000,
          receivedAmount: 500,
          receivable: baseReceivable({ amountReceivable: 1000, amountReceived: 500 }),
        },
      ],
    });
    assert.equal(recomputed.scheduleUpdates[0]?.commissionReleasedAmount, 50);
    assert.equal(recomputed.scheduleUpdates[1]?.commissionReleasedAmount, 50);
    assert.equal(recomputed.releasedAmount, 100);
  });

  it("título não recebido libera 0", () => {
    const target = computeScheduleReleaseTarget({
      releaseRule: "EACH_RECEIVABLE_PAID",
      schedule: {
        commissionExpectedAmount: 22.5,
        receivableAmount: 1000,
        receivedAmount: 0,
      },
      receivable: baseReceivable({ amountReceived: 0 }),
      isFirstReceivablePaidInOrder: false,
    });
    assert.equal(target, 0);
  });
});
