import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { createTreasuryReceivableControllers } from "./controllers/treasuryReceivableController.js";
import { TREASURY_RECEIVABLES_PATH } from "./contracts/treasuryContracts.js";
import { TreasuryDomainError } from "./domain/treasuryErrors.js";
import type { TreasuryReceivableQueryService } from "./services/treasuryReceivableQueryService.server.js";
import type { TreasuryReceivableListItemDto } from "./contracts/treasuryReceivableContracts.js";

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
      "finance.treasury.receivables.view",
      "finance.accounts_receivable.view",
    ],
    effectivePermissions: [
      "finance.treasury.receivables.view",
      "finance.accounts_receivable.view",
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

const sampleRow: TreasuryReceivableListItemDto = {
  titleId: "t1",
  externalId: 1,
  official: {
    id: "t1",
    externalId: 1,
    installmentNumber: null,
    installmentLabel: null,
    counterparty: {
      personId: 1,
      name: "Cliente",
      taxId: "123",
      role: "CUSTOMER",
    },
    description: "NF",
    documentNumber: null,
    salesOrderExternalId: null,
    salesOrderCode: null,
    invoice: { externalId: 1, number: "1" },
    issuedOn: "2026-06-01",
    dueDate: "2026-07-20",
    originalAmount: "100.00",
    openBalance: "40.00",
    settlements: {
      settledAmount: "60.00",
      settledAt: "2026-07-15",
      paidAt: null,
    },
    cancellation: {
      isCancelledOrRemovedFromSource: false,
      sourcePresenceStatus: "PRESENT",
      sourceRemovedAt: null,
    },
    officialStatus: {
      nomusStatus: false,
      isOpen: true,
      isSettled: false,
      sourcePresenceStatus: "PRESENT",
    },
    lastSyncedAt: "2026-07-20T12:00:00.000+00:00",
  },
  complement: null,
  sellerName: null,
  commercialOwnerName: null,
  openAmount: "40.00",
  receivedAmount: "60.00",
  daysOverdue: 7,
  operationalStatus: "OVERDUE",
  lastAction: null,
  nextAction: null,
};

describe("treasuryReceivableApi — wiring", () => {
  it("registra GET /receivables e /:titleId com auth/flag/permissões", () => {
    const routes = readFileSync(join(here, "treasuryRoutes.ts"), "utf8");
    assert.equal(TREASURY_RECEIVABLES_PATH, "/api/finance/treasury/receivables");
    assert.match(routes, /TREASURY_RECEIVABLES_PATH/);
    assert.match(routes, /listReceivables/);
    assert.match(routes, /getReceivable/);
    assert.match(routes, /TREASURY_RESOURCE_KEYS\.receivables/);
    assert.match(routes, /FINANCE_MODULE_RESOURCE_KEYS\.accountsReceivable/);
    assert.match(routes, /createTreasuryReceivableControllers/);
  });
});

describe("treasuryReceivableApi — handlers", () => {
  it("lista e detalha com requestId; 401 sem auth; 404 not found", async () => {
    const service: TreasuryReceivableQueryService = {
      async listReceivables() {
        return {
          ok: true,
          rows: [sampleRow],
          pagination: {
            page: 1,
            pageSize: 50,
            totalRows: 1,
            totalPages: 1,
          },
          sortBy: "dueDate",
          sortDirection: "asc",
        };
      },
      async getReceivable(_actor, titleId) {
        if (titleId !== "t1") {
          throw new TreasuryDomainError("NOT_FOUND", "missing", "titleId");
        }
        return sampleRow;
      },
    };
    const controllers = createTreasuryReceivableControllers({
      getCurrentAppUser: async () => baseUser(),
      service,
    });

    const listRes = createMockRes();
    await controllers.listReceivables(
      { query: {}, headers: {}, header: () => undefined } as unknown as Request,
      listRes as unknown as Response
    );
    assert.equal(listRes.statusCode, 200);
    const listBody = listRes.body as {
      ok: true;
      rows: TreasuryReceivableListItemDto[];
      requestId: string;
    };
    assert.equal(listBody.ok, true);
    assert.equal(listBody.rows[0]?.openAmount, "40.00");
    assert.ok(listBody.requestId);

    const getRes = createMockRes();
    await controllers.getReceivable(
      {
        params: { titleId: "t1" },
        query: {},
        headers: {},
        header: () => undefined,
      } as unknown as Request,
      getRes as unknown as Response
    );
    assert.equal(getRes.statusCode, 200);

    const unauth = createTreasuryReceivableControllers({
      getCurrentAppUser: async () => null,
      service,
    });
    const unauthRes = createMockRes();
    await unauth.listReceivables(
      { query: {}, headers: {}, header: () => undefined } as unknown as Request,
      unauthRes as unknown as Response
    );
    assert.equal(unauthRes.statusCode, 401);

    const missingRes = createMockRes();
    await controllers.getReceivable(
      {
        params: { titleId: "x" },
        query: {},
        headers: {},
        header: () => undefined,
      } as unknown as Request,
      missingRes as unknown as Response
    );
    assert.equal(missingRes.statusCode, 404);
  });
});
