import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { createTreasuryDashboardControllers } from "./controllers/treasuryDashboardController.js";
import { TREASURY_DASHBOARD_PATH } from "./contracts/treasuryContracts.js";
import { parseTreasuryDashboardQuery } from "./contracts/treasurySchemas.js";
import type { TreasuryDashboardDto } from "./contracts/treasuryDto.js";
import { TreasuryDomainError } from "./domain/treasuryErrors.js";
import type { TreasuryDashboardService } from "./services/treasuryDashboardService.server.js";

const here = dirname(fileURLToPath(import.meta.url));

type MockRes = {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  status: (code: number) => MockRes;
  json: (payload: unknown) => MockRes;
  setHeader: (key: string, value: string) => void;
};

function createMockRes(): MockRes {
  const res: MockRes = {
    statusCode: 200,
    body: null,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = value;
    },
  };
  return res;
}

function baseUser(overrides: Partial<AppAuthContext> = {}): AppAuthContext {
  return {
    id: "user-admin",
    name: "Admin",
    email: "admin@test.local",
    role: "SUPER_ADMIN",
    permissions: ["finance.treasury.dashboard.view"],
    effectivePermissions: ["finance.treasury.dashboard.view"],
    permissionsVersion: 1,
    accessProfileId: null,
    accessProfileName: null,
    employeeId: null,
    employeeName: null,
    employeeDepartment: null,
    isActive: true,
    externalSellerId: null,
    externalSellerIds: [],
    sellerResponsibleName: null,
    lastLoginAt: null,
    mustChangePassword: false,
    passwordChangedAt: null,
    createdAt: "2026-07-27T00:00:00.000+00:00",
    updatedAt: "2026-07-27T00:00:00.000+00:00",
    sessionId: "sess-1",
    sessionPermissionsVersionAtIssue: 1,
    ...overrides,
  };
}

const sampleDashboard: TreasuryDashboardDto = {
  ok: true,
  civilDate: "2026-07-27",
  scenario: "PROBABLE",
  accountIds: null,
  asOf: "2026-07-27T23:59:59.000-03:00",
  freshness: {
    asOf: "2026-07-27T23:59:59.000-03:00",
    sources: [],
    hasStaleSource: false,
    staleSourceCount: 0,
  },
  observedBalance: "100.00",
  calculatedBalance: "100.00",
  reconciledBalance: null,
  divergence: "0.00",
  hasDivergence: false,
  receipts: {
    kind: "RECEIPTS",
    plannedAmount: "10.00",
    plannedTitleCount: 1,
    realizedAmount: "0.00",
    realizedTitleCount: 0,
    pendingAmount: "10.00",
    pendingTitleCount: 1,
  },
  payments: {
    kind: "PAYMENTS",
    plannedAmount: "5.00",
    plannedTitleCount: 1,
    realizedAmount: "0.00",
    realizedTitleCount: 0,
    pendingAmount: "5.00",
    pendingTitleCount: 1,
  },
  currentBalance: "100.00",
  currentBalanceOrigin: "CONSOLIDATED_OBSERVED",
  projectedClosingBalance: "105.00",
  projectedClosingOrigin:
    "CURRENT_PLUS_PLANNED_RECEIPTS_MINUS_PLANNED_PAYMENTS",
  titleCount: {
    receivablesPlanned: 1,
    receivablesRealized: 0,
    receivablesPending: 1,
    payablesPlanned: 1,
    payablesRealized: 0,
    payablesPending: 1,
    totalBucketSum: 2,
    openOnDay: 2,
  },
  accounts: [],
  consolidated: {
    accountCount: 0,
    includedAccountCount: 0,
    excludedAccountCount: 0,
    accountsMissingSnapshot: 0,
    observedBalance: "100.00",
    operationalAvailableBalance: "100.00",
    calculatedBalance: "100.00",
    reconciledBalance: null,
    divergence: "0.00",
    hasDivergence: false,
    blockedBalance: "0.00",
    investmentsBalance: "0.00",
    usedLimit: "0.00",
    alerts: [],
  },
  priorityExceptions: [],
  alerts: [],
  composition: [],
  origins: {},
};

describe("treasuryDashboardApi — wiring + schema", () => {
  it("registra GET /dashboard com auth/flag/permissão dashboard.view", () => {
    const routes = readFileSync(join(here, "treasuryRoutes.ts"), "utf8");
    assert.equal(TREASURY_DASHBOARD_PATH, "/api/finance/treasury/dashboard");
    assert.match(routes, /TREASURY_DASHBOARD_PATH/);
    assert.match(routes, /getDashboard/);
    assert.match(routes, /viewDashboard/);
    assert.match(routes, /TREASURY_RESOURCE_KEYS\.dashboard/);
    assert.match(routes, /createTreasuryDashboardControllers/);
  });

  it("parseia filtros date/accountIds/scenario", () => {
    const q = parseTreasuryDashboardQuery({
      date: "2026-07-27",
      accountIds: "acc-1,acc-2",
      scenario: "CONFIRMED",
    });
    assert.equal(q.date, "2026-07-27");
    assert.deepEqual(q.accountIds, ["acc-1", "acc-2"]);
    assert.equal(q.scenario, "CONFIRMED");
  });
});

describe("treasuryDashboardApi — handlers", () => {
  it("retorna DTO com requestId; 401 sem auth; 403 permissão", async () => {
    const service: TreasuryDashboardService = {
      async getDailyDashboard(actor) {
        if (!actor.canViewDashboard && !actor.positionActor.isSuperAdmin) {
          throw new TreasuryDomainError("FORBIDDEN", "negado");
        }
        return sampleDashboard;
      },
    };
    const controllers = createTreasuryDashboardControllers({
      getCurrentAppUser: async () => baseUser(),
      service,
    });

    const resOk = createMockRes();
    await controllers.getDashboard(
      {
        query: { date: "2026-07-27", scenario: "PROBABLE" },
        headers: {},
        header: () => undefined,
      } as unknown as Request,
      resOk as unknown as Response
    );
    assert.equal(resOk.statusCode, 200);
    const body = resOk.body as TreasuryDashboardDto & { requestId: string };
    assert.equal(body.ok, true);
    assert.equal(body.civilDate, "2026-07-27");
    assert.ok(body.requestId);

    const res401 = createMockRes();
    const controllersUnauth = createTreasuryDashboardControllers({
      getCurrentAppUser: async () => null,
      service,
    });
    await controllersUnauth.getDashboard(
      { query: {}, headers: {}, header: () => undefined } as unknown as Request,
      res401 as unknown as Response
    );
    assert.equal(res401.statusCode, 401);

    const res403 = createMockRes();
    const controllersForbidden = createTreasuryDashboardControllers({
      getCurrentAppUser: async () =>
        baseUser({
          role: "VIEWER",
          permissions: [],
          effectivePermissions: [],
        }),
      service: {
        async getDailyDashboard() {
          throw new TreasuryDomainError("FORBIDDEN", "negado");
        },
      },
    });
    await controllersForbidden.getDashboard(
      {
        query: { date: "2026-07-27" },
        headers: {},
        header: () => undefined,
      } as unknown as Request,
      res403 as unknown as Response
    );
    assert.equal(res403.statusCode, 403);
  });
});
