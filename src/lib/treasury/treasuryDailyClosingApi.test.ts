import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { createTreasuryDailyClosingControllers } from "./controllers/treasuryDailyClosingController.js";
import { TREASURY_DAILY_CLOSING_PATH } from "./contracts/treasuryContracts.js";
import {
  parseTreasuryDailyClosingCloseInput,
  parseTreasuryDailyClosingReopenInput,
} from "./contracts/treasurySchemas.js";
import type { TreasuryDailyClosingDto } from "./contracts/treasuryDto.js";
import { TreasuryDomainError } from "./domain/treasuryErrors.js";
import type { TreasuryDailyClosingService } from "./services/treasuryDailyClosingService.server.js";

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
    permissions: [
      "finance.treasury.closing.view",
      "finance.treasury.closing.close",
      "finance.treasury.closing.reopen",
    ],
    effectivePermissions: [
      "finance.treasury.closing.view",
      "finance.treasury.closing.close",
      "finance.treasury.closing.reopen",
    ],
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

const sampleClosing: TreasuryDailyClosingDto = {
  id: "c1",
  companyCode: "EMP1",
  civilDate: "2026-08-17",
  status: "CLOSED",
  version: 1,
  sourceHash: "a".repeat(64),
  contentHash: "b".repeat(64),
  openingBalance: "100.00",
  realizedInflows: "0.00",
  realizedOutflows: "0.00",
  pendenciesAmount: "0.00",
  closingBalance: "100.00",
  observedBalance: "100.00",
  reconciledBalance: "100.00",
  differenceAmount: "0.00",
  exceptionsCount: 0,
  exceptionsAmount: "0.00",
  caveatsCount: 0,
  previousClosingId: null,
  supersededByClosingId: null,
  closedByUserId: "user-admin",
  closedAt: "2026-08-17T18:00:00.000-03:00",
  createdByUserId: "user-admin",
  createdAt: "2026-08-17T18:00:00.000-03:00",
};

describe("treasuryDailyClosingApi — wiring", () => {
  it("registra GET/POST closing e reopen com flag/ACL", () => {
    const routes = readFileSync(join(here, "treasuryRoutes.ts"), "utf8");
    assert.equal(
      TREASURY_DAILY_CLOSING_PATH,
      "/api/finance/treasury/daily-closing"
    );
    assert.match(routes, /TREASURY_DAILY_CLOSING_PATH/);
    assert.match(routes, /dailyClosing\.close/);
    assert.match(routes, /dailyClosing\.reopen/);
    assert.match(routes, /dailyClosing\.list/);
    assert.match(routes, /closeDay/);
    assert.match(routes, /reopenDay/);
    assert.match(routes, /treasury\.dailyClosing\.enabled/);
  });

  it("parseia close/reopen", () => {
    const close = parseTreasuryDailyClosingCloseInput({
      companyCode: "EMP1",
      date: "2026-08-17",
      sourceHash: "a".repeat(64),
      caveats: [{ code: "STALE_BALANCE", message: "ok" }],
    });
    assert.equal(close.companyCode, "EMP1");
    assert.equal(close.caveats.length, 1);
    const reopen = parseTreasuryDailyClosingReopenInput({
      reason: "Ajuste",
    });
    assert.equal(reopen.reason, "Ajuste");
  });
});

describe("treasuryDailyClosingApi — handlers", () => {
  it("POST fecha 201; GET lista; reopen; 403 permissão; 409 conflito", async () => {
    const service: TreasuryDailyClosingService = {
      async list() {
        return {
          items: [sampleClosing],
          pagination: { page: 1, pageSize: 50, totalRows: 1, totalPages: 1 },
        };
      },
      async getById() {
        return {
          ...sampleClosing,
          accountPositions: [],
          caveats: [],
          reopening: null,
        };
      },
      async close(actor) {
        if (!actor.canCloseDay && !actor.isSuperAdmin) {
          throw new TreasuryDomainError("FORBIDDEN", "negado");
        }
        return {
          closing: sampleClosing,
          projectionRecalc: {
            accepted: true,
            deferred: true,
            reason: "ok",
          },
        };
      },
      async reopen(actor) {
        if (!actor.canReopenDay && !actor.isSuperAdmin) {
          throw new TreasuryDomainError("FORBIDDEN", "negado");
        }
        return {
          previous: { ...sampleClosing, status: "REOPENED" },
          next: {
            ...sampleClosing,
            id: "c2",
            status: "OPEN",
            version: 2,
            previousClosingId: "c1",
          },
          projectionRecalc: {
            accepted: true,
            deferred: true,
            reason: "ok",
          },
        };
      },
    };

    const ok = createTreasuryDailyClosingControllers({
      getCurrentAppUser: async () => baseUser(),
      service,
    });

    const resClose = createMockRes();
    await ok.close(
      {
        body: {
          companyCode: "EMP1",
          date: "2026-08-17",
          sourceHash: "a".repeat(64),
          caveats: [],
        },
        query: {},
        headers: {},
        header: () => undefined,
      } as unknown as Request,
      resClose as unknown as Response
    );
    assert.equal(resClose.statusCode, 201);

    const resList = createMockRes();
    await ok.list(
      {
        query: {},
        headers: {},
        header: () => undefined,
      } as unknown as Request,
      resList as unknown as Response
    );
    assert.equal(resList.statusCode, 200);

    const resReopen = createMockRes();
    await ok.reopen(
      {
        params: { id: "c1" },
        body: { reason: "ajuste" },
        query: {},
        headers: {},
        header: () => undefined,
      } as unknown as Request,
      resReopen as unknown as Response
    );
    assert.equal(resReopen.statusCode, 200);

    const denied = createTreasuryDailyClosingControllers({
      getCurrentAppUser: async () =>
        baseUser({
          role: "USER",
          permissions: [],
          effectivePermissions: [],
        }),
      service,
    });
    const res403 = createMockRes();
    await denied.close(
      {
        body: {
          companyCode: "EMP1",
          date: "2026-08-17",
          sourceHash: "a".repeat(64),
          caveats: [],
        },
        query: {},
        headers: {},
        header: () => undefined,
      } as unknown as Request,
      res403 as unknown as Response
    );
    assert.equal(res403.statusCode, 403);

    const conflictSvc: TreasuryDailyClosingService = {
      ...service,
      async close() {
        throw new TreasuryDomainError(
          "CONFLICT",
          "Hash divergente",
          "sourceHash"
        );
      },
    };
    const conflict = createTreasuryDailyClosingControllers({
      getCurrentAppUser: async () => baseUser(),
      service: conflictSvc,
    });
    const res409 = createMockRes();
    await conflict.close(
      {
        body: {
          companyCode: "EMP1",
          date: "2026-08-17",
          sourceHash: "a".repeat(64),
          caveats: [],
        },
        query: {},
        headers: {},
        header: () => undefined,
      } as unknown as Request,
      res409 as unknown as Response
    );
    assert.equal(res409.statusCode, 409);
  });
});
