import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { createTreasuryExceptionControllers } from "./controllers/treasuryExceptionController.js";
import { TREASURY_EXCEPTIONS_PATH } from "./contracts/treasuryContracts.js";
import type { TreasuryExceptionDto } from "./contracts/treasuryDto.js";
import type { TreasuryExceptionService } from "./services/treasuryExceptionService.server.js";
import { TreasuryDomainError } from "./domain/treasuryErrors.js";

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
    role: "ADMIN",
    permissions: [
      "finance.treasury.exceptions.view",
      "finance.treasury.exceptions.manage",
    ],
    effectivePermissions: [
      "finance.treasury.exceptions.view",
      "finance.treasury.exceptions.manage",
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

const sample: TreasuryExceptionDto = {
  id: "ex1",
  companyCode: "EMP1",
  uniqueKey: "STALE_BALANCE|EMP1|acc-1",
  type: "STALE_BALANCE",
  severity: "WARNING",
  status: "OPEN",
  entityKind: "ACCOUNT",
  entityId: "acc-1",
  accountId: "acc-1",
  nomusExternalId: null,
  title: "Saldo desatualizado",
  description: null,
  amount: "10.00",
  detectedAt: "2026-08-10T12:00:00.000+00:00",
  dueAt: "2026-08-15",
  responsibleUserId: null,
  resolution: null,
  ignoreJustification: null,
  recurrenceCount: 1,
  metadata: null,
  version: 1,
  createdAt: "2026-08-10T12:00:00.000+00:00",
  createdByUserId: "user-admin",
  updatedAt: "2026-08-10T12:00:00.000+00:00",
  updatedByUserId: "user-admin",
  acknowledgedAt: null,
  resolvedAt: null,
  cancelledAt: null,
  cancelledByUserId: null,
  ageDays: 4,
  recommendedAction: "Atribuir responsável.",
  entityHref: "/finance/treasury/accounts/acc-1/balances",
};

describe("treasuryExceptionApi — wiring", () => {
  it("registra rotas de exceções com flag e ACL", () => {
    const routes = readFileSync(join(here, "treasuryRoutes.ts"), "utf8");
    assert.equal(TREASURY_EXCEPTIONS_PATH, "/api/finance/treasury/exceptions");
    assert.match(routes, /TREASURY_EXCEPTIONS_PATH/);
    assert.match(routes, /createTreasuryExceptionControllers/);
    assert.match(routes, /treasury\.exceptions\.enabled/);
    assert.match(routes, /\/:id\/assign/);
    assert.match(routes, /\/:id\/due-at/);
    assert.match(routes, /\/:id\/resolve/);
    assert.match(routes, /\/:id\/ignore/);
  });
});

describe("treasuryExceptionApi — handlers e permissão", () => {
  it("lista e resolve via controllers", async () => {
    const service = {
      async list() {
        return {
          items: [sample],
          pagination: { page: 1, pageSize: 50, totalRows: 1, totalPages: 1 },
          sortBy: "detectedAt",
          sortDirection: "desc" as const,
        };
      },
      async getById() {
        return sample;
      },
      async resolve() {
        return { ...sample, status: "RESOLVED" as const, version: 2 };
      },
      async ignore() {
        return { ...sample, status: "IGNORED" as const, version: 2 };
      },
      async assign() {
        return {
          ...sample,
          responsibleUserId: "user-r",
          version: 2,
          recommendedAction: "Atualizar saldo da conta.",
        };
      },
      async setDueAt() {
        return { ...sample, dueAt: "2026-08-20", version: 2 };
      },
      async setStatus() {
        return { ...sample, status: "WAITING_THIRD_PARTY" as const, version: 2 };
      },
      async acknowledge() {
        return { ...sample, status: "IN_ANALYSIS" as const, version: 2 };
      },
      async cancel() {
        return { ...sample, status: "CANCELLED" as const, version: 2 };
      },
    } as unknown as TreasuryExceptionService;

    const controllers = createTreasuryExceptionControllers({
      getCurrentAppUser: async () => baseUser(),
      service,
    });

    const listRes = createMockRes();
    await controllers.list(
      {
        query: { sortBy: "severity" },
        params: {},
        body: {},
        headers: {},
        header: () => "req-list",
      } as unknown as Request,
      listRes as unknown as Response
    );
    assert.equal(listRes.statusCode, 200);
    const listBody = listRes.body as { ok: boolean; items: TreasuryExceptionDto[] };
    assert.equal(listBody.ok, true);
    assert.equal(listBody.items[0]?.recommendedAction, "Atribuir responsável.");

    const resolveRes = createMockRes();
    await controllers.resolve(
      {
        query: {},
        params: { id: "ex1" },
        body: { expectedVersion: 1, resolution: "Ok" },
        headers: {},
        header: () => "req-res",
      } as unknown as Request,
      resolveRes as unknown as Response
    );
    assert.equal(resolveRes.statusCode, 200);
    assert.equal(
      (resolveRes.body as { exception: TreasuryExceptionDto }).exception.status,
      "RESOLVED"
    );
  });

  it("propaga FORBIDDEN do serviço (sem manage)", async () => {
    const service = {
      async resolve() {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem permissão para gerenciar exceções."
        );
      },
    } as unknown as TreasuryExceptionService;

    const controllers = createTreasuryExceptionControllers({
      getCurrentAppUser: async () =>
        baseUser({
          permissions: ["finance.treasury.exceptions.view"],
          effectivePermissions: ["finance.treasury.exceptions.view"],
        }),
      service,
    });

    const res = createMockRes();
    await controllers.resolve(
      {
        query: {},
        params: { id: "ex1" },
        body: { expectedVersion: 1, resolution: "x" },
        headers: {},
        header: () => "req-f",
      } as unknown as Request,
      res as unknown as Response
    );
    assert.ok(res.statusCode >= 400);
  });
});
