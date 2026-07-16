import type express from "express";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { buildExecutiveDashboardSummary } from "@/src/lib/executiveDashboardService.js";

type ExecutiveAuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

export function registerExecutiveDashboardRoutes(
  app: express.Express,
  auth: ExecutiveAuthGuards
) {
  const { requireAppAuth, requireResource, getCurrentAppUser } = auth;

  app.get(
    "/api/dashboard/executive-summary",
    requireAppAuth,
    requireResource("dashboard", "view"),
    async (req, res) => {
      try {
        const user = await getCurrentAppUser(req);
        if (!user) {
          return res.status(401).json({ error: "Não autenticado." });
        }
        const summary = await buildExecutiveDashboardSummary(user, req.query.year);
        return res.json(summary);
      } catch (error) {
        console.error("GET /api/dashboard/executive-summary", error);
        return res.status(500).json({ error: "Erro ao montar visão executiva do dashboard." });
      }
    }
  );
}
