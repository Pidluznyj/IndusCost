import type { PrismaClient } from "@prisma/client";
import express, { type RequestHandler } from "express";
import { classifyDocument, formatCnpj, isValidCnpj } from "./cnpj.js";
import {
  BOA_VISTA_DEFINE_LIMITE_ATTRIBUTION,
  BOA_VISTA_DEFINE_LIMITE_PRODUCT,
  BOA_VISTA_DEFINE_LIMITE_PROVIDER,
  BOA_VISTA_DEFINE_LIMITE_SOURCE,
  canRequestLikeSerasa,
  formatLikeSerasaPrice,
  LIKE_SERASA_DISPLAY_NAME,
  readLikeSerasaConfig,
} from "./config.js";
import { decideDemoQuery, decideLiveQuery, LIVE_BLOCK_MESSAGES, type RoleFileReader } from "./environmentGate.js";
import {
  executeDemoLikeSerasaConsultation,
  executeLiveLikeSerasaConsultation,
  likeSerasaHttpStatus,
  likeSerasaMessage,
  publicLikeSerasaStatus,
} from "./query.js";
import { createPrismaBoaVistaStore } from "./store.server.js";
import type { BoaVistaConsultationRecord, BoaVistaStore } from "./store.js";
import { LIKE_SERASA_BILLING_LABEL, LIKE_SERASA_STATE_LABEL, type LikeSerasaHistoryLine, type LikeSerasaReportView, type LikeSerasaStatusPayload } from "./view.js";

type User = { id?: string | null; role?: string | null; name?: string | null; email?: string | null };

export const LIKE_SERASA_AUDIT_ACTION = "LIKE_SERASA_QUERY";

const hits = new Map<string, number[]>();

export function resetLikeSerasaRateLimit(): void {
  hits.clear();
}

function allowRate(userId: string, limit: number, now: number): boolean {
  const recent = (hits.get(userId) ?? []).filter((stamp) => now - stamp < 60_000);
  if (recent.length >= limit) {
    hits.set(userId, recent);
    return false;
  }
  recent.push(now);
  hits.set(userId, recent);
  return true;
}

function sameOrigin(req: express.Request): boolean {
  const origin = req.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === req.get("host");
  } catch {
    return false;
  }
}

export function historyLine(row: BoaVistaConsultationRecord): LikeSerasaHistoryLine {
  return {
    id: row.id,
    mode: row.mode,
    status: row.status,
    billingStatus: row.billingStatus,
    billingLabel: LIKE_SERASA_BILLING_LABEL[row.billingStatus] ?? row.billingStatus,
    authorizedCostCents: row.authorizedCostCents,
    chargedCostCents: row.chargedCostCents,
    failureCode: row.failureCode,
    providerQueryId: row.providerQueryId,
    requestedByUserId: row.requestedByUserId,
    consultedAt: row.consultedAt,
    createdAt: row.createdAt,
    validUntil: row.validUntil,
    score: row.score,
    suggestedLimitLabel: row.suggestedLimitLabel,
  };
}

export function reportOf(row: BoaVistaConsultationRecord): LikeSerasaReportView {
  return {
    id: row.id,
    mode: row.mode,
    displayName: LIKE_SERASA_DISPLAY_NAME,
    product: BOA_VISTA_DEFINE_LIMITE_PRODUCT,
    provider: BOA_VISTA_DEFINE_LIMITE_PROVIDER,
    source: BOA_VISTA_DEFINE_LIMITE_SOURCE,
    attribution: BOA_VISTA_DEFINE_LIMITE_ATTRIBUTION,
    companyName: row.companyName,
    cnpj: row.cnpj,
    cnpjFormatted: formatCnpj(row.cnpj),
    status: row.status,
    billingStatus: row.billingStatus,
    billingLabel: LIKE_SERASA_BILLING_LABEL[row.billingStatus] ?? row.billingStatus,
    authorizedCostCents: row.authorizedCostCents,
    chargedCostCents: row.chargedCostCents,
    providerQueryId: row.providerQueryId,
    providerResult: row.providerResult,
    failureCode: row.failureCode,
    consultedAt: row.consultedAt,
    validUntil: row.validUntil,
    requestedByUserId: row.requestedByUserId,
    score: row.score,
    scoreRaw: row.scoreRaw,
    scoreClass: row.scoreClass,
    riskText: row.riskText,
    defaultProbability: row.defaultProbability,
    suggestedLimitCents: row.suggestedLimitCents,
    suggestedLimitLabel: row.suggestedLimitLabel,
    restrictionCount: row.restrictionCount,
    confirmedRestriction: row.confirmedRestriction,
    insufficient: row.insufficient,
    parserVersion: row.parserVersion,
    hasReceipt: Boolean(row.receiptUrl),
    sections: row.sections,
  };
}

export function registerLikeSerasaRoutes(
  app: express.Express,
  guards: {
    requireAppAuth: RequestHandler;
    getCurrentAppUser: (req: express.Request) => Promise<User | null>;
  },
  deps: {
    prisma?: PrismaClient;
    store?: BoaVistaStore;
    env?: NodeJS.ProcessEnv;
    now?: () => Date;
    fetchImpl?: typeof fetch;
    readRoleFile?: RoleFileReader;
    customer?: (id: string) => Promise<{ companyName: string; taxId: string | null } | null>;
    audit?: (entry: { entityId: string; action: string; newValue: string; performedBy: string | null }) => Promise<void>;
  } = {}
): void {
  const store = deps.store ?? (deps.prisma ? createPrismaBoaVistaStore(deps.prisma) : null);
  if (!store) throw new Error("Consulta LIKE SERASA sem persistência.");
  const env = () => deps.env ?? process.env;
  const config = () => readLikeSerasaConfig(env());
  const liveDecision = () => decideLiveQuery(env(), deps.readRoleFile);
  const demoDecision = () => decideDemoQuery(env(), deps.readRoleFile);
  const now = () => deps.now?.() ?? new Date();

  async function currentUser(req: express.Request, res: express.Response): Promise<User | null> {
    const user = await guards.getCurrentAppUser(req);
    if (!user) {
      res.status(401).json({ error: "Não autenticado." });
      return null;
    }
    return user;
  }

  async function superAdmin(req: express.Request, res: express.Response): Promise<User | null> {
    const user = await currentUser(req, res);
    if (!user) return null;
    if (!canRequestLikeSerasa(user)) {
      res.status(403).json({ error: "A consulta paga LIKE SERASA é restrita ao Super Admin." });
      return null;
    }
    return user;
  }

  async function loadCustomer(customerId: string): Promise<{ companyName: string; taxId: string | null } | null> {
    if (deps.customer) return deps.customer(customerId);
    const row = await deps.prisma?.customer.findUnique({ where: { id: customerId }, select: { companyName: true, taxId: true } });
    return row ? { companyName: row.companyName, taxId: row.taxId ?? null } : null;
  }

  app.get("/api/customers/:customerId/like-serasa", guards.requireAppAuth, async (req, res) => {
    const user = await currentUser(req, res);
    if (!user) return;
    const customerId = String(req.params.customerId);
    const customer = await loadCustomer(customerId);
    const rows = await store.listByCustomer(customerId);
    const live = rows.filter((row) => row.mode === "LIVE");
    const latestLive = live.at(-1) ?? null;
    const succeededLive = [...live].reverse().find((row) => row.status === "SUCCEEDED") ?? null;
    const shown = succeededLive ?? latestLive ?? [...rows].reverse().find((row) => row.status === "SUCCEEDED") ?? rows.at(-1) ?? null;
    const current = config();
    const decision = liveDecision();
    const demo = demoDecision();
    const kind = classifyDocument(customer?.taxId);
    const payload: LikeSerasaStatusPayload = {
      displayName: LIKE_SERASA_DISPLAY_NAME,
      product: BOA_VISTA_DEFINE_LIMITE_PRODUCT,
      provider: BOA_VISTA_DEFINE_LIMITE_PROVIDER,
      source: BOA_VISTA_DEFINE_LIMITE_SOURCE,
      attribution: BOA_VISTA_DEFINE_LIMITE_ATTRIBUTION,
      unitPriceCents: current.unitPriceCents,
      priceLabel: formatLikeSerasaPrice(current.unitPriceCents),
      cacheTtlMs: current.cacheTtlMs,
      document: { kind, valid: kind === "CNPJ" && isValidCnpj(customer?.taxId), formatted: formatCnpj(customer?.taxId) },
      live: { allowed: decision.allowed, reason: decision.reason, message: decision.allowed ? "Consulta real habilitada neste servidor." : LIVE_BLOCK_MESSAGES[decision.reason] },
      demo: { allowed: demo.allowed, reason: demo.reason },
      canRequest: canRequestLikeSerasa(user),
      state: publicLikeSerasaStatus(shown, now()).state,
      stateLabel: LIKE_SERASA_STATE_LABEL[publicLikeSerasaStatus(shown, now()).state],
      consultation: shown && (shown.status === "SUCCEEDED" || shown.status === "PARTIAL") && shown.sections ? reportOf(shown) : null,
      history: rows.map(historyLine).reverse(),
    };
    res.json(payload);
  });

  app.get("/api/customers/:customerId/like-serasa/:consultationId", guards.requireAppAuth, async (req, res) => {
    const user = await currentUser(req, res);
    if (!user) return;
    const row = await store.findById(String(req.params.consultationId));
    if (!row || row.customerId !== String(req.params.customerId)) {
      res.status(404).json({ error: "Consulta LIKE SERASA não encontrada." });
      return;
    }
    res.json(reportOf(row));
  });

  /** Comprovante do fornecedor (quando a API devolveu `urlComprovante`). Autenticado; a URL nunca vai no GET geral. */
  app.get("/api/customers/:customerId/like-serasa/:consultationId/receipt", guards.requireAppAuth, async (req, res) => {
    const user = await currentUser(req, res);
    if (!user) return;
    const row = await store.findById(String(req.params.consultationId));
    if (!row || row.customerId !== String(req.params.customerId)) {
      res.status(404).json({ error: "Consulta LIKE SERASA não encontrada." });
      return;
    }
    if (!row.receiptUrl) {
      res.status(404).json({ error: "Esta consulta não tem comprovante do fornecedor." });
      return;
    }
    res.json({ url: row.receiptUrl, providerQueryId: row.providerQueryId });
  });

  app.post("/api/customers/:customerId/like-serasa", guards.requireAppAuth, async (req, res) => {
    const user = await superAdmin(req, res);
    if (!user) return;
    if (!sameOrigin(req)) {
      res.status(403).json({ error: "Origem da consulta não confirmada." });
      return;
    }
    const userId = user.id ?? user.email ?? "";
    if (!userId || !allowRate(userId, config().rateLimitPerMinute, now().getTime())) {
      res.status(429).json({ error: "Muitas tentativas. Aguarde um minuto." });
      return;
    }
    const customerId = String(req.params.customerId);
    const customer = await loadCustomer(customerId);
    if (!customer) {
      res.status(404).json({ error: "Cliente não encontrado." });
      return;
    }
    const cnpj = String(customer.taxId ?? "").replace(/\D/g, "");
    const body = (req.body ?? {}) as { consent?: unknown; idempotencyKey?: unknown; forceRefresh?: unknown; demo?: unknown; demoVariant?: unknown };
    const demoRequested = body.demo === true;
    const audit = (entityId: string, value: Record<string, unknown>) =>
      deps.audit?.({ entityId, action: LIKE_SERASA_AUDIT_ACTION, performedBy: userId, newValue: JSON.stringify(value) });
    if (body.consent !== true || typeof body.idempotencyKey !== "string" || body.idempotencyKey.trim().length < 8) {
      await audit(customerId, { code: "CONSENT_REQUIRED", charged: false, mode: demoRequested ? "DEMO" : "LIVE" });
      const message = likeSerasaMessage("CONSENT_REQUIRED");
      res.status(422).json({ code: "CONSENT_REQUIRED", error: message, message, charged: false, priceLabel: formatLikeSerasaPrice(config().unitPriceCents), mode: demoRequested ? "DEMO" : "LIVE", consultation: null });
      return;
    }
    const common = {
      store,
      config: config(),
      customerId,
      companyName: customer.companyName,
      cnpj,
      consent: true,
      idempotencyKey: body.idempotencyKey,
      userId,
      role: user.role ?? "",
      forceRefresh: body.forceRefresh === true,
      now: now(),
    };
    const decision = liveDecision();
    const outcome = demoRequested
      ? await executeDemoLikeSerasaConsultation({ ...common, demoDecision: demoDecision(), variant: body.demoVariant === "clear" || body.demoVariant === "partial" ? body.demoVariant : "restricted" })
      : await executeLiveLikeSerasaConsultation({ ...common, liveDecision: decision, fetchImpl: deps.fetchImpl });
    await audit(outcome.row?.id && /^[0-9a-f-]{36}$/i.test(outcome.row.id) ? outcome.row.id : customerId, {
      code: outcome.code,
      mode: demoRequested ? "DEMO" : "LIVE",
      charged: outcome.charged,
      environment: decision.allowed ? "production-attested" : decision.reason,
      billingStatus: outcome.row?.billingStatus ?? null,
      authorizedCostCents: outcome.row?.authorizedCostCents ?? (demoRequested ? 0 : config().unitPriceCents),
      chargedCostCents: outcome.row?.chargedCostCents ?? null,
      providerQueryId: outcome.row?.providerQueryId ?? null,
      failureCode: outcome.row?.failureCode ?? null,
      // A consulta externa nunca altera limite aprovado, Score de Confiança V1 ou bloqueio do cliente.
      creditEffect: "NONE",
    });
    const message = likeSerasaMessage(outcome.code, outcome.message, decision.allowed ? "OK" : decision.reason);
    res.status(likeSerasaHttpStatus(outcome.code)).json({
      code: outcome.code,
      error: outcome.code === "OK" || outcome.code === "CACHE_VALID" ? undefined : message,
      message,
      charged: outcome.charged,
      priceLabel: formatLikeSerasaPrice(config().unitPriceCents),
      mode: demoRequested ? "DEMO" : "LIVE",
      consultation: outcome.row && (outcome.row.status === "SUCCEEDED" || outcome.row.status === "PARTIAL") && outcome.row.sections ? reportOf(outcome.row) : null,
    });
  });
}
