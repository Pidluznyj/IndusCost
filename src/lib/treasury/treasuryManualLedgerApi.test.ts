import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Request, Response } from "express";
import type { AppAuthContext } from "@/src/lib/appAuth.js";
import { createTreasuryManualLedgerControllers } from "./controllers/treasuryManualLedgerController.js";
import { parseTreasuryManualLedgerReverseInput } from "./contracts/treasurySchemas.js";
import { TREASURY_LEDGER_ENTRIES_PATH } from "./contracts/treasuryContracts.js";
import type { TreasuryManualLedgerService } from "./services/treasuryManualLedgerService.server.js";
import type { TreasuryLedgerEntryDto } from "./contracts/treasuryDto.js";

type MockRes = {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockRes;
  json: (payload: unknown) => MockRes;
  setHeader: () => void;
};

function createMockRes(): MockRes {
  const res: MockRes = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    setHeader() {},
  };
  return res;
}

const entry: TreasuryLedgerEntryDto = {
  id: "led-1",
  companyCode: "EMP1",
  accountId: "acc-1",
  civilDate: "2026-07-20",
  amount: "10.00",
  currency: "BRL",
  direction: "DEBIT",
  nature: "MANUAL",
  status: "ACTIVE",
  memo: "teste",
  counterpartRef: null,
  transferGroupId: null,
  reversesEntryId: null,
  version: 1,
  createdAt: "2026-07-20T00:00:00.000+00:00",
  createdByUserId: "u1",
  updatedAt: "2026-07-20T00:00:00.000+00:00",
  updatedByUserId: null,
};

describe("treasuryManualLedgerApi", () => {
  it("path canônico e parse de reverse", () => {
    assert.equal(
      TREASURY_LEDGER_ENTRIES_PATH,
      "/api/finance/treasury/ledger-entries"
    );
    const parsed = parseTreasuryManualLedgerReverseInput({
      expectedVersion: 1,
      justification: "erro de digitação",
    });
    assert.equal(parsed.expectedVersion, 1);
  });

  it("create 201 e reverse 200 via controller", async () => {
    const user = { id: "u1", role: "SUPER_ADMIN" } as AppAuthContext;
    const service = {
      async create() {
        return {
          entry,
          projectionRecalc: {
            accepted: true,
            deferred: true,
            reason: "ok",
          },
        };
      },
      async reverse() {
        return {
          entry: { ...entry, status: "REVERSED", version: 2 },
          reversal: {
            ...entry,
            id: "led-2",
            nature: "REVERSAL",
            direction: "CREDIT",
            reversesEntryId: "led-1",
          },
          projectionRecalc: {
            accepted: true,
            deferred: true,
            reason: "ok",
          },
        };
      },
      async list() {
        return {
          items: [entry],
          pagination: {
            page: 1,
            pageSize: 50,
            totalRows: 1,
            totalPages: 1,
          },
        };
      },
      async getById() {
        return entry;
      },
    } as unknown as TreasuryManualLedgerService;

    const controllers = createTreasuryManualLedgerControllers({
      getCurrentAppUser: async () => user,
      service,
    });

    const mockReq = (extra: Record<string, unknown>) =>
      ({
        headers: {},
        query: {},
        header: () => "req-test",
        get: () => undefined,
        ...extra,
      }) as unknown as Request;

    const createRes = createMockRes();
    await controllers.create(
      mockReq({
        body: {
          accountId: "acc-1",
          civilDate: "2026-07-20",
          amount: "10.00",
          direction: "DEBIT",
          nature: "MANUAL",
          memo: "teste",
          counterpartRef: null,
        },
      }),
      createRes as unknown as Response
    );
    assert.equal(createRes.statusCode, 201);

    const reverseRes = createMockRes();
    await controllers.reverse(
      mockReq({
        params: { id: "led-1" },
        body: { expectedVersion: 1, justification: "corrigir" },
      }),
      reverseRes as unknown as Response
    );
    assert.equal(reverseRes.statusCode, 200);
  });
});
