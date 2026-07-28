/**
 * Wiring HTTP — POST /reconciliations/:id/reverse + GET list by movement.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { createTreasuryReconciliationMatchControllers } from "./controllers/treasuryReconciliationMatchController.js";
import {
  TREASURY_RECONCILIATION_REVERSE_CONFIRM_PHRASE,
  TREASURY_RECONCILIATIONS_PATH,
} from "./contracts/treasuryContracts.js";
import { parseTreasuryReconciliationReverseInput } from "./contracts/treasurySchemas.js";
import { TreasuryDomainError } from "./domain/treasuryErrors.js";
import type { TreasuryReconciliationMatchDto } from "./contracts/treasuryDto.js";
import type { TreasuryReconciliationMatchService } from "./services/treasuryReconciliationMatchService.server.js";

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

const matchDto = {
  id: "match-1",
  companyCode: "EMP1",
  accountId: "acc-1",
  status: "UNMATCHED",
  matchedAmount: "100.00",
  currency: "BRL",
  matchedCivilDate: "2026-07-20",
  justification: null,
  suggestionKey: null,
  algorithmVersion: null,
  suggestionScore: null,
  suggestionConfidence: null,
  suggestionReasons: null,
  version: 2,
  movements: [],
  allocations: [],
  createdAt: "2026-07-20T00:00:00.000+00:00",
  createdByUserId: "u1",
  updatedAt: "2026-07-20T00:00:00.000+00:00",
  updatedByUserId: "u1",
  unmatchedAt: "2026-07-20T01:00:00.000+00:00",
  unmatchedByUserId: "u1",
  unmatchReason: "erro",
  isReversed: true,
  doesNotRealizeOfficial: true as const,
} satisfies TreasuryReconciliationMatchDto;

describe("treasuryReconciliationReverseApi — wiring + schema", () => {
  it("rota reverse registrada com flag e permissão reverse", () => {
    const routes = readFileSync(join(here, "treasuryRoutes.ts"), "utf8");
    assert.ok(routes.includes("${TREASURY_RECONCILIATIONS_PATH}/:id/reverse"));
    assert.match(routes, /reconciliationReverse/);
    assert.match(routes, /treasury\.reconciliation\.enabled/);
    assert.match(routes, /reconciliations\.reverse/);
    assert.equal(
      TREASURY_RECONCILIATIONS_PATH,
      "/api/finance/treasury/reconciliations"
    );
  });

  it("parse exige justificativa e confirmPhrase", () => {
    assert.throws(
      () =>
        parseTreasuryReconciliationReverseInput({
          expectedVersion: 1,
          reason: "ok",
        }),
      /confirmPhrase/
    );
    const parsed = parseTreasuryReconciliationReverseInput({
      expectedVersion: 1,
      reason: "Conciliação errada",
      confirmPhrase: TREASURY_RECONCILIATION_REVERSE_CONFIRM_PHRASE,
    });
    assert.equal(parsed.confirmPhrase, "REVERTER");
  });
});

describe("treasuryReconciliationReverseApi — handlers", () => {
  it("401 sem auth; 200 reverse; propaga FORBIDDEN", async () => {
    const calls: string[] = [];
    const service = {
      async reverse(_actor, id, input) {
        calls.push(`reverse:${id}:${input.confirmPhrase}`);
        return {
          match: matchDto,
          projectionRecalc: { accepted: true, deferred: true, reason: "ok" },
          postClosing: { raised: false, reason: "DAY_NOT_CLOSED" },
        };
      },
      async listActiveByBankMovement() {
        return [matchDto];
      },
      async getById() {
        return matchDto;
      },
    } as unknown as TreasuryReconciliationMatchService;

    const controllers = createTreasuryReconciliationMatchControllers({
      getCurrentAppUser: async () => null,
      service,
    });
    const resUnauth = createMockRes();
    await controllers.reverse(
      {
        params: { id: "match-1" },
        body: {
          expectedVersion: 1,
          reason: "x",
          confirmPhrase: "REVERTER",
        },
        header: () => "req-unauth",
      } as unknown as Request,
      resUnauth as unknown as Response
    );
    assert.equal(resUnauth.statusCode, 401);

    const user = {
      id: "u1",
      role: "VIEWER",
      name: "Ops",
      sessionId: "s1",
    } as AppAuthContext;

    const controllersAuth = createTreasuryReconciliationMatchControllers({
      getCurrentAppUser: async () => user,
      service,
    });
    const resOk = createMockRes();
    await controllersAuth.reverse(
      {
        params: { id: "match-1" },
        body: {
          expectedVersion: 1,
          reason: "erro de match",
          confirmPhrase: "REVERTER",
        },
        header: () => "req-ok",
      } as unknown as Request,
      resOk as unknown as Response
    );
    assert.equal(resOk.statusCode, 200);
    const body = resOk.body as { ok: boolean; match: { isReversed: boolean } };
    assert.equal(body.ok, true);
    assert.equal(body.match.isReversed, true);
    assert.deepEqual(calls, ["reverse:match-1:REVERTER"]);

    const forbiddenService = {
      async reverse() {
        throw new TreasuryDomainError(
          "FORBIDDEN",
          "Sem permissão específica para reverter conciliação bancária."
        );
      },
    } as unknown as TreasuryReconciliationMatchService;
    const controllersForbidden = createTreasuryReconciliationMatchControllers({
      getCurrentAppUser: async () => user,
      service: forbiddenService,
    });
    const resForbidden = createMockRes();
    await controllersForbidden.reverse(
      {
        params: { id: "match-1" },
        body: {
          expectedVersion: 1,
          reason: "x",
          confirmPhrase: "REVERTER",
        },
        header: () => "req-forbidden",
      } as unknown as Request,
      resForbidden as unknown as Response
    );
    assert.equal(resForbidden.statusCode, 403);
  });
});
