import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { createTreasuryPaymentPromiseControllers } from "./controllers/treasuryPaymentPromiseController.js";
import {
  TREASURY_PROMISES_PATH,
  TREASURY_RECEIVABLES_PATH,
} from "./contracts/treasuryContracts.js";
import { TreasuryDomainError } from "./domain/treasuryErrors.js";
import type { TreasuryPaymentPromiseService } from "./services/treasuryPaymentPromiseService.server.js";
import type { TreasuryPaymentPromiseDto } from "./contracts/treasuryDto.js";

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
      "finance.treasury.receivables.view",
      "finance.treasury.receivables.promise",
      "finance.accounts_receivable.view",
    ],
    effectivePermissions: [
      "finance.treasury.receivables.view",
      "finance.treasury.receivables.promise",
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

const samplePromise: TreasuryPaymentPromiseDto = {
  id: "p1",
  side: "AR",
  titleType: "RECEIVABLE",
  officialTitleId: "t1",
  nomusExternalId: "88421",
  promisedDate: "2026-08-05",
  promisedAmount: "100.00",
  fulfilledAmount: "0.00",
  contactNote: "João",
  channel: "Telefone",
  notes: null,
  responsibleUserId: null,
  status: "ACTIVE",
  version: 1,
  createdAt: "2026-07-27T12:00:00.000+00:00",
  createdByUserId: "user-admin",
  updatedAt: "2026-07-27T12:00:00.000+00:00",
  updatedByUserId: "user-admin",
  cancelledAt: null,
  cancelledByUserId: null,
  cancellationReason: null,
  fulfilledAt: null,
};

describe("treasuryPaymentPromiseApi — wiring", () => {
  it("registra GET/POST promises sob receivables e cancel/mark-fulfilled", () => {
    const routes = readFileSync(join(here, "treasuryRoutes.ts"), "utf8");
    assert.equal(TREASURY_RECEIVABLES_PATH, "/api/finance/treasury/receivables");
    assert.equal(TREASURY_PROMISES_PATH, "/api/finance/treasury/promises");
    assert.match(routes, /\/promises/);
    assert.match(routes, /mark-fulfilled/);
    assert.match(routes, /promiseReceivables/);
    assert.match(routes, /createTreasuryPaymentPromiseControllers/);
  });
});

describe("treasuryPaymentPromiseApi — handlers", () => {
  it("lista/cria e propaga 409/403", async () => {
    const service: TreasuryPaymentPromiseService = {
      async listByReceivable() {
        return { promises: [samplePromise], expiredCount: 0 };
      },
      async createForReceivable(_actor, _titleId, input) {
        return {
          promise: {
            ...samplePromise,
            promisedAmount: input.promisedAmount,
            promisedDate: input.promisedDate,
          },
          projectionRecalc: {
            accepted: true,
            deferred: true,
            reason: "queued",
          },
        };
      },
      async cancel(_actor, _id, input) {
        if (input.expectedVersion !== 1) {
          throw new TreasuryDomainError(
            "CONFLICT",
            "Versão da promessa desatualizada.",
            "expectedVersion"
          );
        }
        return {
          promise: { ...samplePromise, status: "CANCELLED", version: 2 },
          projectionRecalc: {
            accepted: true,
            deferred: true,
            reason: "queued",
          },
        };
      },
      async markFulfilled() {
        return {
          promise: {
            ...samplePromise,
            status: "FULFILLED",
            fulfilledAmount: "100.00",
            version: 2,
          },
          projectionRecalc: {
            accepted: true,
            deferred: true,
            reason: "queued",
          },
        };
      },
    };

    const ok = createTreasuryPaymentPromiseControllers({
      getCurrentAppUser: async () => baseUser(),
      service,
    });

    const listRes = createMockRes();
    await ok.listByReceivable(
      {
        params: { titleId: "t1" },
        headers: {},
        header: () => "req-list",
      } as unknown as Request,
      listRes as unknown as Response
    );
    assert.equal(listRes.statusCode, 200);

    const createRes = createMockRes();
    await ok.createForReceivable(
      {
        params: { titleId: "t1" },
        body: {
          promisedDate: "2026-08-05",
          promisedAmount: "100.00",
        },
        headers: {},
        header: () => "req-create",
      } as unknown as Request,
      createRes as unknown as Response
    );
    assert.equal(createRes.statusCode, 201);

    const conflict = createMockRes();
    await ok.cancel(
      {
        params: { promiseId: "p1" },
        body: { expectedVersion: 0 },
        headers: {},
        header: () => "req-409",
      } as unknown as Request,
      conflict as unknown as Response
    );
    assert.equal(conflict.statusCode, 409);

    const forbiddenService: TreasuryPaymentPromiseService = {
      ...service,
      async createForReceivable() {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem permissão para gerenciar promessas de pagamento."
        );
      },
    };
    const forbidden = createTreasuryPaymentPromiseControllers({
      getCurrentAppUser: async () =>
        baseUser({
          role: "VIEWER",
          permissions: ["finance.treasury.receivables.view"],
          effectivePermissions: ["finance.treasury.receivables.view"],
        }),
      service: forbiddenService,
    });
    const res403 = createMockRes();
    await forbidden.createForReceivable(
      {
        params: { titleId: "t1" },
        body: { promisedDate: "2026-08-05", promisedAmount: "10.00" },
        headers: {},
        header: () => "req-403",
      } as unknown as Request,
      res403 as unknown as Response
    );
    assert.equal(res403.statusCode, 403);
  });
});
