/**
 * Lookups do cadastro de colaborador (RH).
 * Centros: FinancialCostCenter (fonte financeira oficial).
 * Gestores: employees ACTIVE.
 * Roles: Role (já existente).
 */

import type express from "express";
import type { RequestHandler } from "express";
import { prisma } from "@/src/lib/prisma.js";
import {
  formatManagerDisplayName,
  isEmployeeUuid,
} from "@/src/lib/employeeRegistration.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requirePermission: (permission: string) => RequestHandler;
  requireAnyPermission: (permissions: string[]) => RequestHandler;
};

const RH_LOOKUP = ["employees.view", "employees.edit"] as const;

export function registerEmployeeLookupRoutes(
  app: express.Application,
  guards: AuthGuards
): void {
  const { requireAppAuth, requireAnyPermission } = guards;
  const lookupGuard = [requireAppAuth, requireAnyPermission([...RH_LOOKUP])];

  app.get("/api/employees/lookups/cost-centers", ...lookupGuard, async (req, res) => {
    try {
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      const includeInactive = req.query.includeInactive === "1";
      const selectedId =
        typeof req.query.selectedId === "string" && isEmployeeUuid(req.query.selectedId)
          ? req.query.selectedId.trim()
          : null;

      const rows = await prisma.financialCostCenter.findMany({
        where: {
          AND: [
            q
              ? {
                  OR: [
                    { code: { contains: q, mode: "insensitive" as const } },
                    { name: { contains: q, mode: "insensitive" as const } },
                  ],
                }
              : {},
            selectedId
              ? { OR: [{ status: "ACTIVE" as const }, { id: selectedId }] }
              : includeInactive
                ? {}
                : { status: "ACTIVE" as const },
          ],
        },
        select: { id: true, code: true, name: true, status: true },
        orderBy: [{ code: "asc" }],
        take: 80,
      });

      res.json({
        rows: rows.map((r) => ({
          id: r.id,
          code: r.code,
          name: r.name,
          status: r.status,
          label: `${r.code} — ${r.name}${r.status !== "ACTIVE" ? " (inativo)" : ""}`,
        })),
      });
    } catch (error) {
      console.error("GET /api/employees/lookups/cost-centers", error);
      res.status(500).json({ error: "Erro ao listar centros de custo." });
    }
  });

  app.get("/api/employees/lookups/managers", ...lookupGuard, async (req, res) => {
    try {
      const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
      const excludeId =
        typeof req.query.excludeId === "string" && isEmployeeUuid(req.query.excludeId)
          ? req.query.excludeId.trim()
          : null;
      const includeInactive = req.query.includeInactive === "1";
      const selectedId =
        typeof req.query.selectedId === "string" && isEmployeeUuid(req.query.selectedId)
          ? req.query.selectedId.trim()
          : null;

      const rows = await prisma.employee.findMany({
        where: {
          AND: [
            excludeId ? { id: { not: excludeId } } : {},
            selectedId
              ? {
                  OR: [
                    { status: "ACTIVE" },
                    { status: null },
                    { id: selectedId },
                  ],
                }
              : includeInactive
                ? {}
                : { OR: [{ status: "ACTIVE" }, { status: null }] },
          ],
        },
        select: {
          id: true,
          name: true,
          socialName: true,
          department: true,
          status: true,
        },
        orderBy: { name: "asc" },
        take: 200,
      });

      const mapped = rows
        .map((r) => {
          const displayName = formatManagerDisplayName(r);
          const inactive = (r.status ?? "ACTIVE").toUpperCase() === "INACTIVE";
          return {
            id: r.id,
            name: r.name,
            socialName: r.socialName,
            department: r.department,
            status: r.status,
            displayName,
            label: `${displayName}${inactive ? " (inativo)" : ""}`,
            searchText: [displayName, r.name, r.socialName ?? "", r.department]
              .join(" ")
              .toLowerCase(),
          };
        })
        .filter((r) => !q || r.searchText.includes(q))
        .slice(0, 80);

      res.json({ rows: mapped });
    } catch (error) {
      console.error("GET /api/employees/lookups/managers", error);
      res.status(500).json({ error: "Erro ao listar gestores." });
    }
  });

  app.get("/api/employees/lookups/roles", ...lookupGuard, async (_req, res) => {
    try {
      const rows = await prisma.role.findMany({
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      });
      res.json({
        rows: rows.map((r) => ({
          id: r.id,
          name: r.name,
          label: r.name,
        })),
      });
    } catch (error) {
      console.error("GET /api/employees/lookups/roles", error);
      res.status(500).json({ error: "Erro ao listar cargos." });
    }
  });

  /** Status de vínculo com AppUser a partir do e-mail corporativo (sem criar login). */
  app.get(
    "/api/employees/:id/user-link-status",
    ...lookupGuard,
    async (req, res) => {
      try {
        const id = req.params.id;
        if (!isEmployeeUuid(id)) {
          return res.status(400).json({ error: "ID inválido." });
        }
        const emp = await prisma.employee.findUnique({
          where: { id },
          select: {
            id: true,
            corporateEmail: true,
            personalEmail: true,
            appUser: { select: { id: true, email: true, isActive: true, role: true } },
          },
        });
        if (!emp) return res.status(404).json({ error: "Colaborador não encontrado." });

        const email = (emp.corporateEmail || emp.personalEmail || "").trim().toLowerCase();
        let matchingUser = null as {
          id: string;
          email: string;
          employeeId: string | null;
        } | null;
        if (email && !emp.appUser) {
          matchingUser = await prisma.appUser.findFirst({
            where: { email: { equals: email, mode: "insensitive" } },
            select: { id: true, email: true, employeeId: true },
          });
        }

        const { resolveUserLinkStatus } = await import(
          "@/src/lib/employeeRegistration.js"
        );
        const link = resolveUserLinkStatus({
          linkedUser: emp.appUser,
          matchingUserByEmail: matchingUser,
        });

        res.json({
          employeeId: emp.id,
          corporateEmail: emp.corporateEmail,
          appUser: emp.appUser,
          link,
        });
      } catch (error) {
        console.error("GET /api/employees/:id/user-link-status", error);
        res.status(500).json({ error: "Erro ao consultar vínculo de usuário." });
      }
    }
  );

  /**
   * Vincula AppUser existente (mesmo e-mail) ao colaborador.
   * Não cria conta nem altera senha.
   */
  app.post(
    "/api/employees/:id/link-user",
    requireAppAuth,
    requireAnyPermission(["employees.edit", "users.manage"]),
    async (req, res) => {
      try {
        const id = req.params.id;
        if (!isEmployeeUuid(id)) {
          return res.status(400).json({ error: "ID inválido." });
        }
        const emp = await prisma.employee.findUnique({
          where: { id },
          select: {
            id: true,
            corporateEmail: true,
            appUser: { select: { id: true } },
          },
        });
        if (!emp) return res.status(404).json({ error: "Colaborador não encontrado." });
        if (emp.appUser) {
          return res.status(409).json({ error: "Este colaborador já possui usuário vinculado." });
        }
        const email = (emp.corporateEmail ?? "").trim().toLowerCase();
        if (!email) {
          return res.status(400).json({
            error: "Defina o e-mail corporativo antes de vincular o usuário.",
          });
        }
        const user = await prisma.appUser.findFirst({
          where: { email: { equals: email, mode: "insensitive" } },
          select: { id: true, employeeId: true, email: true },
        });
        if (!user) {
          return res.status(404).json({
            error: "Nenhum usuário encontrado com este e-mail corporativo.",
          });
        }
        if (user.employeeId && user.employeeId !== id) {
          return res.status(409).json({
            error: "Este usuário já está vinculado a outra pessoa.",
          });
        }
        const updated = await prisma.appUser.update({
          where: { id: user.id },
          data: { employeeId: id },
          select: { id: true, email: true, isActive: true, role: true },
        });
        console.info(
          JSON.stringify({
            audit: "employee.link_user",
            employeeId: id,
            appUserId: updated.id,
            at: new Date().toISOString(),
          })
        );
        res.json({ ok: true, appUser: updated });
      } catch (error) {
        console.error("POST /api/employees/:id/link-user", error);
        res.status(500).json({ error: "Erro ao vincular usuário." });
      }
    }
  );
}
