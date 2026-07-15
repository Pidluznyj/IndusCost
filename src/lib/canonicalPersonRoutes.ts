/**
 * Rotas da Pessoa Canônica.
 */

import type express from "express";
import type { RequestHandler } from "express";
import { prisma } from "@/src/lib/prisma.js";
import {
  CanonicalPersonError,
  isPersonUuid,
  type FieldResolutionChoice,
  type PersonFieldKey,
  type PersonLinkSourceKind,
} from "@/src/lib/canonicalPerson.js";
import {
  diagnoseUnequivocalPersonMatches,
  getCustomerPeopleLinks,
  getPersonSystemLinks,
  linkCustomerContactPerson,
  linkCustomerIdentityPerson,
  resolveEmployeePersonIdForPersist,
  searchCanonicalPeople,
  unlinkCustomerContactPerson,
  unlinkCustomerIdentityPerson,
  unlinkEmployeeFromPerson,
} from "@/src/lib/canonicalPersonService.server.js";
import { resolvePeopleSearch } from "@/src/lib/canonicalPersonSearch.server.js";

type AuthGuards = {
  requireAppAuth: RequestHandler;
  requirePermission: (permission: string) => RequestHandler;
  requireAnyPermission: (permissions: string[]) => RequestHandler;
};

const SEARCH_PERMS = [
  "people.search",
  "employees.view",
  "employees.edit",
  "users.manage",
] as const;

const LINK_PERMS = ["people.link.manage", "employees.edit", "users.manage"] as const;

/** Melhor esforço: muitos endpoints usam getCurrentAppUser. */
async function resolveCanViewPii(
  req: express.Request,
  getCurrentAppUser?: (
    req: express.Request
  ) => Promise<{ permissions?: string[]; role?: string } | null> | { permissions?: string[]; role?: string } | null
): Promise<boolean> {
  const raw = getCurrentAppUser?.(req);
  const user = raw && typeof (raw as Promise<unknown>).then === "function" ? await raw : raw;
  const u = user as { permissions?: string[]; role?: string } | null;
  if (u?.role === "SUPER_ADMIN" || u?.role === "ADMIN") return true;
  const perms = u?.permissions ?? [];
  return (
    perms.includes("employees.edit") ||
    perms.includes("people.pii.view") ||
    perms.includes("users.manage")
  );
}

export function registerCanonicalPersonRoutes(
  app: express.Application,
  guards: AuthGuards & {
    getCurrentAppUser?: (
      req: express.Request
    ) => Promise<{ permissions?: string[]; role?: string } | null>;
  }
): void {
  const { requireAppAuth, requirePermission, requireAnyPermission, getCurrentAppUser } = guards;

  app.get(
    "/api/people/search",
    requireAppAuth,
    requireAnyPermission([...SEARCH_PERMS]),
    async (req, res) => {
      try {
        const q = typeof req.query.q === "string" ? req.query.q : "";
        const excludeEmployeeId =
          typeof req.query.excludeEmployeeId === "string"
            ? req.query.excludeEmployeeId
            : null;
        const rows = await searchCanonicalPeople(prisma, {
          q,
          excludeEmployeeId,
          canViewPii: await resolveCanViewPii(req, getCurrentAppUser),
          limit: Number(req.query.limit) || 20,
        });
        res.json({ rows });
      } catch (error) {
        console.error("GET /api/people/search", error);
        res.status(500).json({ error: "Erro ao pesquisar pessoas." });
      }
    }
  );

  /**
   * Motor unificado de resolução (Prompt 03).
   * Query: q, page, limit, excludeEmployeeId, includeInactive=1
   */
  app.get(
    "/api/people/resolve",
    requireAppAuth,
    requireAnyPermission([...SEARCH_PERMS]),
    async (req, res) => {
      try {
        const q = typeof req.query.q === "string" ? req.query.q : "";
        const excludeEmployeeId =
          typeof req.query.excludeEmployeeId === "string"
            ? req.query.excludeEmployeeId
            : null;
        const includeInactive =
          req.query.includeInactive === "1" || req.query.includeInactive === "true";
        const result = await resolvePeopleSearch(prisma, {
          q,
          page: Number(req.query.page) || 1,
          limit: Number(req.query.limit) || 20,
          excludeEmployeeId,
          includeInactive,
          canViewPii: await resolveCanViewPii(req, getCurrentAppUser),
        });
        res.json(result);
      } catch (error) {
        console.error("GET /api/people/resolve", error);
        res.status(500).json({ error: "Erro ao resolver pessoas." });
      }
    }
  );

  app.get(
    "/api/people/:id/links",
    requireAppAuth,
    requireAnyPermission([...SEARCH_PERMS]),
    async (req, res) => {
      try {
        const id = req.params.id;
        if (!isPersonUuid(id)) {
          return res.status(400).json({ error: "ID inválido." });
        }
        const payload = await getPersonSystemLinks(prisma, id, {
          canViewPii: await resolveCanViewPii(req, getCurrentAppUser),
        });
        res.json(payload);
      } catch (error) {
        if (error instanceof CanonicalPersonError) {
          return res
            .status(error.status)
            .json({ error: error.message, code: error.code, conflicts: error.conflicts });
        }
        console.error("GET /api/people/:id/links", error);
        res.status(500).json({ error: "Erro ao listar vínculos." });
      }
    }
  );

  app.post(
    "/api/people/preview-employee-link",
    requireAppAuth,
    requireAnyPermission([...LINK_PERMS]),
    async (req, res) => {
      try {
        const body = req.body ?? {};
        const { previewLinkEmployeeToPerson } = await import(
          "@/src/lib/canonicalPersonService.server.js"
        );
        const result = await previewLinkEmployeeToPerson(prisma, {
          personId: body.personId ?? null,
          sourceKind: body.sourceKind ?? null,
          sourceId: body.sourceId ?? null,
          form: {
            displayName: body.name ?? body.displayName,
            socialName: body.socialName,
            corporateEmail: body.corporateEmail,
            personalEmail: body.personalEmail,
            cpfNormalized: body.cpf ?? body.cpfNormalized,
            phoneNormalized: body.phone ?? body.phoneNormalized,
          },
        });
        res.json(result);
      } catch (error) {
        if (error instanceof CanonicalPersonError) {
          return res
            .status(error.status)
            .json({ error: error.message, code: error.code, conflicts: error.conflicts });
        }
        console.error("POST /api/people/preview-employee-link", error);
        res.status(500).json({ error: "Erro ao pré-visualizar vínculo." });
      }
    }
  );

  app.delete(
    "/api/employees/:id/person-link",
    requireAppAuth,
    requireAnyPermission([...LINK_PERMS]),
    async (req, res) => {
      try {
        await unlinkEmployeeFromPerson(prisma, req.params.id);
        res.json({ ok: true });
      } catch (error) {
        if (error instanceof CanonicalPersonError) {
          return res.status(error.status).json({ error: error.message, code: error.code });
        }
        console.error("DELETE /api/employees/:id/person-link", error);
        res.status(500).json({ error: "Erro ao desvincular pessoa." });
      }
    }
  );

  app.get(
    "/api/customers/:id/people-links",
    requireAppAuth,
    requireAnyPermission([
      "customers.view",
      "crm.general.view",
      "employees.view",
      "people.search",
    ]),
    async (req, res) => {
      try {
        const payload = await getCustomerPeopleLinks(prisma, req.params.id, {
          canViewPii: await resolveCanViewPii(req, getCurrentAppUser),
        });
        res.json(payload);
      } catch (error) {
        if (error instanceof CanonicalPersonError) {
          return res.status(error.status).json({ error: error.message, code: error.code });
        }
        console.error("GET /api/customers/:id/people-links", error);
        res.status(500).json({ error: "Erro ao listar pessoas do cliente." });
      }
    }
  );

  app.put(
    "/api/customers/:id/person-link",
    requireAppAuth,
    requirePermission("customers.edit"),
    requireAnyPermission(["people.link.manage", "users.manage"]),
    async (req, res) => {
      try {
        const body = req.body as Record<string, unknown>;
        const result = await linkCustomerIdentityPerson(prisma, req.params.id, {
          personId: typeof body.personId === "string" ? body.personId : null,
          sourceKind: (body.sourceKind as PersonLinkSourceKind) ?? null,
          sourceId: typeof body.sourceId === "string" ? body.sourceId : null,
          createNewFromContact: body.createNewFromContact === true,
          fieldResolutions: (body.fieldResolutions ??
            {}) as Partial<Record<PersonFieldKey, FieldResolutionChoice>>,
        });
        res.json(result);
      } catch (error) {
        if (error instanceof CanonicalPersonError) {
          return res
            .status(error.status)
            .json({ error: error.message, code: error.code, conflicts: error.conflicts });
        }
        console.error("PUT /api/customers/:id/person-link", error);
        res.status(500).json({ error: "Erro ao vincular identidade do cliente." });
      }
    }
  );

  app.delete(
    "/api/customers/:id/person-link",
    requireAppAuth,
    requirePermission("customers.edit"),
    requireAnyPermission(["people.link.manage", "users.manage"]),
    async (req, res) => {
      try {
        const result = await unlinkCustomerIdentityPerson(prisma, req.params.id);
        res.json(result);
      } catch (error) {
        if (error instanceof CanonicalPersonError) {
          return res.status(error.status).json({ error: error.message, code: error.code });
        }
        console.error("DELETE /api/customers/:id/person-link", error);
        res.status(500).json({ error: "Erro ao desvincular identidade do cliente." });
      }
    }
  );

  app.put(
    "/api/customers/:id/contact-person-link",
    requireAppAuth,
    requirePermission("customers.edit"),
    requireAnyPermission(["people.link.manage", "users.manage"]),
    async (req, res) => {
      try {
        const body = req.body as Record<string, unknown>;
        const result = await linkCustomerContactPerson(prisma, req.params.id, {
          personId: typeof body.personId === "string" ? body.personId : null,
          sourceKind: (body.sourceKind as PersonLinkSourceKind) ?? null,
          sourceId: typeof body.sourceId === "string" ? body.sourceId : null,
          createNewFromContact: body.createNewFromContact === true,
        });
        res.json(result);
      } catch (error) {
        if (error instanceof CanonicalPersonError) {
          return res.status(error.status).json({ error: error.message, code: error.code });
        }
        console.error("PUT /api/customers/:id/contact-person-link", error);
        res.status(500).json({ error: "Erro ao vincular contato à pessoa." });
      }
    }
  );

  app.delete(
    "/api/customers/:id/contact-person-link",
    requireAppAuth,
    requirePermission("customers.edit"),
    requireAnyPermission(["people.link.manage", "users.manage"]),
    async (req, res) => {
      try {
        const result = await unlinkCustomerContactPerson(prisma, req.params.id);
        res.json(result);
      } catch (error) {
        if (error instanceof CanonicalPersonError) {
          return res.status(error.status).json({ error: error.message, code: error.code });
        }
        console.error("DELETE /api/customers/:id/contact-person-link", error);
        res.status(500).json({ error: "Erro ao desvincular contato." });
      }
    }
  );

  app.get(
    "/api/people/diagnostics/unequivocal-matches",
    requireAppAuth,
    requireAnyPermission(["users.manage", "people.link.manage"]),
    async (_req, res) => {
      try {
        const report = await diagnoseUnequivocalPersonMatches(prisma);
        res.json(report);
      } catch (error) {
        console.error("GET /api/people/diagnostics/unequivocal-matches", error);
        res.status(500).json({ error: "Erro no diagnóstico." });
      }
    }
  );
}

/** Helper usado pelo POST/PUT employee. */
export async function resolvePersonIdFromEmployeeBody(
  body: Record<string, unknown>,
  existingEmployeeId?: string | null
) {
  const resolutions = (body.personFieldResolutions ??
    {}) as Partial<Record<PersonFieldKey, FieldResolutionChoice>>;
  const hasLink =
    (typeof body.personId === "string" && body.personId.trim()) ||
    (typeof body.personSourceId === "string" && body.personSourceId.trim());
  const createNewPerson =
    body.createNewPerson === true ||
    (!existingEmployeeId && !hasLink && body.createNewPerson !== false);

  return resolveEmployeePersonIdForPersist(prisma, {
    personId: typeof body.personId === "string" ? body.personId.trim() || null : null,
    createNewPerson,
    sourceKind: (body.personSourceKind as PersonLinkSourceKind) ?? null,
    sourceId: typeof body.personSourceId === "string" ? body.personSourceId.trim() || null : null,
    form: {
      name: typeof body.name === "string" ? body.name : null,
      displayName: typeof body.name === "string" ? body.name : null,
      socialName: typeof body.socialName === "string" ? body.socialName : null,
      corporateEmail:
        typeof body.corporateEmail === "string" ? body.corporateEmail : null,
      personalEmail:
        typeof body.personalEmail === "string" ? body.personalEmail : null,
      cpf: typeof body.cpf === "string" ? body.cpf : null,
      phone: typeof body.phone === "string" ? body.phone : null,
    },
    fieldResolutions: resolutions,
    existingEmployeeId,
  });
}
