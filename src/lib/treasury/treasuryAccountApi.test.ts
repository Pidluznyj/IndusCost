import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { createTreasuryAccountControllers } from "./controllers/treasuryAccountController.js";
import { TREASURY_ACCOUNTS_PATH } from "./contracts/treasuryContracts.js";
import { TreasuryDomainError } from "./domain/treasuryErrors.js";
import type { TreasuryAccountService } from "./services/treasuryAccountService.server.js";

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
      "finance.treasury.accounts.manage",
    ],
    effectivePermissions: [
      "finance.treasury.accounts.view",
      "finance.treasury.accounts.manage",
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

function mockService(
  impl: Partial<TreasuryAccountService>
): TreasuryAccountService {
  return impl as TreasuryAccountService;
}

describe("treasuryAccountApi — wiring", () => {
  it("registra endpoints canônicos com auth/flag/permissão", () => {
    const routes = readFileSync(join(here, "treasuryRoutes.ts"), "utf8");
    const server = readFileSync(join(repoRoot, "server.ts"), "utf8");
    assert.match(server, /registerTreasuryRoutes/);
    assert.match(server, /getCurrentAppUser/);
    assert.equal(TREASURY_ACCOUNTS_PATH, "/api/finance/treasury/accounts");
    for (const path of [
      "TREASURY_ACCOUNTS_PATH",
      "listAccounts",
      "getAccount",
      "createAccount",
      "updateAccount",
      "deactivateAccount",
      "reactivateAccount",
      "listAccountAccess",
      "putAccountAccess",
    ]) {
      assert.match(routes, new RegExp(path));
    }
    assert.match(routes, /requireAppAuth/);
    assert.match(routes, /requireTreasuryModuleEnabled/);
    assert.match(routes, /TREASURY_RESOURCE_KEYS\.accounts/);
    assert.match(routes, /TREASURY_ACTIONS\.view/);
    assert.match(routes, /TREASURY_ACTIONS\.manage/);
    assert.match(routes, /:id\/deactivate/);
    assert.match(routes, /:id\/reactivate/);
    assert.match(routes, /:id\/access/);
    assert.doesNotMatch(routes, /prisma\./);
    assert.doesNotMatch(routes, /@prisma\/client/);
  });
});

describe("treasuryAccountApi — handlers", () => {
  it("GET /accounts retorna DTO paginado com requestId", async () => {
    const res = createMockRes();
    const controllers = createTreasuryAccountControllers({
      getCurrentAppUser: async () => baseUser(),
      service: mockService({
        async listAccessibleAccounts() {
          return {
            ok: true,
            rows: [
              {
                id: "acc-1",
                companyCode: "LAZARIOS",
                companyName: null,
                code: "CX01",
                name: "Caixa",
                institutionName: "Banco",
                institutionCode: null,
                accountType: "CASH",
                currency: "BRL",
                agencyMasked: "****1",
                accountNumberMasked: "****9",
                includeInConsolidated: true,
                minimumBalance: "0.00",
                allowNegativeBalance: false,
                liquidity: "IMMEDIATE",
                defaultBalanceOrigin: "MANUAL",
                sortOrder: 0,
                nomusBankAccountId: null,
                isActive: true,
                createdByUserId: "user-admin",
                createdAt: "2026-07-27T12:00:00.000+00:00",
                updatedAt: "2026-07-27T12:00:00.000+00:00",
                deactivatedAt: null,
                deactivatedByUserId: null,
                deactivationReason: null,
              },
            ],
            pagination: {
              page: 1,
              pageSize: 50,
              totalRows: 1,
              totalPages: 1,
            },
            sortBy: "sortOrder",
            sortDirection: "asc",
          };
        },
      }),
    });

    await controllers.listAccounts(
      {
        query: {},
        header: () => "req-list-1",
      } as unknown as Request,
      res as unknown as Response
    );

    assert.equal(res.statusCode, 200);
    const body = res.body as {
      ok: true;
      rows: unknown[];
      requestId: string;
      pagination: { totalRows: number };
    };
    assert.equal(body.ok, true);
    assert.equal(body.rows.length, 1);
    assert.equal(body.requestId, "req-list-1");
    assert.equal(body.pagination.totalRows, 1);
    assert.equal(res.headers["x-request-id"], "req-list-1");
    assert.doesNotMatch(JSON.stringify(body), /Prisma|Decimal/);
  });

  it("nega acesso não autenticado", async () => {
    const res = createMockRes();
    const controllers = createTreasuryAccountControllers({
      getCurrentAppUser: async () => null,
      service: mockService({}),
    });
    await controllers.getAccount(
      {
        params: { id: "acc-1" },
        header: () => "req-unauth",
      } as unknown as Request,
      res as unknown as Response
    );
    assert.equal(res.statusCode, 401);
    const body = res.body as { code: string; requestId: string };
    assert.equal(body.code, "UNAUTHORIZED");
    assert.equal(body.requestId, "req-unauth");
  });

  it("nega consulta de conta sem autorização (FORBIDDEN)", async () => {
    const res = createMockRes();
    const controllers = createTreasuryAccountControllers({
      getCurrentAppUser: async () =>
        baseUser({
          id: "viewer-1",
          role: "VIEWER",
          permissions: ["finance.treasury.accounts.view"],
          effectivePermissions: ["finance.treasury.accounts.view"],
        }),
      service: mockService({
        async getAccount() {
          throw new TreasuryDomainError(
            "FORBIDDEN",
            "Conta financeira não autorizada para este usuário."
          );
        },
      }),
    });
    await controllers.getAccount(
      {
        params: { id: "acc-secret" },
        header: () => "req-forbidden",
      } as unknown as Request,
      res as unknown as Response
    );
    assert.equal(res.statusCode, 403);
    const body = res.body as { code: string; error: string; requestId: string };
    assert.equal(body.code, "FORBIDDEN");
    assert.match(body.error, /não autorizada/i);
    assert.equal(body.requestId, "req-forbidden");
  });

  it("POST cria conta e retorna 201 com DTO", async () => {
    const res = createMockRes();
    const controllers = createTreasuryAccountControllers({
      getCurrentAppUser: async () => baseUser(),
      service: mockService({
        async createAccount(_actor, cmd) {
          return {
            id: "acc-new",
            companyCode: cmd.companyCode,
            companyName: null,
            code: cmd.code,
            name: cmd.name,
            institutionName: cmd.institutionName,
            institutionCode: null,
            accountType: cmd.accountType,
            currency: "BRL",
            agencyMasked: cmd.agencyMasked,
            accountNumberMasked: cmd.accountNumberMasked,
            includeInConsolidated: true,
            minimumBalance: "0.00",
            allowNegativeBalance: false,
            liquidity: "IMMEDIATE",
            defaultBalanceOrigin: "MANUAL",
            sortOrder: 0,
            nomusBankAccountId: null,
            isActive: true,
            createdByUserId: "user-admin",
            createdAt: "2026-07-27T12:00:00.000+00:00",
            updatedAt: "2026-07-27T12:00:00.000+00:00",
            deactivatedAt: null,
            deactivatedByUserId: null,
            deactivationReason: null,
          };
        },
      }),
    });

    await controllers.createAccount(
      {
        body: {
          companyCode: "LAZARIOS",
          code: "CX09",
          name: "Nova",
          institutionName: "Banco",
          accountType: "CHECKING",
          agencyMasked: "****1",
          accountNumberMasked: "****2",
        },
        header: () => "req-create",
      } as unknown as Request,
      res as unknown as Response
    );
    assert.equal(res.statusCode, 201);
    const body = res.body as { ok: true; account: { id: string; code: string } };
    assert.equal(body.account.id, "acc-new");
    assert.equal(body.account.code, "CX09");
  });

  it("PUT access e POST deactivate/reactivate usam erros padronizados", async () => {
    const res = createMockRes();
    const controllers = createTreasuryAccountControllers({
      getCurrentAppUser: async () => baseUser(),
      service: mockService({
        async grantAccountAccess() {
          throw new TreasuryDomainError("NOT_FOUND", "Conta financeira não encontrada.");
        },
        async deactivateAccount() {
          throw new TreasuryDomainError("CONFLICT", "Conta já está desativada.");
        },
      }),
    });

    await controllers.putAccountAccess(
      {
        params: { id: "acc-x" },
        body: { userId: "u-2", accessLevel: "VIEW" },
        header: () => "req-access",
      } as unknown as Request,
      res as unknown as Response
    );
    assert.equal(res.statusCode, 404);
    assert.equal((res.body as { code: string }).code, "NOT_FOUND");

    const res2 = createMockRes();
    await controllers.deactivateAccount(
      {
        params: { id: "acc-x" },
        body: {
          reason: "fim",
          expectedUpdatedAt: "2026-07-27T12:00:00.000+00:00",
        },
        header: () => "req-deact",
      } as unknown as Request,
      res2 as unknown as Response
    );
    assert.equal(res2.statusCode, 409);
    assert.equal((res2.body as { code: string }).code, "CONFLICT");
  });
});
