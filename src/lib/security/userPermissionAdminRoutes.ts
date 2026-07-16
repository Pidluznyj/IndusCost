/**
 * Rotas admin de presets / permissões por usuário.
 */

import type express from "express";
import type { RequestHandler } from "express";
import type { AppUserRole } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import { toSafeAppUser } from "@/src/lib/appAuth.js";
import { PermissionResourceKeys } from "@/src/lib/security/permissionsCatalog.js";
import {
  applyRolePresetToUser,
  clearUserPermissionOverrides,
  getUserPermissionsAdmin,
  listPermissionPresetsAdmin,
  listUserPermissionAudit,
  reloadPermissionCatalogStatus,
  saveUserPermissionOverrides,
  updateUserRoleAdmin,
  UserPermissionAdminError,
  type OverrideInput,
} from "@/src/lib/security/userPermissionAdminService.js";

type RouteDeps = {
  requireAppAuth: express.RequestHandler;
  requirePermission: (
    resourceKey: string,
    action?: string
  ) => RequestHandler;
  /** Bootstrap admin OU permissão de usuários/ACL. */
  requireUsersOrPermissionsAdmin: express.RequestHandler;
  /** Somente admin.settings.security:manage (+ bootstrap) — auditoria completa. */
  requirePermissionsAdmin: express.RequestHandler;
  requireUsersView: express.RequestHandler;
};

const APP_ROLES = new Set<AppUserRole>([
  "SUPER_ADMIN",
  "ADMIN",
  "COMMERCIAL_MANAGER",
  "SELLER",
  "VIEWER",
]);

function parseRole(value: unknown): AppUserRole | null {
  if (typeof value !== "string") return null;
  return APP_ROLES.has(value as AppUserRole) ? (value as AppUserRole) : null;
}

function isMissingPermissionTableError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    /P2021|P2022|does not exist|relation .* does not exist/i.test(msg) &&
    /permissionResource|userPermissionOverride|rolePermission|permissionAuditLog/i.test(msg)
  );
}

function isPermissionFkError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    /P2003/.test(msg) ||
    /Foreign key constraint/i.test(msg) ||
    (/foreign key/i.test(msg) && /resourceKey|PermissionResource/i.test(msg))
  );
}

function handleError(res: express.Response, error: unknown, label: string) {
  if (error instanceof UserPermissionAdminError) {
    const status =
      error.code === "NOT_FOUND"
        ? 404
        : error.code === "CONFIRM_CLEAR_OVERRIDES_REQUIRED" ||
            error.code === "CONFIRM_REQUIRED" ||
            error.code === "LAST_SUPER_ADMIN" ||
            error.code === "CANNOT_DEMOTE_SELF" ||
            error.code === "CANNOT_REMOVE_OWN_USERS_MANAGE" ||
            error.code === "SUPER_ADMIN_READONLY" ||
            error.code === "PERMISSION_SCHEMA_MISSING" ||
            error.code === "PERMISSION_CATALOG_MISSING" ||
            error.code === "CONFLICT"
          ? 409
          : 400;
    return res.status(status).json({
      error: error.code,
      code: error.code,
      message: error.message,
      ...(error.details ?? {}),
    });
  }
  // Rede de segurança: Prisma cru (FK/schema) → 409 com orientação operacional.
  if (isMissingPermissionTableError(error)) {
    return res.status(409).json({
      error: "PERMISSION_SCHEMA_MISSING",
      code: "PERMISSION_SCHEMA_MISSING",
      message:
        "Tabelas de permissões ainda não existem. Rode as migrations e depois npm run permissions:seed.",
    });
  }
  if (isPermissionFkError(error)) {
    return res.status(409).json({
      error: "PERMISSION_CATALOG_MISSING",
      code: "PERMISSION_CATALOG_MISSING",
      message: "Catálogo de permissões não está populado. Rode npm run permissions:seed.",
    });
  }
  console.error(label, error);
  return res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao processar permissões." });
}

function actorId(req: express.Request): string | null {
  return (req as { appAuth?: { id?: string } }).appAuth?.id ?? null;
}

function isEditingSelf(req: express.Request, userId: string): boolean {
  return actorId(req) === userId;
}

export function registerUserPermissionAdminRoutes(
  app: express.Express,
  deps: RouteDeps
): void {
  const adminGuard = deps.requireUsersOrPermissionsAdmin;

  app.get("/api/admin/permission-presets", deps.requireAppAuth, adminGuard, async (_req, res) => {
    try {
      const payload = await listPermissionPresetsAdmin();
      return res.json(payload);
    } catch (error) {
      return handleError(res, error, "GET /api/admin/permission-presets");
    }
  });

  app.post(
    "/api/admin/permissions/reload-catalog",
    deps.requireAppAuth,
    adminGuard,
    async (_req, res) => {
      try {
        const status = await reloadPermissionCatalogStatus(prisma);
        return res.json(status);
      } catch (error) {
        return handleError(res, error, "POST /api/admin/permissions/reload-catalog");
      }
    }
  );

  app.get(
    "/api/admin/users/:id/permissions",
    deps.requireAppAuth,
    adminGuard,
    async (req, res) => {
      try {
        const id = String(req.params.id ?? "").trim();
        const payload = await getUserPermissionsAdmin(prisma, id);
        return res.json(payload);
      } catch (error) {
        return handleError(res, error, "GET /api/admin/users/:id/permissions");
      }
    }
  );

  app.put(
    "/api/admin/users/:id/permission-overrides",
    deps.requireAppAuth,
    adminGuard,
    async (req, res) => {
      try {
        const id = String(req.params.id ?? "").trim();
        const overrides = Array.isArray(req.body?.overrides)
          ? (req.body.overrides as OverrideInput[])
          : [];
        const reason =
          typeof req.body?.reason === "string" ? req.body.reason : undefined;
        const modeRaw = req.body?.mode;
        const mode =
          modeRaw === "absolute" || modeRaw === "differential"
            ? modeRaw
            : undefined;
        const ifMatchOverrideCount =
          typeof req.body?.ifMatchOverrideCount === "number"
            ? req.body.ifMatchOverrideCount
            : undefined;
        const payload = await saveUserPermissionOverrides(prisma, {
          userId: id,
          actorUserId: actorId(req),
          overrides,
          isEditingSelf: isEditingSelf(req, id),
          reason,
          mode,
          ifMatchOverrideCount,
        });
        return res.json(payload);
      } catch (error) {
        return handleError(res, error, "PUT /api/admin/users/:id/permission-overrides");
      }
    }
  );

  app.delete(
    "/api/admin/users/:id/permission-overrides",
    deps.requireAppAuth,
    adminGuard,
    async (req, res) => {
      try {
        const id = String(req.params.id ?? "").trim();
        const confirm =
          req.body?.confirm === true ||
          req.query.confirm === "1" ||
          req.query.confirm === "true";
        const payload = await clearUserPermissionOverrides(prisma, {
          userId: id,
          actorUserId: actorId(req),
          confirm,
          isEditingSelf: isEditingSelf(req, id),
        });
        return res.json(payload);
      } catch (error) {
        return handleError(res, error, "DELETE /api/admin/users/:id/permission-overrides");
      }
    }
  );

  app.put("/api/admin/users/:id/role", deps.requireAppAuth, adminGuard, async (req, res) => {
    try {
      const id = String(req.params.id ?? "").trim();
      const role = parseRole(req.body?.role);
      if (!role) {
        return res.status(400).json({ error: "INVALID_ROLE", message: "Perfil inválido." });
      }
      const payload = await updateUserRoleAdmin(prisma, {
        userId: id,
        actorUserId: actorId(req),
        role,
        confirmClearOverrides: req.body?.confirmClearOverrides === true,
        isEditingSelf: isEditingSelf(req, id),
        reason: typeof req.body?.reason === "string" ? req.body.reason : undefined,
      });
      return res.json(payload);
    } catch (error) {
      return handleError(res, error, "PUT /api/admin/users/:id/role");
    }
  });

  app.post(
    "/api/admin/users/:id/permissions/apply-preset",
    deps.requireAppAuth,
    adminGuard,
    async (req, res) => {
      try {
        const id = String(req.params.id ?? "").trim();
        const role = req.body?.role !== undefined ? parseRole(req.body.role) : undefined;
        if (req.body?.role !== undefined && !role) {
          return res.status(400).json({ error: "INVALID_ROLE", message: "Perfil inválido." });
        }
        const payload = await applyRolePresetToUser(prisma, {
          userId: id,
          actorUserId: actorId(req),
          role: role ?? undefined,
          confirmClearOverrides: req.body?.confirmClearOverrides === true,
          isEditingSelf: isEditingSelf(req, id),
          auditKind: "preset",
          reason: typeof req.body?.reason === "string" ? req.body.reason : undefined,
        });
        return res.json(payload);
      } catch (error) {
        return handleError(res, error, "POST /api/admin/users/:id/permissions/apply-preset");
      }
    }
  );

  app.post(
    "/api/admin/users/:id/permissions/restore-role-default",
    deps.requireAppAuth,
    adminGuard,
    async (req, res) => {
      try {
        const id = String(req.params.id ?? "").trim();
        const payload = await applyRolePresetToUser(prisma, {
          userId: id,
          actorUserId: actorId(req),
          confirmClearOverrides: req.body?.confirmClearOverrides === true,
          isEditingSelf: isEditingSelf(req, id),
          auditKind: "restore",
          reason: typeof req.body?.reason === "string" ? req.body.reason : undefined,
        });
        return res.json(payload);
      } catch (error) {
        return handleError(res, error, "POST /api/admin/users/:id/permissions/restore-role-default");
      }
    }
  );

  app.get(
    "/api/admin/users/:id/permission-audit",
    deps.requireAppAuth,
    deps.requirePermissionsAdmin,
    async (req, res) => {
      try {
        const id = String(req.params.id ?? "").trim();
        const limit = Number.parseInt(String(req.query.limit ?? "50"), 10);
        const payload = await listUserPermissionAudit(
          prisma,
          id,
          Number.isFinite(limit) ? limit : 50
        );
        return res.json(payload);
      } catch (error) {
        return handleError(res, error, "GET /api/admin/users/:id/permission-audit");
      }
    }
  );
}

/** Enriquece listagem GET /api/admin/users com hasCustomPermissions. */
export async function listAdminUsersWithPermissionMeta() {
  try {
    const users = await prisma.appUser.findMany({
      orderBy: [{ name: "asc" }, { email: "asc" }],
      include: {
        accessProfile: { select: { name: true } },
        employee: { select: { id: true, name: true, socialName: true, department: true } },
        _count: { select: { permissionOverrides: true } },
      },
    });

    return users.map((u) => {
      const overrideCount = u._count?.permissionOverrides ?? 0;
      const safe = toSafeAppUser(u, {
        accessProfileName: u.accessProfile?.name ?? null,
        employee: u.employee,
      });
      return {
        ...safe,
        hasCustomPermissions: overrideCount > 0,
        overrideCount,
      };
    });
  } catch (error) {
    // Tabela de overrides pode não existir ainda — cai para listagem sem meta.
    if (!isMissingPermissionTableError(error)) {
      console.warn("[permission-admin] listagem com meta falhou; fallback simples", error);
    }
    const users = await prisma.appUser.findMany({
      orderBy: [{ name: "asc" }, { email: "asc" }],
      include: {
        accessProfile: { select: { name: true } },
        employee: { select: { id: true, name: true, socialName: true, department: true } },
      },
    });
    return users.map((u) => {
      const safe = toSafeAppUser(u, {
        accessProfileName: u.accessProfile?.name ?? null,
        employee: u.employee,
      });
      return {
        ...safe,
        hasCustomPermissions: false,
        overrideCount: 0,
      };
    });
  }
}

export { PermissionResourceKeys };
