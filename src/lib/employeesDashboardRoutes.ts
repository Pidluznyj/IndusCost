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
}
