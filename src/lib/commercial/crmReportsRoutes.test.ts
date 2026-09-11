import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { COMMERCIAL_PILOT_ENDPOINTS } from "@/src/lib/commercialAccess.js";
import { CRM_REPORTS_OPERATIONAL_PATH, registerCrmReportsRoutes } from "./crmReportsRoutes.js";
import {
  CrmReportsCapacityError,
  type CrmReportsDataSource,
} from "./crmReportsOperationalService.server.js";
import type { CrmReportsOperationalResponse } from "./crmReportsTypes.js";

type Handler = (req: unknown, res: FakeRes, next?: () => void) => unknown;
type FakeRes = {
  statusCode: number;
  body: unknown;
  status(code: number): FakeRes;
  json(payload: unknown): FakeRes;
};

function createRes(): FakeRes {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
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
  const route = ctx.routes[0]!;
  const res = createRes();
  await route.handlers[route.handlers.length - 1]!({ body }, res);
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

  it("consta na matriz de acesso comercial", () => {
    assert.ok(
      COMMERCIAL_PILOT_ENDPOINTS.some(
        (e) =>
          e.method === "POST" &&
          e.path === "/api/crm/reports/operational" &&
          e.resourceKey === "commercial.crm.reports" &&
          e.action === "view"
      )
    );
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
