import type express from "express";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { buildOfficialNomusAccountsPayableSummaryResponse } from "@/src/lib/financeAccountsPayableRulesAdapter.js";
import { loadFinanceApManagementRowsFromPrisma } from "@/src/lib/financeAccountsPayableDashboard.js";
import { prisma } from "@/src/lib/prisma.js";
import {
  FINANCE_AP_ACTIONS,
  FINANCE_AP_RESOURCE_KEY,
} from "@/src/lib/financeAccountsPayableAccess.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

export function registerNomusAccountsPayableRoutes(app: express.Express, auth: AuthGuards) {
  const { requireAppAuth, requireResource, getCurrentAppUser } = auth;

  app.get(
    "/api/nomus/accounts-payable/summary",
    requireAppAuth,
    requireResource(FINANCE_AP_RESOURCE_KEY, FINANCE_AP_ACTIONS.view),
    async (req, res) => {
      try {
        const user = await getCurrentAppUser(req);
        if (!user) {
          return res.status(401).json({ error: "Não autenticado." });
        }

        const { rows, syncCutoff } = await loadFinanceApManagementRowsFromPrisma(prisma, {
          status: "all",
        });
        const response = buildOfficialNomusAccountsPayableSummaryResponse({
          rows,
          filters: { status: "all" },
          referenceDate: new Date(),
          syncCutoff,
        });
        return res.json(response);
      } catch (error) {
        console.error("GET /api/nomus/accounts-payable/summary", error);
        return res.status(500).json({ error: "Erro ao montar resumo de contas a pagar." });
      }
    }
  );
}
