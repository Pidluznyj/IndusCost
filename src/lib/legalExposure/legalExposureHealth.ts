/**
 * Política única de frescor. Números não ficam espalhados nos runners.
 */

import type {
  LegalExposureSource,
  LegalQueryOutcome,
  LegalSourceConnectionStatus,
} from "./legalExposureContracts.js";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const SOURCE_FRESHNESS_POLICY: Record<
  LegalExposureSource,
  { healthyMaxMs: number; staleAfterMs: number }
> = {
  DOMICILIO: { healthyMaxMs: 30 * MINUTE, staleAfterMs: HOUR },
  DATAJUD: { healthyMaxMs: 2 * HOUR, staleAfterMs: 4 * HOUR },
  DJEN: { healthyMaxMs: HOUR, staleAfterMs: 2 * HOUR },
  TRT_CERTIFICATE: { healthyMaxMs: 30 * DAY, staleAfterMs: 45 * DAY },
  CNDT: { healthyMaxMs: 30 * DAY, staleAfterMs: 45 * DAY },
};

export const RECOMMENDED_SYNC_SCHEDULE = {
  domicilioMinutes: 15,
  domicilioKnownCasesMinutes: 60,
  djenMinutes: 60,
  datajudDiscoveryHours: 4,
  datajudKnownCasesHours: 2,
  healthMinutes: 15,
} as const;

export function freshnessFromAge(
  source: LegalExposureSource,
  ageMs: number
): "HEALTHY" | "DEGRADED" | "STALE" {
  const policy = SOURCE_FRESHNESS_POLICY[source];
  if (ageMs <= policy.healthyMaxMs) return "HEALTHY";
  if (ageMs <= policy.staleAfterMs) return "DEGRADED";
  return "STALE";
}

export function statusFromQueryOutcome(outcome: LegalQueryOutcome): LegalSourceConnectionStatus {
  switch (outcome) {
    case "SUCCESS":
    case "PARTIAL":
    case "NO_RESULTS":
      return "HEALTHY";
    case "AUTH_ERROR":
      return "AUTH_ERROR";
    case "RATE_LIMITED":
      return "RATE_LIMITED";
    case "CONFIGURATION_ERROR":
      return "CONFIGURATION_ERROR";
    case "TIMEOUT":
    case "SOURCE_ERROR":
    case "INVALID_RESPONSE":
      return "SOURCE_ERROR";
    default:
      return "SOURCE_ERROR";
  }
}

export function resolveSourceHealth(input: {
  source: LegalExposureSource;
  configured: boolean;
  enabled: boolean;
  now: Date;
  lastAttemptAt: Date | null;
  lastSuccessfulAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorCode: string | null;
}): LegalSourceConnectionStatus {
  if (!input.configured) return "NOT_CONFIGURED";
  if (!input.enabled) return "DISABLED";

  const errorIsCurrent =
    input.lastErrorAt != null &&
    (input.lastSuccessfulAt == null || input.lastErrorAt.getTime() > input.lastSuccessfulAt.getTime());

  if (errorIsCurrent) {
    return statusFromQueryOutcome(outcomeFromErrorCode(input.lastErrorCode));
  }

  if (!input.lastSuccessfulAt) {
    return input.lastAttemptAt ? "SOURCE_ERROR" : "NOT_CONFIGURED";
  }

  return freshnessFromAge(input.source, input.now.getTime() - input.lastSuccessfulAt.getTime());
}

function outcomeFromErrorCode(code: string | null): LegalQueryOutcome {
  switch (code) {
    case "AUTH_ERROR":
    case "RATE_LIMITED":
    case "CONFIGURATION_ERROR":
    case "TIMEOUT":
    case "INVALID_RESPONSE":
    case "SOURCE_ERROR":
      return code;
    default:
      return "SOURCE_ERROR";
  }
}

export function isCriticalMonitoringSource(source: LegalExposureSource): boolean {
  return source === "DOMICILIO" || source === "DATAJUD" || source === "DJEN";
}
