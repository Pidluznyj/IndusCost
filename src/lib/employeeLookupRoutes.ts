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
  assertCorporateEmailAppUserConflict,
  assertCorporateEmailFormat,
  assertCorporateEmailUnique,
  describeCorporateEmailAppUserHint,
  EmployeeRegistrationError,
  formatManagerDisplayName,
  isEmployeeUuid,
  normalizeCorporateEmail,
} from "@/src/lib/employeeRegistration.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requirePermission: (permission: string) => RequestHandler;
  requireAnyPermission: (permissions: string[]) => RequestHandler;
  getCurrentAppUser?: (
    req: express.Request
  ) => Promise<{ id?: string } | null> | { id?: string } | null;
};

const RH_LOOKUP = ["employees.view", "employees.edit"] as const;

export function registerEmployeeLookupRoutes(
  app: express.Application,
  guards: AuthGuards
): void {
  const { requireAppAuth, requireAnyPermission, getCurrentAppUser } = guards;
  const lookupGuard = [requireAppAuth, requireAnyPermission([...RH_LOOKUP])];

  async function resolveActorId(req: express.Request): Promise<string | null> {
    try {
      const raw = getCurrentAppUser?.(req);
      const user = raw && typeof (raw as Promise<unknown>).then === "function" ? await raw : raw;
      const id = (user as { id?: string } | null)?.id;
      return typeof id === "string" ? id : null;
    } catch {
      return null;
    }
  }

  /**
   * Pré-checagem de e-mail corporativo (formato, unicidade Employee, conflito AppUser).
   * Não cria login nem altera AppUser.
   */
  app.get("/api/employees/lookups/corporate-email", ...lookupGuard, async (req, res) => {
    try {
      const raw = typeof req.query.email === "string" ? req.query.email : "";
      const excludeEmployeeId =
        typeof req.query.excludeEmployeeId === "string" &&
        isEmployeeUuid(req.query.excludeEmployeeId)
          ? req.query.excludeEmployeeId.trim()
          : null;
      const email = normalizeCorporateEmail(raw);
      if (!email) {
        return res.json({
          email: null,
          valid: true,
          ok: true,
          code: null,
          message: null,
          appUserStatus: "none",
          hint: null,
        });
      }
      try {
        assertCorporateEmailFormat(email);
        await assertCorporateEmailUnique(prisma, email, excludeEmployeeId);
        const app = await assertCorporateEmailAppUserConflict(
          prisma,
          email,
          excludeEmployeeId
        );
        res.json({
          email,
          valid: true,
          ok: true,
          code: null,
          message: null,
          appUserStatus: app.status,
          hint: describeCorporateEmailAppUserHint(app),
        });
      } catch (err) {
        if (err instanceof EmployeeRegistrationError) {
          return res.status(err.status).json({
            email,
            valid: err.code !== "INVALID_CORPORATE_EMAIL",
            ok: false,
            code: err.code,
            message: err.message,
            appUserStatus:
              err.code === "CORPORATE_EMAIL_APPUSER_CONFLICT" ? "conflict" : null,
            hint: err.message,
          });
        }
        throw err;
      }
    } catch (error) {
      console.error("GET /api/employees/lookups/corporate-email", error);
      res.status(500).json({ error: "Erro ao validar e-mail corporativo." });
    }
  });

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
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
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
            q
              ? {
                  OR: [
                    { name: { contains: q, mode: "insensitive" as const } },
                    { socialName: { contains: q, mode: "insensitive" as const } },
                    { department: { contains: q, mode: "insensitive" as const } },
                    { corporateEmail: { contains: q, mode: "insensitive" as const } },
                  ],
                }
              : {},
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
        take: 80,
      });

      const mapped = rows.map((r) => {
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
        };
      });

      res.json({ rows: mapped });
    } catch (error) {
      console.error("GET /api/employees/lookups/managers", error);
      res.status(500).json({ error: "Erro ao listar gestores." });
    }
  });

  app.get("/api/employees/lookups/roles", ...lookupGuard, async (req, res) => {
    try {
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      const rows = await prisma.role.findMany({
        where: q
          ? { name: { contains: q, mode: "insensitive" as const } }
          : undefined,
        select: { id: true, name: true },
        orderBy: { name: "asc" },
        take: 80,
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

  /**
   * Sugestões de departamento/setor a partir de valores já usados em Employee.
   * Não é cadastro oficial — não há tabela própria; só autocomplete de texto livre.
   */
  app.get("/api/employees/lookups/departments", ...lookupGuard, async (req, res) => {
    try {
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      const rows = await prisma.employee.findMany({
        where: {
          AND: [
            { department: { not: "" } },
            q
              ? { department: { contains: q, mode: "insensitive" as const } }
              : {},
          ],
        },
        select: { department: true },
        distinct: ["department"],
        orderBy: { department: "asc" },
        take: 40,
      });
      const seen = new Set<string>();
      const suggestions: { value: string; label: string }[] = [];
      for (const r of rows) {
        const value = (r.department ?? "").trim();
        if (!value) continue;
        const key = value.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        suggestions.push({ value, label: value });
      }
      res.json({ rows: suggestions });
    } catch (error) {
      console.error("GET /api/employees/lookups/departments", error);
      res.status(500).json({ error: "Erro ao listar departamentos." });
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
        const { getEmployeeUserLinkStatus } = await import(
          "@/src/lib/employeeUserLink.server.js"
        );
        const payload = await getEmployeeUserLinkStatus(prisma, id);
        res.json(payload);
      } catch (error) {
        if (error instanceof EmployeeRegistrationError) {
          return res.status(error.status).json({ error: error.message, code: error.code });
        }
        console.error("GET /api/employees/:id/user-link-status", error);
        res.status(500).json({ error: "Erro ao consultar vínculo de usuário." });
      }
    }
  );

  /** Consulta AppUser por e-mail de login (sem criar / sem vincular). */
  app.get(
    "/api/employees/lookups/app-user-by-email",
    ...lookupGuard,
    async (req, res) => {
      try {
        const raw = typeof req.query.email === "string" ? req.query.email : "";
        const { findAppUserByLoginEmail } = await import(
          "@/src/lib/employeeUserLink.server.js"
        );
        const payload = await findAppUserByLoginEmail(prisma, raw);
        res.json(payload);
      } catch (error) {
        console.error("GET /api/employees/lookups/app-user-by-email", error);
        res.status(500).json({ error: "Erro ao consultar usuário por e-mail." });
      }
    }
  );

  /**
   * Vincula AppUser existente (mesmo e-mail corporativo) ao colaborador.
   * Não cria conta nem altera senha / e-mail de login.
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
        const { linkEmployeeToAppUser } = await import(
          "@/src/lib/employeeUserLink.server.js"
        );
        const result = await linkEmployeeToAppUser(prisma, id, {
          actorUserId: await resolveActorId(req),
        });
        res.json({ ok: true, appUser: result.appUser });
      } catch (error) {
        if (error instanceof EmployeeRegistrationError) {
          return res.status(error.status).json({ error: error.message, code: error.code });
        }
        console.error("POST /api/employees/:id/link-user", error);
        res.status(500).json({ error: "Erro ao vincular usuário." });
      }
    }
  );

  /**
   * Remove vínculo Employee ↔ AppUser.
   * Não desativa o usuário nem altera o e-mail de login.
   */
  app.post(
    "/api/employees/:id/unlink-user",
    requireAppAuth,
    requireAnyPermission(["employees.edit", "users.manage"]),
    async (req, res) => {
      try {
        const id = req.params.id;
        if (!isEmployeeUuid(id)) {
          return res.status(400).json({ error: "ID inválido." });
        }
        const { unlinkEmployeeFromAppUser } = await import(
          "@/src/lib/employeeUserLink.server.js"
        );
        const result = await unlinkEmployeeFromAppUser(prisma, id, {
          actorUserId: await resolveActorId(req),
        });
        res.json(result);
      } catch (error) {
        if (error instanceof EmployeeRegistrationError) {
          return res.status(error.status).json({ error: error.message, code: error.code });
        }
        console.error("POST /api/employees/:id/unlink-user", error);
        res.status(500).json({ error: "Erro ao desvincular usuário." });
      }
    }
  );
}
