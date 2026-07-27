/**
 * Monta DTO de listagem CP: oficial + complemento + CC + campos calculados.
 */

import type { OfficialPayableView } from "../contracts/treasuryOfficialTitleContracts.js";
import type {
  TreasuryPayableComplementView,
  TreasuryPayableListItemDto,
} from "../contracts/treasuryPayableContracts.js";
import { formatTreasuryTimestampIso } from "../contracts/treasuryTimestamp.js";
import { toCivilDateKey } from "@/src/lib/financeCivilDate.js";
import { normalizeTreasuryMoneyString } from "../treasuryMoney.js";
import {
  computeTreasuryPayableDaysOverdue,
  deriveTreasuryPayableLastAction,
  deriveTreasuryPayableOperationalStatus,
  resolveTreasuryPayableProgramming,
} from "../domain/treasuryPayableQueryRules.js";
import type { TreasuryTitleOperationalComplementRow } from "./treasuryTitleOperationalComplementMappers.js";

function moneyOrNull(
  value: TreasuryTitleOperationalComplementRow["expectedAmount"]
): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "string") return normalizeTreasuryMoneyString(value);
  return normalizeTreasuryMoneyString(value.toFixed(2));
}

export type TreasuryPayableCostCenterProjection = {
  costCenterId: string | null;
  costCenterLabel: string | null;
};

export function toTreasuryPayableComplementView(
  row: TreasuryTitleOperationalComplementRow
): TreasuryPayableComplementView {
  return {
    id: row.id,
    expectedDate: toCivilDateKey(row.expectedDate),
    confirmedDate: toCivilDateKey(row.confirmedDate),
    scheduledDate: toCivilDateKey(row.scheduledDate),
    expectedAmount: moneyOrNull(row.expectedAmount),
    confirmedAmount: moneyOrNull(row.confirmedAmount),
    scheduledAmount: moneyOrNull(row.scheduledAmount),
    status: row.status,
    priority: row.priority,
    plannedAccountId: row.plannedAccountId,
    responsibleUserId: row.responsibleUserId,
    nextAction: row.nextAction,
    reason: row.reason,
    notes: row.notes,
    version: row.version,
    updatedAt: formatTreasuryTimestampIso(row.updatedAt),
    cancelledAt: row.cancelledAt
      ? formatTreasuryTimestampIso(row.cancelledAt)
      : null,
  };
}

export function toTreasuryPayableListItemDto(input: {
  official: OfficialPayableView;
  complement: TreasuryPayableComplementView | null;
  costCenter?: TreasuryPayableCostCenterProjection | null;
  referenceDate?: Date;
}): TreasuryPayableListItemDto {
  const openAmount = input.official.openBalance;
  const paidAmount = input.official.settlements.settledAmount;
  const daysOverdue = computeTreasuryPayableDaysOverdue({
    dueDate: input.official.dueDate,
    openAmount,
    referenceDate: input.referenceDate,
  });
  const operationalStatus = deriveTreasuryPayableOperationalStatus({
    official: input.official,
    complement: input.complement,
    daysOverdue,
  });
  const programming = resolveTreasuryPayableProgramming({
    official: input.official,
    complement: input.complement,
  });
  const notes =
    input.complement?.notes?.trim() ||
    input.official.comments?.trim() ||
    null;

  return {
    titleId: input.official.id,
    externalId: input.official.externalId,
    official: input.official,
    complement: input.complement,
    classification: input.official.classification,
    costCenterId: input.costCenter?.costCenterId ?? null,
    costCenterLabel: input.costCenter?.costCenterLabel ?? null,
    openAmount,
    paidAmount,
    scheduledDate: programming.scheduledDate,
    scheduledAmount: programming.scheduledAmount,
    plannedAccountId: input.complement?.plannedAccountId ?? null,
    priority: input.complement?.priority ?? null,
    notes,
    daysOverdue,
    operationalStatus,
    lastAction: deriveTreasuryPayableLastAction(input.complement),
    nextAction: input.complement?.nextAction ?? null,
  };
}
