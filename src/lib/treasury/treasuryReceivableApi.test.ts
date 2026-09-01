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
import type { TreasuryReceivableExpectationService } from "./services/treasuryReceivableExpectationService.server.js";
import type { TreasuryCustomerFinancialSummaryService } from "./services/treasuryCustomerFinancialSummaryService.server.js";
import type {
  TreasuryCustomerFinancialSummaryDto,
  TreasuryReceivableListItemDto,
} from "./contracts/treasuryReceivableContracts.js";

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
    mustChangePassword: false,
    passwordChangedAt: null,
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
  it("registra GET /receivables, /:titleId, customer-summary e PUT expectation", () => {
    const routes = readFileSync(join(here, "treasuryRoutes.ts"), "utf8");
    assert.equal(TREASURY_RECEIVABLES_PATH, "/api/finance/treasury/receivables");
    assert.match(routes, /TREASURY_RECEIVABLES_PATH/);
    assert.match(routes, /listReceivables/);
    assert.match(routes, /getReceivable/);
    assert.match(routes, /getCustomerSummary/);
    assert.match(routes, /customer-summary/);
    assert.match(routes, /putExpectation/);
    assert.match(routes, /\/expectation/);
    assert.match(routes, /manageReceivables/);
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
          summary: { titleCount: 1, openAmountTotal: "40.00" },
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

  it("PUT expectation — 200, 409 conflito e 403 permissão", async () => {
    const expectationService: TreasuryReceivableExpectationService = {
      async putExpectation(actor, titleId, input) {
        if (!actor.canManageReceivables && !actor.isSuperAdmin) {
          throw new TreasuryDomainError(
            "FORBIDDEN",
            "Sem permissão para alterar expectativa operacional de contas a receber."
          );
        }
        if (input.expectedVersion !== 1) {
          throw new TreasuryDomainError(
            "CONFLICT",
            "Versão do complemento desatualizada.",
            "expectedVersion"
          );
        }
        return {
          receivable: {
            ...sampleRow,
            titleId,
            complement: {
              id: "c1",
              expectedDate: input.expectedDate ?? null,
              confirmedDate: null,
              scheduledDate: null,
              expectedAmount: null,
              confirmedAmount: null,
              scheduledAmount: null,
              status: "ACTIVE",
              priority: input.priority ?? "NORMAL",
              plannedAccountId: input.plannedAccountId ?? null,
              responsibleUserId: input.responsibleUserId ?? null,
              nextAction: input.nextAction ?? null,
              reason: input.reason ?? null,
              notes: input.notes ?? null,
              version: 2,
              updatedAt: "2026-07-27T12:00:00.000+00:00",
              cancelledAt: null,
            },
            nextAction: input.nextAction ?? null,
          },
          projectionRecalc: {
            accepted: true,
            deferred: true,
            reason: "queued",
          },
        };
      },
    };

    const ok = createTreasuryReceivableControllers({
      getCurrentAppUser: async () =>
        baseUser({
          role: "SUPER_ADMIN",
          permissions: [
            "finance.treasury.receivables.manage",
            "finance.accounts_receivable.view",
          ],
          effectivePermissions: [
            "finance.treasury.receivables.manage",
            "finance.accounts_receivable.view",
          ],
        }),
      service: {
        async listReceivables() {
          throw new Error("unused");
        },
        async getReceivable() {
          throw new Error("unused");
        },
      },
      expectationService,
    });

    const resOk = createMockRes();
    await ok.putExpectation(
      {
        params: { titleId: "t1" },
        body: {
          expectedDate: "2026-08-01",
          reason: "acordo",
          expectedVersion: 1,
        },
        headers: {},
        header: () => "req-exp-ok",
      } as unknown as Request,
      resOk as unknown as Response
    );
    assert.equal(resOk.statusCode, 200);
    const okBody = resOk.body as {
      ok: true;
      receivable: TreasuryReceivableListItemDto;
      requestId: string;
    };
    assert.equal(okBody.receivable.complement?.expectedDate, "2026-08-01");
    assert.equal(okBody.receivable.official.dueDate, "2026-07-20");

    const res409 = createMockRes();
    await ok.putExpectation(
      {
        params: { titleId: "t1" },
        body: {
          expectedDate: "2026-08-02",
          reason: "stale",
          expectedVersion: 0,
        },
        headers: {},
        header: () => "req-exp-409",
      } as unknown as Request,
      res409 as unknown as Response
    );
    assert.equal(res409.statusCode, 409);
    assert.equal((res409.body as { code: string }).code, "CONFLICT");

    const forbidden = createTreasuryReceivableControllers({
      getCurrentAppUser: async () =>
        baseUser({
          role: "VIEWER",
          permissions: ["finance.treasury.receivables.view"],
          effectivePermissions: ["finance.treasury.receivables.view"],
        }),
      expectationService,
    });
    const res403 = createMockRes();
    await forbidden.putExpectation(
      {
        params: { titleId: "t1" },
        body: {
          expectedDate: "2026-08-01",
          reason: "x",
          expectedVersion: 1,
        },
        headers: {},
        header: () => "req-exp-403",
      } as unknown as Request,
      res403 as unknown as Response
    );
    assert.equal(res403.statusCode, 403);
    assert.equal((res403.body as { code: string }).code, "FORBIDDEN");
  });

  it("GET customer-summary retorna DTO e propaga 403", async () => {
    const sampleSummary: TreasuryCustomerFinancialSummaryDto = {
      titleId: "t1",
      personId: 10,
      personName: "Cliente",
      personTaxId: "123",
      openAmountTotal: "100.00",
      overdueAmountTotal: "40.00",
      upcomingAmountTotal: "60.00",
      openTitleCount: 2,
      overdueTitleCount: 1,
      upcomingTitleCount: 1,
      averageDaysOverdue: 7,
      maxDaysOverdue: 7,
      activePromiseCount: 1,
      expiredPromiseCount: 0,
      promiseFulfillmentRate: "1.0000",
      recentReceipts: [],
      collectionHistory: [],
      sellerName: "Vendedor",
      commercialOwnerName: "Comercial",
      collectionOwnerUserId: "c1",
    };

    const customerSummaryService: TreasuryCustomerFinancialSummaryService = {
      async getByReceivableTitleId(actor) {
        if (!actor.canViewReceivables && !actor.isSuperAdmin) {
          throw new TreasuryDomainError(
            "FORBIDDEN",
            "Sem permissão para consultar o resumo financeiro do cliente."
          );
        }
        return sampleSummary;
      },
    };

    const ok = createTreasuryReceivableControllers({
      getCurrentAppUser: async () =>
        baseUser({
          role: "SUPER_ADMIN",
          permissions: [
            "finance.treasury.receivables.view",
            "finance.accounts_receivable.view",
          ],
          effectivePermissions: [
            "finance.treasury.receivables.view",
            "finance.accounts_receivable.view",
          ],
        }),
      service: {
        async listReceivables() {
          throw new Error("unused");
        },
        async getReceivable() {
          throw new Error("unused");
        },
      },
      customerSummaryService,
    });

    const resOk = createMockRes();
    await ok.getCustomerSummary(
      {
        params: { titleId: "t1" },
        headers: {},
        header: () => "req-summary",
      } as unknown as Request,
      resOk as unknown as Response
    );
    assert.equal(resOk.statusCode, 200);
    const body = resOk.body as {
      ok: true;
      summary: TreasuryCustomerFinancialSummaryDto;
    };
    assert.equal(body.summary.openAmountTotal, "100.00");
    assert.equal(body.summary.sellerName, "Vendedor");
    assert.equal(body.summary.commercialOwnerName, "Comercial");
    assert.notEqual(body.summary.sellerName, body.summary.commercialOwnerName);

    const forbidden = createTreasuryReceivableControllers({
      getCurrentAppUser: async () =>
        baseUser({
          role: "VIEWER",
          permissions: [],
          effectivePermissions: [],
        }),
      customerSummaryService,
    });
    const res403 = createMockRes();
    await forbidden.getCustomerSummary(
      {
        params: { titleId: "t1" },
        headers: {},
        header: () => "req-summary-403",
      } as unknown as Request,
      res403 as unknown as Response
    );
    assert.equal(res403.statusCode, 403);
  });
});
