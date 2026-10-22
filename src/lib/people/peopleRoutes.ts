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
import { attachAccountToPerson, executePersonMerge, listCandidateAccounts, previewAttachAccount, previewPersonMerge, previewRelink, relinkEntity, revertPersonMerge, unlinkEntity } from "@/src/lib/people/personLinkOps.server.js";
import { createPersonManual, loadPersonIdentityForEdit, setPersonStatus, updatePersonIdentity } from "@/src/lib/people/personMaster.server.js";
import { enableDriverForPerson, previewDriverEnable } from "@/src/lib/people/personDriverEnable.server.js";
import { buildPeopleMasterCaps } from "@/src/lib/people/peopleCaps.js";
import { AppUserCreationError, createAppUserAccount } from "@/src/lib/adminUserCreation.server.js";
import { AccessProfileError } from "@/src/lib/accessProfilesService.js";
import { toSafeAppUser } from "@/src/lib/auth/appAuth.server.js";
import { normalizeUserAgent, resolveAuditIpAddress } from "@/src/lib/auth/securityAudit.server.js";
import { createFleetRouteGuards } from "@/src/lib/fleetRouteGuards.js";
import { resolvePeopleViewerInput } from "@/src/lib/canonicalPersonRoutes.js";
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
    /** Guarda de criação de contas (admin.settings.security:manage) — a mesma de Configurações › Usuários. */
    requireUsersManage?: express.RequestHandler;
    /**
     * Permissão efetiva de vínculo com usuário (admin.employees.user_link:manage), sem efeito HTTP —
     * decide por objeto quando a correção de vínculo muda a identidade de uma conta. Ausente = não tem.
     */
    canManageAccountIdentity?: (req: express.Request) => Promise<boolean>;
  }
): void {
  const { requireAppAuth, requireResource, getCurrentAppUser } = guards;
  const viewGuard = [requireAppAuth, requireResource(EMPLOYEES_RESOURCE_KEYS.module, EMPLOYEES_ACTIONS.view)];
  const linksManageGuard = [requireAppAuth, requireResource(EMPLOYEES_RESOURCE_KEYS.links, EMPLOYEES_ACTIONS.manage)];
  const peopleUpdateGuard = [requireAppAuth, requireResource(EMPLOYEES_RESOURCE_KEYS.people, EMPLOYEES_ACTIONS.update)];
  const peopleManageGuard = [requireAppAuth, requireResource(EMPLOYEES_RESOURCE_KEYS.people, EMPLOYEES_ACTIONS.manage)];
  const userLinkManageGuard = [requireAppAuth, requireResource(EMPLOYEES_RESOURCE_KEYS.links, EMPLOYEES_ACTIONS.manage), requireResource(EMPLOYEES_RESOURCE_KEYS.userLink, EMPLOYEES_ACTIONS.manage)];
  const usersManageGuard = [requireAppAuth, guards.requireUsersManage ?? requireResource("admin.settings.security", "manage")];
  const fleet = createFleetRouteGuards({
    requireAppAuth,
    requireResource,
    getCurrentAppUser: (async (req: express.Request) => (await getCurrentAppUser?.(req)) ?? null) as never,
  });
  const actorOf = async (req: express.Request) => {
    const u = (await getCurrentAppUser?.(req)) ?? null;
    const guard = guards.resolveActor?.(req) ?? { id: u?.id ?? null, role: u?.role ?? null, elevated: false };
    return { id: u?.id ?? guard.id ?? null, name: u?.name ?? null, role: guard.role ?? u?.role ?? null, elevated: guard.elevated };
  };
  const canManageAccountIdentityOf = async (req: express.Request) => Boolean(await guards.canManageAccountIdentity?.(req));
  const originOf = (req: express.Request) => ({ ipAddress: resolveAuditIpAddress(req.socket?.remoteAddress), userAgent: normalizeUserAgent(req.headers["user-agent"]) });
  const masterCaps = async (req: express.Request) => buildPeopleMasterCaps(await resolvePeopleViewerInput(req, getCurrentAppUser));
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
      const caps = await masterCaps(req);
      const viewer = (await getCurrentAppUser?.(req)) ?? null;
      const payload = await getPersonProfile(prisma, req.params.id, caps, { role: viewer?.role ?? null });
      res.json(payload);
    } catch (error) {
      sendError(res, error, "GET /api/people/:id");
    }
  });

  // ---- Cadastro mestre: criar, editar, situação ----
  app.post("/api/people", ...peopleUpdateGuard, async (req, res) => {
    try {
      const created = await createPersonManual(prisma, { actor: await actorOf(req), body: req.body ?? {} });
      res.status(201).json(created);
    } catch (error) {
      sendError(res, error, "POST /api/people");
    }
  });

  app.get("/api/people/:id/identity", ...viewGuard, async (req, res) => {
    try {
      const caps = await masterCaps(req);
      res.json(await loadPersonIdentityForEdit(prisma, req.params.id, caps));
    } catch (error) {
      sendError(res, error, "GET /api/people/:id/identity");
    }
  });

  app.patch("/api/people/:id", ...peopleUpdateGuard, async (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const { reason, ...patch } = body;
      res.json(await updatePersonIdentity(prisma, req.params.id, { actor: await actorOf(req), body: patch, reason }));
    } catch (error) {
      sendError(res, error, "PATCH /api/people/:id");
    }
  });

  app.post("/api/people/:id/status", ...peopleManageGuard, async (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      res.json(await setPersonStatus(prisma, req.params.id, { actor: await actorOf(req), status: body.status, reason: body.reason }));
    } catch (error) {
      sendError(res, error, "POST /api/people/:id/status");
    }
  });

  // ---- Habilitar acesso ao IndusCost (criar conta ligada à Pessoa) — guarda de Usuários ----
  app.post("/api/people/:id/access", ...usersManageGuard, async (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const actor = await actorOf(req);
      const user = await createAppUserAccount(
        { prisma },
        {
          source: { kind: "person", personId: String(req.params.id ?? "") },
          name: typeof body.name === "string" ? body.name : null,
          email: typeof body.email === "string" ? body.email : null,
          password: typeof body.password === "string" ? body.password : "",
          isActive: body.isActive !== false,
          mustChangePassword: body.mustChangePassword === false ? false : true,
          actor: { id: actor.id, role: actor.role, name: actor.name },
          origin: originOf(req),
          creationSource: "PERSON_ENABLE_ACCESS",
        }
      );
      res.status(201).json({ user: toSafeAppUser(user, { accessProfileName: user.accessProfile?.name ?? null, employee: user.employee }) });
    } catch (error) {
      if (error instanceof AppUserCreationError) return res.status(error.status).json({ error: error.code, code: error.code, message: error.message });
      if (error instanceof AccessProfileError) return res.status(409).json({ error: error.code, code: error.code, message: error.message });
      sendError(res, error, "POST /api/people/:id/access");
    }
  });

  // ---- Regularizar vínculo existente (conta legada → Pessoa [+ colaborador]) ----
  app.get("/api/people/:id/access/candidates", ...userLinkManageGuard, async (req, res) => {
    try {
      const caps = await masterCaps(req);
      const q = typeof req.query.q === "string" ? req.query.q : "";
      res.json({ items: await listCandidateAccounts(prisma, req.params.id, { q, canViewPii: caps.canViewPii }) });
    } catch (error) {
      sendError(res, error, "GET /api/people/:id/access/candidates");
    }
  });

  app.post("/api/people/:id/access/attach/preview", ...userLinkManageGuard, async (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      res.json(await previewAttachAccount(prisma, { targetPersonId: req.params.id, appUserId: body.appUserId, employeeId: body.employeeId, actor: await actorOf(req) }));
    } catch (error) {
      sendError(res, error, "POST /api/people/:id/access/attach/preview");
    }
  });

  app.post("/api/people/:id/access/attach", ...userLinkManageGuard, async (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const expected = (body.expected && typeof body.expected === "object" ? body.expected : {}) as { personId?: string | null; employeeId?: string | null; linkEmployeeId?: string | null };
      res.json(
        await attachAccountToPerson(prisma, {
          targetPersonId: req.params.id,
          appUserId: body.appUserId,
          employeeId: body.employeeId,
          expected: { personId: expected.personId, employeeId: expected.employeeId, linkEmployeeId: expected.linkEmployeeId },
          confirmEmailMismatch: body.confirmEmailMismatch === true,
          reason: typeof body.reason === "string" ? body.reason : null,
          actor: await actorOf(req),
          origin: originOf(req),
        })
      );
    } catch (error) {
      sendError(res, error, "POST /api/people/:id/access/attach");
    }
  });

  // ---- Habilitar motorista (guardas da Frota) ----
  app.get("/api/people/:id/driver/preview", ...fleet.driversManage, async (req, res) => {
    try {
      res.json(await previewDriverEnable(prisma, req.params.id));
    } catch (error) {
      sendError(res, error, "GET /api/people/:id/driver/preview");
    }
  });

  app.post("/api/people/:id/driver", ...fleet.driversManage, async (req, res) => {
    try {
      const actor = await actorOf(req);
      const u = (await getCurrentAppUser?.(req)) ?? null;
      res.status(201).json(await enableDriverForPerson(prisma, req.params.id, { actor, body: req.body ?? {}, fleetAuditUserId: u?.id ?? null }));
    } catch (error) {
      sendError(res, error, "POST /api/people/:id/driver");
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
          canManageAccountIdentity: await canManageAccountIdentityOf(req),
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
          canManageAccountIdentity: await canManageAccountIdentityOf(req),
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
