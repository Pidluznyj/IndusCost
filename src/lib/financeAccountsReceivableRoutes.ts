import type express from "express";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  buildFinanceAccountsReceivableDashboard,
  mapPrismaRowToFinanceArDashboardRow,
  parseFinanceArDashboardFilters,
} from "@/src/lib/financeAccountsReceivableDashboard.js";
import { prisma } from "@/src/lib/prisma.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireAnyPermission: (permissions: string[]) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

/** Permissões do dashboard AR — ver docs/generated/finance-accounts-receivable-dashboard-report.md */
export const FINANCE_AR_DASHBOARD_VIEW_PERMISSIONS = [
  "finance.accountsReceivable.view",
  "finance.view",
  "reports.view",
  "settings.nomus.view",
  "settings.view",
] as const;

export function registerFinanceAccountsReceivableRoutes(app: express.Express, auth: AuthGuards) {
  const { requireAppAuth, requireAnyPermission, getCurrentAppUser } = auth;

  app.get(
    "/api/finance/accounts-receivable/dashboard",
    requireAppAuth,
    requireAnyPermission([...FINANCE_AR_DASHBOARD_VIEW_PERMISSIONS]),
    async (req, res) => {
      try {
        const user = await getCurrentAppUser(req);
        if (!user) {
          return res.status(401).json({ error: "Não autenticado." });
        }

        const filters = parseFinanceArDashboardFilters(req.query as Record<string, unknown>);
        const rows = await prisma.nomusAccountsReceivable.findMany({
          select: {
            externalId: true,
            companyName: true,
            personName: true,
            personCnpj: true,
            dueDate: true,
            settlementDate: true,
            amountReceivable: true,
            amountReceived: true,
            balanceReceivable: true,
            paymentMethodName: true,
            bankAccountName: true,
            sourceInvoiceId: true,
            sourceInvoiceNumber: true,
            suspendCollection: true,
            syncedAt: true,
          },
        });

        const payload = buildFinanceAccountsReceivableDashboard(
          rows.map(mapPrismaRowToFinanceArDashboardRow),
          filters
        );
        return res.json(payload);
      } catch (error) {
        console.error("GET /api/finance/accounts-receivable/dashboard", error);
        return res.status(500).json({ error: "Erro ao montar dashboard de contas a receber." });
      }
    }
  );
}
