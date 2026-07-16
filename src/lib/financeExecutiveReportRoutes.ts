import type express from "express";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  buildFinanceExecutiveReport,
  FinanceExecutiveReportParseError,
  parseFinanceExecutiveReportQuery,
  resolveExecutiveReportReferenceDate,
} from "@/src/lib/financeExecutiveReport.js";
import {
  buildExecutiveReportCashRadarForFilters,
  parseExecutiveReportCashRadarRangeKey,
} from "@/src/lib/financeExecutiveReportCashRadar.js";
import {
  FINANCE_MODULE_ACTIONS,
  FINANCE_MODULE_RESOURCE_KEYS,
} from "@/src/lib/financeModulesAccess.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

/** @deprecated Use FINANCE_MODULE_RESOURCE_KEYS.executiveReport + requireResource view. */
export const FINANCE_EXECUTIVE_REPORT_VIEW_PERMISSIONS = [
  "finance.executiveReport.view",
  "reports.view",
  "finance.view",
] as const;

export function registerFinanceExecutiveReportRoutes(
  app: express.Express,
  auth: AuthGuards
) {
  const { requireAppAuth, requireResource, getCurrentAppUser } = auth;
  const guard = [
    requireAppAuth,
    requireResource(
      FINANCE_MODULE_RESOURCE_KEYS.executiveReport,
      FINANCE_MODULE_ACTIONS.view
    ),
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

  app.get("/api/finance/executive-report/cash-radar", ...guard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) {
        return res.status(401).json({ error: "Não autenticado." });
      }

      const filters = parseFinanceExecutiveReportQuery(req.query as Record<string, unknown>);
      const referenceDate = resolveExecutiveReportReferenceDate(filters);
      const rangeKey = parseExecutiveReportCashRadarRangeKey(req.query.range);
      const day =
        typeof req.query.day === "string" && req.query.day.trim()
          ? req.query.day.trim()
          : undefined;
      const search = typeof req.query.search === "string" ? req.query.search : undefined;

      const cashRadar = await buildExecutiveReportCashRadarForFilters(filters, referenceDate, {
        rangeKey,
        day,
        search,
      });
      return res.json(cashRadar);
    } catch (error) {
      if (error instanceof FinanceExecutiveReportParseError) {
        return res.status(400).json({ error: error.message });
      }
      console.error("GET /api/finance/executive-report/cash-radar", error);
      return res.status(500).json({ error: "Erro ao carregar Radar Diário de Caixa do relatório." });
    }
  });
}
