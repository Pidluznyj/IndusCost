import type express from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/prisma.js";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  AccessProfileError,
  canManageAccessProfiles,
  canViewAccessProfiles,
  createAccessProfile,
  deleteAccessProfile,
  duplicateAccessProfile,
  getAccessProfileById,
  listAccessProfiles,
  parseAccessProfileBody,
  setAccessProfileStatus,
  updateAccessProfile,
} from "@/src/lib/accessProfilesService.js";

type RouteDeps = {
  requireAppAuth: express.RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<AppAuthContext | null>;
};

function requireAccessProfileView(
  getCurrentAppUser: RouteDeps["getCurrentAppUser"]
): express.RequestHandler {
  return async (req, res, next) => {
    const auth = await getCurrentAppUser(req);
    if (!auth) {
      return res.status(401).json({ error: "UNAUTHORIZED", message: "Autenticação necessária." });
    }
    if (!canViewAccessProfiles(auth)) {
      return res.status(403).json({
        error: "FORBIDDEN",
        message: "Sem permissão para visualizar perfis de acesso.",
      });
    }
    req.appAuth = auth;
    return next();
  };
}

function requireAccessProfileManage(
  getCurrentAppUser: RouteDeps["getCurrentAppUser"]
): express.RequestHandler {
  return async (req, res, next) => {
    const auth = await getCurrentAppUser(req);
    if (!auth) {
      return res.status(401).json({ error: "UNAUTHORIZED", message: "Autenticação necessária." });
    }
    if (!canManageAccessProfiles(auth)) {
      return res.status(403).json({
        error: "FORBIDDEN",
        message: "Sem permissão para gerenciar perfis de acesso.",
      });
    }
    req.appAuth = auth;
    return next();
  };
}

function handleAccessProfileError(res: express.Response, error: unknown) {
  if (error instanceof AccessProfileError) {
    const status =
      error.code === "NOT_FOUND"
        ? 404
        : error.code === "NO_CHANGES"
          ? 400
          : error.code === "INVALID_NAME"
            ? 400
            : 409;
    return res.status(status).json({ error: error.code, message: error.message });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return res.status(409).json({
      error: "NAME_ALREADY_EXISTS",
      message: "Já existe um perfil com este nome.",
    });
  }
  console.error("[access-profiles]", error);
  return res.status(500).json({ error: "INTERNAL_ERROR", message: "Erro ao processar perfil de acesso." });
}

export function registerAccessProfilesRoutes(app: express.Express, deps: RouteDeps): void {
  const viewGuard = requireAccessProfileView(deps.getCurrentAppUser);
  const manageGuard = requireAccessProfileManage(deps.getCurrentAppUser);

  app.get("/api/access-profiles", deps.requireAppAuth, viewGuard, async (req, res) => {
    try {
      const activeOnly = req.query.activeOnly === "1" || req.query.activeOnly === "true";
      const includeInactive =
        req.query.includeInactive === "1" || req.query.includeInactive === "true";
      const search = typeof req.query.search === "string" ? req.query.search : undefined;
      const profiles = await listAccessProfiles(prisma, { activeOnly, includeInactive, search });
      return res.json({ profiles });
    } catch (error) {
      return handleAccessProfileError(res, error);
    }
  });

  app.get("/api/access-profiles/:id", deps.requireAppAuth, viewGuard, async (req, res) => {
    try {
      const id = String(req.params.id ?? "").trim();
      const profile = await getAccessProfileById(prisma, id);
      if (!profile) {
        return res.status(404).json({ error: "NOT_FOUND", message: "Perfil não encontrado." });
      }
      return res.json({ profile });
    } catch (error) {
      return handleAccessProfileError(res, error);
    }
  });

  app.post("/api/access-profiles", deps.requireAppAuth, manageGuard, async (req, res) => {
    try {
      const body = parseAccessProfileBody(req.body);
      if (!body.name?.trim()) {
        return res.status(400).json({ error: "INVALID_NAME", message: "Informe o nome do perfil." });
      }
      const profile = await createAccessProfile(prisma, {
        name: body.name,
        description: body.description,
        roleBase: body.roleBase,
        permissions: body.permissions,
        isActive: body.isActive,
      });
      return res.status(201).json({ profile });
    } catch (error) {
      return handleAccessProfileError(res, error);
    }
  });

  app.put("/api/access-profiles/:id", deps.requireAppAuth, manageGuard, async (req, res) => {
    try {
      const id = String(req.params.id ?? "").trim();
      const body = parseAccessProfileBody(req.body);
      const profile = await updateAccessProfile(prisma, id, body);
      return res.json({ profile });
    } catch (error) {
      return handleAccessProfileError(res, error);
    }
  });

  app.patch("/api/access-profiles/:id/status", deps.requireAppAuth, manageGuard, async (req, res) => {
    try {
      const id = String(req.params.id ?? "").trim();
      const isActive = req.body?.isActive !== false;
      const profile = await setAccessProfileStatus(prisma, id, isActive);
      return res.json({ profile });
    } catch (error) {
      return handleAccessProfileError(res, error);
    }
  });

  app.post("/api/access-profiles/:id/duplicate", deps.requireAppAuth, manageGuard, async (req, res) => {
    try {
      const id = String(req.params.id ?? "").trim();
      const name = typeof req.body?.name === "string" ? req.body.name : undefined;
      const profile = await duplicateAccessProfile(prisma, id, name);
      return res.status(201).json({ profile });
    } catch (error) {
      return handleAccessProfileError(res, error);
    }
  });

  app.delete("/api/access-profiles/:id", deps.requireAppAuth, manageGuard, async (req, res) => {
    try {
      const id = String(req.params.id ?? "").trim();
      await deleteAccessProfile(prisma, id);
      return res.json({ success: true });
    } catch (error) {
      return handleAccessProfileError(res, error);
    }
  });
}
