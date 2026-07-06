import type { CommissionReleaseRule } from "@prisma/client";
import { roundMoney } from "./commission-money.js";
import type {
  CommissionPaymentScheduleDraft,
  CommissionReceivableSource,
  CommissionSettingsSnapshot,
} from "./commission-types.js";

export type CommissionReleaseComputation = {
  releasedDelta: number;
  newReleasedTotal: number;
  newRecordStatus: "WAITING_PAYMENT" | "PARTIALLY_RELEASED" | "RELEASED";
  scheduleReleasedAmount: number;
  scheduleStatus: "ACTIVE" | "PARTIALLY_PAID" | "PAID";
};

export type ScheduleReleaseRecomputeInput = {
  id: string;
  commissionExpectedAmount: number;
  commissionReleasedAmount: number;
  receivableAmount: number | null;
  receivedAmount: number | null;
  receivable: CommissionReceivableSource | null;
};

export type ScheduleReleaseRecomputeResult = {
  id: string;
  commissionReleasedAmount: number;
  scheduleStatus: "ACTIVE" | "PARTIALLY_PAID" | "PAID";
};

export function resolveEffectiveReleaseRule(
  recordReleaseRule: CommissionReleaseRule,
  settings: CommissionSettingsSnapshot
): CommissionReleaseRule {
  return recordReleaseRule ?? settings.releaseDefaultRule;
}

export function resolveScheduleReleaseStatus(
  commissionExpectedAmount: number,
  commissionReleasedAmount: number
): "ACTIVE" | "PARTIALLY_PAID" | "PAID" {
  const expected = roundMoney(commissionExpectedAmount);
  const released = roundMoney(commissionReleasedAmount);
  if (released <= 0) return "ACTIVE";
  if (expected > 0 && released >= expected) return "PAID";
  return "PARTIALLY_PAID";
}

export function resolveRecordReleaseStatus(
  releasedAmount: number,
  commissionAmount: number,
  paidAmount: number
): "WAITING_PAYMENT" | "PARTIALLY_RELEASED" | "RELEASED" | "PAID_PARTIAL" | "PAID_TOTAL" {
  const released = roundMoney(releasedAmount);
  const commission = roundMoney(commissionAmount);
  const paid = roundMoney(paidAmount);
  if (paid >= commission && commission > 0) return "PAID_TOTAL";
  if (paid > 0) return "PAID_PARTIAL";
  if (released >= commission && commission > 0) return "RELEASED";
  if (released > 0) return "PARTIALLY_RELEASED";
  return "WAITING_PAYMENT";
}

/**
 * Valor liberado-alvo de uma linha de schedule (idempotente).
 * Usa commissionExpectedAmount como teto — nunca a comissão total do registro.
 */
export function computeScheduleReleaseTarget(input: {
  releaseRule: CommissionReleaseRule;
  schedule: {
    commissionExpectedAmount: number;
    receivableAmount: number | null;
    receivedAmount: number | null;
  };
  receivable: CommissionReceivableSource | null;
  isFirstReceivablePaidInOrder: boolean;
  receivableAsDefinitiveReleaseSource?: boolean;
}): number {
  const cap = roundMoney(input.schedule.commissionExpectedAmount);
  if (cap <= 0) return 0;

  const receivableAmount = roundMoney(
    input.receivable?.amountReceivable ?? input.schedule.receivableAmount ?? 0
  );
  const receivedAmount = roundMoney(
    input.receivable?.amountReceived ?? input.schedule.receivedAmount ?? 0
  );

  switch (input.releaseRule) {
    case "EACH_RECEIVABLE_PAID":
      if (receivableAmount <= 0 || receivedAmount <= 0) return 0;
      return roundMoney(
        Math.min(cap, roundMoney(cap * (receivedAmount / receivableAmount)))
      );
    case "FIRST_RECEIVABLE_PAID":
      if (input.isFirstReceivablePaidInOrder && receivedAmount > 0) return cap;
      return 0;
    case "SALES_ORDER_CREATED":
    case "OUTPUT_DOCUMENT_CREATED":
      if (
        input.receivableAsDefinitiveReleaseSource &&
        receivedAmount <= 0
      ) {
        return 0;
      }
      return cap;
    default:
      return 0;
  }
}

export function recomputeCommissionRecordRelease(input: {
  releaseRule: CommissionReleaseRule;
  commissionAmount: number;
  paidAmount: number;
  receivableAsDefinitiveReleaseSource?: boolean;
  schedules: ScheduleReleaseRecomputeInput[];
}): {
  scheduleUpdates: ScheduleReleaseRecomputeResult[];
  releasedAmount: number;
  status: ReturnType<typeof resolveRecordReleaseStatus>;
  balanceAmount: number;
} {
  let firstPaidSeen = false;
  const scheduleUpdates: ScheduleReleaseRecomputeResult[] = [];
  let releasedTotal = 0;

  for (const schedule of input.schedules) {
    const receivedAmount = roundMoney(
      schedule.receivable?.amountReceived ?? schedule.receivedAmount ?? 0
    );
    const isFirstPaid = !firstPaidSeen && receivedAmount > 0;
    if (isFirstPaid) firstPaidSeen = true;

    const targetReleased = computeScheduleReleaseTarget({
      releaseRule: input.releaseRule,
      schedule: {
        commissionExpectedAmount: schedule.commissionExpectedAmount,
        receivableAmount: schedule.receivableAmount,
        receivedAmount: schedule.receivedAmount,
      },
      receivable: schedule.receivable,
      isFirstReceivablePaidInOrder: isFirstPaid,
      receivableAsDefinitiveReleaseSource: input.receivableAsDefinitiveReleaseSource,
    });

    releasedTotal = roundMoney(releasedTotal + targetReleased);
    scheduleUpdates.push({
      id: schedule.id,
      commissionReleasedAmount: targetReleased,
      scheduleStatus: resolveScheduleReleaseStatus(
        schedule.commissionExpectedAmount,
        targetReleased
      ),
    });
  }

  const commissionAmount = roundMoney(input.commissionAmount);
  releasedTotal = roundMoney(Math.min(releasedTotal, commissionAmount));

  return {
    scheduleUpdates,
    releasedAmount: releasedTotal,
    status: resolveRecordReleaseStatus(
      releasedTotal,
      commissionAmount,
      input.paidAmount
    ),
    balanceAmount: computeBalanceAfterRelease(
      commissionAmount,
      releasedTotal,
      input.paidAmount
    ),
  };
}

export function computeReleaseForSchedule(input: {
  releaseRule: CommissionReleaseRule;
  commissionAmount: number;
  alreadyReleased: number;
  receivableAsDefinitiveReleaseSource?: boolean;
  schedule: CommissionPaymentScheduleDraft;
  receivable: CommissionReceivableSource | null;
  isFirstReceivablePaidInOrder: boolean;
}): CommissionReleaseComputation {
  const recordCommission = roundMoney(input.commissionAmount);
  const recordAlready = roundMoney(input.alreadyReleased);
  const scheduleCap = roundMoney(input.schedule.commissionExpectedAmount);
  const scheduleAlready = roundMoney(input.schedule.commissionReleasedAmount ?? 0);
  const scheduleRemaining = roundMoney(Math.max(0, scheduleCap - scheduleAlready));

  if (scheduleRemaining <= 0) {
    return {
      releasedDelta: 0,
      newReleasedTotal: recordAlready,
      newRecordStatus:
        recordAlready >= recordCommission ? "RELEASED" : "PARTIALLY_RELEASED",
      scheduleReleasedAmount: scheduleAlready,
      scheduleStatus: resolveScheduleReleaseStatus(scheduleCap, scheduleAlready),
    };
  }

  const targetReleased = computeScheduleReleaseTarget({
    releaseRule: input.releaseRule,
    schedule: {
      commissionExpectedAmount: scheduleCap,
      receivableAmount: input.schedule.receivableAmount,
      receivedAmount: input.schedule.receivedAmount,
    },
    receivable: input.receivable,
    isFirstReceivablePaidInOrder: input.isFirstReceivablePaidInOrder,
    receivableAsDefinitiveReleaseSource: input.receivableAsDefinitiveReleaseSource,
  });

  const scheduleReleased = roundMoney(
    Math.min(scheduleCap, Math.max(scheduleAlready, targetReleased))
  );
  const delta = roundMoney(Math.max(0, scheduleReleased - scheduleAlready));
  const newReleasedTotal = roundMoney(Math.min(recordCommission, recordAlready + delta));

  let newRecordStatus: CommissionReleaseComputation["newRecordStatus"] = "WAITING_PAYMENT";
  if (newReleasedTotal > 0 && newReleasedTotal < recordCommission) {
    newRecordStatus = "PARTIALLY_RELEASED";
  }
  if (newReleasedTotal >= recordCommission && recordCommission > 0) {
    newRecordStatus = "RELEASED";
  }

  return {
    releasedDelta: delta,
    newReleasedTotal,
    newRecordStatus,
    scheduleReleasedAmount: scheduleReleased,
    scheduleStatus: resolveScheduleReleaseStatus(scheduleCap, scheduleReleased),
  };
}

export function computeBalanceAfterRelease(
  commissionAmount: number,
  releasedAmount: number,
  paidAmount: number
): number {
  return roundMoney(roundMoney(commissionAmount) - roundMoney(releasedAmount) - roundMoney(paidAmount));
}
