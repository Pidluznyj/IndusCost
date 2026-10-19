/**
 * Catálogo global de EPIs e uniformes — /api/hr/epi-items.
 * Ler: quem vê EPI na ficha (employees.epi.view | employees.view | employees.edit | employees.epi.manage).
 * Escrever: employees.epi.manage | employees.edit (mesma regra das entregas).
 */
import type express from "express";
import type { RequestHandler } from "express";
import { prisma } from "@/src/lib/prisma.js";
import { EMPLOYEES_ACTIONS, EMPLOYEES_RESOURCE_KEYS } from "@/src/lib/employeesAccess.js";
import { canManageEmployeeEpi, type EmployeePermissionBag } from "@/src/lib/employeesPermissions.js";
import { PEOPLE_PROFILE_PERMISSIONS } from "@/src/lib/peopleProfileCapabilities.js";
import { PeopleProfileAccessError } from "@/src/lib/peopleProfileErrors.js";
import { isEmployeeUuid } from "@/src/lib/employeeRegistration.js";
import { createEpiItem, deleteEpiItem, listEpiItems, setEpiItemActive, updateEpiItem } from "./epiCatalog.server.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requireResource: (resourceKey: string, action?: string) => RequestHandler;
  getCurrentAppUser: (req: express.Request) => Promise<{ id: string } | null>;
  getPermissionCheck: (req: express.Request) => Promise<EmployeePermissionBag>;
};

function sendError(res: express.Response, error: unknown, fallback: string) {
  res.setHeader("Cache-Control", "no-store");
  if (error instanceof PeopleProfileAccessError) {
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  console.error(fallback, { message: error instanceof Error ? error.message : "unknown" });
  return res.status(500).json({ error: fallback });
}

export function registerEpiRoutes(app: express.Application, guards: AuthGuards): void {
  const { requireAppAuth, requireResource, getCurrentAppUser, getPermissionCheck } = guards;
  const moduleGuard = [requireAppAuth, requireResource(EMPLOYEES_RESOURCE_KEYS.module, EMPLOYEES_ACTIONS.view)];

  async function actor(req: express.Request, mode: "view" | "manage") {
    const [check, user] = await Promise.all([getPermissionCheck(req), getCurrentAppUser(req)]);
    const canManage = canManageEmployeeEpi(check);
    const canView = canManage || check.hasAnyPermission(PEOPLE_PROFILE_PERMISSIONS.epiView);
    if (mode === "manage" ? !canManage : !canView) {
      throw new PeopleProfileAccessError("FORBIDDEN", "Sem permissão para o cadastro de EPIs e uniformes.");
    }
    return { userId: user?.id ?? null, canManage };
  }

  function itemId(req: express.Request): string {
    const id = String(req.params.itemId ?? "");
    if (!isEmployeeUuid(id)) throw new PeopleProfileAccessError("INVALID_ID", "Item inválido.", 400);
    return id;
  }

  function body(req: express.Request): Record<string, unknown> {
    const b: unknown = req.body;
    if (!b || typeof b !== "object" || Array.isArray(b)) {
      throw new PeopleProfileAccessError("INVALID_BODY", "Dados inválidos.", 400);
    }
    return b as Record<string, unknown>;
  }

  app.get("/api/hr/epi-items", ...moduleGuard, async (req, res) => {
    try {
      const { canManage } = await actor(req, "view");
      const items = await listEpiItems(prisma, {
        q: typeof req.query.q === "string" ? req.query.q : null,
        includeInactive: req.query.includeInactive === "1" || req.query.includeInactive === "true",
      });
      res.setHeader("Cache-Control", "no-store");
      return res.json({ items, canManage });
    } catch (error) {
      return sendError(res, error, "Erro ao carregar EPIs e uniformes.");
    }
  });

  app.post("/api/hr/epi-items", ...moduleGuard, async (req, res) => {
    try {
      const { userId } = await actor(req, "manage");
      const item = await createEpiItem(prisma, body(req), userId);
      res.setHeader("Cache-Control", "no-store");
      return res.status(201).json(item);
    } catch (error) {
      return sendError(res, error, "Erro ao cadastrar EPI / uniforme.");
    }
  });

  app.patch("/api/hr/epi-items/:itemId", ...moduleGuard, async (req, res) => {
    try {
      const { userId } = await actor(req, "manage");
      const b = body(req);
      const id = itemId(req);
      // Ativar/inativar é uma operação própria (não mistura com a edição dos dados).
      const item =
        Object.keys(b).length === 1 && typeof b.active === "boolean"
          ? await setEpiItemActive(prisma, id, b.active, userId)
          : await updateEpiItem(prisma, id, b, userId);
      res.setHeader("Cache-Control", "no-store");
      return res.json(item);
    } catch (error) {
      return sendError(res, error, "Erro ao atualizar EPI / uniforme.");
    }
  });

  app.delete("/api/hr/epi-items/:itemId", ...moduleGuard, async (req, res) => {
    try {
      const { userId } = await actor(req, "manage");
      const result = await deleteEpiItem(prisma, itemId(req), userId);
      res.setHeader("Cache-Control", "no-store");
      return res.json(result);
    } catch (error) {
      return sendError(res, error, "Erro ao excluir EPI / uniforme.");
    }
  });
}
