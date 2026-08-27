/**
 * Satisfação — rotas PÚBLICAS. Superfície mínima, sem autenticação IndusCost.
 *
 * São exatamente quatro endpoints. Nada de busca de cliente, nada de listagem,
 * nada administrativo. O guard de host (satisfactionPublicSurface) já bloqueia
 * qualquer outro path quando a requisição chega pelo hostname público; estas
 * rotas são a única coisa que existe lá.
 *
 * Higiene de log: registramos requestId/campanha/evento/resultado/duração.
 * Nunca token, cookie, telefone, CNPJ, comentário ou respostas.
 */

import crypto from "crypto";
import type express from "express";
import { prisma } from "@/src/lib/prisma.js";
import { resolveCookieSecure } from "@/src/lib/appSessionCookie.js";
import {
  parseAnswersPayload,
  parseSubmitInput,
  normalizeText,
  SATISFACTION_INPUT_LIMITS,
} from "./satisfactionContracts.js";
import {
  asPublicError,
  createSatisfactionPublicService,
  SATISFACTION_PUBLIC_SESSION_COOKIE,
  SATISFACTION_PUBLIC_SESSION_TTL_MS,
  type SatisfactionPublicService,
} from "./satisfactionPublicService.server.js";
import {
  resolveRateLimitKey,
  satisfactionRateLimiter,
  type SatisfactionRateLimitBucket,
} from "./satisfactionRateLimit.js";
import {
  resolveTurnstileConfig,
  toPublicTurnstileSiteKey,
  turnstileFailureMessage,
  verifyTurnstileToken,
} from "./satisfactionTurnstile.server.js";

/**
 * Parser local e mínimo de cookies. Existe uma versão equivalente dentro de
 * `server.ts`, mas ela não é exportada e extrair um helper de um arquivo de
 * 17 mil linhas traria mais risco do que estas seis linhas de duplicação.
 */
function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(trimmed.slice(eq + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function logPublicEvent(input: {
  requestId: string;
  event: string;
  result: string;
  durationMs: number;
  statusCode: number;
  campaignId?: string | null;
  responseId?: string | null;
}): void {
  console.info(
    `[satisfaction:public] requestId=${input.requestId} event=${input.event}` +
      ` result=${input.result} status=${input.statusCode} durationMs=${input.durationMs}` +
      (input.campaignId ? ` campaignId=${input.campaignId}` : "") +
      (input.responseId ? ` responseId=${input.responseId}` : "")
  );
}

type PublicGuards = {
  service?: SatisfactionPublicService;
  /** Injetável para teste; em produção usa o siteverify real. */
  verifyTurnstile?: typeof verifyTurnstileToken;
};

export function registerSatisfactionPublicRoutes(
  app: express.Express,
  guards: PublicGuards = {}
): void {
  const service = guards.service ?? createSatisfactionPublicService({ prisma });
  const verifyTurnstile = guards.verifyTurnstile ?? verifyTurnstileToken;

  const trustProxy = process.env.SATISFACTION_TRUST_PROXY === "1";

  function limit(
    req: express.Request,
    res: express.Response,
    bucket: SatisfactionRateLimitBucket
  ): boolean {
    const key = resolveRateLimitKey(
      {
        socketAddress: req.socket?.remoteAddress ?? null,
        forwardedFor: req.headers["x-forwarded-for"] ?? null,
      },
      { trustProxy }
    );
    const decision = satisfactionRateLimiter.check(bucket, key);
    if (!decision.allowed) {
      res.setHeader("Retry-After", String(decision.retryAfterSeconds));
      res.status(429).json({
        error: "TOO_MANY_REQUESTS",
        message: "Muitas tentativas em pouco tempo. Aguarde alguns instantes.",
      });
      return false;
    }
    return true;
  }

  /** Corpo público é pequeno por contrato — recusamos payload inflado. */
  function bodyTooLarge(req: express.Request): boolean {
    const declared = Number.parseInt(String(req.headers["content-length"] ?? "0"), 10);
    return Number.isFinite(declared) && declared > SATISFACTION_INPUT_LIMITS.publicBodyBytes;
  }

  function setSessionCookie(res: express.Response, token: string): void {
    res.cookie(SATISFACTION_PUBLIC_SESSION_COOKIE, token, {
      httpOnly: true,
      // Strict: este cookie nunca deve acompanhar navegação vinda de terceiros.
      sameSite: "strict",
      secure: resolveCookieSecure({
        forcedSecure: process.env.APP_COOKIE_SECURE,
        requestSecure: res.req?.secure,
        forwardedProto: res.req?.headers["x-forwarded-proto"],
      }),
      maxAge: SATISFACTION_PUBLIC_SESSION_TTL_MS,
      path: "/",
    });
  }

  function noStore(res: express.Response): void {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
  }

  // ─── Troca token → sessão pública ─────────────────────────────────────────

  app.post("/api/public/satisfaction/session", async (req, res) => {
    const startedAt = Date.now();
    const requestId = crypto.randomUUID();
    noStore(res);
    if (!limit(req, res, "session")) return;
    if (bodyTooLarge(req)) {
      res.status(413).json({ error: "PAYLOAD_TOO_LARGE" });
      return;
    }

    try {
      // O token chega no corpo (veio do fragmento da URL), nunca em query/path.
      const token = normalizeText((req.body ?? {}).token, 200) ?? "";
      const result = await service.exchangeToken(token);

      const failure = asPublicError(result);
      if (failure) {
        logPublicEvent({
          requestId,
          event: "session_exchange",
          result: failure.reason,
          durationMs: Date.now() - startedAt,
          statusCode: 200,
        });
        res.json({ ok: false, reason: failure.reason, message: failure.message });
        return;
      }

      setSessionCookie(res, (result as { sessionToken: string }).sessionToken);
      logPublicEvent({
        requestId,
        event: "session_exchange",
        result: "ok",
        durationMs: Date.now() - startedAt,
        statusCode: 200,
      });
      res.json({ ok: true, expiresAt: (result as { expiresAt: Date }).expiresAt.toISOString() });
    } catch (error) {
      console.error("[satisfaction:public] falha na troca de sessão", requestId);
      res.status(500).json({ error: "INTERNAL_ERROR" });
    }
  });

  // ─── Formulário ───────────────────────────────────────────────────────────

  app.get("/api/public/satisfaction/form", async (req, res) => {
    const startedAt = Date.now();
    const requestId = crypto.randomUUID();
    noStore(res);

    try {
      const sessionToken = readCookie(
        req.headers.cookie,
        SATISFACTION_PUBLIC_SESSION_COOKIE
      );
      const turnstile = resolveTurnstileConfig();
      const result = await service.getForm(sessionToken, toPublicTurnstileSiteKey(turnstile));

      const failure = asPublicError(result);
      if (failure) {
        logPublicEvent({
          requestId,
          event: "form_load",
          result: failure.reason,
          durationMs: Date.now() - startedAt,
          statusCode: 200,
        });
        res.json({ ok: false, reason: failure.reason, message: failure.message });
        return;
      }

      logPublicEvent({
        requestId,
        event: "form_load",
        result: "ok",
        durationMs: Date.now() - startedAt,
        statusCode: 200,
      });
      res.json({ ok: true, form: (result as { form: unknown }).form });
    } catch (error) {
      console.error("[satisfaction:public] falha ao carregar formulário", requestId);
      res.status(500).json({ error: "INTERNAL_ERROR" });
    }
  });

  // ─── Rascunho (autosave) ──────────────────────────────────────────────────

  app.patch("/api/public/satisfaction/draft", async (req, res) => {
    const startedAt = Date.now();
    const requestId = crypto.randomUUID();
    noStore(res);
    if (!limit(req, res, "draft")) return;
    if (bodyTooLarge(req)) {
      res.status(413).json({ error: "PAYLOAD_TOO_LARGE" });
      return;
    }

    try {
      const sessionToken = readCookie(
        req.headers.cookie,
        SATISFACTION_PUBLIC_SESSION_COOKIE
      );
      const body = (req.body ?? {}) as Record<string, unknown>;
      const result = await service.saveDraft(sessionToken, {
        answers: parseAnswersPayload(body.answers),
        respondentName: normalizeText(
          body.respondentName,
          SATISFACTION_INPUT_LIMITS.respondentName
        ),
        respondentPhone: normalizeText(body.respondentPhone, SATISFACTION_INPUT_LIMITS.phone),
        expectedVersion:
          typeof body.expectedVersion === "number" ? body.expectedVersion : null,
      });

      const outcome = asPublicError(result)?.reason ?? "ok";
      logPublicEvent({
        requestId,
        event: "draft_save",
        result: String(outcome),
        durationMs: Date.now() - startedAt,
        statusCode: 200,
      });
      res.json(result);
    } catch (error) {
      console.error("[satisfaction:public] falha ao salvar rascunho", requestId);
      res.status(500).json({ error: "INTERNAL_ERROR" });
    }
  });

  // ─── Envio final ──────────────────────────────────────────────────────────

  app.post("/api/public/satisfaction/submit", async (req, res) => {
    const startedAt = Date.now();
    const requestId = crypto.randomUUID();
    noStore(res);
    if (!limit(req, res, "submit")) return;
    if (bodyTooLarge(req)) {
      res.status(413).json({ error: "PAYLOAD_TOO_LARGE" });
      return;
    }

    try {
      const sessionToken = readCookie(
        req.headers.cookie,
        SATISFACTION_PUBLIC_SESSION_COOKIE
      );
      const input = parseSubmitInput(req.body);

      // Turnstile ANTES de qualquer persistência de SUBMITTED.
      const turnstile = resolveTurnstileConfig();
      const challenge = await verifyTurnstile(input.turnstileToken, turnstile);
      const challengeFailure = challenge.ok
        ? null
        : (challenge as { reason: "MISSING_TOKEN" | "REJECTED" | "UNAVAILABLE" });
      if (challengeFailure) {
        logPublicEvent({
          requestId,
          event: "submit",
          result: `turnstile_${challengeFailure.reason}`,
          durationMs: Date.now() - startedAt,
          statusCode: 400,
        });
        res.status(400).json({
          ok: false,
          reason: "TURNSTILE",
          message: turnstileFailureMessage(challengeFailure.reason),
        });
        return;
      }

      const result = await service.submit(sessionToken, input);

      const submitFailure = asPublicError(result);
      if (submitFailure) {
        const status = submitFailure.reason === "VALIDATION" ? 400 : 200;
        logPublicEvent({
          requestId,
          event: "submit",
          result: submitFailure.reason,
          durationMs: Date.now() - startedAt,
          statusCode: status,
        });
        res.status(status).json(result);
        return;
      }

      const success = result as { responseId: string; alreadySubmitted: boolean };
      logPublicEvent({
        requestId,
        event: "submit",
        result: success.alreadySubmitted ? "idempotent" : "ok",
        durationMs: Date.now() - startedAt,
        statusCode: 200,
        responseId: success.responseId,
      });
      res.json({ ok: true, alreadySubmitted: success.alreadySubmitted });
    } catch (error) {
      console.error("[satisfaction:public] falha no envio", requestId);
      res.status(500).json({ error: "INTERNAL_ERROR" });
    }
  });
}
