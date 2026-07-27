/**
 * Rate limit em memória para ações críticas da Tesouraria.
 * Fail-closed: excede → 429 RATE_LIMITED.
 */

import type { RequestHandler } from "express";
import {
  TREASURY_CRITICAL_RATE_LIMITS,
  TREASURY_CRITICAL_RATE_WINDOW_MS,
  assertTreasuryRateLimitAllowed,
  checkTreasurySlidingWindowRateLimit,
  type TreasuryCriticalRateAction,
} from "./domain/treasurySecurityRules.js";
import {
  handleTreasuryRouteError,
  resolveTreasuryRequestId,
  sendTreasuryError,
} from "./treasuryHttp.js";
import { TreasuryDomainError } from "./domain/treasuryErrors.js";

const buckets = new Map<string, number[]>();

export function resetTreasuryRateLimitBucketsForTests(): void {
  buckets.clear();
}

export function evaluateTreasuryCriticalRateLimit(input: {
  userId: string;
  action: TreasuryCriticalRateAction;
  nowMs?: number;
}): { allowed: boolean; retryAfterMs: number } {
  const nowMs = input.nowMs ?? Date.now();
  const key = `${input.action}:${input.userId}`;
  const current = buckets.get(key) ?? [];
  const result = checkTreasurySlidingWindowRateLimit({
    timestampsMs: current,
    nowMs,
    limit: TREASURY_CRITICAL_RATE_LIMITS[input.action],
    windowMs: TREASURY_CRITICAL_RATE_WINDOW_MS,
  });
  buckets.set(key, result.nextTimestampsMs);
  return { allowed: result.allowed, retryAfterMs: result.retryAfterMs };
}

/**
 * Middleware: exige usuário já autenticado (usa req após requireAppAuth)
 * via getCurrentAppUser opcional ou header x-user-id de teste — na prática
 * lê de res.locals ou chama getUser.
 */
export function requireTreasuryCriticalRateLimit(input: {
  action: TreasuryCriticalRateAction;
  getUserId: (req: Parameters<RequestHandler>[0]) => Promise<string | null>;
}): RequestHandler {
  return async (req, res, next) => {
    const requestId = resolveTreasuryRequestId(req);
    try {
      const userId = await input.getUserId(req);
      if (!userId) {
        sendTreasuryError(res, {
          requestId,
          error: "Autenticação necessária.",
          code: "UNAUTHORIZED",
        });
        return;
      }
      const decision = evaluateTreasuryCriticalRateLimit({
        userId,
        action: input.action,
      });
      if (!decision.allowed) {
        if (decision.retryAfterMs > 0) {
          res.setHeader(
            "Retry-After",
            String(Math.ceil(decision.retryAfterMs / 1000))
          );
        }
        assertTreasuryRateLimitAllowed(false);
      }
      next();
    } catch (err) {
      handleTreasuryRouteError(res, requestId, err);
    }
  };
}

/** Helper para controllers que checam rate limit inline. */
export function assertTreasuryCriticalRateLimitForUser(
  userId: string,
  action: TreasuryCriticalRateAction
): void {
  const decision = evaluateTreasuryCriticalRateLimit({ userId, action });
  if (!decision.allowed) {
    throw new TreasuryDomainError(
      "RATE_LIMITED",
      "Muitas tentativas. Aguarde um momento e tente novamente."
    );
  }
}
