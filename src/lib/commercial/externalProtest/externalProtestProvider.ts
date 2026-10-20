/**
 * Contrato de consulta de protesto externo.
 * A regra de crédito não conhece o provedor. Este módulo não abre rede.
 */

export const EXTERNAL_PROTEST_PROVIDERS = ["disabled", "test", "cenprot", "serasa"] as const;

export type ExternalProtestProviderId = (typeof EXTERNAL_PROTEST_PROVIDERS)[number];

export const EXTERNAL_PROTEST_EXECUTIONS = [
  "DISABLED",
  "NOT_RUN",
  "SUCCESS",
  "FAILED",
  "TIMEOUT",
  "RATE_LIMITED",
  "UNAVAILABLE",
] as const;

export type ExternalProtestExecutionStatus = (typeof EXTERNAL_PROTEST_EXECUTIONS)[number];

export const EXTERNAL_PROTEST_SITUATIONS = [
  "NOT_CONSULTED",
  "NONE_FOUND",
  "CONFIRMED_CURRENT",
  "CANCELLED",
  "UNCONFIRMED",
  "STALE",
  "UNREADABLE",
] as const;

export type ExternalProtestSituation = (typeof EXTERNAL_PROTEST_SITUATIONS)[number];

export type ExternalProtestReview = "NONE" | "CANCELLED" | "UNCONFIRMED" | "STALE" | "UNAVAILABLE";

export const EXTERNAL_PROTEST_NOT_CONSULTED_DETAIL =
  "Consulta de protesto externo desabilitada ou não realizada. Isso não significa ausência de protesto.";

export type ExternalProtestConfig = {
  enabled: boolean;
  provider: ExternalProtestProviderId;
  cacheTtlMs: number;
  timeoutMs: number;
  maxRetries: number;
  rateLimitPerMinute: number;
  /** Verdadeiro quando há segredo no ambiente. O valor nunca entra neste objeto. */
  credentialsPresent: boolean;
};

export type ExternalProtestQueryRequest = {
  cnpj: string;
  signal: AbortSignal;
};

export type ExternalProtestProviderResult = {
  executionStatus: Exclude<ExternalProtestExecutionStatus, "DISABLED" | "NOT_RUN">;
  protestSituation: Exclude<ExternalProtestSituation, "NOT_CONSULTED" | "STALE">;
  occurrenceId: string | null;
  evidenceRef: string | null;
  source: string;
  errorCode: string | null;
};

export interface ExternalProtestProvider {
  id: ExternalProtestProviderId;
  consult(request: ExternalProtestQueryRequest): Promise<ExternalProtestProviderResult>;
}

export type ExternalProtestCreditFact = {
  enabled: boolean;
  executionStatus: ExternalProtestExecutionStatus;
  protestSituation: ExternalProtestSituation;
  fresh: boolean;
  reliableClear: boolean;
  confirmedCurrent: boolean;
  review: ExternalProtestReview;
  source: string | null;
  consultedAt: string | null;
  validUntil: string | null;
  occurrenceId: string | null;
  evidenceRef: string | null;
};

const HOUR_MS = 60 * 60 * 1000;

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

export function readExternalProtestConfig(env: Record<string, string | undefined>): ExternalProtestConfig {
  const requested = (env.EXTERNAL_PROTEST_PROVIDER ?? "disabled").trim().toLowerCase();
  const provider = (EXTERNAL_PROTEST_PROVIDERS as readonly string[]).includes(requested)
    ? (requested as ExternalProtestProviderId)
    : "disabled";
  const enabledFlag = env.EXTERNAL_PROTEST_ENABLED === "true" || env.EXTERNAL_PROTEST_ENABLED === "1";
  const enabled = enabledFlag && provider !== "disabled";
  return {
    enabled,
    provider: enabled ? provider : "disabled",
    cacheTtlMs: clamp(Number(env.EXTERNAL_PROTEST_CACHE_TTL_HOURS), 1, 168, 24) * HOUR_MS,
    timeoutMs: clamp(Number(env.EXTERNAL_PROTEST_TIMEOUT_MS), 1000, 30_000, 8000),
    maxRetries: clamp(Number(env.EXTERNAL_PROTEST_MAX_RETRIES), 0, 2, 1),
    rateLimitPerMinute: clamp(Number(env.EXTERNAL_PROTEST_RATE_LIMIT_PER_MINUTE), 1, 60, 10),
    credentialsPresent: Boolean(
      env.EXTERNAL_PROTEST_API_TOKEN?.trim() ||
        env.EXTERNAL_PROTEST_API_CLIENT_ID?.trim() ||
        env.EXTERNAL_PROTEST_API_CLIENT_SECRET?.trim()
    ),
  };
}

export function disabledExternalProtestFact(): ExternalProtestCreditFact {
  return {
    enabled: false,
    executionStatus: "DISABLED",
    protestSituation: "NOT_CONSULTED",
    fresh: false,
    reliableClear: false,
    confirmedCurrent: false,
    review: "NONE",
    source: null,
    consultedAt: null,
    validUntil: null,
    occurrenceId: null,
    evidenceRef: null,
  };
}

export function unavailableExternalProtestFact(errorCode: string): ExternalProtestCreditFact {
  return {
    enabled: true,
    executionStatus: "UNAVAILABLE",
    protestSituation: "UNREADABLE",
    fresh: false,
    reliableClear: false,
    confirmedCurrent: false,
    review: "UNAVAILABLE",
    source: errorCode,
    consultedAt: null,
    validUntil: null,
    occurrenceId: null,
    evidenceRef: null,
  };
}

/** Falha, timeout ou resposta ilegível nunca viram "sem protesto" nem protesto confirmado. */
export function sanitizeProviderResult(result: ExternalProtestProviderResult): ExternalProtestProviderResult {
  if (result.executionStatus === "SUCCESS") return result;
  if (result.protestSituation === "NONE_FOUND" || result.protestSituation === "CONFIRMED_CURRENT") {
    return { ...result, protestSituation: "UNREADABLE" };
  }
  return result;
}

export function classifyExternalProtestCredit(input: {
  enabled: boolean;
  executionStatus: ExternalProtestExecutionStatus;
  protestSituation: ExternalProtestSituation;
  consultedAt: Date | null;
  validUntil: Date | null;
  now: Date;
  source?: string | null;
  occurrenceId?: string | null;
  evidenceRef?: string | null;
}): ExternalProtestCreditFact {
  const base = {
    enabled: input.enabled,
    source: input.source ?? null,
    consultedAt: input.consultedAt?.toISOString() ?? null,
    validUntil: input.validUntil?.toISOString() ?? null,
    occurrenceId: input.occurrenceId ?? null,
    evidenceRef: input.evidenceRef ?? null,
  };
  if (!input.enabled || input.executionStatus === "DISABLED") {
    return disabledExternalProtestFact();
  }
  const fresh =
    input.executionStatus === "SUCCESS" &&
    input.consultedAt != null &&
    input.validUntil != null &&
    input.validUntil.getTime() > input.now.getTime();
  if (!fresh) {
    const review: ExternalProtestReview =
      input.executionStatus === "SUCCESS" ? "STALE" : "UNAVAILABLE";
    return {
      ...base,
      enabled: true,
      executionStatus: input.executionStatus === "SUCCESS" ? "SUCCESS" : input.executionStatus,
      protestSituation: input.executionStatus === "SUCCESS" ? "STALE" : "UNREADABLE",
      fresh: false,
      reliableClear: false,
      confirmedCurrent: false,
      review,
    };
  }
  if (input.protestSituation === "CONFIRMED_CURRENT") {
    return {
      ...base,
      enabled: true,
      executionStatus: "SUCCESS",
      protestSituation: "CONFIRMED_CURRENT",
      fresh: true,
      reliableClear: false,
      confirmedCurrent: true,
      review: "NONE",
    };
  }
  if (input.protestSituation === "NONE_FOUND") {
    return {
      ...base,
      enabled: true,
      executionStatus: "SUCCESS",
      protestSituation: "NONE_FOUND",
      fresh: true,
      reliableClear: true,
      confirmedCurrent: false,
      review: "NONE",
    };
  }
  const review: ExternalProtestReview =
    input.protestSituation === "CANCELLED"
      ? "CANCELLED"
      : input.protestSituation === "UNCONFIRMED"
        ? "UNCONFIRMED"
        : "UNAVAILABLE";
  return {
    ...base,
    enabled: true,
    executionStatus: "SUCCESS",
    protestSituation: input.protestSituation === "NOT_CONSULTED" ? "UNREADABLE" : input.protestSituation,
    fresh: true,
    reliableClear: false,
    confirmedCurrent: false,
    review,
  };
}

export function createExternalProtestProvider(
  config: ExternalProtestConfig,
  scripted?: ExternalProtestProvider | null
): ExternalProtestProvider {
  if (!config.enabled || config.provider === "disabled") {
    return {
      id: "disabled",
      consult: async () => {
        throw new Error("Provedor de protesto externo está desabilitado.");
      },
    };
  }
  if (config.provider === "test") {
    return (
      scripted ?? {
        id: "test",
        consult: async () => ({
          executionStatus: "UNAVAILABLE",
          protestSituation: "UNREADABLE",
          occurrenceId: null,
          evidenceRef: null,
          source: "test",
          errorCode: "TEST_ADAPTER_UNCONFIGURED",
        }),
      }
    );
  }
  return {
    id: config.provider,
    consult: async () => ({
      executionStatus: "UNAVAILABLE",
      protestSituation: "UNREADABLE",
      occurrenceId: null,
      evidenceRef: null,
      source: config.provider,
      errorCode: "PROVIDER_NOT_CONTRACTED",
    }),
  };
}
