/**
 * Regras puras da consulta de CP Tesouraria (sem I/O).
 */

import type { OfficialPayableView } from "../contracts/treasuryOfficialTitleContracts.js";
import type {
  TreasuryPayableActionView,
  TreasuryPayableComplementView,
} from "../contracts/treasuryPayableContracts.js";
import type { TreasuryPayableOperationalStatus } from "../contracts/treasuryEnums.js";
import { computeTreasuryReceivableDaysOverdue } from "./treasuryReceivableQueryRules.js";

export const computeTreasuryPayableDaysOverdue =
  computeTreasuryReceivableDaysOverdue;

export function deriveTreasuryPayableOperationalStatus(input: {
  official: OfficialPayableView;
  complement: TreasuryPayableComplementView | null;
  daysOverdue: number;
}): TreasuryPayableOperationalStatus {
  if (input.official.cancellation.isCancelledOrRemovedFromSource) {
    return "CANCELLED_SOURCE";
  }
  if (
    input.complement?.status === "CANCELLED" ||
    input.complement?.cancelledAt
  ) {
    return "CANCELLED_LOCAL";
  }
  if (input.complement?.status === "ON_HOLD") {
    return "ON_HOLD";
  }
  if (!input.official.officialStatus.isOpen) {
    return "SETTLED";
  }
  const programmed =
    Boolean(input.complement?.scheduledDate) ||
    Boolean(input.complement?.scheduledAmount) ||
    Boolean(input.official.nomusScheduleDate) ||
    Boolean(input.official.nomusScheduledAmount);
  if (programmed) {
    if (input.complement?.nextAction === "AUTHORIZED") {
      return "AUTHORIZED";
    }
    return "PROGRAMMED";
  }
  if (input.daysOverdue > 0) {
    return "OVERDUE";
  }
  if (input.complement?.expectedDate) {
    return "EXPECTED";
  }
  return "OPEN";
}

export function deriveTreasuryPayableLastAction(
  complement: TreasuryPayableComplementView | null
): TreasuryPayableActionView | null {
  if (!complement) return null;
  const summary =
    complement.reason?.trim() ||
    complement.notes?.trim() ||
    (complement.cancelledAt
      ? "Complemento cancelado"
      : "Atualização operacional");
  return {
    at: complement.updatedAt,
    summary,
  };
}

export function resolveTreasuryPayableProgramming(input: {
  official: OfficialPayableView;
  complement: TreasuryPayableComplementView | null;
}): {
  scheduledDate: string | null;
  scheduledAmount: string | null;
} {
  return {
    scheduledDate:
      input.complement?.scheduledDate ?? input.official.nomusScheduleDate,
    scheduledAmount:
      input.complement?.scheduledAmount ?? input.official.nomusScheduledAmount,
  };
}
