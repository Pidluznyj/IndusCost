import type express from "express";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  buildFinanceDreReport,
  FinanceDreParseError,
} from "@/src/lib/financeDreService.server.js";
import { buildFinanceDreCashBridgeReport } from "@/src/lib/financeDreCashBridge.server.js";
import { buildFinanceDreLineDrilldown } from "@/src/lib/financeDreDrilldown.server.js";
import { buildFinanceDreSourceCheckDrilldown } from "@/src/lib/financeDreSourceCheckDrilldown.server.js";
import {
  buildFinanceDreExportCsv,
  buildFinanceDreExportFilename,
} from "@/src/lib/financeDreExport.js";
import {
  FINANCE_MODULE_ACTIONS,
  FINANCE_MODULE_RESOURCE_KEYS,
} from "@/src/lib/financeModulesAccess.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

export function registerFinanceDreRoutes(app: express.Express, auth: AuthGuards) {
  const { requireAppAuth, requireResource, getCurrentAppUser } = auth;
  const guard = [
    requireAppAuth,
    requireResource(FINANCE_MODULE_RESOURCE_KEYS.dre, FINANCE_MODULE_ACTIONS.view),
  ] as const;

  app.get("/api/finance/dre", ...guard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) {
        return res.status(401).json({ error: "Não autenticado." });
      }
      const payload = await buildFinanceDreReport(req.query as Record<string, unknown>);
      return res.json(payload);
    } catch (error) {
      if (error instanceof FinanceDreParseError) {
        return res.status(400).json({ error: error.message });
      }
      console.error("GET /api/finance/dre", error);
      return res.status(500).json({ error: "Erro ao montar DRE Gerencial." });
    }
  });

  app.get("/api/finance/dre/export", ...guard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) {
        return res.status(401).json({ error: "Não autenticado." });
      }
      const payload = await buildFinanceDreReport(req.query as Record<string, unknown>);
      const csv = buildFinanceDreExportCsv(payload);
      const filename = buildFinanceDreExportFilename(payload);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      return res.send(csv);
    } catch (error) {
      if (error instanceof FinanceDreParseError) {
        return res.status(400).json({ error: error.message });
      }
      console.error("GET /api/finance/dre/export", error);
      return res.status(500).json({ error: "Erro ao exportar DRE Gerencial." });
    }
  });

  app.get("/api/finance/dre/cash-bridge", ...guard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) {
        return res.status(401).json({ error: "Não autenticado." });
      }
      const payload = await buildFinanceDreCashBridgeReport(
        req.query as Record<string, unknown>
      );
      return res.json(payload);
    } catch (error) {
      if (error instanceof FinanceDreParseError) {
        return res.status(400).json({ error: error.message });
      }
      console.error("GET /api/finance/dre/cash-bridge", error);
      return res.status(500).json({ error: "Erro ao montar a Ponte Lucro × Caixa." });
    }
  });

  app.get("/api/finance/dre/lines/:lineId/drilldown", ...guard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) {
        return res.status(401).json({ error: "Não autenticado." });
      }
      const lineId = String(req.params.lineId ?? "");
      const payload = await buildFinanceDreLineDrilldown(
        req.query as Record<string, unknown>,
        lineId
      );
      return res.json(payload);
    } catch (error) {
      if (error instanceof FinanceDreParseError) {
        return res.status(400).json({ error: error.message });
      }
      console.error("GET /api/finance/dre/lines/:lineId/drilldown", error);
      return res.status(500).json({ error: "Erro ao detalhar linha do DRE Gerencial." });
    }
  });

  app.get("/api/finance/dre/source-checks/:checkId/drilldown", ...guard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) {
        return res.status(401).json({ error: "Não autenticado." });
      }
      const checkId = String(req.params.checkId ?? "");
      const payload = await buildFinanceDreSourceCheckDrilldown(
        req.query as Record<string, unknown>,
        checkId
      );
      return res.json(payload);
    } catch (error) {
      if (error instanceof FinanceDreParseError) {
        return res.status(400).json({ error: error.message });
      }
      console.error("GET /api/finance/dre/source-checks/:checkId/drilldown", error);
      return res.status(500).json({
        error: "Erro ao detalhar validação de fonte do DRE Gerencial.",
      });
    }
  });
}
