/**
 * Guards Express-ready para o motor relacional.
 * Ainda não ligados em massa às rotas — uso sob demanda.
 */

import type { RequestHandler, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import {
  assertCanAccessResource,
  canAccessResource,
  createSeedPermissionSnapshot,
} from "@/src/lib/security/permissionService.js";
import type {
  PermissionActionInput,
  PermissionEvaluationSnapshot,
  PermissionSubject,
} from "@/src/lib/security/permissionTypes.js";
import { PermissionAccessError } from "@/src/lib/security/permissionTypes.js";

export function toPermissionSubject(user: {
  id?: string;
  role: PermissionSubject["role"];
  isActive?: boolean;
}): PermissionSubject {
  return {
    id: user.id,
    role: user.role,
    isActive: user.isActive,
  };
}

export function sendPermissionDenied(
  res: Response,
  err: PermissionAccessError
): Response {
  return res.status(403).json({
    error: "FORBIDDEN",
    code: err.code,
    message: err.message,
    resourceKey: err.resourceKey,
    action: err.action,
  });
}

/**
 * Factory de middleware. Exige `req.appAuth` já populado (requireAppAuth).
 * Snapshot opcional — default seed em memória até dual-read Prisma.
 */
export function requireResourceAccess(
  resourceKey: string,
  action: PermissionActionInput = "view",
  getSnapshot?: (req: Parameters<RequestHandler>[0]) => PermissionEvaluationSnapshot | undefined
): RequestHandler {
  return (req, res, next) => {
    const auth = (req as { appAuth?: AppAuthContext }).appAuth;
    if (!auth) {
      return res.status(401).json({
        error: "UNAUTHORIZED",
        message: "Autenticação necessária.",
      });
    }
    const subject = toPermissionSubject({
      id: auth.id,
      role: auth.role,
      isActive: auth.isActive,
    });
    const snapshot =
      getSnapshot?.(req) ??
      createSeedPermissionSnapshot({ role: subject.role, userId: subject.id });

    try {
      assertCanAccessResource(subject, resourceKey, action, snapshot);
      return next();
    } catch (err) {
      if (err instanceof PermissionAccessError) {
        return sendPermissionDenied(res, err);
      }
      return next(err);
    }
  };
}

export function userCanAccessResource(
  user: PermissionSubject,
  resourceKey: string,
  action: PermissionActionInput = "view",
  snapshot?: PermissionEvaluationSnapshot
): boolean {
  return canAccessResource(user, resourceKey, action, snapshot);
}
