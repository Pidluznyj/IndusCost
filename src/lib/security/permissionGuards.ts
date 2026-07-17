/**
 * Guards Express para o motor relacional de permissões.
 *
 * Uso:
 *   app.get("/api/...", requireAppAuth, requirePermission(resourceKey, action), handler)
 *
 * `requirePermission` também autentica (401) se `req.appAuth` estiver ausente e
 * `getCurrentAppUser` tiver sido injetado via `createResourcePermissionGuards`.
 */

import type { Request, RequestHandler, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  assertCanAccessResource,
  canAccessResource,
} from "@/src/lib/security/permissionService.js";
import {
  buildPermissionSnapshotForAuth,
  toAuthPermissionSubject,
  type AuthPermissionInput,
} from "@/src/lib/security/permissionSnapshot.js";
import type {
  PermissionActionInput,
  PermissionEvaluationSnapshot,
  PermissionSubject,
} from "@/src/lib/security/permissionTypes.js";
import { PermissionAccessError } from "@/src/lib/security/permissionTypes.js";
import { normalizePermissionAction } from "@/src/lib/security/permissionService.js";
import {
  authorizeRequireResource,
  createRequireResourceGuards,
  requireResource,
  type RequireResourceAction,
} from "@/src/lib/security/requireResource.js";

export type ReadAppUserFn = (req: Request) => Promise<AppAuthContext | null>;

function friendlyDeniedMessage(resourceKey: string, action: string): string {
  return `Você não tem permissão para acessar este recurso (${resourceKey}:${action}).`;
}

export function sendPermissionDenied(
  res: Response,
  err: PermissionAccessError
): Response {
  return res.status(403).json({
    error: "FORBIDDEN",
    code: err.code,
    message: friendlyDeniedMessage(err.resourceKey, err.action),
    resourceKey: err.resourceKey,
    action: err.action,
  });
}

export function logPermissionDenied(args: {
  userId?: string;
  role?: string;
  resourceKey: string;
  action: string;
  path?: string;
}): void {
  console.warn(
    `[permission] DENIED resourceKey=${args.resourceKey} action=${args.action}` +
      ` userId=${args.userId ?? "?"} role=${args.role ?? "?"}` +
      (args.path ? ` path=${args.path}` : "")
  );
}

export type ResourceAuthorizationResult =
  | { ok: true }
  | {
      ok: false;
      status: 401 | 403;
      body: Record<string, unknown>;
      accessError?: PermissionAccessError;
    };

/** Decisão pura — usada pelos testes e pelo middleware. */
export function authorizeResourceAccess(
  auth: AuthPermissionInput | null | undefined,
  resourceKey: string,
  action: PermissionActionInput = "view",
  snapshot?: PermissionEvaluationSnapshot
): ResourceAuthorizationResult {
  if (!auth?.id || !auth.role) {
    return {
      ok: false,
      status: 401,
      body: {
        error: "UNAUTHORIZED",
        message: "Autenticação necessária.",
      },
    };
  }

  const snap = snapshot ?? buildPermissionSnapshotForAuth(auth);
  const subject = toAuthPermissionSubject(auth);
  const normalized = normalizePermissionAction(action);

  if (canAccessResource(subject, resourceKey, normalized, snap)) {
    return { ok: true };
  }

  const accessError = new PermissionAccessError(
    resourceKey,
    normalized,
    friendlyDeniedMessage(resourceKey, normalized)
  );
  return {
    ok: false,
    status: 403,
    body: {
      error: "FORBIDDEN",
      code: accessError.code,
      message: accessError.message,
      resourceKey,
      action: normalized,
    },
    accessError,
  };
}

function shouldBypassInTestEnv(): boolean {
  return (
    process.env.NODE_ENV === "test" &&
    process.env.PERMISSION_GUARD_STRICT !== "1"
  );
}

/**
 * Middleware reutilizável: `requirePermission(resourceKey, action)`.
 * Prefira `createResourcePermissionGuards(getCurrentAppUser).requirePermission`.
 */
export function requirePermission(
  resourceKey: string,
  action: PermissionActionInput = "view",
  getCurrentAppUser?: ReadAppUserFn
): RequestHandler {
  return async (req, res, next) => {
    if (shouldBypassInTestEnv()) {
      return next();
    }

    try {
      let auth = (req as { appAuth?: AppAuthContext }).appAuth ?? null;
      if (!auth && getCurrentAppUser) {
        auth = await getCurrentAppUser(req);
        if (auth) (req as { appAuth?: AppAuthContext }).appAuth = auth;
      }

      const result = authorizeResourceAccess(auth, resourceKey, action);
      if (!result.ok) {
        if (result.status === 403) {
          logPermissionDenied({
            userId: auth?.id,
            role: auth?.role,
            resourceKey,
            action: normalizePermissionAction(action),
            path: req.originalUrl ?? req.path,
          });
        }
        return res.status(result.status).json(result.body);
      }
      return next();
    } catch (err) {
      if (err instanceof PermissionAccessError) {
        logPermissionDenied({
          resourceKey: err.resourceKey,
          action: err.action,
          path: req.originalUrl ?? req.path,
        });
        return sendPermissionDenied(res, err);
      }
      console.error("[permission] guard error", err instanceof Error ? err.message : "unknown");
      return res.status(500).json({
        error: "INTERNAL_ERROR",
        message: "Erro ao verificar permissão.",
      });
    }
  };
}

export function createResourcePermissionGuards(
  getCurrentAppUser: ReadAppUserFn,
  defaults?: import("@/src/lib/security/requireResource.js").RequireResourceGuardOptions
) {
  const official = createRequireResourceGuards(getCurrentAppUser, defaults);
  return {
    /** @deprecated Preferir `requireResource` (resolvedor oficial P14). */
    requirePermission: (
      resourceKey: string,
      action: PermissionActionInput = "view"
    ): RequestHandler => requirePermission(resourceKey, action, getCurrentAppUser),

    /**
     * Guard oficial P14/PERM-30: `requireResource` via resolvedor canônico.
     */
    requireResource: (
      resourceKey: string,
      action: RequireResourceAction | string = "view"
    ): RequestHandler => official.requireResource(resourceKey, action),

    requireBootstrapOrResource: official.requireBootstrapOrResource,
    authorizeResourceRequest: official.authorizeRequest,

    /** Bootstrap cookie OU permissão de recurso (seed path legado). */
    requireBootstrapOrPermission: (
      isBootstrap: (req: Request) => boolean,
      resourceKey: string,
      action: PermissionActionInput = "view"
    ): RequestHandler => {
      return async (req, res, next) => {
        if (shouldBypassInTestEnv()) return next();
        if (isBootstrap(req)) return next();
        return requirePermission(resourceKey, action, getCurrentAppUser)(req, res, next);
      };
    },

    authorizeRequireResource,
  };
}

export function userCanAccessResource(
  user: PermissionSubject & AuthPermissionInput,
  resourceKey: string,
  action: PermissionActionInput = "view",
  snapshot?: PermissionEvaluationSnapshot
): boolean {
  return authorizeResourceAccess(user, resourceKey, action, snapshot).ok;
}

export {
  assertCanAccessResource,
  canAccessResource,
  buildPermissionSnapshotForAuth,
  requireResource,
  authorizeRequireResource,
};
