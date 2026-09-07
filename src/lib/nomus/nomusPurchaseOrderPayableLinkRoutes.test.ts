/**
 * Pedido Nomus ↔ Contas a Pagar — contrato das rotas: leitura com as
 * permissões da listagem, escrita com operations.purchases:update, validação
 * de ids, 401/403/404/201 e cabeçalho no-store. Sem banco real.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import type { Request, RequestHandler, Response } from "express";
import { registerNomusPurchaseOrderPayableLinkRoutes } from "@/src/lib/nomusPurchaseOrderPayableLinkRoutes.js";

type Registered = { method: string; path: string; handlers: RequestHandler[] };

function createFakeApp() {
  const routes: Registered[] = [];
  const push = (method: string) => (path: string, ...handlers: RequestHandler[]) => {
    routes.push({ method, path, handlers });
  };
  return {
    app: { get: push("GET"), post: push("POST"), delete: push("DELETE"), put: push("PUT"), patch: push("PATCH") } as never,
    routes,
  };
}

function createAuth(options: { user: { id: string; name: string } | null; permissions: Set<string>; resources: Set<string> }) {
  const calls: string[] = [];
  const requireAppAuth: RequestHandler = (_req, res, next) => {
    calls.push("auth");
    if (!options.user) {
      res.status(401).json({ error: "Autenticação necessária." });
      return;
    }
    next();
  };
  const requireAnyPermission = (keys: readonly string[]): RequestHandler => (_req, res, next) => {
    calls.push(`any:${keys.join("|")}`);
    if (!keys.some((key) => options.permissions.has(key))) {
      res.status(403).json({ error: "Acesso negado." });
      return;
    }
    next();
  };
  const requireResource = (resourceKey: string, action = "view"): RequestHandler => (_req, res, next) => {
    const key = `${resourceKey}:${action}`;
    calls.push(`resource:${key}`);
    if (!options.resources.has(key)) {
      res.status(403).json({ error: "Acesso negado.", code: "FORBIDDEN" });
      return;
    }
    next();
  };
  const getCurrentAppUser = async () => options.user;
  return { calls, guards: { requireAppAuth, requireAnyPermission, requireResource, getCurrentAppUser } as never };
}

function createRes() {
  const state = { status: 200, body: undefined as unknown, headers: {} as Record<string, string> };
  const res = {
    status(code: number) {
      state.status = code;
      return res;
    },
    json(body: unknown) {
      state.body = body;
      return res;
    },
    setHeader(name: string, value: string) {
      state.headers[name] = value;
    },
  } as unknown as Response;
  return { res, state };
}

async function run(route: Registered, req: Partial<Request>) {
  const { res, state } = createRes();
  for (const handler of route.handlers) {
    let called = false;
    await handler(req as Request, res, () => {
      called = true;
    });
    if (!called) break;
  }
  return state;
}

const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const ORDER = {
  id: ORDER_ID,
  externalId: 613,
  orderNumber: "PC00612",
  supplierExternalId: 215,
  supplierTaxId: null,
  rawPayload: { id: 613, codigoPedido: "PC00612", idPessoaFornecedor: 215, parcelas: [] },
};

/** Prisma mínimo: um pedido, nenhum título, nenhum vínculo. */
function createDb(options: { orderExists?: boolean } = {}) {
  const db = {
    nomusPurchaseOrder: { findUnique: async () => (options.orderExists === false ? null : ORDER) },
    nomusStockDocument: { findMany: async () => [] },
    nomusAccountsPayable: { findMany: async () => [], findUnique: async () => null },
    nomusPurchaseOrderPayableLink: { findMany: async () => [], findUnique: async () => null },
    nomusPurchaseOrderPayableLinkHistory: { create: async () => ({}) },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(db),
  };
  return db as unknown as PrismaClient;
}

function setup(auth: ReturnType<typeof createAuth>, db = createDb()) {
  const { app, routes } = createFakeApp();
  registerNomusPurchaseOrderPayableLinkRoutes(app, auth.guards, { db });
  const find = (method: string, suffix: string) => {
    const route = routes.find((row) => row.method === method && row.path.endsWith(suffix));
    if (!route) throw new Error(`rota ${method} ${suffix} não registrada`);
    return route;
  };
  return {
    routes,
    get: find("GET", "/:id/payables"),
    post: find("POST", "/payables/links"),
    del: find("DELETE", "/links/:payableExternalId"),
  };
}

const VIEWER = createAuth({
  user: { id: "u1", name: "Viewer" },
  permissions: new Set(["purchases.view"]),
  resources: new Set(),
});
const EDITOR = createAuth({
  user: { id: "u2", name: "Editor" },
  permissions: new Set(["purchases.view"]),
  resources: new Set(["operations.purchases:update"]),
});
const ANONYMOUS = createAuth({ user: null, permissions: new Set(), resources: new Set() });

describe("rotas Pedido Nomus ↔ Contas a Pagar", () => {
  it("registra exatamente GET, POST e DELETE sob /api/nomus/purchase-orders/:id/payables", () => {
    const { routes } = setup(VIEWER);
    assert.deepEqual(
      routes.map((row) => `${row.method} ${row.path}`),
      [
        "GET /api/nomus/purchase-orders/:id/payables",
        "POST /api/nomus/purchase-orders/:id/payables/links",
        "DELETE /api/nomus/purchase-orders/:id/payables/links/:payableExternalId",
      ]
    );
  });

  it("GET: leitura usa as permissões da listagem, devolve reconciliação com no-store", async () => {
    const { get } = setup(VIEWER);
    const state = await run(get, { params: { id: ORDER_ID } });
    assert.equal(state.status, 200);
    assert.equal(state.headers["Cache-Control"], "no-store");
    const body = state.body as { orderId: string; financialStatus: string; installments: unknown[] };
    assert.equal(body.orderId, ORDER_ID);
    assert.equal(body.financialStatus, "NO_FINANCIAL_DATA");
    assert.deepEqual(body.installments, []);
    assert.ok(VIEWER.calls.some((call) => call.startsWith("any:") && call.includes("purchases.view")));
  });

  it("GET: sem sessão 401; id fora do padrão 400; pedido inexistente 404", async () => {
    assert.equal((await run(setup(ANONYMOUS).get, { params: { id: ORDER_ID } })).status, 401);
    assert.equal((await run(setup(VIEWER).get, { params: { id: "613" } })).status, 400);
    const missing = await run(setup(VIEWER, createDb({ orderExists: false })).get, { params: { id: ORDER_ID } });
    assert.equal(missing.status, 404);
    assert.equal((missing.body as { code: string }).code, "PURCHASE_ORDER_NOT_FOUND");
  });

  it("POST/DELETE: exigem operations.purchases:update — quem só vê recebe 403 sem tocar no banco", async () => {
    const forbidden = setup(VIEWER);
    const post = await run(forbidden.post, { params: { id: ORDER_ID }, body: { payableExternalId: 1, reason: "x" } });
    assert.equal(post.status, 403);
    const del = await run(forbidden.del, { params: { id: ORDER_ID, payableExternalId: "1" }, body: { reason: "x" } });
    assert.equal(del.status, 403);
    assert.ok(VIEWER.calls.includes("resource:operations.purchases:update"));
  });

  it("POST: payload inválido 400 com campo; título inexistente 404", async () => {
    const { post } = setup(EDITOR);
    const invalid = await run(post, { params: { id: ORDER_ID }, body: { payableExternalId: "abc" } });
    assert.equal(invalid.status, 400);
    assert.equal((invalid.body as { field: string }).field, "payableExternalId");
    const missing = await run(post, { params: { id: ORDER_ID }, body: { payableExternalId: 9999, reason: "x" } });
    assert.equal(missing.status, 404);
    assert.equal((missing.body as { code: string }).code, "PAYABLE_NOT_FOUND");
  });

  it("DELETE: título não numérico 400; vínculo inexistente 404; motivo obrigatório 400", async () => {
    const { del } = setup(EDITOR);
    assert.equal((await run(del, { params: { id: ORDER_ID, payableExternalId: "x" }, body: { reason: "x" } })).status, 400);
    const noReason = await run(del, { params: { id: ORDER_ID, payableExternalId: "10" }, body: {} });
    assert.equal(noReason.status, 400);
    assert.equal((noReason.body as { code: string }).code, "PURCHASE_ORDER_PAYABLE_LINK_REASON_REQUIRED");
    const missing = await run(del, { params: { id: ORDER_ID, payableExternalId: "10" }, body: { reason: "x" } });
    assert.equal(missing.status, 404);
    assert.equal((missing.body as { code: string }).code, "PAYABLE_LINK_NOT_FOUND");
  });
});

describe("fiação estática", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

  it("server.ts registra as rotas e o contrato de permissões lista os três endpoints em Compras", () => {
    const server = read("../../../server.ts");
    assert.match(server, /registerNomusPurchaseOrderPayableLinkRoutes\(app, \{/);
    const contract = read("../security/permissionContract/resources.ts");
    for (const endpoint of [
      "/api/nomus/purchase-orders/:id/payables",
      "/api/nomus/purchase-orders/:id/payables/links",
      "/api/nomus/purchase-orders/:id/payables/links/:payableExternalId",
    ]) {
      assert.ok(contract.includes(endpoint), `contrato sem ${endpoint}`);
    }
  });

  it("nada escreve no Nomus: o módulo de vínculo não importa cliente HTTP do Nomus", () => {
    const server = read("./nomusPurchaseOrderPayableLink.server.ts");
    assert.doesNotMatch(server, /nomusClient|nomusHttp|fetch\(/);
    const engine = read("./nomusPurchaseOrderPayableLink.ts");
    assert.doesNotMatch(engine, /@prisma\/client|@\/src\/lib\/prisma/);
  });

  it("migração é aditiva: só CREATE/ALTER ADD, nunca DROP", () => {
    const sql = read("../../../prisma/migrations/20260924120000_nomus_purchase_order_payable_link/migration.sql");
    assert.match(sql, /CREATE TABLE "NomusPurchaseOrderPayableLink"/);
    assert.match(sql, /CREATE TABLE "NomusPurchaseOrderPayableLinkHistory"/);
    assert.doesNotMatch(sql, /DROP /i);
  });
});
