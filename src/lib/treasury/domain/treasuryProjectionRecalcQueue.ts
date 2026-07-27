/**
 * Regras puras da fila de recálculo de projeção (PostgreSQL / sem broker).
 */

import type {
  TreasuryProjectionRecalcEventType,
  TreasuryProjectionRecalcJobStatus,
  TreasuryProjectionScenario,
} from "../contracts/treasuryEnums.js";

export const TREASURY_PROJECTION_RECALC_ACTIVE_STATUSES = [
  "PENDING",
  "LOCKED",
  "PROCESSING",
] as const satisfies readonly TreasuryProjectionRecalcJobStatus[];

export const TREASURY_PROJECTION_RECALC_DEFAULT_MAX_ATTEMPTS = 5;

/** Eventos company-wide: subject canônico "*". */
export const TREASURY_PROJECTION_RECALC_COMPANY_WIDE_EVENTS = [
  "AR_SYNC",
  "AP_SYNC",
  "CLOSING",
  "REOPENING",
] as const satisfies readonly TreasuryProjectionRecalcEventType[];

export function isTreasuryProjectionRecalcCompanyWideEvent(
  eventType: TreasuryProjectionRecalcEventType
): boolean {
  return (
    TREASURY_PROJECTION_RECALC_COMPANY_WIDE_EVENTS as readonly string[]
  ).includes(eventType);
}

export function normalizeTreasuryProjectionRecalcSubjectId(
  eventType: TreasuryProjectionRecalcEventType,
  subjectId?: string | null
): string {
  if (isTreasuryProjectionRecalcCompanyWideEvent(eventType)) return "*";
  const trimmed = subjectId?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "*";
}

/**
 * Chave estável: empresa|cenário|evento|sujeito.
 * Eventos equivalentes (mesmo escopo) colapsam enquanto o job estiver ativo.
 */
export function buildTreasuryProjectionRecalcDeduplicationKey(input: {
  companyCode: string;
  scenario: TreasuryProjectionScenario;
  eventType: TreasuryProjectionRecalcEventType;
  subjectId?: string | null;
}): string {
  const company = input.companyCode.trim().toUpperCase();
  const subject = normalizeTreasuryProjectionRecalcSubjectId(
    input.eventType,
    input.subjectId
  );
  return [company, input.scenario, input.eventType, subject].join("|");
}

/** Backoff exponencial após falha: 5s, 10s, 20s… cap 5min. */
export function computeTreasuryProjectionRecalcBackoffMs(
  attempts: number
): number {
  const safe = Math.max(1, Math.floor(attempts));
  const base = 5_000 * 2 ** (safe - 1);
  return Math.min(base, 300_000);
}

export function computeTreasuryProjectionRecalcAvailableAt(
  now: Date,
  attempts: number
): Date {
  return new Date(
    now.getTime() + computeTreasuryProjectionRecalcBackoffMs(attempts)
  );
}
