import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  createEmptyTreasuryExceptionMemoryStore,
  createMemoryTreasuryExceptionRepository,
} from "./repositories/treasuryExceptionRepository.memory.js";
import type { TreasuryAuditDb } from "./services/treasuryAuditService.server.js";
import {
  createTreasuryExceptionService,
  type TreasuryExceptionActor,
} from "./services/treasuryExceptionService.server.js";
import { createTreasuryExceptionEngineService } from "./services/treasuryExceptionEngineService.server.js";

const actor: TreasuryExceptionActor = {
  userId: "user-eng-1",
  userName: "Motor",
  role: "ADMIN",
  isSuperAdmin: false,
  canViewExceptions: true,
  canManageExceptions: true,
  sessionId: "sess-eng",
  requestId: "req-eng-1",
};

function createHarness() {
  const store = createEmptyTreasuryExceptionMemoryStore();
  const fakeTx = {
    treasuryAuditLog: {
      async create(args: { data: Record<string, unknown> }) {
        return { id: "audit-1", ...args.data };
      },
    },
  } as unknown as TreasuryAuditDb;

  const exceptionService = createTreasuryExceptionService({
    prisma: {} as PrismaClient,
    repository: createMemoryTreasuryExceptionRepository(store),
    runTransaction: async (fn) => fn(fakeTx),
  });
  const engineService = createTreasuryExceptionEngineService({
    exceptionService,
  });
  return { engineService, exceptionService, store };
}

describe("treasuryExceptionEngine — integração apply", () => {
  it("gera, atualiza e auto-resolve apenas quando seguro", async () => {
    const { engineService, exceptionService } = createHarness();
    const now = Date.parse("2026-08-14T15:00:00.000Z");

    const first = await engineService.runAndApply(actor, {
      companyCode: "EMP1",
      asOfCivilDate: "2026-08-14",
      detectedAtIso: "2026-08-14T15:00:00.000Z",
      nowEpochMs: now,
      transfers: [
        {
          id: "tr-1",
          status: "SENT",
          amount: "40.00",
          fromAccountId: "a",
          toAccountId: "b",
        },
      ],
      duplicateSuspects: [
        {
          key: "dup-a",
          entityKind: "RECEIVABLE",
          entityIds: ["x", "y"],
          amount: "10.00",
        },
      ],
    });

    assert.equal(first.upserted.length, 2);
    assert.equal(first.autoResolved.length, 0);

    const listedOpen = await exceptionService.list(actor, {
      companyCode: "EMP1",
      status: "OPEN",
      pageSize: 50,
    });
    assert.equal(listedOpen.pagination.totalRows, 2);

    const second = await engineService.runAndApply(actor, {
      companyCode: "EMP1",
      asOfCivilDate: "2026-08-14",
      detectedAtIso: "2026-08-14T16:00:00.000Z",
      nowEpochMs: now,
      transfers: [
        {
          id: "tr-1",
          status: "RECEIVED",
          amount: "40.00",
          fromAccountId: "a",
          toAccountId: "b",
        },
      ],
      // duplicidade some — mas NÃO deve auto-resolver
      duplicateSuspects: [],
    });

    assert.ok(
      second.autoResolved.some((e) => e.type === "TRANSFER_IN_TRANSIT")
    );
    assert.ok(
      !second.autoResolved.some((e) => e.type === "SUSPECTED_DUPLICATE")
    );

    const dup = await exceptionService.getByUniqueKey(
      actor,
      "SUSPECTED_DUPLICATE|EMP1|dup-a"
    );
    assert.ok(dup);
    assert.equal(dup!.status, "OPEN");

    const transfer = await exceptionService.getByUniqueKey(
      actor,
      "TRANSFER_IN_TRANSIT|EMP1|tr-1"
    );
    assert.ok(transfer);
    assert.equal(transfer!.status, "RESOLVED");
  });
});
