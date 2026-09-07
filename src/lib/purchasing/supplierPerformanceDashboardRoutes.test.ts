/**
 * Compras → Performance — contrato das rotas: auth, permissão canônica de
 * Compras, validação de query, paginação, 404, sucesso. Sem banco.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import type { RequestHandler } from "express";
import type { ResolvedPurchaseOrderSupplier } from "@/src/lib/nomus/nomusPurchaseOrder360.js";
import { registerSupplierPerformanceDashboardRoutes } from "./supplierPerformanceDashboardRoutes.js";
import type { SupplierPerformanceDashboardDb } from "./supplierPerformanceDashboard.server.js";
import { FIXTURE_CATALOG, FIXTURE_EVALUATIONS, FIXTURE_LINES, FIXTURE_ORDERS, S1 } from "./supplierPerformanceDashboardFixture.test-helper.js";

type Registered = { method: string; path: string; handlers: RequestHandler[] };

function createFakeApp() {
  const routes: Registered[] = [];
  const push = (method: string) => (path: string, ...handlers: RequestHandler[]) => {
    routes.push({ method, path, handlers });
  };
  return {
    app: { get: push("GET"), put: push("PUT"), post: push("POST"), delete: push("DELETE"), patch: push("PATCH") } as never,
    routes,
  };
}

function createAuth(granted: Set<string>, user: { id: string; name: string } | null) {
  const calls: string[] = [];
  const requireAppAuth: RequestHandler = (_req, res, next) => {
    calls.push("auth");
    if (!user) {
      res.status(401).json({ error: "Autenticação necessária." });
      return;
    }
    next();
  };
  const requireResource = (resourceKey: string, action = "view"): RequestHandler => (_req, res, next) => {
    const key = `${resourceKey}:${action}`;
    calls.push(`resource:${key}`);
    if (!granted.has(key)) {
      res.status(403).json({ error: "Acesso negado.", code: "FORBIDDEN" });
      return;
    }
    next();
  };
  return { calls, guards: { requireAppAuth, requireResource } };
}

class Dec {
  constructor(private readonly v: number) {}
  toString(): string {
    return String(this.v);
  }
}
const dec = (v: number | null) => (v == null ? null : new Dec(v));

function createDb(): SupplierPerformanceDashboardDb {
  return {
    nomusPurchaseOrder: {
      findMany: async () => FIXTURE_ORDERS.map((o) => ({ ...o, totalAmount: dec(o.totalAmount) })),
      findFirst: async () => ({ syncedAt: new Date("2026-09-06T03:00:00Z") }),
      aggregate: async () => ({
        _min: { issuedAt: new Date("2025-12-01T12:00:00"), firstSeenAt: null },
        _max: { issuedAt: new Date("2026-06-01T12:00:00"), firstSeenAt: null },
      }),
    },
    nomusPurchaseOrderItem: {
      findMany: async () =>
        FIXTURE_LINES.map((l) => ({
          ...l,
          orderedQuantity: dec(l.orderedQuantity),
          receivedQuantity: dec(l.receivedQuantity),
          unitPrice: dec(l.unitPrice),
          totalAmount: dec(l.totalAmount),
        })),
    },
    nomusPurchaseOrderSupplierEvaluation: {
      findMany: async () =>
        FIXTURE_EVALUATIONS.map((e) => ({
          ...e,
          overallScore: new Dec(e.overallScore),
          qualityScore: new Dec(e.qualityScore),
          deliveryScore: new Dec(e.deliveryScore),
          conformityScore: new Dec(e.conformityScore),
          serviceScore: new Dec(e.serviceScore),
        })),
    },
    nomusProductCatalog: { findMany: async () => FIXTURE_CATALOG },
    financialSupplier: { findMany: async () => [] },
  } as unknown as SupplierPerformanceDashboardDb;
}

type FakeResponse = { statusCode: number | null; body: unknown; headers: Record<string, string> };

async function runRoute(route: Registered, request: Record<string, unknown> = {}): Promise<FakeResponse> {
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
    setHeader(name: string, value: string) {
      result.headers[name] = value;
    },
  };
  const req = { query: {}, params: {}, body: {}, ...request };
  for (const handler of route.handlers) {
    let nextCalled = false;
    await handler(req as never, res as never, () => {
      nextCalled = true;
    });
    if (!nextCalled) break;
  }
  return result;
}

const VIEW = "operations.purchases:view";

function setup(granted: string[] = [VIEW], user: { id: string; name: string } | null = { id: "u1", name: "Ana" }) {
  const { app, routes } = createFakeApp();
  const auth = createAuth(new Set(granted), user);
  registerSupplierPerformanceDashboardRoutes(app, auth.guards, { db: createDb(), deps: { resolveSuppliers, evaluationFeatureEnabled: true, now: new Date("2026-09-07T12:00:00") } });
  const find = (path: string) => routes.find((route) => route.path === path)!;
  return { routes, auth, find };
}

const resolveSuppliers = async (
  samples: Array<{ supplierExternalId: number | null; supplierName: string | null; supplierTaxId: string | null }>
): Promise<ResolvedPurchaseOrderSupplier[]> =>
  samples.map((sample) => ({
    nomusExternalId: sample.supplierExternalId,
    nomusName: sample.supplierName,
    nomusDocument: sample.supplierTaxId,
    resolvedName: sample.supplierName,
    resolvedDocument: sample.supplierTaxId,
    financialSupplierId: null,
    matchMethod: "UNRESOLVED",
    matchConfidence: "UNRESOLVED",
    matched: false,
    ambiguous: false,
    source: "test",
  }));

describe("rotas — registro e guards", () => {
  it("registra somente GET, todos com auth + operations.purchases:view", () => {
    const { routes } = setup();
    assert.deepEqual(
      routes.map((route) => `${route.method} ${route.path}`),
      [
        "GET /api/purchases/performance",
        "GET /api/purchases/performance/supplier-materials",
        "GET /api/purchases/performance/materials",
        "GET /api/purchases/performance/materials/:materialKey",
        "GET /api/purchases/performance/suppliers/:supplierExternalId",
      ]
    );
    assert.ok(routes.every((route) => route.method === "GET"));
    assert.ok(routes.every((route) => route.handlers.length === 3));
  });

  it("sem sessão → 401 antes de qualquer consulta", async () => {
    const { find, auth } = setup([VIEW], null);
    const res = await runRoute(find("/api/purchases/performance"));
    assert.equal(res.statusCode, 401);
    assert.deepEqual(auth.calls, ["auth"]);
  });

  it("sem operations.purchases:view → 403 (deny > allow; unknown = deny)", async () => {
    const { find, auth } = setup(["finance.suppliers:view"]);
    const res = await runRoute(find("/api/purchases/performance/suppliers/:supplierExternalId"), { params: { supplierExternalId: String(S1) } });
    assert.equal(res.statusCode, 403);
    assert.deepEqual(auth.calls, ["auth", `resource:${VIEW}`]);
  });

  it("filtros inválidos → 400 fail-fast com field", async () => {
    const { find } = setup();
    const bad = await runRoute(find("/api/purchases/performance"), { query: { from: "2026-99-01" } });
    assert.equal(bad.statusCode, 400);
    assert.equal((bad.body as { code: string }).code, "INVALID_SUPPLIER_PERFORMANCE_FILTER");
    const badSupplier = await runRoute(find("/api/purchases/performance/suppliers/:supplierExternalId"), { params: { supplierExternalId: "abc" } });
    assert.equal(badSupplier.statusCode, 400);
    const badMaterial = await runRoute(find("/api/purchases/performance/materials/:materialKey"), { params: { materialKey: "desc:aco" } });
    assert.equal(badMaterial.statusCode, 400);
    const badSort = await runRoute(find("/api/purchases/performance/supplier-materials"), { query: { sort: "hack" } });
    assert.equal(badSort.statusCode, 400);
  });
});

describe("rotas — respostas", () => {
  it("dashboard: sucesso com read model, filtros aplicados e Cache-Control no-store", async () => {
    const { find } = setup();
    const res = await runRoute(find("/api/purchases/performance"), { query: { from: "2026-01-01", to: "2026-12-31" } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["Cache-Control"], "no-store");
    const body = res.body as { kpis: { purchaseOrderCount: number; totalSpend: number }; metadata: { filters: { period: { from: string } } }; advancedMetrics: unknown[] };
    assert.equal(body.kpis.purchaseOrderCount, 9);
    assert.equal(body.kpis.totalSpend, 4470);
    assert.equal(body.metadata.filters.period.from, "2026-01-01");
    assert.ok(body.advancedMetrics.length > 20);
  });

  it("resultado vazio: 200 com zeros reais (não erro)", async () => {
    const { find } = setup();
    const res = await runRoute(find("/api/purchases/performance"), { query: { from: "2030-01-01", to: "2030-12-31" } });
    assert.equal(res.statusCode, 200);
    const body = res.body as { kpis: { purchaseOrderCount: number; averageTicket: number | null } };
    assert.equal(body.kpis.purchaseOrderCount, 0);
    assert.equal(body.kpis.averageTicket, null);
  });

  it("matriz paginada e detalhe de fornecedor/MP (200) e inexistente (404)", async () => {
    const { find } = setup();
    const matrix = await runRoute(find("/api/purchases/performance/supplier-materials"), { query: { from: "2026-01-01", to: "2026-12-31", page: "1", pageSize: "2", sort: "spend" } });
    assert.equal(matrix.statusCode, 200);
    const matrixBody = matrix.body as { rows: unknown[]; total: number; pageSize: number };
    assert.equal(matrixBody.rows.length, 2);
    assert.equal(matrixBody.total, 6);
    const supplier = await runRoute(find("/api/purchases/performance/suppliers/:supplierExternalId"), { params: { supplierExternalId: String(S1) }, query: { from: "2026-01-01", to: "2026-12-31" } });
    assert.equal(supplier.statusCode, 200);
    assert.equal((supplier.body as { purchases: { spend: number } }).purchases.spend, 1800);
    const missing = await runRoute(find("/api/purchases/performance/suppliers/:supplierExternalId"), { params: { supplierExternalId: "999" }, query: { from: "2026-01-01", to: "2026-12-31" } });
    assert.equal(missing.statusCode, 404);
    const material = await runRoute(find("/api/purchases/performance/materials/:materialKey"), { params: { materialKey: "nomus:2" }, query: { from: "2026-01-01", to: "2026-12-31" } });
    assert.equal(material.statusCode, 200);
    const missingMaterial = await runRoute(find("/api/purchases/performance/materials/:materialKey"), { params: { materialKey: "nomus:999" }, query: { from: "2026-01-01", to: "2026-12-31" } });
    assert.equal(missingMaterial.statusCode, 404);
  });
});

describe("contrato estático — wiring e read-only", () => {
  const read = (relative: string) => readFileSync(relative, "utf8");

  it("server.ts registra as rotas com requireResource; contrato lista os endpoints em operations.purchases", () => {
    const server = read("server.ts");
    assert.match(server, /registerSupplierPerformanceDashboardRoutes\(app, \{\s*requireAppAuth,\s*requireResource,\s*\}\)/);
    const resources = read("src/lib/security/permissionContract/resources.ts");
    assert.match(resources, /"\/api\/purchases\/performance",/);
    assert.match(resources, /"\/api\/purchases\/performance\/suppliers\/:supplierExternalId",/);
  });

  it("nenhum writeback Nomus, nenhuma mutação, nenhuma permission key nova", () => {
    for (const file of [
      "src/lib/purchasing/supplierPerformanceDashboardRoutes.ts",
      "src/lib/purchasing/supplierPerformanceDashboard.server.ts",
      "src/lib/purchasing/supplierPerformanceDashboard.ts",
    ]) {
      const source = read(file);
      assert.doesNotMatch(source, /app\.(post|put|patch|delete)\(/, file);
      assert.doesNotMatch(source, /fetchNomus|NOMUS_BASE_URL|nomusHttp/, file);
      assert.doesNotMatch(source, /\.(create|update|delete|upsert)\(/, file);
    }
    const routes = read("src/lib/purchasing/supplierPerformanceDashboardRoutes.ts");
    assert.match(routes, /OPERATIONS_RESOURCE_KEYS\.purchases, OPERATIONS_ACTIONS\.view/);
    const catalog = read("src/lib/permissionCatalog.ts");
    assert.doesNotMatch(catalog, /purchases\.performance/);
  });

  it("navegação: Performance ao lado de Pedidos Nomus e Avaliação Fornecedor; rota e componente registrados", () => {
    const nav = read("src/components/supply-chain/PurchaseChainViewNav.tsx");
    const nomusBlock = /const NOMUS_CONTEXT_VIEWS[\s\S]*?];/.exec(nav)!;
    assert.match(nomusBlock[0], /label: "Pedidos Nomus"/);
    assert.match(nomusBlock[0], /label: "Avaliação Fornecedor"/);
    assert.match(nomusBlock[0], /id: "performance", label: "Performance", to: "\/purchases\/performance"/);
    const app = read("src/App.tsx");
    assert.match(app, /path="purchases\/performance"/);
    assert.match(app, /<SupplierPerformanceDashboardPage \/>/);
    assert.match(app, /path="purchases\/nomus-orders"/);
    assert.match(app, /path="purchases\/supplier-evaluation"/);
  });
});
