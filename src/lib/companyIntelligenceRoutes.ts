import type express from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  applyCompanyIntelligenceToCustomer,
  buildCompanyIntelligencePayload,
  CompanyIntelligenceError,
  createCustomerFromCompanyIntelligence,
  getCustomerCompanyIntelligenceHistory,
} from "@/src/lib/companyCnpjLookup.js";

type AuthGuards = {
  requireAppAuth: express.RequestHandler;
  requirePermission: (perm: string) => express.RequestHandler;
  requireAnyPermission: (permissions: string[]) => express.RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function occurrenceError(res: express.Response, e: unknown) {
  const error = e as { httpStatus?: number; message?: string; code?: string; name?: string };
  if (error?.name === "CommercialCreditOccurrenceError") {
    return res.status(error.httpStatus ?? 400).json({ error: error.message, code: error.code });
  }
  console.error("credit-occurrence", e instanceof Error ? e.name : "error");
  return res.status(500).json({ error: "Erro interno ao registrar a ocorrência de crédito." });
}

function handleError(res: express.Response, e: unknown) {
  if (e instanceof CompanyIntelligenceError) {
    return res.status(e.httpStatus).json({ error: e.message, code: e.code });
  }
  console.error("company-intelligence", e);
  return res.status(500).json({ error: "Erro interno na consulta de CNPJ." });
}

export function registerCompanyIntelligenceRoutes(app: express.Express, auth: AuthGuards) {
  const { requireAppAuth, requirePermission, requireAnyPermission, getCurrentAppUser } = auth;
  const canView = requireAnyPermission([
    "customers.view",
    "crm.view",
    "crm.customer_cockpit.view",
  ]);

  app.get(
    "/api/company-intelligence/cnpj/:cnpj",
    requireAppAuth,
    canView,
    async (req, res) => {
      try {
        const user = await getCurrentAppUser(req);
        const forceRefresh = req.query.refresh === "true";
        const payload = await buildCompanyIntelligencePayload({
          cnpj: req.params.cnpj,
          forceRefresh,
          userId: user?.id ?? user?.email ?? null,
        });
        res.json(payload);
      } catch (e) {
        handleError(res, e);
      }
    }
  );

  app.get(
    "/api/customers/:id/company-intelligence",
    requireAppAuth,
    canView,
    async (req, res) => {
      try {
        const { id } = req.params;
        if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
        const user = await getCurrentAppUser(req);
        const { prisma } = await import("@/src/lib/prisma.js");
        const customer = await prisma.customer.findUnique({ where: { id } });
        if (!customer) return res.status(404).json({ error: "Cliente não encontrado." });

        const forceRefresh = req.query.refresh === "true";
        const payload = await buildCompanyIntelligencePayload({
          cnpj: customer.taxId,
          customerId: id,
          forceRefresh,
          userId: user?.id ?? user?.email ?? null,
        });
        const history = await getCustomerCompanyIntelligenceHistory(id);
        res.json({ ...payload, history });
      } catch (e) {
        handleError(res, e);
      }
    }
  );

  app.get(
    "/api/customers/:id/commercial-credit",
    requireAppAuth,
    canView,
    async (req, res) => {
      try {
        const { id } = req.params;
        if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
        const user = await getCurrentAppUser(req);
        const { prisma } = await import("@/src/lib/prisma.js");
        const customer = await prisma.customer.findUnique({ where: { id }, select: { id: true } });
        if (!customer) return res.status(404).json({ error: "Cliente não encontrado." });
        const { canViewFinanceAccountsReceivable } = await import(
          "@/src/lib/financeAccountsReceivablePermissions.js"
        );
        const { loadCustomerCommercialCreditIntelligence } = await import(
          "@/src/lib/commercial/commercialCreditDecision.server.js"
        );
        const revealFinancial = canViewFinanceAccountsReceivable({
          hasPermission: (key) =>
            Boolean(user && (user.permissions.includes(key) || user.effectivePermissions.includes(key))),
        });
        const view = await loadCustomerCommercialCreditIntelligence(prisma, id, { revealFinancial });
        const { corporateLinkReviewCapability } = await import("@/src/lib/commercial/corporateLinkReview.js");
        const capability = corporateLinkReviewCapability({
          role: user?.role ?? "",
          assignedPermissions: user?.permissions ?? [],
          isActive: user?.isActive,
        });
        res.json({
          ...view,
          canReviewCorporateLinks: capability.canReview,
          corporateLinkReviewBlockedReason: capability.reason,
        });
      } catch (e) {
        console.error("commercial-credit", e instanceof Error ? e.name : "error");
        res.status(500).json({ error: "Situação de crédito indisponível." });
      }
    }
  );

  app.post(
    "/api/customers/:id/corporate-links",
    requireAppAuth,
    canView,
    async (req, res) => {
      try {
        const { id } = req.params;
        if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
        const user = await getCurrentAppUser(req);
        if (!user) return res.status(401).json({ error: "Não autenticado." });
        const body = (req.body ?? {}) as { relatedCustomerId?: unknown; action?: unknown; justification?: unknown };
        const relatedCustomerId = typeof body.relatedCustomerId === "string" ? body.relatedCustomerId : "";
        const action = typeof body.action === "string" ? body.action : "";
        const justification = typeof body.justification === "string" ? body.justification : "";
        const { prisma } = await import("@/src/lib/prisma.js");
        const { reviewCorporateLinkRequest } = await import("@/src/lib/commercial/corporateLinkReview.server.js");
        // Mesma regra do canReviewCorporateLinks: SUPER_ADMIN pelo papel; demais pelas permissões atribuídas.
        const response = await reviewCorporateLinkRequest(prisma as never, {
          actor: { id: user.id, role: user.role, assignedPermissions: user.permissions, isActive: user.isActive },
          subjectCustomerId: id,
          relatedCustomerId,
          action,
          justification,
        });
        res.status(response.httpStatus).json(response.body);
      } catch (e) {
        console.error("corporate-link-review", e instanceof Error ? e.name : "error");
        res.status(500).json({ error: "Não foi possível registrar o vínculo." });
      }
    }
  );

  app.get(
    "/api/customers/:id/corporate-radar",
    requireAppAuth,
    canView,
    async (req, res) => {
      try {
        const { id } = req.params;
        if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
        const { prisma } = await import("@/src/lib/prisma.js");
        const customer = await prisma.customer.findUnique({ where: { id }, select: { id: true, taxId: true } });
        if (!customer) return res.status(404).json({ error: "Cliente não encontrado." });
        const { loadCustomerCorporateRadarView } = await import("@/src/lib/commercial/corporateRelation.server.js");
        res.json(await loadCustomerCorporateRadarView(prisma as never, customer, new Date()));
      } catch (error) {
        console.error("corporate-radar", error instanceof Error ? error.name : "error");
        res.status(500).json({ error: "Radar indisponível." });
      }
    }
  );

  app.get("/api/commercial/corporate-radar", requireAppAuth, canView, async (_req, res) => {
    try {
      const { prisma } = await import("@/src/lib/prisma.js");
      const model = (prisma as unknown as {
        commercialCorporateRadarSignal?: { findMany(args: unknown): Promise<unknown[]> };
      }).commercialCorporateRadarSignal;
      if (!model) return res.json({ persisted: false, signals: [] });
      const signals = await model.findMany({
        orderBy: [{ priorityRank: "asc" }, { evaluatedAt: "desc" }],
        take: 100,
        select: {
          pairKey: true,
          customerId: true,
          relatedCustomerId: true,
          classification: true,
          patternCodes: true,
          evidenceSummary: true,
          status: true,
          priorityRank: true,
          direction: true,
          evaluatedAt: true,
        },
      });
      res.json({ persisted: true, signals });
    } catch (error) {
      console.error("corporate-radar-list", error instanceof Error ? error.name : "error");
      res.json({ persisted: false, signals: [] });
    }
  });

  app.post("/api/commercial/corporate-radar/scan", requireAppAuth, canView, async (req, res) => {
    try {
      const body = (req.body ?? {}) as { dryRun?: unknown };
      const dryRun = body.dryRun !== false;
      const user = await getCurrentAppUser(req);
      if (!dryRun) {
        const { resolveCorporateLinkReviewAuthorization } = await import(
          "@/src/lib/commercial/corporateLinkReview.js"
        );
        const authorization = resolveCorporateLinkReviewAuthorization({
          role: user?.role ?? "",
          assignedPermissions: user?.permissions ?? [],
          isActive: user?.isActive,
        });
        if (authorization.ok === false) return res.status(403).json({ error: authorization.code });
      }
      const { prisma } = await import("@/src/lib/prisma.js");
      const customers = await prisma.customer.findMany({
        select: {
          id: true,
          taxId: true,
          companyName: true,
          phone: true,
          email: true,
          address: true,
          city: true,
          state: true,
          zipCode: true,
          updatedAt: true,
        },
        take: 5000,
      });
      let memberships: Array<{
        subjectCnpj: string;
        subjectCustomerId: string | null;
        memberNameKey?: string | null;
        memberName?: string | null;
        memberIdentityKey?: string | null;
        memberCnpj: string | null;
        source: string;
        consultedAt: Date;
      }> = [];
      try {
        memberships = await prisma.commercialCorporateMembership.findMany({
          select: {
            subjectCnpj: true,
            subjectCustomerId: true,
            memberNameKey: true,
            memberName: true,
            memberIdentityKey: true,
            memberCnpj: true,
            source: true,
            consultedAt: true,
          },
          orderBy: { consultedAt: "desc" },
          take: 20000,
        });
      } catch {
        memberships = await prisma.commercialCorporateMembership.findMany({
          select: {
            subjectCnpj: true,
            subjectCustomerId: true,
            memberIdentityKey: true,
            memberCnpj: true,
            source: true,
            consultedAt: true,
          },
          orderBy: { consultedAt: "desc" },
          take: 20000,
        });
      }
      const byCnpj = new Map(customers.map((row) => [row.taxId.replace(/\D/g, ""), row.id]));
      const { runCorporateRadar } = await import("@/src/lib/commercial/corporateRadar.server.js");
      const report = await runCorporateRadar({
        db: prisma as never,
        parties: customers.map((row) => ({
          customerId: row.id,
          cnpj: row.taxId,
          companyName: row.companyName,
          phone: row.phone,
          email: row.email,
          address: row.address,
          city: row.city,
          state: row.state,
          zipCode: row.zipCode,
          updatedAt: row.updatedAt,
        })),
        memberships: memberships.map((row) => ({
          subjectCustomerId: row.subjectCustomerId ?? byCnpj.get(row.subjectCnpj.replace(/\D/g, "")) ?? "",
          nameKey: row.memberNameKey,
          displayName: row.memberName,
          identityKey: row.memberIdentityKey,
          memberCnpj: row.memberCnpj,
          source: row.source,
          consultedAt: row.consultedAt.toISOString(),
        })).filter((row) => row.subjectCustomerId),
        mode: dryRun ? "dry-run" : "portfolio",
        dryRun,
        persist: !dryRun,
      });
      res.json({
        ...report,
        samples: report.samples.map((sample) => ({
          pairKey: sample.pairKey,
          classification: sample.classification,
          patternCodes: sample.patterns.map((pattern) => pattern.code),
          priorityRank: sample.priorityRank,
          priorityReasons: sample.priorityReasons,
          evidenceSummary: sample.evidenceSummary,
        })),
      });
    } catch (error) {
      console.error("corporate-radar-scan", error instanceof Error ? error.name : "error");
      res.status(500).json({ error: "Varredura do radar indisponível." });
    }
  });

  app.get(
    "/api/customers/:id/commercial-credit/history",
    requireAppAuth,
    canView,
    async (req, res) => {
      try {
        const { id } = req.params;
        if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
        const { prisma } = await import("@/src/lib/prisma.js");
        const { listCommercialCreditEvaluations } = await import(
          "@/src/lib/commercial/commercialCreditOperation.server.js"
        );
        const lines = await listCommercialCreditEvaluations(prisma as never, id);
        res.json({ available: true, lines });
      } catch (e) {
        console.error("commercial-credit-history", e instanceof Error ? e.name : "error");
        res.json({
          available: false,
          lines: [],
          message: "Histórico de crédito indisponível até a atualização de homologação.",
        });
      }
    }
  );

  app.post(
    "/api/commercial/credit-portfolio-filter",
    requireAppAuth,
    canView,
    async (req, res) => {
      try {
        const filter = req.body?.filter;
        const customerIds = Array.isArray(req.body?.customerIds) ? req.body.customerIds : [];
        if (filter !== "blocked" && filter !== "pending_protest" && filter !== "under_review") {
          return res.status(400).json({ error: "Filtro de crédito inválido." });
        }
        const ids = customerIds.filter((id: unknown) => typeof id === "string" && isUuid(id));
        const { prisma } = await import("@/src/lib/prisma.js");
        const { filterCustomersByCommercialCredit } = await import(
          "@/src/lib/commercial/commercialCreditOperation.server.js"
        );
        const result = await filterCustomersByCommercialCredit(prisma, { customerIds: ids, filter });
        res.json(result);
      } catch (e) {
        console.error("commercial-credit-filter", e instanceof Error ? e.name : "error");
        res.status(503).json({ error: "Filtro de crédito indisponível." });
      }
    }
  );

  app.post(
    "/api/customers/:id/company-intelligence/refresh",
    requireAppAuth,
    requirePermission("customers.view"),
    async (req, res) => {
      try {
        const { id } = req.params;
        if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
        const user = await getCurrentAppUser(req);
        const { prisma } = await import("@/src/lib/prisma.js");
        const customer = await prisma.customer.findUnique({ where: { id } });
        if (!customer) return res.status(404).json({ error: "Cliente não encontrado." });

        const payload = await buildCompanyIntelligencePayload({
          cnpj: customer.taxId,
          customerId: id,
          forceRefresh: true,
          userId: user?.id ?? user?.email ?? null,
        });
        res.json(payload);
      } catch (e) {
        handleError(res, e);
      }
    }
  );

  app.post(
    "/api/customers/:id/apply-company-intelligence",
    requireAppAuth,
    requirePermission("customers.edit"),
    async (req, res) => {
      try {
        const { id } = req.params;
        if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
        const lookupId = req.body?.lookupId;
        const selectedFields = Array.isArray(req.body?.selectedFields)
          ? req.body.selectedFields.map(String)
          : [];
        if (!isUuid(lookupId)) {
          return res.status(400).json({ error: "lookupId inválido." });
        }
        const user = await getCurrentAppUser(req);
        const result = await applyCompanyIntelligenceToCustomer({
          customerId: id,
          lookupId,
          selectedFields,
          confirmPublicContactOverwrite: Boolean(req.body?.confirmPublicContactOverwrite),
          userId: user?.id ?? user?.email ?? null,
        });
        res.json(result);
      } catch (e) {
        handleError(res, e);
      }
    }
  );

  app.post(
    "/api/customers/from-company-intelligence",
    requireAppAuth,
    requirePermission("customers.create"),
    async (req, res) => {
      try {
        const lookupId = req.body?.lookupId;
        if (!isUuid(lookupId)) {
          return res.status(400).json({ error: "lookupId inválido." });
        }
        const user = await getCurrentAppUser(req);
        const result = await createCustomerFromCompanyIntelligence({
          lookupId,
          overrides: req.body?.customer ?? req.body?.overrides ?? {},
          usePublicContactAsPrimary: Boolean(req.body?.usePublicContactAsPrimary),
          userId: user?.id ?? user?.email ?? null,
        });
        res.status(201).json(result);
      } catch (e) {
        if (e instanceof CompanyIntelligenceError && e.code === "DUPLICATE_TAX_ID") {
          const { prisma } = await import("@/src/lib/prisma.js");
          const lookup = await prisma.customerCnpjLookup.findUnique({ where: { id: req.body?.lookupId } });
          // Pelos dígitos: o cliente existente pode estar gravado com máscara.
          const { findCustomerIdByTaxIdDigits } = await import("@/src/lib/commercial/customerTaxIdIdentity.server.js");
          const existingCustomerId = lookup?.cnpj
            ? await findCustomerIdByTaxIdDigits(prisma, lookup.cnpj.replace(/\D/g, ""))
            : null;
          return res.status(409).json({
            error: e.message,
            code: e.code,
            existingCustomerId,
          });
        }
        handleError(res, e);
      }
    }
  );

  app.get(
    "/api/customers/:id/credit-occurrences",
    requireAppAuth,
    canView,
    async (req, res) => {
      try {
        const { id } = req.params;
        if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
        const { prisma } = await import("@/src/lib/prisma.js");
        const { listCommercialCreditOccurrences } = await import(
          "@/src/lib/commercial/commercialCreditOccurrence.server.js"
        );
        const occurrences = await listCommercialCreditOccurrences(prisma as never, id);
        res.json({ occurrences });
      } catch (e) {
        occurrenceError(res, e);
      }
    }
  );

  app.post(
    "/api/customers/:id/credit-occurrences",
    requireAppAuth,
    async (req, res) => {
      try {
        const { id } = req.params;
        if (!isUuid(id)) return res.status(400).json({ error: "ID inválido." });
        const user = await getCurrentAppUser(req);
        if (!user) return res.status(401).json({ error: "Não autenticado." });
        const { createCommercialCreditOccurrence, parseOccurrenceEvidences } = await import(
          "@/src/lib/commercial/commercialCreditOccurrence.server.js"
        );
        const { prisma } = await import("@/src/lib/prisma.js");
        const body = req.body ?? {};
        const occurrence = await createCommercialCreditOccurrence(prisma as never, {
          customerId: id,
          kind: String(body.kind ?? ""),
          titleExternalId: body.titleExternalId == null || body.titleExternalId === "" ? null : Number(body.titleExternalId),
          occurredAt: new Date(body.occurredAt),
          justification: String(body.justification ?? ""),
          evidences: parseOccurrenceEvidences(body.evidences),
          actor: { id: user.id, role: user.role, assignedPermissions: user.permissions },
        });
        res.status(201).json({ occurrence });
      } catch (e) {
        occurrenceError(res, e);
      }
    }
  );

  app.patch(
    "/api/customers/:id/credit-occurrences/:occurrenceId",
    requireAppAuth,
    async (req, res) => {
      try {
        const { id, occurrenceId } = req.params;
        if (!isUuid(id) || !isUuid(occurrenceId)) return res.status(400).json({ error: "ID inválido." });
        const user = await getCurrentAppUser(req);
        if (!user) return res.status(401).json({ error: "Não autenticado." });
        const { updateCommercialCreditOccurrence } = await import(
          "@/src/lib/commercial/commercialCreditOccurrence.server.js"
        );
        const { prisma } = await import("@/src/lib/prisma.js");
        const occurrence = await updateCommercialCreditOccurrence(prisma as never, {
          customerId: id,
          occurrenceId,
          justification: String(req.body?.justification ?? ""),
          actor: { id: user.id, role: user.role, assignedPermissions: user.permissions },
        });
        res.json({ occurrence });
      } catch (e) {
        occurrenceError(res, e);
      }
    }
  );

  app.post(
    "/api/customers/:id/credit-occurrences/:occurrenceId/regularize",
    requireAppAuth,
    async (req, res) => {
      await closeOccurrence(req, res, "REGULARIZATION");
    }
  );

  app.post(
    "/api/customers/:id/credit-occurrences/:occurrenceId/withdraw",
    requireAppAuth,
    async (req, res) => {
      await closeOccurrence(req, res, "PROTEST_WITHDRAWN");
    }
  );

  async function closeOccurrence(
    req: express.Request,
    res: express.Response,
    kind: "REGULARIZATION" | "PROTEST_WITHDRAWN"
  ) {
    try {
      const { id, occurrenceId } = req.params;
      if (!isUuid(id) || !isUuid(occurrenceId)) return res.status(400).json({ error: "ID inválido." });
      const user = await getCurrentAppUser(req);
      if (!user) return res.status(401).json({ error: "Não autenticado." });
      const { createCommercialCreditOccurrence, parseOccurrenceEvidences } = await import(
        "@/src/lib/commercial/commercialCreditOccurrence.server.js"
      );
      const { prisma } = await import("@/src/lib/prisma.js");
      const body = req.body ?? {};
      const occurrence = await createCommercialCreditOccurrence(prisma as never, {
        customerId: id,
        kind,
        closesOccurrenceId: occurrenceId,
        occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(),
        justification: String(body.justification ?? ""),
        evidences: parseOccurrenceEvidences(body.evidences),
        actor: { id: user.id, role: user.role, assignedPermissions: user.permissions },
      });
      res.status(201).json({ occurrence });
    } catch (e) {
      occurrenceError(res, e);
    }
  }
}
