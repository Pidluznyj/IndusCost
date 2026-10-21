/**
 * Rotas do módulo Pessoas 360° (v1 — consulta). Todas sob o RBAC de Pessoas / RH
 * (`admin.employees` view) com capacidades do visualizador aplicadas no servidor.
 * As rotas `/resolve`, `/search`, `/:id/links` e `/preview-employee-link` continuam em
 * canonicalPersonRoutes; estas são registradas DEPOIS para `/:id` não capturar aquelas.
 */
import type express from "express";
import { prisma } from "@/src/lib/prisma.js";
import { CanonicalPersonError } from "@/src/lib/canonicalPerson.js";
import { EMPLOYEES_ACTIONS, EMPLOYEES_RESOURCE_KEYS } from "@/src/lib/employeesAccess.js";
import { resolvePeopleViewerCaps, type AuthGuards } from "@/src/lib/canonicalPersonRoutes.js";
import { findPendingLinksForPerson, getPersonProfile, listPeople } from "@/src/lib/people/personProfile.server.js";
import { executePersonMerge, previewPersonMerge, previewRelink, relinkEntity, revertPersonMerge, unlinkEntity } from "@/src/lib/people/personLinkOps.server.js";
import type { SuperAdminGuardActor } from "@/src/lib/security/superAdminRoleGuard.js";

function sendError(res: express.Response, error: unknown, label: string) {
  if (error instanceof CanonicalPersonError) {
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  console.error(label, error);
  return res.status(500).json({ error: "Erro ao consultar pessoas." });
}

export function registerPeopleRoutes(
  app: express.Application,
  guards: AuthGuards & {
    getCurrentAppUser?: (req: express.Request) => Promise<{ id?: string; name?: string; permissions?: string[]; role?: string } | null>;
    /** Ator (papel + elevação) — unificação e reversão exigem SUPER_ADMIN com step-up. */
    resolveActor?: (req: express.Request) => SuperAdminGuardActor;
  }
): void {
  const { requireAppAuth, requireResource, getCurrentAppUser } = guards;
  const viewGuard = [requireAppAuth, requireResource(EMPLOYEES_RESOURCE_KEYS.module, EMPLOYEES_ACTIONS.view)];
  const linksManageGuard = [requireAppAuth, requireResource(EMPLOYEES_RESOURCE_KEYS.links, EMPLOYEES_ACTIONS.manage)];
  const actorOf = async (req: express.Request) => {
    const u = (await getCurrentAppUser?.(req)) ?? null;
    return { id: u?.id ?? null, name: u?.name ?? null };
  };
  /** Unificar/reverter: privilégio máximo — SUPER_ADMIN elevado (step-up), além de links:manage. */
  const requireMergePrivilege: express.RequestHandler = (req, res, next) => {
    const actor = guards.resolveActor?.(req) ?? { id: null, role: null, elevated: false };
    if (actor.role !== "SUPER_ADMIN") {
      return res.status(403).json({ error: "SUPER_ADMIN_REQUIRED", code: "SUPER_ADMIN_REQUIRED", message: "Unificar pessoas exige um Super Administrador." });
    }
    if (!actor.elevated) {
      return res.status(403).json({ error: "ADMIN_ELEVATION_REQUIRED", code: "ADMIN_ELEVATION_REQUIRED", message: "Confirme sua identidade (senha) para unificar pessoas." });
    }
    return next();
  };

  app.get("/api/people", ...viewGuard, async (req, res) => {
    try {
      const caps = await resolvePeopleViewerCaps(req, getCurrentAppUser);
      const q = typeof req.query.q === "string" ? req.query.q : "";
      const payload = await listPeople(prisma, {
        q,
        page: Number(req.query.page) || 1,
        limit: Number(req.query.limit) || 25,
        status: typeof req.query.status === "string" ? req.query.status : null,
        has: typeof req.query.has === "string" ? req.query.has : null,
        missing: typeof req.query.missing === "string" ? req.query.missing : null,
        pending: typeof req.query.pending === "string" ? req.query.pending : null,
        canViewPii: caps.canViewPii,
      });
      res.json(payload);
    } catch (error) {
      sendError(res, error, "GET /api/people");
    }
  });

  app.get("/api/people/:id/pending-links", ...viewGuard, async (req, res) => {
    try {
      const pending = await findPendingLinksForPerson(prisma, req.params.id);
      res.json({ pending });
    } catch (error) {
      sendError(res, error, "GET /api/people/:id/pending-links");
    }
  });

  app.get("/api/people/:id", ...viewGuard, async (req, res) => {
    try {
      const caps = await resolvePeopleViewerCaps(req, getCurrentAppUser);
      const viewer = (await getCurrentAppUser?.(req)) ?? null;
      const payload = await getPersonProfile(prisma, req.params.id, caps, { role: viewer?.role ?? null });
      res.json(payload);
    } catch (error) {
      sendError(res, error, "GET /api/people/:id");
    }
  });

  // ---- v1.1: operações de escrita (prévia sem efeito; confirmação transacional com auditoria)
  app.post("/api/people/:id/links/preview", ...linksManageGuard, async (req, res) => {
    try {
      res.json(await previewRelink(prisma, { targetPersonId: req.params.id, entityKind: req.body?.entityKind, entityId: req.body?.entityId }));
    } catch (error) {
      sendError(res, error, "POST /api/people/:id/links/preview");
    }
  });

  app.post("/api/people/:id/links", ...linksManageGuard, async (req, res) => {
    try {
      const actor = await actorOf(req);
      res.json(
        await relinkEntity(prisma, {
          targetPersonId: req.params.id,
          entityKind: req.body?.entityKind,
          entityId: req.body?.entityId,
          expectedCurrentPersonId: req.body?.expectedCurrentPersonId === undefined ? undefined : (req.body.expectedCurrentPersonId ?? null),
          reason: typeof req.body?.reason === "string" ? req.body.reason : null,
          actor,
        })
      );
    } catch (error) {
      sendError(res, error, "POST /api/people/:id/links");
    }
  });

  app.delete("/api/people/:id/links/:entityKind/:entityId", ...linksManageGuard, async (req, res) => {
    try {
      const actor = await actorOf(req);
      res.json(
        await unlinkEntity(prisma, {
          personId: req.params.id,
          entityKind: req.params.entityKind,
          entityId: req.params.entityId,
          reason: typeof req.body?.reason === "string" ? req.body.reason : typeof req.query.reason === "string" ? req.query.reason : null,
          actor,
        })
      );
    } catch (error) {
      sendError(res, error, "DELETE /api/people/:id/links/:entityKind/:entityId");
    }
  });

  app.post("/api/people/:id/merge/preview", ...linksManageGuard, async (req, res) => {
    try {
      res.json(await previewPersonMerge(prisma, { winnerId: req.params.id, loserId: String(req.body?.loserPersonId ?? "") }));
    } catch (error) {
      sendError(res, error, "POST /api/people/:id/merge/preview");
    }
  });

  app.post("/api/people/:id/merge", ...linksManageGuard, requireMergePrivilege, async (req, res) => {
    try {
      const actor = await actorOf(req);
      res.json(
        await executePersonMerge(prisma, {
          winnerId: req.params.id,
          loserId: String(req.body?.loserPersonId ?? ""),
          reason: typeof req.body?.reason === "string" ? req.body.reason : null,
          expectedMoveCount: typeof req.body?.expectedMoveCount === "number" ? req.body.expectedMoveCount : undefined,
          actor,
        })
      );
    } catch (error) {
      sendError(res, error, "POST /api/people/:id/merge");
    }
  });

  app.post("/api/people/:id/merge/revert", ...linksManageGuard, requireMergePrivilege, async (req, res) => {
    try {
      const actor = await actorOf(req);
      res.json(await revertPersonMerge(prisma, { eventId: String(req.body?.eventId ?? ""), reason: typeof req.body?.reason === "string" ? req.body.reason : null, actor }));
    } catch (error) {
      sendError(res, error, "POST /api/people/:id/merge/revert");
    }
  });
}
