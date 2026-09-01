/**
 * Rotas do ciclo de senha (troca voluntária, troca obrigatória, reset admin).
 *
 * Registradas a partir do `server.ts` no mesmo padrão já usado por outras
 * superfícies (`registerSatisfactionPublicRoutes`, `registerMaterialStockTabletRoutes`):
 * dependências injetadas, para que o comportamento seja exercitável por teste
 * sem subir o servidor inteiro.
 *
 * `POST /api/admin/users/:id/reset-password` MORA AQUI, não é rota nova: é a
 * rota oficial que a tela de Usuários já consome, movida para cá junto com o
 * endurecimento (SUPER_ADMIN + senha gerada pelo sistema + auditoria). Criar um
 * segundo endpoint de reset deixaria o antigo aberto.
 */

import type { PrismaClient } from "@prisma/client";
import type { Express, RequestHandler, Request, Response } from "express";
import type { AppAuthContext } from "./appAuth.shared.js";
import {
  authRateLimitedBody,
  authRateLimiter,
  type AuthRateLimiter,
} from "./authRateLimit.js";
import {
  adminResetPassword,
  changeOwnPassword,
  completeForcedPasswordChange,
  isPasswordLifecycleFailure,
  type RequestOrigin,
} from "./passwordLifecycle.server.js";
import { resolveAuditIpAddress, normalizeUserAgent } from "./securityAudit.server.js";

export const PASSWORD_LIFECYCLE_ROUTES = {
  changePassword: "/api/auth/change-password",
  completePasswordChange: "/api/auth/complete-password-change",
  adminResetPassword: "/api/admin/users/:id/reset-password",
} as const;

export type PasswordLifecycleRouteDeps = {
  prisma: PrismaClient;
  /** Guard de sessão humana já existente. */
  requireAppAuth: RequestHandler;
  /** Guard já existente do módulo de usuários (admin.settings.security:manage). */
  requireAdminUsersManage: RequestHandler;
  getCurrentAppUser: (req: Request) => Promise<AppAuthContext | null>;
  /** Emissor de cookie canônico do servidor — TTL e flags não mudam aqui. */
  setAppSessionCookie: (res: Response, token: string) => void;
  rateLimiter?: AuthRateLimiter;
};

function requestOrigin(req: Request): RequestOrigin {
  return {
    ipAddress: resolveAuditIpAddress(req.socket?.remoteAddress),
    userAgent: normalizeUserAgent(req.headers["user-agent"]),
  };
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function registerPasswordLifecycleRoutes(
  app: Express,
  deps: PasswordLifecycleRouteDeps
): void {
  const limiter = deps.rateLimiter ?? authRateLimiter;

  /* ---------------------------------------------------------------- */
  /* Troca voluntária — exige a senha atual                            */
  /* ---------------------------------------------------------------- */
  app.post(PASSWORD_LIFECYCLE_ROUTES.changePassword, deps.requireAppAuth, async (req, res) => {
    try {
      const auth = await deps.getCurrentAppUser(req);
      if (!auth) {
        return res
          .status(401)
          .json({ error: "UNAUTHORIZED", code: "UNAUTHORIZED", message: "Autenticação necessária." });
      }

      const gate = limiter.consume("change-password", auth.id);
      if (!gate.allowed) {
        res.set("Retry-After", String(gate.retryAfterSeconds));
        return res.status(429).json(authRateLimitedBody(gate));
      }

      const result = await changeOwnPassword(
        { db: deps.prisma },
        {
          userId: auth.id,
          currentPassword: readString(req.body?.currentPassword),
          newPassword: readString(req.body?.newPassword),
          origin: requestOrigin(req),
        }
      );

      if (isPasswordLifecycleFailure(result)) {
        return res.status(result.status).json({
          error: result.code,
          code: result.code,
          message: result.message,
          ...(result.reasons ? { reasons: result.reasons } : {}),
        });
      }

      // A sessão da requisição atual também foi revogada: o cookie precisa ser
      // substituído pelo da sessão recém-emitida, senão o usuário cai no login.
      deps.setAppSessionCookie(res, result.session.token);
      // Sucesso legítimo não deve deixar o usuário perto do limite.
      limiter.clear("change-password", auth.id);

      return res.json({
        success: true,
        mustChangePassword: false,
        sessionsRevoked: result.sessionsRevoked,
      });
    } catch (error) {
      console.error("POST /api/auth/change-password", error);
      return res
        .status(500)
        .json({ error: "INTERNAL_ERROR", code: "INTERNAL_ERROR", message: "Erro ao alterar a senha." });
    }
  });

  /* ---------------------------------------------------------------- */
  /* Troca obrigatória — não repede a senha temporária                 */
  /* ---------------------------------------------------------------- */
  app.post(
    PASSWORD_LIFECYCLE_ROUTES.completePasswordChange,
    deps.requireAppAuth,
    async (req, res) => {
      try {
        const auth = await deps.getCurrentAppUser(req);
        if (!auth) {
          return res.status(401).json({
            error: "UNAUTHORIZED",
            code: "UNAUTHORIZED",
            message: "Autenticação necessária.",
          });
        }

        const gate = limiter.consume("change-password", auth.id);
        if (!gate.allowed) {
          res.set("Retry-After", String(gate.retryAfterSeconds));
          return res.status(429).json(authRateLimitedBody(gate));
        }

        const result = await completeForcedPasswordChange(
          { db: deps.prisma },
          {
            userId: auth.id,
            newPassword: readString(req.body?.newPassword),
            origin: requestOrigin(req),
          }
        );

        if (isPasswordLifecycleFailure(result)) {
          return res.status(result.status).json({
            error: result.code,
            code: result.code,
            message: result.message,
            ...(result.reasons ? { reasons: result.reasons } : {}),
          });
        }

        deps.setAppSessionCookie(res, result.session.token);
        limiter.clear("change-password", auth.id);

        return res.json({
          success: true,
          mustChangePassword: false,
          sessionsRevoked: result.sessionsRevoked,
        });
      } catch (error) {
        console.error("POST /api/auth/complete-password-change", error);
        return res.status(500).json({
          error: "INTERNAL_ERROR",
          code: "INTERNAL_ERROR",
          message: "Erro ao concluir a troca de senha.",
        });
      }
    }
  );

  /* ---------------------------------------------------------------- */
  /* Reset administrativo — SOMENTE SUPER_ADMIN                        */
  /* ---------------------------------------------------------------- */
  app.post(
    PASSWORD_LIFECYCLE_ROUTES.adminResetPassword,
    deps.requireAdminUsersManage,
    async (req, res) => {
      try {
        const auth = await deps.getCurrentAppUser(req);
        if (!auth) {
          return res.status(401).json({
            error: "UNAUTHORIZED",
            code: "UNAUTHORIZED",
            message: "Autenticação necessária.",
          });
        }

        // Segunda barreira, e a decisiva: `admin.settings.security:manage`
        // libera a tela de Usuários, mas redefinir a credencial de outra pessoa
        // exige o papel máximo. ADMIN e demais perfis param aqui, no backend.
        if (auth.role !== "SUPER_ADMIN") {
          return res.status(403).json({
            error: "FORBIDDEN",
            code: "FORBIDDEN",
            message: "Apenas um super administrador pode redefinir a senha de outro usuário.",
          });
        }

        // Falha ALTA em cliente antigo que ainda mande a senha escolhida à mão:
        // ignorar em silêncio faria o administrador anunciar uma senha que não
        // é a que o sistema gravou.
        if (req.body != null && typeof (req.body as Record<string, unknown>).password === "string") {
          return res.status(400).json({
            error: "TEMPORARY_PASSWORD_IS_GENERATED",
            code: "TEMPORARY_PASSWORD_IS_GENERATED",
            message:
              "A senha temporária passou a ser gerada pelo sistema. Atualize a página e refaça a operação.",
          });
        }

        const targetUserId = String(req.params.id ?? "").trim();
        if (!targetUserId) {
          return res
            .status(400)
            .json({ error: "INVALID_ID", code: "INVALID_ID", message: "ID inválido." });
        }

        const gate = limiter.consume("admin-reset", auth.id);
        if (!gate.allowed) {
          res.set("Retry-After", String(gate.retryAfterSeconds));
          return res.status(429).json(authRateLimitedBody(gate));
        }

        const result = await adminResetPassword(
          { db: deps.prisma },
          {
            actorUserId: auth.id,
            targetUserId,
            origin: requestOrigin(req),
          }
        );

        if (isPasswordLifecycleFailure(result)) {
          return res
            .status(result.status)
            .json({ error: result.code, code: result.code, message: result.message });
        }

        // A senha temporária aparece UMA única vez, aqui. Não há rota para
        // reconsultá-la; se o administrador perder, gera outro reset.
        res.set("Cache-Control", "no-store, no-cache, must-revalidate");
        res.set("Pragma", "no-cache");
        return res.json({
          success: true,
          temporaryPassword: result.temporaryPassword,
          mustChangePassword: true,
          sessionsRevoked: result.sessionsRevoked,
        });
      } catch (error) {
        console.error("POST /api/admin/users/:id/reset-password", error);
        return res.status(500).json({
          error: "INTERNAL_ERROR",
          code: "INTERNAL_ERROR",
          message: "Erro ao redefinir a senha.",
        });
      }
    }
  );
}
