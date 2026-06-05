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
}
