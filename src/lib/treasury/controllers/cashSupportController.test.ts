/**
 * Wiring HTTP — GET /cash-support e /cash-support/summary. Deny-by-padrão,
 * validação de filtros e nenhum acesso direto a tabela financeira aqui
 * (tudo delega ao orquestrador injetado).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { createCashSupportControllers } from "./cashSupportController.js";
import type { CashSupportService } from "../services/cashSupportService.server.js";
import type { CashSupportReadModel } from "../contracts/cashSupportContracts.js";
import type { TreasuryReconciliationSuggestionEngineResult } from "../domain/treasuryReconciliationSuggestionEngine.js";

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

function emptyReadModel(): CashSupportReadModel {
  return {
    rows: [],
    summary: {
      bankPosition: {
        balance: null,
        inflows: "0.00",
        outflows: "0.00",
        reconciled: "0.00",
        partiallyReconciled: "0.00",
        unreconciled: "0.00",
        unidentified: "0.00",
      },
      canonicalPosition: {
        expectedTitles: "0.00",
        evidencedTitles: "0.00",
        futureForecasts: "0.00",
        overdue: "0.00",
      },
      bridge: {
        bankNotExplainedByTitles: "0.00",
        titlesWithoutBankEvidence: "0.00",
        internalTransfersConsolidated: "0.00",
      },
      warnings: [],
    },
    analysisAsOfDateTime: "2026-07-20T12:00:00.000Z",
    pagination: { page: 1, pageSize: 50, total: 0 },
    warnings: [],
  };
}

function emptySuggestions(): TreasuryReconciliationSuggestionEngineResult {
  return {
    algorithmVersion: "1.0.0",
    suggestions: [],
    unmatchedMovementIds: [],
    excludedTitleIds: [],
    autoMatched: false,
  };
}

/** Stub completo do orquestrador — overrides por teste. */
function stubService(overrides: Partial<CashSupportService> = {}): CashSupportService {
  return {
    getReadModel: async () => emptyReadModel(),
    getSuggestions: async () => emptySuggestions(),
    getTitleGrid: async () => ({
      titleRows: [],
      unexplainedMovements: [],
      cards: {
        totalTitles: 0,
        autoMatchedCount: 0,
        manualMatchedCount: 0,
        reviewCount: 0,
        partialCount: 0,
        divergenceCount: 0,
        unreconciledCount: 0,
        unexplainedMovementsCount: 0,
        unexplainedMovementsTotal: "0.00",
      },
      analysisAsOfDateTime: "2026-07-20T12:00:00.000Z",
    }),
    runAutoReconciliation: async () => ({
      algorithmVersion: "1.0.0",
      ruleVersion: "AUTO-1.0.0",
      analyzedMovements: 0,
      autoAccepted: 0,
      alreadyReconciled: 0,
      needsReview: 0,
      unmatched: 0,
      failures: [],
    }),
    getHistory: async () => ({
      matches: [],
      analysisAsOfDateTime: "2026-07-20T12:00:00.000Z",
    }),
    ...overrides,
  };
}

const fakeUser = { id: "u1", name: "Ops", role: "ADMIN", sessionId: "s1" } as AppAuthContext;

function fakeReq(query: Record<string, unknown>): Request {
  return {
    query,
    header: () => null,
  } as unknown as Request;
}

describe("cashSupportController — wiring", () => {
  it("401 sem usuário autenticado", async () => {
    const service = stubService();
    const controllers = createCashSupportControllers({
      getCurrentAppUser: async () => null,
      service,
    });
    const req = fakeReq({});
    const res = createMockRes();
    await controllers.getReadModel(req, res as unknown as Response);
    assert.equal(res.statusCode, 401);
  });

  it("400 quando civilDateFrom/civilDateTo ausentes", async () => {
    const service = stubService();
    const controllers = createCashSupportControllers({
      getCurrentAppUser: async () => fakeUser,
      service,
    });
    const req = fakeReq({});
    const res = createMockRes();
    await controllers.getReadModel(req, res as unknown as Response);
    assert.equal(res.statusCode, 400);
  });

  it("400 quando civilDateTo é anterior a civilDateFrom", async () => {
    const service = stubService();
    const controllers = createCashSupportControllers({
      getCurrentAppUser: async () => fakeUser,
      service,
    });
    const req = fakeReq({ civilDateFrom: "2026-07-31", civilDateTo: "2026-07-01" });
    const res = createMockRes();
    await controllers.getReadModel(req, res as unknown as Response);
    assert.equal(res.statusCode, 400);
  });

  it("200 com filtros válidos delega ao orquestrador e não acessa dado diretamente", async () => {
    let calledWithFilters: unknown = null;
    const service = stubService({
      getReadModel: async (_actor, filters) => {
        calledWithFilters = filters;
        return emptyReadModel();
      },
    });
    const controllers = createCashSupportControllers({
      getCurrentAppUser: async () => fakeUser,
      service,
    });
    const req = fakeReq({ civilDateFrom: "2026-07-01", civilDateTo: "2026-07-31" });
    const res = createMockRes();
    await controllers.getReadModel(req, res as unknown as Response);
    assert.equal(res.statusCode, 200);
    assert.ok(calledWithFilters);
    assert.equal((calledWithFilters as { civilDateFrom: string }).civilDateFrom, "2026-07-01");
  });

  it("erro do orquestrador vira resposta controlada, não crash", async () => {
    const service = stubService({
      getReadModel: async () => {
        throw new Error("boom");
      },
    });
    const controllers = createCashSupportControllers({
      getCurrentAppUser: async () => fakeUser,
      service,
    });
    const req = fakeReq({ civilDateFrom: "2026-07-01", civilDateTo: "2026-07-31" });
    const res = createMockRes();
    await controllers.getReadModel(req, res as unknown as Response);
    assert.equal(res.statusCode, 500);
  });

  it("getSummary retorna apenas summary/warnings, não as linhas", async () => {
    const service = stubService();
    const controllers = createCashSupportControllers({
      getCurrentAppUser: async () => fakeUser,
      service,
    });
    const req = fakeReq({ civilDateFrom: "2026-07-01", civilDateTo: "2026-07-31" });
    const res = createMockRes();
    await controllers.getSummary(req, res as unknown as Response);
    assert.equal(res.statusCode, 200);
    const body = res.body as Record<string, unknown>;
    assert.ok("summary" in body);
    assert.ok(!("rows" in body), "summary não deve expor as linhas");
  });

  it("resposta inclui x-request-id", async () => {
    const service = stubService();
    const controllers = createCashSupportControllers({
      getCurrentAppUser: async () => fakeUser,
      service,
    });
    const req = fakeReq({ civilDateFrom: "2026-07-01", civilDateTo: "2026-07-31" });
    const res = createMockRes();
    await controllers.getReadModel(req, res as unknown as Response);
    assert.ok(res.headers["x-request-id"]);
  });

  it("getSuggestions: 401 sem usuário", async () => {
    const service = stubService();
    const controllers = createCashSupportControllers({
      getCurrentAppUser: async () => null,
      service,
    });
    const req = fakeReq({});
    const res = createMockRes();
    await controllers.getSuggestions(req, res as unknown as Response);
    assert.equal(res.statusCode, 401);
  });

  it("getSuggestions: 200 delega ao orquestrador e nunca grava nada", async () => {
    let called = false;
    const service = stubService({
      getSuggestions: async () => {
        called = true;
        return emptySuggestions();
      },
    });
    const controllers = createCashSupportControllers({
      getCurrentAppUser: async () => fakeUser,
      service,
    });
    const req = fakeReq({ civilDateFrom: "2026-07-01", civilDateTo: "2026-07-31" });
    const res = createMockRes();
    await controllers.getSuggestions(req, res as unknown as Response);
    assert.equal(res.statusCode, 200);
    assert.ok(called);
    const body = res.body as TreasuryReconciliationSuggestionEngineResult;
    assert.equal(body.autoMatched, false);
  });

  it("getTitleGrid: 200 delega ao orquestrador (grid vem pronto do backend)", async () => {
    let called = false;
    const service = stubService();
    const base = service.getTitleGrid;
    service.getTitleGrid = async (actor, filters) => {
      called = true;
      return base(actor, filters);
    };
    const controllers = createCashSupportControllers({
      getCurrentAppUser: async () => fakeUser,
      service,
    });
    const req = fakeReq({ civilDateFrom: "2026-07-01", civilDateTo: "2026-07-31" });
    const res = createMockRes();
    await controllers.getTitleGrid(req, res as unknown as Response);
    assert.equal(res.statusCode, 200);
    assert.ok(called);
    const body = res.body as Record<string, unknown>;
    assert.ok("titleRows" in body && "cards" in body && "unexplainedMovements" in body);
  });

  it("runAutoReconcile: lê filtros do body e devolve o resumo da execução", async () => {
    let filtersSeen: unknown = null;
    const service = stubService({
      runAutoReconciliation: async (_actor, filters) => {
        filtersSeen = filters;
        return {
          algorithmVersion: "1.0.0",
          ruleVersion: "AUTO-1.0.0",
          analyzedMovements: 3,
          autoAccepted: 1,
          alreadyReconciled: 1,
          needsReview: 1,
          unmatched: 0,
          failures: [],
        };
      },
    });
    const controllers = createCashSupportControllers({
      getCurrentAppUser: async () => fakeUser,
      service,
    });
    const req = {
      query: {},
      body: { civilDateFrom: "2026-07-01", civilDateTo: "2026-07-31" },
      header: () => null,
    } as unknown as Request;
    const res = createMockRes();
    await controllers.runAutoReconcile(req, res as unknown as Response);
    assert.equal(res.statusCode, 200);
    assert.equal((filtersSeen as { civilDateFrom: string }).civilDateFrom, "2026-07-01");
    assert.equal((res.body as { autoAccepted: number }).autoAccepted, 1);
  });

  it("runAutoReconcile: 400 sem período no body (não roda sem janela explícita)", async () => {
    const service = stubService();
    const controllers = createCashSupportControllers({
      getCurrentAppUser: async () => fakeUser,
      service,
    });
    const req = { query: {}, body: {}, header: () => null } as unknown as Request;
    const res = createMockRes();
    await controllers.runAutoReconcile(req, res as unknown as Response);
    assert.equal(res.statusCode, 400);
  });

  it("getHistory: 200 devolve matches do período", async () => {
    const service = stubService();
    const controllers = createCashSupportControllers({
      getCurrentAppUser: async () => fakeUser,
      service,
    });
    const req = fakeReq({ civilDateFrom: "2026-07-01", civilDateTo: "2026-07-31" });
    const res = createMockRes();
    await controllers.getHistory(req, res as unknown as Response);
    assert.equal(res.statusCode, 200);
    assert.ok("matches" in (res.body as Record<string, unknown>));
  });
});
