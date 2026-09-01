/**
 * Fluxo COMPLETO da troca obrigatória, ponta a ponta, num Express real.
 *
 * Reproduz a topologia do server.ts: login → sessão opaca em AppSession →
 * guard de troca obrigatória montado em /api antes das rotas de negócio →
 * complete-password-change → sessão rotacionada → sistema liberado.
 *
 * O cliente é um `fetch` cru com jar de cookie manual: se o bloqueio dependesse
 * do React, este teste passaria mesmo com a feature quebrada — e é justamente
 * por isso que ele não usa React nenhum.
 *
 * Senhas fictícias.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import {
  APP_SESSION_COOKIE_NAME,
  APP_SESSION_TTL_MS,
} from "./appAuth.shared.js";
import {
  createOpaqueSessionToken,
  hashPassword,
  hashSessionToken,
  verifyPassword,
} from "./appAuth.server.js";
import { createPasswordChangeRequiredGuard } from "./passwordChangeRequiredGuard.js";
import { registerPasswordLifecycleRoutes } from "./passwordLifecycleRoutes.js";
import { AuthRateLimiter } from "./authRateLimit.js";
import { FakePrisma, makeUser } from "./passwordLifecycleFakeDb.js";
import { SECURITY_AUDIT_EVENTS } from "./securityAudit.server.js";

const EMAIL = "colaborador@exemplo.test";
const SENHA_ORIGINAL = "senha original valida";
const SENHA_DEFINITIVA = "minha senha definitiva";

type Ctx = {
  db: FakePrisma;
  url: string;
  close: () => Promise<void>;
};

/** Jar de cookie mínimo: guarda só o cookie de sessão do IndusCost. */
class CookieJar {
  private value: string | null = null;

  capture(setCookie: string | null): void {
    if (!setCookie) return;
    const match = setCookie.match(new RegExp(`${APP_SESSION_COOKIE_NAME}=([^;]*)`));
    if (match) this.value = match[1] || null;
  }

  header(): Record<string, string> {
    return this.value ? { cookie: `${APP_SESSION_COOKIE_NAME}=${this.value}` } : {};
  }

  raw(): string | null {
    return this.value;
  }

  set(token: string | null): void {
    this.value = token;
  }
}

async function startApp(): Promise<Ctx> {
  const db = new FakePrisma(
    [
      makeUser({
        id: "user-1",
        email: EMAIL,
        passwordHash: await hashPassword(SENHA_ORIGINAL),
        role: "SELLER",
        mustChangePassword: false,
      }),
      makeUser({
        id: "super-1",
        email: "super@exemplo.test",
        passwordHash: await hashPassword("senha do super admin"),
        role: "SUPER_ADMIN",
      }),
    ],
    []
  );

  const app = express();
  app.use(express.json());

  /** Leitor de sessão equivalente ao readAppSession do server.ts. */
  async function readAppSession(req: express.Request) {
    const cookie = req.headers.cookie ?? "";
    const match = cookie.match(new RegExp(`${APP_SESSION_COOKIE_NAME}=([^;]*)`));
    if (!match?.[1]) return null;
    const session = await db.appSession.findFirst({
      where: { tokenHash: hashSessionToken(match[1]), revokedAt: null },
    });
    if (!session) return null;
    const user = db.userById(session.userId);
    if (!user?.isActive) return null;
    return {
      id: user.id,
      role: user.role,
      email: user.email,
      isActive: user.isActive,
      mustChangePassword: user.mustChangePassword,
      sessionId: session.id,
    };
  }

  function setAppSessionCookie(res: express.Response, token: string) {
    res.cookie(APP_SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: APP_SESSION_TTL_MS,
      path: "/",
    });
  }

  // --- login (equivalente ao POST /api/auth/login do server.ts) ---
  app.post("/api/auth/login", async (req, res) => {
    const user = db.users.find((u) => u.email === req.body?.email);
    if (!user || !user.isActive) {
      return res.status(401).json({ error: "INVALID_CREDENTIALS" });
    }
    if (!(await verifyPassword(String(req.body?.password ?? ""), user.passwordHash))) {
      return res.status(401).json({ error: "INVALID_CREDENTIALS" });
    }
    const token = createOpaqueSessionToken();
    await db.appSession.create({
      data: {
        userId: user.id,
        tokenHash: hashSessionToken(token),
        expiresAt: new Date(Date.now() + APP_SESSION_TTL_MS),
        permissionsVersionAtIssue: user.permissionsVersion,
      },
    });
    setAppSessionCookie(res, token);
    // O DTO expõe o estado — o frontend não deduz por mensagem de erro.
    return res.json({ user: { id: user.id, mustChangePassword: user.mustChangePassword } });
  });

  // --- guard, montado antes das rotas de negócio ---
  const guard = createPasswordChangeRequiredGuard({
    resolveMustChangePassword: async (req) => {
      const auth = await readAppSession(req as express.Request);
      return auth ? auth.mustChangePassword === true : null;
    },
  });
  app.use("/api", (req, res, next) => {
    guard(req, res, next).catch(next);
  });

  // --- rotas depois do guard ---
  app.get("/api/auth/me", async (req, res) => {
    const auth = await readAppSession(req);
    if (!auth) return res.json({ authenticated: false, user: null });
    return res.json({
      authenticated: true,
      user: { id: auth.id, role: auth.role, mustChangePassword: auth.mustChangePassword },
    });
  });

  app.post("/api/auth/logout", async (req, res) => {
    const auth = await readAppSession(req);
    if (auth) {
      await db.appSession.updateMany({
        where: { id: auth.sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return res.json({ success: true });
  });

  const requireAppAuth: express.RequestHandler = async (req, res, next) => {
    const auth = await readAppSession(req);
    if (!auth) return res.status(401).json({ error: "UNAUTHORIZED" });
    (req as express.Request & { authCtx?: unknown }).authCtx = auth;
    return next();
  };

  registerPasswordLifecycleRoutes(app, {
    prisma: db as never,
    requireAppAuth,
    requireAdminUsersManage: requireAppAuth,
    getCurrentAppUser: async (req) => (await readAppSession(req)) as never,
    setAppSessionCookie,
    rateLimiter: new AuthRateLimiter(),
  });

  // Rota de negócio qualquer, protegida pelo guard de sessão normal.
  app.get("/api/sales-orders", requireAppAuth, (_req, res) => res.json({ pedidos: [] }));

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr !== "object") throw new Error("sem porta");

  return {
    db,
    url: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

async function request(
  ctx: Ctx,
  jar: CookieJar,
  method: string,
  path: string,
  body?: unknown
) {
  const res = await fetch(`${ctx.url}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...jar.header(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  jar.capture(res.headers.get("set-cookie"));
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body: json };
}

describe("E2E — reset administrativo até a liberação do sistema", () => {
  it("percorre o fluxo inteiro e bloqueia de verdade no meio dele", async () => {
    const ctx = await startApp();
    try {
      /* 1. O usuário está operando normalmente, com duas sessões abertas. */
      const pc = new CookieJar();
      const celular = new CookieJar();
      await request(ctx, pc, "POST", "/api/auth/login", {
        email: EMAIL,
        password: SENHA_ORIGINAL,
      });
      await request(ctx, celular, "POST", "/api/auth/login", {
        email: EMAIL,
        password: SENHA_ORIGINAL,
      });
      assert.equal((await request(ctx, pc, "GET", "/api/sales-orders")).status, 200);
      assert.equal((await request(ctx, celular, "GET", "/api/sales-orders")).status, 200);
      assert.equal(ctx.db.activeSessionsOf("user-1").length, 2);

      /* 2. SUPER_ADMIN reseta a senha. */
      const admin = new CookieJar();
      await request(ctx, admin, "POST", "/api/auth/login", {
        email: "super@exemplo.test",
        password: "senha do super admin",
      });
      const reset = await request(ctx, admin, "POST", "/api/admin/users/user-1/reset-password", {});
      assert.equal(reset.status, 200);
      const temporaria = String(reset.body.temporaryPassword);

      /* 3. As sessões anteriores morreram — PC e celular. */
      assert.equal(ctx.db.activeSessionsOf("user-1").length, 0);
      assert.equal((await request(ctx, pc, "GET", "/api/sales-orders")).status, 401);
      assert.equal((await request(ctx, celular, "GET", "/api/sales-orders")).status, 401);

      /* 4. A senha anterior não autentica mais. */
      const loginVelho = await request(ctx, new CookieJar(), "POST", "/api/auth/login", {
        email: EMAIL,
        password: SENHA_ORIGINAL,
      });
      assert.equal(loginVelho.status, 401);

      /* 5. A temporária autentica e cria uma sessão RESTRITA. */
      const novo = new CookieJar();
      const loginTemp = await request(ctx, novo, "POST", "/api/auth/login", {
        email: EMAIL,
        password: temporaria,
      });
      assert.equal(loginTemp.status, 200, "login com temporária precisa funcionar");
      assert.equal((loginTemp.body.user as Record<string, unknown>).mustChangePassword, true);
      const tokenRestrito = novo.raw();

      /* 6. /api/auth/me funciona e informa o estado. */
      const me = await request(ctx, novo, "GET", "/api/auth/me");
      assert.equal(me.status, 200);
      assert.equal((me.body.user as Record<string, unknown>).mustChangePassword, true);

      /* 7. API normal é BLOQUEADA pelo backend — chamada crua, sem frontend. */
      const bloqueado = await request(ctx, novo, "GET", "/api/sales-orders");
      assert.equal(bloqueado.status, 403);
      assert.equal(bloqueado.body.code, "PASSWORD_CHANGE_REQUIRED");

      /* 7b. Nem a troca voluntária serve de atalho: também está fora da whitelist. */
      const atalho = await request(ctx, novo, "POST", "/api/auth/change-password", {
        currentPassword: temporaria,
        newPassword: SENHA_DEFINITIVA,
      });
      assert.equal(atalho.status, 403);
      assert.equal(atalho.body.code, "PASSWORD_CHANGE_REQUIRED");

      /* 8. A troca obrigatória conclui. */
      const concluir = await request(ctx, novo, "POST", "/api/auth/complete-password-change", {
        newPassword: SENHA_DEFINITIVA,
      });
      assert.equal(concluir.status, 200);
      assert.equal(concluir.body.mustChangePassword, false);

      /* 9. A sessão foi rotacionada: o cookie mudou e o token anterior morreu. */
      assert.notEqual(novo.raw(), tokenRestrito, "cookie precisa ter sido substituído");
      const jarAntigo = new CookieJar();
      jarAntigo.set(tokenRestrito);
      assert.equal(
        (await request(ctx, jarAntigo, "GET", "/api/sales-orders")).status,
        401,
        "sessão anterior à troca não pode continuar valendo"
      );

      /* 10. /me confirma o estado e o sistema volta a funcionar. */
      const meDepois = await request(ctx, novo, "GET", "/api/auth/me");
      assert.equal((meDepois.body.user as Record<string, unknown>).mustChangePassword, false);
      assert.equal((await request(ctx, novo, "GET", "/api/sales-orders")).status, 200);

      /* 11. A temporária deixou de valer; a definitiva vale. */
      assert.equal(
        (await request(ctx, new CookieJar(), "POST", "/api/auth/login", {
          email: EMAIL,
          password: temporaria,
        })).status,
        401
      );
      assert.equal(
        (await request(ctx, new CookieJar(), "POST", "/api/auth/login", {
          email: EMAIL,
          password: SENHA_DEFINITIVA,
        })).status,
        200
      );

      /* 12. A trilha de auditoria existe e não vazou segredo. */
      const eventos = ctx.db.audits.map((a) => a.eventType);
      assert.deepEqual(eventos, [
        SECURITY_AUDIT_EVENTS.PASSWORD_RESET_BY_SUPER_ADMIN,
        SECURITY_AUDIT_EVENTS.PASSWORD_FORCED_CHANGE_COMPLETED,
      ]);
      const dump = JSON.stringify(ctx.db.audits);
      assert.equal(dump.includes(temporaria), false);
      assert.equal(dump.includes(SENHA_DEFINITIVA), false);
      assert.equal(dump.includes(SENHA_ORIGINAL), false);
    } finally {
      await ctx.close();
    }
  });

  it("logout funciona durante o estado forçado (o usuário nunca fica preso)", async () => {
    const ctx = await startApp();
    try {
      const admin = new CookieJar();
      await request(ctx, admin, "POST", "/api/auth/login", {
        email: "super@exemplo.test",
        password: "senha do super admin",
      });
      const reset = await request(ctx, admin, "POST", "/api/admin/users/user-1/reset-password", {});
      const temporaria = String(reset.body.temporaryPassword);

      const jar = new CookieJar();
      await request(ctx, jar, "POST", "/api/auth/login", { email: EMAIL, password: temporaria });

      const saida = await request(ctx, jar, "POST", "/api/auth/logout");
      assert.equal(saida.status, 200);
      assert.equal(ctx.db.activeSessionsOf("user-1").length, 0);
    } finally {
      await ctx.close();
    }
  });

  it("usuário sem troca pendente não é afetado em nada (regressão)", async () => {
    const ctx = await startApp();
    try {
      const jar = new CookieJar();
      const login = await request(ctx, jar, "POST", "/api/auth/login", {
        email: EMAIL,
        password: SENHA_ORIGINAL,
      });
      assert.equal(login.status, 200);
      assert.equal((login.body.user as Record<string, unknown>).mustChangePassword, false);
      assert.equal((await request(ctx, jar, "GET", "/api/sales-orders")).status, 200);
      assert.equal((await request(ctx, jar, "GET", "/api/auth/me")).status, 200);

      // E a troca voluntária continua disponível para ele.
      const troca = await request(ctx, jar, "POST", "/api/auth/change-password", {
        currentPassword: SENHA_ORIGINAL,
        newPassword: SENHA_DEFINITIVA,
      });
      assert.equal(troca.status, 200);
      assert.equal((await request(ctx, jar, "GET", "/api/sales-orders")).status, 200);
    } finally {
      await ctx.close();
    }
  });
});
