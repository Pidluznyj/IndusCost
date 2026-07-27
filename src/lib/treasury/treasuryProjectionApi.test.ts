/**
 * APIs de projeção/agenda — wiring, autorização, filtros e consistência.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { createTreasuryProjectionControllers } from "./controllers/treasuryProjectionController.js";
import {
  TREASURY_AGENDA_PATH,
  TREASURY_PROJECTIONS_PATH,
} from "./contracts/treasuryContracts.js";
import {
  parseTreasuryAgendaQuery,
  parseTreasuryProjectionCalculateInput,
  parseTreasuryProjectionLatestQuery,
} from "./contracts/treasurySchemas.js";
import { TreasuryDomainError } from "./domain/treasuryErrors.js";
import { TREASURY_PROJECTION_ALGORITHM_VERSION } from "./domain/treasuryProjectionEngine.js";
import {
  assertTreasuryProjectionHorizon,
  resolveTreasuryProjectionMaxHorizonDays,
} from "./domain/treasuryProjectionHorizon.js";
import {
  createEmptyTreasuryProjectionRunMemoryStore,
  createMemoryTreasuryProjectionRunRepository,
} from "./repositories/treasuryProjectionRunRepository.memory.js";
import {
  createTreasuryProjectionApiService,
  type TreasuryProjectionEngineInputLoader,
} from "./services/treasuryProjectionApiService.server.js";

const here = dirname(fileURLToPath(import.meta.url));
const ACC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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
    id: USER,
    name: "Admin",
    email: "admin@test.local",
    role: "SUPER_ADMIN",
    permissions: [
      "finance.treasury.dashboard.view",
      "finance.treasury.agenda.view",
    ],
    effectivePermissions: [
      "finance.treasury.dashboard.view",
      "finance.treasury.agenda.view",
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

const seedLoader: TreasuryProjectionEngineInputLoader = async () => ({
  accounts: [
    {
      accountId: ACC,
      code: "CX",
      includeInConsolidated: true,
      minimumBalance: "0.00",
      openingBalance: "1000.00",
    },
  ],
  receivables: [
    {
      id: "r1",
      officialTitleId: "11111111-1111-4111-8111-111111111111",
      nomusExternalId: 1001,
      accountId: ACC,
      dueDate: "2026-07-28",
      originalAmount: "200.00",
      openBalance: "200.00",
    },
  ],
  payables: [],
  settlements: [],
  expectations: [],
  promises: [],
  programming: [],
  ledgerEntries: [],
  transfers: [],
  fallbackAccountId: ACC,
});

describe("treasuryProjectionApi — wiring + schema", () => {
  it("registra rotas calculate/latest/:id/composition/agenda com flag e auth", () => {
    const routes = readFileSync(join(here, "treasuryRoutes.ts"), "utf8");
    assert.equal(TREASURY_PROJECTIONS_PATH, "/api/finance/treasury/projections");
    assert.equal(TREASURY_AGENDA_PATH, "/api/finance/treasury/agenda");
    assert.match(routes, /TREASURY_PROJECTIONS_PATH/);
    assert.match(routes, /TREASURY_AGENDA_PATH/);
    assert.match(routes, /calculate/);
    assert.match(routes, /getLatest/);
    assert.match(routes, /getComposition/);
    assert.match(routes, /getAgenda/);
    assert.match(routes, /treasury\.projection\.enabled/);
    assert.match(routes, /viewAgenda/);
  });

  it("parseia calculate/latest/agenda com baseDate/endDate/cenário/contas", () => {
    const calc = parseTreasuryProjectionCalculateInput({
      companyCode: "LAZARIOS",
      baseDate: "2026-07-27",
      endDate: "2026-07-29",
      scenario: "PROBABLE",
      accountIds: "acc-1,acc-2",
      consolidated: "true",
      includeDayDetail: "1",
    });
    assert.equal(calc.baseDate, "2026-07-27");
    assert.equal(calc.endDate, "2026-07-29");
    assert.deepEqual(calc.accountIds, ["acc-1", "acc-2"]);
    assert.equal(calc.consolidated, true);

    const latest = parseTreasuryProjectionLatestQuery({
      companyCode: "LAZARIOS",
      scenario: "CONTRACTUAL",
      consolidated: "false",
    });
    assert.equal(latest.scenario, "CONTRACTUAL");
    assert.equal(latest.consolidated, false);

    const agenda = parseTreasuryAgendaQuery({
      companyCode: "LAZARIOS",
      baseDate: "2026-07-27",
      endDate: "2026-07-28",
      scenario: "CONFIRMED",
    });
    assert.equal(agenda.endDate, "2026-07-28");
  });

  it("limita horizonte de forma configurável", () => {
    assert.equal(
      resolveTreasuryProjectionMaxHorizonDays({
        TREASURY_PROJECTION_MAX_HORIZON_DAYS: "14",
      }),
      14
    );
    assert.throws(
      () =>
        assertTreasuryProjectionHorizon({
          baseDate: "2026-01-01",
          endDate: "2026-06-01",
          maxHorizonDays: 30,
        }),
      /excede o máximo/
    );
    assert.equal(
      assertTreasuryProjectionHorizon({
        baseDate: "2026-07-27",
        endDate: "2026-07-29",
        maxHorizonDays: 90,
      }),
      3
    );
  });
});

describe("treasuryProjectionApi — serviço (auth/filtros/consistência)", () => {
  it("calculate/latest/composition/agenda com money string + versões + freshness", async () => {
    const store = createEmptyTreasuryProjectionRunMemoryStore();
    const repository = createMemoryTreasuryProjectionRunRepository(store);
    const service = createTreasuryProjectionApiService({
      repository,
      loadEngineInput: seedLoader,
      maxHorizonDays: 90,
      now: () => new Date("2026-07-27T15:00:00.000Z"),
    });
    const actor = {
      userId: USER,
      isSuperAdmin: true,
      canViewDashboard: true,
      canViewAgenda: true,
      requestId: "req-1",
    };

    const calculated = await service.calculate(actor, {
      companyCode: "LAZARIOS",
      baseDate: "2026-07-27",
      endDate: "2026-07-29",
      scenario: "PROBABLE",
      accountIds: null,
      consolidated: true,
      includeDayDetail: true,
      notes: null,
      idempotencyKey: null,
    });
    assert.equal(calculated.ok, true);
    assert.equal(calculated.status, "SUCCEEDED");
    assert.equal(calculated.algorithmVersion, TREASURY_PROJECTION_ALGORITHM_VERSION);
    assert.equal(calculated.sourceVersion.length, 64);
    assert.ok(calculated.freshness.sources.length >= 1);
    assert.ok((calculated.dayLines?.length ?? 0) > 0);
    assert.ok((calculated.consolidatedDays?.length ?? 0) > 0);
    for (const line of calculated.dayLines ?? []) {
      assert.match(line.openingBalance, /^\d+\.\d{2}$/);
      assert.match(line.closingBalance, /^\d+\.\d{2}$/);
    }

    const latest = await service.getLatest(actor, {
      companyCode: "LAZARIOS",
      scenario: "PROBABLE",
      accountIds: null,
      consolidated: true,
      includeDayDetail: false,
    });
    assert.equal(latest.id, calculated.id);
    assert.equal(latest.dayLines, null);
    assert.ok(latest.consolidatedDays);

    const byId = await service.getById(actor, calculated.id, {
      accountIds: [ACC],
      consolidated: false,
      includeDayDetail: true,
    });
    assert.equal(byId.id, calculated.id);
    assert.ok(byId.dayLines?.every((l) => l.accountId === ACC));

    const composition = await service.getComposition(actor, calculated.id, {
      from: "2026-07-28",
      to: "2026-07-28",
      accountIds: null,
    });
    assert.equal(composition.runId, calculated.id);
    assert.equal(composition.sourceVersion, calculated.sourceVersion);
    assert.ok(composition.items.every((i) => i.civilDate === "2026-07-28"));
    for (const item of composition.items) {
      assert.match(item.amount, /^-?\d+\.\d{2}$/);
    }

    const agenda = await service.getAgenda(actor, {
      companyCode: "LAZARIOS",
      baseDate: "2026-07-27",
      endDate: "2026-07-29",
      scenario: "PROBABLE",
      accountIds: null,
      consolidated: true,
      includeDayDetail: true,
    });
    assert.equal(agenda.runId, calculated.id);
    assert.equal(agenda.algorithmVersion, calculated.algorithmVersion);
    assert.ok(agenda.days.length >= 1);
    for (const day of agenda.days) {
      assert.match(day.openingBalance, /^-?\d+\.\d{2}$/);
      assert.match(day.plannedInflows, /^-?\d+\.\d{2}$/);
      assert.match(day.confirmedInflows, /^-?\d+\.\d{2}$/);
      assert.match(day.realizedInflows, /^-?\d+\.\d{2}$/);
      assert.match(day.plannedOutflows, /^-?\d+\.\d{2}$/);
      assert.match(day.programmedOutflows, /^-?\d+\.\d{2}$/);
      assert.match(day.realizedOutflows, /^-?\d+\.\d{2}$/);
      assert.match(day.transfers, /^-?\d+\.\d{2}$/);
      assert.ok(day.riskLabel.length > 0);
      assert.ok(day.riskCode.length > 0);
      assert.equal(day.accountId, null);
    }
    const { addTreasuryMoney } = await import("./treasuryMoney.js");
    const inflowSum = agenda.days.reduce(
      (acc, d) => addTreasuryMoney(acc, d.inflows),
      "0.00"
    );
    const consolidatedInflow = (calculated.consolidatedDays ?? []).reduce(
      (acc, d) => addTreasuryMoney(acc, d.inflows),
      "0.00"
    );
    assert.equal(inflowSum, consolidatedInflow);
  });

  it("nega calculate sem permissão; rejeita horizonte excessivo", async () => {
    const store = createEmptyTreasuryProjectionRunMemoryStore();
    const repository = createMemoryTreasuryProjectionRunRepository(store);
    const service = createTreasuryProjectionApiService({
      repository,
      loadEngineInput: seedLoader,
      maxHorizonDays: 5,
    });
    await assert.rejects(
      () =>
        service.calculate(
          {
            userId: USER,
            isSuperAdmin: false,
            canViewDashboard: false,
            canViewAgenda: false,
            requestId: "r",
          },
          {
            companyCode: "LAZARIOS",
            baseDate: "2026-07-27",
            endDate: "2026-07-28",
            scenario: "PROBABLE",
            accountIds: null,
            consolidated: true,
            includeDayDetail: true,
            notes: null,
            idempotencyKey: null,
          }
        ),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "FORBIDDEN"
    );
    await assert.rejects(
      () =>
        service.calculate(
          {
            userId: USER,
            isSuperAdmin: true,
            canViewDashboard: true,
            canViewAgenda: true,
            requestId: "r",
          },
          {
            companyCode: "LAZARIOS",
            baseDate: "2026-07-01",
            endDate: "2026-07-20",
            scenario: "PROBABLE",
            accountIds: null,
            consolidated: true,
            includeDayDetail: false,
            notes: null,
            idempotencyKey: null,
          }
        ),
      /excede o máximo/
    );
  });
});

describe("treasuryProjectionApi — handlers HTTP", () => {
  it("retorna 401 sem auth; 201 calculate; 403 agenda sem permissão", async () => {
    const store = createEmptyTreasuryProjectionRunMemoryStore();
    const repository = createMemoryTreasuryProjectionRunRepository(store);
    const service = createTreasuryProjectionApiService({
      repository,
      loadEngineInput: seedLoader,
      maxHorizonDays: 90,
    });
    const controllers = createTreasuryProjectionControllers({
      getCurrentAppUser: async () => null,
      service,
    });
    const mockReq = (overrides: Record<string, unknown> = {}) =>
      ({
        body: {},
        headers: {},
        query: {},
        params: {},
        header: () => null,
        ...overrides,
      }) as unknown as Request;

    const res401 = createMockRes();
    await controllers.calculate(mockReq(), res401 as unknown as Response);
    assert.equal(res401.statusCode, 401);

    const controllersOk = createTreasuryProjectionControllers({
      getCurrentAppUser: async () => baseUser(),
      service,
    });
    const resCalc = createMockRes();
    await controllersOk.calculate(
      mockReq({
        body: {
          companyCode: "LAZARIOS",
          baseDate: "2026-07-27",
          endDate: "2026-07-28",
          scenario: "PROBABLE",
        },
      }),
      resCalc as unknown as Response
    );
    assert.equal(resCalc.statusCode, 201);
    const body = resCalc.body as { requestId: string; sourceVersion: string };
    assert.ok(body.requestId);
    assert.equal(body.sourceVersion.length, 64);

    const controllersDenied = createTreasuryProjectionControllers({
      getCurrentAppUser: async () =>
        baseUser({
          role: "USER",
          permissions: [],
          effectivePermissions: [],
        }),
      service,
    });
    const resAgenda = createMockRes();
    await controllersDenied.getAgenda(
      mockReq({
        query: {
          companyCode: "LAZARIOS",
          baseDate: "2026-07-27",
          endDate: "2026-07-28",
        },
      }),
      resAgenda as unknown as Response
    );
    assert.equal(resAgenda.statusCode, 403);
  });
});
