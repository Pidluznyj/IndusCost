import type { PrismaClient } from "@prisma/client";
import express, { type RequestHandler } from "express";
import { canAccessQuodDossier, formatQuodPrice, QUOD_DOSSIER_PRODUCT, QUOD_DOSSIER_PROVIDER, readQuodDossierConfig } from "./config.js";
import { executePaidQuodConsultation, publicQuodStatus } from "./query.js";
import { createPrismaQuodStore } from "./store.server.js";
import type { QuodConsultationRecord, QuodStore } from "./store.js";

type User = { id?: string | null; role?: string | null; name?: string | null; email?: string | null };

const hits = new Map<string, number[]>();

export function resetQuodDossierRateLimit(): void {
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

function historyLine(row: QuodConsultationRecord) {
  return {
    id: row.id,
    status: row.status,
    billingStatus: row.billingStatus,
    authorizedCostCents: row.authorizedCostCents,
    chargedCostCents: row.chargedCostCents,
    failureCode: row.failureCode,
    consultedAt: row.consultedAt,
    createdAt: row.createdAt,
    validUntil: row.validUntil,
    providerQueryId: row.providerQueryId,
  };
}

function reportOf(row: QuodConsultationRecord) {
  return {
    id: row.id,
    product: QUOD_DOSSIER_PRODUCT,
    provider: QUOD_DOSSIER_PROVIDER,
    companyName: row.companyName,
    cnpj: row.cnpj,
    consultedAt: row.consultedAt,
    validUntil: row.validUntil,
    requestedByUserId: row.requestedByUserId,
    score: row.score,
    scale: null,
    restrictionCount: row.restrictionCount,
    confirmedRestriction: row.confirmedRestriction,
    insufficient: row.insufficient,
    authorizedCostCents: row.authorizedCostCents,
    chargedCostCents: row.chargedCostCents,
    sections: row.sections,
    partners: row.partners,
  };
}

export function registerQuodDossierRoutes(
  app: express.Express,
  guards: {
    requireAppAuth: RequestHandler;
    getCurrentAppUser: (req: express.Request) => Promise<User | null>;
  },
  deps: {
    prisma?: PrismaClient;
    store?: QuodStore;
    env?: NodeJS.ProcessEnv;
    now?: () => Date;
    fetchImpl?: typeof fetch;
    customer?: (id: string) => Promise<{ companyName: string; cnpj: string } | null>;
    audit?: (entry: { entityId: string; action: string; newValue: string; performedBy: string | null }) => Promise<void>;
  } = {}
): void {
  const store = deps.store ?? (deps.prisma ? createPrismaQuodStore(deps.prisma) : null);
  if (!store) throw new Error("Consulta QUOD sem persistência.");
  const config = () => readQuodDossierConfig(deps.env ?? process.env);
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
    if (!canAccessQuodDossier(user)) {
      res.status(403).json({ error: "A consulta paga é restrita ao Super Admin." });
      return null;
    }
    return user;
  }

  app.get("/api/customers/:customerId/quod-dossier", guards.requireAppAuth, async (req, res) => {
    const user = await currentUser(req, res);
    if (!user) return;
    const customerId = String(req.params.customerId);
    const rows = await store.listByCustomer(customerId);
    const latest = rows.at(-1) ?? null;
    const succeeded = [...rows].reverse().find((row) => row.status === "SUCCEEDED") ?? null;
    const shown = succeeded ?? latest;
    const current = config();
    res.json({
      product: QUOD_DOSSIER_PRODUCT,
      provider: QUOD_DOSSIER_PROVIDER,
      enabled: current.enabled,
      unitPriceCents: current.unitPriceCents,
      priceLabel: formatQuodPrice(current.unitPriceCents),
      state: publicQuodStatus(shown, now()).state,
      consultation: shown && shown.status === "SUCCEEDED" ? reportOf(shown) : null,
      history: rows.map(historyLine),
    });
  });

  app.get("/api/customers/:customerId/quod-dossier/:consultationId", guards.requireAppAuth, async (req, res) => {
    const user = await currentUser(req, res);
    if (!user) return;
    const row = await store.findById(String(req.params.consultationId));
    if (!row || row.customerId !== String(req.params.customerId)) {
      res.status(404).json({ error: "Dossiê não encontrado." });
      return;
    }
    res.json(reportOf(row));
  });

  app.post("/api/customers/:customerId/quod-dossier", guards.requireAppAuth, async (req, res) => {
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
    const customer = deps.customer
      ? await deps.customer(customerId)
      : await deps.prisma?.customer.findUnique({ where: { id: customerId }, select: { companyName: true, taxId: true } }).then((row) =>
          row ? { companyName: row.companyName, cnpj: String(row.taxId ?? "").replace(/\D/g, "") } : null
        );
    if (!customer) {
      res.status(404).json({ error: "Cliente não encontrado." });
      return;
    }
    const body = (req.body ?? {}) as { consent?: unknown; idempotencyKey?: unknown };
    if (body.consent !== true || typeof body.idempotencyKey !== "string" || body.idempotencyKey.trim().length < 8) {
      await deps.audit?.({
        entityId: customerId,
        action: "QUOD_DOSSIER_QUERY",
        performedBy: userId,
        newValue: JSON.stringify({ code: "CONSENT_REQUIRED", charged: false }),
      });
      res.status(422).json({ code: "CONSENT_REQUIRED", charged: false, consultation: null });
      return;
    }
    const outcome = await executePaidQuodConsultation({
      store,
      config: config(),
      customerId,
      companyName: customer.companyName,
      cnpj: customer.cnpj,
      consent: body.consent === true,
      idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : "",
      userId,
      role: user.role ?? "",
      now: now(),
      fetchImpl: deps.fetchImpl,
    });
    await deps.audit?.({
      entityId: outcome.row?.id && /^[0-9a-f-]{36}$/i.test(outcome.row.id) ? outcome.row.id : customerId,
      action: "QUOD_DOSSIER_QUERY",
      performedBy: userId,
      newValue: JSON.stringify({
        code: outcome.code,
        charged: outcome.charged,
        billingStatus: outcome.row?.billingStatus ?? null,
        authorizedCostCents: outcome.row?.authorizedCostCents ?? config().unitPriceCents,
        chargedCostCents: outcome.row?.chargedCostCents ?? null,
        providerQueryId: outcome.row?.providerQueryId ?? null,
        failureCode: outcome.row?.failureCode ?? null,
        creditEffect: outcome.row?.confirmedRestriction ? "EM_ANALISE" : "UNCHANGED_BY_SCORE",
      }),
    });
    const status = outcome.code === "OK" ? 200 : outcome.code === "CONSENT_REQUIRED" ? 422 : outcome.code === "BUDGET" || outcome.code === "INTERVAL" || outcome.code === "CACHE_VALID" || outcome.code === "IN_FLIGHT" || outcome.code === "UNKNOWN_BILLING" || outcome.code === "DISABLED" ? 409 : outcome.code === "AUTH" || outcome.code === "RATE_LIMIT" || outcome.code === "TIMEOUT" || outcome.code === "HTTP_ERROR" || outcome.code === "NETWORK" || outcome.code === "PARTIAL" || outcome.code === "PERSISTENCE_FAILED" ? 502 : 400;
    res.status(status).json({
      code: outcome.code,
      charged: outcome.charged,
      priceLabel: formatQuodPrice(config().unitPriceCents),
      consultation: outcome.row && outcome.row.status === "SUCCEEDED" ? reportOf(outcome.row) : null,
    });
  });
}
