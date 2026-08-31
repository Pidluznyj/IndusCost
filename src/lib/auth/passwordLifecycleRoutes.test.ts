/**
 * Rotas do ciclo de senha — HTTP de verdade (express + servidor efêmero),
 * banco em memória e os guards reais injetados.
 *
 * É aqui que a matriz SUPER_ADMIN × demais papéis é PROVADA no backend, e não
 * apenas afirmada: cada papel faz a requisição e o status é conferido.
 *
 * Todas as senhas são fictícias.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import type { RequestHandler } from "express";
import { registerPasswordLifecycleRoutes } from "./passwordLifecycleRoutes.js";
import { AuthRateLimiter } from "./authRateLimit.js";
import { hashPassword, verifyPassword } from "./appAuth.server.js";
import {
  FakePrisma,
  makeSession,
  makeUser,
  type FakeUser,
} from "./passwordLifecycleFakeDb.js";
import { SECURITY_AUDIT_EVENTS } from "./securityAudit.server.js";

const SENHA_ATUAL = "senha atual valida";
const SENHA_NOVA = "senha nova bem grande";

/**
 * Estas rotas NÃO injetam helper de crypto: elas usam o scrypt canônico. Então
 * o banco de teste guarda um hash scrypt:v1 de verdade e o caminho exercitado
 * é o mesmo de produção, ponta a ponta.
 */
let hashAtualCache: string | null = null;
async function hashDaSenhaAtual(): Promise<string> {
  if (!hashAtualCache) hashAtualCache = await hashPassword(SENHA_ATUAL);
  return hashAtualCache;
}

type Actor = { id: string; role: string } | null;

type Harness = {
  db: FakePrisma;
  url: string;
  cookies: string[];
  close: () => Promise<void>;
};

async function startHarness(opts: {
  actor: Actor;
  users?: FakeUser[];
  sessionCount?: number;
  rateLimiter?: AuthRateLimiter;
}): Promise<Harness> {
  const users = opts.users ?? [makeUser({ passwordHash: await hashDaSenhaAtual() })];
  const sessions = Array.from({ length: opts.sessionCount ?? 2 }, (_, i) =>
    makeSession({ id: `session-antiga-${i + 1}`, tokenHash: `hash-antigo-${i + 1}` })
  );
  const db = new FakePrisma(users, sessions);
  const cookies: string[] = [];

  const app = express();
  app.use(express.json());

  const requireAppAuth: RequestHandler = (_req, res, next) => {
    if (!opts.actor) {
      return res.status(401).json({ error: "UNAUTHORIZED", message: "Autenticação necessária." });
    }
    return next();
  };
  // Guard existente do módulo de usuários: libera qualquer papel que tenha
  // admin.settings.security:manage. É de propósito permissivo aqui — o teste
  // precisa provar que a barreira do SUPER_ADMIN é a do handler, não esta.
  const requireAdminUsersManage: RequestHandler = (_req, res, next) => {
    if (!opts.actor) {
      return res.status(401).json({ error: "UNAUTHORIZED", message: "Autenticação necessária." });
    }
    return next();
  };

  registerPasswordLifecycleRoutes(app, {
    prisma: db as never,
    requireAppAuth,
    requireAdminUsersManage,
    getCurrentAppUser: async () => (opts.actor ? ({ ...opts.actor } as never) : null),
    setAppSessionCookie: (_res, token) => {
      cookies.push(token);
    },
    rateLimiter: opts.rateLimiter ?? new AuthRateLimiter(),
  });

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr !== "object") throw new Error("sem porta");

  return {
    db,
    cookies,
    url: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

async function post(url: string, path: string, body: unknown) {
  const res = await fetch(`${url}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body: json, headers: res.headers };
}

/* ================================================================== */
/* POST /api/auth/change-password                                      */
/* ================================================================== */

describe("POST /api/auth/change-password", () => {
  it("exige sessão autenticada (401 antes de tocar no banco)", async () => {
    const h = await startHarness({ actor: null });
    try {
      const r = await post(h.url, "/api/auth/change-password", {
        currentPassword: SENHA_ATUAL,
        newPassword: SENHA_NOVA,
      });
      assert.equal(r.status, 401);
      assert.equal(h.db.userById("user-1")?.passwordHash, await hashDaSenhaAtual());
    } finally {
      await h.close();
    }
  });

  it("senha atual incorreta devolve INVALID_CURRENT_PASSWORD", async () => {
    const h = await startHarness({ actor: { id: "user-1", role: "VIEWER" } });
    try {
      const r = await post(h.url, "/api/auth/change-password", {
        currentPassword: "senha errada aqui",
        newPassword: SENHA_NOVA,
      });
      assert.equal(r.status, 400);
      assert.equal(r.body.code, "INVALID_CURRENT_PASSWORD");
    } finally {
      await h.close();
    }
  });

  it("senha fraca devolve PASSWORD_POLICY_VIOLATION (422) com as razões", async () => {
    const h = await startHarness({ actor: { id: "user-1", role: "VIEWER" } });
    try {
      const r = await post(h.url, "/api/auth/change-password", {
        currentPassword: SENHA_ATUAL,
        newPassword: "curta",
      });
      assert.equal(r.status, 422);
      assert.equal(r.body.code, "PASSWORD_POLICY_VIOLATION");
      assert.ok(Array.isArray(r.body.reasons));
    } finally {
      await h.close();
    }
  });

  it("sucesso: cookie novo é emitido e a resposta não vaza nada sensível", async () => {
    const h = await startHarness({ actor: { id: "user-1", role: "VIEWER" } });
    try {
      const r = await post(h.url, "/api/auth/change-password", {
        currentPassword: SENHA_ATUAL,
        newPassword: SENHA_NOVA,
      });
      assert.equal(r.status, 200);
      assert.equal(r.body.success, true);
      assert.equal(r.body.mustChangePassword, false);
      assert.equal(h.cookies.length, 1, "cookie de sessão foi substituído");

      const dump = JSON.stringify(r.body);
      assert.equal(dump.includes("passwordHash"), false);
      assert.equal(dump.includes(SENHA_NOVA), false);
      assert.equal(dump.includes("tokenHash"), false);
      assert.equal(dump.includes(h.cookies[0]), false, "token não volta no corpo");
    } finally {
      await h.close();
    }
  });

  it("sessões anteriores deixam de existir; sobra só a nova", async () => {
    const h = await startHarness({ actor: { id: "user-1", role: "VIEWER" }, sessionCount: 3 });
    try {
      await post(h.url, "/api/auth/change-password", {
        currentPassword: SENHA_ATUAL,
        newPassword: SENHA_NOVA,
      });
      assert.equal(h.db.activeSessionsOf("user-1").length, 1);
      assert.equal(h.db.audits[0].eventType, SECURITY_AUDIT_EVENTS.PASSWORD_CHANGED);
    } finally {
      await h.close();
    }
  });

  it("rate limit: 11ª tentativa na janela devolve 429 com Retry-After", async () => {
    const limiter = new AuthRateLimiter();
    const h = await startHarness({ actor: { id: "user-1", role: "VIEWER" }, rateLimiter: limiter });
    try {
      for (let i = 0; i < 10; i += 1) {
        const r = await post(h.url, "/api/auth/change-password", {
          currentPassword: "senha errada aqui",
          newPassword: SENHA_NOVA,
        });
        assert.equal(r.status, 400, `tentativa ${i + 1} deveria ser 400`);
      }
      const bloqueado = await post(h.url, "/api/auth/change-password", {
        currentPassword: "senha errada aqui",
        newPassword: SENHA_NOVA,
      });
      assert.equal(bloqueado.status, 429);
      assert.equal(bloqueado.body.code, "RATE_LIMITED");
      assert.ok(Number(bloqueado.headers.get("retry-after")) > 0);
    } finally {
      await h.close();
    }
  });
});

/* ================================================================== */
/* POST /api/auth/complete-password-change                             */
/* ================================================================== */

describe("POST /api/auth/complete-password-change", () => {
  it("exige sessão autenticada", async () => {
    const h = await startHarness({ actor: null });
    try {
      const r = await post(h.url, "/api/auth/complete-password-change", {
        newPassword: SENHA_NOVA,
      });
      assert.equal(r.status, 401);
    } finally {
      await h.close();
    }
  });

  it("sem troca pendente devolve 409 PASSWORD_CHANGE_NOT_REQUIRED", async () => {
    const h = await startHarness({
      actor: { id: "user-1", role: "VIEWER" },
      users: [makeUser({ mustChangePassword: false, passwordHash: await hashDaSenhaAtual() })],
    });
    try {
      const r = await post(h.url, "/api/auth/complete-password-change", {
        newPassword: SENHA_NOVA,
      });
      assert.equal(r.status, 409);
      assert.equal(r.body.code, "PASSWORD_CHANGE_NOT_REQUIRED");
    } finally {
      await h.close();
    }
  });

  it("com troca pendente: conclui, rotaciona a sessão e libera o estado", async () => {
    const h = await startHarness({
      actor: { id: "user-1", role: "VIEWER" },
      users: [makeUser({ mustChangePassword: true, passwordHash: await hashDaSenhaAtual() })],
      sessionCount: 2,
    });
    try {
      const r = await post(h.url, "/api/auth/complete-password-change", {
        newPassword: SENHA_NOVA,
      });
      assert.equal(r.status, 200);
      assert.equal(r.body.mustChangePassword, false);
      assert.equal(h.cookies.length, 1);
      assert.equal(h.db.userById("user-1")?.mustChangePassword, false);
      assert.equal(h.db.activeSessionsOf("user-1").length, 1);
      assert.equal(
        h.db.audits[0].eventType,
        SECURITY_AUDIT_EVENTS.PASSWORD_FORCED_CHANGE_COMPLETED
      );
    } finally {
      await h.close();
    }
  });
});

/* ================================================================== */
/* POST /api/admin/users/:id/reset-password — MATRIZ DE PAPÉIS         */
/* ================================================================== */

describe("POST /api/admin/users/:id/reset-password — autorização", () => {
  it("SUPER_ADMIN pode redefinir", async () => {
    const h = await startHarness({ actor: { id: "super-1", role: "SUPER_ADMIN" } });
    try {
      const r = await post(h.url, "/api/admin/users/user-1/reset-password", {});
      assert.equal(r.status, 200);
      assert.equal(typeof r.body.temporaryPassword, "string");
      assert.equal(r.body.mustChangePassword, true);
      // a temporária devolvida é EXATAMENTE a que passa a valer
      const gravado = String(h.db.userById("user-1")?.passwordHash);
      assert.equal(await verifyPassword(String(r.body.temporaryPassword), gravado), true);
      assert.equal(await verifyPassword(SENHA_ATUAL, gravado), false, "senha anterior morreu");
    } finally {
      await h.close();
    }
  });

  // A matriz completa: nenhum papel abaixo de SUPER_ADMIN passa, MESMO com o
  // guard de admin.settings.security:manage liberando a rota.
  for (const role of ["ADMIN", "COMMERCIAL_MANAGER", "SELLER", "VIEWER"]) {
    it(`${role} NÃO pode redefinir (403 no backend)`, async () => {
      const h = await startHarness({ actor: { id: `ator-${role}`, role } });
      try {
        const r = await post(h.url, "/api/admin/users/user-1/reset-password", {});
        assert.equal(r.status, 403, `${role} deveria receber 403`);
        assert.equal(r.body.code, "FORBIDDEN");
        // e nada aconteceu com o alvo
        assert.equal(h.db.userById("user-1")?.passwordHash, await hashDaSenhaAtual());
        assert.equal(h.db.userById("user-1")?.mustChangePassword, false);
        assert.equal(h.db.activeSessionsOf("user-1").length, 2);
        assert.equal(h.db.audits.length, 0);
      } finally {
        await h.close();
      }
    });
  }

  it("sem sessão devolve 401", async () => {
    const h = await startHarness({ actor: null });
    try {
      const r = await post(h.url, "/api/admin/users/user-1/reset-password", {});
      assert.equal(r.status, 401);
    } finally {
      await h.close();
    }
  });
});

describe("POST /api/admin/users/:id/reset-password — efeito e contrato", () => {
  it("a resposta é no-store e devolve a temporária uma única vez", async () => {
    const h = await startHarness({ actor: { id: "super-1", role: "SUPER_ADMIN" } });
    try {
      const r = await post(h.url, "/api/admin/users/user-1/reset-password", {});
      assert.match(String(r.headers.get("cache-control")), /no-store/);
      assert.match(String(r.headers.get("pragma")), /no-cache/);

      const temp = String(r.body.temporaryPassword);
      // não existe rota para reconsultar: um novo reset gera OUTRA senha
      const r2 = await post(h.url, "/api/admin/users/user-1/reset-password", {});
      assert.notEqual(String(r2.body.temporaryPassword), temp);
    } finally {
      await h.close();
    }
  });

  it("revoga as sessões do alvo e NÃO emite cookie para ninguém", async () => {
    const h = await startHarness({ actor: { id: "super-1", role: "SUPER_ADMIN" }, sessionCount: 3 });
    try {
      const r = await post(h.url, "/api/admin/users/user-1/reset-password", {});
      assert.equal(r.body.sessionsRevoked, 3);
      assert.equal(h.db.activeSessionsOf("user-1").length, 0);
      assert.equal(h.cookies.length, 0, "reset não emite sessão");
    } finally {
      await h.close();
    }
  });

  it("cliente antigo que ainda manda `password` falha alto, não em silêncio", async () => {
    const h = await startHarness({ actor: { id: "super-1", role: "SUPER_ADMIN" } });
    try {
      const r = await post(h.url, "/api/admin/users/user-1/reset-password", {
        password: "senha escolhida a mao",
      });
      assert.equal(r.status, 400);
      assert.equal(r.body.code, "TEMPORARY_PASSWORD_IS_GENERATED");
      assert.equal(h.db.userById("user-1")?.passwordHash, await hashDaSenhaAtual());
    } finally {
      await h.close();
    }
  });

  it("a senha temporária nunca aparece na auditoria", async () => {
    const h = await startHarness({ actor: { id: "super-1", role: "SUPER_ADMIN" } });
    try {
      const r = await post(h.url, "/api/admin/users/user-1/reset-password", {});
      const temp = String(r.body.temporaryPassword);
      const dump = JSON.stringify(h.db.audits);
      assert.equal(dump.includes(temp), false);
      assert.equal(dump.includes("passwordHash"), false);
      assert.equal(dump.toLowerCase().includes("token"), false);
    } finally {
      await h.close();
    }
  });

  it("rate limit por SUPER_ADMIN: 11ª operação na janela devolve 429", async () => {
    const limiter = new AuthRateLimiter();
    const hashAtual = await hashDaSenhaAtual();
    const users = Array.from({ length: 12 }, (_, i) =>
      makeUser({ id: `alvo-${i}`, email: `alvo${i}@exemplo.test`, passwordHash: hashAtual })
    );
    const h = await startHarness({
      actor: { id: "super-1", role: "SUPER_ADMIN" },
      users,
      rateLimiter: limiter,
    });
    try {
      for (let i = 0; i < 10; i += 1) {
        const r = await post(h.url, `/api/admin/users/alvo-${i}/reset-password`, {});
        assert.equal(r.status, 200, `reset ${i + 1} deveria passar`);
      }
      const bloqueado = await post(h.url, "/api/admin/users/alvo-10/reset-password", {});
      assert.equal(bloqueado.status, 429);
      assert.equal(bloqueado.body.code, "RATE_LIMITED");
      // o alvo do request bloqueado NÃO foi tocado
      assert.equal(h.db.userById("alvo-10")?.mustChangePassword, false);
    } finally {
      await h.close();
    }
  });
});
