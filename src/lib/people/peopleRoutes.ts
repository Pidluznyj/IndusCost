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
    getCurrentAppUser?: (req: express.Request) => Promise<{ permissions?: string[]; role?: string } | null>;
  }
): void {
  const { requireAppAuth, requireResource, getCurrentAppUser } = guards;
  const viewGuard = [requireAppAuth, requireResource(EMPLOYEES_RESOURCE_KEYS.module, EMPLOYEES_ACTIONS.view)];

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
      const payload = await getPersonProfile(prisma, req.params.id, caps);
      res.json(payload);
    } catch (error) {
      sendError(res, error, "GET /api/people/:id");
    }
  });
}
