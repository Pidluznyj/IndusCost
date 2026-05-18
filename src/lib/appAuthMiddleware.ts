import type { Request, Response, NextFunction, RequestHandler } from "express";
import {
  hasAnyPermission,
  hasPermission,
  type AppAuthContext,
} from "@/src/lib/appAuth.js";

export function sendAuthForbidden(res: Response, requiredPermissions: string[]): Response {
  return res.status(403).json({
    error: "FORBIDDEN",
    message: "Você não tem permissão para acessar este recurso.",
    requiredPermissions,
  });
}

export function hasAnyAppPermission(user: AppAuthContext, permissions: string[]): boolean {
  return hasAnyPermission(user, permissions);
}

export type ReadAppSessionFn = (req: Request) => Promise<AppAuthContext | null>;

export function createAuthGuards(readAppSession: ReadAppSessionFn) {
  async function getCurrentAppUser(req: Request): Promise<AppAuthContext | null> {
    if (req.appAuth) return req.appAuth;
    const auth = await readAppSession(req);
    if (auth) req.appAuth = auth;
    return auth;
  }

  const requireAppAuth: RequestHandler = async (req, res, next) => {
    const auth = await getCurrentAppUser(req);
    if (!auth) {
      return res.status(401).json({
        error: "UNAUTHORIZED",
        message: "Autenticação necessária.",
      });
    }
    return next();
  };

  function requirePermission(permission: string): RequestHandler {
    return async (req, res, next) => {
      const auth = await getCurrentAppUser(req);
      if (!auth) {
        return res.status(401).json({
          error: "UNAUTHORIZED",
          message: "Autenticação necessária.",
        });
      }
      if (!hasPermission(auth, permission)) {
        return sendAuthForbidden(res, [permission]);
      }
      return next();
    };
  }

  function requireAnyPermission(permissions: string[]): RequestHandler {
    return async (req, res, next) => {
      const auth = await getCurrentAppUser(req);
      if (!auth) {
        return res.status(401).json({
          error: "UNAUTHORIZED",
          message: "Autenticação necessária.",
        });
      }
      if (!hasAnyAppPermission(auth, permissions)) {
        return sendAuthForbidden(res, permissions);
      }
      return next();
    };
  }

  function requireAllPermissions(permissions: string[]): RequestHandler {
    return async (req, res, next) => {
      const auth = await getCurrentAppUser(req);
      if (!auth) {
        return res.status(401).json({
          error: "UNAUTHORIZED",
          message: "Autenticação necessária.",
        });
      }
      const missing = permissions.filter((p) => !hasPermission(auth, p));
      if (missing.length > 0) {
        return sendAuthForbidden(res, permissions);
      }
      return next();
    };
  }

  return {
    requireAppAuth,
    requirePermission,
    requireAnyPermission,
    requireAllPermissions,
    getCurrentAppUser,
    hasAnyAppPermission,
  };
}

export type SellerDashboardScopeMode = "all" | "own";

export type SellerDashboardScopeResult =
  | {
      ok: true;
      scopeMode: SellerDashboardScopeMode;
      externalSellerId: number | null;
      responsible: string | null;
    }
  | { ok: false; status: number; body: Record<string, unknown> };

/** Filtro efetivo para SQL: ID Nomus tem prioridade; responsible só se ID ausente. */
export function sellerDashboardMatchFilters(
  externalSellerId: number | null,
  responsible: string | null
): { externalSellerId: number | null; responsible: string | null } {
  if (externalSellerId !== null) {
    return { externalSellerId, responsible: null };
  }
  return { externalSellerId: null, responsible };
}

/** Escopo de vendedor para GET /api/crm/seller-dashboard (Fase 1K-E). */
export function resolveSellerDashboardScope(
  auth: AppAuthContext,
  queryExternalSellerId: unknown,
  queryResponsible: unknown,
  parseExternalSellerId: (raw: unknown) => number | null,
  parseResponsible: (raw: unknown) => string | null
): SellerDashboardScopeResult {
  if (hasPermission(auth, "crm.seller.all")) {
    const externalSellerId = parseExternalSellerId(queryExternalSellerId);
    const responsible = parseResponsible(queryResponsible);
    return {
      ok: true,
      scopeMode: "all",
      ...sellerDashboardMatchFilters(externalSellerId, responsible),
    };
  }

  if (hasPermission(auth, "crm.seller.own")) {
    const externalSellerId = auth.externalSellerId;
    const responsible = auth.sellerResponsibleName?.trim() || null;
    if (externalSellerId == null && !responsible) {
      return {
        ok: false,
        status: 403,
        body: {
          error: "SELLER_NOT_LINKED",
          message: "Seu usuário não está vinculado a um vendedor Nomus.",
        },
      };
    }
    return {
      ok: true,
      scopeMode: "own",
      ...sellerDashboardMatchFilters(externalSellerId, responsible),
    };
  }

  return {
    ok: false,
    status: 403,
    body: {
      error: "FORBIDDEN",
      message:
        "Permissão insuficiente: é necessário crm.seller.own ou crm.seller.all para consultar o dashboard por vendedor.",
      requiredPermissions: ["crm.seller.own", "crm.seller.all"],
    },
  };
}
