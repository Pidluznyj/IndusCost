/**
 * Regras puras de segurança da Tesouraria (sem Express/Prisma/fs).
 * Rate limit, sanitização de logs, redaction de JSON, path containment.
 */

import { TreasuryDomainError } from "./treasuryErrors.js";

/** Janela padrão para ações críticas (ms). */
export const TREASURY_CRITICAL_RATE_WINDOW_MS = 60_000;

export const TREASURY_CRITICAL_RATE_LIMITS = {
  ofxPreview: 10,
  ofxApply: 5,
  reconciliationReverse: 10,
  dailyClose: 10,
  dailyReopen: 10,
  reportExport: 30,
} as const;

export type TreasuryCriticalRateAction =
  keyof typeof TREASURY_CRITICAL_RATE_LIMITS;

const SENSITIVE_LOG_RE =
  /(password|senha|secret|token|authorization|cookie|ofx|payload|fingerprint|accountNumber|agency|previewToken|idempotency|rawPayload|normalizedPayload)/i;

/**
 * Sliding window em memória — testável e fail-closed.
 * Retorna true se a chamada é permitida.
 */
export function checkTreasurySlidingWindowRateLimit(input: {
  timestampsMs: number[];
  nowMs: number;
  limit: number;
  windowMs: number;
}): { allowed: boolean; nextTimestampsMs: number[]; retryAfterMs: number } {
  const windowStart = input.nowMs - input.windowMs;
  const kept = input.timestampsMs.filter((t) => t > windowStart);
  if (kept.length >= input.limit) {
    const oldest = kept[0] ?? input.nowMs;
    const retryAfterMs = Math.max(0, oldest + input.windowMs - input.nowMs);
    return { allowed: false, nextTimestampsMs: kept, retryAfterMs };
  }
  return {
    allowed: true,
    nextTimestampsMs: [...kept, input.nowMs],
    retryAfterMs: 0,
  };
}

export function assertTreasuryRateLimitAllowed(allowed: boolean): void {
  if (!allowed) {
    throw new TreasuryDomainError(
      "RATE_LIMITED",
      "Muitas tentativas. Aguarde um momento e tente novamente."
    );
  }
}

/** Remove / mascara campos sensíveis de objetos para logs. */
export function sanitizeTreasuryLogValue(
  value: unknown,
  depth = 0
): unknown {
  if (depth > 4) return "[Truncated]";
  if (value == null) return value;
  if (typeof value === "string") {
    if (value.length > 500) return `${value.slice(0, 120)}…[redacted]`;
    if (SENSITIVE_LOG_RE.test(value) && value.length > 24) {
      return "[redacted]";
    }
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeTreasuryLogMessage(value.message),
    };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((v) => sanitizeTreasuryLogValue(v, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_LOG_RE.test(k)) {
        out[k] = "[redacted]";
        continue;
      }
      out[k] = sanitizeTreasuryLogValue(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

export function sanitizeTreasuryLogMessage(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length > 400) return `${trimmed.slice(0, 200)}…[redacted]`;
  // Evita ecoar tokens/base64 longos.
  return trimmed.replace(
    /[A-Za-z0-9_-]{40,}/g,
    (m) => `${m.slice(0, 8)}…[redacted]`
  );
}

/** Remove chaves perigosas de summaryJson antes de expor na API. */
export function redactTreasuryBankSummaryJson(
  value: unknown
): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_LOG_RE.test(k)) continue;
    if (typeof v === "string" && v.length > 2000) continue;
    if (typeof v === "object" && v != null) {
      // Não aninha payloads brutos.
      if (Array.isArray(v)) {
        out[k] = v.length;
        continue;
      }
      const nested = redactTreasuryBankSummaryJson(v);
      if (nested) out[k] = nested;
      continue;
    }
    out[k] = v;
  }
  return out;
}

/**
 * Garante que `candidatePath` está contido em `rootDir` (anti path traversal).
 * Paths devem estar já resolvidos (absolute).
 */
export function assertTreasuryPathInsideRoot(
  rootDir: string,
  candidatePath: string
): void {
  const root = rootDir.replace(/\\/g, "/").replace(/\/+$/, "");
  const candidate = candidatePath.replace(/\\/g, "/");
  if (candidate === root) return;
  if (!candidate.startsWith(`${root}/`)) {
    throw new TreasuryDomainError(
      "FORBIDDEN",
      "Caminho de arquivo temporário fora da área permitida.",
      "file"
    );
  }
  if (candidate.includes("/../") || candidate.endsWith("/..")) {
    throw new TreasuryDomainError(
      "FORBIDDEN",
      "Caminho de arquivo temporário inválido.",
      "file"
    );
  }
}

/** Produção exige segredo dedicado (ou SESSION_SECRET). */
export function resolveTreasuryOfxPreviewSecret(env: {
  NODE_ENV?: string;
  TREASURY_OFX_PREVIEW_TOKEN_SECRET?: string;
  SESSION_SECRET?: string;
}): string {
  const dedicated = env.TREASURY_OFX_PREVIEW_TOKEN_SECRET?.trim();
  if (dedicated) return dedicated;
  const session = env.SESSION_SECRET?.trim();
  if (session) return session;
  const isProd =
    (env.NODE_ENV ?? "").trim().toLowerCase() === "production";
  if (isProd) {
    throw new TreasuryDomainError(
      "FEATURE_DISABLED",
      "Segredo de preview OFX não configurado (TREASURY_OFX_PREVIEW_TOKEN_SECRET ou SESSION_SECRET)."
    );
  }
  return "induscost-treasury-ofx-preview-dev-secret";
}

/**
 * CSRF: arquitetura atual usa cookie de sessão `SameSite=Lax` + auth por sessão.
 * Mutações cross-site clássicas ficam bloqueadas pelo browser; não há token CSRF dedicado.
 */
export const TREASURY_CSRF_ARCHITECTURE_NOTE =
  "Session cookie SameSite=Lax; mutações exigem sessão autenticada (requireAppAuth)." as const;
