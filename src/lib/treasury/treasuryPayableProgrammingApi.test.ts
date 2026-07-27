import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { createTreasuryPayableProgrammingControllers } from "./controllers/treasuryPayableProgrammingController.js";
import { TREASURY_PAYABLES_PATH } from "./contracts/treasuryContracts.js";
import {
  parseTreasuryPayableProgramPaymentCancelInput,
  parseTreasuryPayableProgramPaymentInput,
} from "./contracts/treasurySchemas.js";
import { TreasuryDomainError } from "./domain/treasuryErrors.js";
import type { TreasuryPayableProgrammingService } from "./services/treasuryPayableProgrammingService.server.js";
import type { TreasuryPayableListItemDto } from "./contracts/treasuryPayableContracts.js";

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
      "finance.treasury.payables.program",
      "finance.accounts_payable.view",
    ],
    effectivePermissions: [
      "finance.treasury.payables.program",
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
    createdAt: "2026-07-27T00:00:00.000+00:00",
    updatedAt: "2026-07-27T00:00:00.000+00:00",
    sessionId: "sess-1",
    sessionPermissionsVersionAtIssue: 1,
    ...overrides,
  };
}

const payableStub = {
  titleId: "ap-1",
  official: { dueDate: "2026-07-25" },
  operationalStatus: "PROGRAMMED",
} as unknown as TreasuryPayableListItemDto;

describe("treasuryPayableProgrammingApi — wiring + schema", () => {
  it("registra POST/PUT/cancel program-payment com flag e permissão", () => {
    const routes = readFileSync(join(here, "treasuryRoutes.ts"), "utf8");
    assert.equal(TREASURY_PAYABLES_PATH, "/api/finance/treasury/payables");
    assert.match(routes, /program-payment/);
    assert.match(routes, /programPayables/);
    assert.match(routes, /payablesProgrammingEnabled/);
    assert.match(routes, /createTreasuryPayableProgrammingControllers/);
  });

  it("parseia input e rejeita mutação de vencimento oficial", () => {
    const parsed = parseTreasuryPayableProgramPaymentInput({
      scheduledDate: "2026-08-10",
      plannedAccountId: "acc-1",
      scheduledAmount: "50",
      justification: "ok",
      status: "AUTHORIZED",
      expectedVersion: 0,
    });
    assert.equal(parsed.scheduledAmount, "50.00");
    assert.equal(parsed.status, "AUTHORIZED");

    assert.throws(() =>
      parseTreasuryPayableProgramPaymentInput({
        scheduledDate: "2026-08-10",
        plannedAccountId: "acc-1",
        scheduledAmount: "50",
        justification: "ok",
        dueDate: "2026-09-01",
        expectedVersion: 0,
      })
    );

    const cancel = parseTreasuryPayableProgramPaymentCancelInput({
      reason: "cancelar",
      expectedVersion: 2,
    });
    assert.equal(cancel.reason, "cancelar");
  });
});

describe("treasuryPayableProgrammingApi — handlers", () => {
  it("201 program; 409 conflito; 403 permissão", async () => {
    const service: TreasuryPayableProgrammingService = {
      async programPayment(actor) {
        if (!actor.canProgramPayables && !actor.isSuperAdmin) {
          throw new TreasuryDomainError("FORBIDDEN", "Sem permissão");
        }
        return {
          ok: true,
          payable: payableStub,
          programming: {
            scheduledDate: "2026-08-10",
            scheduledAmount: "50.00",
            plannedAccountId: "acc-1",
            priority: "NORMAL",
            responsibleUserId: null,
            status: "PROGRAMMED",
            justification: "ok",
            version: 1,
          },
          impact: {
            accountId: "acc-1",
            accountBalanceBefore: "100.00",
            accountBalanceAfter: "50.00",
            consolidatedBalanceBefore: "100.00",
            consolidatedBalanceAfter: "50.00",
            scheduledAmount: "50.00",
            accountIncludedInConsolidated: true,
            createsNegativeAccountBalance: false,
            createsNegativeConsolidatedBalance: false,
            alerts: [],
          },
          projectionRecalc: {
            accepted: true,
            deferred: true,
            reason: "queued",
          },
        };
      },
      async updateProgramPayment() {
        throw new TreasuryDomainError(
          "CONFLICT",
          "Versão desatualizada",
          "expectedVersion"
        );
      },
      async cancelProgramPayment() {
        return {
          payable: payableStub,
          impact: null,
          projectionRecalc: {
            accepted: true,
            deferred: true,
            reason: "queued",
          },
        };
      },
      async holdPayable() {
        return {
          payable: payableStub,
          projectionRecalc: {
            accepted: true,
            deferred: true,
            reason: "queued",
          },
        };
      },
      async releaseHoldPayable() {
        return {
          payable: payableStub,
          projectionRecalc: {
            accepted: true,
            deferred: true,
            reason: "queued",
          },
        };
      },
    };

    const controllers = createTreasuryPayableProgrammingControllers({
      getCurrentAppUser: async () => baseUser(),
      service,
    });

    const createdRes = createMockRes();
    await controllers.programPayment(
      {
        params: { titleId: "ap-1" },
        body: {
          scheduledDate: "2026-08-10",
          plannedAccountId: "acc-1",
          scheduledAmount: "50.00",
          justification: "ok",
          status: "PROGRAMMED",
          expectedVersion: 0,
        },
        headers: {},
        header: () => "req-create",
      } as unknown as Request,
      createdRes as unknown as Response
    );
    assert.equal(createdRes.statusCode, 201);
    assert.equal(
      (createdRes.body as { programming: { scheduledAmount: string } })
        .programming.scheduledAmount,
      "50.00"
    );

    const conflictRes = createMockRes();
    await controllers.updateProgramPayment(
      {
        params: { titleId: "ap-1" },
        body: {
          justification: "x",
          expectedVersion: 0,
        },
        headers: {},
        header: () => "req-409",
      } as unknown as Request,
      conflictRes as unknown as Response
    );
    assert.equal(conflictRes.statusCode, 409);

    const forbidden = createTreasuryPayableProgrammingControllers({
      getCurrentAppUser: async () =>
        baseUser({
          role: "VIEWER",
          permissions: [],
          effectivePermissions: [],
        }),
      service,
    });
    const forbiddenRes = createMockRes();
    await forbidden.programPayment(
      {
        params: { titleId: "ap-1" },
        body: {
          scheduledDate: "2026-08-10",
          plannedAccountId: "acc-1",
          scheduledAmount: "50.00",
          justification: "ok",
          expectedVersion: 0,
        },
        headers: {},
        header: () => "req-403",
      } as unknown as Request,
      forbiddenRes as unknown as Response
    );
    assert.equal(forbiddenRes.statusCode, 403);
  });
});
