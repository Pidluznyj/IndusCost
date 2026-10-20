/**
 * Execução da consulta: cache, timeout, retry e rate limit.
 * Não escolhe bloqueio comercial e não chama provedor quando a integração está desligada.
 */

import { createHash, randomUUID } from "node:crypto";
import { isValidCnpj, normalizeCnpj } from "@/src/lib/companyCnpjFormat.js";
import {
  classifyExternalProtestCredit,
  disabledExternalProtestFact,
  sanitizeProviderResult,
  type ExternalProtestConfig,
  type ExternalProtestCreditFact,
  type ExternalProtestExecutionStatus,
  type ExternalProtestProvider,
  type ExternalProtestProviderResult,
  type ExternalProtestSituation,
} from "./externalProtestProvider.js";

const FAILURE_CACHE_MAX_MS = 15 * 60 * 1000;
const RETRYABLE_CODES = new Set(["TIMEOUT", "UNAVAILABLE"]);
const COUNTED_EXECUTIONS = new Set<ExternalProtestExecutionStatus>([
  "SUCCESS",
  "FAILED",
  "TIMEOUT",
  "UNAVAILABLE",
]);

export type ExternalProtestCacheRow = {
  id: string;
  customerId: string | null;
  cnpj: string;
  provider: string;
  executionStatus: ExternalProtestExecutionStatus;
  protestSituation: ExternalProtestSituation;
  occurrenceId: string | null;
  evidenceRef: string | null;
  source: string;
  consultedAt: Date;
  validUntil: Date;
  errorCode: string | null;
};

export type ExternalProtestCache = {
  findFresh(cnpj: string, now: Date): Promise<ExternalProtestCacheRow | null>;
  countAttempts(provider: string, since: Date): Promise<number>;
  insert(row: ExternalProtestCacheRow): Promise<void>;
};

export type ExternalProtestAuditEntry = {
  entityType: string;
  entityId: string;
  action: string;
  fieldName?: string | null;
  newValue?: string | null;
  performedBy?: string | null;
};

function evidenceRef(input: {
  provider: string;
  cnpj: string;
  consultedAt: string;
  executionStatus: string;
  protestSituation: string;
  occurrenceId: string | null;
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function fromCache(row: ExternalProtestCacheRow, now: Date): ExternalProtestCreditFact {
  return classifyExternalProtestCredit({
    enabled: true,
    executionStatus: row.executionStatus,
    protestSituation: row.protestSituation,
    consultedAt: row.consultedAt,
    validUntil: row.validUntil,
    now,
    source: row.source,
    occurrenceId: row.occurrenceId,
    evidenceRef: row.evidenceRef,
  });
}

async function withTimeout(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<ExternalProtestProviderResult>
): Promise<ExternalProtestProviderResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(Object.assign(new Error("timeout"), { code: "TIMEOUT" }));
    }, timeoutMs);
  });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function failureResult(executionStatus: ExternalProtestProviderResult["executionStatus"], errorCode: string): ExternalProtestProviderResult {
  return {
    executionStatus,
    protestSituation: "UNREADABLE",
    occurrenceId: null,
    evidenceRef: null,
    source: "induscost",
    errorCode,
  };
}

function isRetryable(result: ExternalProtestProviderResult): boolean {
  if (result.errorCode === "PROVIDER_NOT_CONTRACTED" || result.errorCode === "TEST_ADAPTER_UNCONFIGURED") return false;
  return RETRYABLE_CODES.has(result.executionStatus);
}

export async function executeExternalProtestConsultation(input: {
  cnpj: string | null;
  customerId: string | null;
  now: Date;
  config: ExternalProtestConfig;
  provider: ExternalProtestProvider;
  cache: ExternalProtestCache;
  sleep?: (ms: number) => Promise<void>;
  audit?: (entry: ExternalProtestAuditEntry) => Promise<void>;
}): Promise<ExternalProtestCreditFact> {
  if (!input.config.enabled) return disabledExternalProtestFact();

  const cnpj = normalizeCnpj(input.cnpj);
  if (!isValidCnpj(cnpj)) {
    const fact = classifyExternalProtestCredit({
      enabled: true,
      executionStatus: "FAILED",
      protestSituation: "UNREADABLE",
      consultedAt: input.now,
      validUntil: new Date(input.now.getTime() + FAILURE_CACHE_MAX_MS),
      now: input.now,
      source: input.config.provider,
      evidenceRef: null,
    });
    fact.fresh = false;
    fact.reliableClear = false;
    fact.confirmedCurrent = false;
    fact.review = "UNAVAILABLE";
    fact.protestSituation = "UNREADABLE";
    return fact;
  }

  const fresh = await input.cache.findFresh(cnpj, input.now);
  if (fresh && fresh.validUntil.getTime() > input.now.getTime()) {
    const cached = fromCache(fresh, input.now);
    if (cached.executionStatus !== "SUCCESS") {
      cached.reliableClear = false;
      cached.confirmedCurrent = false;
      cached.review = "UNAVAILABLE";
      cached.protestSituation = "UNREADABLE";
    }
    return cached;
  }

  const since = new Date(input.now.getTime() - 60_000);
  const attempts = await input.cache.countAttempts(input.config.provider, since);
  if (attempts >= input.config.rateLimitPerMinute) {
    return classifyExternalProtestCredit({
      enabled: true,
      executionStatus: "RATE_LIMITED",
      protestSituation: "UNREADABLE",
      consultedAt: input.now,
      validUntil: new Date(input.now.getTime() + 60_000),
      now: input.now,
      source: input.config.provider,
    });
  }

  const sleep = input.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  let result = failureResult("UNAVAILABLE", "NOT_RUN");
  const tries = input.config.maxRetries + 1;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try {
      result = sanitizeProviderResult(
        await withTimeout(input.config.timeoutMs, (signal) => input.provider.consult({ cnpj, signal }))
      );
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
      result = failureResult(code === "TIMEOUT" ? "TIMEOUT" : "UNAVAILABLE", code || "PROVIDER_ERROR");
    }
    if (!isRetryable(result) || attempt === tries - 1) break;
    await sleep(Math.min(1000, 250 * 2 ** attempt));
  }

  const consultedAt = input.now;
  const ttl = result.executionStatus === "SUCCESS" ? input.config.cacheTtlMs : Math.min(input.config.cacheTtlMs, FAILURE_CACHE_MAX_MS);
  const validUntil = new Date(consultedAt.getTime() + ttl);
  const row: ExternalProtestCacheRow = {
    id: randomUUID(),
    customerId: input.customerId,
    cnpj,
    provider: input.config.provider,
    executionStatus: result.executionStatus,
    protestSituation: result.executionStatus === "SUCCESS" ? result.protestSituation : "UNREADABLE",
    occurrenceId: result.occurrenceId,
    evidenceRef:
      result.evidenceRef ??
      evidenceRef({
        provider: input.config.provider,
        cnpj,
        consultedAt: consultedAt.toISOString(),
        executionStatus: result.executionStatus,
        protestSituation: result.protestSituation,
        occurrenceId: result.occurrenceId,
      }),
    source: result.source,
    consultedAt,
    validUntil,
    errorCode: result.errorCode,
  };
  if (COUNTED_EXECUTIONS.has(row.executionStatus)) await input.cache.insert(row);
  if (input.audit) {
    await input.audit({
      entityType: "CommercialExternalProtestConsultation",
      entityId: row.id,
      action: "CONSULT",
      fieldName: row.executionStatus,
      newValue: JSON.stringify({
        provider: row.provider,
        executionStatus: row.executionStatus,
        protestSituation: row.protestSituation,
        occurrenceId: row.occurrenceId,
        evidenceRef: row.evidenceRef,
        source: row.source,
        customerId: row.customerId,
      }),
      performedBy: null,
    });
  }
  return fromCache(row, input.now);
}
