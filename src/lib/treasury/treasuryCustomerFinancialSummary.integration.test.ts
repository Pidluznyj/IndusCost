import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  createEmptyOfficialTitlesMemoryStore,
  createMemoryTreasuryOfficialTitlesAdapter,
} from "./adapters/treasuryOfficialTitlesAdapter.memory.js";
import type { OfficialNomusReceivableRow } from "./mappers/treasuryOfficialTitleMappers.js";
import {
  createEmptyTreasuryCollectionActionMemoryStore,
  createMemoryTreasuryCollectionActionRepository,
} from "./repositories/treasuryCollectionActionRepository.memory.js";
import {
  createEmptyTreasuryPaymentPromiseMemoryStore,
  createMemoryTreasuryPaymentPromiseRepository,
} from "./repositories/treasuryPaymentPromiseRepository.memory.js";
import {
  createEmptyTreasuryReceivableQueryMemoryStore,
  createMemoryTreasuryReceivableQueryRepository,
} from "./repositories/treasuryReceivableQueryRepository.memory.js";
import {
  createTreasuryCustomerFinancialSummaryService,
  type TreasuryCustomerSummaryActor,
} from "./services/treasuryCustomerFinancialSummaryService.server.js";
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

const REF = new Date(Date.UTC(2026, 6, 27));

function ar(
  partial: Partial<OfficialNomusReceivableRow> &
    Pick<OfficialNomusReceivableRow, "id" | "externalId">
): OfficialNomusReceivableRow {
  return {
    status: false,
    personId: 77,
    personName: "Cliente Resumo",
    personCnpj: "11222333000181",
    description: "NF",
    competenceDate: utcDate(2026, 6, 1),
    dueDate: utcDate(2026, 7, 20),
    amountReceivable: decimalLike("1000.00"),
    balanceReceivable: decimalLike("1000.00"),
    amountReceived: decimalLike("0.00"),
    settlementDate: null,
    sourceInvoiceId: 1,
    sourceInvoiceNumber: "1",
    sourcePresenceStatus: "PRESENT",
    sourceRemovedAt: null,
    syncedAt: new Date("2026-07-20T12:00:00.000Z"),
    rawPayload: {
      nomeVendedor: "Maria Vendedora",
      responsavelComercial: "João Comercial",
    },
    ...partial,
  };
}

const actor: TreasuryCustomerSummaryActor = {
  userId: "u1",
  role: "ADMIN",
  isSuperAdmin: false,
  canViewReceivables: true,
};

describe("treasuryCustomerFinancialSummary — integração", () => {
  it("agrega títulos do cliente em batch e separa vendedor/comercial/cobrança", async () => {
    const officialStore = createEmptyOfficialTitlesMemoryStore();
    const queryStore = createEmptyTreasuryReceivableQueryMemoryStore();
    const promiseStore = createEmptyTreasuryPaymentPromiseMemoryStore();
    const actionStore = createEmptyTreasuryCollectionActionMemoryStore();

    const t1 = ar({
      id: "title-1",
      externalId: 1001,
      dueDate: utcDate(2026, 7, 10),
      balanceReceivable: decimalLike("400.00"),
    });
    const t2 = ar({
      id: "title-2",
      externalId: 1002,
      dueDate: utcDate(2026, 8, 5),
      balanceReceivable: decimalLike("250.00"),
      amountReceived: decimalLike("50.00"),
      settlementDate: utcDate(2026, 7, 15),
    });
    const other = ar({
      id: "title-other",
      externalId: 2000,
      personId: 99,
      personName: "Outro",
      balanceReceivable: decimalLike("999.00"),
    });

    officialStore.receivables = [t1, t2, other];
    queryStore.receivables = [t1, t2, other];
    queryStore.complements = [
      {
        id: "c1",
        titleType: "RECEIVABLE",
        officialTitleId: "title-1",
        officialExternalId: 1001,
        expectedDate: null,
        confirmedDate: null,
        scheduledDate: null,
        expectedAmount: null,
        confirmedAmount: null,
        scheduledAmount: null,
        status: "ACTIVE",
        priority: "HIGH",
        plannedAccountId: null,
        responsibleUserId: "collector-42",
        nextAction: "Cobrar",
        reason: null,
        notes: null,
        version: 1,
        createdAt: new Date("2026-07-21T10:00:00.000Z"),
        createdByUserId: "u1",
        updatedAt: new Date("2026-07-21T10:00:00.000Z"),
        updatedByUserId: "u1",
        cancelledAt: null,
        cancelledByUserId: null,
        cancellationReason: null,
      },
    ];

    const now = new Date("2026-07-22T12:00:00.000Z");
    promiseStore.rows = [
      {
        id: "p1",
        titleType: "RECEIVABLE",
        officialTitleId: "title-1",
        officialExternalId: 1001,
        promisedDate: utcDate(2026, 7, 30),
        promisedAmount: "100.00",
        fulfilledAmount: "0.00",
        contactNote: null,
        channel: null,
        notes: null,
        responsibleUserId: null,
        status: "ACTIVE",
        version: 1,
        createdAt: now,
        createdByUserId: "u1",
        updatedAt: now,
        updatedByUserId: "u1",
        cancelledAt: null,
        cancelledByUserId: null,
        cancellationReason: null,
        fulfilledAt: null,
      },
      {
        id: "p2",
        titleType: "RECEIVABLE",
        officialTitleId: "title-2",
        officialExternalId: 1002,
        promisedDate: utcDate(2026, 7, 1),
        promisedAmount: "50.00",
        fulfilledAmount: "0.00",
        contactNote: null,
        channel: null,
        notes: null,
        responsibleUserId: null,
        status: "EXPIRED",
        version: 1,
        createdAt: now,
        createdByUserId: "u1",
        updatedAt: now,
        updatedByUserId: "u1",
        cancelledAt: null,
        cancelledByUserId: null,
        cancellationReason: null,
        fulfilledAt: null,
      },
      {
        id: "p3",
        titleType: "RECEIVABLE",
        officialTitleId: "title-1",
        officialExternalId: 1001,
        promisedDate: utcDate(2026, 6, 15),
        promisedAmount: "80.00",
        fulfilledAmount: "80.00",
        contactNote: null,
        channel: null,
        notes: null,
        responsibleUserId: null,
        status: "FULFILLED",
        version: 1,
        createdAt: now,
        createdByUserId: "u1",
        updatedAt: now,
        updatedByUserId: "u1",
        cancelledAt: null,
        cancelledByUserId: null,
        cancellationReason: null,
        fulfilledAt: now,
      },
    ];

    actionStore.rows = [
      {
        id: "a1",
        titleType: "RECEIVABLE",
        officialTitleId: "title-1",
        officialExternalId: 1001,
        actionType: "WHATSAPP",
        performedAt: new Date("2026-07-25T15:00:00.000Z"),
        contactPerson: "Financeiro",
        result: "Combinou",
        notes: null,
        nextAction: "Enviar boleto",
        responsibleUserId: "collector-42",
        version: 1,
        createdAt: now,
        createdByUserId: "u1",
        updatedAt: now,
        updatedByUserId: "u1",
        cancelledAt: null,
        cancelledByUserId: null,
        cancellationReason: null,
      },
    ];

    const service = createTreasuryCustomerFinancialSummaryService({
      prisma: {} as PrismaClient,
      officialAdapter: createMemoryTreasuryOfficialTitlesAdapter(officialStore),
      receivableQueryRepository:
        createMemoryTreasuryReceivableQueryRepository(queryStore),
      promiseRepository:
        createMemoryTreasuryPaymentPromiseRepository(promiseStore),
      collectionActionRepository:
        createMemoryTreasuryCollectionActionRepository(actionStore),
    });

    const summary = await service.getByReceivableTitleId(
      actor,
      "title-1",
      REF
    );

    assert.equal(summary.personId, 77);
    assert.equal(summary.openAmountTotal, "650.00");
    assert.equal(summary.overdueAmountTotal, "400.00");
    assert.equal(summary.upcomingAmountTotal, "250.00");
    assert.equal(summary.activePromiseCount, 1);
    assert.equal(summary.expiredPromiseCount, 1);
    assert.equal(summary.promiseFulfillmentRate, "0.5000");
    assert.equal(summary.sellerName, "Maria Vendedora");
    assert.equal(summary.commercialOwnerName, "João Comercial");
    assert.equal(summary.collectionOwnerUserId, "collector-42");
    assert.notEqual(summary.sellerName, summary.commercialOwnerName);
    assert.equal(summary.recentReceipts.length, 1);
    assert.equal(summary.collectionHistory.length, 1);
    assert.equal(summary.collectionHistory[0]?.actionType, "WHATSAPP");
  });

  it("nega sem permissão de view", async () => {
    const queryStore = createEmptyTreasuryReceivableQueryMemoryStore();
    queryStore.receivables = [ar({ id: "t1", externalId: 1 })];
    const service = createTreasuryCustomerFinancialSummaryService({
      prisma: {} as PrismaClient,
      receivableQueryRepository:
        createMemoryTreasuryReceivableQueryRepository(queryStore),
      officialAdapter: createMemoryTreasuryOfficialTitlesAdapter(
        createEmptyOfficialTitlesMemoryStore()
      ),
      promiseRepository: createMemoryTreasuryPaymentPromiseRepository(
        createEmptyTreasuryPaymentPromiseMemoryStore()
      ),
      collectionActionRepository: createMemoryTreasuryCollectionActionRepository(
        createEmptyTreasuryCollectionActionMemoryStore()
      ),
    });

    await assert.rejects(
      () =>
        service.getByReceivableTitleId(
          { ...actor, canViewReceivables: false },
          "t1",
          REF
        ),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "FORBIDDEN"
    );
  });
});
