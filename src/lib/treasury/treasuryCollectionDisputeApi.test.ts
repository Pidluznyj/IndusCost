import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { createTreasuryCollectionActionControllers } from "./controllers/treasuryCollectionActionController.js";
import { createTreasuryDisputeControllers } from "./controllers/treasuryDisputeController.js";
import {
  TREASURY_COLLECTION_ACTIONS_PATH,
  TREASURY_DISPUTES_PATH,
  TREASURY_RECEIVABLES_PATH,
} from "./contracts/treasuryContracts.js";
import {
  parseTreasuryCollectionActionCreateInput,
  parseTreasuryDisputeCreateInput,
} from "./contracts/treasurySchemas.js";
import { TreasuryDomainError } from "./domain/treasuryErrors.js";
import type { TreasuryCollectionActionDto } from "./contracts/treasuryDto.js";
import type { TreasuryDisputeDto } from "./contracts/treasuryDto.js";
import type { TreasuryCollectionActionService } from "./services/treasuryCollectionActionService.server.js";
import type { TreasuryDisputeService } from "./services/treasuryDisputeService.server.js";

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
      "finance.treasury.receivables.collection",
      "finance.treasury.receivables.manage",
      "finance.accounts_receivable.view",
    ],
    effectivePermissions: [
      "finance.treasury.receivables.view",
      "finance.treasury.receivables.collection",
      "finance.treasury.receivables.manage",
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

const sampleAction: TreasuryCollectionActionDto = {
  id: "a1",
  side: "AR",
  titleType: "RECEIVABLE",
  officialTitleId: "t1",
  nomusExternalId: "88421",
  actionType: "PHONE",
  performedAt: "2026-07-27T12:00:00.000+00:00",
  contactPerson: "João",
  result: "Prometeu pagar",
  notes: null,
  nextAction: "Enviar boleto",
  responsibleUserId: null,
  version: 1,
  createdAt: "2026-07-27T12:00:00.000+00:00",
  createdByUserId: "user-admin",
  updatedAt: "2026-07-27T12:00:00.000+00:00",
  updatedByUserId: "user-admin",
  cancelledAt: null,
  cancelledByUserId: null,
  cancellationReason: null,
};

const sampleDispute: TreasuryDisputeDto = {
  id: "d1",
  side: "AR",
  titleType: "RECEIVABLE",
  officialTitleId: "t1",
  nomusExternalId: "88421",
  openedAt: "2026-07-27T12:00:00.000+00:00",
  reason: "Divergência",
  amountDisputed: "80.00",
  responsibleUserId: null,
  involvedArea: "Comercial",
  dueDate: "2026-08-01",
  notes: null,
  status: "OPEN",
  resolutionNote: null,
  version: 1,
  createdAt: "2026-07-27T12:00:00.000+00:00",
  createdByUserId: "user-admin",
  updatedAt: "2026-07-27T12:00:00.000+00:00",
  updatedByUserId: "user-admin",
  cancelledAt: null,
  cancelledByUserId: null,
  resolvedAt: null,
};

describe("treasuryCollectionDisputeApi — wiring + schemas", () => {
  it("registra rotas de cobrança/contestação sem DELETE", () => {
    const routes = readFileSync(join(here, "treasuryRoutes.ts"), "utf8");
    assert.equal(
      TREASURY_COLLECTION_ACTIONS_PATH,
      "/api/finance/treasury/collection-actions"
    );
    assert.equal(TREASURY_DISPUTES_PATH, "/api/finance/treasury/disputes");
    assert.equal(TREASURY_RECEIVABLES_PATH, "/api/finance/treasury/receivables");
    assert.match(routes, /collection-actions/);
    assert.match(routes, /\/disputes/);
    assert.match(routes, /collectReceivables/);
    assert.match(routes, /createTreasuryCollectionActionControllers/);
    assert.match(routes, /createTreasuryDisputeControllers/);
    assert.doesNotMatch(routes, /\.delete\([^)]*collection-actions/);
    assert.doesNotMatch(routes, /\.delete\([^)]*disputes/);
  });

  it("parseia payloads de ação e contestação", () => {
    const action = parseTreasuryCollectionActionCreateInput({
      actionType: "WHATSAPP",
      performedAt: "2026-07-27T15:00:00.000+00:00",
      contactPerson: "Ana",
      result: "Ok",
      nextAction: "Cobrar",
    });
    assert.equal(action.actionType, "WHATSAPP");
    assert.equal(action.nextAction, "Cobrar");

    const dispute = parseTreasuryDisputeCreateInput({
      reason: "Erro de valor",
      amountDisputed: "10.00",
      involvedArea: "Fiscal",
      dueDate: "2026-08-15",
    });
    assert.equal(dispute.reason, "Erro de valor");
    assert.equal(dispute.amountDisputed, "10.00");
  });
});

describe("treasuryCollectionDisputeApi — handlers", () => {
  it("lista/cria ação e propaga 403", async () => {
    const service: TreasuryCollectionActionService = {
      async listByReceivable() {
        return [sampleAction];
      },
      async createForReceivable(_actor, _titleId, input) {
        return { ...sampleAction, actionType: input.actionType };
      },
      async cancel() {
        return {
          ...sampleAction,
          cancelledAt: "2026-07-27T13:00:00.000+00:00",
          version: 2,
        };
      },
    };

    const ok = createTreasuryCollectionActionControllers({
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
          actionType: "EMAIL",
          performedAt: "2026-07-27T15:00:00.000+00:00",
        },
        headers: {},
        header: () => "req-create",
      } as unknown as Request,
      createRes as unknown as Response
    );
    assert.equal(createRes.statusCode, 201);

    const forbidden = createTreasuryCollectionActionControllers({
      getCurrentAppUser: async () =>
        baseUser({
          role: "VIEWER",
          permissions: ["finance.treasury.receivables.view"],
          effectivePermissions: ["finance.treasury.receivables.view"],
        }),
      service: {
        ...service,
        async createForReceivable() {
          throw new TreasuryDomainError(
            "FORBIDDEN",
            "Sem permissão para registrar ações de cobrança."
          );
        },
      },
    });
    const res403 = createMockRes();
    await forbidden.createForReceivable(
      {
        params: { titleId: "t1" },
        body: {
          actionType: "PHONE",
          performedAt: "2026-07-27T15:00:00.000+00:00",
        },
        headers: {},
        header: () => "req-403",
      } as unknown as Request,
      res403 as unknown as Response
    );
    assert.equal(res403.statusCode, 403);
  });

  it("lista/cria/atualiza contestação e propaga 409", async () => {
    const service: TreasuryDisputeService = {
      async listByReceivable() {
        return [sampleDispute];
      },
      async createForReceivable(_actor, _titleId, input) {
        return { ...sampleDispute, reason: input.reason };
      },
      async updateStatus(_actor, _id, input) {
        if (input.expectedVersion !== 1) {
          throw new TreasuryDomainError(
            "CONFLICT",
            "Versão da contestação desatualizada.",
            "expectedVersion"
          );
        }
        return { ...sampleDispute, status: input.status, version: 2 };
      },
    };

    const ok = createTreasuryDisputeControllers({
      getCurrentAppUser: async () => baseUser(),
      service,
    });

    const createRes = createMockRes();
    await ok.createForReceivable(
      {
        params: { titleId: "t1" },
        body: { reason: "Divergência de NF", amountDisputed: "80.00" },
        headers: {},
        header: () => "req-d-create",
      } as unknown as Request,
      createRes as unknown as Response
    );
    assert.equal(createRes.statusCode, 201);

    const conflict = createMockRes();
    await ok.updateStatus(
      {
        params: { disputeId: "d1" },
        body: { status: "RESOLVED", expectedVersion: 0 },
        headers: {},
        header: () => "req-409",
      } as unknown as Request,
      conflict as unknown as Response
    );
    assert.equal(conflict.statusCode, 409);
  });
});
