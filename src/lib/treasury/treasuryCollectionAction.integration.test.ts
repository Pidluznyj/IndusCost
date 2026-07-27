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
  createEmptyTreasuryTitleComplementMemoryStore,
  createMemoryTreasuryTitleOperationalComplementRepository,
} from "./repositories/treasuryTitleOperationalComplementRepository.memory.js";
import type { TreasuryAuditDb } from "./services/treasuryAuditService.server.js";
import {
  createTreasuryCollectionActionService,
  type TreasuryCollectionActor,
} from "./services/treasuryCollectionActionService.server.js";
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

const actor: TreasuryCollectionActor = {
  userId: "collector-1",
  userName: "Cobrador",
  role: "ADMIN",
  isSuperAdmin: false,
  canViewReceivables: true,
  canCollectReceivables: true,
  sessionId: "sess-c",
  requestId: "req-c-1",
};

function createHarness() {
  const officialStore = createEmptyOfficialTitlesMemoryStore();
  officialStore.receivables = [AR_OPEN];
  const actionStore = createEmptyTreasuryCollectionActionMemoryStore();
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

  const service = createTreasuryCollectionActionService({
    prisma: {} as PrismaClient,
    officialAdapter: createMemoryTreasuryOfficialTitlesAdapter(officialStore),
    repository: createMemoryTreasuryCollectionActionRepository(actionStore),
    complementRepository:
      createMemoryTreasuryTitleOperationalComplementRepository(complementStore),
    runTransaction: async (fn) => fn(fakeTx),
  });

  return { service, audits, actionStore, complementStore };
}

describe("treasuryCollectionAction — integração", () => {
  it("cria ação, audita e espelha próxima ação no complemento sem apagar histórico", async () => {
    const { service, audits, actionStore, complementStore } = createHarness();
    const created = await service.createForReceivable(actor, "title-open-1", {
      actionType: "WHATSAPP",
      performedAt: "2026-07-27T15:30:00.000+00:00",
      contactPerson: "Maria",
      result: "Cliente pediu boleto",
      notes: "Retorno amanhã",
      nextAction: "Enviar boleto",
      responsibleUserId: null,
    });

    assert.equal(created.actionType, "WHATSAPP");
    assert.equal(created.contactPerson, "Maria");
    assert.equal(created.nextAction, "Enviar boleto");
    assert.equal(audits[0]?.entityType, "COLLECTION_ACTION");
    assert.equal(audits[0]?.action, "CREATE");
    assert.equal(complementStore.rows[0]?.nextAction, "Enviar boleto");

    const second = await service.createForReceivable(actor, "title-open-1", {
      actionType: "PHONE",
      performedAt: "2026-07-27T16:00:00.000+00:00",
      contactPerson: "Maria",
      result: "Sem resposta",
      notes: null,
      nextAction: "Ligar novamente",
      responsibleUserId: null,
    });
    assert.equal(second.nextAction, "Ligar novamente");
    assert.equal(actionStore.rows.length, 2);
    assert.equal(actionStore.rows[0]?.nextAction, "Enviar boleto");
    assert.equal(complementStore.rows[0]?.nextAction, "Ligar novamente");

    const listed = await service.listByReceivable(actor, "title-open-1");
    assert.equal(listed.length, 2);
  });

  it("cancela logicamente e preserva o registro anterior", async () => {
    const { service, actionStore, audits } = createHarness();
    const created = await service.createForReceivable(actor, "title-open-1", {
      actionType: "EMAIL",
      performedAt: "2026-07-27T12:00:00.000+00:00",
      contactPerson: null,
      result: null,
      notes: "Enviado",
      nextAction: null,
      responsibleUserId: null,
    });
    const cancelled = await service.cancel(actor, created.id, {
      reason: "Registro duplicado",
      expectedVersion: created.version,
    });
    assert.ok(cancelled.cancelledAt);
    assert.equal(cancelled.cancellationReason, "Registro duplicado");
    assert.equal(actionStore.rows.length, 1);
    assert.ok(actionStore.rows[0]?.cancelledAt);
    assert.equal(audits.at(-1)?.action, "UPDATE");
    assert.equal(
      (audits.at(-1)?.metadataJson as { action?: string })?.action,
      "cancel_logical"
    );
  });

  it("bloqueia criação sem permissão de cobrança", async () => {
    const { service } = createHarness();
    await assert.rejects(
      () =>
        service.createForReceivable(
          {
            ...actor,
            canCollectReceivables: false,
          },
          "title-open-1",
          {
            actionType: "OTHER",
            performedAt: "2026-07-27T12:00:00.000+00:00",
            contactPerson: null,
            result: null,
            notes: null,
            nextAction: null,
            responsibleUserId: null,
          }
        ),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "FORBIDDEN"
    );
  });
});
