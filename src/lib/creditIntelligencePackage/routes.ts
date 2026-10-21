import type { PrismaClient } from "@prisma/client";
import express, { type RequestHandler } from "express";
import { canAccessQuodDossier, formatQuodPrice, QUOD_DOSSIER_PRODUCT, QUOD_DOSSIER_PROVIDER } from "@/src/lib/quodDossier/config.js";
import { IEPTB_COVERAGE_NOTE, IEPTB_ONLINE_PRODUCT } from "@/src/lib/ieptbOnline/config.js";
import { publicIeptbStatus } from "@/src/lib/ieptbOnline/query.js";
import { createPrismaIeptbStore } from "@/src/lib/ieptbOnline/store.server.js";
import type { IeptbStore } from "@/src/lib/ieptbOnline/store.js";
import { publicQuodStatus } from "@/src/lib/quodDossier/query.js";
import { createPrismaQuodStore } from "@/src/lib/quodDossier/store.server.js";
import type { QuodStore } from "@/src/lib/quodDossier/store.js";
import {
  paidConsultationHttpStatus,
  paidConsultationMessage,
} from "@/src/lib/directData/paidConsultationMessages.js";
import { composePackageQuote, type PackageSourceState } from "./compose.js";
import { formatPackagePrice, readCreditIntelligencePackageConfig } from "./config.js";
import { executeCreditIntelligencePackage, packagePriceSummary } from "./execute.js";

type User = { id?: string | null; role?: string | null; name?: string | null; email?: string | null };

const hits = new Map<string, number[]>();

export function resetCreditIntelligencePackageRateLimit(): void {
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

function asState(value: string): PackageSourceState {
  if (
    value === "VALID" ||
    value === "STALE" ||
    value === "IN_PROGRESS" ||
    value === "FAILED" ||
    value === "PARTIAL" ||
    value === "UNKNOWN_BILLING" ||
    value === "UNAVAILABLE" ||
    value === "RESTRICTED"
  ) {
    return value;
  }
  return "NOT_CONSULTED";
}

export function registerCreditIntelligencePackageRoutes(
  app: express.Express,
  guards: {
    requireAppAuth: RequestHandler;
    getCurrentAppUser: (req: express.Request) => Promise<User | null>;
  },
  deps: {
    prisma?: PrismaClient;
    quodStore?: QuodStore;
    ieptbStore?: IeptbStore;
    env?: NodeJS.ProcessEnv;
    now?: () => Date;
    fetchImpl?: typeof fetch;
    customer?: (id: string) => Promise<{ companyName: string; cnpj: string } | null>;
    audit?: (entry: { entityId: string; action: string; newValue: string; performedBy: string | null }) => Promise<void>;
  } = {}
): void {
  const quodStore = deps.quodStore ?? (deps.prisma ? createPrismaQuodStore(deps.prisma) : null);
  const ieptbStore = deps.ieptbStore ?? (deps.prisma ? createPrismaIeptbStore(deps.prisma) : null);
  if (!quodStore || !ieptbStore) throw new Error("Pacote de inteligência sem persistência.");
  const config = () => readCreditIntelligencePackageConfig(deps.env ?? process.env);
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

  app.get("/api/customers/:customerId/credit-intelligence-package", guards.requireAppAuth, async (req, res) => {
    const user = await currentUser(req, res);
    if (!user) return;
    const customerId = String(req.params.customerId);
    const current = config();
    const [quodRows, ieptbRows] = await Promise.all([
      quodStore.listByCustomer(customerId),
      ieptbStore.listByCustomer(customerId),
    ]);
    const quod = [...quodRows].reverse().find((row) => row.status === "SUCCEEDED") ?? quodRows.at(-1) ?? null;
    const ieptb = [...ieptbRows].reverse().find((row) => row.status === "SUCCEEDED") ?? ieptbRows.at(-1) ?? null;
    const quote = composePackageQuote({
      quodEnabled: current.quod.enabled,
      ieptbEnabled: current.ieptb.enabled,
      quodPriceCents: current.quod.unitPriceCents,
      ieptbPriceCents: current.ieptb.unitPriceCents,
      quodState: asState(publicQuodStatus(quod, now()).state),
      ieptbState: asState(publicIeptbStatus(ieptb, now()).state),
    });
    const prices = packagePriceSummary(quote);
    res.json({
      product: "Análise completa de risco e crédito",
      provider: QUOD_DOSSIER_PROVIDER,
      quodEnabled: current.quod.enabled,
      ieptbEnabled: current.ieptb.enabled,
      complete: quote.complete,
      quote,
      prices,
      quod: {
        product: QUOD_DOSSIER_PRODUCT,
        state: quote.quod.state,
        unitPriceCents: current.quod.unitPriceCents,
        priceLabel: formatQuodPrice(current.quod.unitPriceCents),
        consultation:
          quod && quod.status === "SUCCEEDED"
            ? {
                id: quod.id,
                score: quod.score,
                restrictionCount: quod.restrictionCount,
                confirmedRestriction: quod.confirmedRestriction,
                consultedAt: quod.consultedAt,
                validUntil: quod.validUntil,
                sections: quod.sections,
                partners: quod.partners,
                companyName: quod.companyName,
                cnpj: quod.cnpj,
                requestedByUserId: quod.requestedByUserId,
              }
            : null,
      },
      ieptb: {
        product: IEPTB_ONLINE_PRODUCT,
        state: quote.ieptb.state,
        unitPriceCents: current.ieptb.unitPriceCents,
        priceLabel: formatPackagePrice(current.ieptb.unitPriceCents),
        coverageNote: IEPTB_COVERAGE_NOTE,
        consultation:
          ieptb && ieptb.status === "SUCCEEDED"
            ? {
                id: ieptb.id,
                confirmedProtest: ieptb.confirmedProtest,
                confirmedClear: ieptb.confirmedClear,
                protestCount: ieptb.protestCount,
                totalAmount: ieptb.totalAmount,
                states: ieptb.states,
                consultedAt: ieptb.consultedAt,
                validUntil: ieptb.validUntil,
                sections: ieptb.sections,
                companyName: ieptb.companyName,
                cnpj: ieptb.cnpj,
              }
            : null,
      },
    });
  });

  app.post("/api/customers/:customerId/credit-intelligence-package", guards.requireAppAuth, async (req, res) => {
    const user = await superAdmin(req, res);
    if (!user) return;
    if (!sameOrigin(req)) {
      res.status(403).json({ error: "Origem da consulta não confirmada." });
      return;
    }
    const userId = user.id ?? user.email ?? "";
    const current = config();
    const limit = Math.min(current.quod.rateLimitPerMinute, current.ieptb.rateLimitPerMinute);
    if (!userId || !allowRate(userId, limit, now().getTime())) {
      res.status(429).json({ error: "Muitas tentativas. Aguarde um minuto." });
      return;
    }
    const customerId = String(req.params.customerId);
    const customer = deps.customer
      ? await deps.customer(customerId)
      : await deps.prisma?.customer
          .findUnique({ where: { id: customerId }, select: { companyName: true, taxId: true } })
          .then((row) => (row ? { companyName: row.companyName, cnpj: String(row.taxId ?? "").replace(/\D/g, "") } : null));
    if (!customer) {
      res.status(404).json({ error: "Cliente não encontrado." });
      return;
    }
    const body = (req.body ?? {}) as { consent?: unknown; idempotencyKey?: unknown; forceRefresh?: unknown };
    if (body.consent !== true || typeof body.idempotencyKey !== "string" || body.idempotencyKey.trim().length < 8) {
      await deps.audit?.({
        entityId: customerId,
        action: "CREDIT_INTELLIGENCE_PACKAGE_QUERY",
        performedBy: userId,
        newValue: JSON.stringify({ code: "CONSENT_REQUIRED", charged: false }),
      });
      const message = paidConsultationMessage("CONSENT_REQUIRED");
      res.status(422).json({ code: "CONSENT_REQUIRED", error: message, message, charged: false, complete: false });
      return;
    }
    const outcome = await executeCreditIntelligencePackage({
      quodStore,
      ieptbStore,
      config: current,
      customerId,
      companyName: customer.companyName,
      cnpj: customer.cnpj,
      consent: true,
      idempotencyKey: body.idempotencyKey.trim(),
      userId,
      role: user.role ?? "",
      forceRefresh: body.forceRefresh === true,
      now: now(),
      fetchImpl: deps.fetchImpl,
    });
    await deps.audit?.({
      entityId: customerId,
      action: "CREDIT_INTELLIGENCE_PACKAGE_QUERY",
      performedBy: userId,
      newValue: JSON.stringify({
        code: outcome.code,
        charged: outcome.charged,
        authorizedCostCents: outcome.authorizedCostCents,
        complete: outcome.complete,
        quodCharged: outcome.quote.quod.action === "QUERY",
        ieptbCharged: outcome.quote.ieptb.action === "QUERY",
      }),
    });
    const message = outcome.message || paidConsultationMessage(outcome.code);
    const status = paidConsultationHttpStatus(outcome.code);
    res.status(status).json({
      code: outcome.code,
      error: outcome.code === "OK" ? undefined : message,
      message,
      charged: outcome.charged,
      complete: outcome.complete,
      quote: outcome.quote,
      prices: packagePriceSummary(outcome.quote),
      quod: outcome.quod && outcome.quod.status === "SUCCEEDED" ? { id: outcome.quod.id, score: outcome.quod.score, consultedAt: outcome.quod.consultedAt } : null,
      ieptb:
        outcome.ieptb && outcome.ieptb.status === "SUCCEEDED"
          ? {
              id: outcome.ieptb.id,
              confirmedProtest: outcome.ieptb.confirmedProtest,
              confirmedClear: outcome.ieptb.confirmedClear,
              protestCount: outcome.ieptb.protestCount,
              consultedAt: outcome.ieptb.consultedAt,
            }
          : null,
    });
  });
}
