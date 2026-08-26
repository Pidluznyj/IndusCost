/**
 * GATE DE SEGURANÇA — superfície pública da Satisfação.
 *
 * Prova que, chegando pelo hostname público, a aplicação interna simplesmente
 * não existe: nem API administrativa, nem login, nem SPA. E que um token
 * público jamais se converte em sessão administrativa.
 *
 * Estes casos são eliminatórios: se algum falhar, o módulo não vai a lugar
 * nenhum.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createSatisfactionPublicHostGuard,
  isSatisfactionPublicPathAllowed,
  isSatisfactionPublicRequest,
  normalizeHostname,
  normalizeRequestPath,
  stripAdminCookies,
  type SatisfactionPublicSurfaceConfig,
} from "./satisfactionPublicSurface.js";
import { buildSatisfactionPublicCsp } from "./satisfactionPublicCsp.js";

const PROD: SatisfactionPublicSurfaceConfig = {
  publicHosts: ["satisfacao.exemplo.com.br"],
  surfaceHeaderName: null,
  allowDevAssets: false,
};

const DEV: SatisfactionPublicSurfaceConfig = { ...PROD, allowDevAssets: true };

/** Caminhos internos que NUNCA podem responder pelo host público. */
const FORBIDDEN_INTERNAL_PATHS = [
  "/login",
  "/api/auth/me",
  "/api/auth/login",
  "/api/users",
  "/api/admin/users",
  "/api/customers",
  "/api/sales-orders",
  "/api/finance",
  "/api/finance/treasury",
  "/api/inventory",
  "/api/admin",
  "/admin",
  "/settings",
  "/commercial/satisfaction",
  "/api/commercial/satisfaction/campaigns",
  "/api/goals",
  "/api/public/fleet/reservation/abc",
];

function mockRes() {
  const headers: Record<string, string> = {};
  return {
    statusCode: 0,
    body: null as unknown,
    headers,
    setHeader(name: string, value: string) {
      headers[name] = value;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

function runGuard(
  config: SatisfactionPublicSurfaceConfig,
  req: { headers: Record<string, unknown>; path: string; url?: string }
) {
  const guard = createSatisfactionPublicHostGuard(config);
  const res = mockRes();
  let nextCalled = false;
  guard(
    req as never,
    res as never,
    (() => {
      nextCalled = true;
    }) as never
  );
  return { res, nextCalled, req };
}

describe("superfície pública — identificação do host", () => {
  it("host público configurado é reconhecido, com e sem porta", () => {
    for (const host of ["satisfacao.exemplo.com.br", "satisfacao.exemplo.com.br:443"]) {
      assert.equal(isSatisfactionPublicRequest({ hostHeader: host }, PROD), true, host);
    }
  });

  it("host administrativo NÃO é superfície pública", () => {
    assert.equal(
      isSatisfactionPublicRequest({ hostHeader: "induscost.exemplo.com.br" }, PROD),
      false
    );
  });

  it("sem hosts configurados, o guard não se aplica (não quebra o app interno)", () => {
    const semConfig: SatisfactionPublicSurfaceConfig = { ...PROD, publicHosts: [] };
    assert.equal(
      isSatisfactionPublicRequest({ hostHeader: "satisfacao.exemplo.com.br" }, semConfig),
      false
    );
  });

  it("X-Forwarded-Host genérico NÃO decide a superfície", () => {
    // Se decidisse, um cliente forjaria o header para escapar do guard.
    const req = {
      hostHeader: "satisfacao.exemplo.com.br",
      headers: { "x-forwarded-host": "induscost.exemplo.com.br" },
    };
    assert.equal(isSatisfactionPublicRequest(req, PROD), true);
  });

  it("header dedicado do gateway marca a superfície quando configurado", () => {
    const config = { ...PROD, surfaceHeaderName: "x-induscost-public-surface" };
    assert.equal(
      isSatisfactionPublicRequest(
        { hostHeader: "outro.interno", headers: { "x-induscost-public-surface": "1" } },
        config
      ),
      true
    );
  });

  it("normalizeHostname trata IPv6 e caixa alta", () => {
    assert.equal(normalizeHostname("[::1]:3000"), "[::1]");
    assert.equal(normalizeHostname("SATISFACAO.Exemplo.com.BR"), "satisfacao.exemplo.com.br");
    assert.equal(normalizeHostname(undefined), null);
  });
});

describe("superfície pública — allowlist de paths", () => {
  it("libera exatamente o necessário para responder a pesquisa", () => {
    const allowed = [
      "/r",
      "/assets/app-abc123.js",
      "/assets/style.css",
      "/favicon.ico",
      "/robots.txt",
      "/api/public/satisfaction/session",
      "/api/public/satisfaction/form",
      "/api/public/satisfaction/draft",
      "/api/public/satisfaction/submit",
    ];
    for (const path of allowed) {
      assert.equal(isSatisfactionPublicPathAllowed(path, PROD), true, path);
    }
  });

  it("ELIMINATÓRIO: nenhuma rota interna é acessível pelo host público", () => {
    for (const path of FORBIDDEN_INTERNAL_PATHS) {
      assert.equal(
        isSatisfactionPublicPathAllowed(path, PROD),
        false,
        `path interno vazou na allowlist: ${path}`
      );
    }
  });

  it("travessia de diretório não vira bypass", () => {
    const traversals = [
      "/assets/../api/customers",
      "/assets/../../api/auth/me",
      "/api/public/satisfaction/../../users",
      "/r/../admin",
      "/assets/%2e%2e/api/finance",
    ];
    for (const path of traversals) {
      assert.equal(isSatisfactionPublicPathAllowed(path, PROD), false, path);
    }
  });

  it("barras duplicadas e barra invertida não driblam o prefixo", () => {
    for (const path of ["//api//customers", "/api\\customers", "//admin"]) {
      assert.equal(isSatisfactionPublicPathAllowed(path, PROD), false, path);
    }
  });

  it("query string não altera a decisão", () => {
    assert.equal(isSatisfactionPublicPathAllowed("/api/customers?x=1", PROD), false);
    assert.equal(isSatisfactionPublicPathAllowed("/r?utm=x", PROD), true);
  });

  it("paths de dev do Vite só existem fora de produção", () => {
    const devPaths = ["/@vite/client", "/src/main.tsx", "/node_modules/.vite/deps/react.js"];
    for (const path of devPaths) {
      assert.equal(isSatisfactionPublicPathAllowed(path, DEV), true, `dev: ${path}`);
      assert.equal(isSatisfactionPublicPathAllowed(path, PROD), false, `prod: ${path}`);
    }
  });

  it("normalizeRequestPath remove barra final redundante", () => {
    assert.equal(normalizeRequestPath("/r/"), "/r");
    assert.equal(normalizeRequestPath("/"), "/");
    assert.equal(normalizeRequestPath("/api/public/satisfaction/form?a=1"), "/api/public/satisfaction/form");
  });
});

describe("superfície pública — middleware", () => {
  it("responde 404 (não 403) para rota interna, sem confessar que ela existe", () => {
    const { res, nextCalled } = runGuard(PROD, {
      headers: { host: "satisfacao.exemplo.com.br" },
      path: "/api/customers",
    });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, { error: "NOT_FOUND" });
  });

  it("deixa passar o formulário público e aplica headers de privacidade", () => {
    const { res, nextCalled } = runGuard(PROD, {
      headers: { host: "satisfacao.exemplo.com.br" },
      path: "/r",
    });
    assert.equal(nextCalled, true);
    assert.equal(res.headers["Cache-Control"], "no-store");
    assert.equal(res.headers["X-Robots-Tag"], "noindex, nofollow, noarchive");
    assert.equal(res.headers["Referrer-Policy"], "no-referrer");
    assert.equal(res.headers["X-Content-Type-Options"], "nosniff");
    const csp = res.headers["Content-Security-Policy"];
    assert.ok(typeof csp === "string");
    assert.ok(csp.includes("https://challenges.cloudflare.com"));
    assert.equal(csp.includes("*"), false);
    assert.equal(csp.includes("unsafe-eval"), false);
  });

  it("CSP pública libera só o Turnstile oficial, sem wildcard", () => {
    const csp = buildSatisfactionPublicCsp();
    assert.ok(csp.includes("script-src 'self' https://challenges.cloudflare.com"));
    assert.ok(csp.includes("frame-src https://challenges.cloudflare.com"));
    assert.equal(/\bscript-src[^;]*\*/.test(csp), false);
    assert.equal(csp.includes("unsafe-eval"), false);
  });

  it("host interno passa intocado — o app administrativo não é afetado", () => {
    const { res, nextCalled } = runGuard(PROD, {
      headers: { host: "induscost.exemplo.com.br" },
      path: "/api/customers",
    });
    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, 0);
    assert.equal(res.headers["Cache-Control"], undefined);
  });

  it("ELIMINATÓRIO: cookie de sessão administrativa é removido na superfície pública", () => {
    const req = {
      headers: {
        host: "satisfacao.exemplo.com.br",
        cookie: "induscost_session=abc123; outro=ok; induscost_bootstrap_admin=xyz",
      },
      path: "/r",
    };
    runGuard(PROD, req);
    assert.equal(req.headers.cookie, "outro=ok");
  });

  it("todas as rotas internas proibidas respondem 404 pelo middleware", () => {
    for (const path of FORBIDDEN_INTERNAL_PATHS) {
      const { res, nextCalled } = runGuard(PROD, {
        headers: { host: "satisfacao.exemplo.com.br" },
        path,
      });
      assert.equal(nextCalled, false, `next() foi chamado para ${path}`);
      assert.equal(res.statusCode, 404, `status inesperado para ${path}`);
      assert.notDeepEqual(res.body, undefined);
    }
  });
});

describe("stripAdminCookies", () => {
  it("remove só os cookies administrativos", () => {
    assert.equal(stripAdminCookies("a=1; induscost_session=x; b=2"), "a=1; b=2");
  });

  it("devolve undefined quando sobra nada", () => {
    assert.equal(stripAdminCookies("induscost_session=x"), undefined);
  });

  it("tolera header ausente", () => {
    assert.equal(stripAdminCookies(undefined), undefined);
  });
});
