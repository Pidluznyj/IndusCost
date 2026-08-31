import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { createTreasuryPayableControllers } from "./controllers/treasuryPayableController.js";
import { TREASURY_PAYABLES_PATH } from "./contracts/treasuryContracts.js";
import type { TreasuryPayableListItemDto } from "./contracts/treasuryPayableContracts.js";
import { TreasuryDomainError } from "./domain/treasuryErrors.js";
import type { TreasuryPayableQueryService } from "./services/treasuryPayableQueryService.server.js";
import { parseTreasuryPayablesListQuery } from "./contracts/treasurySchemas.js";

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
      "finance.treasury.payables.view",
      "finance.accounts_payable.view",
    ],
    effectivePermissions: [
      "finance.treasury.payables.view",
      "finance.accounts_payable.view",
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

const sampleRow: TreasuryPayableListItemDto = {
  titleId: "p1",
  externalId: 1,
  official: {
    id: "p1",
    externalId: 1,
    installmentNumber: null,
    installmentLabel: null,
    counterparty: {
      personId: 1,
      name: "Fornecedor",
      taxId: "98765432000155",
      role: "SUPPLIER",
    },
    description: "NF",
    documentNumber: "DOC-1",
    classification: "Material",
    comments: null,
    nomusScheduleDate: null,
    nomusScheduledAmount: null,
    salesOrderExternalId: null,
    salesOrderCode: null,
    invoice: { externalId: 1, number: "1" },
    issuedOn: "2026-06-01",
    dueDate: "2026-07-20",
    originalAmount: "100.00",
    openBalance: "40.00",
    settlements: {
      settledAmount: "60.00",
      settledAt: "2026-07-10",
      paidAt: "2026-07-10",
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
  classification: "Material",
  costCenterId: "cc-1",
  costCenterLabel: "ADM — Administrativo",
  openAmount: "40.00",
  paidAmount: "60.00",
  scheduledDate: "2026-08-01",
  scheduledAmount: "40.00",
  plannedAccountId: "acc-1",
  priority: "NORMAL",
  notes: "Obs",
  daysOverdue: 0,
  operationalStatus: "PROGRAMMED",
  lastAction: null,
  nextAction: null,
};

describe("treasuryPayableApi — wiring + schema", () => {
  it("registra GET /payables e /:titleId com auth/flag/permissões", () => {
    const routes = readFileSync(join(here, "treasuryRoutes.ts"), "utf8");
    assert.equal(TREASURY_PAYABLES_PATH, "/api/finance/treasury/payables");
    assert.match(routes, /TREASURY_PAYABLES_PATH/);
    assert.match(routes, /listPayables/);
    assert.match(routes, /getPayable/);
    assert.match(routes, /viewPayables/);
    assert.match(routes, /FINANCE_AP_RESOURCE_KEY_REF/);
    assert.match(routes, /createTreasuryPayableControllers/);
  });

  it("parseia filtros canônicos de CP", () => {
    const q = parseTreasuryPayablesListQuery({
      supplierName: "Alpha",
      classification: "Material",
      costCenter: "ADM",
      scheduledFrom: "2026-08-01",
      priority: "HIGH",
      sortBy: "scheduledDate",
    });
    assert.equal(q.supplierName, "Alpha");
    assert.equal(q.classification, "Material");
    assert.equal(q.costCenter, "ADM");
    assert.equal(q.scheduledFrom, "2026-08-01");
    assert.equal(q.priority, "HIGH");
    assert.equal(q.sortBy, "scheduledDate");
  });
});

describe("treasuryPayableApi — handlers", () => {
  it("lista e detalha com requestId; 401 sem auth; 404 not found", async () => {
    const service: TreasuryPayableQueryService = {
      async listPayables() {
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
      async getPayable(_actor, titleId) {
        if (titleId !== "p1") {
          throw new TreasuryDomainError("NOT_FOUND", "missing", "titleId");
        }
        return sampleRow;
      },
    };

    const controllers = createTreasuryPayableControllers({
      getCurrentAppUser: async () => baseUser(),
      service,
    });

    const listRes = createMockRes();
    await controllers.listPayables(
      { query: {}, headers: {}, header: () => undefined } as unknown as Request,
      listRes as unknown as Response
    );
    assert.equal(listRes.statusCode, 200);
    const listBody = listRes.body as {
      ok: true;
      rows: TreasuryPayableListItemDto[];
      requestId: string;
    };
    assert.equal(listBody.rows[0]?.openAmount, "40.00");
    assert.equal(listBody.rows[0]?.paidAmount, "60.00");
    assert.equal(listBody.rows[0]?.classification, "Material");
    assert.ok(listBody.requestId);

    const getRes = createMockRes();
    await controllers.getPayable(
      {
        params: { titleId: "p1" },
        query: {},
        headers: {},
        header: () => undefined,
      } as unknown as Request,
      getRes as unknown as Response
    );
    assert.equal(getRes.statusCode, 200);

    const unauth = createTreasuryPayableControllers({
      getCurrentAppUser: async () => null,
      service,
    });
    const unauthRes = createMockRes();
    await unauth.listPayables(
      { query: {}, headers: {}, header: () => undefined } as unknown as Request,
      unauthRes as unknown as Response
    );
    assert.equal(unauthRes.statusCode, 401);

    const missingRes = createMockRes();
    await controllers.getPayable(
      {
        params: { titleId: "missing" },
        query: {},
        headers: {},
        header: () => undefined,
      } as unknown as Request,
      missingRes as unknown as Response
    );
    assert.equal(missingRes.statusCode, 404);
  });
});
