import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  createEmptyOfficialTitlesMemoryStore,
  createMemoryTreasuryOfficialTitlesAdapter,
} from "./adapters/treasuryOfficialTitlesAdapter.memory.js";
import type { OfficialNomusReceivableRow } from "./mappers/treasuryOfficialTitleMappers.js";
import {
  createEmptyTreasuryTitleComplementMemoryStore,
  createMemoryTreasuryTitleOperationalComplementRepository,
} from "./repositories/treasuryTitleOperationalComplementRepository.memory.js";
import type { TreasuryAuditDb } from "./services/treasuryAuditService.server.js";
import {
  clearTreasuryProjectionRecalcRequests,
  listTreasuryProjectionRecalcRequests,
} from "./services/treasuryProjectionRecalc.server.js";
import {
  createTreasuryReceivableExpectationService,
  type TreasuryReceivableExpectationActor,
} from "./services/treasuryReceivableExpectationService.server.js";
import { TreasuryDomainError } from "./domain/treasuryErrors.js";

function decimalLike(value: string): { toFixed(digits: number): string } {
  return {
    toFixed(digits: number) {
      return Number(value).toFixed(digits);
    },
  };
}

function utcDate(y: number, m: number, d: number): Date {
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

const AR_OPEN: OfficialNomusReceivableRow = {
  id: "title-open-1",
  externalId: 88421,
  status: false,
  personId: 1205,
  personName: "Cliente Industrial",
  personCnpj: "12345678000199",
  description: "NF 45210",
  competenceDate: utcDate(2026, 6, 1),
  dueDate: utcDate(2026, 7, 15),
  amountReceivable: decimalLike("1000.00"),
  balanceReceivable: decimalLike("400.00"),
  amountReceived: decimalLike("600.00"),
  settlementDate: null,
  sourceInvoiceId: 99001,
  sourceInvoiceNumber: "45210",
  sourcePresenceStatus: "PRESENT",
  sourceRemovedAt: null,
  syncedAt: new Date("2026-07-20T14:30:00.000Z"),
  rawPayload: { id: 88421 },
};

const manager: TreasuryReceivableExpectationActor = {
  userId: "mgr-1",
  userName: "Gestor",
  role: "ADMIN",
  isSuperAdmin: false,
  canManageReceivables: true,
  sessionId: "sess-1",
  requestId: "req-exp-1",
};

const viewer: TreasuryReceivableExpectationActor = {
  userId: "view-1",
  userName: "Viewer",
  role: "VIEWER",
  isSuperAdmin: false,
  canManageReceivables: false,
};

function createHarness(rows: OfficialNomusReceivableRow[] = [AR_OPEN]) {
  const officialStore = createEmptyOfficialTitlesMemoryStore();
  officialStore.receivables = rows;
  const complementStore = createEmptyTreasuryTitleComplementMemoryStore();
  const audits: Array<Record<string, unknown>> = [];
  const fakeTx = {
    treasuryAuditLog: {
      async create(args: { data: Record<string, unknown> }) {
        const row = { id: `audit-${audits.length + 1}`, ...args.data };
        audits.push(row);
        return row;
      },
    },
  } as unknown as TreasuryAuditDb;

  clearTreasuryProjectionRecalcRequests();

  const service = createTreasuryReceivableExpectationService({
    prisma: {} as PrismaClient,
    officialAdapter: createMemoryTreasuryOfficialTitlesAdapter(officialStore),
    complementRepository:
      createMemoryTreasuryTitleOperationalComplementRepository(complementStore),
    runTransaction: async (fn) => fn(fakeTx),
  });

  return { service, audits, complementStore };
}

describe("treasuryReceivableExpectation — integração", () => {
  it("cria expectativa, audita before/after e dispara recálculo", async () => {
    const { service, audits } = createHarness();
    const result = await service.putExpectation(manager, "title-open-1", {
      expectedDate: "2026-08-01",
      plannedAccountId: "acc-1",
      responsibleUserId: "collector-1",
      priority: "HIGH",
      nextAction: "Ligar cliente",
      reason: "Acordo comercial",
      notes: "Cliente pediu 15 dias",
      expectedVersion: 0,
    });

    assert.equal(result.receivable.complement?.expectedDate, "2026-08-01");
    assert.equal(result.receivable.official.dueDate, "2026-07-15");
    assert.equal(result.projectionRecalc.accepted, true);
    assert.equal(audits.length, 1);
    assert.equal(audits[0]?.entityType, "TITLE_OPERATIONAL_COMPLEMENT");
    assert.equal(audits[0]?.action, "CREATE");
    assert.equal(audits[0]?.beforeJson ?? null, null);
    assert.ok(audits[0]?.afterJson);
    assert.equal(
      (audits[0]?.afterJson as { expectedDate: string }).expectedDate,
      "2026-08-01"
    );
    assert.ok(listTreasuryProjectionRecalcRequests().length >= 1);
  });

  it("retorna CONFLICT 409 em optimistic lock e audita UPDATE com before/after", async () => {
    const { service, audits } = createHarness();
    await service.putExpectation(manager, "title-open-1", {
      expectedDate: "2026-08-01",
      reason: "Primeira data",
      expectedVersion: 0,
    });

    await assert.rejects(
      () =>
        service.putExpectation(manager, "title-open-1", {
          expectedDate: "2026-08-10",
          reason: "stale",
          expectedVersion: 0,
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "CONFLICT"
    );

    const updated = await service.putExpectation(manager, "title-open-1", {
      expectedDate: "2026-08-10",
      priority: "URGENT",
      reason: "Novo acordo",
      expectedVersion: 1,
    });
    assert.equal(updated.receivable.complement?.expectedDate, "2026-08-10");
    assert.equal(updated.receivable.complement?.version, 2);

    const updateAudit = audits.find((a) => a.action === "UPDATE");
    assert.ok(updateAudit);
    assert.equal(
      (updateAudit?.beforeJson as { expectedDate: string }).expectedDate,
      "2026-08-01"
    );
    assert.equal(
      (updateAudit?.afterJson as { expectedDate: string }).expectedDate,
      "2026-08-10"
    );
  });

  it("nega sem permissão manage", async () => {
    const { service } = createHarness();
    await assert.rejects(
      () =>
        service.putExpectation(viewer, "title-open-1", {
          expectedDate: "2026-08-01",
          reason: "x",
          expectedVersion: 0,
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "FORBIDDEN"
    );
  });
});
