import { isValidCnpj, normalizeCnpj } from "@/src/lib/companyCnpjFormat.js";
import type { NormalizedCnpjSummary } from "@/src/lib/companyCnpjNormalize.js";
import { CNPJ_CACHE_TTL_MS } from "@/src/lib/companyCnpjLookupConstants.js";
import { CompanyIntelligenceError } from "./errors.js";
import { createTtlMemoryCache } from "./memoryCache.js";
import { brasilApiCnpjProvider } from "./providers/brasilApiCnpjProvider.js";
import { publicaCnpjWsProvider } from "./providers/publicaCnpjWsProvider.js";
import {
  isProviderSuccess,
  type ProviderFailure,
  type ProviderOutcome,
  type ProviderSuccess,
} from "./providers/types.js";
import { buildRegistryProvenance, provenanceConflicts } from "./compareRegistrySources.js";
import {
  CNPJ_SOURCE_BRASIL_API,
  CNPJ_SOURCE_DISPLAY_NAME,
  CNPJ_SOURCE_PUBLICA,
  type CnpjCadastreSourceId,
  type CnpjFieldProvenance,
  type CnpjSourceRole,
  type CnpjSourceStatus,
} from "./registryTypes.js";

export type CachedPrimarySnapshot = {
  source: string;
  rawJson: unknown;
  summary: NormalizedCnpjSummary;
  fetchedAt: Date;
};

export type RegistryLookupResult = {
  cnpj: string;
  summary: NormalizedCnpjSummary;
  rawJson: unknown;
  winningSource: CnpjCadastreSourceId;
  registryRole: "primary" | "fallback";
  partialResult: boolean;
  fromCache: boolean;
  sources: CnpjSourceStatus[];
  provenance: CnpjFieldProvenance[];
  conflicts: CnpjFieldProvenance[];
  primary: ProviderOutcome;
  secondary: ProviderOutcome;
};

const registryCache = createTtlMemoryCache<RegistryLookupResult>(CNPJ_CACHE_TTL_MS);

export function resetCompanyIntelligenceCaches(): void {
  registryCache.clear();
}

function toSourceStatus(
  outcome: ProviderOutcome,
  role: CnpjSourceRole
): CnpjSourceStatus {
  return {
    source: outcome.source,
    displayName: CNPJ_SOURCE_DISPLAY_NAME[outcome.source] ?? outcome.source,
    role,
    status: outcome.status,
    fetchedAt: outcome.fetchedAt,
    fromCache: outcome.fromCache,
    latencyMs: outcome.latencyMs,
    message: isProviderSuccess(outcome) ? null : outcome.message,
  };
}

function cachedPrimaryOutcome(snapshot: CachedPrimarySnapshot): ProviderSuccess {
  const source =
    snapshot.source === CNPJ_SOURCE_BRASIL_API ? CNPJ_SOURCE_BRASIL_API : CNPJ_SOURCE_PUBLICA;
  return {
    status: "SUCCESS",
    source,
    fetchedAt: snapshot.fetchedAt.toISOString(),
    latencyMs: 0,
    fromCache: true,
    summary: snapshot.summary,
    rawJson: snapshot.rawJson,
  };
}

function combineFailures(primary: ProviderFailure, secondary: ProviderFailure): never {
  if (primary.status === "NOT_FOUND" && secondary.status === "NOT_FOUND") {
    throw new CompanyIntelligenceError(primary.message, "CNPJ_NOT_FOUND", 404);
  }
  if (primary.status === "TIMEOUT") {
    throw new CompanyIntelligenceError(primary.message, "TIMEOUT", 504);
  }
  if (primary.status === "RATE_LIMIT") {
    throw new CompanyIntelligenceError(primary.message, "RATE_LIMIT", 429);
  }
  if (primary.status === "NOT_FOUND") {
    throw new CompanyIntelligenceError(primary.message, "CNPJ_NOT_FOUND", 404);
  }
  if (primary.status === "INVALID_PAYLOAD") {
    throw new CompanyIntelligenceError(primary.message, "INVALID_PAYLOAD", 502);
  }
  throw new CompanyIntelligenceError(
    primary.message || "Serviço de consulta CNPJ indisponível no momento.",
    "UPSTREAM_UNAVAILABLE",
    primary.httpStatus && primary.httpStatus >= 400 ? primary.httpStatus : 502
  );
}

function logProviders(primary: ProviderOutcome, secondary: ProviderOutcome, fallback: boolean): void {
  console.info(
    `[company-intelligence] provider=${primary.source} status=${primary.status} latencyMs=${primary.latencyMs} cache=${primary.fromCache}`
  );
  console.info(
    `[company-intelligence] provider=${secondary.source} status=${secondary.status} latencyMs=${secondary.latencyMs} cache=${secondary.fromCache} fallback=${fallback}`
  );
}

export async function lookupCompanyRegistry(input: {
  cnpj: string;
  fetchImpl?: typeof fetch;
  forceRefresh?: boolean;
  primaryFromCache?: CachedPrimarySnapshot | null;
}): Promise<RegistryLookupResult> {
  const cnpj = normalizeCnpj(input.cnpj);
  if (!isValidCnpj(cnpj)) {
    throw new CompanyIntelligenceError("CNPJ inválido.", "INVALID_CNPJ", 422);
  }

  if (!input.forceRefresh) {
    const cached = registryCache.get(cnpj);
    if (cached) {
      return { ...cached, fromCache: true };
    }
  } else {
    registryCache.deleteKey(cnpj);
  }

  const primaryPromise = input.primaryFromCache
    ? Promise.resolve(cachedPrimaryOutcome(input.primaryFromCache))
    : publicaCnpjWsProvider.lookup(cnpj, input.fetchImpl);
  const secondaryPromise = brasilApiCnpjProvider.lookup(cnpj, input.fetchImpl);

  const [primary, secondary] = await Promise.all([primaryPromise, secondaryPromise]);

  const primaryOk = isProviderSuccess(primary);
  const secondaryOk = isProviderSuccess(secondary);

  if (!primaryOk && !secondaryOk) {
    logProviders(primary, secondary, false);
    combineFailures(primary, secondary);
  }

  const fallback = !primaryOk && secondaryOk;
  const winning = primaryOk ? primary : secondary;
  if (!isProviderSuccess(winning)) {
    throw new CompanyIntelligenceError(
      "Serviço de consulta CNPJ indisponível no momento.",
      "UPSTREAM_UNAVAILABLE",
      502
    );
  }

  const primarySummary = primaryOk ? primary.summary : null;
  const secondarySummary = secondaryOk ? secondary.summary : null;
  const provenance = buildRegistryProvenance(primarySummary, secondarySummary);
  const registryRole = fallback ? "fallback" : "primary";

  const result: RegistryLookupResult = {
    cnpj,
    summary: winning.summary,
    rawJson: winning.rawJson,
    winningSource: winning.source,
    registryRole,
    partialResult: !primaryOk || !secondaryOk,
    fromCache: Boolean(input.primaryFromCache) && primaryOk,
    sources: [
      toSourceStatus(primary, fallback ? "secondary" : "primary"),
      toSourceStatus(secondary, fallback ? "fallback" : "secondary"),
    ],
    provenance,
    conflicts: provenanceConflicts(provenance),
    primary,
    secondary,
  };

  logProviders(primary, secondary, fallback);
  registryCache.set(cnpj, result);
  return result;
}
