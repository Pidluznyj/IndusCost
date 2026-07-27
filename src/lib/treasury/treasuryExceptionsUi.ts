/**
 * Helpers de UI — Central de Exceções.
 */

import type {
  TreasuryExceptionSeverity,
  TreasuryExceptionStatus,
} from "./contracts/index.js";
import {
  TREASURY_EXCEPTION_OPERATIONAL_STATUSES,
  TREASURY_EXCEPTION_SEVERITIES,
  TREASURY_EXCEPTION_STATUSES,
  TREASURY_OPEN_EXCEPTION_STATUSES,
} from "./contracts/index.js";

export const TREASURY_EXCEPTIONS_PAGE_TITLE = "Central de Exceções" as const;
export const TREASURY_EXCEPTIONS_PAGE_SUBTITLE =
  "Tratamento operacional de causas detectadas — sem ocultar divergências." as const;

/** Status canônicos da UI (6). ACK legado mapeia para "Em análise". */
export const TREASURY_EXCEPTION_STATUS_LABELS: Record<
  TreasuryExceptionStatus,
  string
> = {
  OPEN: "Aberta",
  ACK: "Em análise",
  IN_ANALYSIS: "Em análise",
  WAITING_THIRD_PARTY: "Aguardando terceiro",
  RESOLVED: "Resolvida",
  IGNORED: "Ignorada",
  CANCELLED: "Cancelada",
};

export const TREASURY_EXCEPTION_SEVERITY_LABELS: Record<
  TreasuryExceptionSeverity,
  string
> = {
  INFO: "Info",
  WARNING: "Atenção",
  CRITICAL: "Crítica",
};

export type TreasuryExceptionsFilterState = {
  status: string;
  severity: string;
  type: string;
  companyCode: string;
  responsibleUserId: string;
  search: string;
  sortBy: string;
  sortDirection: "asc" | "desc";
};

export function createEmptyTreasuryExceptionsFilters(): TreasuryExceptionsFilterState {
  return {
    status: "",
    severity: "",
    type: "",
    companyCode: "",
    responsibleUserId: "",
    search: "",
    sortBy: "detectedAt",
    sortDirection: "desc",
  };
}

export function isTreasuryExceptionStatus(
  value: string
): value is TreasuryExceptionStatus {
  return (TREASURY_EXCEPTION_STATUSES as readonly string[]).includes(value);
}

export function isTreasuryExceptionSeverity(
  value: string
): value is TreasuryExceptionSeverity {
  return (TREASURY_EXCEPTION_SEVERITIES as readonly string[]).includes(value);
}

export function isTreasuryExceptionOpenStatus(status: string): boolean {
  return (TREASURY_OPEN_EXCEPTION_STATUSES as readonly string[]).includes(
    status
  );
}

export function isTreasuryExceptionOperationalStatus(status: string): boolean {
  return (
    TREASURY_EXCEPTION_OPERATIONAL_STATUSES as readonly string[]
  ).includes(status);
}

export function resolveTreasuryExceptionsViewKind(input: {
  canView: boolean;
  loading: boolean;
  error: string | null;
  itemCount: number;
}): "denied" | "loading" | "error" | "empty" | "ready" {
  if (!input.canView) return "denied";
  if (input.loading) return "loading";
  if (input.error) return "error";
  if (input.itemCount === 0) return "empty";
  return "ready";
}

export function formatTreasuryExceptionAgeLabel(ageDays: number): string {
  if (ageDays <= 0) return "hoje";
  if (ageDays === 1) return "1 dia";
  return `${ageDays} dias`;
}
