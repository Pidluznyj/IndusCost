import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { createTreasuryDailyClosingPreviewControllers } from "./controllers/treasuryDailyClosingPreviewController.js";
import {
  TREASURY_DAILY_CLOSING_PREVIEW_PATH,
} from "./contracts/treasuryContracts.js";
import { parseTreasuryDailyClosingPreviewQuery } from "./contracts/treasurySchemas.js";
import type { TreasuryDailyClosingPreviewDto } from "./contracts/treasuryDto.js";
import { TreasuryDomainError } from "./domain/treasuryErrors.js";
import type { TreasuryDailyClosingPreviewService } from "./services/treasuryDailyClosingPreviewService.server.js";
import { createTreasuryDailyClosingPreviewService } from "./services/treasuryDailyClosingPreviewService.server.js";
import type { TreasuryDailyClosingPreviewFactsRepository } from "./repositories/treasuryDailyClosingPreviewFactsRepository.server.js";
import type { TreasuryAlertSettingsService } from "./services/treasuryAlertSettingsService.server.js";
import { DEFAULT_TREASURY_ALERT_SETTINGS } from "./contracts/treasuryAlertConfig.js";

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
    permissions: ["finance.treasury.closing.view"],
    effectivePermissions: ["finance.treasury.closing.view"],
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

const samplePreview: TreasuryDailyClosingPreviewDto = {
  ok: true,
  civilDate: "2026-08-17",
  companyCode: "EMP1",
  sourceHash: "a".repeat(64),
  generatedAt: "2026-08-17T18:00:00.000-03:00",
  summary: {
    openingBalance: "100.00",
    realizedInflows: "0.00",
    realizedOutflows: "0.00",
    pendenciesAmount: "0.00",
    closingBalance: "100.00",
    observedBalance: "100.00",
    reconciledBalance: null,
    differenceAmount: null,
    accountCount: 1,
    pendingReceivablesCount: 0,
    pendingPayablesCount: 0,
    absoluteBlockCount: 0,
    warningCount: 0,
    caveatRequiredCount: 0,
  },
  accounts: [],
  absoluteBlocks: [],
  warnings: [],
  pendingReceivables: [],
  pendingPayables: [],
  unreconciledMovements: [],
  staleBalances: [],
  expiredPromises: [],
  transfersInTransit: [],
  canCloseWithoutCaveats: true,
  canCloseWithCaveats: true,
  requiredCaveatCodes: [],
};

describe("treasuryDailyClosingPreviewApi — wiring", () => {
  it("registra GET /daily-closing/preview com flag e closing.view", () => {
    const routes = readFileSync(join(here, "treasuryRoutes.ts"), "utf8");
    assert.equal(
      TREASURY_DAILY_CLOSING_PREVIEW_PATH,
      "/api/finance/treasury/daily-closing/preview"
    );
    assert.match(routes, /TREASURY_DAILY_CLOSING_PREVIEW_PATH/);
    assert.match(routes, /getPreview/);
    assert.match(routes, /viewClosing/);
    assert.match(routes, /treasury\.dailyClosing\.enabled/);
    assert.match(routes, /createTreasuryDailyClosingPreviewControllers/);
  });

  it("parseia date/companyCode/accountIds", () => {
    const q = parseTreasuryDailyClosingPreviewQuery({
      date: "2026-08-17",
      companyCode: "EMP1",
      accountIds: "acc-1,acc-2",
    });
    assert.equal(q.date, "2026-08-17");
    assert.equal(q.companyCode, "EMP1");
    assert.deepEqual(q.accountIds, ["acc-1", "acc-2"]);
  });
});

describe("treasuryDailyClosingPreviewApi — handlers", () => {
  it("retorna DTO com requestId; 401 sem auth; 403 permissão", async () => {
    const service: TreasuryDailyClosingPreviewService = {
      async getPreview(actor) {
        if (!actor.canViewClosing && !actor.isSuperAdmin) {
          throw new TreasuryDomainError("FORBIDDEN", "negado");
        }
        return samplePreview;
      },
    };
    const ok = createTreasuryDailyClosingPreviewControllers({
      getCurrentAppUser: async () => baseUser(),
      service,
    });
    const resOk = createMockRes();
    await ok.getPreview(
      {
        query: { date: "2026-08-17" },
        headers: {},
        header: () => undefined,
      } as unknown as Request,
      resOk as unknown as Response
    );
    assert.equal(resOk.statusCode, 200);
    const body = resOk.body as TreasuryDailyClosingPreviewDto & {
      requestId: string;
    };
    assert.equal(body.ok, true);
    assert.equal(body.sourceHash.length, 64);
    assert.ok(body.requestId);

    const unauth = createTreasuryDailyClosingPreviewControllers({
      getCurrentAppUser: async () => null,
      service,
    });
    const res401 = createMockRes();
    await unauth.getPreview(
      {
        query: {},
        headers: {},
        header: () => undefined,
      } as unknown as Request,
      res401 as unknown as Response
    );
    assert.equal(res401.statusCode, 401);

    const denied = createTreasuryDailyClosingPreviewControllers({
      getCurrentAppUser: async () =>
        baseUser({
          role: "VIEWER",
          permissions: [],
          effectivePermissions: [],
        }),
      service: {
        async getPreview(actor) {
          if (!actor.canViewClosing && !actor.isSuperAdmin) {
            throw new TreasuryDomainError("FORBIDDEN", "negado");
          }
          return samplePreview;
        },
      },
    });
    const res403 = createMockRes();
    await denied.getPreview(
      {
        query: {},
        headers: {},
        header: () => undefined,
      } as unknown as Request,
      res403 as unknown as Response
    );
    assert.equal(res403.statusCode, 403);
  });
});

describe("treasuryDailyClosingPreviewService — integração leve", () => {
  it("monta preview a partir de facts repository injetado", async () => {
    const factsRepository: TreasuryDailyClosingPreviewFactsRepository = {
      async loadPreviewFacts(query) {
        return {
          civilDate: query.civilDate,
          companyCode: query.companyCode ?? null,
          generatedAtIso: "2026-08-17T18:00:00.000-03:00",
          staleBalanceHours: query.staleBalanceHours,
          syncMaxAgeHours: query.syncMaxAgeHours,
          syncAgeHours: 1,
          currentClosingStatus: null,
          hasSourceData: true,
          openSuspectedDuplicateCount: 0,
          accounts: [
            {
              accountId: "acc-1",
              code: "CX",
              name: "Caixa",
              includeInConsolidated: true,
              openingBalance: "10.00",
              realizedInflows: "0.00",
              realizedOutflows: "0.00",
              pendenciesAmount: "0.00",
              closingBalance: "10.00",
              observedBalance: "10.00",
              reconciledBalance: null,
              minimumBalance: "0.00",
              allowNegativeBalance: true,
              lastBalanceAtIso: "2026-08-17T10:00:00.000-03:00",
              balanceAgeHours: 1,
            },
          ],
          pendingReceivables: [],
          pendingPayables: [],
          unreconciledMovements: [],
          expiredPromises: [],
          transfersInTransit: [],
        };
      },
    };
    const alertSettingsService = {
      async get() {
        throw new Error("not used");
      },
      async update() {
        throw new Error("not used");
      },
      async getFields() {
        return { ...DEFAULT_TREASURY_ALERT_SETTINGS };
      },
    } as unknown as TreasuryAlertSettingsService;

    const service = createTreasuryDailyClosingPreviewService({
      factsRepository,
      alertSettingsService,
    });
    const dto = await service.getPreview(
      {
        userId: "u1",
        isSuperAdmin: true,
        canViewClosing: true,
      },
      { date: "2026-08-17", companyCode: "EMP1", accountIds: null }
    );
    assert.equal(dto.ok, true);
    assert.equal(dto.canCloseWithoutCaveats, true);
    assert.equal(dto.summary.accountCount, 1);
    assert.equal(dto.sourceHash.length, 64);
  });
});
