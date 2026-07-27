import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  createEmptyOfficialTitlesMemoryStore,
  createMemoryTreasuryOfficialTitlesAdapter,
} from "./adapters/treasuryOfficialTitlesAdapter.memory.js";
import type { OfficialNomusReceivableRow } from "./mappers/treasuryOfficialTitleMappers.js";
import {
  createEmptyTreasuryPaymentPromiseMemoryStore,
  createMemoryTreasuryPaymentPromiseRepository,
} from "./repositories/treasuryPaymentPromiseRepository.memory.js";
import type { TreasuryAuditDb } from "./services/treasuryAuditService.server.js";
import {
  clearTreasuryProjectionRecalcRequests,
  listTreasuryProjectionRecalcRequests,
} from "./services/treasuryProjectionRecalc.server.js";
import {
  createTreasuryPaymentPromiseService,
  type TreasuryPaymentPromiseActor,
} from "./services/treasuryPaymentPromiseService.server.js";
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

const actor: TreasuryPaymentPromiseActor = {
  userId: "promiser-1",
  userName: "Cobrador",
  role: "ADMIN",
  isSuperAdmin: false,
  canViewReceivables: true,
  canPromiseReceivables: true,
  sessionId: "sess-p",
  requestId: "req-p-1",
};

const viewer: TreasuryPaymentPromiseActor = {
  userId: "view-1",
  role: "VIEWER",
  isSuperAdmin: false,
  canViewReceivables: true,
  canPromiseReceivables: false,
};

function createHarness() {
  const officialStore = createEmptyOfficialTitlesMemoryStore();
  officialStore.receivables = [AR_OPEN];
  const promiseStore = createEmptyTreasuryPaymentPromiseMemoryStore();
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

  const service = createTreasuryPaymentPromiseService({
    prisma: {} as PrismaClient,
    officialAdapter: createMemoryTreasuryOfficialTitlesAdapter(officialStore),
    promiseRepository:
      createMemoryTreasuryPaymentPromiseRepository(promiseStore),
    runTransaction: async (fn) => fn(fakeTx),
  });

  return { service, audits, promiseStore };
}

describe("treasuryPaymentPromise — integração", () => {
  it("cria promessa parcial, audita e recalcula projeção provável sem alterar vencimento", async () => {
    const { service, audits } = createHarness();
    const created = await service.createForReceivable(actor, "title-open-1", {
      promisedDate: "2026-08-05",
      promisedAmount: "150.00",
      contactNote: "João",
      channel: "WhatsApp",
      notes: "Combinado",
      responsibleUserId: "user-c",
      confirmAboveBalance: false,
      justification: null,
    });

    assert.equal(created.promise.promisedAmount, "150.00");
    assert.equal(created.promise.status, "ACTIVE");
    assert.equal(created.promise.fulfilledAmount, "0.00");
    assert.equal(created.projectionRecalc.accepted, true);
    assert.equal(audits[0]?.entityType, "PAYMENT_PROMISE");
    assert.equal(audits[0]?.action, "CREATE");
    assert.ok(audits[0]?.afterJson);
    assert.equal(
      (audits[0]?.metadataJson as { officialDueDate?: string })?.officialDueDate,
      "2026-07-15"
    );
    assert.ok(
      listTreasuryProjectionRecalcRequests().some(
        (r) =>
          r.reason === "receivable_promise_created" &&
          r.projectionLayer === "PROBABLE"
      )
    );

    const listed = await service.listByReceivable(actor, "title-open-1");
    assert.equal(listed.promises.length, 1);
    assert.equal(listed.promises[0]?.promisedDate, "2026-08-05");
  });

  it("bloqueia acima do saldo sem confirmação; permite com justificativa", async () => {
    const { service } = createHarness();
    await assert.rejects(
      () =>
        service.createForReceivable(actor, "title-open-1", {
          promisedDate: "2026-08-05",
          promisedAmount: "500.00",
          contactNote: null,
          channel: null,
          notes: null,
          responsibleUserId: null,
          confirmAboveBalance: false,
          justification: null,
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "VALIDATION_ERROR"
    );

    const ok = await service.createForReceivable(actor, "title-open-1", {
      promisedDate: "2026-08-05",
      promisedAmount: "500.00",
      contactNote: null,
      channel: null,
      notes: null,
      responsibleUserId: null,
      confirmAboveBalance: true,
      justification: "Cliente assumiu o total",
    });
    assert.equal(ok.promise.promisedAmount, "500.00");
  });

  it("cumprimento parcial, cancelamento com histórico e 409 de versão", async () => {
    const { service, audits, promiseStore } = createHarness();
    const created = await service.createForReceivable(actor, "title-open-1", {
      promisedDate: "2026-08-10",
      promisedAmount: "200.00",
      contactNote: null,
      channel: null,
      notes: null,
      responsibleUserId: null,
      confirmAboveBalance: false,
      justification: null,
    });

    const partial = await service.markFulfilled(actor, created.promise.id, {
      fulfilledAmount: "80.00",
      notes: "Entrada",
      expectedVersion: 1,
    });
    assert.equal(partial.promise.status, "PARTIALLY_FULFILLED");
    assert.equal(partial.promise.fulfilledAmount, "80.00");

    await assert.rejects(
      () =>
        service.markFulfilled(actor, created.promise.id, {
          fulfilledAmount: "200.00",
          notes: null,
          expectedVersion: 1,
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "CONFLICT"
    );

    const cancelled = await service.cancel(actor, created.promise.id, {
      reason: "Cliente desistiu",
      expectedVersion: 2,
    });
    assert.equal(cancelled.promise.status, "CANCELLED");
    assert.equal(promiseStore.rows.length, 1);
    assert.ok(audits.some((a) => a.action === "UPDATE"));
  });

  it("expira promessa não cumprida e nega sem permissão promise", async () => {
    const { service } = createHarness();
    await service.createForReceivable(actor, "title-open-1", {
      promisedDate: "2026-07-01",
      promisedAmount: "50.00",
      contactNote: null,
      channel: null,
      notes: null,
      responsibleUserId: null,
      confirmAboveBalance: false,
      justification: null,
    });

    const listed = await service.listByReceivable(
      actor,
      "title-open-1",
      new Date("2026-07-27T12:00:00.000Z")
    );
    assert.equal(listed.expiredCount, 1);
    assert.equal(listed.promises[0]?.status, "EXPIRED");

    await assert.rejects(
      () =>
        service.createForReceivable(viewer, "title-open-1", {
          promisedDate: "2026-08-01",
          promisedAmount: "10.00",
          contactNote: null,
          channel: null,
          notes: null,
          responsibleUserId: null,
          confirmAboveBalance: false,
          justification: null,
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "FORBIDDEN"
    );
  });
});
