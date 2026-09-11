import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { COMMERCIAL_PILOT_ENDPOINTS } from "@/src/lib/commercialAccess.js";
import {
  CRM_REPORTS_CUSTOM_EXPORT_PATH,
  CRM_REPORTS_CUSTOM_PATH,
  CRM_REPORTS_OPERATIONAL_EXPORT_PATH,
  CRM_REPORTS_OPERATIONAL_PATH,
  registerCrmReportsRoutes,
} from "./crmReportsRoutes.js";
import {
  CrmReportsCapacityError,
  type CrmReportsDataSource,
} from "./crmReportsOperationalService.server.js";
import { CrmCustomReportTooLargeError } from "./crmCustomReportCore.js";
import type { CrmCustomReportResponse, CrmReportsOperationalResponse } from "./crmReportsTypes.js";

type Handler = (req: unknown, res: FakeRes, next?: () => void) => unknown;
type FakeRes = {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  status(code: number): FakeRes;
  json(payload: unknown): FakeRes;
  setHeader(name: string, value: string): FakeRes;
  send(payload: unknown): FakeRes;
};

function createRes(): FakeRes {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
  };
}

function mockAuth(role: AppAuthContext["role"], permissions: string[] = []): AppAuthContext {
  return {
    id: "user-1",
    name: "Test User",
    email: "test@example.com",
    role,
    permissions,
    effectivePermissions: permissions,
    accessProfileId: null,
    accessProfileName: null,
    employeeId: null,
    employeeName: null,
    employeeDepartment: null,
    isActive: true,
    externalSellerId: null,
    externalSellerIds: [],
    sellerResponsibleName: null,
    sellerIdentityKey: null,
    permissionsVersion: 1,
    mustChangePassword: false,
    passwordChangedAt: null,
    lastLoginAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sessionId: "sess-1",
    sessionPermissionsVersionAtIssue: 1,
  };
}

const CUSTOMER_ID = "00000000-0000-4000-8000-000000000001";

function tinyDataSource(overrides: Partial<CrmReportsDataSource> = {}): CrmReportsDataSource {
  return {
    findCustomers: async () => [
      { id: CUSTOMER_ID, companyName: "Alfa Ltda", tradeName: null, taxId: "1", city: null, state: null },
    ],
    findManualOwnerCustomerIds: async () => [],
    findSalesOrders: async () => [
      {
        id: "o1",
        customerId: CUSTOMER_ID,
        orderCode: "PD 00001",
        issueDate: new Date(2026, 8, 1, 10),
        totalNetValue: 100,
        externalSellerId: null,
        nomusSellerName: null,
      },
    ],
    resolveCommercialOwners: async () => new Map(),
    findActivities: async () => [],
    loadSellerIdentityContext: async () => ({ persons: [], aliases: [] }),
    searchCustomers: async () => [
      { id: CUSTOMER_ID, companyName: "Alfa Ltda", tradeName: null, taxId: "1", city: null, state: null },
    ],
    findActiveCommercialOwners: async () => [],
    groupOrderSellers: async () => [{ externalSellerId: null, orderCount: 1 }],
    ...overrides,
  };
}

function setup(options: {
  user?: AppAuthContext | null;
  dataSource?: CrmReportsDataSource;
} = {}) {
  const routes: Array<{ method: string; path: string; handlers: Handler[] }> = [];
  const register = (method: string) => (path: string, ...handlers: Handler[]) => {
    routes.push({ method, path, handlers });
  };
  const app = { get: register("GET"), post: register("POST"), put: register("PUT"), patch: register("PATCH"), delete: register("DELETE") };
  const requireAppAuth: Handler = () => undefined;
  const resourceGuards: Array<{ key: string; action?: string; guard: Handler }> = [];
  const requireResource = (key: string, action?: string) => {
    const guard: Handler = () => undefined;
    resourceGuards.push({ key, action, guard });
    return guard;
  };
  registerCrmReportsRoutes(app as never, {
    requireAppAuth: requireAppAuth as never,
    requireResource: requireResource as never,
    getCurrentAppUser: async () => (options.user === undefined ? mockAuth("COMMERCIAL_MANAGER") : options.user),
    prisma: {} as never,
    createDataSource: () => options.dataSource ?? tinyDataSource(),
    now: () => new Date(2026, 8, 11, 10, 0, 0),
  });
  return { routes, requireAppAuth, resourceGuards };
}

async function call(ctx: ReturnType<typeof setup>, body: unknown): Promise<FakeRes> {
  return callRoute(ctx, "POST", CRM_REPORTS_OPERATIONAL_PATH, { body });
}

async function callRoute(
  ctx: ReturnType<typeof setup>,
  method: string,
  path: string,
  req: Record<string, unknown>
): Promise<FakeRes> {
  const route = ctx.routes.find((r) => r.method === method && r.path === path);
  assert.ok(route, `rota não registrada: ${method} ${path}`);
  const res = createRes();
  await route!.handlers[route!.handlers.length - 1]!({ query: {}, body: {}, ...req }, res);
  return res;
}

describe("POST /api/crm/reports/operational — registro e guardas", () => {
  it("registra o POST operacional com sessão + recurso oficial da aba Relatórios (view)", () => {
    const ctx = setup();
    const route = ctx.routes.find((r) => r.path === CRM_REPORTS_OPERATIONAL_PATH)!;
    assert.ok(route);
    assert.equal(route.method, "POST");
    assert.equal(CRM_REPORTS_OPERATIONAL_PATH, "/api/crm/reports/operational");
    assert.equal(route.handlers[0], ctx.requireAppAuth);
    const guard = ctx.resourceGuards.find((g) => g.guard === route.handlers[1]);
    assert.deepEqual(
      guard && { key: guard.key, action: guard.action },
      { key: "commercial.crm.reports", action: "view" }
    );
  });

  it("todas as rotas da aba exigem sessão + commercial.crm.reports:view", () => {
    const ctx = setup();
    assert.ok(ctx.routes.length >= 3);
    for (const route of ctx.routes) {
      assert.equal(route.handlers[0], ctx.requireAppAuth, route.path);
      const guard = ctx.resourceGuards.find((g) => g.guard === route.handlers[1]);
      assert.deepEqual(guard && { key: guard.key, action: guard.action }, {
        key: "commercial.crm.reports",
        action: "view",
      }, route.path);
      assert.match(route.path, /^\/api\/crm\/reports\//);
      assert.ok(route.method === "GET" || route.method === "POST", "nenhuma rota de escrita");
    }
  });

  it("consta na matriz de acesso comercial (todas as rotas da aba)", () => {
    const ctx = setup();
    assert.deepEqual(
      ctx.routes.map((r) => `${r.method} ${r.path}`).sort(),
      [
        "GET /api/crm/reports/customer-options",
        "GET /api/crm/reports/filter-options",
        "POST /api/crm/reports/custom",
        "POST /api/crm/reports/custom/export",
        "POST /api/crm/reports/operational",
        "POST /api/crm/reports/operational/export",
      ]
    );
    for (const route of ctx.routes) {
      assert.ok(
        COMMERCIAL_PILOT_ENDPOINTS.some(
          (e) =>
            e.method === route.method &&
            e.path === route.path &&
            e.resourceKey === "commercial.crm.reports" &&
            e.action === "view"
        ),
        `${route.method} ${route.path}`
      );
    }
  });

  it("server.ts registra a rota com os guardas do app", () => {
    const server = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    const start = server.indexOf("registerCrmReportsRoutes(app, {");
    assert.ok(start >= 0, "registerCrmReportsRoutes não está ligado no server.ts");
    const block = server.slice(start, start + 200);
    for (const dep of ["requireAppAuth", "requireResource", "getCurrentAppUser", "prisma"]) {
      assert.match(block, new RegExp(`\\b${dep}\\b`));
    }
  });
});

describe("POST /api/crm/reports/operational — respostas", () => {
  it("401 sem usuário", async () => {
    const res = await call(setup({ user: null }), {});
    assert.equal(res.statusCode, 401);
  });

  it("403 para escopo comercial none (sem carteira nem permissão)", async () => {
    const res = await call(setup({ user: mockAuth("VIEWER", ["crm.view"]) }), {});
    assert.equal(res.statusCode, 403);
    assert.equal((res.body as { error: string }).error, "FORBIDDEN");
  });

  it("400 quando o filtro é inválido (nunca ignora em silêncio)", async () => {
    const res = await call(setup(), { filters: { customerSelection: { mode: "TALVEZ", customerIds: [] } } });
    assert.equal(res.statusCode, 400);
    assert.equal((res.body as { error: string }).error, "VALIDATION");
    assert.ok(Array.isArray((res.body as { details: string[] }).details));
  });

  it("200 com o contrato do relatório", async () => {
    const res = await call(setup(), {});
    assert.equal(res.statusCode, 200);
    const body = res.body as CrmReportsOperationalResponse;
    assert.equal(body.sourceInfo.orderSource, "SalesOrder");
    assert.equal(body.sourceInfo.truncated, false);
    assert.equal(body.universe.analyzedCustomers, 1);
    assert.equal(body.indicators.customersPurchased60d, 1);
    assert.equal(body.indicators.insufficientCadence, 1);
    assert.equal(body.recent60d.total, 1);
    assert.equal(body.repurchaseCadence.total, 1);
    assert.equal(body.overdueRepurchase.total, 0);
    assert.equal(body.windows.today, "2026-09-11");
  });

  it("422 explícito quando o universo passa do teto de carga (nunca trunca)", async () => {
    const ds = tinyDataSource({
      findSalesOrders: async () => {
        throw new CrmReportsCapacityError(400_001, 400_000);
      },
    });
    const res = await call(setup({ dataSource: ds }), {});
    assert.equal(res.statusCode, 422);
    assert.equal((res.body as { error: string }).error, "REPORT_UNIVERSE_TOO_LARGE");
  });

  it("GET filter-options devolve metadados agregados (sem lista de clientes)", async () => {
    const res = await callRoute(setup(), "GET", "/api/crm/reports/filter-options", {});
    assert.equal(res.statusCode, 200);
    const body = res.body as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), [
      "cities",
      "commercialOwnerFilterEnabled",
      "commercialOwners",
      "lastOrderSellers",
      "scope",
      "states",
    ]);
  });

  it("GET customer-options: 400 para termo curto; 200 com busca válida; 403 sem escopo", async () => {
    const short = await callRoute(setup(), "GET", "/api/crm/reports/customer-options", { query: { q: "a" } });
    assert.equal(short.statusCode, 400);
    const ok = await callRoute(setup(), "GET", "/api/crm/reports/customer-options", { query: { q: "Alfa" } });
    assert.equal(ok.statusCode, 200);
    assert.equal((ok.body as { options: unknown[] }).options.length, 1);
    const denied = await callRoute(
      setup({ user: mockAuth("VIEWER", ["crm.view"]) }),
      "GET",
      "/api/crm/reports/customer-options",
      { query: { q: "Alfa" } }
    );
    assert.equal(denied.statusCode, 403);
  });

  it("POST custom: 400 sem dimensão/métrica ou com combinação insegura; 200 com o contrato", async () => {
    const empty = await callRoute(setup(), "POST", CRM_REPORTS_CUSTOM_PATH, { body: {} });
    assert.equal(empty.statusCode, 400);
    assert.equal((empty.body as { error: string }).error, "VALIDATION");
    const unsafe = await callRoute(setup(), "POST", CRM_REPORTS_CUSTOM_PATH, {
      body: { dimensions: ["month"], metrics: ["lastPurchaseDate"] },
    });
    assert.equal(unsafe.statusCode, 400);
    assert.match((unsafe.body as { message: string }).message, /Última compra/);

    const ok = await callRoute(setup(), "POST", CRM_REPORTS_CUSTOM_PATH, {
      body: { dimensions: ["customer"], metrics: ["soldValue", "orders"] },
    });
    assert.equal(ok.statusCode, 200);
    const body = ok.body as CrmCustomReportResponse;
    assert.deepEqual(body.columns.map((c) => c.key), ["customer", "soldValue", "orders"]);
    assert.equal(body.total, 1);
    assert.deepEqual(body.totals, { soldValue: 100, orders: 1 });
    assert.equal(body.universe.analyzedCustomers, 1);
    assert.equal(body.sourceInfo.orderSource, "SalesOrder");
  });

  it("POST custom: 422 explícito quando o relatório passa do teto de linhas", async () => {
    const ds = tinyDataSource({
      findSalesOrders: async () => {
        throw new CrmCustomReportTooLargeError(50_000);
      },
    });
    const res = await callRoute(setup({ dataSource: ds }), "POST", CRM_REPORTS_CUSTOM_PATH, {
      body: { dimensions: ["customer"], metrics: ["soldValue"] },
    });
    assert.equal(res.statusCode, 422);
    assert.equal((res.body as { error: string }).error, "REPORT_TOO_LARGE");
  });

  it("POST operational/export: 400 para lista/formato inválidos; 200 com anexo XLSX", async () => {
    const badList = await callRoute(setup(), "POST", CRM_REPORTS_OPERATIONAL_EXPORT_PATH, {
      body: { list: "todas", format: "csv" },
    });
    assert.equal(badList.statusCode, 400);
    const badFormat = await callRoute(setup(), "POST", CRM_REPORTS_OPERATIONAL_EXPORT_PATH, {
      body: { list: "recent", format: "pdf" },
    });
    assert.equal(badFormat.statusCode, 400);

    const ok = await callRoute(setup(), "POST", CRM_REPORTS_OPERATIONAL_EXPORT_PATH, {
      body: { list: "recent", format: "xlsx" },
    });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.headers["content-type"], "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    assert.equal(ok.headers["content-disposition"], 'attachment; filename="crm-relatorio-compraram-60d-20260911-1000.xlsx"');
    assert.equal(ok.headers["cache-control"], "no-store");
    assert.equal(ok.headers["x-export-row-count"], "1");
    assert.ok(Buffer.isBuffer(ok.body));
  });

  it("POST custom/export: 400 formato inválido; 200 CSV com metadados", async () => {
    const bad = await callRoute(setup(), "POST", CRM_REPORTS_CUSTOM_EXPORT_PATH, {
      body: { format: "json", dimensions: ["customer"], metrics: ["soldValue"] },
    });
    assert.equal(bad.statusCode, 400);
    const ok = await callRoute(setup(), "POST", CRM_REPORTS_CUSTOM_EXPORT_PATH, {
      body: { format: "csv", dimensions: ["customer"], metrics: ["soldValue"] },
    });
    assert.equal(ok.statusCode, 200);
    assert.equal(ok.headers["content-type"], "text/csv; charset=utf-8");
    assert.match(ok.headers["content-disposition"]!, /crm-relatorio-personalizado-20260911-1000\.csv/);
    assert.match(String(ok.body), /# Usuário: Test User <test@example\.com>/);
  });

  it("500 em erro inesperado, sem vazar detalhe interno", async () => {
    const ds = tinyDataSource({
      findCustomers: async () => {
        throw new Error("connection refused: senha=abc");
      },
    });
    const original = console.error;
    console.error = () => undefined;
    try {
      const res = await call(setup({ dataSource: ds }), {});
      assert.equal(res.statusCode, 500);
      assert.ok(!JSON.stringify(res.body).includes("senha"));
    } finally {
      console.error = original;
    }
  });
});
