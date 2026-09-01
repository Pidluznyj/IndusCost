import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { createTreasuryTransferControllers } from "./controllers/treasuryTransferController.js";
import { TREASURY_TRANSFERS_PATH } from "./contracts/treasuryContracts.js";
import type { TreasuryTransferService } from "./services/treasuryTransferService.server.js";
import type { TreasuryTransferDto } from "./contracts/treasuryDto.js";

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
      "finance.treasury.transfers.view",
      "finance.treasury.transfers.manage",
    ],
    effectivePermissions: [
      "finance.treasury.transfers.view",
      "finance.treasury.transfers.manage",
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

const sample: TreasuryTransferDto = {
  id: "tr1",
  transferGroupId: "g1",
  companyCode: "EMP1",
  fromAccountId: "a1",
  toAccountId: "a2",
  civilDate: "2026-08-10",
  amount: "100.00",
  currency: "BRL",
  status: "FORECAST",
  memo: null,
  fundsInTransit: false,
  sentCivilDate: null,
  receivedCivilDate: null,
  reconciledCivilDate: null,
  sentAt: null,
  receivedAt: null,
  reconciledAt: null,
  version: 1,
  createdAt: "2026-07-27T12:00:00.000+00:00",
  createdByUserId: "user-admin",
  updatedAt: "2026-07-27T12:00:00.000+00:00",
  updatedByUserId: "user-admin",
  cancelledAt: null,
  cancelledByUserId: null,
  cancellationReason: null,
};

describe("treasuryTransferApi — wiring", () => {
  it("registra rotas de transferências com flag e ACL", () => {
    const routes = readFileSync(join(here, "treasuryRoutes.ts"), "utf8");
    assert.equal(TREASURY_TRANSFERS_PATH, "/api/finance/treasury/transfers");
    assert.match(routes, /TREASURY_TRANSFERS_PATH/);
    assert.match(routes, /createTreasuryTransferControllers/);
    assert.match(routes, /treasury\.transfers\.enabled/);
    assert.match(routes, /\/:id\/send/);
    assert.match(routes, /\/:id\/receive/);
    assert.match(routes, /\/:id\/cancel/);
  });
});

describe("treasuryTransferApi — handlers", () => {
  it("POST cria e GET lista", async () => {
    const service = {
      async list() {
        return {
          items: [sample],
          pagination: { page: 1, pageSize: 50, totalRows: 1, totalPages: 1 },
        };
      },
      async getById() {
        return sample;
      },
      async create() {
        return {
          transfer: sample,
          projectionRecalc: { accepted: true, deferred: true, reason: "ok" },
        };
      },
      async schedule() {
        return {
          transfer: { ...sample, status: "SCHEDULED", version: 2 },
          projectionRecalc: { accepted: true, deferred: true, reason: "ok" },
        };
      },
      async send() {
        return {
          transfer: { ...sample, status: "SENT", fundsInTransit: true, version: 2 },
          projectionRecalc: { accepted: true, deferred: true, reason: "ok" },
        };
      },
      async receive() {
        return {
          transfer: { ...sample, status: "RECEIVED", version: 3 },
          projectionRecalc: { accepted: true, deferred: true, reason: "ok" },
        };
      },
      async reconcile() {
        return {
          transfer: { ...sample, status: "RECONCILED", version: 4 },
          projectionRecalc: { accepted: true, deferred: true, reason: "ok" },
        };
      },
      async cancel() {
        return {
          transfer: { ...sample, status: "CANCELLED", version: 2 },
          projectionRecalc: { accepted: true, deferred: true, reason: "ok" },
        };
      },
    } as unknown as TreasuryTransferService;

    const controllers = createTreasuryTransferControllers({
      getCurrentAppUser: async () => baseUser(),
      service,
    });

    const listRes = createMockRes();
    await controllers.list(
      {
        query: {},
        params: {},
        body: {},
        headers: {},
        header: () => "req-list",
      } as unknown as Request,
      listRes as unknown as Response
    );
    assert.equal(listRes.statusCode, 200);
    assert.equal(
      (listRes.body as { items: TreasuryTransferDto[] }).items[0]?.id,
      "tr1"
    );

    const createRes = createMockRes();
    await controllers.create(
      {
        query: {},
        params: {},
        body: {
          fromAccountId: "a1",
          toAccountId: "a2",
          civilDate: "2026-08-10",
          amount: "100.00",
        },
        headers: {},
        header: () => "req-create",
      } as unknown as Request,
      createRes as unknown as Response
    );
    assert.equal(createRes.statusCode, 201);

    const sendRes = createMockRes();
    await controllers.send(
      {
        query: {},
        params: { id: "tr1" },
        body: { expectedVersion: 1, civilDate: "2026-08-11" },
        headers: {},
        header: () => "req-send",
      } as unknown as Request,
      sendRes as unknown as Response
    );
    assert.equal(sendRes.statusCode, 200);
    assert.equal(
      (sendRes.body as { transfer: TreasuryTransferDto }).transfer.status,
      "SENT"
    );
  });
});
