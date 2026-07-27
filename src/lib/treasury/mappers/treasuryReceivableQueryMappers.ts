/**
 * Monta DTO de listagem CR: oficial + complemento + campos calculados.
 */

import type { OfficialReceivableView } from "../contracts/treasuryOfficialTitleContracts.js";
import type {
  TreasuryReceivableComplementView,
  TreasuryReceivableListItemDto,
} from "../contracts/treasuryReceivableContracts.js";
import { formatTreasuryTimestampIso } from "../contracts/treasuryTimestamp.js";
import { toCivilDateKey } from "@/src/lib/financeCivilDate.js";
import { normalizeTreasuryMoneyString } from "../treasuryMoney.js";
import {
  computeTreasuryReceivableDaysOverdue,
  deriveTreasuryReceivableLastAction,
  deriveTreasuryReceivableOperationalStatus,
} from "../domain/treasuryReceivableQueryRules.js";
import type { TreasuryTitleOperationalComplementRow } from "./treasuryTitleOperationalComplementMappers.js";
import { extractSellerFieldsFromNomusRaw } from "./treasuryOfficialTitleMappers.js";

function moneyOrNull(
  value: TreasuryTitleOperationalComplementRow["expectedAmount"]
): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "string") return normalizeTreasuryMoneyString(value);
  return normalizeTreasuryMoneyString(value.toFixed(2));
}

export function toTreasuryReceivableComplementView(
  row: TreasuryTitleOperationalComplementRow
): TreasuryReceivableComplementView {
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

export function toTreasuryReceivableListItemDto(input: {
  official: OfficialReceivableView;
  complement: TreasuryReceivableComplementView | null;
  rawPayload?: unknown;
  referenceDate?: Date;
}): TreasuryReceivableListItemDto {
  const sellers = extractSellerFieldsFromNomusRaw(input.rawPayload);
  const openAmount = input.official.openBalance;
  const receivedAmount = input.official.settlements.settledAmount;
  const daysOverdue = computeTreasuryReceivableDaysOverdue({
    dueDate: input.official.dueDate,
    openAmount,
    referenceDate: input.referenceDate,
  });
  const operationalStatus = deriveTreasuryReceivableOperationalStatus({
    official: input.official,
    complement: input.complement,
    daysOverdue,
  });

  return {
    titleId: input.official.id,
    externalId: input.official.externalId,
    official: input.official,
    complement: input.complement,
    sellerName: sellers.sellerName,
    commercialOwnerName: sellers.commercialOwnerName,
    openAmount,
    receivedAmount,
    daysOverdue,
    operationalStatus,
    lastAction: deriveTreasuryReceivableLastAction(input.complement),
    nextAction: input.complement?.nextAction ?? null,
  };
}
