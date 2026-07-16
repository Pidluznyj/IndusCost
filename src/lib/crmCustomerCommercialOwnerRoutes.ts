import type express from "express";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  fetchActiveCommercialSellers,
  getCustomerCommercialOwnerPayload,
  patchCustomerCommercialOwner,
} from "@/src/lib/crmCustomerCommercialOwner.js";
import {
  COMMERCIAL_ACTIONS,
  COMMERCIAL_RESOURCE_KEYS,
} from "@/src/lib/commercialAccess.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

export function registerCrmCustomerCommercialOwnerRoutes(
  app: express.Application,
  guards: AuthGuards
): void {
  const { requireAppAuth, requireResource, getCurrentAppUser } = guards;

  app.get(
    "/api/crm/commercial-sellers/active",
    requireAppAuth,
    requireResource(COMMERCIAL_RESOURCE_KEYS.crm, COMMERCIAL_ACTIONS.view),
    async (req, res) => {
      try {
        const query = typeof req.query.query === "string" ? req.query.query : undefined;
        const rows = await fetchActiveCommercialSellers(query);
        res.json({ rows });
      } catch (error) {
        console.error("GET /api/crm/commercial-sellers/active", error);
        res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao listar vendedores." });
      }
    }
  );

  app.get(
    "/api/crm/customers/:customerId/commercial-owner",
    requireAppAuth,
    requireResource(COMMERCIAL_RESOURCE_KEYS.crmCustomer360, COMMERCIAL_ACTIONS.view),
    async (req, res) => {
      try {
        const authUser = await getCurrentAppUser(req);
        if (!authUser) {
          res.status(401).json({ error: "UNAUTHORIZED" });
          return;
        }
        const customerId = String(req.params.customerId ?? "").trim();
        const payload = await getCustomerCommercialOwnerPayload(customerId, authUser);
        if (!payload) {
          res.status(404).json({ error: "NOT_FOUND", message: "Cliente não encontrado." });
          return;
        }
        res.json(payload);
      } catch (error) {
        console.error("GET /api/crm/customers/:customerId/commercial-owner", error);
        res.status(500).json({
          error: "INTERNAL_ERROR",
          message: "Erro ao carregar responsável comercial.",
        });
      }
    }
  );

  app.patch(
    "/api/crm/customers/:customerId/commercial-owner",
    requireAppAuth,
    requireResource(COMMERCIAL_RESOURCE_KEYS.crmAssignSeller, COMMERCIAL_ACTIONS.manage),
    async (req, res) => {
      try {
        const authUser = await getCurrentAppUser(req);
        if (!authUser) {
          res.status(401).json({ error: "UNAUTHORIZED" });
          return;
        }
        const customerId = String(req.params.customerId ?? "").trim();
        const body = req.body as {
          sellerOptionKey?: string | null;
          clear?: boolean;
          notes?: string | null;
        };
        const result = await patchCustomerCommercialOwner({
          customerId,
          auth: authUser,
          sellerOptionKey: body.sellerOptionKey,
          clear: body.clear === true,
          notes: body.notes,
        });
        if (result.ok === false) {
          res.status(result.status).json(result.body);
          return;
        }
        res.json(result.payload);
      } catch (error) {
        console.error("PATCH /api/crm/customers/:customerId/commercial-owner", error);
        res.status(500).json({
          error: "INTERNAL_ERROR",
          message: "Erro ao atualizar responsável comercial.",
        });
      }
    }
  );
}
