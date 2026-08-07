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

const fakeUser = { id: "u1", name: "Ops", role: "ADMIN", sessionId: "s1" } as AppAuthContext;

function fakeReq(query: Record<string, unknown>): Request {
  return {
    query,
    header: () => null,
  } as unknown as Request;
}

describe("cashSupportController — wiring", () => {
  it("401 sem usuário autenticado", async () => {
    const service: CashSupportService = {
      getReadModel: async () => emptyReadModel(),
      getSuggestions: async () => emptySuggestions(),
    };
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
    const service: CashSupportService = {
      getReadModel: async () => emptyReadModel(),
      getSuggestions: async () => emptySuggestions(),
    };
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
    const service: CashSupportService = {
      getReadModel: async () => emptyReadModel(),
      getSuggestions: async () => emptySuggestions(),
    };
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
    const service: CashSupportService = {
      getReadModel: async (_actor, filters) => {
        calledWithFilters = filters;
        return emptyReadModel();
      },
      getSuggestions: async () => emptySuggestions(),
    };
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
    const service: CashSupportService = {
      getReadModel: async () => {
        throw new Error("boom");
      },
      getSuggestions: async () => emptySuggestions(),
    };
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
    const service: CashSupportService = {
      getReadModel: async () => emptyReadModel(),
      getSuggestions: async () => emptySuggestions(),
    };
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
    const service: CashSupportService = {
      getReadModel: async () => emptyReadModel(),
      getSuggestions: async () => emptySuggestions(),
    };
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
    const service: CashSupportService = {
      getReadModel: async () => emptyReadModel(),
      getSuggestions: async () => emptySuggestions(),
    };
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
    const service: CashSupportService = {
      getReadModel: async () => emptyReadModel(),
      getSuggestions: async () => {
        called = true;
        return emptySuggestions();
      },
    };
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
});
