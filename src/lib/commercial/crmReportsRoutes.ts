/**
 * CRM > Relatórios — rotas HTTP.
 *
 * POST /api/crm/reports/operational
 *   Leitura via POST porque `customerSelection.customerIds` pode ser grande.
 *   Não escreve nada.
 *
 * Guardas (nesta ordem): sessão → recurso da Carteira de Clientes
 * (`commercial.crm.portfolio:view`) → escopo comercial do CRM
 * (`requireCrmCommercialDataScope`: global | own; none → 403). O relatório
 * mostra só dados já visíveis na carteira — não abre acesso novo.
 */

import type express from "express";
import type { RequestHandler } from "express";
import type { PrismaClient } from "@prisma/client";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { requireCrmCommercialDataScope } from "@/src/lib/crmCommercialAccessScope.js";
import { COMMERCIAL_ACTIONS, COMMERCIAL_RESOURCE_KEYS } from "@/src/lib/commercialAccess.js";
import { parseCrmReportsOperationalRequest } from "@/src/lib/commercial/crmReportsOperationalCore.js";
import {
  CrmReportsCapacityError,
  CrmReportsForbiddenError,
  createPrismaCrmReportsDataSource,
  loadCrmReportsOperational,
  type CrmReportsDataSource,
} from "@/src/lib/commercial/crmReportsOperationalService.server.js";

export const CRM_REPORTS_OPERATIONAL_PATH = "/api/crm/reports/operational";

export type CrmReportsRoutesDeps = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
  prisma: PrismaClient;
  /** Injeção para testes; default = Prisma. */
  createDataSource?: (prisma: PrismaClient) => CrmReportsDataSource;
  /** Injeção para testes; default = relógio do servidor. */
  now?: () => Date;
};

export function registerCrmReportsRoutes(app: express.Application, deps: CrmReportsRoutesDeps): void {
  const { requireAppAuth, requireResource, getCurrentAppUser } = deps;

  app.post(
    CRM_REPORTS_OPERATIONAL_PATH,
    requireAppAuth,
    requireResource(COMMERCIAL_RESOURCE_KEYS.crmReports, COMMERCIAL_ACTIONS.view),
    async (req, res) => {
      try {
        const authUser = await getCurrentAppUser(req);
        if (!authUser) {
          res.status(401).json({ error: "UNAUTHORIZED", message: "Autenticação necessária." });
          return;
        }
        const scopeResult = requireCrmCommercialDataScope(authUser);
        if (scopeResult.ok === false) {
          res.status(scopeResult.status).json(scopeResult.body);
          return;
        }
        const parsed = parseCrmReportsOperationalRequest(req.body);
        if (parsed.ok === false) {
          res.status(400).json({
            error: "VALIDATION",
            message: parsed.errors.join(" "),
            details: parsed.errors,
          });
          return;
        }
        const dataSource = (deps.createDataSource ?? createPrismaCrmReportsDataSource)(deps.prisma);
        const payload = await loadCrmReportsOperational(dataSource, scopeResult.scope, parsed.request, {
          now: deps.now?.(),
        });
        res.json(payload);
      } catch (error) {
        if (error instanceof CrmReportsForbiddenError) {
          res.status(403).json({ error: "FORBIDDEN", message: error.message });
          return;
        }
        if (error instanceof CrmReportsCapacityError) {
          res.status(422).json({
            error: "REPORT_UNIVERSE_TOO_LARGE",
            message: error.message,
            ordersLoaded: error.ordersLoaded,
            limit: error.limit,
          });
          return;
        }
        console.error(`POST ${CRM_REPORTS_OPERATIONAL_PATH}`, error);
        res.status(500).json({
          error: "INTERNAL_ERROR",
          message: "Erro ao montar os relatórios operacionais do CRM.",
        });
      }
    }
  );
}
