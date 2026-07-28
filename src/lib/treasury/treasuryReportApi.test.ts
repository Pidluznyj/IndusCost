import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { createTreasuryReportControllers } from "./controllers/treasuryReportController.js";
import {
  TREASURY_REPORT_KEYS,
  TREASURY_REPORTS_PATH,
} from "./contracts/treasuryContracts.js";
import { parseTreasuryReportQuery } from "./contracts/treasurySchemas.js";
import type { TreasuryReportDto } from "./contracts/treasuryDto.js";
import { TreasuryDomainError } from "./domain/treasuryErrors.js";
import type { TreasuryReportService } from "./services/treasuryReportService.server.js";

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
    permissions: ["finance.treasury.reports.view"],
    effectivePermissions: ["finance.treasury.reports.view"],
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
    createdAt: "2026-07-27T00:00:00.000+00:00",
    updatedAt: "2026-07-27T00:00:00.000+00:00",
    sessionId: "sess-1",
    sessionPermissionsVersionAtIssue: 1,
    ...overrides,
  };
}

function sampleReport(reportKey: (typeof TREASURY_REPORT_KEYS)[number]): TreasuryReportDto {
  return {
    ok: true,
    reportKey,
    period: { from: "2026-07-01", to: "2026-07-27" },
    accountIds: null,
    authorizedAccountIds: ["acc-1"],
    scenario: "PROBABLE",
    filters: {},
    totals: {
      amount: "10.00",
      count: 1,
      extras: { bucketAmountSum: "10.00", bucketCountSum: 1 },
    },
    composition: [
      {
        key: "total",
        label: "Total",
        amount: "10.00",
        count: 1,
        sharePercent: "100.00",
      },
    ],
    rows: [],
    pagination: null,
  };
}

describe("treasuryReportApi — wiring + schema", () => {
  it("registra GET /reports/:reportKey com auth/flag/permissão reports.view", () => {
    const routes = readFileSync(join(here, "treasuryRoutes.ts"), "utf8");
    assert.equal(TREASURY_REPORTS_PATH, "/api/finance/treasury/reports");
    assert.match(routes, /TREASURY_REPORTS_PATH/);
    assert.match(routes, /getReport/);
    assert.match(routes, /viewReports/);
    assert.match(routes, /TREASURY_RESOURCE_KEYS\.reports/);
    assert.match(routes, /createTreasuryReportControllers/);
  });

  it("parseia período, contas, cenário, paginação e filtros", () => {
    const q = parseTreasuryReportQuery("planned-vs-actual", {
      from: "2026-07-01",
      to: "2026-07-27",
      accountIds: "acc-1,acc-2",
      scenario: "CONFIRMED",
      page: "2",
      pageSize: "25",
      status: null,
    });
    assert.equal(q.reportKey, "planned-vs-actual");
    assert.equal(q.from, "2026-07-01");
    assert.equal(q.to, "2026-07-27");
    assert.deepEqual(q.accountIds, ["acc-1", "acc-2"]);
    assert.equal(q.scenario, "CONFIRMED");
    assert.equal(q.page, 2);
    assert.equal(q.pageSize, 25);
  });

  it("rejeita reportKey desconhecido e período invertido", () => {
    assert.throws(
      () => parseTreasuryReportQuery("unknown-report", {}),
      /reportKey|inválid/i
    );
    assert.throws(
      () =>
        parseTreasuryReportQuery("exceptions", {
          from: "2026-07-27",
          to: "2026-07-01",
        }),
      /Período inválido/
    );
  });

  it("cataloga as 10 chaves de relatório", () => {
    assert.deepEqual(
      [...TREASURY_REPORT_KEYS],
      [
        "daily-position",
        "cash-bridge",
        "planned-vs-actual",
        "delinquency",
        "promises",
        "predictability",
        "position-by-account",
        "exceptions",
        "reconciliations",
        "projection-by-scenario",
      ]
    );
  });
});

describe("treasuryReportApi — handlers", () => {
  it("retorna DTO com requestId; 401 sem auth; 403 sem permissão", async () => {
    const service: TreasuryReportService = {
      async getReport(actor, query) {
        if (!actor.canViewReports && !actor.isSuperAdmin) {
          throw new TreasuryDomainError("FORBIDDEN", "negado");
        }
        return sampleReport(query.reportKey);
      },
    };
    const controllers = createTreasuryReportControllers({
      getCurrentAppUser: async () => baseUser(),
      service,
    });

    const okRes = createMockRes();
    await controllers.getReport(
      {
        params: { reportKey: "exceptions" },
        query: { from: "2026-07-01", to: "2026-07-27" },
        headers: {},
        header: () => undefined,
      } as unknown as Request,
      okRes as unknown as Response
    );
    assert.equal(okRes.statusCode, 200);
    const body = okRes.body as TreasuryReportDto & { requestId: string };
    assert.equal(body.ok, true);
    assert.equal(body.reportKey, "exceptions");
    assert.ok(body.requestId);

    const unauth = createTreasuryReportControllers({
      getCurrentAppUser: async () => null,
      service,
    });
    const unauthRes = createMockRes();
    await unauth.getReport(
      {
        params: { reportKey: "exceptions" },
        query: {},
        headers: {},
        header: () => undefined,
      } as unknown as Request,
      unauthRes as unknown as Response
    );
    assert.equal(unauthRes.statusCode, 401);

    const denied = createTreasuryReportControllers({
      getCurrentAppUser: async () =>
        baseUser({
          role: "VIEWER",
          permissions: [],
          effectivePermissions: [],
        }),
      service: {
        async getReport(actor) {
          if (!actor.canViewReports && !actor.isSuperAdmin) {
            throw new TreasuryDomainError("FORBIDDEN", "negado");
          }
          return sampleReport("exceptions");
        },
      },
    });
    const deniedRes = createMockRes();
    await denied.getReport(
      {
        params: { reportKey: "exceptions" },
        query: { from: "2026-07-01", to: "2026-07-27" },
        headers: {},
        header: () => undefined,
      } as unknown as Request,
      deniedRes as unknown as Response
    );
    assert.equal(deniedRes.statusCode, 403);
  });

  it("serve cada reportKey canônico via service", async () => {
    const seen: string[] = [];
    const service: TreasuryReportService = {
      async getReport(_actor, query) {
        seen.push(query.reportKey);
        return sampleReport(query.reportKey);
      },
    };
    const controllers = createTreasuryReportControllers({
      getCurrentAppUser: async () => baseUser(),
      service,
    });
    for (const key of TREASURY_REPORT_KEYS) {
      const res = createMockRes();
      await controllers.getReport(
        {
          params: { reportKey: key },
          query: { from: "2026-07-01", to: "2026-07-27" },
          headers: {},
          header: () => undefined,
        } as unknown as Request,
        res as unknown as Response
      );
      assert.equal(res.statusCode, 200);
    }
    assert.deepEqual(seen, [...TREASURY_REPORT_KEYS]);
  });
});
