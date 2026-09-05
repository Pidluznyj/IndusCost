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
    app: { get: push("GET"), put: push("PUT"), post: push("POST") } as never,
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
  it("registra as rotas da feature incluindo a worklist Nomus", () => {
    const { routes } = register(ALL_PERMISSIONS);
    assert.deepEqual(
      routes.map((r) => `${r.method} ${r.path}`).sort(),
      [
        "GET /api/purchase-orders/:id/supplier-evaluation",
        "GET /api/supplier-performance/nomus-orders/worklist",
        "GET /api/supplier-performance/orders.csv",
        "GET /api/supplier-performance/report",
        "GET /api/supplier-performance/report.csv",
        "GET /api/supplier-performance/suppliers/:supplierId",
        "POST /api/supplier-performance/nomus-orders/batch",
        "PUT /api/purchase-orders/:id/supplier-evaluation",
        "PUT /api/supplier-performance/nomus-orders/:id",
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

  it("worklist Nomus exige view; escrita exige update", async () => {
    process.env[FLAG_ENV] = "1";
    const denied = register([]);
    assert.equal(
      (
        await runRoute(
          findRoute(denied.routes, "GET", "/api/supplier-performance/nomus-orders/worklist"),
          { query: { evaluationStatus: "nope" } }
        )
      ).statusCode,
      403
    );

    const viewer = register(["operations.purchases:view"]);
    const badFilter = await runRoute(
      findRoute(viewer.routes, "GET", "/api/supplier-performance/nomus-orders/worklist"),
      { query: { evaluationStatus: "nope" } }
    );
    assert.equal(badFilter.statusCode, 400);

    const viewOnlyPut = await runRoute(
      findRoute(viewer.routes, "PUT", "/api/supplier-performance/nomus-orders/:id"),
      { params: { id: "abc" } }
    );
    assert.equal(viewOnlyPut.statusCode, 403);

    const writer = register(["operations.purchases:update"]);
    const put = await runRoute(
      findRoute(writer.routes, "PUT", "/api/supplier-performance/nomus-orders/:id"),
      { params: { id: "abc" }, body: {} }
    );
    assert.equal(put.statusCode, 400);

    const batchDenied = await runRoute(
      findRoute(viewer.routes, "POST", "/api/supplier-performance/nomus-orders/batch"),
      { body: { items: [] } }
    );
    assert.equal(batchDenied.statusCode, 403);
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
    assert.equal(
      (res.body as { code?: string }).code,
      "INVALID_SUPPLIER_PERFORMANCE_FILTER"
    );
  });
});

/**
 * Filtro enviado explicitamente e inválido NÃO pode ser ignorado: ignorar
 * ampliaria a consulta (from inválido -> período aberto) ou devolveria dataset
 * vazio silencioso (from > to). Contrato formal: 400.
 */
describe("filtros inválidos no boundary HTTP", () => {
  const PERFORMANCE_ROUTES = [
    "/api/supplier-performance/suppliers/:supplierId",
    "/api/supplier-performance/report",
    "/api/supplier-performance/report.csv",
    "/api/supplier-performance/orders.csv",
  ];

  const VALID_SUPPLIER_ID = "11111111-1111-4111-8111-111111111111";

  async function callReport(query: Record<string, string>) {
    process.env[FLAG_ENV] = "1";
    const { routes } = register(ALL_PERMISSIONS);
    return runRoute(findRoute(routes, "GET", "/api/supplier-performance/report"), { query });
  }

  function assertFilterRejected(res: FakeResponse, field: string) {
    assert.equal(res.statusCode, 400);
    const body = res.body as { code?: string; field?: string; error?: string };
    assert.equal(body.code, "INVALID_SUPPLIER_PERFORMANCE_FILTER");
    assert.equal(body.field, field);
    assert.ok(body.error && body.error.length > 0);
  }

  for (const bad of ["abc", "2026-13-01", "2026-02-30"]) {
    it(`from="${bad}" -> 400 em todas as rotas de desempenho`, async () => {
      process.env[FLAG_ENV] = "1";
      const { routes } = register(ALL_PERMISSIONS);
      for (const path of PERFORMANCE_ROUTES) {
        const res = await runRoute(findRoute(routes, "GET", path), {
          params: { supplierId: VALID_SUPPLIER_ID },
          query: { from: bad },
        });
        assertFilterRejected(res, "from");
      }
    });
  }

  for (const bad of ["abc", "2026-00-10"]) {
    it(`to="${bad}" -> 400`, async () => {
      assertFilterRejected(await callReport({ to: bad }), "to");
    });
  }

  it("from > to -> 400 (nunca dataset vazio silencioso)", async () => {
    assertFilterRejected(
      await callReport({ from: "2026-09-30", to: "2026-09-01" }),
      "period"
    );
  });

  it("evaluationStatus inválido -> 400 (sem fallback para all)", async () => {
    process.env[FLAG_ENV] = "1";
    const { routes } = register(ALL_PERMISSIONS);
    const res = await runRoute(
      findRoute(routes, "GET", "/api/supplier-performance/suppliers/:supplierId"),
      {
        params: { supplierId: VALID_SUPPLIER_ID },
        query: { evaluationStatus: "banana" },
      }
    );
    assertFilterRejected(res, "evaluationStatus");
  });

  it("sort inválido -> 400 (sem fallback para name)", async () => {
    assertFilterRejected(await callReport({ sort: "foobar" }), "sort");
  });

  it("supplierStatus inválido -> 400 (não consulta todos)", async () => {
    assertFilterRejected(await callReport({ supplierStatus: "INVALIDO" }), "supplierStatus");
  });

  /**
   * Filtros ausentes ou válidos NÃO podem gerar erro de filtro. O 400 esperado
   * aqui é o do `supplierId` do path (checado antes do banco), o que mantém o
   * teste livre de PostgreSQL — o aceite dos valores em si está coberto nos
   * testes do parser puro.
   */
  for (const [label, query] of [
    ["ausentes", {}],
    [
      "válidos",
      {
        from: "2026-02-01",
        to: "2026-02-28",
        evaluationStatus: "pending",
        page: "2",
        pageSize: "10",
      },
    ],
  ] as const) {
    it(`filtros ${label} não produzem erro de filtro`, async () => {
      process.env[FLAG_ENV] = "1";
      const { routes } = register(ALL_PERMISSIONS);
      const res = await runRoute(
        findRoute(routes, "GET", "/api/supplier-performance/suppliers/:supplierId"),
        { params: { supplierId: "nao-uuid" }, query }
      );
      assert.equal(res.statusCode, 400);
      assert.deepEqual(res.body, { error: "supplierId inválido." });
      assert.notEqual(
        (res.body as { code?: string }).code,
        "INVALID_SUPPLIER_PERFORMANCE_FILTER"
      );
    });
  }
});
