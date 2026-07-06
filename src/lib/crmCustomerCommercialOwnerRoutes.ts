import type express from "express";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  CRM_CUSTOMER_COMMERCIAL_OWNER_ASSIGN_PERMISSION,
  fetchActiveCommercialSellers,
  getCustomerCommercialOwnerPayload,
  patchCustomerCommercialOwner,
} from "@/src/lib/crmCustomerCommercialOwner.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireAnyPermission: (permissions: string[]) => RequestHandler;
  requirePermission: (permission: string) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

const VIEW_PERMISSIONS = [
  "customers.view",
  "crm.view",
  "crm.customer_cockpit.view",
];

export function registerCrmCustomerCommercialOwnerRoutes(
  app: express.Application,
  guards: AuthGuards
): void {
  const { requireAppAuth, requireAnyPermission, requirePermission, getCurrentAppUser } = guards;

  app.get(
    "/api/crm/commercial-sellers/active",
    requireAppAuth,
    requireAnyPermission([...VIEW_PERMISSIONS, CRM_CUSTOMER_COMMERCIAL_OWNER_ASSIGN_PERMISSION]),
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
    requireAnyPermission(VIEW_PERMISSIONS),
    async (req, res) => {
      try {
        const auth = await getCurrentAppUser(req);
        if (!auth) {
          res.status(401).json({ error: "UNAUTHORIZED" });
          return;
        }
        const customerId = String(req.params.customerId ?? "").trim();
        const payload = await getCustomerCommercialOwnerPayload(customerId, auth);
        if (!payload) {
          res.status(404).json({ error: "NOT_FOUND", message: "Cliente não encontrado." });
          return;
        }
        res.json(payload);
      } catch (error) {
        console.error("GET /api/crm/customers/:customerId/commercial-owner", error);
        res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao carregar responsável comercial." });
      }
    }
  );

  app.patch(
    "/api/crm/customers/:customerId/commercial-owner",
    requireAppAuth,
    async (req, res) => {
      try {
        const auth = await getCurrentAppUser(req);
        if (!auth) {
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
          auth,
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
        res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao salvar responsável comercial." });
      }
    }
  );
}
