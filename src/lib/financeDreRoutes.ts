import type express from "express";
import type { RequestHandler } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  FinanceDreParseError,
  parseFinanceDreQuery,
} from "@/src/lib/financeDreService.server.js";
import {
  refreshFinanceDreSnapshot,
  resolveFinanceDreReportWithSnapshot,
} from "@/src/lib/financeDreSnapshot.server.js";
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
import {
  listDreCostCenterMappings,
  replaceDreCostCenterMappings,
} from "@/src/lib/financeDreCostCenterMapping.server.js";
import { isDreCostCenterRole } from "@/src/lib/financeDreCostCenterRoles.js";
import { prisma } from "@/src/lib/prisma.js";

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
      const payload = await resolveFinanceDreReportWithSnapshot(
        req.query as Record<string, unknown>
      );
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
      const payload = await resolveFinanceDreReportWithSnapshot(
        req.query as Record<string, unknown>
      );
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

  app.get("/api/finance/dre/cost-center-mappings", ...guard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) {
        return res.status(401).json({ error: "Não autenticado." });
      }
      const mappings = await listDreCostCenterMappings(prisma);
      return res.json({
        schemaVersion: 1,
        mappings,
        note: "Linhas de NF-e/CMV da DRE não são afetadas por esta parametrização.",
      });
    } catch (error) {
      console.error("GET /api/finance/dre/cost-center-mappings", error);
      return res.status(500).json({ error: "Erro ao listar mapeamentos de centros de custo da DRE." });
    }
  });

  const manageGuard = [
    requireAppAuth,
    requireResource(FINANCE_MODULE_RESOURCE_KEYS.dre, FINANCE_MODULE_ACTIONS.manage),
  ] as const;

  /**
   * Força a recomputação do snapshot anual (year/company) — cálculo pesado,
   * por isso restrito a `manage`. Usuários com `view` seguem lendo snapshot
   * FRESH/STALE; o refresh automático server-side independe de permissão.
   */
  app.post("/api/finance/dre/refresh", ...manageGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) {
        return res.status(401).json({ error: "Não autenticado." });
      }
      const filters = parseFinanceDreQuery(
        (req.body ?? {}) as Record<string, unknown>
      );
      const result = await refreshFinanceDreSnapshot(prisma, {
        year: filters.year,
        company: filters.company,
        forceAllEntities: true,
      });
      if (result.status === "already_running") {
        return res.status(409).json({
          error: "Já existe uma atualização em andamento para este período.",
          status: result.status,
        });
      }
      if (result.status === "error") {
        return res.status(500).json({
          error: `Falha ao atualizar o snapshot da DRE: ${result.error ?? "erro desconhecido"}`,
          status: result.status,
        });
      }
      return res.json({
        schemaVersion: 1,
        status: result.status,
        year: result.year,
        company: result.company,
        computedAt: result.computedAt,
        computeDurationMs: result.computeDurationMs,
        entitiesRefreshed: result.entitiesRefreshed,
      });
    } catch (error) {
      if (error instanceof FinanceDreParseError) {
        return res.status(400).json({ error: error.message });
      }
      console.error("POST /api/finance/dre/refresh", error);
      return res.status(500).json({ error: "Erro ao atualizar o snapshot da DRE Gerencial." });
    }
  });

  app.put("/api/finance/dre/cost-center-mappings", ...manageGuard, async (req, res) => {
    try {
      const user = await getCurrentAppUser(req);
      if (!user) {
        return res.status(401).json({ error: "Não autenticado." });
      }
      const raw = Array.isArray(req.body?.mappings) ? req.body.mappings : null;
      if (!raw) {
        return res.status(400).json({ error: "Body inválido: esperado { mappings: [...] }." });
      }
      const items: Array<{ costCenterId: string; role: string }> = [];
      for (const row of raw) {
        const costCenterId = String(row?.costCenterId ?? "").trim();
        const role = String(row?.role ?? "").trim();
        if (!costCenterId || !isDreCostCenterRole(role)) {
          return res.status(400).json({
            error: `Mapeamento inválido: costCenterId/role (${costCenterId || "?"} / ${role || "?"}).`,
          });
        }
        items.push({ costCenterId, role });
      }
      const mappings = await replaceDreCostCenterMappings(
        prisma,
        items.map((i) => ({ costCenterId: i.costCenterId, role: i.role as never })),
        user.id
      );
      return res.json({
        schemaVersion: 1,
        mappings,
        note: "Linhas de NF-e/CMV da DRE não são afetadas por esta parametrização.",
      });
    } catch (error) {
      console.error("PUT /api/finance/dre/cost-center-mappings", error);
      return res.status(500).json({ error: "Erro ao salvar mapeamentos de centros de custo da DRE." });
    }
  });
}
