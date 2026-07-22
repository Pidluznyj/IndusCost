/**
 * Rotas da estrutura organizacional RH (Diretoria / Departamento).
 */
import type express from "express";
import type { RequestHandler } from "express";
import { prisma } from "@/src/lib/prisma.js";
import {
  EMPLOYEES_ACTIONS,
  EMPLOYEES_RESOURCE_KEYS,
} from "@/src/lib/employeesAccess.js";
import { HrOrgStructureError } from "@/src/lib/hrOrgStructure.js";
import {
  createHrDepartment,
  createHrDirectorate,
  listHrDepartments,
  listHrDirectorates,
  updateHrDepartment,
  updateHrDirectorate,
} from "@/src/lib/hrOrgStructure.server.js";
import { loadHrOrgChart } from "@/src/lib/hrOrgChart.server.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
};

export function registerHrOrgStructureRoutes(
  app: express.Application,
  guards: AuthGuards
): void {
  const { requireAppAuth, requireResource } = guards;
  const viewGuard = [
    requireAppAuth,
    requireResource(EMPLOYEES_RESOURCE_KEYS.module, EMPLOYEES_ACTIONS.view),
  ];
  const manageGuard = [
    requireAppAuth,
    requireResource(EMPLOYEES_RESOURCE_KEYS.module, EMPLOYEES_ACTIONS.update),
  ];
  const createGuard = [
    requireAppAuth,
    requireResource(EMPLOYEES_RESOURCE_KEYS.module, EMPLOYEES_ACTIONS.create),
  ];

  function handleOrgError(res: express.Response, error: unknown, fallback: string) {
    if (error instanceof HrOrgStructureError) {
      return res.status(error.status).json({
        error: error.message,
        code: error.code,
      });
    }
    console.error(fallback, error);
    return res.status(500).json({ error: fallback });
  }

  app.get("/api/employees/org/chart", ...viewGuard, async (req, res) => {
    try {
      const includeInactive =
        typeof req.query.includeInactive === "string" &&
        ["1", "true", "yes"].includes(req.query.includeInactive.trim().toLowerCase());
      const chart = await loadHrOrgChart(prisma, {
        includeInactiveUnits: includeInactive,
        organizationName: "Organização",
      });
      res.json({ chart });
    } catch (error) {
      handleOrgError(res, error, "Erro ao carregar organograma.");
    }
  });

  app.get("/api/employees/org/directorates", ...viewGuard, async (_req, res) => {
    try {
      const rows = await listHrDirectorates(prisma);
      res.json({ rows });
    } catch (error) {
      handleOrgError(res, error, "Erro ao listar diretorias.");
    }
  });

  app.post("/api/employees/org/directorates", ...createGuard, async (req, res) => {
    try {
      const row = await createHrDirectorate(prisma, req.body ?? {});
      res.status(201).json(row);
    } catch (error) {
      handleOrgError(res, error, "Erro ao criar diretoria.");
    }
  });

  app.put("/api/employees/org/directorates/:id", ...manageGuard, async (req, res) => {
    try {
      const row = await updateHrDirectorate(
        prisma,
        String(req.params.id ?? ""),
        req.body ?? {}
      );
      res.json(row);
    } catch (error) {
      handleOrgError(res, error, "Erro ao atualizar diretoria.");
    }
  });

  app.get("/api/employees/org/departments", ...viewGuard, async (req, res) => {
    try {
      const directorateId =
        typeof req.query.directorateId === "string" ? req.query.directorateId : null;
      const statusRaw =
        typeof req.query.status === "string" ? req.query.status.trim().toUpperCase() : null;
      const status =
        statusRaw === "ACTIVE" || statusRaw === "INACTIVE" ? statusRaw : null;
      const rows = await listHrDepartments(prisma, { directorateId, status });
      res.json({ rows });
    } catch (error) {
      handleOrgError(res, error, "Erro ao listar departamentos.");
    }
  });

  app.post("/api/employees/org/departments", ...createGuard, async (req, res) => {
    try {
      const row = await createHrDepartment(prisma, req.body ?? {});
      res.status(201).json(row);
    } catch (error) {
      handleOrgError(res, error, "Erro ao criar departamento.");
    }
  });

  app.put("/api/employees/org/departments/:id", ...manageGuard, async (req, res) => {
    try {
      const row = await updateHrDepartment(
        prisma,
        String(req.params.id ?? ""),
        req.body ?? {}
      );
      res.json(row);
    } catch (error) {
      handleOrgError(res, error, "Erro ao atualizar departamento.");
    }
  });

  /** Lookup para ficha do colaborador — só departamentos ACTIVE. */
  app.get(
    "/api/employees/lookups/org-departments",
    ...viewGuard,
    async (req, res) => {
      try {
        const q =
          typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
        const directorateId =
          typeof req.query.directorateId === "string"
            ? req.query.directorateId.trim()
            : null;
        const rows = await listHrDepartments(prisma, {
          directorateId,
          status: "ACTIVE",
        });
        const filtered = q
          ? rows.filter((r) => {
              const hay = `${r.name} ${r.code ?? ""} ${r.directorate?.name ?? ""}`.toLowerCase();
              return hay.includes(q);
            })
          : rows;
        res.json({
          rows: filtered.map((r) => ({
            id: r.id,
            label: r.directorate
              ? `${r.name} · ${r.directorate.name}`
              : r.name,
            name: r.name,
            code: r.code,
            directorateId: r.directorateId,
            directorateName: r.directorate?.name ?? null,
            leaderEmployeeId: r.leaderEmployeeId,
            leaderName: r.leader?.name ?? null,
            parentDepartmentId: r.parentDepartmentId,
            parentDepartmentName: r.parentDepartment?.name ?? null,
            parentDepartmentLeaderEmployeeId:
              r.parentDepartment?.leaderEmployeeId ?? null,
            parentDepartmentLeaderName: r.parentDepartment?.leaderName ?? null,
            directorateLeaderEmployeeId:
              r.directorate?.leaderEmployeeId ?? null,
            directorateLeaderName: r.directorate?.leaderName ?? null,
          })),
        });
      } catch (error) {
        handleOrgError(res, error, "Erro ao buscar departamentos oficiais.");
      }
    }
  );
}
