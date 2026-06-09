import type express from "express";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { buildFinanceBillingDashboard } from "@/src/lib/financeBillingDashboard.js";
import { FINANCE_BILLING_VIEW_PERMISSIONS } from "@/src/lib/financeBillingPermissions.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireAnyPermission: (permissions: string[]) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

export function registerFinanceBillingRoutes(app: express.Express, auth: AuthGuards) {
  const { requireAppAuth, requireAnyPermission, getCurrentAppUser } = auth;
  const guard = [requireAppAuth, requireAnyPermission([...FINANCE_BILLING_VIEW_PERMISSIONS])] as const;

  app.get("/api/finance/billing/dashboard", ...guard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) {
        return res.status(401).json({ error: "Não autenticado." });
      }

      const payload = await buildFinanceBillingDashboard(req.query.year);
      return res.json(payload);
    } catch (error) {
      console.error("GET /api/finance/billing/dashboard", error);
      return res.status(500).json({ error: "Não foi possível carregar o faturamento. Tente novamente." });
    }
  });
}
