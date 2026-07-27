import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import {
  createEmptyOfficialTitlesMemoryStore,
  createMemoryTreasuryOfficialTitlesAdapter,
} from "./adapters/treasuryOfficialTitlesAdapter.memory.js";
import type { OfficialNomusReceivableRow } from "./mappers/treasuryOfficialTitleMappers.js";
import {
  createEmptyTreasuryDisputeMemoryStore,
  createMemoryTreasuryDisputeRepository,
} from "./repositories/treasuryDisputeRepository.memory.js";
import type { TreasuryAuditDb } from "./services/treasuryAuditService.server.js";
import {
  createTreasuryDisputeService,
  type TreasuryDisputeActor,
} from "./services/treasuryDisputeService.server.js";
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

const actor: TreasuryDisputeActor = {
  userId: "manager-1",
  userName: "Gestor",
  role: "ADMIN",
  isSuperAdmin: false,
  canViewReceivables: true,
  canManageReceivables: true,
  sessionId: "sess-d",
  requestId: "req-d-1",
};

function createHarness() {
  const officialStore = createEmptyOfficialTitlesMemoryStore();
  officialStore.receivables = [AR_OPEN];
  const disputeStore = createEmptyTreasuryDisputeMemoryStore();
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

  const service = createTreasuryDisputeService({
    prisma: {} as PrismaClient,
    officialAdapter: createMemoryTreasuryOfficialTitlesAdapter(officialStore),
    repository: createMemoryTreasuryDisputeRepository(disputeStore),
    runTransaction: async (fn) => fn(fakeTx),
  });

  return { service, audits, disputeStore, officialStore };
}

describe("treasuryDispute — integração", () => {
  it("abre contestação com audit sem mutar saldo/vencimento oficiais", async () => {
    const { service, audits, officialStore } = createHarness();
    const created = await service.createForReceivable(actor, "title-open-1", {
      reason: "Divergência de NF",
      amountDisputed: "100.00",
      responsibleUserId: "user-r",
      involvedArea: "Comercial",
      dueDate: "2026-08-10",
      notes: "Aguardando crédito",
    });

    assert.equal(created.status, "OPEN");
    assert.equal(created.amountDisputed, "100.00");
    assert.equal(created.involvedArea, "Comercial");
    assert.equal(created.dueDate, "2026-08-10");
    assert.equal(audits[0]?.entityType, "DISPUTE");
    assert.equal(
      (audits[0]?.metadataJson as { doesNotMutateOfficialBalance?: boolean })
        ?.doesNotMutateOfficialBalance,
      true
    );
    assert.equal(
      officialStore.receivables[0]?.balanceReceivable.toFixed(2),
      "400.00"
    );
    assert.equal(
      officialStore.receivables[0]?.dueDate.toISOString().slice(0, 10),
      "2026-07-15"
    );
  });

  it("resolve/cancela status sem apagar histórico", async () => {
    const { service, disputeStore } = createHarness();
    const created = await service.createForReceivable(actor, "title-open-1", {
      reason: "Cobrança indevida",
      amountDisputed: "50.00",
      responsibleUserId: null,
      involvedArea: "Financeiro",
      dueDate: null,
      notes: null,
    });
    const resolved = await service.updateStatus(actor, created.id, {
      status: "RESOLVED",
      resolutionNote: "Crédito concedido",
      notes: null,
      expectedVersion: created.version,
    });
    assert.equal(resolved.status, "RESOLVED");
    assert.ok(resolved.resolvedAt);
    assert.equal(disputeStore.rows.length, 1);

    await assert.rejects(
      () =>
        service.updateStatus(actor, created.id, {
          status: "CANCELLED",
          resolutionNote: null,
          notes: null,
          expectedVersion: resolved.version,
        }),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "CONFLICT"
    );
  });

  it("bloqueia abertura sem manage", async () => {
    const { service } = createHarness();
    await assert.rejects(
      () =>
        service.createForReceivable(
          { ...actor, canManageReceivables: false },
          "title-open-1",
          {
            reason: "x",
            amountDisputed: null,
            responsibleUserId: null,
            involvedArea: null,
            dueDate: null,
            notes: null,
          }
        ),
      (err: unknown) =>
        err instanceof TreasuryDomainError && err.code === "FORBIDDEN"
    );
  });
});
