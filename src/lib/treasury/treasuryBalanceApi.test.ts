import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { createTreasuryBalanceControllers } from "./controllers/treasuryBalanceController.js";
import { TREASURY_ACCOUNTS_PATH } from "./contracts/treasuryContracts.js";
import { TreasuryDomainError } from "./domain/treasuryErrors.js";
import type { TreasuryBalanceService } from "./services/treasuryBalanceService.server.js";
import type { TreasuryBalanceSnapshotDto } from "./contracts/treasuryDto.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../..");

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
    role: "ADMIN",
    permissions: [
      "finance.treasury.accounts.view",
      "finance.treasury.balances.manage",
    ],
    effectivePermissions: [
      "finance.treasury.accounts.view",
      "finance.treasury.balances.manage",
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
    mustChangePassword: false,
    passwordChangedAt: null,
    createdAt: "2026-07-27T00:00:00.000+00:00",
    updatedAt: "2026-07-27T00:00:00.000+00:00",
    sessionId: "sess-1",
    sessionPermissionsVersionAtIssue: 1,
    ...overrides,
  };
}

function sampleSnapshot(
  overrides: Partial<TreasuryBalanceSnapshotDto> = {}
): TreasuryBalanceSnapshotDto {
  return {
    id: "snap-1",
    accountId: "acc-1",
    referenceAt: "2026-07-20T12:00:00.000+00:00",
    civilDate: "2026-07-20",
    availableBalance: "100.00",
    blockedBalance: "10.00",
    investmentsBalance: "5.00",
    usedLimit: "1.00",
    observedBalance: "115.00",
    operationalAvailableBalance: "100.00",
    origin: "MANUAL",
    idempotencyKey: "k1",
    notes: null,
    attachmentUrl: null,
    createdByUserId: "user-admin",
    previousSnapshotId: null,
    createdAt: "2026-07-20T12:01:00.000+00:00",
    cancelledAt: null,
    cancelledByUserId: null,
    cancelReason: null,
    ...overrides,
  };
}

describe("treasuryBalanceApi — wiring", () => {
  it("registra endpoints de saldo com auth/flag/permissão", () => {
    const routes = readFileSync(join(here, "treasuryRoutes.ts"), "utf8");
    assert.equal(TREASURY_ACCOUNTS_PATH, "/api/finance/treasury/accounts");
    assert.match(routes, /:id\/balances\/latest/);
    assert.match(routes, /:id\/balances/);
    assert.match(routes, /:id\/balance-snapshots/);
    assert.match(routes, /TREASURY_RESOURCE_KEYS\.balances/);
    assert.match(routes, /createTreasuryBalanceControllers/);
    assert.doesNotMatch(routes, /@prisma\/client/);
  });
});

describe("treasuryBalanceApi — handlers", () => {
  it("GET balances/latest e list retornam DTO com requestId", async () => {
    const snapshot = sampleSnapshot();
    const controllers = createTreasuryBalanceControllers({
      getCurrentAppUser: async () => baseUser(),
      service: {
        getLatestBalance: async () => snapshot,
        listBalances: async () => ({
          ok: true as const,
          rows: [snapshot],
          pagination: {
            page: 1,
            pageSize: 50,
            totalRows: 1,
            totalPages: 1,
          },
          sortBy: "referenceAt",
          sortDirection: "desc" as const,
        }),
        createBalanceSnapshot: async () => ({
          snapshot,
          created: true,
        }),
      } as unknown as TreasuryBalanceService,
    });

    const latestRes = createMockRes();
    await controllers.getLatestBalance(
      {
        params: { id: "acc-1" },
        headers: {},
        header: () => null,
        query: {},
        body: {},
      } as unknown as Request,
      latestRes as unknown as Response
    );
    assert.equal(latestRes.statusCode, 200);
    const latestBody = latestRes.body as {
      snapshot: TreasuryBalanceSnapshotDto;
      requestId: string;
    };
    assert.equal(latestBody.snapshot.observedBalance, "115.00");
    assert.ok(latestBody.requestId);

    const listRes = createMockRes();
    await controllers.listBalances(
      {
        params: { id: "acc-1" },
        headers: {},
        header: () => null,
        query: {},
        body: {},
      } as unknown as Request,
      listRes as unknown as Response
    );
    assert.equal(listRes.statusCode, 200);
  });

  it("POST balance-snapshots usa Idempotency-Key e retorna 201/200", async () => {
    const snapshot = sampleSnapshot();
    let created = true;
    const controllers = createTreasuryBalanceControllers({
      getCurrentAppUser: async () => baseUser(),
      service: {
        createBalanceSnapshot: async (_actor, _id, cmd) => {
          assert.equal(cmd.idempotencyKey, "idem-99");
          const result = { snapshot, created };
          created = false;
          return result;
        },
      } as unknown as TreasuryBalanceService,
    });

    const reqBase = {
      params: { id: "acc-1" },
      headers: { "idempotency-key": "idem-99" },
      header(name: string) {
        if (name.toLowerCase() === "idempotency-key") return "idem-99";
        return null;
      },
      query: {},
      body: {
        referenceAt: "2026-07-20T12:00:00.000Z",
        availableBalance: "100.00",
        blockedBalance: "10.00",
        investmentsBalance: "5.00",
        usedLimit: "1.00",
      },
    };

    const res1 = createMockRes();
    await controllers.createBalanceSnapshot(
      reqBase as unknown as Request,
      res1 as unknown as Response
    );
    assert.equal(res1.statusCode, 201);
    assert.equal((res1.body as { created: boolean }).created, true);

    const res2 = createMockRes();
    await controllers.createBalanceSnapshot(
      reqBase as unknown as Request,
      res2 as unknown as Response
    );
    assert.equal(res2.statusCode, 200);
    assert.equal((res2.body as { created: boolean }).created, false);
  });

  it("nega não autenticado e propaga FORBIDDEN", async () => {
    const controllers = createTreasuryBalanceControllers({
      getCurrentAppUser: async () => null,
      service: {} as TreasuryBalanceService,
    });
    const res = createMockRes();
    await controllers.listBalances(
      {
        params: { id: "acc-1" },
        headers: {},
        header: () => null,
        query: {},
        body: {},
      } as unknown as Request,
      res as unknown as Response
    );
    assert.equal(res.statusCode, 401);

    const forbidden = createTreasuryBalanceControllers({
      getCurrentAppUser: async () => baseUser(),
      service: {
        getLatestBalance: async () => {
          throw new TreasuryDomainError("FORBIDDEN", "Sem permissão");
        },
      } as unknown as TreasuryBalanceService,
    });
    const resF = createMockRes();
    await forbidden.getLatestBalance(
      {
        params: { id: "acc-1" },
        headers: {},
        header: () => null,
        query: {},
        body: {},
      } as unknown as Request,
      resF as unknown as Response
    );
    assert.equal(resF.statusCode, 403);
  });
});
