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
import {
  createTreasuryPostClosingChangeService,
} from "./services/treasuryPostClosingChangeService.server.js";
import type {
  TreasuryDailyClosingRepository,
  TreasuryDailyClosingRow,
} from "./repositories/treasuryDailyClosingRepository.server.js";

const actor: TreasuryExceptionActor = {
  userId: "user-pc-1",
  userName: "PostClosing",
  role: "ADMIN",
  isSuperAdmin: false,
  canViewExceptions: true,
  canManageExceptions: true,
  sessionId: "sess-pc",
  requestId: "req-pc-1",
};

function closedRow(
  overrides: Partial<TreasuryDailyClosingRow> = {}
): TreasuryDailyClosingRow {
  return {
    id: "close-1",
    companyCode: "EMP1",
    civilDate: "2026-07-20",
    version: 1,
    status: "CLOSED",
    sourceHash: "hash-frozen",
    contentHash: "content",
    openingBalance: "1000.00",
    realizedInflows: "0.00",
    realizedOutflows: "0.00",
    pendenciesAmount: "0.00",
    closingBalance: "1000.00",
    observedBalance: "1000.00",
    reconciledBalance: "1000.00",
    differenceAmount: "0.00",
    exceptionsCount: 0,
    exceptionsAmount: "0.00",
    caveatsCount: 0,
    notes: null,
    previousClosingId: null,
    supersededByClosingId: null,
    createdByUserId: "u1",
    createdAt: new Date("2026-07-20T20:00:00.000Z"),
    closedByUserId: "u1",
    closedAt: new Date("2026-07-20T20:00:00.000Z"),
    ...overrides,
  };
}

function createHarness(closing: TreasuryDailyClosingRow | null) {
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

  const closingRepository = {
    async findCurrent(companyCode, civilDate) {
      if (!closing) return null;
      if (
        closing.companyCode === companyCode &&
        closing.civilDate === civilDate
      ) {
        return closing;
      }
      return null;
    },
    async list(input) {
      if (!closing) return { rows: [], total: 0 };
      if (input.status && closing.status !== input.status) {
        return { rows: [], total: 0 };
      }
      return { rows: [closing], total: 1 };
    },
  } as unknown as TreasuryDailyClosingRepository;

  const service = createTreasuryPostClosingChangeService({
    closingRepository,
    exceptionService,
  });

  return { service, exceptionService, store, closingRepository };
}

describe("treasuryPostClosingChange — integração", () => {
  it("baixa tardia, cancelamento, movimento bancário e saldo geram exceção", async () => {
    const { service, exceptionService } = createHarness(closedRow());

    const settlement = await service.recordFinancialChange(
      {
        companyCode: "EMP1",
        civilDate: "2026-07-20",
        changeKind: "LATE_SETTLEMENT",
        entityKind: "RECEIVABLE",
        entityId: "ar-1",
        amount: "40.00",
        frozenAmount: "40.00",
        currentAmount: "0.00",
        changedAtIso: "2026-07-22T10:00:00.000Z",
      },
      { actor }
    );
    assert.equal(settlement.raised, true);
    if (settlement.raised) {
      assert.equal(settlement.created, true);
      assert.equal(settlement.differenceAmount, "-40.00");
      assert.equal(
        settlement.exception.type,
        "FINANCIAL_CHANGE_AFTER_CLOSING"
      );
    }

    const cancel = await service.recordFinancialChange(
      {
        companyCode: "EMP1",
        civilDate: "2026-07-20",
        changeKind: "LATE_CANCELLATION",
        entityKind: "PAYABLE",
        entityId: "ap-1",
        amount: "12.00",
        changedAtIso: "2026-07-22T11:00:00.000Z",
      },
      { actor }
    );
    assert.equal(cancel.raised, true);

    const bank = await service.recordFinancialChange(
      {
        companyCode: "EMP1",
        civilDate: "2026-07-20",
        changeKind: "LATE_BANK_MOVEMENT",
        entityKind: "RECONCILIATION",
        entityId: "bank-1",
        amount: "9.00",
        changedAtIso: "2026-07-22T12:00:00.000Z",
      },
      { actor }
    );
    assert.equal(bank.raised, true);

    const balance = await service.recordFinancialChange(
      {
        companyCode: "EMP1",
        civilDate: "2026-07-20",
        changeKind: "BALANCE_CHANGE",
        entityKind: "ACCOUNT",
        entityId: "acc-1",
        accountId: "acc-1",
        frozenAmount: "1000.00",
        currentAmount: "980.00",
        changedAtIso: "2026-07-22T13:00:00.000Z",
      },
      { actor }
    );
    assert.equal(balance.raised, true);
    if (balance.raised) {
      assert.equal(balance.differenceAmount, "-20.00");
    }

    const listed = await exceptionService.list(actor, {
      companyCode: "EMP1",
      status: "OPEN",
      pageSize: 50,
    });
    assert.equal(listed.pagination.totalRows, 4);
    assert.ok(
      listed.items.every((i) => i.type === "FINANCIAL_CHANGE_AFTER_CLOSING")
    );
  });

  it("reprocessamento idempotente incrementa recorrência sem duplicar uniqueKey", async () => {
    const { service, exceptionService } = createHarness(closedRow());
    const event = {
      companyCode: "EMP1",
      civilDate: "2026-07-20",
      changeKind: "LATE_SETTLEMENT" as const,
      entityKind: "RECEIVABLE" as const,
      entityId: "ar-dup",
      amount: "15.00",
      changedAtIso: "2026-07-22T10:00:00.000Z",
    };

    const first = await service.recordFinancialChange(event, { actor });
    const second = await service.recordFinancialChange(event, { actor });
    assert.equal(first.raised, true);
    assert.equal(second.raised, true);
    if (first.raised && second.raised) {
      assert.equal(first.created, true);
      assert.equal(second.created, false);
      assert.equal(second.recurrenceIncremented, true);
      assert.equal(first.exception.id, second.exception.id);
      assert.ok(second.exception.recurrenceCount >= 2);
    }

    const listed = await exceptionService.list(actor, {
      companyCode: "EMP1",
      status: "OPEN",
      pageSize: 50,
    });
    assert.equal(listed.pagination.totalRows, 1);
  });

  it("dia aberto não gera exceção (fechamento intacto)", async () => {
    const { service } = createHarness(closedRow({ status: "OPEN" }));
    const result = await service.recordFinancialChange(
      {
        companyCode: "EMP1",
        civilDate: "2026-07-20",
        changeKind: "LATE_SETTLEMENT",
        entityKind: "RECEIVABLE",
        entityId: "ar-x",
        amount: "1.00",
        changedAtIso: "2026-07-22T10:00:00.000Z",
      },
      { actor }
    );
    assert.deepEqual(result, { raised: false, reason: "DAY_NOT_CLOSED" });
  });
});
