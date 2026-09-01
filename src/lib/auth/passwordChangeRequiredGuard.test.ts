/**
 * Enforcement da troca obrigatória — o teste que impede a feature de ser
 * "bloqueio só no React".
 *
 * Exercita o middleware real montado num Express real, com rotas que imitam a
 * topologia do server.ts: /api de negócio, /api público, superfície de device
 * (sem cookie humano) e assets da SPA.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import {
  PASSWORD_CHANGE_ALLOWED_ROUTES,
  PASSWORD_CHANGE_REQUIRED_CODE,
  createPasswordChangeRequiredGuard,
  decidePasswordChangeGuard,
  isAllowedDuringPasswordChange,
  normalizeGuardPath,
  requestHasAppSessionCookie,
} from "./passwordChangeRequiredGuard.js";
import { APP_SESSION_COOKIE_NAME } from "./appAuth.shared.js";

/* ================================================================== */
/* Decisão pura                                                        */
/* ================================================================== */

describe("decisão do guard", () => {
  it("sem cookie de sessão humana, nada é tocado", () => {
    const d = decidePasswordChangeGuard({
      hasSessionCookie: false,
      mustChangePassword: true,
      method: "GET",
      path: "/api/inventory/counts",
    });
    assert.equal(d.action, "allow");
    assert.equal(d.reason, "no-session-cookie");
  });

  it("cookie presente mas sessão inválida: segue para o guard da rota (401 dele)", () => {
    const d = decidePasswordChangeGuard({
      hasSessionCookie: true,
      mustChangePassword: null,
      method: "GET",
      path: "/api/inventory/counts",
    });
    assert.equal(d.action, "allow");
    assert.equal(d.reason, "no-session");
  });

  it("sem troca pendente, tudo passa", () => {
    const d = decidePasswordChangeGuard({
      hasSessionCookie: true,
      mustChangePassword: false,
      method: "POST",
      path: "/api/treasury/transfers",
    });
    assert.equal(d.action, "allow");
    assert.equal(d.reason, "not-required");
  });

  it("com troca pendente, o padrão é NEGAR (fail closed)", () => {
    const d = decidePasswordChangeGuard({
      hasSessionCookie: true,
      mustChangePassword: true,
      method: "POST",
      path: "/api/treasury/transfers",
    });
    assert.equal(d.action, "deny");
  });
});

describe("whitelist", () => {
  it("é exatamente a superfície mínima documentada", () => {
    assert.deepEqual(
      PASSWORD_CHANGE_ALLOWED_ROUTES.map((r) => `${r.method} ${r.path}`).sort(),
      [
        "GET /api/app-version",
        "GET /api/auth/me",
        "GET /api/health",
        "POST /api/auth/complete-password-change",
        "POST /api/auth/login",
        "POST /api/auth/logout",
      ]
    );
  });

  it("o método faz parte da chave — POST /api/auth/me não é liberado", () => {
    assert.equal(isAllowedDuringPasswordChange("GET", "/api/auth/me"), true);
    assert.equal(isAllowedDuringPasswordChange("POST", "/api/auth/me"), false);
    assert.equal(isAllowedDuringPasswordChange("DELETE", "/api/auth/logout"), false);
  });

  it("rotas de auth NÃO essenciais à troca continuam bloqueadas", () => {
    assert.equal(isAllowedDuringPasswordChange("GET", "/api/auth/permissions-version"), false);
    assert.equal(isAllowedDuringPasswordChange("POST", "/api/auth/sync-session-permissions"), false);
    assert.equal(isAllowedDuringPasswordChange("POST", "/api/auth/change-password"), false);
    assert.equal(isAllowedDuringPasswordChange("POST", "/api/auth/admin-elevation/confirm"), false);
  });

  it("tolera barra final e diferença de caixa, como o próprio roteador do Express", () => {
    assert.equal(isAllowedDuringPasswordChange("GET", "/api/auth/me/"), true);
    assert.equal(isAllowedDuringPasswordChange("get", "/API/Auth/Me"), true);
    assert.equal(normalizeGuardPath("/api/auth/me/"), "/api/auth/me");
    assert.equal(normalizeGuardPath("/API/AUTH/ME"), "/api/auth/me");
  });

  it("não libera por prefixo: caminho vizinho continua bloqueado", () => {
    assert.equal(isAllowedDuringPasswordChange("GET", "/api/auth/me-extra"), false);
    assert.equal(isAllowedDuringPasswordChange("GET", "/api/auth/me/tudo"), false);
    assert.equal(isAllowedDuringPasswordChange("GET", "/api/health/secrets"), false);
  });
});

describe("detecção do cookie de sessão humana", () => {
  it("reconhece o cookie da aplicação", () => {
    assert.equal(requestHasAppSessionCookie(`${APP_SESSION_COOKIE_NAME}=abc`), true);
    assert.equal(requestHasAppSessionCookie(`outro=1; ${APP_SESSION_COOKIE_NAME}=abc`), true);
  });

  it("ignora requisição sem cookie ou com cookie de outra superfície", () => {
    assert.equal(requestHasAppSessionCookie(undefined), false);
    assert.equal(requestHasAppSessionCookie(""), false);
    assert.equal(requestHasAppSessionCookie("satisfaction_public_session=xyz"), false);
  });
});

/* ================================================================== */
/* Middleware montado num app real                                     */
/* ================================================================== */

type AppState = { mustChangePassword: boolean | null; resolveCalls: number; shouldThrow: boolean };

async function startApp(state: AppState) {
  const app = express();
  app.use(express.json());

  // Registradas ANTES do guard, como no server.ts: superfície pública da
  // Satisfação e device-auth do Collector nunca chegam ao middleware.
  app.get("/api/public/satisfaction/campaign", (_req, res) => res.json({ publico: true }));
  app.post("/api/inventory/collector/device/ping", (_req, res) => res.json({ device: true }));

  const guard = createPasswordChangeRequiredGuard({
    resolveMustChangePassword: async () => {
      state.resolveCalls += 1;
      if (state.shouldThrow) throw new Error("banco fora do ar");
      return state.mustChangePassword;
    },
  });
  app.use("/api", (req, res, next) => {
    guard(req, res, next).catch(next);
  });

  // Rotas registradas DEPOIS do guard: negócio + whitelist.
  app.get("/api/auth/me", (_req, res) => res.json({ authenticated: true }));
  app.post("/api/auth/logout", (_req, res) => res.json({ success: true }));
  app.post("/api/auth/login", (_req, res) => res.json({ logado: true }));
  app.post("/api/auth/complete-password-change", (_req, res) => res.json({ trocado: true }));
  app.get("/api/health", (_req, res) => res.json({ ok: true }));
  app.get("/api/app-version", (_req, res) => res.json({ version: "x" }));
  app.get("/api/auth/permissions-version", (_req, res) => res.json({ v: 1 }));
  app.get("/api/treasury/cash-flow", (_req, res) => res.json({ financeiro: true }));
  app.post("/api/commissions/reprocess", (_req, res) => res.json({ comissao: true }));
  app.get("/api/admin/users", (_req, res) => res.json({ usuarios: [] }));
  app.get("/api/um/modulo/que/ninguem/lembrou", (_req, res) => res.json({ novo: true }));
  // Asset da SPA, fora de /api.
  app.get("/assets/main.js", (_req, res) => res.type("js").send("console.log(1)"));

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr !== "object") throw new Error("sem porta");
  return {
    url: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

const HUMAN_COOKIE = { cookie: `${APP_SESSION_COOKIE_NAME}=token-de-sessao` };

async function call(
  url: string,
  method: string,
  path: string,
  headers: Record<string, string> = {}
) {
  const res = await fetch(`${url}${path}`, { method, headers });
  const text = await res.text();
  return { status: res.status, text };
}

describe("middleware com troca obrigatória pendente", () => {
  it("nega TODA rota de negócio com 403 PASSWORD_CHANGE_REQUIRED", async () => {
    const state: AppState = { mustChangePassword: true, resolveCalls: 0, shouldThrow: false };
    const app = await startApp(state);
    try {
      for (const [method, path] of [
        ["GET", "/api/treasury/cash-flow"],
        ["POST", "/api/commissions/reprocess"],
        ["GET", "/api/admin/users"],
        ["GET", "/api/auth/permissions-version"],
        // Módulo criado depois da feature: nasce bloqueado, sem ninguém listá-lo.
        ["GET", "/api/um/modulo/que/ninguem/lembrou"],
      ] as const) {
        const r = await call(app.url, method, path, HUMAN_COOKIE);
        assert.equal(r.status, 403, `${method} ${path} deveria ser 403`);
        assert.match(r.text, new RegExp(PASSWORD_CHANGE_REQUIRED_CODE));
      }
    } finally {
      await app.close();
    }
  });

  it("libera exatamente a whitelist", async () => {
    const state: AppState = { mustChangePassword: true, resolveCalls: 0, shouldThrow: false };
    const app = await startApp(state);
    try {
      for (const [method, path] of [
        ["GET", "/api/auth/me"],
        ["POST", "/api/auth/logout"],
        ["POST", "/api/auth/login"],
        ["POST", "/api/auth/complete-password-change"],
        ["GET", "/api/health"],
        ["GET", "/api/app-version"],
      ] as const) {
        const r = await call(app.url, method, path, HUMAN_COOKIE);
        assert.equal(r.status, 200, `${method} ${path} deveria passar`);
      }
    } finally {
      await app.close();
    }
  });

  it("chamada manual (curl/DevTools/script) não burla — é o servidor que nega", async () => {
    const state: AppState = { mustChangePassword: true, resolveCalls: 0, shouldThrow: false };
    const app = await startApp(state);
    try {
      // Sem nenhum frontend envolvido: fetch cru com o cookie roubado.
      const r = await call(app.url, "GET", "/api/treasury/cash-flow", {
        ...HUMAN_COOKIE,
        "X-Requested-With": "curl",
      });
      assert.equal(r.status, 403);
    } finally {
      await app.close();
    }
  });

  it("logout continua permitido durante o estado forçado", async () => {
    const state: AppState = { mustChangePassword: true, resolveCalls: 0, shouldThrow: false };
    const app = await startApp(state);
    try {
      const r = await call(app.url, "POST", "/api/auth/logout", HUMAN_COOKIE);
      assert.equal(r.status, 200);
    } finally {
      await app.close();
    }
  });
});

describe("middleware sem troca pendente (regressão)", () => {
  it("não altera nada quando mustChangePassword é false", async () => {
    const state: AppState = { mustChangePassword: false, resolveCalls: 0, shouldThrow: false };
    const app = await startApp(state);
    try {
      for (const [method, path] of [
        ["GET", "/api/treasury/cash-flow"],
        ["POST", "/api/commissions/reprocess"],
        ["GET", "/api/admin/users"],
        ["GET", "/api/auth/permissions-version"],
      ] as const) {
        const r = await call(app.url, method, path, HUMAN_COOKIE);
        assert.equal(r.status, 200, `${method} ${path} não podia ser afetado`);
      }
    } finally {
      await app.close();
    }
  });

  it("sessão ausente/expirada continua caindo no guard da rota, não no guard de senha", async () => {
    const state: AppState = { mustChangePassword: null, resolveCalls: 0, shouldThrow: false };
    const app = await startApp(state);
    try {
      const r = await call(app.url, "GET", "/api/treasury/cash-flow", HUMAN_COOKIE);
      assert.equal(r.status, 200, "o guard não pode transformar sessão inválida em 403");
    } finally {
      await app.close();
    }
  });
});

describe("superfícies não humanas permanecem intocadas", () => {
  it("requisição SEM cookie humano não consulta sessão nem é bloqueada", async () => {
    const state: AppState = { mustChangePassword: true, resolveCalls: 0, shouldThrow: false };
    const app = await startApp(state);
    try {
      const business = await call(app.url, "GET", "/api/treasury/cash-flow");
      // Sem cookie o guard não age; quem responde é a rota (que aqui não tem auth).
      assert.equal(business.status, 200);
      assert.equal(state.resolveCalls, 0, "nenhuma consulta de sessão foi feita");
    } finally {
      await app.close();
    }
  });

  it("Satisfação pública e device-auth do Collector não passam pelo guard", async () => {
    const state: AppState = { mustChangePassword: true, resolveCalls: 0, shouldThrow: false };
    const app = await startApp(state);
    try {
      // Mesmo com um cookie humano em estado forçado: as rotas foram
      // registradas ANTES do middleware, como no server.ts.
      const sat = await call(app.url, "GET", "/api/public/satisfaction/campaign", HUMAN_COOKIE);
      assert.equal(sat.status, 200);
      const dev = await call(app.url, "POST", "/api/inventory/collector/device/ping", HUMAN_COOKIE);
      assert.equal(dev.status, 200);
      assert.equal(state.resolveCalls, 0);
    } finally {
      await app.close();
    }
  });

  it("assets da SPA (fora de /api) não são afetados", async () => {
    const state: AppState = { mustChangePassword: true, resolveCalls: 0, shouldThrow: false };
    const app = await startApp(state);
    try {
      const r = await call(app.url, "GET", "/assets/main.js", HUMAN_COOKIE);
      assert.equal(r.status, 200);
      assert.equal(state.resolveCalls, 0);
    } finally {
      await app.close();
    }
  });
});

describe("fail closed em erro", () => {
  it("se o estado não puder ser lido, a rota de negócio NÃO é atingida", async () => {
    const state: AppState = { mustChangePassword: true, resolveCalls: 0, shouldThrow: true };
    const app = await startApp(state);
    try {
      const r = await call(app.url, "GET", "/api/treasury/cash-flow", HUMAN_COOKIE);
      assert.equal(r.status, 500);
      assert.match(r.text, /INTERNAL_ERROR/);
      assert.doesNotMatch(r.text, /financeiro/);
    } finally {
      await app.close();
    }
  });
});
