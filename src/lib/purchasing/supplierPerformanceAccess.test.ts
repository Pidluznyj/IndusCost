/**
 * OP-26 — Feature flag e permissões das rotas (fail closed, sem banco).
 * Flag OFF -> 404; flag ON sem permissão -> 403; com permissão -> handler.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { RequestHandler } from "express";
import { SUPPLY_CHAIN_FEATURE_ENV } from "@/src/lib/supply-chain/supplyChainFeatureFlags.js";
import { registerSupplierPerformanceRoutes } from "./supplierPerformanceRoutes.js";

const FLAG_ENV = SUPPLY_CHAIN_FEATURE_ENV.supplierPerformance;

type Registered = { method: string; path: string; handlers: RequestHandler[] };

type FakeResponse = {
  statusCode: number | null;
  body: unknown;
  headers: Record<string, string>;
};

function createFakeApp() {
  const routes: Registered[] = [];
  const push = (method: string) => (path: string, ...handlers: RequestHandler[]) => {
    routes.push({ method, path, handlers });
  };
  return {
    app: { get: push("GET"), put: push("PUT") } as never,
    routes,
  };
}

function createAuth(granted: Set<string>, user: { id: string; name: string } | null) {
  const calls: string[] = [];
  const requireAppAuth: RequestHandler = (req, res, next) => {
    calls.push("auth");
    if (!user) {
      res.status(401).json({ error: "Autenticação necessária." });
      return;
    }
    (req as { appAuth?: unknown }).appAuth = user;
    next();
  };
  const requireResource = (resourceKey: string, action = "view"): RequestHandler => {
    return (_req, res, next) => {
      const key = `${resourceKey}:${action}`;
      calls.push(`resource:${key}`);
      if (!granted.has(key)) {
        res.status(403).json({ error: "Acesso negado.", code: "FORBIDDEN" });
        return;
      }
      next();
    };
  };
  return {
    calls,
    guards: {
      requireAppAuth,
      requireResource,
      getCurrentAppUser: async () => user,
    },
  };
}

async function runRoute(
  route: Registered,
  request: Record<string, unknown> = {}
): Promise<FakeResponse> {
  const result: FakeResponse = { statusCode: null, body: undefined, headers: {} };
  const res = {
    status(code: number) {
      result.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      result.body = payload;
      if (result.statusCode == null) result.statusCode = 200;
      return this;
    },
    send(payload: unknown) {
      result.body = payload;
      if (result.statusCode == null) result.statusCode = 200;
      return this;
    },
    setHeader(name: string, value: string) {
      result.headers[name] = value;
      return this;
    },
  };
  const req = { params: {}, query: {}, body: {}, ...request };

  let index = 0;
  const next = async (): Promise<void> => {
    const handler = route.handlers[index];
    index += 1;
    if (!handler) return;
    await (handler as (r: unknown, s: unknown, n: () => void) => unknown)(req, res, () => {
      void next();
    });
  };
  await next();
  // Aguarda handlers assíncronos encadeados via next().
  await new Promise((resolve) => setImmediate(resolve));
  return result;
}

function register(granted: string[], user: { id: string; name: string } | null = {
  id: "user-1",
  name: "Usuário",
}) {
  const { app, routes } = createFakeApp();
  const auth = createAuth(new Set(granted), user);
  registerSupplierPerformanceRoutes(app, auth.guards);
  return { routes, auth };
}

const ALL_PERMISSIONS = [
  "operations.purchases:view",
  "operations.purchases:update",
  "finance.suppliers:view",
];

const previousFlag = process.env[FLAG_ENV];

afterEach(() => {
  if (previousFlag === undefined) delete process.env[FLAG_ENV];
  else process.env[FLAG_ENV] = previousFlag;
});

function findRoute(routes: Registered[], method: string, path: string): Registered {
  const found = routes.find((r) => r.method === method && r.path === path);
  assert.ok(found, `rota ${method} ${path} não registrada`);
  return found;
}

describe("registro das rotas", () => {
  it("registra as seis rotas da feature", () => {
    const { routes } = register(ALL_PERMISSIONS);
    assert.deepEqual(
      routes.map((r) => `${r.method} ${r.path}`).sort(),
      [
        "GET /api/purchase-orders/:id/supplier-evaluation",
        "GET /api/supplier-performance/orders.csv",
        "GET /api/supplier-performance/report",
        "GET /api/supplier-performance/report.csv",
        "GET /api/supplier-performance/suppliers/:supplierId",
        "PUT /api/purchase-orders/:id/supplier-evaluation",
      ]
    );
  });

  it("nenhuma rota fica sob o prefixo oficial de fornecedores", () => {
    const { routes } = register(ALL_PERMISSIONS);
    for (const route of routes) {
      assert.doesNotMatch(route.path, /^\/api\/finance\/suppliers/);
    }
  });
});

describe("feature flag desligada", () => {
  it("todas as rotas respondem 404 mesmo com permissão total", async () => {
    delete process.env[FLAG_ENV];
    const { routes } = register(ALL_PERMISSIONS);
    for (const route of routes) {
      const res = await runRoute(route, {
        params: { id: "not-a-uuid", supplierId: "not-a-uuid" },
      });
      assert.equal(res.statusCode, 404, `${route.method} ${route.path}`);
      assert.deepEqual(res.body, { error: "API route not found" });
    }
  });

  it("valor inválido na env também mantém desligada", async () => {
    process.env[FLAG_ENV] = "talvez";
    const { routes } = register(ALL_PERMISSIONS);
    const res = await runRoute(findRoute(routes, "GET", "/api/supplier-performance/report"));
    assert.equal(res.statusCode, 404);
  });

  it("a flag é verificada depois da sessão e antes da permissão", async () => {
    delete process.env[FLAG_ENV];
    const { routes, auth } = register([]);
    await runRoute(findRoute(routes, "GET", "/api/supplier-performance/report"));
    assert.deepEqual(auth.calls, ["auth"]);
  });
});

describe("feature flag ligada — permissões", () => {
  for (const value of ["1", "true", "on", "yes", "enabled"]) {
    it(`aceita "${value}" como ligada`, async () => {
      process.env[FLAG_ENV] = value;
      const { routes } = register(ALL_PERMISSIONS);
      const res = await runRoute(
        findRoute(routes, "GET", "/api/purchase-orders/:id/supplier-evaluation"),
        { params: { id: "nao-uuid" } }
      );
      // Passou pelos guards e chegou ao handler (400 de validação de UUID).
      assert.equal(res.statusCode, 400);
    });
  }

  it("GET da avaliação exige operations.purchases:view", async () => {
    process.env[FLAG_ENV] = "1";
    const denied = register([]);
    const res = await runRoute(
      findRoute(denied.routes, "GET", "/api/purchase-orders/:id/supplier-evaluation"),
      { params: { id: "nao-uuid" } }
    );
    assert.equal(res.statusCode, 403);

    const allowed = register(["operations.purchases:view"]);
    const ok = await runRoute(
      findRoute(allowed.routes, "GET", "/api/purchase-orders/:id/supplier-evaluation"),
      { params: { id: "nao-uuid" } }
    );
    assert.equal(ok.statusCode, 400);
  });

  it("PUT exige update — só view não basta", async () => {
    process.env[FLAG_ENV] = "1";
    const viewOnly = register(["operations.purchases:view"]);
    const res = await runRoute(
      findRoute(viewOnly.routes, "PUT", "/api/purchase-orders/:id/supplier-evaluation"),
      { params: { id: "nao-uuid" } }
    );
    assert.equal(res.statusCode, 403);
    assert.ok(viewOnly.auth.calls.includes("resource:operations.purchases:update"));

    const writer = register(["operations.purchases:update"]);
    const ok = await runRoute(
      findRoute(writer.routes, "PUT", "/api/purchase-orders/:id/supplier-evaluation"),
      { params: { id: "nao-uuid" } }
    );
    assert.equal(ok.statusCode, 400);
  });

  it("desempenho exige finance.suppliers:view E operations.purchases:view", async () => {
    process.env[FLAG_ENV] = "1";
    const paths = [
      "/api/supplier-performance/suppliers/:supplierId",
      "/api/supplier-performance/report",
      "/api/supplier-performance/report.csv",
      "/api/supplier-performance/orders.csv",
    ];

    for (const path of paths) {
      const onlySuppliers = register(["finance.suppliers:view"]);
      assert.equal(
        (await runRoute(findRoute(onlySuppliers.routes, "GET", path), {
          params: { supplierId: "nao-uuid" },
        })).statusCode,
        403,
        `${path} deveria negar sem pedidos`
      );

      const onlyPurchases = register(["operations.purchases:view"]);
      assert.equal(
        (await runRoute(findRoute(onlyPurchases.routes, "GET", path), {
          params: { supplierId: "nao-uuid" },
        })).statusCode,
        403,
        `${path} deveria negar sem fornecedores`
      );
    }

    const both = register(["finance.suppliers:view", "operations.purchases:view"]);
    const res = await runRoute(
      findRoute(both.routes, "GET", "/api/supplier-performance/suppliers/:supplierId"),
      { params: { supplierId: "nao-uuid" } }
    );
    assert.equal(res.statusCode, 400);
  });

  it("sem sessão não chega a avaliar permissão", async () => {
    process.env[FLAG_ENV] = "1";
    const { routes, auth } = register(ALL_PERMISSIONS, null);
    const res = await runRoute(
      findRoute(routes, "GET", "/api/supplier-performance/report")
    );
    assert.equal(res.statusCode, 401);
    assert.deepEqual(auth.calls, ["auth"]);
  });

  it("supplierId inválido no relatório é rejeitado antes de consultar", async () => {
    process.env[FLAG_ENV] = "1";
    const { routes } = register(ALL_PERMISSIONS);
    const res = await runRoute(findRoute(routes, "GET", "/api/supplier-performance/report"), {
      query: { supplierId: "'; DROP TABLE x; --" },
    });
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, { error: "supplierId inválido." });
  });
});
