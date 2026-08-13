/**
 * Metas (OKR) — wiring HTTP: guards por ação (view/create/update/manage),
 * parse antes do service e erros de domínio viram status controlado.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type express from "express";
import { GOALS_RESOURCE_KEY, registerGoalRoutes } from "./goalRoutes.js";
import { GoalDomainError, type GoalService } from "./goalService.server.js";

type RouteEntry = {
  method: string;
  path: string;
  guards: string[];
  handler: (req: unknown, res: unknown) => Promise<void>;
};

function buildFakeApp(): { app: express.Express; routes: RouteEntry[] } {
  const routes: RouteEntry[] = [];
  const register =
    (method: string) =>
    (path: string, ...handlers: unknown[]) => {
      const guards = handlers
        .slice(0, -1)
        .map((h) => (h as { __guard?: string }).__guard ?? "auth");
      routes.push({
        method,
        path,
        guards,
        handler: handlers.at(-1) as RouteEntry["handler"],
      });
    };
  const app = {
    get: register("GET"),
    post: register("POST"),
    put: register("PUT"),
    delete: register("DELETE"),
  } as unknown as express.Express;
  return { app, routes };
}

function fakeGuardFactory() {
  const calls: Array<{ resourceKey: string; action?: string }> = [];
  const requireResource = (resourceKey: string, action?: string) => {
    calls.push({ resourceKey, action });
    const mw = (() => {}) as unknown as express.RequestHandler & { __guard?: string };
    mw.__guard = `${resourceKey}:${action}`;
    return mw;
  };
  const requireAppAuth = (() => {}) as unknown as express.RequestHandler & {
    __guard?: string;
  };
  requireAppAuth.__guard = "auth";
  return { requireResource, requireAppAuth, calls };
}

function mockRes() {
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

function stubService(overrides: Partial<GoalService> = {}): GoalService {
  return {
    listGoals: async () => [],
    getGoal: async () => {
      throw new GoalDomainError("NOT_FOUND", "Objetivo não encontrado.");
    },
    createGoal: async () => ({}) as never,
    updateGoal: async () => ({}) as never,
    deleteGoal: async () => ({ deleted: true, archived: false }),
    createKeyResult: async () => ({}) as never,
    updateKeyResult: async () => ({}) as never,
    deleteKeyResult: async () => ({ deleted: true, archived: false }),
    setAchievedValue: async () => ({}) as never,
    listOwnerOptions: async () => [],
    listSnapshots: async () => [],
    previewRule: async () => ({ value: "0" }),
    ...overrides,
  } as GoalService;
}

function setup(service = stubService()) {
  const { app, routes } = buildFakeApp();
  const { requireResource, requireAppAuth } = fakeGuardFactory();
  registerGoalRoutes(app, {
    requireAppAuth,
    requireResource,
    getCurrentAppUser: () => ({ id: "user-1" }),
    service,
  });
  return { routes };
}

describe("goalRoutes — guards por ação", () => {
  it("toda rota exige auth + recurso admin.goals com a ação correta", () => {
    const { routes } = setup();
    assert.ok(routes.length >= 10, "todas as rotas registradas");
    for (const route of routes) {
      assert.equal(route.guards[0], "auth", `${route.path} sem requireAppAuth`);
      assert.ok(
        route.guards[1]?.startsWith(`${GOALS_RESOURCE_KEY}:`),
        `${route.path} sem guard de recurso`
      );
    }
    const guardOf = (method: string, path: string) =>
      routes.find((r) => r.method === method && r.path === path)?.guards[1];
    assert.equal(guardOf("GET", "/api/goals"), "admin.goals:view");
    assert.equal(guardOf("POST", "/api/goals"), "admin.goals:create");
    assert.equal(guardOf("PUT", "/api/goals/:id"), "admin.goals:update");
    assert.equal(guardOf("DELETE", "/api/goals/:id"), "admin.goals:manage");
    assert.equal(
      guardOf("POST", "/api/goals/key-results/:id/achieved-value"),
      "admin.goals:update"
    );
    assert.equal(
      guardOf("DELETE", "/api/goals/key-results/:id"),
      "admin.goals:manage"
    );
  });

  it("rota owner-options vem ANTES de /api/goals/:id (senão :id captura)", () => {
    const { routes } = setup();
    const getPaths = routes.filter((r) => r.method === "GET").map((r) => r.path);
    assert.ok(
      getPaths.indexOf("/api/goals/owner-options") < getPaths.indexOf("/api/goals/:id")
    );
  });
});

describe("goalRoutes — parse e erros controlados", () => {
  it("payload inválido vira 400 com field, sem tocar o service", async () => {
    let serviceTouched = false;
    const { routes } = setup(
      stubService({
        createGoal: async () => {
          serviceTouched = true;
          return {} as never;
        },
      })
    );
    const route = routes.find((r) => r.method === "POST" && r.path === "/api/goals")!;
    const res = mockRes();
    await route.handler(
      { body: { title: "", startDate: "2026-01-01", endDate: "2026-12-31" } },
      res
    );
    assert.equal(res.statusCode, 400);
    assert.equal((res.body as { field?: string }).field, "title");
    assert.equal(serviceTouched, false);
  });

  it("NOT_FOUND vira 404; CONFLICT vira 409", async () => {
    const { routes } = setup(
      stubService({
        setAchievedValue: async () => {
          throw new GoalDomainError("CONFLICT", "KR arquivado não recebe valores.");
        },
      })
    );
    const getGoal = routes.find((r) => r.method === "GET" && r.path === "/api/goals/:id")!;
    const res404 = mockRes();
    await getGoal.handler({ params: { id: "x" }, query: {} }, res404);
    assert.equal(res404.statusCode, 404);

    const setValue = routes.find(
      (r) => r.method === "POST" && r.path === "/api/goals/key-results/:id/achieved-value"
    )!;
    const res409 = mockRes();
    await setValue.handler(
      { params: { id: "x" }, body: { achievedValue: "10" } },
      res409
    );
    assert.equal(res409.statusCode, 409);
  });

  it("POST /api/goals/:id/key-results repassa rule ao service (indicador dentro do objetivo existente)", async () => {
    let seenGoalId: unknown = null;
    let seenInput: unknown = null;
    const { routes } = setup(
      stubService({
        createKeyResult: async (goalId, input) => {
          seenGoalId = goalId;
          seenInput = input;
          return {} as never;
        },
      })
    );
    const route = routes.find(
      (r) => r.method === "POST" && r.path === "/api/goals/:id/key-results"
    )!;
    const res = mockRes();
    const rule = { entityKey: "SALES_ORDERS", metricKey: "SALES_NET_TOTAL", filters: [] };
    await route.handler(
      {
        params: { id: "goal-1" },
        body: {
          title: "Faturamento",
          domain: "COMERCIAL",
          trackingType: "INCREASE",
          baseline: "0",
          target: "100000",
          ownerAppUserId: "3f2b8c9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
          rule,
        },
      },
      res
    );
    assert.equal(res.statusCode, 201);
    assert.equal(seenGoalId, "goal-1");
    assert.deepEqual((seenInput as { rule: unknown }).rule, rule);
  });

  it("POST /api/goals/rules/preview: guard de leitura, valida a janela e delega ao service", async () => {
    let seen = null;
    const { routes } = setup(
      stubService({
        previewRule: async (rule, window) => {
          seen = { rule, window };
          return { value: "1234.5" };
        },
      })
    );
    const route = routes.find(
      (r) => r.method === "POST" && r.path === "/api/goals/rules/preview"
    )!;
    // Somente leitura: quem enxerga metas pode testar a medição.
    assert.ok(route.guards.includes(`${GOALS_RESOURCE_KEY}:view`));

    // Sem datas válidas → 400 e o service NUNCA é chamado.
    const bad = mockRes();
    await route.handler({ body: { rule: { entityKey: "SALES_ORDERS" } } }, bad);
    assert.equal(bad.statusCode, 400);
    assert.equal(seen, null);

    // Data final antes da inicial também é rejeitada.
    const inverted = mockRes();
    await route.handler(
      { body: { startDate: "2026-09-30", endDate: "2026-07-01", rule: {} } },
      inverted
    );
    assert.equal(inverted.statusCode, 400);
    assert.equal(seen, null);

    const ok = mockRes();
    const rule = { entityKey: "SALES_ORDERS", metricKey: "SALES_NET_TOTAL", filters: [] };
    await route.handler(
      { body: { startDate: "2026-07-01", endDate: "2026-09-30", rule } },
      ok
    );
    assert.equal(ok.statusCode, 200);
    assert.deepEqual(seen, {
      rule,
      window: { startCivilDate: "2026-07-01", endCivilDate: "2026-09-30" },
    });
  });

  it("GET /api/goals delega filtros onlyMine/status ao service", async () => {
    let seen: unknown = null;
    const { routes } = setup(
      stubService({
        listGoals: async (filters) => {
          seen = filters;
          return [];
        },
      })
    );
    const route = routes.find((r) => r.method === "GET" && r.path === "/api/goals")!;
    const res = mockRes();
    await route.handler({ query: { onlyMine: "true", status: "ACTIVE" } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(seen, {
      ownerAppUserId: "user-1",
      status: "ACTIVE",
      includeArchived: false,
      year: null,
    });
  });
});
