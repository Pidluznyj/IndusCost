/**
 * GET /api/employees/dashboard-summary — Dashboard de Pessoas / RH.
 *
 * Gate: bag legada (employees.dashboard.view | employees.edit) OU
 * requireResource(admin.employees.dashboard:view) para grants estruturados / SA.
 * (employees.edit é alias amplo — a projeção 1:1 do requireResource sozinha
 * não o eleva ao dashboard; o fallback de bag alinha API ↔ menu FE.)
 */
import type express from "express";
import type { RequestHandler } from "express";
import { prisma } from "@/src/lib/prisma.js";
import {
  EMPLOYEES_ACTIONS,
  EMPLOYEES_RESOURCE_KEYS,
} from "@/src/lib/employeesAccess.js";
import {
  canViewEmployeeSensitiveData,
  canViewEmployeesDashboard,
  type EmployeePermissionCheck,
} from "@/src/lib/employeesPermissions.js";
import { loadEmployeesDashboardSummary } from "@/src/lib/employeesDashboard.server.js";
import { exportEpiDeliveriesCsv, loadEpiReplacements } from "@/src/lib/epi/epiReplacements.server.js";
import { businessTodayIso } from "@/src/lib/competencies/competencyDomain.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
  getPermissionCheck: (req: express.Request) => Promise<EmployeePermissionCheck>;
};

export function registerEmployeesDashboardRoutes(
  app: express.Application,
  guards: AuthGuards
): void {
  const { requireAppAuth, requireResource, getPermissionCheck } = guards;

  const requireDashboardAccess: RequestHandler = async (req, res, next) => {
    try {
      const check = await getPermissionCheck(req);
      if (canViewEmployeesDashboard(check)) {
        return next();
      }
    } catch {
      // segue para requireResource
    }
    return requireResource(
      EMPLOYEES_RESOURCE_KEYS.dashboard,
      EMPLOYEES_ACTIONS.view
    )(req, res, next);
  };

  app.get(
    "/api/employees/dashboard-summary",
    requireAppAuth,
    requireDashboardAccess,
    async (req, res) => {
      try {
        const check = await getPermissionCheck(req);
        const includeCompensation = canViewEmployeeSensitiveData(check);
        const summary = await loadEmployeesDashboardSummary(
          prisma,
          req.query as Record<string, unknown>,
          { includeCompensation }
        );
        return res.json(summary);
      } catch (error) {
        console.error("GET /api/employees/dashboard-summary", error);
        return res.status(500).json({
          error: "Erro ao carregar dashboard de pessoas.",
        });
      }
    }
  );

  // Controle de EPIs e Uniformes: trocas vencidas e previstas para os próximos 60 dias.
  app.get(
    "/api/employees/epi-replacements",
    requireAppAuth,
    requireDashboardAccess,
    async (_req, res) => {
      try {
        res.setHeader("Cache-Control", "no-store");
        return res.json(await loadEpiReplacements(prisma, businessTodayIso(new Date())));
      } catch (error) {
        console.error("GET /api/employees/epi-replacements", error);
        return res.status(500).json({ error: "Erro ao carregar o controle de EPIs." });
      }
    }
  );

  // Relatório de entregas de EPI/uniforme (CSV), com período opcional pela data da entrega.
  app.get(
    "/api/employees/epi-deliveries/export",
    requireAppAuth,
    requireDashboardAccess,
    async (req, res) => {
      try {
        const day = (v: unknown) =>
          typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
        const csv = await exportEpiDeliveriesCsv(prisma, {
          from: day(req.query.from),
          to: day(req.query.to),
          todayIso: businessTodayIso(new Date()),
        });
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", 'attachment; filename="entregas-epi-uniformes.csv"');
        return res.send(csv);
      } catch (error) {
        console.error("GET /api/employees/epi-deliveries/export", error);
        return res.status(500).json({ error: "Erro ao exportar entregas de EPI." });
      }
    }
  );
}
