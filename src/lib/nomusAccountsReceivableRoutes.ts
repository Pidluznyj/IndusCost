import type express from "express";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { buildOfficialNomusAccountsReceivableSummaryResponse } from "@/src/lib/financeAccountsReceivableRulesAdapter.js";
import { loadFinanceArManagementRowsFromPrisma } from "@/src/lib/financeAccountsReceivableManagement.server.js";
import { prisma } from "@/src/lib/prisma.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireAnyPermission: (permissions: string[]) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

export function registerNomusAccountsReceivableRoutes(app: express.Express, auth: AuthGuards) {
  const { requireAppAuth, requireAnyPermission, getCurrentAppUser } = auth;

  app.get(
    "/api/nomus/accounts-receivable/summary",
    requireAppAuth,
    requireAnyPermission(["reports.view", "settings.nomus.view", "settings.view"]),
    async (req, res) => {
      try {
        const user = await getCurrentAppUser(req);
        if (!user) {
          return res.status(401).json({ error: "Não autenticado." });
        }

        const { rows, syncCutoff } = await loadFinanceArManagementRowsFromPrisma(prisma, {
          status: "all",
        });
        const response = buildOfficialNomusAccountsReceivableSummaryResponse({
          rows,
          filters: { status: "all" },
          referenceDate: new Date(),
          syncCutoff,
        });
        return res.json(response);
      } catch (error) {
        console.error("GET /api/nomus/accounts-receivable/summary", error);
        return res.status(500).json({ error: "Erro ao montar resumo de contas a receber." });
      }
    }
  );
}
