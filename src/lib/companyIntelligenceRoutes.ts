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
        res.json(view);
      } catch (e) {
        console.error("commercial-credit", e instanceof Error ? e.name : "error");
        res.status(500).json({ error: "Situação de crédito indisponível." });
      }
    }
  );

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
          const taxId = lookup?.cnpj;
          const existing = taxId
            ? await prisma.customer.findUnique({ where: { taxId } })
            : null;
          return res.status(409).json({
            error: e.message,
            code: e.code,
            existingCustomerId: existing?.id ?? null,
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
