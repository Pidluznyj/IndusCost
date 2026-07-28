/**
 * Regras puras da consulta de CR Tesouraria (sem I/O).
 */

import { diffCivilDays, toCivilDateKey } from "@/src/lib/financeCivilDate.js";
import { todayTreasuryCivilDateInSaoPaulo } from "../contracts/treasuryCivilDate.js";
import type { OfficialReceivableView } from "../contracts/treasuryOfficialTitleContracts.js";
import type {
  TreasuryReceivableActionView,
  TreasuryReceivableComplementView,
} from "../contracts/treasuryReceivableContracts.js";
import type { TreasuryReceivableOperationalStatus } from "../contracts/treasuryEnums.js";

export function computeTreasuryReceivableDaysOverdue(input: {
  dueDate: string | null;
  openAmount: string | null;
  /** Instantâneo ou DATE; omitir = "hoje" America/Sao_Paulo. */
  referenceDate?: Date;
  /** Preferível quando a referência já é civil YYYY-MM-DD. */
  referenceCivilDate?: string;
}): number {
  if (!input.dueDate) return 0;
  const open = Number(input.openAmount ?? 0);
  if (!Number.isFinite(open) || open <= 0) return 0;
  const todayKey =
    input.referenceCivilDate?.trim() ||
    (input.referenceDate
      ? toCivilDateKey(input.referenceDate)
      : todayTreasuryCivilDateInSaoPaulo());
  if (!todayKey) return 0;
  const days = diffCivilDays(input.dueDate, todayKey);
  return days > 0 ? days : 0;
}

export function deriveTreasuryReceivableOperationalStatus(input: {
  official: OfficialReceivableView;
  complement: TreasuryReceivableComplementView | null;
  daysOverdue: number;
  /** Promessa ACTIVE/PARTIALLY_FULFILLED (ou proxy legado confirmed*). */
  hasActivePromise?: boolean;
}): TreasuryReceivableOperationalStatus {
  if (input.official.cancellation.isCancelledOrRemovedFromSource) {
    return "CANCELLED_SOURCE";
  }
  if (input.complement?.status === "CANCELLED" || input.complement?.cancelledAt) {
    return "CANCELLED_LOCAL";
  }
  if (input.complement?.status === "ON_HOLD") {
    return "ON_HOLD";
  }
  if (!input.official.officialStatus.isOpen) {
    return "SETTLED";
  }
  if (
    input.hasActivePromise ||
    input.complement?.confirmedDate ||
    input.complement?.confirmedAmount
  ) {
    return "PROMISED";
  }
  if (input.daysOverdue > 0) {
    return "OVERDUE";
  }
  if (input.complement?.expectedDate) {
    return "EXPECTED";
  }
  return "OPEN";
}

export function deriveTreasuryReceivableLastAction(
  complement: TreasuryReceivableComplementView | null
): TreasuryReceivableActionView | null {
  if (!complement) return null;
  const summary =
    complement.reason?.trim() ||
    complement.notes?.trim() ||
    (complement.cancelledAt ? "Complemento cancelado" : "Atualização operacional");
  return {
    at: complement.updatedAt,
    summary,
  };
}

export function normalizeTaxIdDigits(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/\D+/g, "");
}

export function matchesTaxIdFilter(
  personCnpj: string | null | undefined,
  filter: string
): boolean {
  const needle = normalizeTaxIdDigits(filter);
  if (!needle) return true;
  return normalizeTaxIdDigits(personCnpj).includes(needle);
}
