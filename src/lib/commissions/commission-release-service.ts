import type { CommissionReleaseRule } from "@prisma/client";
import {
  computeReleasedAmountForReceivable,
  roundMoney,
} from "./commission-money.js";
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

export function resolveEffectiveReleaseRule(
  recordReleaseRule: CommissionReleaseRule,
  settings: CommissionSettingsSnapshot
): CommissionReleaseRule {
  return recordReleaseRule ?? settings.releaseDefaultRule;
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
  const commission = roundMoney(input.commissionAmount);
  const already = roundMoney(input.alreadyReleased);
  const remaining = roundMoney(commission - already);

  if (remaining <= 0) {
    return {
      releasedDelta: 0,
      newReleasedTotal: already,
      newRecordStatus: already >= commission ? "RELEASED" : "PARTIALLY_RELEASED",
      scheduleReleasedAmount: input.schedule.commissionReleasedAmount,
      scheduleStatus:
        input.schedule.commissionReleasedAmount >= input.schedule.commissionExpectedAmount
          ? "PAID"
          : "PARTIALLY_PAID",
    };
  }

  let delta = 0;

  switch (input.releaseRule) {
    case "SALES_ORDER_CREATED":
    case "OUTPUT_DOCUMENT_CREATED":
      if (
        input.receivableAsDefinitiveReleaseSource &&
        (!input.receivable || input.receivable.amountReceived <= 0)
      ) {
        delta = 0;
      } else {
        delta = remaining;
      }
      break;
    case "FIRST_RECEIVABLE_PAID":
      if (input.isFirstReceivablePaidInOrder && input.receivable && input.receivable.amountReceived > 0) {
        delta = remaining;
      }
      break;
    case "EACH_RECEIVABLE_PAID":
      if (input.receivable) {
        delta = computeReleasedAmountForReceivable({
          commissionAmount: commission,
          alreadyReleased: already,
          receivableAmount: input.receivable.amountReceivable,
          receivedAmount: input.receivable.amountReceived,
        });
      }
      break;
    default:
      delta = 0;
  }

  delta = roundMoney(Math.min(delta, remaining));
  const newReleasedTotal = roundMoney(already + delta);
  const scheduleReleased = roundMoney(input.schedule.commissionReleasedAmount + delta);

  let newRecordStatus: CommissionReleaseComputation["newRecordStatus"] = "WAITING_PAYMENT";
  if (newReleasedTotal > 0 && newReleasedTotal < commission) newRecordStatus = "PARTIALLY_RELEASED";
  if (newReleasedTotal >= commission) newRecordStatus = "RELEASED";

  let scheduleStatus: CommissionReleaseComputation["scheduleStatus"] = "ACTIVE";
  if (scheduleReleased > 0 && scheduleReleased < input.schedule.commissionExpectedAmount) {
    scheduleStatus = "PARTIALLY_PAID";
  }
  if (scheduleReleased >= input.schedule.commissionExpectedAmount && input.schedule.commissionExpectedAmount > 0) {
    scheduleStatus = "PAID";
  }

  return {
    releasedDelta: delta,
    newReleasedTotal,
    newRecordStatus,
    scheduleReleasedAmount: scheduleReleased,
    scheduleStatus,
  };
}

export function computeBalanceAfterRelease(commissionAmount: number, releasedAmount: number, paidAmount: number): number {
  return roundMoney(roundMoney(commissionAmount) - roundMoney(releasedAmount) - roundMoney(paidAmount));
}
