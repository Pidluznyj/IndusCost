import type express from "express";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  buildFinanceExecutiveReport,
  FinanceExecutiveReportParseError,
} from "@/src/lib/financeExecutiveReport.js";
import { FINANCE_BILLING_VIEW_PERMISSIONS } from "@/src/lib/financeBillingPermissions.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireAnyPermission: (permissions: string[]) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

export const FINANCE_EXECUTIVE_REPORT_VIEW_PERMISSIONS = [
  ...FINANCE_BILLING_VIEW_PERMISSIONS,
  "finance.executiveReport.view",
] as const;

export function registerFinanceExecutiveReportRoutes(
  app: express.Express,
  auth: AuthGuards
) {
  const { requireAppAuth, requireAnyPermission, getCurrentAppUser } = auth;
  const guard = [
    requireAppAuth,
    requireAnyPermission([...FINANCE_EXECUTIVE_REPORT_VIEW_PERMISSIONS]),
  ] as const;

  app.get("/api/finance/executive-report", ...guard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) {
        return res.status(401).json({ error: "Não autenticado." });
      }

      const payload = await buildFinanceExecutiveReport(req.query as Record<string, unknown>);
      return res.json(payload);
    } catch (error) {
      if (error instanceof FinanceExecutiveReportParseError) {
        return res.status(400).json({ error: error.message });
      }
      console.error("GET /api/finance/executive-report", error);
      return res.status(500).json({ error: "Erro ao montar Relatório Presidencial." });
    }
  });
}
