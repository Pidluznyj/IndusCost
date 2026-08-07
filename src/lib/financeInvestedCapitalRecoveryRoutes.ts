/**
 * Rotas — Financeiro > Recuperação do Dinheiro Investido.
 * Tela analítica somente leitura: consome os motores oficiais
 * (Resultado Industrial + Contas a Receber), sem regra de negócio própria.
 */
import type express from "express";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { prisma } from "@/src/lib/prisma.js";
import {
  FINANCE_MODULE_ACTIONS,
  FINANCE_MODULE_RESOURCE_KEYS,
} from "@/src/lib/financeModulesAccess.js";
import { getSalesOrderInvestedCapitalRecoveryPayload } from "@/src/lib/finance/salesOrderInvestedCapitalRecoveryService.server.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

export function registerFinanceInvestedCapitalRecoveryRoutes(
  app: express.Express,
  auth: AuthGuards
): void {
  const { requireAppAuth, requireResource } = auth;
  const guard = [
    requireAppAuth,
    requireResource(
      FINANCE_MODULE_RESOURCE_KEYS.investedCapitalRecovery,
      FINANCE_MODULE_ACTIONS.view
    ),
  ] as const;

  app.get(
    "/api/finance/invested-capital-recovery",
    ...guard,
    async (req: express.Request, res: express.Response) => {
      try {
        const payload = await getSalesOrderInvestedCapitalRecoveryPayload(prisma, {
          query: req.query as Record<string, unknown>,
        });
        res.json({ ok: true, ...payload });
      } catch (err) {
        res.status(500).json({
          ok: false,
          message: err instanceof Error ? err.message : "Erro ao carregar Recuperação do Dinheiro Investido.",
        });
      }
    }
  );
}
