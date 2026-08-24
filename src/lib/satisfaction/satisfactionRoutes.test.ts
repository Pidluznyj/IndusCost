/**
 * Wiring HTTP da Satisfação.
 *
 * O que está sob prova: cada rota administrativa exige o recurso e a AÇÃO
 * corretos; a superfície pública tem exatamente quatro endpoints e nenhum
 * deles passa por autenticação IndusCost; e nenhuma rota pública expõe busca
 * de cliente ou dado interno.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type express from "express";
import {
  buildSatisfactionCustomerSearchFilters,
  registerSatisfactionRoutes,
  SATISFACTION_IMPORT_RESOURCE_KEY,
  SATISFACTION_RESOURCE_KEY,
  SATISFACTION_RESPONSES_RESOURCE_KEY,
} from "./satisfactionRoutes.js";
import { registerSatisfactionPublicRoutes } from "./satisfactionPublicRoutes.js";

type RouteEntry = { method: string; path: string; guards: string[] };

function buildFakeApp(): { app: express.Express; routes: RouteEntry[] } {
  const routes: RouteEntry[] = [];
  const register =
    (method: string) =>
    (path: string, ...handlers: unknown[]) => {
      routes.push({
        method,
        path,
        guards: handlers
          .slice(0, -1)
          .map((h) => (h as { __guard?: string }).__guard ?? "middleware"),
      });
    };
  const app = {
    get: register("GET"),
    post: register("POST"),
    put: register("PUT"),
    patch: register("PATCH"),
    delete: register("DELETE"),
    use: () => undefined,
  } as unknown as express.Express;
  return { app, routes };
}

function fakeGuards() {
  const requireResource = (resourceKey: string, action?: string) => {
    const mw = (() => {}) as unknown as express.RequestHandler & { __guard?: string };
    mw.__guard = `${resourceKey}:${action}`;
    return mw;
  };
  const requireAppAuth = (() => {}) as unknown as express.RequestHandler & {
    __guard?: string;
  };
  requireAppAuth.__guard = "auth";
  return { requireResource, requireAppAuth, getCurrentAppUser: () => null };
}

function adminRoutes(): RouteEntry[] {
  const { app, routes } = buildFakeApp();
  registerSatisfactionRoutes(app, fakeGuards() as never);
  return routes;
}

function publicRoutes(): RouteEntry[] {
  const { app, routes } = buildFakeApp();
  registerSatisfactionPublicRoutes(app, { service: {} as never });
  return routes;
}

function find(routes: RouteEntry[], method: string, path: string): RouteEntry {
  const entry = routes.find((r) => r.method === method && r.path === path);
  assert.ok(entry, `rota não registrada: ${method} ${path}`);
  return entry!;
}

describe("busca administrativa de clientes da Satisfação", () => {
  it("busca textual não cria taxId contains vazio", () => {
    assert.deepEqual(buildSatisfactionCustomerSearchFilters("vicla"), [
      { companyName: { contains: "vicla", mode: "insensitive" } },
    ]);
  });

  it("busca por nome continua case-insensitive", () => {
    assert.deepEqual(buildSatisfactionCustomerSearchFilters("Vicla"), [
      { companyName: { contains: "Vicla", mode: "insensitive" } },
    ]);
  });

  it("busca com dígitos também consulta CNPJ normalizado", () => {
    assert.deepEqual(buildSatisfactionCustomerSearchFilters("12.345.678/0001-90"), [
      {
        companyName: {
          contains: "12.345.678/0001-90",
          mode: "insensitive",
        },
      },
      { taxId: { contains: "12345678000190" } },
    ]);
  });
});

describe("rotas administrativas — guard por ação", () => {
  const routes = adminRoutes();

  it("toda rota administrativa exige autenticação", () => {
    for (const route of routes) {
      assert.ok(
        route.guards.includes("auth"),
        `${route.method} ${route.path} sem requireAppAuth`
      );
    }
  });

  it("leitura exige view", () => {
    for (const path of [
      "/api/commercial/satisfaction/dashboard",
      "/api/commercial/satisfaction/campaigns",
      "/api/commercial/satisfaction/campaigns/:id",
      "/api/commercial/satisfaction/campaigns/:id/invitations",
      "/api/commercial/satisfaction/campaigns/:id/results",
      "/api/commercial/satisfaction/customers",
    ]) {
      assert.ok(
        find(routes, "GET", path).guards.includes(`${SATISFACTION_RESOURCE_KEY}:view`),
        `${path} deveria exigir view`
      );
    }
  });

  it("criar exige create; editar exige update", () => {
    assert.ok(
      find(routes, "POST", "/api/commercial/satisfaction/campaigns").guards.includes(
        `${SATISFACTION_RESOURCE_KEY}:create`
      )
    );
    assert.ok(
      find(routes, "PATCH", "/api/commercial/satisfaction/campaigns/:id").guards.includes(
        `${SATISFACTION_RESOURCE_KEY}:update`
      )
    );
    assert.ok(
      find(routes, "PUT", "/api/commercial/satisfaction/campaigns/:id/audience").guards.includes(
        `${SATISFACTION_RESOURCE_KEY}:update`
      )
    );
  });

  it("publicar/encerrar/arquivar/excluir exigem manage — não bastam view ou update", () => {
    const managed: Array<[string, string]> = [
      ["POST", "/api/commercial/satisfaction/campaigns/:id/publish"],
      ["POST", "/api/commercial/satisfaction/campaigns/:id/close"],
      ["POST", "/api/commercial/satisfaction/campaigns/:id/archive"],
      ["DELETE", "/api/commercial/satisfaction/campaigns/:id"],
    ];
    for (const [method, path] of managed) {
      const guards = find(routes, method, path).guards;
      assert.ok(
        guards.includes(`${SATISFACTION_RESOURCE_KEY}:manage`),
        `${method} ${path} deveria exigir manage`
      );
      assert.equal(
        guards.includes(`${SATISFACTION_RESOURCE_KEY}:view`),
        false,
        `${method} ${path} não pode se contentar com view`
      );
    }
  });

  it("gerar/revogar link exige update", () => {
    assert.ok(
      find(routes, "POST", "/api/commercial/satisfaction/invitations/:invitationId/link").guards.includes(
        `${SATISFACTION_RESOURCE_KEY}:update`
      )
    );
    assert.ok(
      find(routes, "POST", "/api/commercial/satisfaction/invitations/:invitationId/revoke").guards.includes(
        `${SATISFACTION_RESOURCE_KEY}:update`
      )
    );
  });

  it("respostas usam recurso próprio — mais sensível que a lista de pesquisas", () => {
    for (const path of [
      "/api/commercial/satisfaction/campaigns/:id/responses",
      "/api/commercial/satisfaction/responses/:id",
    ]) {
      assert.ok(
        find(routes, "GET", path).guards.includes(`${SATISFACTION_RESPONSES_RESOURCE_KEY}:view`),
        `${path} deveria usar o recurso de respostas`
      );
    }
  });

  it("exportação exige export", () => {
    assert.ok(
      find(routes, "GET", "/api/commercial/satisfaction/campaigns/:id/export").guards.includes(
        `${SATISFACTION_RESOURCE_KEY}:export`
      )
    );
  });

  it("importação exige recurso próprio com execute e passa pelo upload controlado", () => {
    for (const path of [
      "/api/commercial/satisfaction/campaigns/:id/import/preview",
      "/api/commercial/satisfaction/campaigns/:id/import/apply",
    ]) {
      const guards = find(routes, "POST", path).guards;
      assert.ok(
        guards.includes(`${SATISFACTION_IMPORT_RESOURCE_KEY}:execute`),
        `${path} deveria exigir execute do recurso de importação`
      );
      assert.ok(guards.includes("middleware"), `${path} deveria ter o middleware de upload`);
    }
  });

  it("não existe rota administrativa sem guard de recurso", () => {
    for (const route of routes) {
      const hasResourceGuard = route.guards.some((g) => g.includes("commercial.satisfaction"));
      assert.ok(
        hasResourceGuard,
        `${route.method} ${route.path} não tem guard de recurso`
      );
    }
  });
});

describe("superfície pública — exatamente quatro endpoints", () => {
  const routes = publicRoutes();

  it("registra apenas session, form, draft e submit", () => {
    const paths = routes.map((r) => `${r.method} ${r.path}`).sort();
    assert.deepEqual(paths, [
      "GET /api/public/satisfaction/form",
      "PATCH /api/public/satisfaction/draft",
      "POST /api/public/satisfaction/session",
      "POST /api/public/satisfaction/submit",
    ]);
  });

  it("ELIMINATÓRIO: nenhuma rota pública passa por autenticação IndusCost", () => {
    for (const route of routes) {
      assert.equal(
        route.guards.includes("auth"),
        false,
        `${route.path} não deveria exigir sessão administrativa`
      );
    }
  });

  it("ELIMINATÓRIO: não existe busca pública de Customer", () => {
    for (const route of routes) {
      assert.equal(
        /customer|cliente|search/i.test(route.path),
        false,
        `rota pública suspeita: ${route.path}`
      );
    }
  });

  it("todo path público vive sob /api/public/satisfaction/", () => {
    for (const route of routes) {
      assert.ok(
        route.path.startsWith("/api/public/satisfaction/"),
        `rota pública fora do prefixo: ${route.path}`
      );
    }
  });
});
